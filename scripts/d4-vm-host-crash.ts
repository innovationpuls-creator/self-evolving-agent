import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
const command = promisify(execFile);
const root = await mkdtemp(resolve('release/d4-host-crash-'));
const key = randomBytes(32).toString('base64');
const observer = resolve('release/d4-execution/bin/d4-vm-observer');
async function launch() {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/fixtures/d4-vm-host-controller.ts', root], {
    env: { ...process.env, D4_CRASH_TEST_KEY: key },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const ended = new Promise<void>((ok) => child.once('close', () => ok()));
  let text = '',
    stderr = '';
  child.stderr.on('data', (b: Buffer) => {
    if (stderr.length < 4096) stderr += b.toString();
  });
  const ready = new Promise<Record<string, unknown>>((ok, fail) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      fail(Error('host_crash_probe_timeout:' + stderr));
    }, 90000);
    child.once('close', (code) => {
      clearTimeout(timer);
      fail(Error('host_crash_probe_exited:' + code + ':' + stderr));
    });
    child.stdout.on('data', (b: Buffer) => {
      text += b.toString();
      if (text.length > 1024 * 1024) {
        child.kill('SIGKILL');
        fail(Error('host_receipt_limit'));
      }
      const end = text.indexOf('\n');
      if (end >= 0) {
        clearTimeout(timer);
        ok(JSON.parse(text.slice(0, end)));
      }
    });
  });
  return { child, ended, ready: await ready };
}
const receipt: Record<string, unknown> = {
  admission: false,
  scope: 'actual product Host process SIGKILL after returned detached Tool; same database restart',
};
const first = await launch();
const observation = first.ready.observation as { events: Array<Record<string, unknown>> };
const bound = observation.events.find((e) => e.kind === 'externalVMBound')!;
assert.ok(bound);
const identities = bound.identities as Array<{ pid: number; startAbsolute: number }>;
first.child.kill('SIGKILL');
await first.ended;
const observations = [];
let gone = false;
for (let n = 0; n < 100; n++) {
  const current = [];
  for (const identity of identities)
    current.push(JSON.parse((await command(observer, [String(identity.pid)], { timeout: 2000 })).stdout));
  observations.push({ at: Date.now(), current });
  gone = current.every((p, i) => p.absent === true || p.startAbsolute !== identities[i]!.startAbsolute);
  if (gone) break;
  await delay(100);
}
assert.ok(gone, 'Host SIGKILL must reclaim the exact VZ instance');
const second = await launch();
second.child.stdin.end();
await second.ended;
receipt.before = first.ready;
receipt.after = second.ready;
receipt.gone = gone;
receipt.externalObservations = observations;
await writeFile(resolve('release/d4-vm-evidence/host-crash.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log('actual Host SIGKILL → exact VZ gone → same database restart passed');
