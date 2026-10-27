import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { DiagnosticHistory } from '../apps/host/diagnostics/diagnostic-history.js';
import {
  DiagnosticError,
  DiagnosticService,
  type DiagnosticCall,
  type DiagnosticTrace,
  type DiagnosticTurn,
} from '../apps/host/diagnostics/diagnostics.js';
import { SensitiveData, snapshot } from '../apps/host/storage/storage.js';

const user = { actor: 'user' } as const;
const project = process.cwd();
function fixture() {
  const db = new DatabaseSync(':memory:');
  const sensitive = new SensitiveData();
  const service = new DiagnosticService(db, sensitive, () => {});
  service.init();
  const manager = SessionManager.inMemory(project);
  const sessionId = manager.getSessionId();
  const userEntryId = manager.appendMessage({
    role: 'user',
    content: 'inspect the recorded task',
    timestamp: Date.now(),
  });
  const assistantEntryId = manager.appendMessage(fauxAssistantMessage('recorded answer'));
  const resultEntryId = manager.appendMessage({
    role: 'toolResult',
    toolCallId: 'native-call',
    toolName: 'read',
    content: [{ type: 'text', text: 'result '.repeat(2400) }],
    isError: false,
    timestamp: Date.now(),
  });
  const history = new DiagnosticHistory(
    async (id) =>
      id === sessionId
        ? { saved: { record: { cwd: project }, session: snapshot(manager) }, previous: false }
        : undefined,
    service,
    sensitive,
  );
  function trace(overrides: Partial<DiagnosticTrace> = {}, cwd = project) {
    const value: DiagnosticTrace = {
      id: randomUUID(),
      sessionId,
      started: Date.now(),
      ended: null,
      status: 'running',
      startLeafId: null,
      endLeafId: null,
      userEntryId,
      toolCount: 0,
      errorCount: 0,
      incomplete: false,
      data: {},
      ...overrides,
    };
    service.trace(cwd, value);
    return value;
  }
  function turn(owner: DiagnosticTrace, overrides: Partial<DiagnosticTurn> = {}) {
    const value: DiagnosticTurn = {
      id: randomUUID(),
      ordinal: 1,
      started: null,
      ended: null,
      assistantEntryId,
      model: 'recorded-model',
      provider: 'faux',
      stopReason: null,
      usage: null,
      data: {},
      ...overrides,
    };
    service.turn(owner, value);
    return value;
  }
  function call(owner: DiagnosticTrace, overrides: Partial<DiagnosticCall> = {}) {
    const value: DiagnosticCall = {
      id: randomUUID(),
      toolCallId: 'native-call',
      parentToolCallId: null,
      toolName: 'read',
      sequence: 1,
      started: null,
      ended: null,
      status: 'ok',
      durationMs: null,
      outputBytes: 16800,
      assistantEntryId,
      resultEntryId,
      data: {},
      ...overrides,
    };
    service.call(owner, value);
    return value;
  }
  return {
    db,
    sensitive,
    service,
    history,
    sessionId,
    userEntryId,
    assistantEntryId,
    resultEntryId,
    trace,
    turn,
    call,
    close() {
      service.close();
      db.close();
    },
  };
}

