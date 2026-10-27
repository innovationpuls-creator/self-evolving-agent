import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { AgentService } from '../../../../apps/host/runtime/agent';
import { startHost } from '../../../../apps/host/transport/server';
const root = fileURLToPath(new URL('..', import.meta.url));
const privateDir = join(root, '.runtime');
await mkdir(privateDir, { recursive: true, mode: 0o700 });
const configPath = join(privateDir, 'connection.json');
let config: { key: string; token: string; origin?: string };
try {
  config = JSON.parse(await readFile(configPath, 'utf8'));
} catch (reason) {
  if (!(reason instanceof Error && 'code' in reason && reason.code === 'ENOENT')) throw reason;
  config = { key: randomBytes(32).toString('base64'), token: randomBytes(32).toString('hex') };
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
}
const bundle = resolve(root, '../../../release/post-d5-bugfix-2026-10-22/package/Agent-darwin-arm64/Agent.app');
const service = new AgentService(join(privateDir, 'data'), Buffer.from(config.key, 'base64'), {
  reflectionAppBundle: bundle,
});
const host = await startHost({
  dataDir: service.dataDir,
  key: Buffer.from(config.key, 'base64'),
  token: config.token,
  port: Number(process.env.D6_HOST_PORT || 0),
  webDir: join(root, 'dist'),
  service,
});
await writeFile(configPath, JSON.stringify({ ...config, origin: host.origin }), { mode: 0o600 });
await writeFile(join(privateDir, 'runtime.json'), JSON.stringify({ pid: process.pid, origin: host.origin }));
console.log(
  JSON.stringify({
    origin: host.origin,
    data: 'D6-A isolated encrypted store',
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
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
