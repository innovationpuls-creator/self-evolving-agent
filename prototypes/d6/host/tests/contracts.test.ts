import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import assert from 'node:assert/strict';
import test from 'node:test';
import { detailPath, resultPath } from '../src/data';
import { parseRoute } from '../src/route';
const id = 'e14f7689-912e-45e3-90e3-ca8e6596f742';
test('detail uses record endpoint only when summary contains a record', () => {
  assert.equal(detailPath(id), `/reflections/jobs/${id}`);
  assert.equal(detailPath(id, id), `/reflections/${id}`);
});
test('memory references opt in to scoped historical revisions without global fallback', () => {
  const path = resultPath({ kind: 'memory', id, project: '/one/project', revision: 3 });
  assert.match(path, /includeHistory=true/);
  assert.match(path, /project=%2Fone%2Fproject/);
  assert.equal(resultPath({ kind: 'suggestion', id }), `/suggestions/${id}`);
  assert.equal(resultPath({ kind: 'skill', id, file: 'knowledge.md', version: id }), `/skills/${id}`);
});
test('malformed and incomplete deep links cannot crash or dispatch incomplete resource reads', () => {
  for (const value of [
    null,
    '{',
    '{}',
    'null',
    '{"page":"source"}',
    '{"page":"result"}',
    '{"page":"reflections","offset":-1}',
    '{"page":"session","sessionId":"../../"}',
  ])
    assert.deepEqual(parseRoute(value), { page: 'session' });
});
test('valid routes retain origin session, source entry and historical revision', () => {
  const routes = [
    { page: 'session', sessionId: id, entryId: 'leaf' },
    { page: 'reflections', sessionId: id, offset: 20 },
    { page: 'reflection', jobId: id, originSession: id },
    { page: 'result', target: { kind: 'memory', id, project: '/one', revision: 2 }, originSession: id },
    { page: 'source', reference: { sessionId: id, entryId: 'tool' }, project: '/one', originSession: id },
  ];
  for (const route of routes) assert.deepEqual(parseRoute(JSON.stringify(route)), route);
});

test('only persisted successful native memory writes establish operation links', async () => {
  const { nativeMemoryOperation } = await import('../src/SourceEvidence');
  const message = {
    role: 'toolResult',
    toolName: 'memory_revise',
    details: { memory: { id, revision: 2, sources: [] } },
  };
  assert.deepEqual(nativeMemoryOperation(JSON.stringify({ type: 'message', message })), message);
  assert.equal(nativeMemoryOperation('{"type":'), undefined);
  assert.equal(
    nativeMemoryOperation(JSON.stringify({ type: 'message', message: { ...message, isError: true } })),
    undefined,
  );
  assert.equal(
    nativeMemoryOperation(JSON.stringify({ type: 'message', message: { ...message, toolName: 'memory_get' } })),
    undefined,
  );
  assert.equal(
    nativeMemoryOperation(JSON.stringify({ type: 'message', message: { ...message, role: 'assistant' } })),
    undefined,
  );
});
