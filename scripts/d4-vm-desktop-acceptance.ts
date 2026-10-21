import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { _electron } from 'playwright-core';
import { VMDisk, type VMProcessIdentity } from '../apps/host/evolution/sandbox/vm-disk.js';
const command = promisify(execFile);
const root = await mkdtemp(resolve('release/d4-vm-client-test-'));
const executable = resolve(
  process.env.AGENT_APP_PATH ?? 'release/d4-vm-client/Agent-darwin-arm64/Agent.app/Contents/MacOS/Agent',
);
const prepared = JSON.parse(await readFile(resolve('release/d4-execution-work/prepared.json'), 'utf8')) as {
  rootfs: string;
  initfs: string;
};
const base = JSON.parse(await readFile(resolve('release/d4-execution-work/config.json'), 'utf8'));
const lease = await VMDisk.allocate(randomUUID(), root, prepared.rootfs);
const config = lease.config;
let stopped = false;
try {
  await writeFile(
    config,
    JSON.stringify({
      ...base,
      rootfs: lease.disk,
      initfs: prepared.initfs,
      deadlineSeconds: 15,
      arguments: ['/bin/sh', '-c', 'printf signed-electron-vm-ok; sleep 3'],
    }),
  );
  const desktop = await _electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${join(root, 'profile')}`],
    env: { ...process.env, AGENT_DESKTOP_DATA_DIR: join(root, 'data') },
  });
  try {
    const page = await desktop.firstWindow();
    await page.locator('.shell').waitFor({ timeout: 30000 });
    await lease.launch();
    let completed = false;
    const pending = desktop
      .evaluate(async ({ app }, configPath) => {
        const cp = process.getBuiltinModule('node:child_process');
        const path = process.getBuiltinModule('node:path');
        const helper = path.join(app.getPath('exe'), '../../Resources/D4Execution/d4-vm-owner');
        return await new Promise<{ stdout: string; stderr: string }>((ok, fail) => {
          cp.execFile(
            helper,
            ['--probe', configPath],
            { timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
            (error, stdout, stderr) => (error ? fail(error) : ok({ stdout, stderr })),
          );
        });
      }, config)
      .finally(() => {
        completed = true;
      });
    const outcome = pending.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    const observer = resolve('release/d4-execution/bin/d4-vm-observer');
    const inspect = async (pid: number) =>
      JSON.parse((await command(observer, [String(pid)], { timeout: 2000 })).stdout) as
        | VMProcessIdentity
        | { absent: true };
    const bound = new Map<number, VMProcessIdentity>();
    while (!completed) {
      const listing = (await command('ps', ['-axo', 'pid=,comm='])).stdout;
      for (const line of listing.split('\n').filter((s) => s.includes('Virtualization'))) {
        const pid = Number(line.trim().split(/\s+/)[0]);
        try {
          const files = (await command('lsof', ['-nP', '-p', String(pid), '-F', 'n'])).stdout;
          if (!files.split('\n').includes(`n${lease.disk}`)) continue;
          const identity = await inspect(pid);
          if (!('absent' in identity)) bound.set(pid, identity);
        } catch {
          /* Missing OS evidence retains the disk slot. */
        }
      }
      if (bound.size === 1) await lease.bind([...bound.values()]);
      await delay(100);
    }
    const settled = await outcome;
    if ('error' in settled) throw settled.error;
    const result = settled.value;
    assert.equal(bound.size, 1, 'signed client VM must have an external OS identity');
    for (let n = 0; n < 100; n++) {
      const previous = [...bound.values()][0]!;
      const current = await inspect(previous.pid);
      if ('absent' in current || current.startAbsolute !== previous.startAbsolute) {
        stopped = true;
        break;
      }
      await delay(100);
    }
    assert.ok(stopped, 'signed client VM must actually exit before disk disposal');
    const events = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.ok(events.some((e) => e.kind === 'workloadExited' && e.exitCode === 0));
    assert.ok(
      events.some(
        (e) => e.kind === 'output' && Buffer.from(e.base64, 'base64').toString().includes('signed-electron-vm-ok'),
      ),
    );
    await writeFile(
      resolve('release/d4-vm-evidence/desktop.json'),
      JSON.stringify(
        {
          admission: false,
          scope:
            'signed Electron main spawns bundled Apple Development VZ helper; not full product VM backend admission',
          events,
          identities: [...bound.values()],
          externalVMGone: stopped,
          stderr: result.stderr,
        },
        null,
        2,
      ) + '\n',
    );
    console.log('signed Electron → bundled signed helper → actual VM workload passed');
  } finally {
    await desktop.close();
  }
} finally {
  await lease.dispose(stopped);
}
