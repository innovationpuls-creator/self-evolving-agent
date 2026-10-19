import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { ReflectionJobs, type ReflectionRegistration } from '../apps/host/reflection/reflection-jobs.js';

function fixture(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  let now = 1000;
  let notifications = 0;
  const changed = () => notifications++;
  const options = { now: () => now };
  const jobs = new ReflectionJobs(db, changed, options);
  jobs.init();
  const input = (
    markerEntryId: string,
    ancestorIds: string[] = [],
    sessionId = 'session-a',
  ): ReflectionRegistration => ({
    sessionId,
    markerEntryId,
    project: '/project',
    provider: 'test-provider',
    model: 'test-model',
    settledAt: now,
    status: 'ended',
    ancestorIds: [...ancestorIds, markerEntryId],
  });
  return {
    db,
    jobs,
    changed,
    options,
    input,
    advance(ms: number) {
      now += ms;
    },
    notifications: () => notifications,
  };
}

test('Reflection is not claimable before 30 seconds and claim allocates independent run and Session IDs', (t) => {
  const f = fixture(t);
  const job = f.jobs.register(f.input('first'));
  assert.equal(job.scheduledAt, 31_000);
  assert.equal(job.runId, null);
  assert.equal(
    f.jobs.pendingClaim(() => true),
    undefined,
  );
  f.advance(29_999);
  assert.equal(
    f.jobs.pendingClaim(() => true),
    undefined,
  );
  f.advance(1);
  const running = f.jobs.pendingClaim(() => true);
  assert.ok(running);
  assert.equal(running.id, job.id);
  assert.equal(running.status, 'running');
  assert.match(running.runId ?? '', /^[a-f0-9-]{36}$/);
  assert.match(running.reflectionSessionId ?? '', /^[a-f0-9-]{36}$/);
  assert.notEqual(running.reflectionSessionId, running.sessionId);
  assert.notEqual(running.reflectionSessionId, running.runId);
});

test('same native branch merges every source and restarts 30-second waiting', (t) => {
  const f = fixture(t);
  const first = f.jobs.register({ ...f.input('first'), traceId: 'trace-first' });
  f.advance(20_000);
  const merged = f.jobs.register({ ...f.input('second', ['first']), model: 'new-model', status: 'stopped' });
  assert.equal(merged.id, first.id);
  assert.equal(merged.scheduledAt, 51_000);
  assert.equal(merged.model, 'new-model');
  assert.deepEqual(
    merged.sources.map((source) => [source.markerEntryId, source.traceId, source.status]),
    [
      ['first', 'trace-first', 'ended'],
      ['second', undefined, 'stopped'],
    ],
  );
  f.advance(10_000);
  assert.equal(
    f.jobs.pendingClaim(() => true),
    undefined,
  );
  f.advance(20_000);
  assert.equal(f.jobs.pendingClaim(() => true)?.id, first.id);
});

test('siblings in a native Session and separate Sessions retain independent jobs', (t) => {
  const f = fixture(t);
  const first = f.jobs.register(f.input('left', ['root']));
  const sibling = f.jobs.register(f.input('right', ['root']));
  const separate = f.jobs.register(f.input('other', [], 'session-b'));
  assert.equal(new Set([first.id, sibling.id, separate.id]).size, 3);
  assert.equal(f.jobs.list({ sessionId: 'session-a' }).length, 2);
  assert.equal(f.jobs.list({ sessionId: 'session-b', status: 'pending' }).length, 1);
  f.advance(10);
  assert.equal(f.jobs.register(f.input('left-followup', ['root', 'left'])).id, first.id);
  assert.deepEqual(
    f.jobs.get(sibling.id)?.sources.map((source) => source.markerEntryId),
    ['right'],
  );
});

