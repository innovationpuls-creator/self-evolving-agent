import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { open, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { VMAssets } from '../apps/host/evolution/sandbox/vm-assets.js';
import { VMChannel } from '../apps/host/evolution/sandbox/vm-channel.js';

// Fixed owned fixture, never a generated candidate. A live VZ image lock is not
// presumed to deny ordinary same-uid reads or writes to its backing file.
const options = {
  helper: resolve('release/d4-execution/bin/d4-vm-owner'),
  observer: resolve('release/d4-execution/bin/d4-vm-observer'),
  work: resolve('release/d4-execution-work'),
};
const assets = await VMAssets.capture(options);
const vm = new VMChannel({ ...options, assets });
const marker = 'D4_BACKING_SOURCE_' + randomUUID();
const receipt: Record<string, unknown> = {
  time: new Date().toISOString(),
  admission: false,
  runtimeDigest: assets.digest,
  scope: 'same-uid live VM backing access; fixed owned source',
};
try {
  await vm.start();
  await vm.request({
    kind: 'load',
    extensions: ['extension.mjs'],
    versionDigest: 'owned-backing-fixture',
    files: [
      {
        path: 'extension.mjs',
        base64: Buffer.from(
          `// ${marker}\nimport {openSync,fsyncSync,closeSync,statfsSync} from 'node:fs';\nconst fd=openSync('/tmp/skill/extension.mjs','r+');fsyncSync(fd);closeSync(fd);\nconsole.error('BACKING_GUEST_FS:'+statfsSync('/tmp').type);\nexport default () => {};`,
        ).toString('base64'),
      },
    ],
  });
  const disk = Reflect.get(vm, 'disk') as { disk: string };
  const file = await open(disk.disk, 'r+');
  try {
    const buffer = Buffer.alloc(128 * 1024);
    const needle = Buffer.from(marker);
    let found = -1;
    for (let offset = 0; offset < 2 * 1024 ** 3; offset += buffer.length - needle.length) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
      const index = buffer.subarray(0, bytesRead).indexOf(needle);
      if (index >= 0) {
        found = offset + index;
        break;
      }
      if (!bytesRead) break;
    }
    assert.ok(found >= 0, 'owned Guest source must be located before claiming a backing bypass');
    // Write exactly the existing source marker. No filesystem metadata or
    // unrelated bytes change; successful pwrite still proves write permission.
    const written = await file.write(needle, 0, needle.length, found);
    assert.equal(written.bytesWritten, needle.length);
    Object.assign(receipt, {
      sourceReadOutsideGuest: true,
      sourceSameBytesWriteOutsideGuest: true,
      offset: found,
      markerBytes: needle.length,
      backingBoundaryPassed: false,
    });
  } finally {
    await file.close();
  }
} catch (error) {
  receipt.error = String(error);
  process.exitCode = 1;
} finally {
  try {
    await vm.close();
    receipt.closure = vm.closure;
    receipt.events = vm.events;
  } catch (error) {
    receipt.cleanupError = String(error);
    process.exitCode = 1;
  }
  await writeFile(resolve('release/d4-vm-evidence/backing-boundary.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
}
if (receipt.backingBoundaryPassed === false) process.exitCode = 1;
