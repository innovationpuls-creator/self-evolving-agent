import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startHost } from './transport/server.js';
import { DataKeyError, decodeDataKey } from './storage/data-key.js';

interface Config {
  dataDir: string;
  key: string;
  token: string;
  port?: number;
  reflectionAppBundle?: string;
  desktopKeyProof?: string;
}
async function run(config: Config) {
  const dataDir = resolve(config.dataDir);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const host = await startHost({ ...config, dataDir, key: decodeDataKey(config.key) });
  let stopping = false;
  const close = async () => {
    if (stopping) return;
    stopping = true;
    let status = 0;
    try {
      await host.close();
    } catch {
      status = 1;
    } finally {
      process.exit(status);
    }
  };
  process.on('SIGINT', () => void close());
  process.on('SIGTERM', () => void close());
  process.parentPort?.on('message', (event) => {
    if (event.data?.type === 'shutdown') void close();
    if (event.data?.type === 'prepare-maintenance')
      void host.service.prepareMaintenance().then(
        () => {
          process.parentPort?.postMessage({ type: 'maintenance-ready' });
          return close();
        },
        () => process.parentPort?.postMessage({ type: 'maintenance-busy' }),
      );
  });
  if (process.parentPort) process.parentPort.postMessage({ type: 'ready', origin: host.origin });
  else console.log(`Agent Host: ${host.origin}`);
}
if (process.parentPort)
  process.parentPort.once('message', (event) => {
    void run(event.data as Config).catch((error) => {
      process.parentPort?.postMessage({
        type: 'failed',
        code: error instanceof DataKeyError ? error.code : 'host-failed',
      });
      process.exit(1);
    });
  });
else {
  const { AGENT_DATA_KEY: key, AGENT_TOKEN: token } = process.env;
  if (!key || !token) {
    console.error('请设置 AGENT_DATA_KEY（32 字节 Base64）及 AGENT_TOKEN（至少 32 字符）');
    process.exit(1);
  }
  delete process.env.AGENT_DATA_KEY;
  delete process.env.AGENT_TOKEN;
  void run({
    dataDir: process.env.AGENT_DATA_DIR ?? '.agent-data',
    key,
    token,
    port: Number(process.env.PORT ?? 4317),
    reflectionAppBundle: process.env.AGENT_REFLECTION_APP_BUNDLE,
  }).catch((error) => {
    console.error(
      error instanceof DataKeyError && error.code === 'key-unverified'
        ? '旧数据目录缺少可验证的密钥身份，需要显式迁移；原数据已保留。'
        : 'Host 启动失败，请检查密钥、数据目录与端口；原数据已保留。',
    );
    process.exit(1);
  });
}
