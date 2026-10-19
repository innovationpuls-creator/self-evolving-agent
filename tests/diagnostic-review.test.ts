import { diagnosticResources } from '../apps/host/diagnostic-resources.js';
import { DiagnosticHistory } from '../apps/host/diagnostic-history.js';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { AgentService } from '../apps/host/agent.js';
import { DiagnosticRecorder, DiagnosticService, type DiagnosticTrace, traceMarker } from '../apps/host/diagnostics.js';
import { SensitiveData, snapshot } from '../apps/host/storage.js';

const project = '/__diagnostic_independent_review__';
const user = { actor: 'user' } as const;

function task(): DiagnosticTrace {
  return {
    id: randomUUID(),
    sessionId: randomUUID(),
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
  };
}

function index(db = new DatabaseSync(':memory:')) {
  const diagnostics = new DiagnosticService(db, new SensitiveData(), () => {});
  diagnostics.init();
  assert.equal(diagnostics.health.available, true);
  return {
    db,
    diagnostics,
    close() {
      diagnostics.close();
      db.close();
    },
  };
}

function nativeTask(nested = false) {
  const trace = task();
  const manager = SessionManager.inMemory(project, { id: trace.sessionId });
  trace.startLeafId = manager.appendCustomEntry(traceMarker, {
    version: 1,
    phase: 'start',
    traceId: trace.id,
    at: trace.started,
  });
  trace.userEntryId = manager.appendMessage({
    role: 'user',
    content: 'isolated native history',
    timestamp: trace.started,
  });
  const assistantEntryId = manager.appendMessage(
    fauxAssistantMessage(fauxToolCall('outer', {}, { id: 'observed-call' }), { stopReason: 'toolUse' }),
  );
  const resultEntryId = manager.appendMessage({
    role: 'toolResult',
    toolCallId: 'observed-call',
    toolName: 'outer',
    content: [{ type: 'text', text: 'native result' }],
    isError: false,
    durationMs: 9,
    timestamp: trace.started + 10,
    ...(nested
      ? {
          nestedCalls: {
            complete: true,
            calls: [{ id: 'observed-call/1', name: 'child', status: 'error' as const, durationMs: 3 }],
          },
        }
      : {}),
  });
  manager.appendCustomEntry(traceMarker, {
    version: 1,
    phase: 'end',
    traceId: trace.id,
    at: trace.started + 11,
    status: 'ended',
    gaps: 1,
  });
  return { trace, manager, assistantEntryId, resultEntryId };
}

function partialCall(f: ReturnType<typeof index>, native: ReturnType<typeof nativeTask>, nested = false) {
  const id = randomUUID();
  f.diagnostics.call(native.trace, {
    id,
    toolCallId: nested ? 'observed-call/1' : 'observed-call',
    parentToolCallId: nested ? 'observed-call' : null,
    toolName: nested ? 'child' : 'outer',
    sequence: nested ? 2 : 1,
    started: native.trace.started,
    ended: null,
    status: 'running',
    durationMs: null,
    outputBytes: null,
    assistantEntryId: native.assistantEntryId,
    resultEntryId: null,
    data: { resultAvailability: nested ? 'not_persisted_native' : 'pending' },
  });
  return id;
}

test('independent review: an Assistant Entry without Tool calls finds its existing Trace', () => {
  const f = index();
  try {
    const trace = task();
    f.diagnostics.trace(project, trace);
    f.diagnostics.turn(trace, {
      id: randomUUID(),
      ordinal: 1,
      started: trace.started,
      ended: trace.started + 1,
      assistantEntryId: 'assistant-without-any-tool',
      model: 'review-model',
      provider: 'review-provider',
      stopReason: 'stop',
      usage: null,
      data: {},
    });
    const found = f.diagnostics.search(user, { entryId: 'assistant-without-any-tool' });
    assert.equal(found.total, 1);
    assert.equal(found.items[0]?.id, trace.id);
    assert.equal(f.diagnostics.get(user, trace.id).totals.calls, 0);
    assert.equal(
      f.diagnostics.search({ actor: 'agent', project: '/another-project' }, { entryId: 'assistant-without-any-tool' })
        .total,
      0,
    );
  } finally {
    f.close();
  }
});

