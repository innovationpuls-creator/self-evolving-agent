import { execFile } from 'node:child_process';
import { mkdir, copyFile, cp, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const command = promisify(execFile);
const source = resolve('apps/desktop/native/evolution/vm');
const output = resolve('release/d4-execution/bin');
await mkdir(output, { recursive: true });
await command('swift', ['build', '--package-path', source, '--configuration', 'release', '--jobs', '2'], {
  timeout: 900_000,
  maxBuffer: 4 * 1024 * 1024,
});
const build = (
  await command('swift', ['build', '--package-path', source, '--configuration', 'release', '--show-bin-path'])
).stdout.trim();
const helper = join(output, 'd4-vm-owner.next');
await copyFile(join(build, 'd4-vm-owner'), helper);
await cp(join(build, 'D4Execution_D4VMOwner.bundle'), join(output, 'D4Execution_D4VMOwner.bundle'), {
  recursive: true,
});
let identity = process.env.AGENT_CODESIGN_IDENTITY;
if (!identity) {
  const found = (await command('security', ['find-identity', '-v', '-p', 'codesigning'])).stdout;
  const identities = [...found.matchAll(/"(Apple Development:[^"\n]+)"/g)].map((m) => m[1]!);
  if (identities.length !== 1) throw new Error('Set AGENT_CODESIGN_IDENTITY to an existing Apple Development identity');
  identity = identities[0]!;
}
await command('codesign', [
  '--force',
  '--sign',
  identity,
  '--options',
  'runtime',
  '--timestamp=none',
  '--entitlements',
  join(source, 'owner.entitlements'),
  helper,
]);
await command('codesign', ['--verify', '--strict', helper]);
const signature = (await command('codesign', ['-d', '--verbose=4', helper])).stderr;
const team = /TeamIdentifier=([A-Z0-9]{10})/.exec(signature)?.[1];
if (!team) throw new Error('Apple-issued signature required');
const capabilities = JSON.parse((await command(helper, ['--capabilities'])).stdout) as unknown;
const observer = join(output, 'd4-vm-observer.next');
await command('clang', ['-O2', '-Wall', '-Werror', join(source, 'observer.c'), '-o', observer]);
await command('codesign', ['--force', '--sign', identity, '--options', 'runtime', '--timestamp=none', observer]);
await command('codesign', ['--verify', '--strict', observer]);
const manifest = {
  protocol: 1,
  sdk: '0.52.1',
  team,
  sha256: createHash('sha256')
    .update(await readFile(helper))
    .digest('hex'),
  observerSha256: createHash('sha256')
    .update(await readFile(observer))
    .digest('hex'),
  capabilities,
};
await writeFile(join(output, 'owner.json'), JSON.stringify(manifest, null, 2) + '\n');
await rename(helper, join(output, 'd4-vm-owner'));
await rename(observer, join(output, 'd4-vm-observer'));
console.log(JSON.stringify({ helper: join(output, 'd4-vm-owner'), ...manifest }));
