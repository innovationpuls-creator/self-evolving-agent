import { startHost } from '../../apps/host/transport/server.js';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';

process.once(
  'message',
  async (config: { dataDir: string; key: string; token: string; sessionId: string; entryId: string }) => {
    try {
      const host = await startHost({ ...config, key: Buffer.from(config.key, 'base64') });
      const fake = fauxProvider({ models: [{ id: 'memory-model', contextWindow: 262144, maxTokens: 1024 }] });
      host.service.runtime.registerNativeProvider(fake.provider);
      const original = host.service.memory.reconcileSource.bind(host.service.memory);
      host.service.memory.reconcileSource = (id, leaf, entries, finish) => {
        // persist() has fsynced the encrypted snapshot; SQLite has not reconciled yet.
        if (id === config.sessionId && !entries.includes(config.entryId)) process.kill(process.pid, 'SIGKILL');
        else original(id, leaf, entries, finish);
      };
      process.send?.({ type: 'ready', origin: host.origin });
    } catch {
      process.send?.({ type: 'failed' });
      process.exit(1);
    }
  },
);
