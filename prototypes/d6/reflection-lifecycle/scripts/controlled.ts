import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { required } from './required';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { fauxAssistantMessage, fauxToolCall, type AssistantMessage } from '@earendil-works/pi-ai';
import { AgentService } from '../../../../apps/host/runtime/agent';
import { startHost } from '../../../../apps/host/transport/server';
import { snapshot } from '../../../../apps/host/storage/storage';
const base = fileURLToPath(new URL('..', import.meta.url));
const root = join(base, '.runtime', `controlled-${Date.now()}`);
await mkdir(root, { recursive: true });
let available = true,
  hold = false,
  release = false,
  mode = 'normal';
const stages: unknown[] = [];
let host: AgentService;
const fake = fauxProvider({ models: [{ id: 'mechanism' }], tokensPerSecond: 100000 });
const key = randomBytes(32);
host = new AgentService(join(root, 'data'), key, {
  reflectionDelayMs: 0,
  reflectionExecutor: {
    async available() {
      return { available, ...(!available ? { reason: '受控机制测试：执行环境不可用' } : {}) };
    },
    async execute(start, handle, signal) {
      const run = start as { sessionId: string; project: string };
      const m = SessionManager.inMemory(run.project, { id: run.sessionId });
      while (
        hold &&
        !release &&
        host.reflection.jobs.list().find((j) => j.reflectionSessionId === run.sessionId)?.sessionId ===
          manifest.waitingSource
      ) {
        signal.throwIfAborted();
        await new Promise((r) => setTimeout(r, 40));
      }
      if (hold && mode === 'normal')
        fake.setResponses([
          fauxAssistantMessage(
            fauxToolCall('reflection_save', {
              summary: '环境恢复后已完成检查，本次没有新增发现。',
              findings: [],
              uncertainties: [],
              evidence: [],
            }),
            { stopReason: 'toolUse' },
          ),
        ]);
      for (let index = 0; index < (mode === 'normal' ? 1 : mode === 'effect' ? 3 : 2); index++) {
        const message = (await handle('model', {
          modelId: 'reflection-host-approved',
          context: {
            messages: [{ role: 'user', content: 'Controlled mechanism fixture; not autonomous real model behavior.' }],
          },
        })) as AssistantMessage;
        m.appendMessage(message);
        await handle('checkpoint', snapshot(m));
        const call = message.content.find((p) => p.type === 'toolCall');
        if (call?.type !== 'toolCall') throw Error('Expected fixture call');
        const result = (await handle('tool', { name: call.name, toolCallId: call.id, args: call.arguments })) as {
          content: Array<{ type: 'text'; text: string }>;
          details?: unknown;
          isError?: boolean;
        };
        m.appendMessage({
          role: 'toolResult',
          toolCallId: call.id,
          toolName: call.name,
          content: result.content,
          details: result.details as never,
          isError: !!result.isError,
          timestamp: Date.now(),
        });
        await handle('checkpoint', snapshot(m));
        stages.push({ mode, tool: call.name, result });
      }
      if (mode === 'failed') throw Error('controlled failure after committed Memory');
      if (mode === 'interrupted') {
        (Reflect.get(host.reflection, 'abort') as AbortController).abort();
        signal.throwIfAborted();
      }
      await handle('complete', {});
    },
  },
});
const token = randomBytes(32).toString('hex');
const server = await startHost({
  service: host,
  dataDir: host.dataDir,
  key,
  token,
  port: Number(process.env.D6_REFLECTION_PORT || 0),
  webDir: join(base, '../integration/dist'),
});
host.runtime.registerNativeProvider(fake.provider);
const project = join(root, 'alpha'),
  other = join(root, 'beta');
