import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSessionEvent,
} from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, fauxToolCall, InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { Type } from 'typebox';
import {
  DiagnosticError,
  DiagnosticRecorder,
  DiagnosticService,
  diagnosticUsage,
  type DiagnosticContext,
  type DiagnosticTrace,
} from '../apps/host/diagnostics/diagnostics.js';
import { diagnosticToolNames } from '../apps/host/diagnostics/diagnostic-tools.js';
import type { AgentService } from '../apps/host/runtime/agent.js';
import { startHost } from '../apps/host/transport/server.js';
import { EncryptedStore, restore, SensitiveData, snapshot, type Snapshot } from '../apps/host/storage/storage.js';

const project = '/__diagnostics_in_memory_probe__';
const user = { actor: 'user' } as const;
const agent = { actor: 'agent', project } as const;

function indexFixture() {
  const db = new DatabaseSync(':memory:');
  const sensitive = new SensitiveData();
  const service = new DiagnosticService(db, sensitive, () => {});
  service.init();
  return {
    db,
    sensitive,
    service,
    close() {
      service.close();
      db.close();
    },
  };
}

function trace(sessionId = randomUUID(), overrides: Partial<DiagnosticTrace> = {}): DiagnosticTrace {
  return {
    id: randomUUID(),
    sessionId,
    started: Date.now(),
    ended: null,
    status: 'running',
    startLeafId: null,
    endLeafId: null,
    userEntryId: null,
    toolCount: 0,
    errorCount: 0,
    incomplete: false,
    data: {},
    ...overrides,
  };
}

function sqliteMetadata(db: DatabaseSync): string {
  return ['diagnostic_traces', 'diagnostic_turns', 'diagnostic_calls', 'diagnostic_events']
    .flatMap((table) =>
      db
        .prepare(`SELECT data FROM ${table}`)
        .all()
        .map((row) => String(row.data)),
    )
    .join('\n');
}

async function nativeFixture(options: { retry?: boolean; autoCompact?: boolean } = {}) {
  const index = indexFixture();
  const settings = SettingsManager.inMemory(
    {
      compaction: {
        enabled: options.autoCompact ?? false,
        keepRecentTokens: options.autoCompact ? 128 : 10,
        reserveTokens: options.autoCompact ? 4096 : 256,
      },
      retry: { enabled: options.retry ?? false, maxRetries: 1, baseDelayMs: 1, maxAgentDelayMs: 1 },
      defaultTools: ['outer', 'middle', 'leaf', 'memory_get'],
    },
    { projectTrusted: false },
  );
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  const fake = fauxProvider({
    models: [{ id: 'diagnostic-native', contextWindow: options.autoCompact ? 8192 : 262144, maxTokens: 256 }],
    tokensPerSecond: 100000,
  });
  runtime.registerNativeProvider(fake.provider);
  const memoryId = randomUUID();
  const sessionId = randomUUID();
  const output = `native-large-result-${randomUUID()}\n${'诊断输出'.repeat(10000)}`;
  const loader = new DefaultResourceLoader({
    cwd: project,
    agentDir: project,
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noContextFiles: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: 'In-memory native diagnostic contract test.',
    // Trusted inline tools are scoped to this isolated SDK Session, never product Skill loading.
    extensionFactories: [
      (pi) => {
        pi.registerTool({
          name: 'leaf',
          label: 'Leaf',
          description: 'Return an in-memory result.',
          parameters: Type.Object({ fail: Type.Boolean() }),
          async execute(_id, params) {
            return {
              content: [{ type: 'text', text: params.fail ? 'expected tool failure' : output }],
              details: {},
              isError: params.fail,
            };
          },
        });
        pi.registerTool({
          name: 'middle',
          label: 'Middle',
          description: 'Observe a second level native nested call.',
          parameters: Type.Object({}),
          async execute(_id, _params, _signal, _update, ctx) {
            await ctx.executeTool('leaf', { fail: false });
            return { content: [{ type: 'text', text: 'middle complete' }], details: {} };
          },
        });
        pi.registerTool({
          name: 'outer',
          label: 'Outer',
          description: 'Observe native nested calls.',
          parameters: Type.Object({}),
          async execute(_id, _params, _signal, _update, ctx) {
            await ctx.executeTool('middle', {});
            await ctx.executeTool('leaf', { fail: true });
            return { content: [{ type: 'text', text: 'outer complete' }], details: {} };
          },
        });
        pi.registerTool({
          name: 'memory_get',
          label: 'Memory provenance fixture',
          description: 'Return typed Memory identity without product writes.',
          parameters: Type.Object({}),
          async execute() {
            return {
              details: {},
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    id: memoryId,
                    revision: 3,
                    title: 'memory-body-not-for-diagnostic-index',
                    content: 'complete memory body must remain in its own store',
                    sources: [{ sessionId, entryId: 'memory-source-entry' }],
                  }),
                },
              ],
            };
          },
        });
      },
    ],
  });
  await loader.reload();
  const manager = SessionManager.inMemory(project, { id: sessionId });
  const { session } = await createAgentSession({
    cwd: project,
    agentDir: project,
    modelRuntime: runtime,
    model: fake.getModel(),
    settingsManager: settings,
    resourceLoader: loader,
    sessionManager: manager,
  });
  await session.bindExtensions({
    onError: (error) => assert.fail(`Unexpected trusted fixture Extension error: ${error.error}`),
  });
  const recorder = new DiagnosticRecorder(index.service, sessionId, project, manager);
  const observed: AgentSessionEvent[] = [];
  session.subscribe((event) => {
    recorder.observe(event);
    if (event.type !== 'message_update' && event.type !== 'tool_execution_update') observed.push(event);
  });
  return {
    ...index,
    session,
    manager,
    recorder,
    fake,
    observed,
    sessionId,
    memoryId,
    output,
    async run() {
      recorder.start();
      const id = recorder.traceId;
      assert.ok(id);
      recorder.loaded({
        loaded: [{ skillId: 'fixture-skill', version: 'v3', digest: 'snapshot-digest', path: `${project}/SKILL.md` }],
        tools: new Map([['leaf', { skillId: 'fixture-skill', version: 'v3', digest: 'snapshot-digest' }]]),
      });
      fake.setResponses([
        fauxAssistantMessage(fauxToolCall('outer', {}, { id: 'outer-call' }), { stopReason: 'toolUse' }),
        fauxAssistantMessage(fauxToolCall('leaf', { fail: false }, { id: 'repeat-one' }), { stopReason: 'toolUse' }),
        fauxAssistantMessage(fauxToolCall('leaf', { fail: false }, { id: 'repeat-two' }), { stopReason: 'toolUse' }),
        fauxAssistantMessage(fauxToolCall('memory_get', {}, { id: 'memory-call' }), { stopReason: 'toolUse' }),
        fauxAssistantMessage('Model stopped; task correctness is not asserted by this message.'),
      ]);
      await session.prompt('native-prompt-sentinel-not-for-diagnostic-index');
      recorder.finish('ended');
      return index.service.get(agent, id);
    },
    close() {
      session.dispose();
      index.close();
    },
  };
}

