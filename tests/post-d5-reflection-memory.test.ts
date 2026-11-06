import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { memoryTools } from '../apps/host/memory/memory-tools.js';
import { memoryFeedback } from '../apps/host/memory/memory-feedback.js';
import { reflectionOutputGuidance } from '../apps/host/reflection/reflection-prompt.js';
import { catalogFixture } from '../scripts/post-d5-reflection-memory.js';
import { present } from './support.js';

test('light catalog pages all history with bounded queries, complete detail, and no environment probes', async () => {
  let checks = 0;
  const fixture = await catalogFixture(125, {
    async available() {
      checks++;
      return { available: true };
    },
    async execute() {},
  });
  try {
    let queries = 0;
    const prepare = fixture.db.prepare.bind(fixture.db);
    fixture.db.prepare = (sql) => {
      queries++;
      return prepare(sql);
    };
    const first = fixture.service.catalog({ sessionId: fixture.sessionId });
    assert.equal(first.jobs.length, 20);
    assert.equal(first.total, 125);
    assert.equal(queries, 2);
    assert.equal(checks, 0);
    assert.equal(first.jobs[0]?.sourceCount, 3);
    assert.ok(first.records.every((record) => record.summary.length <= 240 && !('evidence' in record)));
    assert.ok(first.jobs.every((job) => !('sources' in job)));
    const ids = new Set<string>();
    for (let offset = 0; offset < 125; offset += 20)
      for (const job of fixture.service.catalog({ offset }).jobs) ids.add(job.id);
    assert.equal(ids.size, 125, 'Entries beyond the old 100-record cap remain reachable');
    for (const record of fixture.originals)
      assert.deepEqual(fixture.service.get(record.id), { ...record, error: undefined });
    assert.equal(fixture.service.catalog({ offset: 500 }).jobs.length, 0);
    assert.equal(fixture.service.catalog({ sessionId: randomUUID() }).total, 0);
    assert.throws(() => fixture.service.catalog({ limit: 101 }));
    assert.throws(() => fixture.service.catalog({ offset: -1 }));
  } finally {
    await fixture.close();
  }
});

test('status projection prioritizes active work across pages and counts pending without full records', async () => {
  const fixture = await catalogFixture(125);
  try {
    fixture.db.prepare("UPDATE reflection_jobs SET status='pending' WHERE created<4").run();
    fixture.db.prepare("UPDATE reflection_jobs SET status='running' WHERE created=0").run();
    const status = fixture.service.catalog({ statusOnly: true });
    assert.equal(status.pending, 3);
    assert.equal(status.total, 125);
    assert.equal(status.jobs.length, 1);
    assert.equal(status.jobs[0]?.status, 'running');
    assert.deepEqual(status.records, []);
  } finally {
    await fixture.close();
  }
});

test('environment probes are single-flight, cached, explicitly refreshed and cancellable', async () => {
  let checks = 0;
  const fixture = await catalogFixture(0, {
    async available(signal) {
      checks++;
      await new Promise<void>((done, fail) => {
        const timer = setTimeout(done, 20);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            fail(signal.reason);
          },
          { once: true },
        );
      });
      return { available: true };
    },
    async execute() {},
  });
  try {
    await Promise.all([fixture.service.availability(), fixture.service.availability()]);
    await fixture.service.availability();
    assert.equal(checks, 1);
    await fixture.service.recheck();
    assert.equal(checks, 2);
    assert.equal(fixture.service.catalog().availability.available, true);
    const controller = new AbortController();
    const pending = fixture.service.recheck(controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(checks, 3);
    assert.equal(fixture.service.jobs.list().length, 0);
  } finally {
    await fixture.close();
  }
});

test('reflection output guidance permits concise Chinese evidence-only and no new findings', () => {
  assert.match(reflectionOutputGuidance, /简体中文/);
  assert.match(reflectionOutputGuidance, /1–2 句/);
  assert.match(reflectionOutputGuidance, /没有新增发现/);
  assert.match(reflectionOutputGuidance, /仅列证据支持/);
  assert.match(reflectionOutputGuidance, /不是本次事实/);
});