await mkdir(project);
await mkdir(other);
await writeFile(join(base, '.runtime/controlled-connection.json'), JSON.stringify({ origin: server.origin, token }), {
  mode: 0o600,
});
const wait = async (fn: () => boolean | Promise<boolean>) => {
  const until = Date.now() + 20000;
  while (!(await fn())) {
    if (Date.now() > until) throw Error('seed deadline');
    await new Promise((r) => setTimeout(r, 10));
  }
};
const source = await host.create(project, fake.provider.id, 'mechanism');
const foreign = await host.create(other, fake.provider.id, 'mechanism');
const rows: unknown[] = [];
async function run(index: number, which = 'normal') {
  await wait(async () => !(await host.viewSession(source.id)).busy);
  const previousCount = host.reflection.jobs.list().length;
  mode = which;
  const summary =
    index % 9 === 0
      ? '本次没有新增发现。'
      : index % 7 === 0
        ? '本次核对保留了原有结论；证据中的额外条件仍需用户确认。'.repeat(16)
        : `已核对第 ${index + 1} 次任务的已保存依据，未发现需要更新的认识。`;
  const responses = [fauxAssistantMessage('来源任务已结束；没有 Memory 写入。')];
  if (which !== 'normal')
    responses.push(
      fauxAssistantMessage(
        fauxToolCall('memory_save', {
          knowledge: {
            title: `受控反思成果 ${which}`,
            content: '机制验证：这条记录来自后台 Reflection Worker，最初正文。',
            kind: 'experience',
            scope: 'project',
          },
          reason: '隔离机制测试：后台 Worker 实际保存',
          evidence: [],
        }),
        { stopReason: 'toolUse' },
      ),
    );
  if (which === 'effect') {
    // Created id is known only after the actual first Tool operation.
    const complete = host.runtime.completeSimple.bind(host.runtime);
    let calls = 0;
    host.runtime.completeSimple = async (...args) => {
      calls++;
      if (calls === 2) {
        const rec = required(host.reflection.list(source.id)[0]);
        const change = required(rec.changes[0]);
        return fauxAssistantMessage(
          fauxToolCall('memory_revise', {
            id: change.id,
            baseRevision: 1,
            knowledge: {
              title: '受控反思成果 effect',
              content: '机制验证：经过证据核对后的第二次正文。',
              kind: 'experience',
              scope: 'project',
            },
            reason: '隔离机制测试：同一次后台反思修订',
            evidence: [],
          }),
          { stopReason: 'toolUse' },
        );
      }
      return complete(...args);
    };
    responses.push(
      fauxAssistantMessage(
        fauxToolCall('reflection_save', {
          summary: '已保存一项认识及其后续修订。',
          findings: ['此内容仅验证写入机制，不是自主模型成果。'],
          uncertainties: [],
          evidence: [],
        }),
        { stopReason: 'toolUse' },
      ),
    );
    fake.setResponses(responses);
    await host.prompt(source.id, `检查第 ${index + 1} 次隔离任务。`);
    await wait(
      () =>
        host.reflection.jobs.list().length > previousCount &&
        host.reflection.jobs.list().at(-1)?.status === 'succeeded',
    );
    host.runtime.completeSimple = complete;
  } else {
    responses.push(
      fauxAssistantMessage(
        fauxToolCall('reflection_save', {
          summary,
          findings: [],
          uncertainties: index % 7 === 0 ? ['这一项是受控展示测试的未确认条件。'] : [],
          evidence: [],
        }),
        { stopReason: 'toolUse' },
      ),
    );
    fake.setResponses(responses);
    await host.prompt(source.id, `检查第 ${index + 1} 次隔离任务。`);
    await wait(
      () =>
        host.reflection.jobs.list().length > previousCount &&
        ['succeeded', 'failed', 'interrupted'].includes(host.reflection.jobs.list().at(-1)?.status || ''),
    );
  }
  rows.push(host.reflection.list(source.id)[0]);
}
for (let i = 0; i < 125; i++)
  await run(i, i === 122 ? 'effect' : i === 123 ? 'failed' : i === 124 ? 'interrupted' : 'normal');
const effect = required((rows as Array<{ changes: unknown[]; id: string }>).find((r) => r.changes.length === 2));
const failed = required(host.reflection.jobs.list().find((j) => j.status === 'failed'));
const interrupted = host.reflection.jobs.list().find((j) => j.status === 'interrupted');
available = false;
await host.reflection.recheck();
const waitingSource = await host.create(project, fake.provider.id, 'mechanism');
fake.setResponses([fauxAssistantMessage('等待检查的任务已结束。')]);
await host.prompt(waitingSource.id, '用于观察环境等待和恢复的普通任务。');
await wait(() => host.reflection.jobs.list({ sessionId: waitingSource.id })[0]?.status === 'waiting_user');
const waiting = required(host.reflection.jobs.list({ sessionId: waitingSource.id })[0]);
const manifest = {
  mode: 'controlled formal Host lifecycle; Faux model and direct checkpoint executor; same D6-A frontend',
  origin: server.origin,
  project,
  other,
  source: source.id,
  foreign: foreign.id,
  effect: effect.id,
  failed: failed.id,
  interrupted: interrupted?.id,
  waiting: waiting.id,
  waitingSource: waitingSource.id,
  total: host.reflection.catalog({ sessionId: source.id }).total,
};
await writeFile(join(base, '.runtime/controlled.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
await writeFile(
  join(base, 'evidence/controlled-seed.json'),
  JSON.stringify(
    {
      mode: manifest.mode,
      total: manifest.total,
      jobs: host.reflection.catalog({ sessionId: source.id }).total,
      changes: rows.slice(-3),
      stages: stages.slice(-8),
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ origin: server.origin, total: manifest.total, ready: true }));
let last = '';
const timer = setInterval(() => {
  void (async () => {
    let command: { id: string; action: string };
    try {
      command = JSON.parse(await readFile(join(base, '.runtime/control.json'), 'utf8'));
    } catch {
      return;
    }
    if (command.id === last) return;
    last = command.id;
    if (command.action === 'restore') {
      available = true;
      hold = true;
      release = false;
      mode = 'normal';
      fake.setResponses([
        fauxAssistantMessage(
          fauxToolCall('reflection_save', {
            summary: '环境恢复后已完成检查，本次没有新增发现。',
            findings: [],
            uncertainties: [],
            evidence: [],
          }),
          { stopReason: 'toolUse' },
        ),
      ]);
    }
    if (command.action === 'wait') {
      available = false;
      hold = false;
      release = false;
      mode = 'normal';
      await host.reflection.recheck();
      const next = await host.create(project, fake.provider.id, 'mechanism');
      fake.setResponses([fauxAssistantMessage('新的环境等待任务。')]);
      await host.prompt(next.id, '重复环境生命周期机制验证。');
      await wait(() => host.reflection.jobs.list({ sessionId: next.id })[0]?.status === 'waiting_user');
      manifest.waiting = required(host.reflection.jobs.list({ sessionId: next.id })[0]).id;
      manifest.waitingSource = next.id;
      await writeFile(
        join(base, '.runtime/controlled.json'),
        JSON.stringify({ ...manifest, command: command.id }, null, 2),
        { mode: 0o600 },
      );
    }
    if (command.action === 'continue') release = true;
  })();
}, 80);
const close = async () => {
  clearInterval(timer);
  await server.close();
  process.exit(0);
};
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
