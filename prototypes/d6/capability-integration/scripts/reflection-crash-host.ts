import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { required } from './required';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { fauxAssistantMessage, fauxToolCall, type AssistantMessage } from '@earendil-works/pi-ai';
import { AgentService } from '../../../../apps/host/runtime/agent';
import { snapshot } from '../../../../apps/host/storage/storage';
const config = JSON.parse(await readFile(required(process.argv[2]), 'utf8')) as { root: string; key: string };
const host = new AgentService(join(config.root, 'data'), Buffer.from(config.key, 'base64'), {
  reflectionDelayMs: 0,
  reflectionExecutor: {
    async available() {
      return { available: true };
    },
    async execute(start, handle) {
      const run = start as { sessionId: string; project: string };
      const m = SessionManager.inMemory(run.project, { id: run.sessionId });
      const message = (await handle('model', {
        modelId: 'reflection-host-approved',
        context: { messages: [{ role: 'user', content: 'controlled crash fixture' }] },
      })) as AssistantMessage;
      m.appendMessage(message);
      await handle('checkpoint', snapshot(m));
      const call = required(message.content.find((p) => p.type === 'toolCall'));
      if (call.type !== 'toolCall') throw new Error('Expected call');
      await handle('tool', { name: call.name, toolCallId: call.id, args: call.arguments });
      const record = required(host.reflection.list()[0]);
      process.send?.({ id: record.id, changes: record.changes, status: record.status });
      await new Promise<void>(() => {});
    },
  },
});
await host.init();
const fake = fauxProvider({ models: [{ id: 'crash' }], tokensPerSecond: 100000 });
host.runtime.registerNativeProvider(fake.provider);
fake.setResponses([
  fauxAssistantMessage('ordinary task'),
  fauxAssistantMessage(
    fauxToolCall('memory_save', {
      knowledge: { title: 'Crash fixture', content: 'Committed before process kill', kind: 'fact', scope: 'project' },
      reason: 'controlled crash test',
      evidence: [],
    }),
    { stopReason: 'toolUse' },
  ),
]);
const s = await host.create(config.root, fake.provider.id, 'crash');
await host.prompt(s.id, 'controlled ordinary task');
