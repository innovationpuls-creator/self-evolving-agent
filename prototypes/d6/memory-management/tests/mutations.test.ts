import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDrafts, newMemoryDraft, submitMemory, reconcileMemory } from '../../src/real/memory-management';
import type { Api } from '../../src/real/types';
import type { MemoryView } from '../../../../apps/host/memory/memory';
const view: MemoryView = {
  id: 'a',
  revision: 1,
  previousRevision: null,
  title: 'Test',
  content: 'body',
  scope: 'project',
  kind: 'fact',
  project: 'hash',
  status: 'current',
  operation: 'create',
  reason: 'test',
  actor: 'user',
  created: 1,
  sources: [],
  basis: [],
  isCurrent: true,
  usable: true,
  unavailable: false,
};
test('a sent request with no reply remains uncertain; no implicit retry', async () => {
  const s = new MemoryDrafts(),
    d = { ...newMemoryDraft('/p', 'create'), reason: 'r' };
  let requests = 0;
  await submitMemory(
    (async () => {
      requests++;
      throw Error('offline');
    }) as Api,
    s,
    d,
  );
  assert.equal(s.get(d.key)?.phase, 'uncertain');
  assert.equal(s.get(d.key)?.reason, 'r');
  assert.equal(requests, 1);
});
test('HTTP conflict retains exact base and local text', async () => {
  const s = new MemoryDrafts(),
    d = { ...newMemoryDraft('/p', 'revise', view), knowledge: { ...view, content: 'my draft' } };
  await submitMemory(
    (async () => {
      throw Object.assign(Error('conflict'), { status: 409 });
    }) as Api,
    s,
    d,
  );
  assert.equal(s.get(d.key)?.phase, 'conflict');
  assert.equal(s.get(d.key)?.base?.revision, 1);
  assert.equal(s.get(d.key)?.knowledge.content, 'my draft');
});
test('acknowledged commit cannot be retried while authoritative read fails', async () => {
  const s = new MemoryDrafts(),
    d = newMemoryDraft('/p', 'create');
  let writes = 0;
  const api = (async (_p: string, method = 'GET') => {
    if (method === 'POST') {
      writes++;
      return view;
    }
    throw Error('offline');
  }) as Api;
  await submitMemory(api, s, d);
  assert.equal(s.get(d.key)?.phase, 'uncertain');
  assert.equal(s.get(d.key)?.receipt?.id, 'a');
  const pending = s.get(d.key);
  assert.ok(pending);
  await submitMemory(api, s, pending);
  assert.equal(writes, 1);
  await reconcileMemory((async () => ({ current: view, history: [view] })) as Api, s, pending);
  assert.equal(s.get(d.key)?.phase, 'saved');
});
test('Host current advancing after commit preserves original receipt', async () => {
  const s = new MemoryDrafts(),
    d = newMemoryDraft('/p', 'create');
  await submitMemory(
    (async (_p: string, m = 'GET') =>
      m === 'POST' ? view : { current: { ...view, revision: 2 }, history: [{ ...view, revision: 2 }, view] }) as Api,
    s,
    d,
  );
  assert.equal(s.get(d.key)?.phase, 'saved');
  assert.equal(s.get(d.key)?.receipt?.revision, 1);
  assert.equal(s.get(d.key)?.latest?.current.revision, 2);
});
test('two submit handlers for the same draft cannot send a second in-flight write', async () => {
  const s = new MemoryDrafts(),
    d = newMemoryDraft('/p', 'create');
  let release!: () => void,
    writes = 0;
  const held = new Promise<void>((r) => {
    release = r;
  });
  const api = (async (_p: string, m = 'GET') => {
    if (m === 'POST') {
      writes++;
      await held;
      return view;
    }
    return { current: view, history: [view] };
  }) as Api;
  const first = submitMemory(api, s, d);
  await submitMemory(api, s, d);
  assert.equal(writes, 1);
  release();
  await first;
  assert.equal(s.get(d.key)?.phase, 'saved');
});
