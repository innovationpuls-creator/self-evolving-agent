import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { fauxAssistantMessage, fauxToolCall, type AssistantMessage } from '@earendil-works/pi-ai';
import { AgentService } from '../apps/host/runtime/agent.js';
import { snapshot, SensitiveData } from '../apps/host/storage/storage.js';
import type { ReflectionExecutor } from '../apps/host/reflection/reflection-service.js';
import { NativeReflectionExecutor, ReflectionExecutorError } from '../apps/host/reflection/native-executor.js';

type Handle = (operation: string, input: unknown) => Promise<unknown>;
type Run = (start: { sessionId: string; project: string }, handle: Handle, signal: AbortSignal) => Promise<void>;

/** In-process executor for Host contract tests only; never a product sandbox fallback. */
const executor = (run: Run): ReflectionExecutor => ({
  async available() {
    return { available: true };
  },
  execute: (start, handle, signal) => run(start as { sessionId: string; project: string }, handle, signal),
});
const model = (handle: Handle) =>
  handle('model', {
    modelId: 'reflection-host-approved',
    context: { messages: [{ role: 'user', content: 'Host contract test.' }] },
  }) as Promise<AssistantMessage>;
async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}
async function fixture(
  run: Run,
  responses: Parameters<ReturnType<typeof fauxProvider>['setResponses']>[0],
  options: { project?: (dir: string) => Promise<string>; modelTimeoutMs?: number; delayMs?: number } = {},
  body?: (host: AgentService, sessionId: string) => Promise<void>,
) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'reflection-failure-')));
  const data = join(dir, 'data');
  const host = new AgentService(data, randomBytes(32), {
    reflectionExecutor: executor(run),
    reflectionDelayMs: options.delayMs ?? 0,
    reflectionModelTimeoutMs: options.modelTimeoutMs,
  });
  try {
    await host.init();
    const fake = fauxProvider({ models: [{ id: 'test' }], tokensPerSecond: 100000 });
    host.runtime.registerNativeProvider(fake.provider);
    fake.setResponses(responses);
    const project = options.project ? await options.project(dir) : dir;
    const session = await host.create(project, fake.provider.id, 'test');
    await host.prompt(session.id, 'ordinary task');
    if (body) await body(host, session.id);
    else
      await waitFor(() =>
        ['succeeded', 'failed', 'waiting_user'].includes(host.reflection.jobs.list()[0]?.status ?? ''),
      );
    host.diagnostics.flush();
    const db = new DatabaseSync(join(data, 'product.sqlite'), { readOnly: true });
    const codes = db
      .prepare("SELECT code FROM host_system_logs WHERE code LIKE 'REFLECTION_%' ORDER BY seq")
      .all()
      .map((r) => String(r.code));
    db.close();
    const job = host.reflection.jobs.list()[0];
    assert.ok(job);
    return {
      job,
      codes,
      availability: host.reflection.catalog({ statusOnly: true }).availability,
    };
  } finally {
    await host.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('a replayed Tool Call returns the same protected content as its first result', async () => {
  // A project whose Memory identity digest the boundary projection alters (it resembles personal data).
  const project = async (dir: string) => {
    const sensitive = new SensitiveData();
    for (let n = 0; ; n++) {
      const path = join(dir, `p${n}`);
      const key = createHash('sha256').update(path).digest('hex');
      if (sensitive.text(key) !== key) {
        await mkdir(path);
        return path;
      }
    }
  };
  let replayed = false;
  const { job } = await fixture(
    async (start, handle) => {
      const manager = SessionManager.inMemory(start.project, { id: start.sessionId });
      const message = await model(handle);
      manager.appendMessage(message);
      await handle('checkpoint', snapshot(manager));
      const call = message.content.find((p) => p.type === 'toolCall');
      assert.ok(call?.type === 'toolCall');
      const input = { name: call.name, toolCallId: call.id, args: call.arguments };
      const first = (await handle('tool', input)) as { content: unknown[]; isError?: boolean };
      assert.ok(!first.isError, JSON.stringify(first));
      const again = (await handle('tool', input)) as { content: unknown[] };
      assert.deepEqual(again.content, first.content);
      replayed = true;
      await handle('complete', {});
    },
    [
      fauxAssistantMessage('ordinary task done'),
      fauxAssistantMessage(
        fauxToolCall('memory_save', {
          knowledge: { title: 'Fact', content: 'A bounded fact', kind: 'fact', scope: 'project' },
          reason: 'observed',
          evidence: [],
        }),
        { stopReason: 'toolUse' },
      ),
    ],
    { project },
  );
  assert.equal(replayed, true);
  assert.equal(job.status, 'succeeded');
});

test('a model request that exceeds the Host timeout is recorded as a model timeout', async () => {
  const { job, codes } = await fixture(
    async (_start, handle) => {
      await model(handle);
    },
    [
      fauxAssistantMessage('ordinary task done'),
      async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return fauxAssistantMessage('too late');
      },
    ],
    { modelTimeoutMs: 50 },
  );
  assert.equal(job.status, 'failed');
  assert.match(job.error ?? '', /超时/);
  assert.ok(codes.includes('REFLECTION_FAILED_MODEL_TIMEOUT'), codes.join());
});