test('session summaries aggregate before pagination and retain all existing trace filters and project scope', async () => {
  const value = fixture();
  try {
    for (let index = 0; index < 35; index++)
      value.trace({ started: index + 1, toolCount: 2, errorCount: index === 0 ? 1 : 0 });
    const other = value.trace({ sessionId: randomUUID(), started: 100, status: 'ended', ended: 110, toolCount: 1 });
    value.call(other, { toolName: 'bash' });
    value.trace({ sessionId: randomUUID(), started: 200 }, '/other-project');
    const first = value.service.sessions({ actor: 'agent', project }, { limit: 1 });
    assert.equal(first.total, 2);
    assert.equal(first.items[0]?.sessionId, other.sessionId);
    const second = value.service.sessions({ actor: 'agent', project }, { limit: 1, offset: 1 });
    assert.deepEqual(second.items[0], {
      sessionId: value.sessionId,
      started: 1,
      latest: 35,
      traceCount: 35,
      toolCount: 70,
      errorCount: 1,
      incomplete: false,
    });
    assert.equal(value.service.sessions(user, { toolName: 'bash' }).items[0]?.traceCount, 1);
    assert.equal(value.service.sessions(user, { status: 'ended', traceId: other.id, from: 100, to: 101 }).total, 1);
    assert.equal(value.service.sessions(user, { hasError: 'true' }).items[0]?.traceCount, 1);
    assert.equal(
      value.service.sessions(user, { sessionId: value.sessionId, entryId: value.userEntryId }).items[0]?.traceCount,
      35,
    );
    assert.equal(
      (await value.history.sessions(user, { sessionId: value.sessionId, branchLeafId: value.resultEntryId })).total,
      1,
    );
    await assert.rejects(value.history.sessions(user, { branchLeafId: value.resultEntryId }), /Session/);
    await assert.rejects(
      value.history.sessions(user, { sessionId: value.sessionId, branchLeafId: 'missing' }),
      /分支节点/,
    );
    assert.throws(() => value.service.sessions({ actor: 'agent' }, {}), DiagnosticError);
  } finally {
    value.close();
  }
});

test('Turn-aware Tool pages use unique recorded relations and keep ambiguous or missing relations unassigned', () => {
  const value = fixture();
  try {
    const trace = value.trace();
    const first = value.turn(trace);
    const second = value.turn(trace, { ordinal: 2, assistantEntryId: 'second' });
    value.call(trace, { sequence: 1 });
    value.call(trace, { sequence: 2, assistantEntryId: null, data: { turnOrdinal: 2 } });
    value.call(trace, { sequence: 3, assistantEntryId: 'missing', data: { turnOrdinal: 2 } });
    value.call(trace, { sequence: 4, assistantEntryId: null });
    assert.deepEqual(
      value.service.get(user, trace.id, { turnId: first.id }).calls.map((call) => call.sequence),
      [1],
    );
    assert.deepEqual(
      value.service.get(user, trace.id, { turnId: second.id }).calls.map((call) => call.sequence),
      [2],
    );
    assert.deepEqual(
      value.service.get(user, trace.id, { unassigned: 'true' }).calls.map((call) => call.sequence),
      [3, 4],
    );
    value.turn(trace, { ordinal: 3 });
    const ambiguous = value.service.get(user, trace.id, { turnId: first.id });
    assert.equal(ambiguous.totals.calls, 0);
    assert.equal(ambiguous.unassignedCalls, 3);
    assert.equal(value.service.get(user, trace.id).totals.calls, 4);
    assert.throws(() => value.service.get(user, trace.id, { turnId: second.id, unassigned: 'true' }));
    assert.throws(() => value.service.get(user, value.trace().id, { turnId: first.id }), /Turn 不存在/);
    assert.throws(() => value.service.get({ actor: 'agent', project: '/other-project' }, trace.id), DiagnosticError);
  } finally {
    value.close();
  }
});

test('Turn and Tool pages are independently ordered and paginated beyond one detail page', () => {
  const value = fixture();
  try {
    const trace = value.trace({ toolCount: 65 });
    let firstId = '';
    for (let ordinal = 55; ordinal > 0; ordinal--) {
      const turn = value.turn(trace, { ordinal, assistantEntryId: `entry-${ordinal}` });
      if (ordinal === 1) firstId = turn.id;
    }
    for (let sequence = 65; sequence > 0; sequence--) value.call(trace, { sequence, assistantEntryId: 'entry-1' });
    assert.equal(value.service.get(user, trace.id).turns[0]?.ordinal, 1);
    assert.equal(value.service.get(user, trace.id, { offset: 50 }).turns[0]?.ordinal, 51);
    const calls = value.service.get(user, trace.id, { turnId: firstId, offset: 30, limit: 30 });
    assert.equal(calls.totals.calls, 65);
    assert.deepEqual(
      calls.calls.map((call) => call.sequence),
      Array.from({ length: 30 }, (_, index) => index + 31),
    );
    assert.equal(value.service.get(user, trace.id, { turnId: firstId, offset: 60, limit: 30 }).calls.length, 5);
  } finally {
    value.close();
  }
});