test('independent review: a locked metadata writer drops bounded work promptly and restores the Host timeout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'diagnostic-lock-review-'));
  const path = join(dir, 'product.sqlite');
  const f = index(new DatabaseSync(path));
  const blocker = new DatabaseSync(path);
  let locked = false;
  try {
    f.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000');
    const trace = task();
    f.diagnostics.trace(project, trace);
    f.diagnostics.flush();
    blocker.exec('BEGIN IMMEDIATE');
    locked = true;
    for (let i = 0; i < 1000; i++) {
      f.diagnostics.event(
        trace.sessionId,
        { id: randomUUID(), traceId: trace.id, kind: 'lock-review', at: i, entryId: null, data: {} },
        trace,
      );
    }
    const started = performance.now();
    f.diagnostics.flush();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 1500, `Diagnostic lock contention delayed the event loop by ${Math.round(elapsed)} ms`);
    assert.equal(f.db.prepare('PRAGMA busy_timeout').get()?.timeout, 5000);
    assert.equal(f.diagnostics.health.dropped, 1000);
    assert.equal(trace.incomplete, true);
    assert.equal(f.diagnostics.get(user, trace.id).totals.events, 0);
    blocker.exec('ROLLBACK');
    locked = false;
    f.diagnostics.trace(project, trace);
    assert.equal(f.diagnostics.get(user, trace.id).trace.incomplete, true);
    assert.equal(f.diagnostics.health.available, true);
  } finally {
    if (locked) blocker.exec('ROLLBACK');
    blocker.close();
    f.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('independent review: knowledge overlays on one package version retain distinct diagnostic revisions', () => {
  const f = index();
  try {
    const skillId = randomUUID(),
      version = randomUUID();
    const revisions = [randomUUID(), randomUUID()];
    const recorded: Array<Array<{ skillId: string; version: string; knowledgeRevision: string }>> = [];
    for (const revision of revisions) {
      // Deliberately unrelated layout: identity comes from Skill, not the path string.
      const skillPath = `/arbitrary-layout/${revision}/SKILL.md`;
      const resources = diagnosticResources(
        [
          {
            skillPath,
            knowledgePaths: [`/arbitrary-layout/${revision}/notes.md`],
            extensionPaths: [],
            skillId,
            version,
            digest: 'same-immutable-package-digest',
            knowledgeRevision: revision,
          },
        ],
        [{ filePath: skillPath }],
        [],
      );
      const manager = SessionManager.inMemory(project, { id: randomUUID() });
      const recorder = new DiagnosticRecorder(f.diagnostics, manager.getSessionId(), project, manager);
      recorder.start();
      const id = recorder.traceId;
      assert.ok(id);
      recorder.loaded(resources);
      recorder.finish('ended');
      const loaded = f.diagnostics.get(user, id).events.find((event) => event.kind === 'resources_loaded');
      assert.ok(loaded);
      const refs = loaded.data.skills as Array<{ skillId: string; version: string; knowledgeRevision: string }>;
      assert.ok(refs.length > 0);
      assert.ok(
        refs.every((ref) => ref.skillId === skillId && ref.version === version && ref.knowledgeRevision === revision),
      );
      recorded.push(refs);
    }
    assert.notDeepEqual(recorded[0], recorded[1]);
  } finally {
    f.close();
  }
});

test('independent review: unavailable raw checkpoints do not hide scoped Session metrics', async () => {
  const f = index();
  try {
    const trace = task();
    f.diagnostics.trace(project, trace);
    const history = new DiagnosticHistory(
      async () => {
        throw new Error('isolated missing checkpoint fixture');
      },
      f.diagnostics,
      new SensitiveData(),
    );
    const result = await history.search(user, { sessionId: trace.sessionId });
    assert.equal(result.total, 1);
    assert.equal(result.items[0]?.id, trace.id);
    assert.ok('sessionEventsUnavailable' in result && result.sessionEventsUnavailable);
    const hidden = await history.search(
      { actor: 'agent', project: '/another-project' },
      { sessionId: trace.sessionId },
    );
    assert.equal(hidden.total, 0);
    await assert.rejects(history.search(user, { sessionId: trace.sessionId, branchLeafId: 'unknown-branch' }));
    await assert.rejects(history.evidence(user, { sessionId: trace.sessionId, entryId: 'missing' }), {
      code: 'DIAGNOSTIC_EVIDENCE_UNAVAILABLE',
    });
  } finally {
    f.close();
  }
});

test('independent review: native results repair an existing partial Trace without replacing observed facts', () => {
  const f = index();
  try {
    const native = nativeTask();
    f.diagnostics.trace(project, native.trace);
    const callId = partialCall(f, native);
    f.diagnostics.flush();
    const saved = snapshot(native.manager);
    f.diagnostics.reconcile(native.trace.sessionId, project, saved, false);
    const recovered = f.diagnostics.get(user, native.trace.id);
    assert.equal(recovered.trace.status, 'ended');
    assert.equal(recovered.trace.incomplete, true);
    assert.equal(recovered.totals.calls, 1);
    assert.equal(recovered.totals.turns, 1);
    assert.equal(recovered.calls[0]?.id, callId);
    assert.equal(recovered.calls[0]?.status, 'ok');
    assert.equal(recovered.calls[0]?.started, native.trace.started);
    assert.equal(recovered.calls[0]?.durationMs, 9);
    assert.equal(recovered.calls[0]?.resultEntryId, native.resultEntryId);
    assert.equal(recovered.calls[0]?.data.resultAvailability, 'reference_requires_lookup');
    f.diagnostics.reconcile(native.trace.sessionId, project, saved, false);
    assert.deepEqual(f.diagnostics.get(user, native.trace.id).totals, recovered.totals);
  } finally {
    f.close();
  }
});

test('independent review: partial nested records merge with native summaries without counting a call twice', () => {
  const f = index();
  try {
    const native = nativeTask(true);
    native.trace.toolCount = 2;
    f.diagnostics.trace(project, native.trace);
    partialCall(f, native);
    const childId = partialCall(f, native, true);
    f.diagnostics.flush();
    const saved = snapshot(native.manager);
    f.diagnostics.reconcile(native.trace.sessionId, project, saved, false);
    const recovered = f.diagnostics.get(user, native.trace.id);
    const children = recovered.calls.filter((call) => call.toolCallId === 'observed-call/1');
    assert.equal(children.length, 1);
    assert.equal(children[0]?.id, childId);
    assert.equal(children[0]?.parentToolCallId, 'observed-call');
    assert.equal(children[0]?.started, native.trace.started);
    assert.equal(children[0]?.status, 'error');
    assert.equal(children[0]?.durationMs, 3);
    assert.equal(children[0]?.resultEntryId, native.resultEntryId);
    assert.equal(children[0]?.data.resultAvailability, 'not_persisted_native');
    assert.equal(recovered.trace.toolCount, 2);
    assert.equal(recovered.trace.errorCount, 1);
    assert.equal(recovered.totals.calls, 2);
    f.diagnostics.reconcile(native.trace.sessionId, project, saved, false);
    assert.deepEqual(f.diagnostics.get(user, native.trace.id).totals, recovered.totals);
  } finally {
    f.close();
  }
});

test('independent review: an unfinished native nested summary does not erase a later observed completion', () => {
  const f = index();
  try {
    const native = nativeTask(true);
    f.diagnostics.trace(project, native.trace);
    partialCall(f, native);
    const childId = partialCall(f, native, true);
    f.diagnostics.flush();
    const child = f.diagnostics.get(user, native.trace.id).calls.find((call) => call.id === childId);
    assert.ok(child);
    f.diagnostics.call(native.trace, {
      ...child,
      status: 'ok',
      ended: native.trace.started + 20,
      durationMs: 20,
    });
    f.diagnostics.flush();
    const saved = snapshot(native.manager);
    const result = saved.entries.find((entry) => entry.id === native.resultEntryId);
    assert.ok(result?.type === 'message' && result.message.role === 'toolResult' && result.message.nestedCalls);
    result.message.nestedCalls.complete = false;
    const summary = result.message.nestedCalls.calls[0];
    assert.ok(summary);
    summary.status = 'unfinished';
    summary.durationMs = undefined;
    f.diagnostics.reconcile(native.trace.sessionId, project, saved, false);
    const recovered = f.diagnostics.get(user, native.trace.id).calls.find((call) => call.id === childId);
    assert.equal(recovered?.status, 'ok');
    assert.equal(recovered?.ended, native.trace.started + 20);
    assert.equal(recovered?.durationMs, 20);
  } finally {
    f.close();
  }
});

test('independent review: oversized diagnostic records are omitted with a visible collection gap', () => {
  const f = index();
  try {
    const trace = task();
    f.diagnostics.trace(project, trace);
    f.diagnostics.flush();
    assert.doesNotThrow(() =>
      f.diagnostics.event(
        trace.sessionId,
        {
          id: randomUUID(),
          traceId: trace.id,
          kind: 'oversized-review-record',
          at: Date.now(),
          entryId: null,
          data: { oversized: 'x'.repeat(65536) },
        },
        trace,
      ),
    );
    f.diagnostics.trace(project, trace);
    const detail = f.diagnostics.get(user, trace.id);
    assert.equal(detail.totals.events, 0);
    assert.equal(detail.trace.incomplete, true);
    assert.equal(detail.health.dropped, 1);
  } finally {
    f.close();
  }
});

test('independent review: one Memory result retains at most 100 source references across all records', () => {
  const f = index();
  try {
    const manager = SessionManager.inMemory(project, { id: randomUUID() });
    const recorder = new DiagnosticRecorder(f.diagnostics, manager.getSessionId(), project, manager);
    recorder.start();
    const id = recorder.traceId;
    assert.ok(id);
    const items = Array.from({ length: 3 }, () => ({
      id: randomUUID(),
      revision: 1,
      content: 'memory-body-excluded-from-diagnostics',
      sources: Array.from({ length: 50 }, () => ({ sessionId: randomUUID(), entryId: randomUUID() })),
    }));
    recorder.observe({ type: 'tool_execution_start', toolCallId: 'memory-call', toolName: 'memory_search', args: {} });
    recorder.observe({
      type: 'tool_execution_end',
      toolCallId: 'memory-call',
      toolName: 'memory_search',
      isError: false,
      result: { content: [{ type: 'text', text: JSON.stringify({ items }) }] },
    });
    recorder.finish('ended');
    const detail = f.diagnostics.get(user, id);
    const references = detail.calls.find((call) => call.toolCallId === 'memory-call')?.data.memory as {
      references: Array<{ sources: unknown[] }>;
      complete: boolean;
    };
    assert.ok(references);
    assert.equal(references.references.length, 3);
    assert.equal(
      references.references.reduce((total, ref) => total + ref.sources.length, 0),
      100,
    );
    assert.equal(references.complete, false);
    assert.ok(!JSON.stringify(detail).includes('memory-body-excluded-from-diagnostics'));
  } finally {
    f.close();
  }
});

test('independent review: an indexed run absent from the valid checkpoint has unavailable evidence and unknown end time', () => {
  const f = index();
  try {
    const trace = task();
    f.diagnostics.trace(project, trace);
    f.diagnostics.flush();
    const manager = SessionManager.inMemory(project, { id: trace.sessionId });
    f.diagnostics.reconcile(trace.sessionId, project, snapshot(manager), true);
    const recovered = f.diagnostics.get(user, trace.id);
    assert.equal(recovered.trace.status, 'interrupted');
    assert.equal(recovered.trace.incomplete, true);
    assert.equal(recovered.trace.ended, null);
    assert.equal(recovered.trace.data.evidenceUnavailable, true);
    assert.equal(manager.getEntries().length, 0);
    assert.equal(f.diagnostics.search(user, { sessionId: trace.sessionId }).total, 1);
  } finally {
    f.close();
  }
});

test('stream protection chooses the longest credential prefix independently of registration order', () => {
  for (const credentials of [
    ['model-auth-credential', 'mock-complete-stream-credential-123456789'],
    ['mock-complete-stream-credential-123456789', 'model-auth-credential'],
  ]) {
    const sensitive = new SensitiveData();
    for (const secret of credentials) sensitive.add(secret);
    assert.equal(sensitive.text('mock-complete-stream', true), '[已保护]');
    assert.equal(sensitive.text('prefix: mock-complete-stream', true), 'prefix: [已保护]');
  }
});

test('stream protection merges full and partial overlapping credentials before projection', () => {
  for (const credentials of [
    ['abcdefgh', 'abcdefghijklmnop'],
    ['abcdefghijklmnop', 'abcdefgh'],
  ]) {
    const sensitive = new SensitiveData();
    for (const value of credentials) sensitive.add(value);
    assert.equal(sensitive.text('abcdefghijkl', true), '[已保护]');
    assert.equal(sensitive.text('abcdefghijklmnop'), '[已保护]');
  }
  const sensitive = new SensitiveData();
  sensitive.add('xyzabcdef');
  sensitive.add('abcdefgh');
  assert.equal(sensitive.text('xyzabcdef', true), '[已保护]');
});

test('independent review: published native Skill reads keep version references through filesystem aliases', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'diagnostic-skill-alias-review-'));
  const host = new AgentService(join(dir, 'data'), randomBytes(32));
  let initialized = false;
  try {
    await host.init();
    initialized = true;
    const fake = fauxProvider({
      models: [{ id: 'diagnostic-skill-alias', contextWindow: 100000, maxTokens: 512 }],
      tokensPerSecond: 100000,
    });
    host.runtime.registerNativeProvider(fake.provider);
    const source = join(dir, 'ordinary');
    await mkdir(source);
    await writeFile(
      join(source, 'SKILL.md'),
      '---\nname: diagnostic-alias\ndescription: Ordinary native Skill for evidence association.\n---\nRead the requested local file.',
    );
    const [skill] = await host.skills.import({ source });
    assert.ok(skill);
    const operation = host.skills.publish(skill.id, skill.latest, skill.revision);
    const deadline = Date.now() + 10000;
    while (['checking', 'waiting'].includes(host.skills.operation(operation.id).status)) {
      assert.ok(Date.now() < deadline, 'native Skill publication timed out');
      await new Promise((ok) => setTimeout(ok, 10));
    }
    assert.equal(host.skills.operation(operation.id).status, 'applied');
    const version = host.skills.version(skill.latest);
    const packagePath = host.skills.packagePath(version);
    const canonicalSkill = await realpath(join(packagePath, version.skillFile));
    const aliasRoot = join(dir, 'managed-skill-alias');
    await symlink(packagePath, aliasRoot, 'dir');
    const aliasSkill = join(aliasRoot, version.skillFile);
    assert.notEqual(aliasSkill, canonicalSkill);
    assert.equal(await realpath(aliasSkill), canonicalSkill);
    const session = await host.create(dir, fake.provider.id, 'diagnostic-skill-alias');
    fake.setResponses([
      fauxAssistantMessage(fauxToolCall('read', { path: canonicalSkill }, { id: 'canonical-skill-read' }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage(fauxToolCall('read', { path: aliasSkill }, { id: 'alias-skill-read' }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('done'),
    ]);
    await host.prompt(session.id, 'Read the published capability through both equivalent filesystem paths.');
    while ((await host.viewSession(session.id)).busy) {
      assert.ok(Date.now() < deadline, 'native Skill reads timed out');
      await new Promise((ok) => setTimeout(ok, 10));
    }
    const [trace] = host.diagnostics.search(user, { sessionId: session.id }).items;
    assert.ok(trace);
    const detail = host.diagnostics.get(user, trace.id);
    const loaded = detail.events.find((event) => event.kind === 'resources_loaded');
    assert.ok(loaded);
    assert.ok(
      (loaded.data.skills as Array<{ skillId?: string; version?: string }>).some(
        (ref) => ref.skillId === skill.id && ref.version === version.id,
      ),
      'the actual native managed Skill must retain its published version association',
    );
    for (const callId of ['canonical-skill-read', 'alias-skill-read']) {
      const call = detail.calls.find((item) => item.toolCallId === callId);
      assert.ok(call, `${callId} must produce a diagnostic call`);
      assert.equal(call.status, 'ok', `${callId} must perform an actual successful native read`);
      assert.deepEqual(call.data.skillRead, {
        skillId: skill.id,
        version: version.id,
        digest: version.digest,
        observation: 'observed_read',
      });
    }
  } finally {
    if (initialized) await host.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('historical evidence is independently readable with whole-entry protection and fixed project access', async () => {
  const f = index();
  try {
    const manager = SessionManager.inMemory(project);
    const secret = 'independent-history-secret-12345';
    const entryId = manager.appendMessage({ role: 'user', content: `Before ${secret} after`, timestamp: Date.now() });
    const saved = { record: { cwd: project }, session: snapshot(manager) };
    const sensitive = new SensitiveData();
    sensitive.add(secret);
    const history = new DiagnosticHistory(async () => ({ saved, previous: true }), f.diagnostics, sensitive);
    const query = { sessionId: manager.getSessionId(), entryId, limit: 32768 };
    const evidence = await history.evidence({ actor: 'agent', project }, query);
    assert.ok('content' in evidence);
    assert.equal(evidence.source, 'previous_checkpoint');
    assert.ok(!evidence.content.includes(secret));
    assert.ok(evidence.content.includes('[已保护]'));
    const page = await history.evidence(user, { ...query, offset: 15, limit: 19 });
    assert.ok('content' in page);
    assert.equal(page.content, evidence.content.slice(15, 34));
    assert.ok(JSON.stringify(saved).includes(secret), 'projection must not change the native snapshot');
    await assert.rejects(history.evidence({ actor: 'agent', project: '/other-project' }, query), {
      code: 'DIAGNOSTIC_NOT_FOUND',
    });
  } finally {
    f.close();
  }
});