test('duplicate settled markers are idempotent before and after task completion', (t) => {
  const f = fixture(t);
  const original = f.input('first');
  const job = f.jobs.register(original);
  const notifications = f.notifications();
  f.advance(50_000);
  assert.deepEqual(f.jobs.register(original), job);
  assert.equal(f.notifications(), notifications);
  const running = f.jobs.pendingClaim(() => true);
  assert.ok(running?.runId);
  assert.equal(f.jobs.finish(running.id, running.runId, 'succeeded'), true);
  const completed = f.jobs.get(job.id);
  assert.deepEqual(f.jobs.register(original), completed);
  assert.equal(f.jobs.list().length, 1);
});

test('running sources stay frozen while new work merges into one follow-up', (t) => {
  const f = fixture(t);
  const first = f.jobs.register(f.input('first'));
  f.advance(30_000);
  const running = f.jobs.pendingClaim(() => true);
  assert.ok(running?.runId);
  const followup = f.jobs.register(f.input('second', ['first']));
  f.advance(10_000);
  const merged = f.jobs.register(f.input('third', ['first', 'second']));
  assert.notEqual(followup.id, first.id);
  assert.equal(merged.id, followup.id);
  assert.deepEqual(f.jobs.get(first.id), running);
  f.advance(30_000);
  assert.equal(
    f.jobs.pendingClaim(() => true),
    undefined,
    'default Worker capacity is one',
  );
  assert.equal(f.jobs.finish(first.id, running.runId, 'succeeded'), true);
  assert.equal(f.jobs.pendingClaim(() => true)?.id, followup.id);
});

test('foreground priority can defer a Session without losing another due Session', (t) => {
  const f = fixture(t);
  const busy = f.jobs.register(f.input('first'));
  const idle = f.jobs.register(f.input('second', [], 'session-b'));
  f.advance(30_000);
  assert.equal(
    f.jobs.pendingClaim(() => false),
    undefined,
  );
  assert.equal(f.jobs.list({ status: 'pending' }).length, 2);
  assert.equal(f.jobs.pendingClaim((sessionId) => sessionId !== busy.sessionId)?.id, idle.id);
  assert.equal(f.jobs.get(busy.id)?.status, 'pending');
});

test('explicit Session departure advances pending work without advancing other Sessions or running jobs', (t) => {
  const f = fixture(t);
  const first = f.jobs.register(f.input('first'));
  const other = f.jobs.register(f.input('second', [], 'session-b'));
  assert.equal(f.jobs.expedite('session-a'), 1);
  assert.equal(f.jobs.expedite('session-a'), 0);
  const running = f.jobs.pendingClaim(() => true);
  assert.ok(running);
  assert.equal(running.id, first.id);
  assert.equal(f.jobs.expedite('session-a'), 0);
  assert.equal(f.jobs.get(other.id)?.scheduledAt, other.scheduledAt);
});

test('unavailable isolation keeps merged work waiting for explicit capability recheck', (t) => {
  const f = fixture(t);
  const first = f.jobs.register(f.input('first'));
  assert.equal(f.jobs.setUnavailable('Sandbox unavailable'), 1);
  f.advance(10_000);
  const merged = f.jobs.register(f.input('second', ['first']));
  assert.equal(merged.id, first.id);
  assert.equal(merged.status, 'waiting_user');
  assert.equal(merged.error, 'Sandbox unavailable');
  assert.equal(merged.sources.length, 2);
  f.advance(30_000);
  assert.equal(
    f.jobs.pendingClaim(() => true),
    undefined,
  );
  assert.equal(f.jobs.recheck(), 1);
  assert.equal(f.jobs.get(first.id)?.scheduledAt, merged.scheduledAt);
  assert.equal(f.jobs.get(first.id)?.error, undefined);
  assert.equal(f.jobs.pendingClaim(() => true)?.id, first.id);
});

