import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { _electron, chromium, type Page } from 'playwright-core';
import type { ReflectionRecord } from '../apps/host/reflection/reflection-service.js';
import type { ReflectionJob } from '../apps/host/reflection/reflection-jobs.js';
const root = await mkdtemp(join(tmpdir(), 'd3-signed-'));
const executable = resolve(
  process.env.AGENT_APP_PATH ?? 'release/d3-development-20261020/Agent-darwin-arm64/Agent.app/Contents/MacOS/Agent',
);
const receipt: Record<string, unknown> = {
  time: new Date().toISOString(),
  executable,
  root,
  provider: 'openai-codex',
  model: 'gpt-6-luna',
  checks: [],
  passed: false,
};
const checks = receipt.checks as string[];
const evidenceDir = resolve('release/d3-development-evidence');
await mkdir(evidenceDir, { recursive: true });
const app = await _electron.launch({
  executablePath: executable,
  args: [`--user-data-dir=${join(root, 'profile')}`],
  env: { ...process.env, AGENT_DESKTOP_DATA_DIR: join(root, 'data') },
  timeout: 60000,
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
async function request<T>(page: Page, path: string, method = 'GET', body?: unknown): Promise<T> {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(`/api${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem('agent-connection-token')}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${value.error}`);
      return value;
    },
    { path, method, body },
  );
}
interface Catalog {
  availability: { available: boolean; reason?: string };
  records: ReflectionRecord[];
  jobs: ReflectionJob[];
}
interface Session {
  id: string;
  busy: boolean;
  error?: string;
  messages: unknown[];
}
async function settled(page: Page, id: string) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const s = await request<Session>(page, `/sessions/${id}`);
    if (!s.busy) {
      assert.equal(s.error, undefined);
      return s;
    }
    await page.waitForTimeout(200);
  }
  throw new Error('Ordinary real Provider task timed out');
}
try {
  const page = await app.firstWindow({ timeout: 60000 });
  await page.locator('.shell').waitFor({ timeout: 300000 });
  assert.equal((await request<Catalog>(page, '/reflections')).availability.available, true);
  await request(page, '/credentials', 'POST', { provider: 'openai-codex', importExisting: true });
  checks.push('signed product availability and Host credential import');
  const worker = resolve(
    executable,
    '../../Helpers/ReflectionBridge.app/Contents/XPCServices/dev.personal.agent.reflection.xpc/Contents/Resources/runtime/dist/host/reflection/worker.js',
  );
  receipt.workerSha256 = createHash('sha256')
    .update(await readFile(worker))
    .digest('hex');
  await writeFile(
    join(root, 'POLICY.md'),
    'Observed project policy: retry budget is 3 attempts. This descriptive fact supersedes the old note claiming 7 attempts.\n',
  );
  const knowledge = {
    title: 'Retry budget',
    content: 'The retry budget is 7 attempts.',
    kind: 'fact',
    scope: 'project',
  };
  const memory = await request<{ id: string }>(page, `/memory?${new URLSearchParams({ project: root })}`, 'POST', {
    knowledge,
    reason: 'Seed stale descriptive knowledge for evidence based correction acceptance',
  });
  const source = await request<Session>(page, '/sessions', 'POST', {
    cwd: root,
    provider: 'openai-codex',
    model: 'gpt-6-luna',
  });
  receipt.sourceSessionId = source.id;
  receipt.memoryId = memory.id;
  await request(page, `/sessions/${source.id}/prompt`, 'POST', {
    text: 'Read POLICY.md and query Retry budget memory. Report the precise discrepancy with file evidence; do not modify Memory or create suggestions in this ordinary task. Leave this for background review. In this acceptance scenario I explicitly request a proposal for a read-only policy-versus-Memory comparison aid: manually checking these two sources is the workflow pain I want addressed. Background review should independently inspect Diagnostic records, actual historical entries and Memory revisions before correcting descriptive knowledge, saving its review and submitting that proposal with uncertainty, without implementation authorization. Do not fabricate evidence.',
  });
  receipt.source = await settled(page, source.id);
  checks.push('real ordinary Provider task and native file/memory tools');
  await request(page, '/reflections/expedite', 'POST', { sessionId: source.id });
  const deadline = Date.now() + 360000;
  let catalog: Catalog | undefined;
  while (Date.now() < deadline) {
    catalog = await request<Catalog>(page, `/reflections?sessionId=${source.id}`);
    const job = catalog.jobs[0];
    if (job && ['succeeded', 'failed', 'interrupted', 'waiting_user'].includes(job.status)) break;
    await page.waitForTimeout(250);
  }
  receipt.reflection = catalog;
  assert.equal(catalog?.jobs[0]?.status, 'succeeded', JSON.stringify(catalog));
  assert.ok(catalog);
  const record = catalog.records[0];
  assert.ok(record?.summary);
  receipt.memory = await request(
    page,
    `/memory/${memory.id}?${new URLSearchParams({ project: root, includeHistory: 'true' })}`,
  );
  const revised = receipt.memory as {
    current: { revision: number; content: string; sources: unknown[] };
    history: Array<{ revision: number; content: string }>;
  };
  assert.equal(revised.current.revision, 2);
  assert.match(revised.current.content, /\b3\b/);
  assert.ok(revised.current.sources.length > 0);
  assert.ok(revised.history.some((r) => r.revision === 1 && /\b7\b/.test(r.content)));
  assert.ok(
    record.changes.some((c) => c.kind === 'memory' && c.id === memory.id),
    'Reflection must correct stale Memory',
  );
  assert.ok(
    record.changes.some((c) => c.kind === 'suggestion'),
    'Reflection must submit a justified suggestion',
  );
  const traces = await request<{ items: Array<{ id: string }> }>(
    page,
    `/diagnostics?sessionId=${record.reflectionSessionId}`,
  );
  const calls: unknown[] = [];
  for (const trace of traces.items) {
    const detail = await request<{ calls: unknown[] }>(page, `/diagnostics/${trace.id}`);
    calls.push(...detail.calls);
  }
  receipt.reflectionToolCalls = calls;
  const serialized = JSON.stringify(calls);
  for (const name of ['diagnostic_evidence', 'memory_revise', 'reflection_save', 'suggestion_submit'])
    assert.ok(serialized.includes(name), `Missing actual Reflection tool ${name}`);
  assert.ok(/diagnostic_search|diagnostic_get/.test(serialized), 'Missing autonomous Diagnostic lookup');
  assert.ok(/memory_search|memory_get/.test(serialized), 'Missing autonomous Memory lookup');
  assert.ok(/history_entries|history_sessions/.test(serialized), 'Missing autonomous history lookup');
  checks.push(
    'unchanged restricted product Worker completes real Provider evidence, Memory correction, review and suggestion',
  );
  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const web = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const token = await page.evaluate(() => sessionStorage.getItem('agent-connection-token'));
  await web.goto(`${new URL(page.url()).origin}/#token=${token}`);
  await web.locator('.shell').waitFor();
  for (const client of [page, web]) {
    await client.getByRole('button', { name: '反思记录', exact: true }).click();
    await client.getByText(record.summary, { exact: false }).first().waitFor();
  }
  await page.screenshot({ path: join(evidenceDir, 'desktop-reflection.png'), fullPage: true });
  await web.screenshot({ path: join(evidenceDir, 'web-reflection.png'), fullPage: true });
  checks.push('Desktop and Chrome show the completed Reflection');
  await writeFile(
    join(root, 'POLICY.md'),
    'Observed project policy: retry budget is now 4 attempts. This supersedes the previous 3-attempt policy.\n',
  );
  await request(page, `/sessions/${source.id}/prompt`, 'POST', {
    text: 'Read POLICY.md again and query Retry budget Memory. Report the changed policy and discrepancy, without updating Memory in this ordinary task. Leave evidence-based descriptive correction and review to background Reflection. This is the second observed policy change in this acceptance fixture.',
  });
  await settled(page, source.id);
  await request(page, '/reflections/expedite', 'POST', { sessionId: source.id });
  const db = new DatabaseSync(join(root, 'data/product.sqlite'), { readOnly: true });
  let observedRunId = '';
  const snapshot = () => ({
    memory: db.prepare('SELECT * FROM memory_revisions WHERE memory_id=? ORDER BY revision').all(memory.id),
    suggestions: db.prepare('SELECT * FROM evolution_suggestions ORDER BY id').all(),
    effects: db.prepare('SELECT * FROM reflection_effects WHERE run_id=? ORDER BY call_id').all(observedRunId),
  });
  let killed: ReflectionRecord | undefined;
  let beforeEffects: ReturnType<typeof snapshot> | undefined;
  let foregroundCompleted = false;
  const recoveryDeadline = Date.now() + 360000;
  while (Date.now() < recoveryDeadline) {
    const state = await request<Catalog>(page, `/reflections?sessionId=${source.id}`);
    const running = state.records.find((r) => r.jobId !== record.jobId && r.status === 'running');
    if (running && !foregroundCompleted) {
      const foreground = await request<Session>(page, '/sessions', 'POST', {
        cwd: root,
        provider: 'openai-codex',
        model: 'gpt-6-luna',
      });
      const started = Date.now();
      await request(page, `/sessions/${foreground.id}/prompt`, 'POST', {
        text: 'Reply only D3_CONCURRENT_OK. Do not call tools.',
      });
      const result = await settled(page, foreground.id);
      assert.ok(JSON.stringify(result.messages).includes('D3_CONCURRENT_OK'));
      receipt.concurrent = {
        reflectionJobId: running.jobId,
        foregroundSessionId: foreground.id,
        elapsedMs: Date.now() - started,
      };
      foregroundCompleted = true;
      continue;
    }
    if (running && foregroundCompleted) {
      observedRunId = state.jobs.find((j) => j.id === running.jobId)?.runId ?? '';
      assert.ok(observedRunId);
      const pid = await app.evaluate(({ app }) => app.getAppMetrics().find((m) => m.name === 'Agent Host')?.pid);
      assert.ok(pid);
      const deadline = Date.now() + 240000;
      while (Date.now() < deadline) {
        db.exec('BEGIN');
        const revision = db.prepare('SELECT revision FROM memories WHERE id=?').get(memory.id);
        const job = db.prepare('SELECT status FROM reflection_jobs WHERE id=?').get(running.jobId);
        if (Number(revision?.revision) > 2 && job?.status === 'running') {
          beforeEffects = snapshot();
          killed = JSON.parse(
            String(db.prepare('SELECT data FROM reflections WHERE id=?').get(running.id)?.data),
          ) as ReflectionRecord;
          db.exec('COMMIT');
          process.kill(pid, 'SIGKILL');
          break;
        }
        db.exec('COMMIT');
        if (job?.status !== 'running') throw new Error('Reflection ended before committed-effect SIGKILL');
        await page.waitForTimeout(5);
      }
      break;
    }
    if (state.jobs.some((j) => j.id !== record.jobId && ['succeeded', 'failed', 'interrupted'].includes(j.status)))
      throw new Error('Second Reflection ended before observing its committed-effect crash window');
    await page.waitForTimeout(100);
  }
  assert.ok(foregroundCompleted && killed, 'Missing foreground overlap or committed-effect crash window');
  let recovered: Catalog | undefined;
  for (let i = 0; i < 200; i++) {
    try {
      recovered = await request<Catalog>(page, `/reflections?sessionId=${source.id}`);
      if (recovered.jobs.find((j) => j.id === killed.jobId)?.status === 'interrupted') break;
    } catch {}
    await page.waitForTimeout(200);
  }
  assert.ok(recovered);
  assert.equal(recovered.jobs.find((j) => j.id === killed.jobId)?.status, 'interrupted');
  const restored = recovered.records.find((r) => r.jobId === killed.jobId);
  assert.deepEqual(restored?.changes, killed.changes);
  const recoveredMemory = await request<{ current: { revision: number; content: string } }>(
    page,
    `/memory/${memory.id}?${new URLSearchParams({ project: root, includeHistory: 'true' })}`,
  );
  assert.equal(recoveredMemory.current.revision, 3);
  assert.match(recoveredMemory.current.content, /\b4\b/);
  assert.deepEqual(snapshot(), beforeEffects);
  await page.waitForTimeout(35000);
  const later = await request<Catalog>(page, `/reflections?sessionId=${source.id}`);
  assert.equal(later.jobs.find((j) => j.id === killed.jobId)?.status, 'interrupted');
  assert.deepEqual(later.records.find((r) => r.jobId === killed.jobId)?.changes, killed.changes);
  const afterEffects = snapshot();
  assert.deepEqual(afterEffects, beforeEffects);
  receipt.recovery = {
    before: killed,
    after: restored,
    beforeEffects,
    afterEffects,
    recoveredMemory,
    observationMs: 35000,
  };
  db.close();
  checks.push(
    'foreground completes during restricted Reflection; Host SIGKILL preserves committed effects as interrupted without replay',
  );
  receipt.passed = true;
} catch (error) {
  receipt.error = error instanceof Error ? error.message : String(error);
  try {
    const page = await app.firstWindow();
    const catalog = await request<Catalog>(page, '/reflections');
    receipt.reflection = catalog;
    const diagnostics = [];
    for (const record of catalog.records) {
      const traces = await request<{ items: Array<{ id: string }> }>(
        page,
        `/diagnostics?sessionId=${record.reflectionSessionId}`,
      );
      for (const trace of traces.items) diagnostics.push(await request(page, `/diagnostics/${trace.id}`));
    }
    receipt.diagnostics = diagnostics;
  } catch {}
  process.exitCode = 1;
} finally {
  await browser?.close();
  await app.close();
  await writeFile('docs/evidence/d3-signed-integration.json', JSON.stringify(receipt, null, 2) + '\n');
  if (process.env.AGENT_KEEP_D3_FIXTURE !== '1') await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify({ passed: receipt.passed, checks, error: receipt.error, root }));
}
