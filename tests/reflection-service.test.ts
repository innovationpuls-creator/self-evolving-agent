import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { AgentService } from '../apps/host/runtime/agent.js';
import type { ReflectionExecutor } from '../apps/host/reflection/reflection-service.js';

/** Deterministic Pi/IPC contract test only. This executor is never a product sandbox fallback. */
class TestExecutor implements ReflectionExecutor {
  errors: unknown[] = [];
  runs = 0;
  async available() {
    return { available: true };
  }
  async execute(start: unknown, handle: (operation: string, input: unknown) => Promise<unknown>, signal: AbortSignal) {
    this.runs++;
    const cwd = await mkdtemp(join(tmpdir(), 'reflection-test-worker-'));
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', 'apps/host/reflection/worker.ts'], {
          env: { ...process.env, AGENT_REFLECTION_AGENT_DIR: cwd },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const lines = createInterface({ input: child.stdout });
        let finished = false;
        let error = '';
        child.stderr.on('data', (chunk) => {
          error += chunk.toString();
        });
        const abort = () => {
          child.kill('SIGKILL');
        };
        signal.addEventListener('abort', abort, { once: true });
        child.on('error', reject);
        child.on('close', (code) => {
          signal.removeEventListener('abort', abort);
          if (finished && code === 0) resolve();
          else reject(new Error(error || 'Test Worker failed'));
        });
        lines.on('line', (line) => {
          const m = JSON.parse(line);
          if (m.kind === 'finished') {
            finished = m.ok;
            child.stdin.end();
          }
          if (m.kind === 'request')
            void handle(m.operation, m.input).then(
              (result) =>
                child.stdin.write(
                  JSON.stringify({ kind: 'response', requestId: m.requestId, ok: true, result }) + '\n',
                ),
              (e) => {
                this.errors.push(e);
                child.stdin.write(
                  JSON.stringify({ kind: 'response', requestId: m.requestId, ok: false, error: String(e) }) + '\n',
                );
              },
            );
        });
        child.stdin.write(JSON.stringify(start) + '\n');
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
}
async function waitFor(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('stable encrypted marker schedules independent native Pi reflection, controlled history/Memory and suggestion writes, with no recursive run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reflection-product-test-')),
    key = randomBytes(32),
    executor = new TestExecutor();
  const host = new AgentService(join(dir, 'data'), key, { reflectionExecutor: executor, reflectionDelayMs: 0 });
  try {
    await host.init();
    const fake = fauxProvider({
      models: [{ id: 'test', contextWindow: 262144, maxTokens: 4096 }],
      tokensPerSecond: 100000,
    });
    host.runtime.registerNativeProvider(fake.provider);
    fake.setResponses([
      fauxAssistantMessage('ordinary task done'),
      fauxAssistantMessage(fauxToolCall('history_sessions', {}), { stopReason: 'toolUse' }),
      fauxAssistantMessage(
        fauxToolCall('memory_save', {
          knowledge: { title: 'Observation', content: 'A bounded observation', kind: 'experience', scope: 'project' },
          reason: 'Observed in task',
          evidence: [],
        }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage(
        fauxToolCall('suggestion_submit', {
          title: 'Idea',
          goal: 'Improve workflow',
          reason: 'Observed friction',
          value: 'Less effort',
          uncertainty: 'Needs discussion',
          action: 'Discuss first',
          evidence: [],
          priority: 'normal',
        }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage(
        fauxToolCall('reflection_save', {
          summary: 'Reviewed history',
          findings: [],
          uncertainties: ['One sample'],
          evidence: [],
        }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Review complete'),
    ]);
    const session = await host.create(dir, fake.provider.id, 'test');
    await host.prompt(session.id, 'ordinary task');
    await waitFor(() => host.reflection.jobs.list().some((j) => ['succeeded', 'failed'].includes(j.status)));
    assert.equal(host.reflection.jobs.list()[0]?.status, 'succeeded', JSON.stringify(executor.errors.map(String)));
    assert.deepEqual(executor.errors, []);
    const record = host.reflection.list(session.id)[0]!;
    assert.equal(record.summary, 'Reviewed history');
    assert.equal(record.changes.length, 2);
    assert.equal(host.memory.search({ actor: 'user', project: session.cwd }, { query: '' }).items.length, 1);
    assert.equal(host.evolution.list({ actor: 'user' }, {}).total, 1);
    assert.equal((await host.list()).length, 1, 'Reflection cannot enter ordinary session construction');
    await assert.rejects(host.viewSession(record.reflectionSessionId));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(host.reflection.jobs.list().length, 1);
    assert.equal(executor.runs, 1);
    const suggestion = host.evolution.list({ actor: 'user' }, {}).items[0]!;
    const adopted = await host.evolution.adopt(suggestion.id, suggestion.revision, host.ensureDiscussion.bind(host));
    const discussion = await host.viewSession(adopted.discussionSessionId!);
    assert.equal(discussion.purpose, 'discussion');
    assert.equal(discussion.busy, false);
    assert.equal(executor.runs, 1);
  } finally {
    await host.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('no findings is a legal result; restart scans committed markers idempotently and does not replay successful effects', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reflection-empty-')),
    key = randomBytes(32),
    executor = new TestExecutor();
  const data = join(dir, 'data');
  let host = new AgentService(data, key, { reflectionExecutor: executor, reflectionDelayMs: 0 });
  try {
    await host.init();
    const fake = fauxProvider({
      models: [{ id: 'test', contextWindow: 262144, maxTokens: 2048 }],
      tokensPerSecond: 100000,
    });
    host.runtime.registerNativeProvider(fake.provider);
    fake.setResponses([
      fauxAssistantMessage('done'),
      fauxAssistantMessage('No new findings; reviewed triggering task. Uncertainty remains.'),
    ]);
    const session = await host.create(dir, fake.provider.id, 'test');
    await host.prompt(session.id, 'task');
    await waitFor(() => host.reflection.jobs.list()[0]?.status === 'succeeded');
    assert.equal(host.reflection.list()[0]?.changes.length, 0);
    assert.equal(executor.runs, 1);
    await host.close();
    host = new AgentService(data, key, { reflectionExecutor: executor, reflectionDelayMs: 0 });
    await host.init();
    assert.equal(host.reflection.jobs.list().length, 1);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(executor.runs, 1);
  } finally {
    await host.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('unavailable sandbox keeps tasks visible, never invokes a privileged fallback and does not block ordinary Agent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reflection-unavailable-'));
  let called = false;
  const executor: ReflectionExecutor = {
    async available() {
      return { available: false, reason: 'Sandbox unavailable' };
    },
    async execute() {
      called = true;
    },
  };
  const host = new AgentService(join(dir, 'data'), randomBytes(32), {
    reflectionExecutor: executor,
    reflectionDelayMs: 0,
  });
  try {
    await host.init();
    const fake = fauxProvider({ models: [{ id: 'test' }], tokensPerSecond: 100000 });
    host.runtime.registerNativeProvider(fake.provider);
    fake.setResponses([fauxAssistantMessage('first'), fauxAssistantMessage('second')]);
    const session = await host.create(dir, fake.provider.id, 'test');
    await host.prompt(session.id, 'first');
    await waitFor(() => host.reflection.jobs.list()[0]?.status === 'waiting_user');
    await waitFor(async () => !(await host.viewSession(session.id)).busy);
    await host.prompt(session.id, 'second');
    await waitFor(async () => !(await host.viewSession(session.id)).busy);
    assert.equal(host.reflection.jobs.list()[0]?.sources.length, 2);
    assert.equal(called, false);
  } finally {
    await host.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('Host rejects forged IPC operations, foreign diagnostics and unauthorized ToolCalls without damaging ordinary sessions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reflection-denial-'));
  let checked = false;
  const executor: ReflectionExecutor = {
    async available() {
      return { available: true };
    },
    async execute(start, handle) {
      const run = start as { sessionId: string; traceId: string };
      await assert.rejects(handle('bash', { command: 'whoami' }));
      await assert.rejects(handle('tool', { name: 'memory_save', toolCallId: 'forged', args: {} }));
      await assert.rejects(
        handle('checkpoint', { header: { id: run.sessionId, cwd: '/another-project' }, entries: [], leafId: null }),
      );
      await assert.rejects(
        handle('diagnostic', { method: 'trace', args: [dir, { id: run.traceId, sessionId: 'foreign' }] }),
      );
      checked = true;
      throw new Error('Intentional rejected run');
    },
  };
  const host = new AgentService(join(dir, 'data'), randomBytes(32), {
    reflectionExecutor: executor,
    reflectionDelayMs: 0,
  });
  try {
    await host.init();
    const fake = fauxProvider({ models: [{ id: 'test' }], tokensPerSecond: 100000 });
    host.runtime.registerNativeProvider(fake.provider);
    fake.setResponses([fauxAssistantMessage('first'), fauxAssistantMessage('still works')]);
    const session = await host.create(dir, fake.provider.id, 'test');
    await host.prompt(session.id, 'task');
    await waitFor(() => host.reflection.jobs.list()[0]?.status === 'failed');
    assert.equal(checked, true);
    await host.prompt(session.id, 'retry normal Agent');
    await waitFor(async () => !(await host.viewSession(session.id)).busy);
    assert.equal(host.memory.search({ actor: 'user' }, { query: '' }).items.length, 0);
  } finally {
    await host.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failed first Reflection record does not strand the running claim or skip ordinary Host cleanup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reflection-save-fail-'));
  const executor = new TestExecutor();
  const host = new AgentService(join(dir, 'data'), randomBytes(32), {
    reflectionExecutor: executor,
    reflectionDelayMs: 0,
  });
  try {
    await host.init();
    const db = (host as unknown as { db: import('node:sqlite').DatabaseSync }).db;
    db.exec(
      "CREATE TRIGGER fail_reflection BEFORE INSERT ON reflections BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
    );
    const fake = fauxProvider({ models: [{ id: 'test' }], tokensPerSecond: 100000 });
    host.runtime.registerNativeProvider(fake.provider);
    fake.setResponses([fauxAssistantMessage('ordinary done')]);
    const session = await host.create(dir, fake.provider.id, 'test');
    await host.prompt(session.id, 'task');
    await waitFor(() => host.reflection.jobs.list()[0]?.status === 'failed');
    assert.equal(executor.runs, 0);
    assert.equal((await host.viewSession(session.id)).busy, false);
    db.exec('DROP TRIGGER fail_reflection');
  } finally {
    await assert.doesNotReject(host.close());
    await rm(dir, { recursive: true, force: true });
  }
});

test('model timeout cancels the dispatched request without damaging foreground Agent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reflection-timeout-'));
  let timedOut = false,
    providerAborted = false;
  const executor: ReflectionExecutor = {
    async available() {
      return { available: true };
    },
    async execute(_start, handle) {
      await assert.rejects(handle('model', { modelId: 'reflection-host-approved', context: { messages: [] } }));
      timedOut = true;
      throw new Error('timeout');
    },
  };
  const host = new AgentService(join(dir, 'data'), randomBytes(32), {
    reflectionExecutor: executor,
    reflectionDelayMs: 0,
    reflectionModelTimeoutMs: 20,
  });
  try {
    await host.init();
    const fake = fauxProvider({ models: [{ id: 'test' }], tokensPerSecond: 100000 });
    host.runtime.registerNativeProvider(fake.provider);
    fake.setResponses([fauxAssistantMessage('normal done'), fauxAssistantMessage('normal still works')]);
    host.runtime.completeSimple = async (_model, _context, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          'abort',
          () => {
            providerAborted = true;
            reject(new Error('cancelled'));
          },
          { once: true },
        );
      });
    const session = await host.create(dir, fake.provider.id, 'test');
    await host.prompt(session.id, 'task');
    await waitFor(() => host.reflection.jobs.list()[0]?.status === 'failed');
    assert.equal(timedOut, true);
    assert.equal(providerAborted, true);
    await host.prompt(session.id, 'normal again');
    await waitFor(async () => !(await host.viewSession(session.id)).busy);
  } finally {
    await host.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('background registration failure preserves ordinary saved Session and marker recovery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reflection-registration-fail-'));
  const key = randomBytes(32);
  const executor: ReflectionExecutor = {
    async available() {
      return { available: false, reason: 'fixture unavailable' };
    },
    async execute() {
      throw new Error('must not run');
    },
  };
  let host = new AgentService(join(dir, 'data'), key, { reflectionExecutor: executor });
  try {
    await host.init();
    const db = (host as unknown as { db: import('node:sqlite').DatabaseSync }).db;
    db.exec(
      "CREATE TRIGGER fail_registration BEFORE INSERT ON reflection_job_sources BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
    );
    const fake = fauxProvider({ models: [{ id: 'test' }], tokensPerSecond: 100000 });
    host.runtime.registerNativeProvider(fake.provider);
    fake.setResponses([fauxAssistantMessage('done'), fauxAssistantMessage('still works')]);
    const session = await host.create(dir, fake.provider.id, 'test');
    await host.prompt(session.id, 'task');
    await waitFor(async () => !(await host.viewSession(session.id)).busy);
    assert.equal((await host.viewSession(session.id)).error, undefined);
    db.exec('DROP TRIGGER fail_registration');
    await assert.doesNotReject(host.prompt(session.id, 'follow up'));
    await waitFor(async () => !(await host.viewSession(session.id)).busy);
    await host.close();
    host = new AgentService(join(dir, 'data'), key, { reflectionExecutor: executor });
    await host.init();
    assert.ok(host.reflection.jobs.list().some((job) => job.sources.length === 2));
  } finally {
    await assert.doesNotReject(host.close());
    await rm(dir, { recursive: true, force: true });
  }
});

test('Host close waits for an in-progress sandbox availability check before closing SQLite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reflection-close-probe-'));
  let entered = false;
  let release!: () => void;
  const probe = new Promise<void>((resolve) => {
    release = resolve;
  });
  const executor: ReflectionExecutor = {
    async available() {
      entered = true;
      await probe;
      return { available: false, reason: 'fixture' };
    },
    async execute() {
      throw new Error('must not execute');
    },
  };
  const host = new AgentService(join(dir, 'data'), randomBytes(32), { reflectionExecutor: executor });
  try {
    await host.init();
    host.reflection.wake();
    await waitFor(() => entered);
    let closed = false;
    const closing = host.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(closed, false);
    release();
    await assert.doesNotReject(closing);
  } finally {
    release();
    await rm(dir, { recursive: true, force: true });
  }
});