test('a Provider error response is recorded as a model Provider failure, not a timeout', async () => {
  const { job, codes } = await fixture(
    async (_start, handle) => {
      const response = await model(handle);
      // Mirrors the Worker: a failed model turn ends the run with a fixed Worker code.
      if (response.stopReason === 'error') throw new ReflectionExecutorError('worker_model', 'model failed');
    },
    [
      fauxAssistantMessage('ordinary task done'),
      fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'upstream failure' }),
    ],
  );
  assert.equal(job.status, 'failed');
  assert.doesNotMatch(job.error ?? '', /超时/);
  assert.ok(codes.includes('REFLECTION_FAILED_MODEL_PROVIDER'), codes.join());
  assert.ok(codes.includes('REFLECTION_EXECUTOR_WORKER_MODEL'), codes.join());
});

test('failure stage distinguishes never started, rejected checkpoint and Worker loss', async () => {
  const start = await fixture(async () => {
    throw new Error('spawn failed with /private/path and provider text');
  }, [fauxAssistantMessage('ordinary task done')]);
  assert.equal(start.job.status, 'failed');
  assert.ok(start.codes.includes('REFLECTION_FAILED_START_UNKNOWN'), start.codes.join());

  const checkpoint = await fixture(
    async (startInfo, handle) => {
      const manager = SessionManager.inMemory(startInfo.project);
      await handle('checkpoint', snapshot(manager));
    },
    [fauxAssistantMessage('ordinary task done')],
  );
  assert.ok(checkpoint.codes.includes('REFLECTION_FAILED_CHECKPOINT_DENIED'), checkpoint.codes.join());

  const lost = await fixture(
    async (_start, handle) => {
      await model(handle);
      throw new ReflectionExecutorError('disconnected', 'Reflection Worker 已断开');
    },
    [fauxAssistantMessage('ordinary task done'), fauxAssistantMessage('partial')],
  );
  assert.ok(lost.codes.includes('REFLECTION_FAILED_WORKER_EXECUTOR'), lost.codes.join());
  assert.ok(lost.codes.includes('REFLECTION_EXECUTOR_DISCONNECTED'), lost.codes.join());
  for (const code of [...start.codes, ...checkpoint.codes, ...lost.codes]) assert.match(code, /^[A-Z_]+$/);
});

test('native components becoming unavailable after scheduling leave the Job waiting for a recheck', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reflection-missing-bundle-'));
  const native = new NativeReflectionExecutor(join(dir, 'Missing.app'));
  let ran = false;
  const { job, codes, availability } = await fixture(
    async (start, handle, signal) => {
      ran = true;
      await native.execute(start, handle, signal);
    },
    [fauxAssistantMessage('ordinary task done')],
  );
  await rm(dir, { recursive: true, force: true });
  assert.equal(ran, true);
  assert.equal(job.status, 'waiting_user');
  assert.ok(job.error);
  assert.equal(availability.available, false);
  assert.ok(codes.includes('REFLECTION_FAILED_START_UNAVAILABLE'), codes.join());
});

test('Reflection model requests wait while a foreground run streams outside Host dispatch', async () => {
  let foregroundStreaming: boolean | undefined;
  let streaming: () => boolean = () => false;
  await fixture(
    async (start, handle) => {
      const manager = SessionManager.inMemory(start.project, { id: start.sessionId });
      manager.appendMessage(await model(handle));
      await handle('checkpoint', snapshot(manager));
      await handle('complete', {});
    },
    [
      fauxAssistantMessage('ordinary task done'),
      async () => {
        await new Promise((r) => setTimeout(r, 400));
        return fauxAssistantMessage('extension-triggered turn done');
      },
      () => {
        foregroundStreaming = streaming();
        return fauxAssistantMessage('reflection done');
      },
    ],
    { delayMs: 60_000 },
    async (host, sessionId) => {
      await waitFor(() => host.reflection.jobs.list()[0]?.status === 'pending');
      // A Pi Extension can start a turn (sendUserMessage) without Host dispatch, so busy stays false.
      type PiSession = { isStreaming: boolean; prompt(text: string): Promise<void> };
      const session = (host as unknown as { active: Map<string, { session: PiSession }> }).active.get(
        sessionId,
      )?.session;
      assert.ok(session);
      streaming = () => session.isStreaming;
      const turn = session.prompt('extension turn');
      await waitFor(() => session.isStreaming);
      host.reflection.jobs.expedite(sessionId);
      host.reflection.wake();
      await turn;
      await waitFor(() => ['succeeded', 'failed'].includes(host.reflection.jobs.list()[0]?.status ?? ''));
    },
  );
  assert.equal(foregroundStreaming, false);
});
