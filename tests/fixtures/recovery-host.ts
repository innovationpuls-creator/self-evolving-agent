import { startHost } from '../../apps/host/transport/server.js';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
process.once('message', async (config: { dataDir: string; key: string; token: string }) => {
  try {
    const host = await startHost({ ...config, key: Buffer.from(config.key, 'base64') });
    const fake = fauxProvider({
      models: [{ id: 'crash-model', contextWindow: 100000, maxTokens: 512 }],
      tokensPerSecond: 10000,
    });
    host.service.runtime.registerNativeProvider(fake.provider);
    fake.setResponses([
      fauxAssistantMessage(
        fauxToolCall('write', { path: 'crash-side-effect.txt', content: 'one committed side effect' }),
        { stopReason: 'toolUse' },
      ),
      async () => {
        process.send?.({ type: 'awaiting-next-model' });
        await new Promise(() => {});
        return fauxAssistantMessage('unreachable');
      },
    ]);
    process.send?.({ type: 'ready', origin: host.origin, provider: fake.provider.id });
  } catch {
    process.send?.({ type: 'failed' });
    process.exit(1);
  }
});
