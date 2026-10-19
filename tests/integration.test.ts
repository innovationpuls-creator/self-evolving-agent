import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import type { MemoryView } from '../apps/host/memory/memory.js';
import { startHost } from '../apps/host/transport/server.js';
import type { SkillOperation, SkillRecord, SkillVersion } from '../apps/host/skills/skills.js';

interface DiagnosticCatalog {
  items: Array<{ id: string; sessionId: string; [key: string]: unknown }>;
  total: number;
}
interface DiagnosticDetail {
  trace: { id: string; [key: string]: unknown };
  calls: Array<{ id: string; toolName: string; resultEntryId?: string | null; data: Record<string, unknown> }>;
}
interface MemoryCatalog {
  items: MemoryView[];
  total: number;
}
interface MemoryDetail {
  current: MemoryView;
  history: MemoryView[];
}

interface SessionState {
  id: string;
  busy: boolean;
  error?: string;
  leafId: string | null;
  messages: Array<{ role: string; toolName?: string; isError?: boolean; content?: unknown }>;
  tree: Array<{ entry: { id: string; message?: { role: string } }; children: SessionState['tree'] }>;
}

const flatten = (tree: SessionState['tree']): SessionState['tree'] => tree.flatMap((n) => [n, ...flatten(n.children)]);

function toolResultsSince<T>(state: SessionState, name: string, offset = 0): T[] {
  return state.messages.slice(offset).flatMap((message) => {
    if (message.role !== 'toolResult' || message.toolName !== name) return [];
    assert.notEqual(message.isError, true, `${name} failed in the current prompt`);
    assert.ok(Array.isArray(message.content));
    return message.content.flatMap((block: unknown) => {
      if (!block || typeof block !== 'object' || !('text' in block) || typeof block.text !== 'string') return [];
      return [JSON.parse(block.text) as T];
    });
  });
}

