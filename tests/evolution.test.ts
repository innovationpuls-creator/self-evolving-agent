import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import {
  EvolutionError,
  EvolutionService,
  type EvolutionContext,
  type EvolutionInput,
} from '../apps/host/evolution/evolution.js';
import { evolutionRoutes } from '../apps/host/evolution/evolution-routes.js';
import { SensitiveData } from '../apps/host/storage/storage.js';

const input: EvolutionInput = {
  title: '保留文档来源引用',
  goal: '让导出文档保留可回溯来源',
  reason: '多个任务都需要手工回找引用',
  value: '减少重复查找，便于审查',
  uncertainty: '尚未验证引用格式与导出工具的兼容性',
  action: '讨论是否扩展现有文档能力',
  evidence: [],
  priority: 'normal',
};
function unit(db = new DatabaseSync(':memory:')) {
  const sensitive = new SensitiveData();
  let events = 0;
  const evolution = new EvolutionService(db, sensitive, () => {
    events++;
  });
  evolution.init();
  const ctx: EvolutionContext = {
    actor: 'agent',
    project: '/project-a',
    source: { sessionId: randomUUID(), entryId: 'source-entry', project: '/project-a' },
  };
  return { db, sensitive, evolution, ctx, events: () => events };
}
test('suggestion migration is repeatable, transactional and rejects unknown schema versions', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const evolution = new EvolutionService(db, new SensitiveData(), () => {});
    db.exec('CREATE TABLE evolution_suggestion_status (sentinel TEXT)');
    assert.throws(() => evolution.init());
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='evolution_suggestions'").get(), undefined);
    db.exec('DROP TABLE evolution_suggestion_status');
    evolution.init();
    evolution.init();
    db.exec("UPDATE product_migrations SET version=99 WHERE name='evolution'");
    assert.throws(() => evolution.init(), { code: 'EVOLUTION_SCHEMA' });
  } finally {
    db.close();
  }
});
test('suggestions preserve provenance, paginate and scope Agent reads without widening project access', () => {
  const f = unit();
  try {
    const source = f.ctx.source;
    assert.ok(source);
    const high = f.evolution.create(f.ctx, {
      ...input,
      priority: 'high',
      attentionReason: '多次任务都需要回溯，值得集中讨论',
      evidence: [{ sessionId: source.sessionId, entryId: source.entryId }],
    });
    f.evolution.create(f.ctx, input);
    const other = { actor: 'agent', project: '/project-b' } as const;
    f.evolution.create(other, { ...input, title: '其他项目建议' });
    assert.equal(f.evolution.list(f.ctx, { limit: 1 }).items.length, 1);
    assert.equal(f.evolution.list(f.ctx, { limit: 1, offset: 1 }).items.length, 1);
    assert.equal(f.evolution.list(f.ctx).total, 2);
    assert.equal(f.evolution.list().total, 3);
    assert.equal(f.evolution.list(f.ctx).highPriorityPending, 1);
    assert.equal(f.evolution.list(f.ctx, { sessionId: source.sessionId }).total, 2);
    assert.equal(f.evolution.list({ actor: 'user' }, { project: '/project-b' }).total, 1);
    assert.throws(() => f.evolution.get(other, high.id), { status: 404 });
    assert.throws(() => f.evolution.list(other, { project: '/project-a' }), { code: 'EVOLUTION_SCOPE' });
    assert.throws(() => f.evolution.create({ actor: 'agent' }, input), { code: 'EVOLUTION_SCOPE' });
    assert.throws(() => f.evolution.create({ ...other, source }, input), { code: 'EVOLUTION_SCOPE' });
    assert.deepEqual(f.evolution.get(f.ctx, high.id).source, source);
    assert.throws(() => f.evolution.create(f.ctx, { ...input, evidence: [{ entryId: 'orphan' }] }));
  } finally {
    f.db.close();
  }
});
test('sensitive protection runs before persistence and on read; protection failure does not save a suggestion', () => {
  const f = unit();
  try {
    const secret = 'suggestion-private-token-123456';
    f.sensitive.add(secret);
    const saved = f.evolution.create(f.ctx, {
      ...input,
      reason: `不保存 ${secret}`,
      uncertainty: 'later-secret-value-888',
    });
    assert.ok(!saved.reason.includes(secret));
    assert.ok(!JSON.stringify(f.db.prepare('SELECT data FROM evolution_suggestions').all()).includes(secret));
    f.sensitive.add('later-secret-value-888');
    assert.equal(f.evolution.get(f.ctx, saved.id).uncertainty, '[已保护]');
    const total = f.evolution.list().total;
    f.sensitive.copy = () => {
      throw new Error('injected protection failure');
    };
    assert.throws(() => f.evolution.create(f.ctx, input), { code: 'EVOLUTION_PROTECTION_FAILED' });
    assert.equal(Number(f.db.prepare('SELECT count(*) AS total FROM evolution_suggestions').get()?.total), total);
  } finally {
    f.db.close();
  }
});
test('suggestion creation and a caller receipt commit or roll back in one SQLite transaction', () => {
  const f = unit();
  try {
    f.db.exec('CREATE TABLE test_receipts(id TEXT PRIMARY KEY,suggestion TEXT)');
    const saved = f.evolution.create(f.ctx, input, (value) => {
      f.db.prepare('INSERT INTO test_receipts VALUES (?,?)').run('ok', value.id);
    });
    assert.equal(f.db.prepare('SELECT suggestion FROM test_receipts WHERE id=?').get('ok')?.suggestion, saved.id);
    const events = f.events();
    assert.throws(() =>
      f.evolution.create(f.ctx, input, (value) => {
        f.db.prepare('INSERT INTO test_receipts VALUES (?,?)').run('rollback', value.id);
        throw new Error('crash before commit');
      }),
    );
    assert.equal(f.evolution.list().total, 1);
    assert.equal(f.db.prepare('SELECT * FROM test_receipts WHERE id=?').get('rollback'), undefined);
    assert.equal(f.events(), events);
  } finally {
    f.db.close();
  }
});
test('batch ignore and archive are atomic, reject stale revisions and preserve evidence', () => {
  const f = unit();
  try {
    const a = f.evolution.create(f.ctx, input),
      b = f.evolution.create(f.ctx, input);
    const changed = f.evolution.manage([{ id: a.id, baseRevision: 1 }], 'ignored');
    assert.equal(changed.items[0]?.revision, 2);
    assert.throws(
      () =>
        f.evolution.manage(
          [
            { id: b.id, baseRevision: 1 },
            { id: a.id, baseRevision: 1 },
          ],
          'archived',
        ),
      EvolutionError,
    );
    assert.equal(f.evolution.get(f.ctx, b.id).status, 'pending');
    const archived = f.evolution.manage(
      [
        { id: a.id, baseRevision: 2 },
        { id: b.id, baseRevision: 1 },
      ],
      'archived',
    );
    assert.equal(archived.items.length, 2);
    assert.deepEqual(f.evolution.get(f.ctx, a.id).source, a.source);
    assert.equal(f.evolution.list(f.ctx, { status: 'pending' }).total, 0);
    assert.throws(() =>
      f.evolution.manage(
        [
          { id: a.id, baseRevision: 3 },
          { id: a.id, baseRevision: 3 },
        ],
        'ignored',
      ),
    );
  } finally {
    f.db.close();
  }
});
test('concurrent adoption creates one discussion and stays separate from development', async () => {
  const f = unit();
  try {
    const saved = f.evolution.create(f.ctx, input);
    let calls = 0,
      release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ensure = async (id: string) => {
      assert.match(id, /^[a-f0-9-]{36}$/);
      calls++;
      await gate;
    };
    const first = f.evolution.adopt(saved.id, 1, ensure);
    const second = f.evolution.adopt(saved.id, 1, ensure);
    await Promise.resolve();
    assert.equal(calls, 1);
    assert.equal(f.evolution.get(f.ctx, saved.id).status, 'pending');
    assert.ok(f.evolution.get(f.ctx, saved.id).discussionSessionId);
    assert.throws(() => f.evolution.manage([{ id: saved.id, baseRevision: 1 }], 'ignored'), EvolutionError);
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.discussionSessionId, b.discussionSessionId);
    assert.equal(a.status, 'adopted');
    assert.equal(a.revision, 2);
    assert.equal((await f.evolution.adopt(saved.id, 1, ensure)).discussionSessionId, a.discussionSessionId);
    assert.equal(calls, 1);
    const archived = f.evolution.manage([{ id: saved.id, baseRevision: 2 }], 'archived').items[0];
    assert.equal(archived?.discussionSessionId, a.discussionSessionId);
  } finally {
    f.db.close();
  }
});
test('failed discussion persistence reserves a stable ID and survives reopening the database', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-evolution-'));
  let db = new DatabaseSync(join(dir, 'product.sqlite'));
  try {
    let f = unit(db);
    const saved = f.evolution.create(f.ctx, input);
    const completed = new Set<string>();
    let originalId = '';
    await assert.rejects(
      f.evolution.adopt(saved.id, 1, async (id) => {
        originalId = id;
        completed.add(id);
        throw new Error('crash after encrypted Session write');
      }),
    );
    assert.equal(f.evolution.get(f.ctx, saved.id).status, 'pending');
    assert.match(f.evolution.get(f.ctx, saved.id).discussionError ?? '', /重试采纳/);
    db.close();
    db = new DatabaseSync(join(dir, 'product.sqlite'));
    f = unit(db);
    const adopted = await f.evolution.adopt(saved.id, 1, async (id) => {
      assert.equal(id, originalId);
      assert.ok(completed.has(id));
    });
    assert.equal(adopted.status, 'adopted');
    assert.equal(adopted.discussionError, undefined);
    assert.equal(completed.size, 1);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('an adoption final-state write failure can resume with the same discussion ID', async () => {
  const f = unit();
  try {
    const saved = f.evolution.create(f.ctx, input);
    let id = '';
    f.db.exec(`CREATE TRIGGER fail_adopt BEFORE UPDATE ON evolution_suggestions
      WHEN NEW.status='adopted' BEGIN SELECT RAISE(ABORT,'injected'); END`);
    await assert.rejects(
      f.evolution.adopt(saved.id, 1, async (sessionId) => {
        id = sessionId;
      }),
    );
    assert.equal(f.evolution.get(f.ctx, saved.id).status, 'pending');
    assert.equal(f.evolution.get(f.ctx, saved.id).discussionSessionId, id);
    f.db.exec('DROP TRIGGER fail_adopt');
    assert.equal(
      (
        await f.evolution.adopt(saved.id, 1, async (sessionId) => {
          assert.equal(sessionId, id);
        })
      ).status,
      'adopted',
    );
  } finally {
    f.db.close();
  }
});
test('HTTP suggestions share authoritative state and reject caller-controlled source fields', async () => {
  const f = unit();
  let discussions = 0;
  const server = createServer((req, res) => {
    void evolutionRoutes(
      f.evolution,
      async () => {
        discussions++;
      },
      req,
      res,
      new URL(req.url ?? '/', 'http://localhost'),
      async (_ctx, value) => {
        if (value.title === '不存在的引用') throw new EvolutionError('引用不存在', 404, 'EVOLUTION_EVIDENCE_NOT_FOUND');
      },
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const request = (path: string, value?: unknown) =>
    fetch(`http://127.0.0.1:${address.port}/api/suggestions${path}`, {
      method: value === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
  try {
    assert.equal((await request('', { ...input, source: f.ctx.source })).status, 400);
    assert.equal((await request('', { ...input, title: '不存在的引用' })).status, 404);
    const response = await request('', input);
    assert.equal(response.status, 201);
    const saved = await response.json();
    assert.equal((await request(`/${saved.id}/adopt`, { baseRevision: 1 })).status, 200);
    assert.equal((await request(`/${saved.id}/adopt`, { baseRevision: 1 })).status, 200);
    assert.equal(discussions, 1);
    assert.equal((await (await request(`/${saved.id}`)).json()).status, 'adopted');
    assert.equal(
      (await request('/manage', { items: [{ id: saved.id, baseRevision: 1 }], status: 'ignored' })).status,
      409,
    );
    assert.equal((await (await request('?status=adopted')).json()).total, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    f.db.close();
  }
});
