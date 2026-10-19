import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { MemoryService, MemoryError, type MemoryContext, type MemoryView } from '../apps/host/memory/memory.js';
import { SensitiveData, type Snapshot } from '../apps/host/storage/storage.js';
import { startHost } from '../apps/host/transport/server.js';

const knowledge = {
  title: '数据库认识',
  content: '项目采用 PostgreSQL 数据库',
  kind: 'decision',
  scope: 'project',
} as const;
function unit() {
  const db = new DatabaseSync(':memory:'),
    sensitive = new SensitiveData();
  let events = 0;
  const memory = new MemoryService(db, sensitive, () => {
    events++;
  });
  memory.init();
  const ctx: MemoryContext = {
    actor: 'agent',
    project: '/project-a',
    source: { sessionId: randomUUID(), entryId: 'entry-a', project: '/project-a' },
  };
  const source = ctx.source;
  assert.ok(source);
  memory.reconcileSource(source.sessionId, source.entryId, [source.entryId]);
  return {
    db,
    sensitive,
    memory,
    ctx,
    source,
    events: () => events,
    close: () => {
      memory.close();
      db.close();
    },
  };
}
test('Memory migrations are transactional, repeatable, and reject unknown versions', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE memory_fts (sentinel TEXT)');
    const memory = new MemoryService(db, new SensitiveData(), () => {});
    assert.throws(() => memory.init());
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='memory_revisions'").get(), undefined);
    db.exec('DROP TABLE memory_fts');
    memory.init();
    memory.init();
    db.exec("UPDATE product_migrations SET version=99 WHERE name='memory'");
    assert.throws(() => memory.init(), MemoryError);
  } finally {
    db.close();
  }
});
test('Memory revisions preserve evidence, distinguish hypotheses, scope history and reject stale edits', () => {
  const f = unit();
  try {
    const first = f.memory.create(f.ctx, knowledge, '实验依据');
    assert.equal(f.memory.search(f.ctx, { query: '数据库' }).total, 1);
    assert.equal(f.memory.search(f.ctx, { query: '采用' }).total, 1);
    assert.equal(f.memory.search(f.ctx, { query: '" OR *' }).total, 0);
    const other: MemoryContext = { actor: 'agent', project: '/project-b' };
    assert.equal(f.memory.search(other).total, 0);
    assert.throws(() => f.memory.get(other, first.id, true), { status: 404 });
    assert.throws(() => f.memory.revise(other, first.id, { baseRevision: 1, reason: '越项目', retire: true }), {
      status: 404,
    });
    const second = f.memory.revise(f.ctx, first.id, {
      baseRevision: 1,
      content: { ...knowledge, kind: 'hypothesis', content: '可能需要 SQLite，尚未验证' },
      reason: '新证据不足',
    });
    assert.equal(second.kind, 'hypothesis');
    assert.equal(second.status, 'current');
    assert.throws(() => f.memory.revise(f.ctx, first.id, { baseRevision: 1, reason: '旧缓冲', retire: true }), {
      status: 409,
    });
    assert.equal(f.memory.get(f.ctx, first.id, true).history.length, 2);
    assert.equal(f.memory.search(f.ctx, { query: 'PostgreSQL' }).total, 0);
    assert.equal(f.memory.search(f.ctx, { query: 'PostgreSQL', includeHistory: true }).items[0]?.isCurrent, false);
    const global = f.memory.revise(f.ctx, first.id, {
      baseRevision: 2,
      content: { ...knowledge, scope: 'global' },
      reason: '已提炼为通用知识',
    });
    assert.equal(f.memory.get(other, global.id, true).history.length, 1);
    assert.deepEqual(f.memory.get(other, global.id).current.sources, []);
    const deleted = f.memory.revise(f.ctx, first.id, { baseRevision: 3, reason: '用户删除', remove: true });
    assert.equal(deleted.status, 'deleted');
    assert.equal(f.memory.search(f.ctx).total, 0);
    assert.equal(f.memory.get(f.ctx, first.id, true).history.length, 4);
    assert.throws(() => f.memory.get(f.ctx, first.id), { code: 'MEMORY_NOT_CURRENT' });
    assert.throws(
      () =>
        f.memory.revise(f.ctx, first.id, { baseRevision: 4, content: knowledge, reason: '错误复活', confirm: true }),
      { status: 410 },
    );
  } finally {
    f.close();
  }
});
test('FTS and revision changes roll back together when the current-reference update fails', () => {
  const f = unit();
  try {
    const saved = f.memory.create(f.ctx, knowledge, '来源');
    const count = f.events();
    f.db.exec("CREATE TRIGGER fail_memory BEFORE UPDATE ON memories BEGIN SELECT RAISE(ABORT,'injected'); END");
    assert.throws(() =>
      f.memory.revise(f.ctx, saved.id, {
        baseRevision: 1,
        content: { ...knowledge, content: 'ROLLBACK_SENTINEL' },
        reason: '失败注入',
      }),
    );
    assert.equal(f.memory.get(f.ctx, saved.id, true).history.length, 1);
    assert.equal(f.memory.search(f.ctx, { query: 'ROLLBACK_SENTINEL', includeHistory: true }).total, 0);
    assert.equal(f.events(), count);
  } finally {
    f.close();
  }
});
test('history search obeys current scope; new decision evidence depends on the correcting Session', () => {
  const f = unit();
  try {
    const other: MemoryContext = { actor: 'agent', project: '/project-b' };
    const global = f.memory.create(f.ctx, { ...knowledge, scope: 'global' }, '原全局');
    f.memory.revise(f.ctx, global.id, { baseRevision: 1, content: knowledge, reason: '收窄范围' });
    assert.equal(f.memory.search(other, { includeHistory: true }).total, 0);
    assert.throws(() => f.memory.get(other, global.id, true), { status: 404 });
    const b = { ...f.ctx, source: { sessionId: randomUUID(), entryId: 'b', project: '/project-a' } };
    f.memory.reconcileSource(b.source.sessionId, 'b', ['b']);
    f.memory.revise(b, global.id, {
      baseRevision: 2,
      content: { ...knowledge, content: '新决定' },
      reason: 'B 新证据',
    });
    f.memory.reconcileSource(b.source.sessionId, null, []);
    assert.equal(f.memory.get(f.ctx, global.id, true).current.status, 'withdrawn');
    const experience = f.memory.create(f.ctx, { ...knowledge, kind: 'experience' }, '独立经验');
    f.memory.reconcileSource(b.source.sessionId, 'b', ['b']);
    f.memory.revise(b, experience.id, { baseRevision: 1, content: knowledge, reason: '形成决定' });
    f.memory.reconcileSource(b.source.sessionId, null, []);
    assert.equal(f.memory.get(f.ctx, experience.id, true).current.status, 'withdrawn');
  } finally {
    f.close();
  }
});
test('cross-Session branch withdrawal is shared, recoverable, preserves experience and never silently revives', () => {
  const f = unit();
  try {
    const decision = f.memory.create(f.ctx, knowledge, '决定');
    const experience = f.memory.create(f.ctx, { ...knowledge, kind: 'experience' }, '独立经验');
    const reader: MemoryContext = { actor: 'agent', project: f.ctx.project };
    f.memory.beginTransition(f.source.sessionId);
    assert.equal(f.memory.search(reader).total, 1);
    assert.equal(f.memory.search(reader).unavailable, 1);
    assert.throws(() => f.memory.revise(f.ctx, decision.id, { baseRevision: 1, reason: 'Hook 内写入', retire: true }), {
      code: 'MEMORY_SOURCE_UNAVAILABLE',
    });
    assert.equal(f.memory.get(reader, decision.id, true).current.usable, false);
    f.memory.reconcileSource(f.source.sessionId, null, [], true);
    assert.equal(f.memory.get(reader, decision.id, true).current.status, 'withdrawn');
    assert.equal(f.memory.get(reader, experience.id).current.usable, true);
    f.memory.reconcileSource(f.source.sessionId, f.source.entryId, [f.source.entryId], true);
    assert.throws(() => f.memory.get(reader, decision.id), { code: 'MEMORY_NOT_CURRENT' });
    const confirmed = f.memory.revise(f.ctx, decision.id, {
      baseRevision: 2,
      content: knowledge,
      reason: '重新取得依据',
      confirm: true,
    });
    assert.equal(confirmed.revision, 3);
    assert.equal(confirmed.usable, true);
    const recovered = new MemoryService(f.db, f.sensitive, () => {});
    recovered.init();
    assert.equal(recovered.search(reader).unavailable, 1);
    recovered.reconcileSource(f.source.sessionId, null, [], true);
    assert.equal(recovered.get(reader, decision.id, true).current.revision, 4);
  } finally {
    f.close();
  }
});
test('protection precedes SQLite and FTS persistence; protection failure commits nothing', () => {
  const f = unit();
  try {
    const secret = 'memory-secret-sentinel-4499';
    f.sensitive.add(secret);
    const saved = f.memory.create(
      f.ctx,
      { ...knowledge, title: secret, content: `password=${secret} person@example.com` },
      `依据 ${secret}`,
    );
    const rows = JSON.stringify(f.db.prepare('SELECT data FROM memory_revisions').all());
    assert.ok(!rows.includes(secret));
    assert.ok(!rows.includes('person@example.com'));
    assert.equal(saved.sources[0]?.sessionId, f.source.sessionId);
    assert.equal(f.memory.search(f.ctx, { query: 'sentinel' }).total, 0);
    f.sensitive.text = () => {
      throw new Error('protection failure');
    };
    assert.throws(() => f.memory.create(f.ctx, knowledge, '不能跳过检查'));
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM memories').get()?.n, 1);
  } finally {
    f.close();
  }
});