test('diagnostic migration is repeatable and unknown versions remain unavailable without schema replacement', () => {
  const f = indexFixture();
  try {
    assert.equal(f.service.health.available, true);
    f.service.init();
    assert.equal(f.service.health.available, true);
    assert.equal(f.db.prepare("SELECT version FROM product_migrations WHERE name='diagnostic'").get()?.version, 1);
  } finally {
    f.close();
  }
  const db = new DatabaseSync(':memory:');
  db.exec(
    "CREATE TABLE product_migrations(name TEXT PRIMARY KEY,version INTEGER NOT NULL); INSERT INTO product_migrations VALUES('diagnostic',99)",
  );
  const service = new DiagnosticService(db, new SensitiveData(), () => {});
  try {
    assert.doesNotThrow(() => service.init());
    assert.equal(service.health.available, false);
    assert.equal(db.prepare("SELECT version FROM product_migrations WHERE name='diagnostic'").get()?.version, 99);
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='diagnostic_traces'").get()?.n, 0);
    assert.throws(() => service.search(user, {}), DiagnosticError);
  } finally {
    service.close();
    db.close();
  }
});

test('normalized zero usage does not assert provider reporting, zero cache use, or a confirmed free bill', () => {
  const zero = fauxAssistantMessage('zero').usage;
  const usage = diagnosticUsage(zero);
  assert.ok(usage);
  assert.equal(usage.providerReported, 'unknown');
  assert.equal(usage.source, 'pi_normalized');
  assert.equal(usage.cacheRead, 0);
  assert.deepEqual(usage.cost, {
    source: 'pi_catalog_calculation',
    billed: null,
    total: 0,
    availability: 'unknown',
  });
  assert.equal(diagnosticUsage(undefined), null);
  const reported = diagnosticUsage({ ...zero, input: 37, totalTokens: 37, cost: { ...zero.cost, total: 0.3 } });
  assert.equal(reported?.input, 37);
  assert.equal(reported?.providerReported, 'unknown');
  assert.deepEqual(reported?.cost, {
    source: 'pi_catalog_calculation',
    billed: null,
    total: 0.3,
    availability: 'catalog_estimate',
  });
});

test('cross-session queries preserve project access, filters, literal Tool names and pagination', () => {
  const f = indexFixture();
  try {
    const a = trace(undefined, { started: 100, status: 'ended', userEntryId: 'user-a' });
    const b = trace(undefined, { started: 200, status: 'failed', errorCount: 1, userEntryId: 'user-b' });
    const hidden = trace(undefined, { started: 300, status: 'ended' });
    f.service.trace(project, a);
    f.service.trace(project, b);
    f.service.trace('/different-project', hidden);
    f.service.call(b, {
      id: randomUUID(),
      toolCallId: 'failed-call',
      parentToolCallId: null,
      toolName: 'read',
      sequence: 1,
      started: 200,
      ended: 201,
      status: 'error',
      durationMs: 1,
      outputBytes: 0,
      assistantEntryId: 'assistant-b',
      resultEntryId: 'result-b',
      data: {},
    });
    assert.equal(f.service.search(user, {}).total, 3);
    assert.equal(f.service.search(agent, {}).total, 2);
    assert.deepEqual(
      f.service.search(agent, { limit: 1, offset: 1 }).items.map((item) => item.id),
      [a.id],
    );
    assert.deepEqual(
      f.service.search(agent, { toolName: 'read', hasError: 'true', from: 150, to: 250 }).items.map((item) => item.id),
      [b.id],
    );
    assert.equal(f.service.search(agent, { toolName: "read' OR '1'='1" }).total, 0);
    assert.equal(f.service.search(agent, { sessionId: a.sessionId }).total, 1);
    assert.equal(f.service.search(agent, { entryId: 'result-b' }).items[0]?.id, b.id);
    assert.equal(f.service.search(agent, { sessionId: a.sessionId, branchLeafId: 'selected' }, ['user-a']).total, 1);
    assert.throws(() => f.service.search(agent, { branchLeafId: 'selected' }), DiagnosticError);
    assert.throws(() => f.service.get(agent, hidden.id), { code: 'DIAGNOSTIC_NOT_FOUND' });
    assert.throws(() => f.service.search({ actor: 'agent' }, {}), { code: 'DIAGNOSTIC_NOT_FOUND' });
    assert.throws(() => f.service.search(agent, { limit: 101 }));
    assert.throws(() => f.service.search(agent, { unexpected: true }));
  } finally {
    f.close();
  }
});

test('native multilevel nested calls, repeated tools, durations, Skill and Memory references remain metadata only', async () => {
  const f = await nativeFixture();
  try {
    const detail = await f.run();
    assert.equal(detail.trace.status, 'ended');
    assert.equal(detail.trace.incomplete, false);
    assert.equal(detail.trace.toolCount, 7);
    assert.equal(detail.trace.errorCount, 1);
    assert.equal(detail.totals.turns, 5);
    assert.equal(detail.totals.calls, 7);
    assert.equal(detail.calls.find((call) => call.toolCallId === 'outer-call/1')?.parentToolCallId, 'outer-call');
    const nested = detail.calls.find((call) => call.toolCallId === 'outer-call/1/1');
    assert.ok(nested);
    assert.equal(nested.parentToolCallId, 'outer-call/1');
    assert.equal(nested.status, 'ok');
    assert.equal(nested.data.resultAvailability, 'not_persisted_native');
    assert.ok(nested.resultEntryId);
    const outer = detail.calls.find((call) => call.toolCallId === 'outer-call');
    assert.equal(nested.resultEntryId, outer?.resultEntryId);
    assert.equal(detail.calls.find((call) => call.toolCallId === 'outer-call/2')?.status, 'error');
    assert.equal(outer?.status, 'ok', 'a handled child failure does not make the outer result fail');
    const direct = detail.calls.find((call) => call.toolCallId === 'repeat-one');
    assert.ok(direct?.resultEntryId);
    assert.equal(direct.outputBytes, Buffer.byteLength(f.output));
    assert.ok(direct.durationMs !== null && direct.durationMs >= 0);
    assert.deepEqual(direct.data.skill, { skillId: 'fixture-skill', version: 'v3', digest: 'snapshot-digest' });
    const original = f.manager.getEntry(direct.resultEntryId);
    assert.equal(original?.type, 'message');
    if (original?.type === 'message' && original.message.role === 'toolResult') {
      assert.equal(original.message.toolCallId, direct.toolCallId);
      assert.equal(original.message.content.find((block) => block.type === 'text')?.text, f.output);
    } else assert.fail('result reference must point to its native tool result');
    assert.deepEqual(detail.calls.find((call) => call.toolName === 'memory_get')?.data.memory, {
      references: [
        { id: f.memoryId, revision: 3, sources: [{ sessionId: f.sessionId, entryId: 'memory-source-entry' }] },
      ],
      complete: true,
    });
    assert.equal(detail.sameToolOccurrences.find((row) => row.name === 'leaf')?.count, 4);
    assert.ok(detail.turns.every((turn) => turn.assistantEntryId && turn.usage?.source === 'pi_normalized'));
    assert.deepEqual(
      detail.turns.map((turn) => turn.ordinal),
      [1, 2, 3, 4, 5],
    );
    assert.ok(detail.calls.every((call, index) => call.sequence === index + 1));
    const metadata = sqliteMetadata(f.db);
    for (const text of [
      'native-prompt-sentinel',
      'native-large-result-',
      'memory-body-not-for',
      'complete memory body',
      'expected tool failure',
    ]) {
      assert.ok(!metadata.includes(text), text);
    }
    assert.ok(!metadata.includes('"arguments"'));
    assert.ok(!metadata.includes('"content"'));
    assert.ok(!metadata.includes('"thinking"'));
    assert.ok(f.observed.some((event) => event.type === 'agent_settled'));
    assert.equal(f.observed.filter((event) => event.type === 'entry_appended').length, 0);
  } finally {
    f.close();
  }
});

