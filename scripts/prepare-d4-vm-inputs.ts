import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile, rename, stat, statfs, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { hashFile } from '../apps/host/evolution/sandbox/vm-assets.js';
import { writeNewDownload } from './d4-download.js';
const command = promisify(execFile);
const work = resolve('release/d4-execution-work');
await mkdir(work, { recursive: true });
const storage = await statfs(work);
if (storage.bavail * storage.bsize < 20 * 1024 ** 3)
  throw new Error('D4 preparation requires 16 GiB reserve plus 4 GiB working space');
const begin = performance.now();
const inputs = [
  {
    name: 'kata.tar.zst',
    url: 'https://github.com/kata-containers/kata-containers/releases/download/3.32.0/kata-static-3.32.0-arm64.tar.zst',
    sha256: '8736c054d9223974735394f822000823baef509e1c33405ec798240fa9b6e4b5',
    max: 800 * 1024 * 1024,
    member: 'opt/kata/share/kata-containers/vmlinux-6.18.35-197-debug',
    output: 'vmlinux',
    outputSha256: 'fb2cfb79eb1ae19447a85d75682d7fa5cfec97e24beb2609a492b806e8072c8d',
  },
  {
    name: 'node.tar.xz',
    url: 'https://nodejs.org/dist/v24.22.0/node-v24.22.0-linux-arm64.tar.xz',
    sha256: 'fef00bb4d36e1c50104a9775a10359beee98f162b4104dd12472c75065c6a143',
    max: 64 * 1024 * 1024,
    member: 'node-v24.22.0-linux-arm64/bin/node',
    output: 'node-linux',
    outputSha256: '719a43d185f3b6a59d8fcbba1ff06b93c75f76fb0bb9916f81d33921615d4cb5',
  },
];
for (const input of inputs) {
  const archive = join(work, input.name);
  if (!(await stat(archive).catch(() => undefined))) {
    const response = await fetch(input.url, { signal: AbortSignal.timeout(600000) });
    if (!response.ok || !response.body) throw new Error('official_download_failed:' + response.status);
    let size = 0;
    const budget = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        callback(size > input.max ? new Error('artifact_download_limit') : null, chunk);
      },
    });
    const reader = response.body.getReader();
    const stream = Readable.from(
      (async function* () {
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) return;
            yield Buffer.from(next.value);
          }
        } finally {
          reader.releaseLock();
        }
      })(),
    );
    await writeNewDownload(archive + '.next', stream, budget);
    await rename(archive + '.next', archive);
  }
  if ((await hashFile(archive)) !== input.sha256) throw new Error('official_artifact_digest_mismatch:' + input.name);
  const target = join(work, input.output);
  if (!(await stat(target).catch(() => undefined))) {
    const child = spawn('tar', ['-xOf', archive, input.member], { stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise<void>((ok, fail) => {
      child.once('error', fail);
      child.once('close', (code) => (code === 0 ? ok() : fail(new Error('artifact_extract_failed'))));
    });
    await Promise.all([pipeline(child.stdout, createWriteStream(target + '.next')), exited]);
    await rename(target + '.next', target);
  }
  if ((await hashFile(target)) !== input.outputSha256) throw new Error('extracted_artifact_digest_mismatch');
  if (input.output === 'node-linux') await chmod(target, 0o755);
}
const config = {
  activityId: randomUUID(),
  kernel: join(work, 'vmlinux'),
  store: join(work, 'store'),
  initImage:
    'ghcr.io/apple/containerization/vminit@sha256:fb07a2aa554e056347a6f18d286f73f3cd0e6840b1fc91a97b6006523d4f40a1',
  image: 'docker.io/library/python@sha256:55432fc4ef6d07e33c10449312f0ec00071bbb310bb9bd7ba626a31fbbc2cb0d',
  rootfs: join(work, 'placeholder.ext4'),
  initfs: join(work, 'placeholder-initfs.ext4'),
  arguments: ['/bin/true'],
  deadlineSeconds: 300,
};
// Preparation is a trusted provisioning phase; its aggregate Host budget is NOT proven.
const preparedPath = join(work, 'prepared.json');
if (!(await stat(preparedPath).catch(() => undefined))) {
  await writeFile(join(work, 'config.json'), JSON.stringify(config));
  const result = await command(
    resolve('release/d4-execution/bin/d4-vm-owner'),
    ['--prepare', join(work, 'config.json')],
    { timeout: 900000, maxBuffer: 1024 * 1024 },
  );
  const prepared = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .find((e) => e.kind === 'prepared');
  if (!prepared) throw new Error('vm_preparation_receipt_missing');
  await writeFile(preparedPath, JSON.stringify(prepared, null, 2) + '\n');
} else await readFile(preparedPath, 'utf8');
await writeFile(
  resolve('release/d4-vm-evidence/preparation.json'),
  JSON.stringify(
    { admission: false, inputs, elapsedMs: performance.now() - begin, provisioningHostAggregateBudgetProven: false },
    null,
    2,
  ) + '\n',
);
console.log('Pinned VM inputs verified; provisioning is not a D4 admission result.');
