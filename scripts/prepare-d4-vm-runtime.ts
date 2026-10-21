import { execFile } from 'node:child_process';
import { chmod, copyFile, cp, mkdir, readFile, writeFile, rename, readdir, lstat, stat } from 'node:fs/promises';
import { hashFile } from '../apps/host/evolution/sandbox/vm-assets.js';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
const command = promisify(execFile);
const work = resolve('release/d4-execution-work');
const dependencies = resolve(
  process.env.AGENT_D4_VM_NODE_MODULES ?? 'release/Agent-darwin-arm64/Agent.app/Contents/Resources/app/node_modules',
);
const sdk = JSON.parse(await readFile(join(dependencies, '@earendil-works/pi-coding-agent/package.json'), 'utf8')) as {
  version: string;
};
if (sdk.version !== '1.3.0') throw new Error('D4 Guest requires the reviewed Pi 1.3.0 dependency set');
const stage = join(work, 'stage');
const runtime = join(stage, 'runtime');
await mkdir(runtime, { recursive: true });
await cp(dependencies, join(runtime, 'node_modules'), { recursive: true });
await copyFile(resolve('apps/desktop/native/evolution/vm/skill-worker.mjs'), join(runtime, 'worker.mjs'));
await cp(join(work, 'node-v24.22.0-linux-arm64/lib/node_modules/npm'), join(runtime, 'npm'), { recursive: true });
await mkdir(join(runtime, 'toolchains/bin'), { recursive: true });
await writeFile(
  join(runtime, 'toolchains/bin/npm'),
  '#!/bin/sh\nexec /usr/local/bin/node /opt/runtime/npm/bin/npm-cli.js "$@"\n',
  { mode: 0o755 },
);
await writeFile(join(runtime, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
// The Host staging area is private. The copied Guest runtime must also be
// traversable by workload uid 1000; never change permissions on its sources.
async function guestReadable(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) return;
  if (info.isDirectory()) {
    await chmod(path, 0o755);
    for (const name of await readdir(path)) await guestReadable(join(path, name));
  } else if (info.isFile()) await chmod(path, info.mode & 0o111 ? 0o755 : 0o644);
}
await guestReadable(runtime);
const archive = join(work, 'runtime.tar.next');
await command('tar', ['--no-xattrs', '-cf', archive, '-C', stage, 'runtime'], {
  env: { ...process.env, COPYFILE_DISABLE: '1' },
});
const bytes = (await stat(archive)).size;
if (bytes > 256 * 1024 * 1024) throw new Error('D4 runtime image budget exceeded');
const sha256 = await hashFile(archive);
await rename(archive, join(work, 'runtime.tar'));
const manifest = { sdk: '1.3.0', sha256, bytes };
await writeFile(join(work, 'runtime.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