async function setup() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'd2-integration-suite-')));
  const dataDir = join(dir, 'data');
  const key = randomBytes(32);
  const token = randomBytes(32).toString('hex');
  const host = await startHost({ dataDir, key, token });
  const fake = fauxProvider({
    models: [{ id: 'integration-model', contextWindow: 262144, maxTokens: 1024 }],
    tokensPerSecond: 100000,
  });
  host.service.runtime.registerNativeProvider(fake.provider);

  const request = (path: string, method = 'GET', body?: unknown) =>
    fetch(`${host.origin}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const json = async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    const res = await request(path, method, body);
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}: ${data.error}`);
      Object.assign(err, { status: res.status, data });
      throw err;
    }
    return data as T;
  };

  const waitOp = async (initialOp: SkillOperation) => {
    let op = initialOp;
    const deadline = Date.now() + 10000;
    while (['checking', 'waiting'].includes(op.status)) {
      assert.ok(Date.now() < deadline, 'Skill operation timed out');
      await new Promise((ok) => setTimeout(ok, 20));
      op = await json<SkillOperation>(`/skills/operations/${op.id}`);
    }
    return op;
  };

  const settle = async (id: string) => {
    const deadline = Date.now() + 15000;
    let state = await host.service.viewSession(id);
    while (state.busy && Date.now() < deadline) {
      await new Promise((ok) => setTimeout(ok, 20));
      state = await host.service.viewSession(id);
    }
    assert.equal(state.busy, false, 'session did not settle');
    return state as unknown as SessionState;
  };

  return {
    dir,
    dataDir,
    key,
    token,
    host,
    fake,
    request,
    json,
    waitOp,
    settle,
    close: async () => {
      await host.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('D2 unified Pi integration: ordinary Skill, Memory correction/withdrawal/reconfirmation, diagnostic evidence and graceful restart', async () => {
  const f = await setup();
  try {
    // This deterministic test checks native integration, not autonomous model reasoning.
    const ordinarySkillDir = join(f.dir, '.agents/skills/d2-deploy-helper');
    await mkdir(ordinarySkillDir, { recursive: true });
    await writeFile(
      join(ordinarySkillDir, 'SKILL.md'),
      `---
name: d2-deploy-helper
description: Orchestrates deployment verification and records decisions.
---
Read deploy-spec.txt with read, then follow instructions.
`,
    );

    const importedOrdinary = await f.waitOp(
      await f.json<SkillOperation>('/skills', 'POST', { source: ordinarySkillDir }),
    );
    assert.equal(importedOrdinary.status, 'applied');
    const skillList1 = await f.json<{ skills: SkillRecord[] }>('/skills');
    const ordinarySkill = skillList1.skills.find((s) => s.name === 'd2-deploy-helper');
    assert.ok(ordinarySkill);

    const publishedOrdinary = await f.waitOp(
      await f.json<SkillOperation>(`/skills/${ordinarySkill.id}/publish`, 'POST', {
        version: ordinarySkill.latest,
        baseRevision: ordinarySkill.revision,
      }),
    );
    assert.equal(publishedOrdinary.status, 'applied');

    // Importing a historical executable fixture must not approve or execute it.
    const specialSource = resolve('tests/fixtures/reviewed-skill');
    const importedSpecial = await f.waitOp(
      await f.json<SkillOperation>('/skills', 'POST', {
        source: specialSource,
        bindings: [{ skill: 'skills/receipt/SKILL.md', extensions: ['extensions/receipt.js'] }],
      }),
    );
    assert.equal(importedSpecial.status, 'applied');

    const skillList2 = await f.json<{ skills: SkillRecord[] }>('/skills');
    const specialSkill = skillList2.skills.find((s) => s.name === 'd2-receipt');
    assert.ok(specialSkill);

    const specialDetail = await f.json<{ versions: SkillVersion[] }>(`/skills/${specialSkill.id}`);
    const specialVersion = specialDetail.versions.find((v) => v.id === specialSkill.latest);
    assert.ok(specialVersion);

    // Unreviewed publish is rejected
    const denied = await f.waitOp(
      await f.json<SkillOperation>(`/skills/${specialSkill.id}/publish`, 'POST', {
        version: specialVersion.id,
        baseRevision: specialSkill.revision,
      }),
    );
    assert.equal(denied.status, 'failed');

    assert.equal(f.host.service.skills.version(specialVersion.id).review, undefined);
    assert.equal(f.host.service.skills.record(specialSkill.id).current, undefined);

    // 2. Prepare task files for Session A
    const markerUUID = randomUUID();
    const simulatedSecret = `sk-integration-token-${randomUUID()}`;
    await writeFile(
      join(f.dir, 'deploy-spec.txt'),
      `Deployment Target: cluster-alpha-${markerUUID}\nSecret: api_key=${simulatedSecret}\n`,
    );

    const ordinaryDetail = await f.json<{ versions: SkillVersion[] }>(`/skills/${ordinarySkill.id}`);
    const ordinaryVersion = ordinaryDetail.versions.find((v) => v.id === ordinarySkill.latest);
    assert.ok(ordinaryVersion);
    const skillReadPath = join(
      f.dataDir,
      'skills/versions',
      ordinaryVersion.snapshot,
      ordinaryVersion.packageRoot,
      ordinaryVersion.skillFile,
    );

    // 3. Session A uses a text Skill and native read/write alongside Memory.
    const sessionA = await f.json<{ id: string }>('/sessions', 'POST', {
      cwd: f.dir,
      provider: 'faux',
      model: 'integration-model',
    });

    f.fake.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall('read', { path: skillReadPath }, { id: 'call-read-skill' }),
          fauxToolCall('read', { path: 'deploy-spec.txt' }, { id: 'call-read-spec' }),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage(
        [
          fauxToolCall(
            'write',
            { path: 'deployment-receipt.txt', content: `D2_RECEIPT:${markerUUID}` },
            { id: 'call-write-receipt' },
          ),
          fauxToolCall(
            'memory_save',
            {
              knowledge: {
                title: 'deployment-target',
                content: `Deployment target is cluster-alpha-${markerUUID}`,
                kind: 'decision',
                scope: 'project',
              },
              reason: 'Specified in deploy-spec.txt',
            },
            { id: 'call-save-decision' },
          ),
          fauxToolCall(
            'memory_save',
            {
              knowledge: {
                title: 'preflight-check-rule',
                content: 'Verify cluster health before deploying',
                kind: 'experience',
                scope: 'project',
              },
              reason: 'Best practice from deployment guide',
            },
            { id: 'call-save-exp' },
          ),
          fauxToolCall(
            'memory_save',
            {
              knowledge: {
                title: 'triangle-angles-fact',
                content: 'A flat triangle has three interior angles summing to 180 degrees',
                kind: 'fact',
                scope: 'global',
              },
              reason: 'Euclidean geometry definition',
            },
            { id: 'call-save-fact' },
          ),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage([fauxToolCall('read', { path: 'deployment-receipt.txt' }, { id: 'call-read-receipt' })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('Session A task execution completed with receipt and knowledge saved.'),
    ]);

    await f.json(`/sessions/${sessionA.id}/prompt`, 'POST', {
      text: 'Execute deployment according to d2-deploy-helper skill.',
    });
    const stateA = await f.settle(sessionA.id);

    // Assert Session A tool outcomes
    const receiptCalls = stateA.messages.filter(
      (m) => m.toolName === 'read' && JSON.stringify(m).includes(`D2_RECEIPT:${markerUUID}`),
    );
    assert.equal(receiptCalls.length, 1);
    assert.ok(JSON.stringify(receiptCalls).includes(`D2_RECEIPT:${markerUUID}`));
    assert.equal(await readFile(join(f.dir, 'deployment-receipt.txt'), 'utf8'), `D2_RECEIPT:${markerUUID}`);
    assert.ok(!stateA.messages.some((m) => m.toolName === 'd2_receipt'));

    const memorySaveCalls = stateA.messages.filter((m) => m.toolName === 'memory_save');
    assert.equal(memorySaveCalls.length, 3);

    // 4. Assert Diagnostic Trace and Associations for Session A
    const tracesA = await f.json<DiagnosticCatalog>(`/diagnostics?sessionId=${sessionA.id}`);
    assert.ok(tracesA.total >= 1);
    const traceA = tracesA.items[0];
    assert.ok(traceA);

    const detailA = await f.json<DiagnosticDetail>(`/diagnostics/${traceA.id}`);
    const observedSkill = detailA.calls.find((c) => c.toolName === 'read' && c.data.skillRead);
    assert.ok(observedSkill, 'Diagnostic trace must observe Skill read');
    assert.equal((observedSkill.data.skillRead as { skillId: string }).skillId, ordinarySkill.id);
    assert.equal((observedSkill.data.skillRead as { version: string }).version, ordinaryVersion.id);
    assert.equal((observedSkill.data.skillRead as { digest: string }).digest, ordinaryVersion.digest);

    const indexedReceiptCall = detailA.calls.findLast((c) => c.toolName === 'read' && !c.data.skillRead);
    assert.ok(indexedReceiptCall);
    assert.ok(indexedReceiptCall.resultEntryId);

    const indexedSaveCall = detailA.calls.find((c) => c.toolName === 'memory_save');
    assert.ok(indexedSaveCall);
    assert.ok((indexedSaveCall.data.memory as { references: unknown[] })?.references?.length);

    // Verify raw secret is NOT leaked into SQLite
    const db = new DatabaseSync(join(f.dataDir, 'product.sqlite'), { readOnly: true });
    try {
      for (const table of ['diagnostic_traces', 'diagnostic_turns', 'diagnostic_calls', 'diagnostic_events']) {
        const rows = db.prepare(`SELECT data FROM ${table}`).all();
        assert.ok(!JSON.stringify(rows).includes(simulatedSecret), `${table} must not contain secret`);
        assert.ok(!JSON.stringify(rows).includes(`D2_RECEIPT:${markerUUID}`), `${table} must not copy raw Tool output`);
      }
    } finally {
      db.close();
    }

    // 5. Session B retrieves through Memory without reading Session A or its files.
    const sessionB = await f.json<{ id: string }>('/sessions', 'POST', {
      cwd: f.dir,
      provider: 'faux',
      model: 'integration-model',
    });

    f.fake.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall('memory_search', { query: 'deployment-target' }, { id: 'call-search' }),
          fauxToolCall(
            'write',
            { path: 'current-deployment.txt', content: `Target: cluster-alpha-${markerUUID}` },
            { id: 'call-write' },
          ),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Deployment target retrieved from memory and written to file.'),
    ]);

    await f.json(`/sessions/${sessionB.id}/prompt`, 'POST', {
      text: 'Find deployment target from memory and write it to current-deployment.txt.',
    });
    const stateB = await f.settle(sessionB.id);
    const searchesB = toolResultsSince<MemoryCatalog>(stateB, 'memory_search');
    assert.equal(searchesB.length, 1);
    assert.ok(searchesB[0]?.items.some((item) => item.content.includes(markerUUID)));
    assert.ok(!stateB.messages.some((m) => m.toolName === 'read' || m.toolName === 'diagnostic_evidence'));

    const fileContent = await readFile(join(f.dir, 'current-deployment.txt'), 'utf8');
    assert.ok(fileContent.includes(markerUUID), 'Session B must write retrieved knowledge');

    // 6. Knowledge Revision & Dual-Client 409 Conflict
    const projSuffix = `?project=${encodeURIComponent(f.dir)}`;
    const memoryCatalog = await f.json<MemoryCatalog>(`/memory${projSuffix}`);
    const decisionItem = memoryCatalog.items.find((item) => item.title === 'deployment-target');
    assert.ok(decisionItem);
    assert.equal(decisionItem.revision, 1);

    // Client updates to revision 2
    const correctedUUID = randomUUID();
    const updated = await f.json<MemoryView>(`/memory/${decisionItem.id}/revise${projSuffix}`, 'POST', {
      knowledge: {
        title: 'deployment-target',
        content: `Deployment target is cluster-beta-${correctedUUID}`,
        kind: 'decision',
        scope: 'project',
      },
      reason: 'Upgraded target per engineering review',
      baseRevision: 1,
    });
    assert.equal(updated.revision, 2);

    // Stale revision 1 -> 409 Conflict
    let conflict = false;
    try {
      await f.json(`/memory/${decisionItem.id}/revise${projSuffix}`, 'POST', {
        knowledge: {
          title: 'deployment-target',
          content: 'Stale edit',
          kind: 'decision',
          scope: 'project',
        },
        reason: 'Stale attempt',
        baseRevision: 1,
      });
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 409) {
        conflict = true;
      }
    }
    assert.ok(conflict, 'Stale edit must trigger 409 Conflict');

    // Verify history preserves revision 1 and revision 2
    const decisionHistory = await f.json<MemoryDetail>(`/memory/${decisionItem.id}${projSuffix}&includeHistory=true`);
    assert.equal(decisionHistory.current.revision, 2);
    assert.equal(decisionHistory.history.length, 2);
    assert.equal(decisionHistory.history[0]?.revision, 2);
    assert.equal(decisionHistory.history[1]?.revision, 1);

    f.fake.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall('memory_search', { query: 'deployment-target' }, { id: 'call-search-corrected' }),
          fauxToolCall('memory_get', { id: decisionItem.id }, { id: 'call-get-corrected' }),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage(
        [
          fauxToolCall(
            'write',
            { path: 'current-deployment.txt', content: updated.content },
            { id: 'call-write-corrected' },
          ),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Current corrected target written.'),
    ]);
    await f.json(`/sessions/${sessionB.id}/prompt`, 'POST', {
      text: 'Retrieve the current deployment decision again and update the target file.',
    });
    const stateB2 = await f.settle(sessionB.id);
    const correctedGets = toolResultsSince<MemoryDetail>(stateB2, 'memory_get', stateB.messages.length);
    assert.equal(correctedGets.length, 1);
    assert.equal(correctedGets[0]?.current.revision, 2);
    assert.equal(correctedGets[0]?.current.content, updated.content);
    assert.equal(await readFile(join(f.dir, 'current-deployment.txt'), 'utf8'), updated.content);

    // 7. Session B Native Diagnostic Investigation & Raw Evidence Verification
    f.fake.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall('diagnostic_search', { sessionId: sessionA.id }, { id: 'call-diag-search' }),
          fauxToolCall('diagnostic_get', { traceId: traceA.id }, { id: 'call-diag-get' }),
          fauxToolCall(
            'diagnostic_evidence',
            { sessionId: sessionA.id, entryId: indexedReceiptCall.resultEntryId },
            { id: 'call-diag-evidence' },
          ),
          fauxToolCall(
            'write',
            { path: 'receipt-evidence.txt', content: `Evidence D2_RECEIPT:${markerUUID}` },
            { id: 'call-write-evidence' },
          ),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Diagnostic evidence investigated and recorded.'),
    ]);

    await f.json(`/sessions/${sessionB.id}/prompt`, 'POST', {
      text: 'Investigate Session A diagnostic trace and record the receipt evidence.',
    });
    const stateB3 = await f.settle(sessionB.id);
    assert.equal(toolResultsSince(stateB3, 'diagnostic_search', stateB2.messages.length).length, 1);
    assert.equal(toolResultsSince(stateB3, 'diagnostic_get', stateB2.messages.length).length, 1);
    const rawEvidence = toolResultsSince<{ available: boolean; content: string }>(
      stateB3,
      'diagnostic_evidence',
      stateB2.messages.length,
    );
    assert.equal(rawEvidence.length, 1);
    assert.equal(rawEvidence[0]?.available, true);
    assert.ok(rawEvidence[0]?.content.includes(`D2_RECEIPT:${markerUUID}`));

    const evidenceFile = await readFile(join(f.dir, 'receipt-evidence.txt'), 'utf8');
    assert.ok(evidenceFile.includes(`D2_RECEIPT:${markerUUID}`));

    // 8. Session A Branch Rollback: decision withdrawn, experience/facts preserved, diagnostic traces retained
    const stateANow = await f.json<SessionState>(`/sessions/${sessionA.id}`);
    const userEntry = flatten(stateANow.tree).find((n) => n.entry.message?.role === 'user');
    assert.ok(userEntry);

    await f.json(`/sessions/${sessionA.id}/branch`, 'POST', { value: userEntry.entry.id });

    // Memory reaction: decision becomes withdrawn
    const catalogAfterBranch = await f.json<MemoryCatalog>(`/memory${projSuffix}`);
    assert.ok(!catalogAfterBranch.items.some((item) => item.id === decisionItem.id));
    assert.ok(catalogAfterBranch.items.some((item) => item.title === 'preflight-check-rule'));

    const withdrawnDetail = await f.json<MemoryDetail>(`/memory/${decisionItem.id}${projSuffix}&includeHistory=true`);
    assert.equal(withdrawnDetail.current.status, 'withdrawn');
    assert.equal(withdrawnDetail.current.revision, 3);

    f.fake.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('memory_search', { query: 'deployment-target' }, { id: 'call-search-withdrawn' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage(
        [
          fauxToolCall(
            'write',
            { path: 'current-deployment.txt', content: 'NO_ACTIVE_DEPLOYMENT_DECISION' },
            { id: 'call-write-withdrawn' },
          ),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('No current deployment decision remains.'),
    ]);
    await f.json(`/sessions/${sessionB.id}/prompt`, 'POST', {
      text: 'Check current deployment memory after the rollback. If absent, write NO_ACTIVE_DEPLOYMENT_DECISION.',
    });
    const stateB4 = await f.settle(sessionB.id);
    // Earlier successful searches remain in the transcript; only this prompt is authoritative for this assertion.
    assert.ok(JSON.stringify(toolResultsSince(stateB4, 'memory_search')).includes(correctedUUID));
    const currentSearches = toolResultsSince<MemoryCatalog>(stateB4, 'memory_search', stateB3.messages.length);
    assert.equal(currentSearches.length, 1);
    assert.deepEqual(currentSearches[0]?.items, []);
    assert.equal(await readFile(join(f.dir, 'current-deployment.txt'), 'utf8'), 'NO_ACTIVE_DEPLOYMENT_DECISION');

    // Diagnostic traces in SQLite are preserved
    const tracesAfterBranch = await f.json<DiagnosticCatalog>(`/diagnostics?sessionId=${sessionA.id}`);
    assert.ok(tracesAfterBranch.items.some((trace) => trace.id === traceA.id));

    // A new explicit confirmation establishes Session B's basis without erasing A's original provenance.
    const confirmedContent = `Deployment target is cluster-gamma-${randomUUID()}`;
    f.fake.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall(
            'memory_revise',
            {
              id: decisionItem.id,
              baseRevision: 3,
              knowledge: { title: 'deployment-target', content: confirmedContent, kind: 'decision', scope: 'project' },
              reason: 'Explicitly confirmed a new target after withdrawing the old branch decision',
              confirm: true,
            },
            { id: 'call-confirm-new-basis' },
          ),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('New target explicitly confirmed.'),
    ]);
    await f.json(`/sessions/${sessionB.id}/prompt`, 'POST', {
      text: 'Explicitly confirm a new deployment decision using the supplied updated evidence.',
    });
    const stateB5 = await f.settle(sessionB.id);
    const confirmations = toolResultsSince<MemoryView>(stateB5, 'memory_revise', stateB4.messages.length);
    assert.equal(confirmations.length, 1);
    assert.equal(confirmations[0]?.revision, 4);
    assert.equal(confirmations[0]?.status, 'current');
    assert.deepEqual(
      confirmations[0]?.basis.map((source) => source.sessionId),
      [sessionB.id],
    );
    assert.ok(confirmations[0]?.sources.some((source) => source.sessionId === sessionA.id));
    assert.ok(confirmations[0]?.sources.some((source) => source.sessionId === sessionB.id));
    assert.ok(stateANow.leafId);
    await f.json(`/sessions/${sessionA.id}/branch`, 'POST', { value: stateANow.leafId });
    await f.json(`/sessions/${sessionA.id}/branch`, 'POST', { value: userEntry.entry.id });
    const confirmedDetail = await f.json<MemoryDetail>(`/memory/${decisionItem.id}${projSuffix}&includeHistory=true`);
    assert.equal(confirmedDetail.current.revision, 4, "A navigation cannot revoke B's explicit new basis");
    assert.equal(confirmedDetail.current.content, confirmedContent);
    assert.equal(confirmedDetail.history[1]?.status, 'withdrawn');

    // 9. Graceful restart consistency; existing fault-injection tests cover actual crashes.
    await f.host.close();

    // Reopen host with exact same dataDir and key
    const host2 = await startHost({ dataDir: f.dataDir, key: f.key, token: f.token });
    try {
      const skillsAfterRestart = await host2.service.skills.discover(f.dir);
      assert.ok(skillsAfterRestart.skills.find((s) => s.id === ordinarySkill.id)?.enabled);
      assert.equal(host2.service.skills.record(ordinarySkill.id).current, ordinaryVersion.id);
      assert.equal(host2.service.skills.version(ordinaryVersion.id).digest, ordinaryVersion.digest);
      assert.equal(host2.service.skills.record(specialSkill.id).current, undefined);
      assert.equal(host2.service.skills.version(specialVersion.id).review, undefined);

      const memCtx = { actor: 'agent' as const, project: f.dir };
      const searchAfterRestart = host2.service.memory.search(memCtx);
      assert.ok(searchAfterRestart.items.some((item) => item.id === decisionItem.id && item.revision === 4));
      assert.ok(searchAfterRestart.items.some((item) => item.title === 'preflight-check-rule'));

      const restartedDetail = host2.service.memory.get(memCtx, decisionItem.id, true);
      assert.deepEqual(restartedDetail, confirmedDetail);

      const diagSearchAfterRestart = host2.service.diagnostics.search(
        { actor: 'agent' as const, project: f.dir },
        { sessionId: sessionA.id },
      );
      assert.ok(diagSearchAfterRestart.items.some((trace) => trace.id === traceA.id));
      const historicalEvidence = await host2.service.diagnosticEvidence(memCtx, {
        sessionId: sessionA.id,
        entryId: indexedReceiptCall.resultEntryId,
      });
      assert.equal(historicalEvidence.available, true);
      assert.equal(historicalEvidence.onSelectedBranch, false);
      assert.ok('content' in historicalEvidence && historicalEvidence.content.includes(`D2_RECEIPT:${markerUUID}`));

      host2.service.runtime.registerNativeProvider(f.fake.provider);
      const restoredB = await host2.service.viewSession(sessionB.id);
      assert.equal(restoredB.messages.length, stateB5.messages.length);
      f.fake.setResponses([
        fauxAssistantMessage([fauxToolCall('memory_get', { id: decisionItem.id }, { id: 'call-get-after-restart' })], {
          stopReason: 'toolUse',
        }),
        fauxAssistantMessage(
          [
            fauxToolCall(
              'write',
              { path: 'current-deployment.txt', content: confirmedContent },
              { id: 'call-write-after-restart' },
            ),
          ],
          { stopReason: 'toolUse' },
        ),
        fauxAssistantMessage('Confirmed knowledge used after restart.'),
      ]);
      await host2.service.prompt(sessionB.id, 'Retrieve the current decision and write the target after reconnect.');
      const deadline = Date.now() + 15000;
      let continuedB = await host2.service.viewSession(sessionB.id);
      while (continuedB.busy && Date.now() < deadline) {
        await new Promise((ok) => setTimeout(ok, 20));
        continuedB = await host2.service.viewSession(sessionB.id);
      }
      assert.equal(continuedB.busy, false);
      const recoveredGets = toolResultsSince<MemoryDetail>(continuedB, 'memory_get', restoredB.messages.length);
      assert.equal(recoveredGets.length, 1);
      assert.equal(recoveredGets[0]?.current.revision, 4);
      assert.equal(await readFile(join(f.dir, 'current-deployment.txt'), 'utf8'), confirmedContent);
    } finally {
      await host2.close();
    }
  } finally {
    await f.close();
  }
});
