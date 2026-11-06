import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const root = await mkdtemp(join(tmpdir(), 'd5-packaging-failure-'));
const destination = join(root, `Agent-${process.platform}-${process.arch}`);
await mkdir(destination);
const marker = Buffer.from('previous-package-retained-through-signing-failure');
await writeFile(join(destination, 'previous-package'), marker);
const receipt: Record<string, unknown> = {
  time: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  result: 'running',
};
try {
  let failed = false;
  try {
    await promisify(execFile)(
      process.execPath,
      [resolve('node_modules/tsx/dist/cli.mjs'), 'scripts/package-desktop.ts'],
      {
        env: {
          ...process.env,
          AGENT_PACKAGE_OUT: root,
          AGENT_CODESIGN_IDENTITY: 'D5 intentionally unavailable signing identity',
        },
        timeout: 300000,
        maxBuffer: 1024 * 1024,
      },
    );
  } catch (error) {
    const result = error as NodeJS.ErrnoException & { code?: string | number; stderr?: string };
    assert.ok(result.stderr?.includes('codesign failed'), 'Expected real signing failure');
    assert.equal(result.code, 1);
    failed = true;
  }
  assert.ok(failed, 'Invalid signing identity must fail');
  assert.deepEqual(await readFile(join(destination, 'previous-package')), marker);
  assert.deepEqual(await readdir(root), [`Agent-${process.platform}-${process.arch}`]);
  receipt.previousPackageSha256 = createHash('sha256').update(marker).digest('hex');
  receipt.checks = [
    'real macOS signing failure rejected publication',
    'previous output bytes unchanged',
    'staging output removed',
  ];
  receipt.result = 'passed';
  console.log(JSON.stringify(receipt));
} finally {
  await writeFile(resolve('docs/evidence/d5-package-failure.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