test('startup interrupts prior running attempts and rejects their late results while preserving pending follow-up', (t) => {
  const f = fixture(t);
  f.jobs.register(f.input('first'));
  f.advance(30_000);
  const running = f.jobs.pendingClaim(() => true);
  assert.ok(running?.runId);
  const followup = f.jobs.register(f.input('second', ['first']));
  const restored = new ReflectionJobs(f.db, f.changed, f.options);
  assert.equal(restored.init(), 1);
  assert.equal(restored.get(running.id)?.status, 'interrupted');
  assert.equal(restored.finish(running.id, running.runId, 'succeeded'), false);
  assert.deepEqual(restored.get(followup.id), followup);
  f.advance(30_000);
  const next = restored.pendingClaim(() => true);
  assert.equal(next?.id, followup.id);
  assert.notEqual(next?.runId, running.runId);
  assert.equal(restored.list({ status: 'interrupted' }).length, 1);
});

test('job and source writes roll back together and notification follows commit', (t) => {
  const f = fixture(t);
  const first = f.jobs.register(f.input('first'));
  const notifications = f.notifications();
  f.db.exec(`CREATE TRIGGER fail_reflection_source BEFORE INSERT ON reflection_job_sources
    WHEN NEW.marker_entry_id='bad' BEGIN SELECT RAISE(ABORT,'source write failed'); END`);
  f.advance(20_000);
  assert.throws(() => f.jobs.register(f.input('bad', ['first'])), /source write failed/);
  assert.deepEqual(f.jobs.get(first.id), first);
  assert.throws(() => f.jobs.register(f.input('bad', [], 'session-b')), /source write failed/);
  assert.equal(f.jobs.list().length, 1);
  assert.equal(f.notifications(), notifications);
  f.db.exec('DROP TRIGGER fail_reflection_source');
  assert.equal(f.jobs.register(f.input('second', ['first'])).sources.length, 2);
});

test('failed claim predicates leave task state intact and do not leave an open transaction', (t) => {
  const f = fixture(t);
  const first = f.jobs.register(f.input('first'));
  f.advance(30_000);
  assert.throws(
    () =>
      f.jobs.pendingClaim(() => {
        throw new Error('foreground state unavailable');
      }),
    /foreground state unavailable/,
  );
  assert.equal(f.jobs.get(first.id)?.status, 'pending');
  const running = f.jobs.pendingClaim(() => true);
  assert.ok(running?.runId);
  assert.equal(f.jobs.finish(running.id, 'stale-attempt', 'failed', 'late error'), false);
  assert.equal(f.jobs.finish(running.id, running.runId, 'failed', 'model timeout'), true);
  assert.equal(f.jobs.get(first.id)?.error, 'model timeout');
  assert.equal(f.jobs.finish(running.id, running.runId, 'succeeded'), false);
});

test('pending tasks and original plan survive closing and reopening the SQLite file', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'reflection-jobs-'));
  const path = join(dir, 'product.sqlite');
  let db = new DatabaseSync(path);
  t.after(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
  const jobs = new ReflectionJobs(db, () => {}, { now: () => 1000 });
  jobs.init();
  const job = jobs.register({
    sessionId: 'session-a',
    markerEntryId: 'first',
    project: '/project',
    provider: 'test-provider',
    model: 'test-model',
    settledAt: 1000,
    status: 'failed',
    ancestorIds: ['first'],
  });
  db.close();
  db = new DatabaseSync(path);
  const reopened = new ReflectionJobs(db, () => {}, { now: () => 32_000 });
  assert.equal(reopened.init(), 0);
  assert.deepEqual(reopened.get(job.id), job);
  assert.equal(reopened.pendingClaim(() => true)?.id, job.id);
  assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
});

test('notification failure cannot report a committed registration as rolled back', (t) => {
  const f = fixture(t);
  const jobs = new ReflectionJobs(
    f.db,
    () => {
      throw new Error('client disconnected');
    },
    f.options,
  );
  const job = jobs.register(f.input('first'));
  assert.equal(jobs.get(job.id)?.sources.length, 1);
});
