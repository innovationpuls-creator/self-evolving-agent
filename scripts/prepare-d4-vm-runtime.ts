import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
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
await writeFile(join(runtime, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
const archive = join(work, 'runtime.tar.next');
await command('tar', ['--no-xattrs', '-cf', archive, '-C', stage, 'runtime'], {
  env: { ...process.env, COPYFILE_DISABLE: '1' },
});
const bytes = await readFile(archive);
if (bytes.length > 256 * 1024 * 1024) throw new Error('D4 runtime image budget exceeded');
await rename(archive, join(work, 'runtime.tar'));
const manifest = { sdk: '1.3.0', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
await writeFile(join(work, 'runtime.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
