import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fauxProvider, type FauxResponseStep } from '@earendil-works/pi-ai/providers/faux';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { AgentService } from '../../../../apps/host/runtime/agent';
import { startHost } from '../../../../apps/host/transport/server';
import { seed } from './seed';

const base = fileURLToPath(new URL('..', import.meta.url));
const root = join(base, '.runtime');
await mkdir(root, { recursive: true, mode: 0o700 });
const configPath = join(root, 'connection.json');
let config: { key: string; token: string; origin?: string };
try {
  config = JSON.parse(await readFile(configPath, 'utf8'));
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  config = { key: randomBytes(32).toString('base64'), token: randomBytes(32).toString('hex') };
}
await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
const key = Buffer.from(config.key, 'base64');
const service = new AgentService(join(root, 'data'), key, {
  reflectionAppBundle:
    process.env.AGENT_REFLECTION_APP_BUNDLE ||
    resolve(base, '../../../release/post-d5-bugfix-2026-10-22/package/Agent-darwin-arm64/Agent.app'),
  ...(process.env.D6_REFLECTION_DELAY ? { reflectionDelayMs: Number(process.env.D6_REFLECTION_DELAY) } : {}),
});
const host = await startHost({
  service,
  dataDir: service.dataDir,
  key,
  token: config.token,
  port: Number(process.env.D6_CAPABILITY_PORT || 0),
  webDir: resolve(base, '../integration/dist'),
});
const fake = fauxProvider({
  models: [{ id: 'capability-controlled', name: '受控能力验证', contextWindow: 100000, maxTokens: 2048 }],
  tokensPerSecond: 100000,
});
service.runtime.registerNativeProvider(fake.provider);
const manifest = await seed(service, fake, root);
const response: FauxResponseStep = (context) => {
  const last = context.messages.at(-1);
  if (last?.role === 'user' && JSON.stringify(last.content).includes('按已授权的目标继续工作'))
    return fauxAssistantMessage(
      fauxToolCall('evolution_complete', {
        summary: '受控机制检查已完成。本次没有需要提交的代码成果，未发布能力版本。',
        packages: [],
      }),
      { stopReason: 'toolUse' },
    );
  return fauxAssistantMessage('已保留当前讨论上下文。可以继续核对目标、依据和授权范围。');
};
const defaults = () => Array.from({ length: 2000 }, () => response);
fake.setResponses(defaults());
await writeFile(configPath, JSON.stringify({ ...config, origin: host.origin }), { mode: 0o600 });
await writeFile(
  join(root, 'runtime.json'),
  JSON.stringify({ pid: process.pid, origin: host.origin, mode: manifest.mode }),
  { mode: 0o600 },
);
const redacted = JSON.parse(
  JSON.stringify({
    ...manifest,
    skillCount: service.skills.records().length,
    suggestionCount: service.evolution.list().total,
    recordedOperation: service.skills.operations().find((op) => op.skillId === manifest.skillId),
    tools: await service.tools(manifest.sourceProject),
  }).replaceAll('/Users/torch', '<USER_HOME>'),
);
await writeFile(join(base, 'evidence', 'seed.json'), JSON.stringify(redacted, null, 2));
// A restart must never replay a previously queued controlled Tool sequence.
let command = '';
try {
  command = JSON.parse(await readFile(join(root, 'control.json'), 'utf8')).id;
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}
let reading = false;
const control = setInterval(() => {
  if (reading) return;
  reading = true;
  void (async () => {
    try {
      const value = JSON.parse(await readFile(join(root, 'control.json'), 'utf8')) as {
        id: string;
        steps?: Array<{ text?: string; tool?: string; args?: Parameters<typeof fauxToolCall>[1] }>;
      };
      if (value.id === command) return;
      if (value.steps) {
        fake.setResponses([
          ...value.steps.map((step) =>
            step.tool
              ? fauxAssistantMessage(fauxToolCall(step.tool, step.args ?? {}), { stopReason: 'toolUse' })
              : fauxAssistantMessage(step.text ?? ''),
          ),
          ...defaults(),
        ]);
      }
      command = value.id;
      await writeFile(join(root, 'control-result.json'), JSON.stringify({ id: command, queued: true }), {
        mode: 0o600,
      });
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
        console.error('Private control input invalid');
    } finally {
      reading = false;
    }
  })();
}, 80);
console.log(
  JSON.stringify({
    origin: host.origin,
    mode: manifest.mode,
    skills: service.skills.records().length,
    suggestions: service.evolution.list().total,
  }),
);
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  clearInterval(control);
  await host.close();
  process.exit(0);
};
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
