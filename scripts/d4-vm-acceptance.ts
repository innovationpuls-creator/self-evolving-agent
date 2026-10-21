import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { startHost } from '../apps/host/transport/server.js';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { VMDisk } from '../apps/host/evolution/sandbox/vm-disk.js';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

// This exercises an experimental SDK helper. It does not grant publication.
const command = promisify(execFile);
const work = resolve(process.env.AGENT_D4_VM_WORK ?? 'release/d4-execution-work');
const output = resolve('release/d4-vm-evidence');
const helper = resolve('release/d4-execution/bin/d4-vm-owner');
const observer = resolve('release/d4-execution/bin/d4-vm-observer');
await mkdir(output, { recursive: true });
const prepared = JSON.parse(await readFile(join(work, 'prepared.json'), 'utf8')) as { rootfs: string; initfs: string };
const base = JSON.parse(await readFile(join(work, 'config.json'), 'utf8')) as Record<string, unknown>;
const probe = await readFile(resolve('scripts/d4-vm-guest-probe.py'), 'utf8');
const host = await startHost({
  dataDir: join(work, `host-probe-${randomUUID()}`),
  key: randomBytes(32),
  token: randomBytes(32).toString('hex'),
});
const fake = fauxProvider({
  models: [{ id: 'resource-observer', contextWindow: 100000, maxTokens: 256 }],
  tokensPerSecond: 100000,
});
host.service.runtime.registerNativeProvider(fake.provider);
const hostSession = await host.service.create(work, fake.provider.id, 'resource-observer');
const hostBusiness = async () => {
  fake.setResponses([
    fauxAssistantMessage(fauxToolCall('bash', { command: 'printf host-resource-service-ok' }), {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage('host-done'),
  ]);
  await host.service.prompt(hostSession.id, 'Run the fixed Host service probe.');
  while ((await host.service.viewSession(hostSession.id)).busy) await delay(10);
  const state = await host.service.viewSession(hostSession.id);
  assert.ok(
    state.messages.some((m) => m.role === 'toolResult' && JSON.stringify(m).includes('host-resource-service-ok')),
  );
  return { completed: true, at: Date.now() };
};
type Identity = { pid: number; startAbsolute: number; physicalFootprint: number };
const inspect = async (pid: number): Promise<Identity | { pid: number; absent: true }> => {
  const result = JSON.parse((await command(observer, [String(pid)], { timeout: 2000 })).stdout);
  if (result.pid !== pid || (result.absent !== true && !Number.isSafeInteger(result.startAbsolute)))
    throw new Error('observer_invalid');
  return result;
};
const receipt = {
  time: new Date().toISOString(),
  baseline: 'b01acb8',
  sdk: '0.52.1',
  admission: false,
  helper: JSON.parse(await readFile(resolve('release/d4-execution/bin/owner.json'), 'utf8')) as unknown,
  scope: 'experimental VM probes; formal path has separate receipt; no D4 admission',
  cases: [] as Record<string, unknown>[],
  blockers: ['host_preparation_and_ipc_aggregate_limits_unproven', 'full_six_item_acceptance_incomplete'],
};
const receiptId = randomUUID();
const persist = async () => {
  const bytes = JSON.stringify(receipt, null, 2) + '\n';
  await writeFile(join(output, `receipt-${receiptId}.json`), bytes);
  await writeFile(join(output, 'receipt.json'), bytes);
};
await command('codesign', ['--verify', '--strict', helper]);

async function run(mode: string, role: 'A' | 'B', cancellation?: 'eof' | 'kill') {
  const id = randomUUID();
  const lease = await VMDisk.allocate(id, work, prepared.rootfs);
  const disk = lease.disk;
  let stopped = false;
  try {
    const hostCanary = join(work, 'host-canary');
    await writeFile(hostCanary, 'host-private');
    const other = role === 'A' ? 'B' : 'A';
    const denied = ['workspace', 'cache', 'build', 'tmp'].flatMap((p) => [
      `/tmp/${other}/${p}/canary`,
      `/tmp/${role}/../${other}/${p}/canary`,
    ]);
    denied.push(hostCanary, prepared.rootfs, disk);
    const config = {
      ...base,
      activityId: id,
      rootfs: disk,
      initfs: prepared.initfs,
      nodeExecutable: join(work, 'node-linux'),
      arguments: ['/usr/local/bin/python3', '-c', probe, mode, role, JSON.stringify(denied)],
      deadlineSeconds: mode === 'detached' ? 6 : 30,
    };
    const configPath = lease.config;
    await writeFile(configPath, JSON.stringify(config));
    const begin = performance.now();
    await lease.launch();
    const child = spawn(helper, ['--probe', configPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    const events: Record<string, unknown>[] = [];
    let pending = '',
      stderr = '',
      outputBytes = 0,
      readyMs: number | undefined,
      canceled = false;
    let stdout = '',
      overflow = false;
    let hostProgress: Promise<{ completed: boolean; at: number }> | undefined;
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 8 * 1024 * 1024) {
        overflow = true;
        child.kill('SIGKILL');
        return;
      }
      pending += chunk.toString('utf8');
      for (;;) {
        const end = pending.indexOf('\n');
        if (end < 0) break;
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.kind === 'output') {
          const bytes = Buffer.from(String(event.base64), 'base64');
          if (stdout.length < 65536) stdout += bytes.subarray(0, 65536 - stdout.length).toString('utf8');
          events.push({ kind: 'output', stream: event.stream, bytes: bytes.length });
        } else {
          events.push(event);
          if (event.kind === 'ready') readyMs = performance.now() - begin;
        }
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 65536) stderr += chunk.toString('utf8');
    });
    let finished = false;
    const closed = new Promise<{ code: number | null; signal: string | null }>((ok, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        finished = true;
        ok({ code, signal });
      });
    });
    const bound = new Map<number, Identity>();
    const samples: Identity[] = [];
    const monitor = (async () => {
      while (!finished) {
        const listing = (await command('ps', ['-axo', 'pid=,comm='])).stdout;
        const candidates = listing
          .split('\n')
          .filter((s) => s.includes('Virtualization'))
          .map((s) => Number(s.trim().split(/\s+/)[0]));
        for (const pid of candidates) {
          try {
            const open = (await command('lsof', ['-nP', '-p', String(pid), '-F', 'n'], { maxBuffer: 1024 * 1024 }))
              .stdout;
            if (!open.split('\n').includes(`n${disk}`)) continue;
            const identity = await inspect(pid);
            if (!('absent' in identity)) {
              bound.set(pid, identity);
              if (bound.size === 1) await lease.bind([...bound.values()]);
              samples.push(identity);
            }
          } catch {
            /* lack of observation is a missing proof, never success */
          }
        }
        if (cancellation && !canceled && events.some((e) => e.kind === 'output') && bound.size) {
          canceled = true;
          if (cancellation === 'eof') child.stdin.end();
          else child.kill('SIGKILL');
        }
        if (
          role === 'A' &&
          ['cpu', 'pids', 'memory', 'output', 'storage'].includes(mode) &&
          readyMs !== undefined &&
          !hostProgress
        )
          hostProgress = hostBusiness();
        if (performance.now() - begin > 45000) child.kill('SIGKILL');
        await delay(150);
      }
    })();
    const exit = await closed;
    await monitor;
    const identities = [...bound.values()];
    let gone = false;
    for (let i = 0; i < 40; i++) {
      const current = await Promise.all(identities.map((p) => inspect(p.pid)));
      gone =
        identities.length > 0 &&
        current.every((p, n) => 'absent' in p || p.startAbsolute !== identities[n]!.startAbsolute);
      if (gone) break;
      await delay(100);
    }
    const diskInfo = await stat(disk);
    stopped = gone;
    const result = {
      id,
      role,
      mode,
      cancellation,
      canceled,
      exit,
      readyMs,
      elapsedMs: performance.now() - begin,
      identities,
      gone,
      samples,
      events,
      stdout,
      stderr,
      outputBytes,
      overflow,
      disk: { path: disk, bytes: diskInfo.size, allocatedBytes: diskInfo.blocks * 512 },
      // Self-reported business/assertions and supervisor/OS observations stay separate.
      workloadReportOnly: true,
      hostBusiness: await hostProgress,
    };
    receipt.cases.push(result);
    await writeFile(join(output, `${id}.json`), JSON.stringify(result, null, 2) + '\n');
    await persist();
    console.log(
      JSON.stringify({
        mode,
        role,
        ...exit,
        readyMs,
        boundVMs: identities.length,
        gone,
        stderr,
        stdout: stdout.slice(0, 1000),
      }),
    );
    assert.equal(overflow, false, 'owner IPC exceeded observer budget');
    assert.ok(gone, 'actual VZ process exit must be confirmed');
    if (mode === 'boundary')
      assert.ok(
        events.some((e) => e.kind === 'workloadExited' && e.exitCode === 0),
        'positive and negative boundary workload must succeed',
      );
    if (mode === 'pids')
      assert.ok(
        events.some((e) => e.kind === 'statistics' && e.tasks === 128),
        'aggregate task limit observed',
      );
    if (mode === 'memory')
      assert.ok(
        events.some((e) => e.kind === 'workloadExited' && e.exitCode === 137),
        'aggregate OOM kills workload',
      );
    if (mode === 'cpu')
      assert.ok(
        events.some((e) => e.kind === 'statistics' && Number(e.throttledUsec) > 1000000),
        'aggregate CPU throttling observed',
      );
    if (mode === 'output')
      assert.ok(
        events.some((e) => e.reason === 'output_limit'),
        'combined output limit observed',
      );
    if (mode === 'storage')
      assert.equal(stdout.split('"errno": 28').length - 1, 2, 'both writers hit aggregate filesystem limit');
    return result;
  } finally {
    await lease.dispose(stopped);
  }
}

try {
  await persist();
  const pair = await Promise.all([run('boundary', 'A'), run('boundary', 'B')]);
  if (
    pair.some(
      (r) => r.exit.code !== 0 || !r.gone || !r.events.some((e) => e.kind === 'workloadExited' && e.exitCode === 0),
    )
  ) {
    receipt.blockers.push('basic_vm_boundary_or_shutdown_probe_failed');
    await persist();
    process.exitCode = 1;
  } else {
    for (const mode of ['cpu', 'pids', 'memory', 'output', 'storage'])
      await Promise.all([run(mode, 'A'), run('boundary', 'B')]);
    await run('detached', 'A', 'eof');
    await run('detached', 'A', 'kill');
    await run('detached', 'A');
  }
} finally {
  await host.close();
}