interface Tree {
  entry: { id: string; type: string; message?: { role: string } };
  children: Tree[];
}
interface SessionState {
  id: string;
  busy: boolean;
  error?: string;
  messages: Array<{ role: string; toolName?: string; content: unknown }>;
  tree: Tree[];
}
function flatten(tree: Tree[]): Tree[] {
  return tree.flatMap((node) => [node, ...flatten(node.children)]);
}
async function integration() {
  const dir = await mkdtemp(join(tmpdir(), 'memory-host-')),
    key = randomBytes(32),
    token = randomBytes(32).toString('hex');
  const dataDir = join(dir, 'data'),
    other = join(dir, 'other');
  await mkdir(other);
  let host = await startHost({ dataDir, key, token });
  const fake = fauxProvider({
    models: [{ id: 'memory-model', contextWindow: 262144, maxTokens: 1024 }],
    tokensPerSecond: 100000,
  });
  host.service.runtime.registerNativeProvider(fake.provider);
  const request = (path: string, method = 'GET', value?: unknown) =>
    fetch(`${host.origin}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
  const json = async <T>(path: string, method = 'GET', value?: unknown): Promise<T> => {
    const response = await request(path, method, value);
    assert.ok(response.ok, `${path}: ${await response.clone().text()}`);
    return response.json();
  };
  const create = (cwd = dir) =>
    json<SessionState>('/sessions', 'POST', { cwd, provider: fake.provider.id, model: 'memory-model' });
  async function run(id: string, responses: Parameters<typeof fake.setResponses>[0]) {
    fake.setResponses(responses);
    await json(`/sessions/${id}/prompt`, 'POST', { text: 'Memory integration task' });
    let state: SessionState;
    const end = Date.now() + 10000;
    do {
      await new Promise((ok) => setTimeout(ok, 20));
      state = await json<SessionState>(`/sessions/${id}`);
    } while (state.busy && Date.now() < end);
    assert.equal(state.busy, false);
    assert.equal(state.error, undefined);
    return state;
  }
  return {
    dir,
    other,
    dataDir,
    key,
    token,
    fake,
    request,
    json,
    create,
    run,
    host: () => host,
    restart: async (close = true) => {
      if (close) await host.close();
      host = await startHost({ dataDir, key, token });
      host.service.runtime.registerNativeProvider(fake.provider);
    },
    close: async () => {
      await host.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test('native Memory tools persist sources, share across Sessions, revise, isolate projects, withdraw on branch and survive restart', async () => {
  const f = await integration();
  try {
    const a = await f.create(),
      b = await f.create();
    const url = `/memory?project=${encodeURIComponent(f.dir)}`;
    const state = await f.run(a.id, [
      fauxAssistantMessage(fauxToolCall('memory_save', { knowledge, reason: 'Session A 决定' }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('saved'),
    ]);
    assert.ok(state.messages.some((m) => m.toolName === 'memory_save'));
    const saved = (await f.json<{ items: MemoryView[] }>(url)).items[0];
    assert.ok(saved);
    assert.equal(saved.sources[0]?.sessionId, a.id);
    assert.equal(saved.usable, true);
    const used = await f.run(b.id, [
      fauxAssistantMessage(fauxToolCall('memory_search', { query: 'PostgreSQL' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage(fauxToolCall('write', { path: 'memory-use.txt', content: 'PostgreSQL' }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('used'),
    ]);
    assert.ok(
      used.messages.some((m) => m.toolName === 'memory_search' && JSON.stringify(m.content).includes(saved.id)),
    );
    assert.equal(await readFile(join(f.dir, 'memory-use.txt'), 'utf8'), 'PostgreSQL');
    const different = await f.create(f.other);
    const isolated = await f.run(different.id, [
      fauxAssistantMessage(fauxToolCall('memory_get', { id: saved.id, includeHistory: true }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('unavailable'),
    ]);
    assert.ok(
      isolated.messages.some(
        (m) => m.toolName === 'memory_get' && JSON.stringify(m.content).includes('MEMORY_NOT_FOUND'),
      ),
    );
    const updated = await f.run(b.id, [
      fauxAssistantMessage(
        fauxToolCall('memory_revise', {
          id: saved.id,
          baseRevision: 1,
          knowledge: { ...knowledge, content: '项目采用 PostgreSQL 18' },
          reason: '新证据',
        }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('revised'),
    ]);
    assert.ok(
      updated.messages.some((m) => m.toolName === 'memory_revise' && JSON.stringify(m.content).includes('revision')),
    );
    const userEntry = flatten(state.tree).find((n) => n.entry.message?.role === 'user');
    assert.ok(userEntry);
    await f.json(`/sessions/${a.id}/branch`, 'POST', { value: userEntry.entry.id });
    assert.equal((await f.json<{ items: MemoryView[] }>(url)).items.length, 0);
    const detail = await f.json<{ current: MemoryView; history: MemoryView[] }>(
      `/memory/${saved.id}?project=${encodeURIComponent(f.dir)}&includeHistory=true`,
    );
    assert.equal(detail.current.status, 'withdrawn');
    assert.equal(detail.history.length, 3);
    await f.restart();
    assert.deepEqual(
      await f.json(`/memory/${saved.id}?project=${encodeURIComponent(f.dir)}&includeHistory=true`),
      detail,
    );
  } finally {
    await f.close();
  }
});
test('existing encrypted transcripts and old branches acquire native Memory tools without replacing other tools', async () => {
  const f = await integration();
  try {
    const a = await f.create();
    const state = await f.run(a.id, [fauxAssistantMessage('legacy session')]);
    const target = flatten(state.tree).find((n) => n.entry.message?.role === 'user');
    assert.ok(target);
    const path = `sessions/${a.id}.enc`;
    const saved = await f.host().service.store.read<{ record: unknown; session: Snapshot }>(path);
    assert.ok(saved);
    let removed = 0;
    for (const entry of saved.session.entries) {
      if (entry.type === 'message' && entry.message.role === 'system') {
        const before = entry.message.toolsAdded ?? [];
        entry.message.toolsAdded = before.filter((tool) => !tool.name.startsWith('memory_'));
        removed += before.length - entry.message.toolsAdded.length;
      }
    }
    assert.ok(removed > 0);
    await f.host().service.store.write(path, saved);
    await f.restart();
    const checkTools: Parameters<typeof f.fake.setResponses>[0][number] = (context) => {
      const names = context.messages.flatMap((m) =>
        m.role === 'system' ? (m.toolsAdded?.map((t) => t.name) ?? []) : [],
      );
      assert.ok(names.includes('memory_search'));
      assert.ok(names.includes('read'));
      return fauxAssistantMessage(fauxToolCall('memory_save', { knowledge, reason: 'upgraded Session evidence' }), {
        stopReason: 'toolUse',
      });
    };
    await f.run(a.id, [checkTools, fauxAssistantMessage('saved')]);
    await f.json(`/sessions/${a.id}/branch`, 'POST', { value: target.entry.id });
    const after = await f.run(a.id, [checkTools, fauxAssistantMessage('saved after old branch')]);
    assert.equal(after.messages.filter((m) => m.toolName === 'memory_save').length, 1);
  } finally {
    await f.close();
  }
});
test('Memory native tools survive Skill reload and Agent retirement preserves history', async () => {
  const f = await integration();
  try {
    const a = await f.create();
    const pkg = join(f.dir, 'plain');
    await mkdir(pkg);
    await writeFile(
      join(pkg, 'SKILL.md'),
      '---\nname: memory-reload\ndescription: Ordinary text Skill for reload regression.\n---\nRead evidence before answering.',
    );
    const [skill] = await f.host().service.skills.import({ source: pkg });
    assert.ok(skill);
    const op = f.host().service.skills.publish(skill.id, skill.latest, skill.revision);
    const end = Date.now() + 10000;
    while (['checking', 'waiting'].includes(f.host().service.skills.operation(op.id).status)) {
      assert.ok(Date.now() < end);
      await new Promise((ok) => setTimeout(ok, 20));
    }
    assert.equal(f.host().service.skills.operation(op.id).status, 'applied');
    await f.run(a.id, [
      fauxAssistantMessage(fauxToolCall('memory_save', { knowledge, reason: 'after native reload' }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('done'),
    ]);
    const ctx = await f.host().service.memoryUserContext(f.dir);
    const saved = f.host().service.memory.search(ctx).items[0];
    assert.ok(saved);
    const retired = await f.run(a.id, [
      fauxAssistantMessage(
        fauxToolCall('memory_retire', { id: saved.id, baseRevision: 1, reason: 'Evidence no longer applies' }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('done'),
    ]);
    assert.ok(
      retired.messages.some((m) => m.toolName === 'memory_retire' && JSON.stringify(m.content).includes('withdrawn')),
    );
    assert.equal(f.host().service.memory.search(ctx).total, 0);
    assert.equal(f.host().service.memory.get(ctx, saved.id, true).history.length, 2);
  } finally {
    await f.close();
  }
});
test('SIGKILL between branch snapshot and Memory commit recovers withdrawal without replay', {
  timeout: 20000,
}, async () => {
  const f = await integration();
  const child = fork(new URL('./fixtures/memory-recovery.ts', import.meta.url), [], {
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  try {
    const a = await f.create();
    const state = await f.run(a.id, [
      fauxAssistantMessage(fauxToolCall('memory_save', { knowledge, reason: 'durable evidence' }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('saved'),
    ]);
    const ctx = await f.host().service.memoryUserContext(f.dir);
    const saved = f.host().service.memory.search(ctx).items[0];
    assert.ok(saved?.sources[0]);
    const target = flatten(state.tree).find((n) => n.entry.message?.role === 'user');
    assert.ok(target);
    await f.host().close();
    const ready = new Promise<{ type: string; origin: string }>((ok, fail) => {
      child.once('message', (message) => ok(message as { type: string; origin: string }));
      child.once('error', fail);
    });
    child.send({
      dataDir: f.dataDir,
      key: f.key.toString('base64'),
      token: f.token,
      sessionId: a.id,
      entryId: saved.sources[0].entryId,
    });
    const config = await ready;
    assert.equal(config.type, 'ready');
    const exited = once(child, 'exit');
    await fetch(`${config.origin}/api/sessions/${a.id}/branch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${f.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: target.entry.id }),
    }).catch(() => {});
    const [, signal] = await exited;
    assert.equal(signal, 'SIGKILL');
    await f.restart(false);
    const detail = f.host().service.memory.get(ctx, saved.id, true);
    assert.equal(detail.current.status, 'withdrawn');
    assert.equal(detail.history.length, 2);
    assert.equal(f.host().service.memory.search(ctx).total, 0);
    assert.equal(f.fake.state.callCount, 2);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
    await f.close();
  }
});
test('a committed branch snapshot recovers a failed Memory transaction; corrupt sources fail closed', async () => {
  const f = await integration();
  let db: DatabaseSync | undefined;
  try {
    const a = await f.create();
    await f.create();
    const state = await f.run(a.id, [
      fauxAssistantMessage(fauxToolCall('memory_save', { knowledge, reason: 'source evidence' }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('saved'),
    ]);
    const ctx = await f.host().service.memoryUserContext(f.dir);
    const saved = f.host().service.memory.search(ctx).items[0];
    assert.ok(saved);
    const target = flatten(state.tree).find((n) => n.entry.message?.role === 'user');
    assert.ok(target);
    db = new DatabaseSync(join(f.dataDir, 'product.sqlite'));
    db.exec("CREATE TRIGGER fail_memory BEFORE UPDATE ON memories BEGIN SELECT RAISE(ABORT,'injected'); END");
    const response = await f.request(`/sessions/${a.id}/branch`, 'POST', { value: target.entry.id });
    assert.equal(response.ok, false);
    assert.equal(f.host().service.memory.search(ctx).total, 0);
    assert.equal(f.host().service.memory.search(ctx).unavailable, 1);
    db.exec('DROP TRIGGER fail_memory');
    db.close();
    db = undefined;
    // close may report the deliberately failed checkpoint; the encrypted snapshot already committed.
    await f
      .host()
      .close()
      .catch(() => {});
    await f.restart(false);
    assert.equal(f.host().service.memory.get(ctx, saved.id, true).current.status, 'withdrawn');
    // Reactivate from the existing valid evidence, then lose both source checkpoints.
    const fresh = await f.run(a.id, [
      fauxAssistantMessage(fauxToolCall('memory_save', { knowledge, reason: 'new independent evidence' }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('saved'),
    ]);
    assert.equal(fresh.busy, false);
    const current = f.host().service.memory.search(ctx).items[0];
    assert.ok(current);
    await f.host().close();
    await writeFile(join(f.dataDir, 'sessions', `${a.id}.enc`), 'corrupt');
    await writeFile(join(f.dataDir, 'sessions', `${a.id}.enc.prev`), 'corrupt');
    await f.restart(false);
    assert.equal(f.host().service.memory.search(ctx).total, 0);
    assert.equal(f.host().service.memory.get(ctx, current.id, true).current.unavailable, true);
  } finally {
    db?.close();
    await f.close();
  }
});
test('authenticated Memory API enforces concurrent revisions, global visibility and scope changes', async () => {
  const f = await integration();
  try {
    const query = `?project=${encodeURIComponent(f.dir)}`;
    assert.equal((await fetch(`${f.host().origin}/api/memory`)).status, 401);
    const saved = await f.json<MemoryView>(`/memory${query}`, 'POST', {
      knowledge: { ...knowledge, scope: 'global', kind: 'experience' },
      reason: '通用认识',
    });
    assert.equal((await f.json<{ total: number }>(`/memory?project=${encodeURIComponent(f.other)}`)).total, 1);
    const changes = await Promise.all(
      ['first', 'second'].map((reason) =>
        f.request(`/memory/${saved.id}/revise${query}`, 'POST', { baseRevision: 1, knowledge, reason }),
      ),
    );
    assert.deepEqual(changes.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      (await f.request(`/memory/${saved.id}?project=${encodeURIComponent(f.other)}&includeHistory=true`)).status,
      404,
    );
    const deleted = await f.json<MemoryView>(`/memory/${saved.id}${query}`, 'DELETE', {
      baseRevision: 2,
      reason: '不再保留当前知识',
    });
    assert.equal(deleted.status, 'deleted');
    assert.equal((await f.json<{ total: number }>(`/memory${query}`)).total, 0);
    assert.equal(
      (await f.request(`/memory${query}`, 'POST', { knowledge, reason: '非法来源', actor: 'system' })).status,
      400,
    );
    await writeFile(join(f.dir, 'unchanged.txt'), 'source evidence');
    await f.restart();
    assert.equal(
      (await f.json<{ current: MemoryView }>(`/memory/${saved.id}${query}&includeHistory=true`)).current.status,
      'deleted',
    );
  } finally {
    await f.close();
  }
});