test('manual native compaction stays session-level and preserves pre-compaction and historical branch evidence', async () => {
  const f = await nativeFixture();
  try {
    const detail = await f.run();
    const oldEntries = f.manager.getEntries().map((entry) => entry.id);
    const beforeLeaf = f.manager.getLeafId();
    f.fake.setResponses([fauxAssistantMessage('Compact summary of native diagnostic task.')]);
    await f.session.compact();
    const events = f.service.sessionEvents(agent, f.sessionId, project);
    const compact = events.find((event) => event.kind === 'compaction');
    assert.ok(compact);
    assert.equal(compact.traceId, null);
    assert.equal(compact.data.reason, 'manual');
    assert.equal(compact.data.beforeLeafId, beforeLeaf);
    assert.equal(typeof compact.data.tokensBefore, 'number');
    assert.equal(typeof compact.data.estimatedTokensAfter, 'number');
    assert.equal(compact.data.aborted, false);
    assert.ok(compact.entryId);
    assert.equal(f.manager.getEntry(compact.entryId)?.type, 'compaction');
    assert.equal(f.service.get(agent, detail.trace.id).events.filter((event) => event.kind === 'compaction').length, 0);
    assert.ok(oldEntries.every((id) => f.manager.getEntry(id)));
    assert.ok(detail.trace.userEntryId);
    await f.session.navigateTree(detail.trace.userEntryId, { summarize: false });
    const userParent = f.manager.getEntry(detail.trace.userEntryId)?.parentId;
    assert.equal(f.manager.getLeafId(), userParent);
    assert.ok(detail.calls.every((call) => !call.resultEntryId || f.manager.getEntry(call.resultEntryId)));
    const recovered = restore(snapshot(f.manager));
    assert.equal(recovered.getLeafId(), userParent);
    assert.ok(recovered.getEntry(compact.entryId));
    assert.equal(f.service.search(agent, {}).items[0]?.status, 'ended');
  } finally {
    f.close();
  }
});

test('native automatic retry remains in one task Trace and preserves omitted failed-attempt evidence', async () => {
  const f = await nativeFixture({ retry: true });
  try {
    f.recorder.start();
    const id = f.recorder.traceId;
    assert.ok(id);
    f.fake.setResponses([
      fauxAssistantMessage('', {
        stopReason: 'error',
        errorMessage: '503 temporarily unavailable retry-error-body-sentinel',
      }),
      fauxAssistantMessage('The retry returned normally.'),
    ]);
    await f.session.prompt('Retry an observable transient model failure.');
    f.recorder.finish('ended');
    const detail = f.service.get(agent, id);
    assert.equal(f.service.search(agent, {}).total, 1);
    assert.equal(f.fake.state.callCount, 2);
    assert.equal(detail.trace.status, 'ended');
    assert.equal(detail.trace.errorCount, 1);
    assert.equal(detail.turns.length, 2);
    assert.deepEqual(
      detail.turns.map((turn) => turn.ordinal),
      [1, 2],
    );
    const retry = detail.events.find((event) => event.kind === 'retry_start');
    assert.ok(retry);
    assert.equal(retry.data.attempt, 1);
    assert.equal(retry.data.maxAttempts, 1);
    assert.equal(typeof retry.data.delayMs, 'number');
    assert.ok(detail.events.some((event) => event.kind === 'retry_end' && event.data.success === true));
    const failed = f.manager
      .getEntries()
      .find(
        (entry) =>
          entry.type === 'message' && entry.message.role === 'assistant' && entry.message.stopReason === 'error',
      );
    assert.ok(failed);
    assert.ok(detail.turns.some((turn) => turn.assistantEntryId === failed.id));
    assert.ok(f.manager.getEntries().some((entry) => entry.type === 'context_edit' && entry.targetId === failed.id));
    assert.ok(!sqliteMetadata(f.db).includes('retry-error-body-sentinel'));
    assert.equal(f.observed.filter((event) => event.type === 'agent_settled').length, 1);
  } finally {
    f.close();
  }
});

test('native threshold compaction is associated with its active Trace and keeps pre-compaction Entries', async () => {
  const f = await nativeFixture({ autoCompact: true });
  try {
    f.recorder.start();
    const id = f.recorder.traceId;
    assert.ok(id);
    f.fake.setResponses([
      fauxAssistantMessage('The model finished the user response. '.repeat(35)),
      fauxAssistantMessage('Native automatic summary of the long user request.'),
    ]);
    await f.session.prompt('automatic context history '.repeat(300));
    f.recorder.finish('ended');
    const detail = f.service.get(agent, id);
    const compact = detail.events.find((event) => event.kind === 'compaction');
    assert.ok(
      compact,
      JSON.stringify({
        events: f.observed.map((event) => event.type),
        turns: detail.turns,
        enabled: f.session.autoCompactionEnabled,
        window: f.session.model?.contextWindow,
      }),
    );
    assert.equal(compact.traceId, id);
    assert.equal(compact.data.reason, 'threshold');
    assert.equal(compact.data.failed, false);
    assert.equal(compact.data.aborted, false);
    assert.ok(compact.entryId);
    assert.equal(f.manager.getEntry(compact.entryId)?.type, 'compaction');
    assert.equal(f.fake.state.callCount, 2, 'one response and one native summarization call');
    assert.ok(detail.trace.userEntryId && f.manager.getEntry(detail.trace.userEntryId));
    assert.ok(detail.turns.every((turn) => turn.assistantEntryId && f.manager.getEntry(turn.assistantEntryId)));
    assert.equal(
      f.service.sessionEvents(agent, f.sessionId, project).filter((event) => event.kind === 'compaction').length,
      0,
    );
    assert.equal(f.observed.filter((event) => event.type === 'agent_settled').length, 1);
  } finally {
    f.close();
  }
});

