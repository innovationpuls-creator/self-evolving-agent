import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { AgentService } from '../apps/host/runtime/agent.js';
import {
  ReflectionService,
  type ReflectionExecutor,
  type ReflectionRecord,
} from '../apps/host/reflection/reflection-service.js';

export async function catalogFixture(
  count = 125,
  executor: ReflectionExecutor = {
    async available() {
      return { available: true };
    },
    async execute() {
      throw new Error('Fixture must not execute Reflection');
    },
  },
) {
  const root = await mkdtemp(join(tmpdir(), 'post-d5-reflection-memory-'));
  const host = new AgentService(join(root, 'data'), randomBytes(32), {
    reflectionExecutor: {
      async available() {
        return { available: false, reason: 'Unused fixture scheduler' };
      },
      async execute() {
        throw new Error('Unused fixture scheduler');
      },
    },
  });
  await host.init();
  const db = new DatabaseSync(':memory:');
  const service = new ReflectionService({
    db,
    store: host.store,
    sensitive: host.sensitive,
    runtime: host.runtime,
    memory: host.memory,
    diagnostics: host.diagnostics,
    history: host.diagnosticHistory,
    skills: host.skills,
    evolution: host.evolution,
    read: async () => undefined,
    records: async () => [],
    canRun: () => false,
    changed: () => {},
    refreshKnowledge: async () => {},
    executor,
  });
  service.init();
  const sessionId = randomUUID();
  const insertJob =
    db.prepare(`INSERT INTO reflection_jobs(id,session_id,project,provider,model,scheduled_at,created,updated,status,last_marker_entry_id,reflection_session_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  const insertSource = db.prepare(
    'INSERT INTO reflection_job_sources(job_id,session_id,marker_entry_id,settled_at,status) VALUES(?,?,?,?,?)',
  );
  const insertRecord = db.prepare('INSERT INTO reflections VALUES(?,?,?,?)');
  const originals: ReflectionRecord[] = [];
  db.exec('BEGIN');
  for (let index = 0; index < count; index++) {
    const id = randomUUID();
    const record: ReflectionRecord = {
      id,
      jobId: id,
      sessionId,
      reflectionSessionId: randomUUID(),
      project: root,
      status: 'succeeded',
      created: index,
      updated: index,
      summary: '历史完整结论，不应改写。'.repeat(500),
      findings: ['历史发现'.repeat(1500)],
      uncertainties: ['原始不确定性'],
      evidence: [{ sessionId, entryId: `entry-${index}` }],
      changes: [],
    };
    insertJob.run(
      id,
      sessionId,
      root,
      'test',
      'test',
      index,
      index,
      index,
      'succeeded',
      `marker-${index}`,
      record.reflectionSessionId,
    );
    for (let source = 0; source < 3; source++)
      insertSource.run(id, sessionId, `marker-${index}-${source}`, index, 'ended');
    insertRecord.run(id, sessionId, root, JSON.stringify(record));
    originals.push(record);
  }
  db.exec('COMMIT');
  return {
    root,
    host,
    db,
    service,
    sessionId,
    originals,
    async close() {
      await service.close();
      db.close();
      await host.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function benchmark() {
  const fixture = await catalogFixture(Number(process.env.REFLECTION_BENCH_COUNT ?? 1000));
  let statements = 0;
  const prepare = fixture.db.prepare.bind(fixture.db);
  fixture.db.prepare = (sql) => {
    statements++;
    return prepare(sql);
  };
  const measure = (run: () => unknown) => {
    for (let warmup = 0; warmup < 3; warmup++) run();
    const times: number[] = [];
    statements = 0;
    let bytes = 0;
    for (let iteration = 0; iteration < 25; iteration++) {
      const started = performance.now();
      bytes = Buffer.byteLength(JSON.stringify(run()));
      times.push(performance.now() - started);
    }
    times.sort((first, second) => first - second);
    return { p50Ms: times[12], p95Ms: times[23], bytes, statementsPerRequest: statements / 25 };
  };
  try {
    const before = measure(() => ({ records: fixture.service.list(), jobs: fixture.service.jobs.list() }));
    const after = measure(() => fixture.service.catalog());
    const status = measure(() => fixture.service.catalog({ statusOnly: true }));
    console.log(
      JSON.stringify(
        {
          kind: 'synthetic-catalog-benchmark',
          count: fixture.originals.length,
          pageSize: 20,
          before,
          after,
          status,
          environmentChecksOnSummaryReads: 0,
          baseline: 'Unchanged legacy list()+jobs.list(); same database and serialization, excludes codesign latency',
        },
        null,
        2,
      ),
    );
    assert.equal(after.statementsPerRequest, 2);
    assert.ok(after.bytes < before.bytes / 10);
    const original = fixture.originals[0];
    assert.ok(original);
    assert.deepEqual(fixture.service.get(original.id).summary, original.summary);
  } finally {
    await fixture.close();
  }
}

async function realMemory() {
  const root = await mkdtemp(join(tmpdir(), 'post-d5-memory-real-'));
  const host = new AgentService(join(root, 'data'), randomBytes(32), { reflectionDelayMs: 3600000 });
  const receipt: Record<string, unknown> = {
    kind: 'real-provider-memory',
    provider: 'openai-codex',
    model: process.env.AGENT_SMOKE_MODEL ?? 'gpt-6-luna',
    passed: false,
  };
  try {
    await host.init();
    await host.credentials('openai-codex', undefined, true);
    let session = await host.create(root, 'openai-codex', String(receipt.model));
    const run = async (text: string) => {
      await host.prompt(session.id, text);
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        const view = await host.viewSession(session.id);
        if (!view.busy) {
          assert.equal(view.error, undefined, 'Provider run failed');
          return view;
        }
        await new Promise((done) => setTimeout(done, 100));
      }
      throw new Error('Real Provider timed out');
    };
    await run('仅回复“收到”，不要使用工具，也没有需要长期保存的新认识。');
    const ctx = await host.memoryUserContext(root);
    assert.equal(host.memory.search(ctx).total, 0, 'Ordinary turns must not force writes');
    const marker = randomUUID();
    const view = await run(
      `请先查看当前项目是否已经记住“验收记忆 ${marker}”。这是一条用户明确要求跨任务保留的项目事实：本次独立验收标识为 ${marker}。没有重复记忆时，请将这条项目事实保存为可跨会话检索的项目记忆，说明依据是我本轮的明确说明。用简短中文区分检索到的已有认识和本次新增的认识，报告工具返回的来源。不要修改其他文件或提交建议。`,
    );
    const item = host.memory.search(ctx, { query: marker }).items[0];
    assert.ok(item, 'Actual memory_save must create a visible memory');
    assert.equal(
      item.sources.some((source) => source.sessionId === session.id),
      true,
    );
    const results = view.messages
      .filter((message) => message.role === 'toolResult')
      .filter((message) => message.toolName.startsWith('memory_'));
    assert.ok(results.some((message) => message.toolName === 'memory_search'));
    assert.ok(results.some((message) => message.toolName === 'memory_save' && !message.isError));
    const saved = await host.viewSession(session.id);
    const originalLength = saved.messages.length;
    const retrieved = await run(
      `请用 memory_search 查找验收标识 ${marker}，然后用 memory_get 读取当前认识与来源，仅报告已有认识，不新增或修订记忆。`,
    );
    assert.equal(host.memory.get(ctx, item.id, true).history.length, 1);
    assert.ok(
      retrieved.messages
        .slice(originalLength)
        .some((message) => message.role === 'toolResult' && message.toolName === 'memory_get' && !message.isError),
    );
    const revised = await run(
      `更正刚才明确要求保留的项目事实：验收标识 ${marker} 的有效重试上限是 3 次。请修正已有认识，不要新增重复条目，并告诉我修正结果及依据。`,
    );
    assert.ok(
      revised.messages
        .slice(retrieved.messages.length)
        .some((message) => message.role === 'toolResult' && message.toolName === 'memory_revise' && !message.isError),
    );
    const corrected = host.memory.get(ctx, item.id, true);
    assert.equal(corrected.history.length, 2);
    assert.ok(corrected.current.content.includes('3'));
    session = await host.create(root, 'openai-codex', String(receipt.model));
    const cross = await run(
      `请查找项目中已保留的验收标识 ${marker}，读取有效的重试上限和来源；本轮只核对已有认识，无新事实需要保存。`,
    );
    const crossTools = cross.messages.filter((message) => message.role === 'toolResult');
    assert.ok(crossTools.some((message) => message.toolName === 'memory_search' && !message.isError));
    assert.ok(
      !crossTools.some((message) => ['memory_save', 'memory_revise', 'memory_retire'].includes(message.toolName)),
    );
    assert.equal(host.memory.get(ctx, item.id, true).history.length, 2);
    receipt.naturalCorrectionAndCrossSession = true;
    receipt.toolResults = revised.messages.filter(
      (message) => message.role === 'toolResult' && message.toolName.startsWith('memory_'),
    );
    Object.assign(receipt, {
      passed: true,
      writes: 2,
      sourceCount: item.sources.length,
      noForcedWrite: true,
      searchSaveGet: true,
      sessionId: session.id,
      memoryId: item.id,
    });
  } finally {
    await host.close();
    await rm(root, { recursive: true, force: true });
    const out = resolve(process.env.AGENT_VALIDATION_OUT ?? 'release/post-d5-bugfix-2026-10-22');
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'memory-real.json'), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify({ ...receipt, toolResults: undefined }, null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes('--real')) await realMemory();
  else await benchmark();
}