test('cancelling one environment waiter cannot cancel another; force joins a live probe', async () => {
  let checks = 0;
  let aborted = 0;
  const fixture = await catalogFixture(0, {
    async available(signal) {
      checks++;
      await new Promise<void>((done, reject) => {
        const timer = setTimeout(done, 30);
        signal?.addEventListener(
          'abort',
          () => {
            aborted++;
            clearTimeout(timer);
            reject(signal.reason);
          },
          { once: true },
        );
      });
      return { available: true };
    },
    async execute() {},
  });
  try {
    const first = new AbortController();
    const cancelled = fixture.service.availability(false, first.signal);
    const retained = fixture.service.availability(true);
    first.abort();
    await assert.rejects(cancelled, { name: 'AbortError' });
    assert.equal((await retained).available, true);
    assert.equal(checks, 1);
    assert.equal(aborted, 0);
    const last = new AbortController();
    const alone = fixture.service.availability(true, last.signal);
    last.abort();
    await assert.rejects(alone, { name: 'AbortError' });
    assert.equal(aborted, 1);
    assert.equal((await fixture.service.availability(true)).available, true);
    assert.equal(checks, 3);
  } finally {
    await fixture.close();
  }
});

test('Memory writes emit revision/source feedback; reads never write, errors never claim success', async () => {
  const fixture = await catalogFixture(0);
  try {
    const source = { sessionId: randomUUID(), entryId: 'memory-call-entry', project: fixture.root };
    fixture.host.memory.reconcileSource(source.sessionId, source.entryId, [source.entryId]);
    let sourceCalls = 0;
    const tools = memoryTools(fixture.host.memory, fixture.root, async () => {
      sourceCalls++;
      return { actor: 'agent', project: fixture.root, source };
    });
    const call = (name: string, args: unknown, signal?: AbortSignal) => {
      const tool = tools.find((candidate) => candidate.name === name);
      assert.ok(tool);
      return Reflect.apply(tool.execute, tool, [randomUUID(), args, signal]);
    };
    const ctx = { actor: 'user', project: fixture.root } as const;
    const knowledge = { title: '可追溯认识', content: '用户明确提供的事实', scope: 'project', kind: 'fact' };
    await call('memory_search', { query: '' });
    assert.equal(sourceCalls, 0);
    assert.equal(fixture.host.memory.search(ctx).total, 0);
    const saved = await call('memory_save', { knowledge, reason: '用户本轮说明' });
    assert.equal(saved.isError, undefined);
    const current = present(fixture.host.memory.search(ctx).items[0]);
    assert.deepEqual(saved.details, { memory: memoryFeedback(current) });
    assert.equal(memoryFeedback(current).sources[0]?.sessionId, source.sessionId);
    assert.match(memoryFeedback(current).message, /新增记忆/);
    const revised = await call('memory_revise', {
      id: current.id,
      baseRevision: 1,
      knowledge: { ...knowledge, content: '修正后的事实' },
      reason: '用户新证据',
    });
    const latest = fixture.host.memory.get(ctx, current.id, true).current;
    assert.deepEqual(revised.details, { memory: memoryFeedback(latest) });
    assert.match(memoryFeedback(latest).message, /替代 #1/);
    const stale = await call('memory_revise', { id: current.id, baseRevision: 1, knowledge, reason: '过期编辑' });
    assert.equal(stale.isError, true);
    assert.deepEqual(stale.details, {});
    const aborted = new AbortController();
    aborted.abort();
    const cancelled = await call('memory_save', { knowledge, reason: '不应执行' }, aborted.signal);
    assert.equal(cancelled.isError, true);
    await call('memory_get', { id: current.id, includeHistory: true });
    assert.equal(fixture.host.memory.get(ctx, current.id, true).history.length, 2);
    assert.equal(fixture.host.memory.search(ctx).total, 1);
    assert.ok(tools.every((tool) => tool.promptGuidelines?.join(' ').includes('not on every turn')));
  } finally {
    await fixture.close();
  }
});