test('collection SQL failures leave native execution working, mark a gap and recover on a later query', async () => {
  const f = await nativeFixture();
  try {
    f.db.exec(
      "CREATE TRIGGER reject_diagnostic_calls BEFORE INSERT ON diagnostic_calls BEGIN SELECT RAISE(ABORT,'diagnostic injection'); END",
    );
    const detail = await f.run();
    assert.ok(f.session.messages.some((message) => message.role === 'assistant' && message.stopReason === 'stop'));
    assert.equal(detail.trace.status, 'ended');
    assert.equal(detail.trace.incomplete, true);
    assert.ok(Number(detail.trace.data.gaps) > 0);
    assert.ok(f.service.health.dropped > 0);
    f.db.exec('DROP TRIGGER reject_diagnostic_calls');
    f.fake.setResponses([fauxAssistantMessage('Execution continues after collection failure.')]);
    f.recorder.start();
    const id = f.recorder.traceId;
    assert.ok(id);
    await f.session.prompt('continue after metadata failure');
    f.recorder.finish('ended');
    assert.equal(f.service.get(agent, id).trace.incomplete, false);
  } finally {
    f.close();
  }
});

test('the metadata queue is bounded at 1000 and excess writes produce visible gaps', () => {
  const f = indexFixture();
  try {
    const task = trace();
    f.service.trace(project, task);
    f.service.flush();
    for (let i = 0; i < 1100; i++) {
      f.service.event(
        task.sessionId,
        { id: randomUUID(), traceId: task.id, kind: 'retry', at: i, entryId: null, data: {} },
        task,
      );
    }
    assert.equal(f.service.health.dropped, 100);
    assert.equal(task.incomplete, true);
    assert.equal(task.data.gaps, 100);
    f.service.flush();
    f.service.trace(project, task);
    assert.equal(f.service.get(agent, task.id).totals.events, 1000);
    assert.equal(f.service.get(agent, task.id).trace.incomplete, true);
  } finally {
    f.close();
  }
});

test('restart reconciliation recovers only marked native tasks and is idempotent', async () => {
  const f = await nativeFixture();
  const recovered = indexFixture();
  try {
    const detail = await f.run();
    const saved = snapshot(f.manager);
    recovered.service.reconcile(f.sessionId, project, saved, false);
    const first = recovered.service.get(agent, detail.trace.id);
    assert.equal(first.trace.status, 'ended');
    assert.equal(first.trace.incomplete, true);
    assert.equal(first.trace.data.recovered, true);
    assert.equal(first.trace.errorCount, 1);
    assert.equal(first.totals.turns, 5);
    assert.equal(first.totals.calls, 7);
    const direct = first.calls.find((call) => call.toolCallId === 'repeat-one');
    assert.ok(direct?.resultEntryId);
    assert.equal(direct.started, null, 'recovery must not invent event timestamps');
    assert.equal(f.manager.getEntry(direct.resultEntryId)?.type, 'message');
    const nested = first.calls.find((call) => call.toolCallId === 'outer-call/1/1');
    assert.equal(nested?.data.resultAvailability, 'not_persisted_native');
    assert.equal(nested?.outputBytes, null, 'native nested summaries do not preserve result sizes');
    assert.equal(nested?.parentToolCallId, null, 'a native summary cannot reconstruct an unobserved immediate parent');
    assert.equal(nested?.data.summaryParentToolCallId, 'outer-call');
    assert.equal(nested?.data.parentAvailability, 'not_recorded_in_native_summary');
    recovered.service.reconcile(f.sessionId, project, saved, false);
    assert.deepEqual(recovered.service.get(agent, detail.trace.id).totals, first.totals);
    const legacy = SessionManager.inMemory(project, { id: randomUUID() });
    legacy.appendMessage({ role: 'user', content: 'legacy prompt', timestamp: Date.now() });
    legacy.appendMessage(fauxAssistantMessage('legacy answer'));
    recovered.service.reconcile(legacy.getSessionId(), project, snapshot(legacy), false);
    assert.equal(recovered.service.search(agent, { sessionId: legacy.getSessionId() }).total, 0);
  } finally {
    recovered.close();
    f.close();
  }
});

test('an unfinished native marker becomes interrupted without replay and previous checkpoint recovery is explicit', () => {
  const f = indexFixture();
  try {
    const manager = SessionManager.inMemory(project, { id: randomUUID() });
    const recorder = new DiagnosticRecorder(f.service, manager.getSessionId(), project, manager);
    recorder.start();
    const id = recorder.traceId;
    assert.ok(id);
    manager.appendMessage({ role: 'user', content: 'unfinished task', timestamp: Date.now() });
    recorder.sync();
    const saved = snapshot(manager);
    f.service.reconcile(manager.getSessionId(), project, saved, true);
    const recovered = f.service.get(agent, id);
    assert.equal(recovered.trace.status, 'interrupted');
    assert.equal(recovered.trace.incomplete, true);
    assert.equal(recovered.trace.ended, null);
    assert.equal(recovered.calls.length, 0);
    assert.equal(
      manager.getEntries().length,
      saved.entries.length,
      'reconciliation does not append or replay native work',
    );
    f.service.flush();
    assert.equal(
      f.db.prepare("SELECT code FROM host_system_logs WHERE code='CHECKPOINT_PREVIOUS'").get()?.code,
      'CHECKPOINT_PREVIOUS',
    );
  } finally {
    f.close();
  }
});

test('system logging accepts fixed codes and bounded correlation IDs, with finite age and count retention', () => {
  const f = indexFixture();
  try {
    const old = Date.now() - 31 * 86400000;
    f.db.prepare('INSERT INTO host_system_logs(at,level,code) VALUES(?,?,?)').run(old, 'error', 'OLD_FAILURE');
    const insert = f.db.prepare('INSERT INTO host_system_logs(at,level,code) VALUES(?,?,?)');
    for (let i = 0; i < 5100; i++) insert.run(Date.now(), 'info', 'RECENT_FAILURE');
    f.service.system('invalid free text password=never-store', 'error');
    f.service.system('TOO_LONG', 'error', 'x'.repeat(257));
    for (let i = 0; i < 100; i++) f.service.system('HOST_FAILURE', 'warn', 'session', 'trace', 'call');
    f.service.flush();
    assert.equal(f.db.prepare('SELECT count(*) n FROM host_system_logs').get()?.n, 5000);
    assert.equal(f.db.prepare("SELECT count(*) n FROM host_system_logs WHERE code='OLD_FAILURE'").get()?.n, 0);
    assert.equal(f.db.prepare("SELECT count(*) n FROM host_system_logs WHERE code='TOO_LONG'").get()?.n, 0);
    assert.equal(f.db.prepare("SELECT count(*) n FROM host_system_logs WHERE code='HOST_FAILURE'").get()?.n, 100);
  } finally {
    f.close();
  }
});

