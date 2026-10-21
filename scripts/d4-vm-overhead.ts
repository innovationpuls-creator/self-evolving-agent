import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { VMAssets } from '../apps/host/evolution/sandbox/vm-assets.js';
import { VMChannel } from '../apps/host/evolution/sandbox/vm-channel.js';
const command = promisify(execFile);
const options = {
  helper: resolve('release/d4-execution/bin/d4-vm-owner'),
  observer: resolve('release/d4-execution/bin/d4-vm-observer'),
  work: resolve('release/d4-execution-work'),
};
const assets = await VMAssets.capture(options);
const one = new VMChannel({ ...options, assets }),
  two = new VMChannel({ ...options, assets });
const receipt: Record<string, unknown> = {
  admission: false,
  runtimeDigest: assets.digest,
  scope: 'fresh VM with prepared image and offline Pi runtime; Host disk cache not flushed',
  samples: [],
};
const samples = receipt.samples as unknown[];
async function sample(phase: string, channels: VMChannel[]) {
  for (let n = 0; n < 20; n++) {
    const identities = channels.flatMap((c) => Reflect.get(c, 'identities') as Array<{ pid: number }>);
    const pids = [
      process.pid,
      ...channels.map((c) => Reflect.get(c, 'child').pid as number),
      ...identities.map((i) => i.pid),
    ];
    const readings = [];
    for (const pid of pids) readings.push(JSON.parse((await command(options.observer, [String(pid)])).stdout));
    samples.push({
      phase,
      at: Date.now(),
      roles: { host: process.pid, owners: pids.slice(1, 1 + channels.length), vms: identities.map((i) => i.pid) },
      readings,
    });
    await delay(200);
  }
}
try {
  let begin = performance.now();
  await one.start();
  receipt.singleReadyMs = performance.now() - begin;
  await sample('single', [one]);
  begin = performance.now();
  await two.start();
  receipt.secondReadyMs = performance.now() - begin;
  await sample('dual', [one, two]);
  receipt.disks = (await command('du', ['-sk', options.work, resolve('release/d4-execution/bin')])).stdout;
  receipt.hostFilesystem = (await command('df', ['-k', options.work])).stdout;
} catch (error) {
  receipt.error = String(error);
  process.exitCode = 1;
} finally {
  await Promise.all([one.close(), two.close()]);
  receipt.closures = [one.closure, two.closure];
  await mkdir(resolve('release/d4-vm-evidence'), { recursive: true });
  await writeFile(resolve('release/d4-vm-evidence/overhead.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(
    JSON.stringify({
      singleReadyMs: receipt.singleReadyMs,
      secondReadyMs: receipt.secondReadyMs,
      error: receipt.error,
    }),
  );
}
