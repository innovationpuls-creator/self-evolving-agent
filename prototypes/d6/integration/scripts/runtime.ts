import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { AgentService } from '../../../../apps/host/runtime/agent';
import { startHost } from '../../../../apps/host/transport/server';
const root = fileURLToPath(new URL('..', import.meta.url));
// Reuse the controlled validation Host's encrypted data and existing private key.
// Run exactly one Host against this directory. No formal Desktop/user store is opened.
const reference = resolve(root, '../host');
const config = JSON.parse(await readFile(join(reference, '.runtime/connection.json'), 'utf8'));
const service = new AgentService(join(reference, '.runtime/data'), Buffer.from(config.key, 'base64'), {
  reflectionAppBundle: resolve(root, '../../../release/post-d5-bugfix-2026-10-22/package/Agent-darwin-arm64/Agent.app'),
});
const host = await startHost({
  service,
  dataDir: service.dataDir,
  key: Buffer.from(config.key, 'base64'),
  token: config.token,
  port: Number(process.env.D6_HOST_PORT || 0),
  webDir: join(root, 'dist'),
});
await mkdir(join(root, '.runtime'), { recursive: true, mode: 0o700 });
await writeFile(join(root, '.runtime/runtime.json'), JSON.stringify({ pid: process.pid, origin: host.origin }), {
  mode: 0o600,
});
console.log(
  JSON.stringify({
    origin: host.origin,
    frontend: 'existing D6-A, real Host build',
    nativeEnvironment: await service.reflection.availability(),
  }),
);
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await host.close();
  process.exit(0);
};
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