test('metadata protection failures reject unverified data while preserving the native transcript', () => {
  const f = indexFixture();
  try {
    const task = trace();
    f.sensitive.copy = () => {
      throw new Error('mandatory protection check unavailable');
    };
    assert.doesNotThrow(() => f.service.trace(project, task));
    f.service.flush();
    assert.equal(f.db.prepare('SELECT count(*) n FROM diagnostic_traces').get()?.n, 0);
    assert.equal(task.incomplete, true);
    assert.equal(f.service.health.dropped, 1);
  } finally {
    f.close();
  }
});

type HostState = Awaited<ReturnType<AgentService['viewSession']>>;
type HostSearch = Awaited<ReturnType<AgentService['diagnosticSearch']>>;
type HostDetail = ReturnType<DiagnosticService['get']>;
type HostEvidence = Awaited<ReturnType<AgentService['diagnosticEvidence']>>;
interface SavedHostSession {
  session: Snapshot;
  record: { id: string; cwd: string; provider: string; model: string; title: string; updated: number };
}

function toolResult(state: HostState, toolName: string): Record<string, unknown> {
  const message = state.messages.findLast((message) => message.role === 'toolResult' && message.toolName === toolName);
  assert.ok(message && message.role === 'toolResult', `missing native result for ${toolName}`);
  const content = message.content.find((block) => block.type === 'text');
  assert.ok(content && content.type === 'text');
  const value: unknown = JSON.parse(content.text);
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

async function hostFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'diagnostics-host-'));
  const other = join(dir, 'other');
  await mkdir(other);
  const dataDir = join(dir, 'data'),
    key = randomBytes(32),
    token = randomBytes(32).toString('hex');
  let host = await startHost({ dataDir, key, token });
  const fake = fauxProvider({
    models: [{ id: 'diagnostic-host', contextWindow: 262144, maxTokens: 1024 }],
    tokensPerSecond: 100000,
  });
  host.service.runtime.registerNativeProvider(fake.provider);
  const request = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${host.origin}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const json = async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    const response = await request(path, method, body);
    assert.ok(response.ok, `${path}: ${await response.clone().text()}`);
    return response.json();
  };
  const settle = async (id: string) => {
    const deadline = Date.now() + 10000;
    let state = await host.service.viewSession(id);
    while (state.busy && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      state = await host.service.viewSession(id);
    }
    assert.equal(state.busy, false, 'native prompt did not settle');
    return state;
  };
  return {
    dir,
    other,
    dataDir,
    key,
    token,
    fake,
    request,
    json,
    settle,
    host: () => host,
    create: (cwd = dir) => host.service.create(cwd, fake.provider.id, 'diagnostic-host'),
    async run(
      id: string,
      responses: Parameters<typeof fake.setResponses>[0],
      prompt = 'Diagnostic Host integration task',
    ) {
      fake.setResponses(responses);
      await json(`/sessions/${id}/prompt`, 'POST', { text: prompt });
      return settle(id);
    },
    async restart() {
      await host.close();
      host = await startHost({ dataDir, key, token });
      host.service.runtime.registerNativeProvider(fake.provider);
    },
    async close() {
      await host.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('Host HTTP and all three native diagnostic tools query another Session and read exact protected evidence', async () => {
  const f = await hostFixture();
  try {
    const source = await f.create(),
      reader = await f.create(),
      outside = await f.create(f.other);
    const payload = `host-large-result-${randomUUID()}\n${'可回溯的原始结果'.repeat(1500)}`;
    await writeFile(join(f.dir, 'large.txt'), payload);
    const sourceState = await f.run(source.id, [
      fauxAssistantMessage(fauxToolCall('read', { path: 'large.txt' }, { id: 'host-read-one' }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage(fauxToolCall('read', { path: 'missing.txt' }, { id: 'host-read-error' }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage(fauxToolCall('read', { path: 'large.txt' }, { id: 'host-read-two' }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('Native execution has ended.'),
    ]);
    assert.equal(sourceState.error, undefined);
    const search = await f.json<HostSearch>(`/diagnostics?sessionId=${source.id}&toolName=read&hasError=true`);
    assert.equal(search.total, 1);
    const task = search.items[0];
    assert.ok(task);
    assert.equal(task.status, 'ended');
    assert.equal(task.toolCount, 3);
    assert.equal(task.errorCount, 1);
    const detail = await f.json<HostDetail>(`/diagnostics/${task.id}`);
    assert.equal(detail.turns.length, 4);
    assert.equal(detail.sameToolOccurrences[0]?.count, 3);
    const call = detail.calls.find((call) => call.toolCallId === 'host-read-one');
    assert.ok(call?.resultEntryId);
    assert.ok(call.outputBytes !== null && call.outputBytes > 20000);
    assert.equal(detail.calls.find((call) => call.toolCallId === 'host-read-error')?.status, 'error');
    const evidencePath = `/diagnostics/evidence?sessionId=${source.id}&entryId=${call.resultEntryId}`;
    let evidence = await f.json<HostEvidence>(`${evidencePath}&limit=4096`);
    assert.equal(evidence.available, true);
    assert.equal(evidence.source, 'checkpoint');
    assert.equal(evidence.truncated, true);
    assert.ok('content' in evidence);
    let text = evidence.content;
    while ('nextOffset' in evidence && evidence.nextOffset !== undefined) {
      evidence = await f.json<HostEvidence>(`${evidencePath}&limit=4096&offset=${evidence.nextOffset}`);
      assert.ok('content' in evidence);
      text += evidence.content;
    }
    const raw: unknown = JSON.parse(text);
    const saved = await f.host().service.store.read<SavedHostSession>(`sessions/${source.id}.enc`);
    assert.ok(saved);
    assert.deepEqual(
      raw,
      f.host().service.sensitive.copy(saved.session.entries.find((entry) => entry.id === call.resultEntryId)),
    );
    const state = await f.run(reader.id, [
      (context) => {
        for (const name of diagnosticToolNames) assert.ok(JSON.stringify(context).includes(`"name":"${name}"`));
        return fauxAssistantMessage(fauxToolCall('diagnostic_search', { sessionId: source.id }), {
          stopReason: 'toolUse',
        });
      },
      fauxAssistantMessage(fauxToolCall('diagnostic_get', { traceId: task.id }), { stopReason: 'toolUse' }),
      fauxAssistantMessage(
        fauxToolCall('diagnostic_evidence', { sessionId: source.id, entryId: call.resultEntryId, limit: 32768 }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('All requested native diagnostic results were received.'),
    ]);
    assert.equal(state.error, undefined);
    assert.equal(toolResult(state, 'diagnostic_search').total, 1);
    assert.deepEqual(toolResult(state, 'diagnostic_get').trace, detail.trace);
    assert.equal(toolResult(state, 'diagnostic_evidence').available, true);
    assert.ok(String(toolResult(state, 'diagnostic_evidence').content).includes('host-large-result-'));
    const denied = await f.run(outside.id, [
      fauxAssistantMessage(fauxToolCall('diagnostic_search', { sessionId: source.id }), { stopReason: 'toolUse' }),
      fauxAssistantMessage(fauxToolCall('diagnostic_get', { traceId: task.id }), { stopReason: 'toolUse' }),
      fauxAssistantMessage(fauxToolCall('diagnostic_evidence', { sessionId: source.id, entryId: call.resultEntryId }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('Denied results observed.'),
    ]);
    assert.equal(toolResult(denied, 'diagnostic_search').total, 0);
    assert.deepEqual(toolResult(denied, 'diagnostic_search').items, []);
    assert.deepEqual(toolResult(denied, 'diagnostic_search').sessionEvents, []);
    for (const name of ['diagnostic_get', 'diagnostic_evidence'])
      assert.equal(toolResult(denied, name).code, 'DIAGNOSTIC_NOT_FOUND');
    const outsideQuery = await f.host().service.diagnosticSearch({ actor: 'agent', project: outside.cwd }, {});
    assert.ok(outsideQuery.items.every((item) => item.sessionId === outside.id));
    assert.ok(!JSON.stringify(denied).includes('host-large-result-'));
    assert.equal((await fetch(`${f.host().origin}/api/diagnostics`)).status, 401);
    assert.equal((await fetch(`${f.host().origin}/api${evidencePath}`)).status, 401);
    assert.equal(
      (await f.request('/diagnostics', 'GET', undefined, { Origin: 'https://outside.example' })).status,
      403,
    );
    assert.equal((await f.request('/diagnostics?project=arbitrary')).status, 400);
    const db = new DatabaseSync(join(f.dataDir, 'product.sqlite'));
    try {
      assert.ok(!sqliteMetadata(db).includes('host-large-result-'));
      assert.ok(!sqliteMetadata(db).includes('可回溯的原始结果'));
      assert.ok(!sqliteMetadata(db).includes('Diagnostic Host integration task'));
    } finally {
      db.close();
    }
  } finally {
    await f.close();
  }
});

test('raw Entry access works without a Trace, protects before pagination and refuses failed mandatory protection', async () => {
  const f = await hostFixture();
  try {
    const session = await f.create();
    const secret = 'mock-diagnostic-credential-987654321';
    f.host().service.sensitive.add(secret);
    const saved = await f.host().service.store.read<SavedHostSession>(`sessions/${session.id}.enc`);
    assert.ok(saved);
    const manager = restore(saved.session);
    const entryId = manager.appendMessage({
      role: 'user',
      content: `legacy evidence ${secret}`,
      timestamp: Date.now(),
    });
    saved.session = snapshot(manager);
    await f.host().service.store.write(`sessions/${session.id}.enc`, saved);
    const ctx: DiagnosticContext = { actor: 'agent', project: session.cwd };
    assert.equal((await f.host().service.diagnosticSearch(ctx, { sessionId: session.id })).total, 0);
    const result = await f.host().service.diagnosticEvidence(ctx, { sessionId: session.id, entryId });
    assert.equal(result.available, true);
    assert.ok('content' in result);
    assert.ok(result.content.includes('legacy evidence'));
    assert.ok(!result.content.includes(secret));
    assert.ok(JSON.stringify(saved.session).includes(secret), 'the encrypted authoritative Entry remains exact');
    const paged = await f
      .host()
      .service.diagnosticEvidence(ctx, { sessionId: session.id, entryId, offset: 0, limit: 12 });
    assert.equal(paged.total, result.total);
    assert.ok('content' in paged);
    assert.equal(paged.content, result.content.slice(0, 12));
    const missing = await f
      .host()
      .service.diagnosticEvidence(ctx, { sessionId: session.id, entryId: 'entry-not-present' });
    assert.equal(missing.available, false);
    assert.equal(missing.reason, 'entry_missing_from_checkpoint');
    const nestedId = manager.appendMessage({
      role: 'toolResult',
      toolCallId: 'legacy-outer',
      toolName: 'legacy_gateway',
      content: [{ type: 'text', text: 'only the outer result was persisted' }],
      isError: false,
      timestamp: Date.now(),
      nestedCalls: {
        complete: false,
        calls: [
          { id: 'legacy-outer/1/1', name: 'legacy_leaf', status: 'ok', arguments: { apiKey: secret }, durationMs: 0 },
        ],
      },
    });
    saved.session = snapshot(manager);
    await f.host().service.store.write(`sessions/${session.id}.enc`, saved);
    const nested = await f
      .host()
      .service.diagnosticEvidence(ctx, { sessionId: session.id, entryId: nestedId, toolCallId: 'legacy-outer/1/1' });
    assert.equal(nested.available, false);
    assert.equal(nested.reason, 'not_persisted_native');
    assert.ok('content' in nested);
    assert.ok(nested.content.includes('legacy_leaf'));
    assert.ok(nested.content.includes('"complete": false'));
    assert.ok(!nested.content.includes(secret));
    assert.ok(!nested.content.includes('only the outer result was persisted'));
    const wrongChild = await f
      .host()
      .service.diagnosticEvidence(ctx, { sessionId: session.id, entryId: nestedId, toolCallId: 'unknown-child' });
    assert.equal(wrongChild.available, false);
    assert.equal(wrongChild.reason, 'nested_summary_missing');
    const original = f.host().service.sensitive.copy.bind(f.host().service.sensitive);
    try {
      f.host().service.sensitive.copy = () => {
        throw new Error('mandatory evidence check unavailable');
      };
      await assert.rejects(f.host().service.diagnosticEvidence(ctx, { sessionId: session.id, entryId, limit: 1 }), {
        code: 'DIAGNOSTIC_PROTECTION_FAILED',
      });
      const response = await f.request(`/diagnostics/evidence?sessionId=${session.id}&entryId=${entryId}&limit=1`);
      assert.equal(response.status, 503);
      assert.ok(!(await response.text()).includes(secret));
    } finally {
      f.host().service.sensitive.copy = original;
    }
    await assert.rejects(
      f.host().service.diagnosticEvidence({ actor: 'agent', project: f.other }, { sessionId: session.id, entryId }),
      { code: 'DIAGNOSTIC_NOT_FOUND' },
    );
  } finally {
    await f.close();
  }
});

test('an accumulated message_start protects partial known credentials in thinking, text and nested Tool arguments', async () => {
  const f = await hostFixture();
  try {
    const secret = 'mock-accumulated-start-credential-123456789';
    const prefix = secret.slice(0, 24);
    f.host().service.sensitive.add(secret);
    // Public SDK listeners run after awaited Extension handlers; message_start may already contain a partial block.
    // Exercise the exact Host projection boundary without loading a product Extension or widening Skill trust.
    const projectClientEvent: unknown = Reflect.get(f.host().service, 'clientEvent');
    assert.equal(typeof projectClientEvent, 'function');
    if (typeof projectClientEvent !== 'function') assert.fail('Host client event projection is unavailable');
    for (const type of ['message_start', 'message_update']) {
      const source = {
        type,
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: `pending ${prefix}` },
            { type: 'text', text: `pending ${prefix}` },
            {
              type: 'toolCall',
              id: 'accumulated-call',
              name: 'write',
              arguments: { path: 'safe.txt', nested: { content: prefix } },
            },
          ],
        },
      };
      const detached = structuredClone(source);
      const projected: unknown = Reflect.apply(projectClientEvent, f.host().service, [source]);
      for (let length = 8; length <= prefix.length; length++) {
        assert.ok(
          !JSON.stringify(projected).includes(secret.slice(0, length)),
          `${type} leaked ${length} credential characters`,
        );
      }
      assert.deepEqual(source, detached, 'client projection must not mutate authoritative messages or Tool arguments');
    }
  } finally {
    await f.close();
  }
});

test('Host compaction and branch navigation retain evidence without reactivating withdrawn Memory decisions', async () => {
  const f = await hostFixture();
  try {
    const session = await f.create();
    const knowledge = {
      title: 'D2 branch diagnostic decision',
      content: 'Use PostgreSQL for this project.',
      kind: 'decision',
      scope: 'project',
    };
    const state = await f.run(
      session.id,
      [
        fauxAssistantMessage(fauxToolCall('memory_save', { knowledge, reason: 'user confirmed project decision' }), {
          stopReason: 'toolUse',
        }),
        fauxAssistantMessage('Decision saved with native Entry evidence.'),
      ],
      `Establish a decision. ${'historical context '.repeat(6500)}`,
    );
    const memory = toolResult(state, 'memory_save');
    assert.equal(typeof memory.id, 'string');
    const firstTrace = (await f.host().service.diagnosticSearch(user, { sessionId: session.id })).items[0];
    assert.ok(firstTrace?.userEntryId && firstTrace.endLeafId);
    const originalEvidence = await f
      .host()
      .service.diagnosticEvidence(user, { sessionId: session.id, entryId: firstTrace.userEntryId });
    await f.run(
      session.id,
      [fauxAssistantMessage('Recent answer for native compaction.')],
      'recent context '.repeat(6500),
    );
    f.fake.setResponses([fauxAssistantMessage('The user established a project decision and received an answer.')]);
    await f.host().service.action(session.id, 'compact');
    const afterCompact = await f.host().service.diagnosticSearch(user, { sessionId: session.id });
    assert.ok('sessionEvents' in afterCompact);
    assert.ok(
      afterCompact.sessionEvents.some(
        (event) => event.kind === 'compaction' && event.traceId === null && event.entryId,
      ),
    );
    assert.deepEqual(
      await f.host().service.diagnosticEvidence(user, { sessionId: session.id, entryId: firstTrace.userEntryId }),
      originalEvidence,
    );
    await f.host().service.action(session.id, 'branch', firstTrace.userEntryId);
    const ctx = await f.host().service.memoryUserContext(session.cwd);
    const memoryId = String(memory.id);
    assert.equal(f.host().service.memory.get(ctx, memoryId, true).current.status, 'withdrawn');
    const active = await f.host().service.viewSession(session.id);
    assert.ok(active.leafId);
    const currentBranch = await f
      .host()
      .service.diagnosticSearch(user, { sessionId: session.id, branchLeafId: active.leafId });
    assert.equal(currentBranch.total, 0);
    const historical = await f
      .host()
      .service.diagnosticSearch(user, { sessionId: session.id, branchLeafId: firstTrace.endLeafId });
    assert.equal(historical.total, 1);
    assert.equal(historical.items[0]?.id, firstTrace.id);
    await f.host().service.action(session.id, 'branch', firstTrace.endLeafId);
    assert.equal(f.host().service.memory.get(ctx, memoryId, true).current.status, 'withdrawn');
    const history = f.host().service.diagnostics.get(user, firstTrace.id);
    const memoryCall = history.calls.find((call) => call.toolName === 'memory_save');
    assert.ok(memoryCall?.resultEntryId);
    assert.ok(JSON.stringify(memoryCall.data.memory).includes(memoryId));
    const historicalResult = await f
      .host()
      .service.diagnosticEvidence(user, { sessionId: session.id, entryId: memoryCall.resultEntryId });
    assert.equal(historicalResult.available, true);
    await f.restart();
    assert.equal(
      f.host().service.memory.get(await f.host().service.memoryUserContext(session.cwd), memoryId, true).current.status,
      'withdrawn',
    );
    assert.equal(f.host().service.diagnostics.get(user, firstTrace.id).trace.status, 'ended');
  } finally {
    await f.close();
  }
});

test('old Session tool selections gain diagnostics on restore and after returning to their historical branch', async () => {
  const f = await hostFixture();
  try {
    const session = await f.create();
    await f.run(session.id, [fauxAssistantMessage('Session created before diagnostic tools existed.')]);
    const saved = await f.host().service.store.read<SavedHostSession>(`sessions/${session.id}.enc`);
    assert.ok(saved);
    for (const entry of saved.session.entries) {
      if (entry.type === 'message' && entry.message.role === 'system') {
        entry.message.toolsAdded = entry.message.toolsAdded?.filter((tool) => !diagnosticToolNames.includes(tool.name));
        if (entry.message.toolsRemoved)
          entry.message.toolsRemoved = entry.message.toolsRemoved.filter(
            (tool) => !diagnosticToolNames.includes(tool.name),
          );
      }
    }
    await f.host().service.store.write(`sessions/${session.id}.enc`, saved);
    await f.restart();
    const legacyUser = saved.session.entries.find((entry) => entry.type === 'message' && entry.message.role === 'user');
    assert.ok(legacyUser);
    await f.run(session.id, [
      (context) => {
        for (const name of diagnosticToolNames) assert.ok(JSON.stringify(context).includes(`"name":"${name}"`));
        return fauxAssistantMessage(fauxToolCall('diagnostic_search', { sessionId: session.id }), {
          stopReason: 'toolUse',
        });
      },
      fauxAssistantMessage('Restored diagnostics are callable.'),
    ]);
    await f.host().service.action(session.id, 'branch', legacyUser.id);
    const afterBranch = await f.run(session.id, [
      (context) => {
        for (const name of diagnosticToolNames) assert.ok(JSON.stringify(context).includes(`"name":"${name}"`));
        return fauxAssistantMessage(fauxToolCall('diagnostic_search', { sessionId: session.id }), {
          stopReason: 'toolUse',
        });
      },
      fauxAssistantMessage('Diagnostics are callable after old branch navigation.'),
    ]);
    assert.ok(Number(toolResult(afterBranch, 'diagnostic_search').total) >= 2);
  } finally {
    await f.close();
  }
});

test('Host stop records a stopped Trace and collection failure does not stop a later normal task', async () => {
  const f = await hostFixture();
  try {
    const session = await f.create();
    let entered = false;
    f.fake.setResponses([
      async (_context, options) => {
        entered = true;
        await new Promise<void>((resolve) => {
          if (options?.signal?.aborted) return resolve();
          options?.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        return fauxAssistantMessage('interrupted');
      },
    ]);
    await f.json(`/sessions/${session.id}/prompt`, 'POST', { text: 'Wait for explicit stop.' });
    const deadline = Date.now() + 5000;
    while (!entered && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(entered, true);
    await f.json(`/sessions/${session.id}/stop`, 'POST', {});
    await f.settle(session.id);
    assert.equal(
      (await f.host().service.diagnosticSearch(user, { sessionId: session.id, status: 'stopped' })).total,
      1,
    );
    assert.equal(f.fake.state.callCount, 1);
    const db = new DatabaseSync(join(f.dataDir, 'product.sqlite'));
    try {
      db.exec(
        "CREATE TRIGGER reject_host_diagnostic BEFORE INSERT ON diagnostic_calls BEGIN SELECT RAISE(ABORT,'metadata failure only'); END",
      );
      const state = await f.run(session.id, [
        fauxAssistantMessage(
          fauxToolCall('write', { path: 'diagnostic-gap.txt', content: 'side effect still executes once' }),
          { stopReason: 'toolUse' },
        ),
        fauxAssistantMessage('Normal task completed despite diagnostic writer failure.'),
      ]);
      assert.equal(state.error, undefined);
      assert.equal(await readFile(join(f.dir, 'diagnostic-gap.txt'), 'utf8'), 'side effect still executes once');
      const tasks = await f.host().service.diagnosticSearch(user, { sessionId: session.id, status: 'ended' });
      assert.equal(tasks.items[0]?.incomplete, true);
      assert.ok(f.host().service.diagnostics.health.dropped > 0);
      db.exec('DROP TRIGGER reject_host_diagnostic');
      const resumed = await f.run(session.id, [fauxAssistantMessage('A later task works normally.')]);
      assert.equal(resumed.error, undefined);
    } finally {
      db.close();
    }
  } finally {
    await f.close();
  }
});

test('checkpoint fallback and missing evidence remain explicit while other Sessions stay readable', async () => {
  const f = await hostFixture();
  try {
    const source = await f.create(),
      healthy = await f.create();
    await f.run(source.id, [fauxAssistantMessage('source answer')]);
    await f.run(healthy.id, [fauxAssistantMessage('healthy answer')]);
    const task = (await f.host().service.diagnosticSearch(user, { sessionId: source.id })).items[0];
    const otherTask = (await f.host().service.diagnosticSearch(user, { sessionId: healthy.id })).items[0];
    assert.ok(task?.userEntryId && otherTask?.userEntryId);
    await writeFile(join(f.dataDir, 'sessions', `${source.id}.enc`), 'corrupt current checkpoint');
    const fallback = await f
      .host()
      .service.diagnosticEvidence(user, { sessionId: source.id, entryId: task.userEntryId });
    assert.equal(fallback.source, 'previous_checkpoint');
    assert.equal(fallback.recovered, true);
    assert.equal(fallback.available, true);
    await writeFile(join(f.dataDir, 'sessions', `${source.id}.enc.prev`), 'corrupt previous checkpoint');
    await assert.rejects(
      f.host().service.diagnosticEvidence(user, { sessionId: source.id, entryId: task.userEntryId }),
      { code: 'DIAGNOSTIC_EVIDENCE_UNAVAILABLE' },
    );
    const unavailable = await f.request(`/diagnostics/evidence?sessionId=${source.id}&entryId=${task.userEntryId}`);
    assert.equal(unavailable.status, 503);
    assert.equal((await f.host().service.diagnosticSearch(user, {})).total, 2);
    assert.equal(
      (await f.host().service.diagnosticEvidence(user, { sessionId: healthy.id, entryId: otherTask.userEntryId }))
        .available,
      true,
    );
    assert.equal(f.fake.state.callCount, 2);
  } finally {
    await f.close();
  }
});

test('SIGKILL reconciles a running Trace with its last durable native Tool result and never replays it', {
  timeout: 20000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'diagnostic-crash-'));
  const key = randomBytes(32),
    token = randomBytes(32).toString('hex'),
    dataDir = join(root, 'data');
  const child = fork(new URL('./fixtures/recovery-host.ts', import.meta.url), [], {
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let restarted: Awaited<ReturnType<typeof startHost>> | undefined;
  try {
    const ready = new Promise<{ type: string; origin: string; provider: string }>((resolve, reject) => {
      child.once('message', (message) => resolve(message as { type: string; origin: string; provider: string }));
      child.once('error', reject);
    });
    child.send({ dataDir, key: key.toString('base64'), token });
    const config = await ready;
    assert.equal(config.type, 'ready');
    const request = (path: string, value: unknown) =>
      fetch(`${config.origin}/api${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
    const created = await request('/sessions', { cwd: root, provider: config.provider, model: 'crash-model' });
    assert.equal(created.status, 201);
    const session: HostState = await created.json();
    assert.equal(
      (await request(`/sessions/${session.id}/prompt`, { text: 'Write once and wait for another model response.' }))
        .status,
      202,
    );
    const store = new EncryptedStore(dataDir, key);
    let saved: SavedHostSession | undefined;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      saved = await store.read<SavedHostSession>(`sessions/${session.id}.enc`);
      if (saved?.session.entries.some((entry) => entry.type === 'message' && entry.message.role === 'toolResult'))
        break;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    assert.ok(saved);
    const resultEntry = saved.session.entries.find(
      (entry) => entry.type === 'message' && entry.message.role === 'toolResult',
    );
    assert.ok(resultEntry);
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    restarted = await startHost({ dataDir, key, token });
    const fake = fauxProvider({ models: [{ id: 'crash-model', contextWindow: 100000, maxTokens: 512 }] });
    restarted.service.runtime.registerNativeProvider(fake.provider);
    const search = await restarted.service.diagnosticSearch(user, { sessionId: session.id });
    assert.equal(search.total, 1);
    const task = search.items[0];
    assert.ok(task);
    assert.equal(task.status, 'interrupted');
    assert.equal(task.incomplete, true);
    const detail = restarted.service.diagnostics.get(user, task.id);
    assert.ok(detail.calls.some((call) => call.toolName === 'write' && call.resultEntryId === resultEntry.id));
    const evidence = await restarted.service.diagnosticEvidence(user, {
      sessionId: session.id,
      entryId: resultEntry.id,
    });
    assert.equal(evidence.available, true);
    assert.equal(fake.state.callCount, 0);
    assert.equal(await readFile(join(root, 'crash-side-effect.txt'), 'utf8'), 'one committed side effect');
    assert.equal((await restarted.service.viewSession(session.id)).interrupted, true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
    await restarted?.close();
    await rm(root, { recursive: true, force: true });
  }
});
