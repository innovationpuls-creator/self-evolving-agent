import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { ReflectionService } from '../../../../apps/host/reflection/reflection-service';
import { evolutionEvidence } from '../../../../apps/host/evolution/evolution';
import { catalog, createFixture, createTransport, statuses } from '../src/fixtures';

function required<T>(value: T | null | undefined): T {
  assert(value != null);
  return value;
}

test('deterministic fixtures cover every job/source state and material record shape', () => {
  for (const seed of [1, 25, 7919]) {
    const f = createFixture({ seed, count: 47 });
    assert.deepEqual(f, createFixture({ seed, count: 47 }));
    assert.deepEqual(new Set(f.details.map((d) => d.job.status)), new Set(statuses));
    assert.equal(f.details.filter((d) => d.job.status === 'running').length, 1);
    assert.deepEqual(
      new Set(f.details.flatMap((d) => d.job.sources.map((s) => s.status))),
      new Set(['ended', 'stopped', 'failed']),
    );
    assert(f.details.some((d) => !d.record));
    assert(f.details.some((d) => d.record?.summary === ''));
    assert(
      f.details.some((d) => d.record && !d.record.findings.length && !d.record.changes.length && d.record.summary),
    );
    assert(f.details.some((d) => (d.record?.summary.length || 0) > 240));
    assert(new Set(f.sessions.map((s) => s.title)).size < f.sessions.length);
    assert(new Set(f.sessions.map((s) => s.cwd)).size > 1);
    for (const status of ['failed', 'interrupted'])
      assert(f.details.some((d) => d.job.status === status && d.record?.changes.length));
    for (const d of f.details) for (const e of d.record?.evidence || []) evolutionEvidence.parse(e);
  }
});

test('projection matches actual Host catalog SQL: Unicode, paging, session and status view', () => {
  const fixture = createFixture({ seed: 7919, count: 47, scenario: 'environment-unchecked' });
  required(fixture.details[0].record).summary = '🧭'.repeat(260);
  const db = new DatabaseSync(':memory:');
  // Only catalog/init dependencies are exercised; no model, disk store or native executor runs.
  const dependencies = {
    db,
    sensitive: { copy: <T>(v: T) => structuredClone(v) },
    changed: () => {},
    executor: { available: async () => ({ available: true }), execute: async () => {} },
  };
  const service = new ReflectionService(dependencies as unknown as ConstructorParameters<typeof ReflectionService>[0]);
  service.init();
  try {
    for (const { job, record } of fixture.details) {
      db.prepare(
        'INSERT INTO reflection_jobs(id,session_id,project,provider,model,scheduled_at,created,updated,run_id,reflection_session_id,status,last_marker_entry_id,error) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ).run(
        job.id,
        job.sessionId,
        job.project,
        job.provider,
        job.model,
        job.scheduledAt,
        job.created,
        job.updated,
        job.runId,
        job.reflectionSessionId || null,
        job.status,
        job.sources[0].markerEntryId,
        job.error || null,
      );
      for (const source of job.sources)
        db.prepare(
          'INSERT INTO reflection_job_sources(job_id,session_id,marker_entry_id,settled_at,trace_id,status) VALUES(?,?,?,?,?,?)',
        ).run(job.id, job.sessionId, source.markerEntryId, source.settledAt, source.traceId || null, source.status);
      if (record)
        db.prepare('INSERT INTO reflections VALUES(?,?,?,?)').run(
          record.id,
          record.sessionId,
          record.project,
          JSON.stringify(record),
        );
    }
    for (const input of [
      {},
      { offset: 20 },
      { offset: 40 },
      { sessionId: fixture.sessions[4].id },
      { statusOnly: true },
    ])
      assert.deepEqual(catalog(fixture, input), service.catalog(input));
  } finally {
    db.close();
  }
});

test('summary excludes detail-only fields; sourceCount remains a source count', () => {
  const f = createFixture(),
    view = catalog(f);
  for (const j of view.jobs) {
    for (const name of ['project', 'changes', 'uncertainties', 'findings', 'sources']) assert(!(name in j));
    assert.equal(j.sourceCount, required(f.details.find((d) => d.job.id === j.id)).job.sources.length);
  }
  for (const r of view.records) assert.deepEqual(Object.keys(r).sort(), ['id', 'jobId', 'summary']);
});

test('details load on demand; failed jobs retain committed changes', async () => {
  const f = createFixture(),
    api = createTransport(f);
  await api.catalog({});
  assert.equal(api.calls.filter((c) => c.operation === 'detail').length, 0);
  const failed = required(f.details.find((d) => d.job.status === 'failed'));
  assert.deepEqual(await api.detail(failed.job.id), failed);
  assert(required(failed.record).changes.length);
});

test('read failures can be retried without re-executing tasks', async () => {
  const list = createTransport(createFixture({ scenario: 'list-error' }));
  await assert.rejects(list.catalog({}), { status: 503 });
  assert((await list.catalog({})).jobs.length);
  const f = createFixture({ scenario: 'detail-error' }),
    api = createTransport(f);
  await assert.rejects(api.detail(f.details[0].job.id), { status: 503 });
  assert((await api.detail(f.details[0].job.id)).record);
  assert(!api.calls.some((c) => ['recheck', 'expedite', 'execute'].includes(c.operation)));
});

test('source limitations and access denial remain distinct', async () => {
  for (const scenario of [
    'source-missing',
    'source-truncated',
    'source-old-branch',
    'source-previous',
    'source-denied',
  ] as const) {
    const f = createFixture({ scenario }),
      api = createTransport(f),
      ref = required(f.details[0].record).evidence[0];
    if (scenario === 'source-denied')
      await assert.rejects(api.source(required(ref.sessionId), required(ref.entryId)), { status: 403 });
    else {
      const e = await api.source(required(ref.sessionId), required(ref.entryId));
      if (scenario === 'source-missing') {
        assert.equal(e.available, false);
        assert(!('content' in e));
      }
      if (scenario === 'source-truncated') assert(e.truncated);
      if (scenario === 'source-old-branch') assert.equal(e.onSelectedBranch, false);
      if (scenario === 'source-previous') assert.equal(e.source, 'previous_checkpoint');
    }
  }
});

test('cancelled reads reject rather than returning stale data', async () => {
  const api = createTransport(createFixture()),
    controller = new AbortController();
  const pending = api.catalog({}, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
