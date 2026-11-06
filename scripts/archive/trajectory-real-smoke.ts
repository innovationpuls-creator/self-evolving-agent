import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { startHost } from '../../apps/host/transport/server.js';
const root = await realpath(await mkdtemp(join(tmpdir(), 'trajectory-real-')));
const token = randomBytes(32).toString('hex');
const host = await startHost({ dataDir: join(root, 'data'), key: randomBytes(32), token, webDir: resolve('dist/web') });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const out = resolve(process.env.AGENT_VALIDATION_OUT ?? 'release/trajectory-real');
await mkdir(out, { recursive: true });
try {
  const request = async (path: string, method = 'GET', value?: unknown) => {
    const response = await fetch(`${host.origin}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
    assert.ok(response.ok, `${path}: ${response.status}`);
    return response.json();
  };
  await request('/credentials', 'POST', { provider: 'openai-codex', importExisting: true });
  const models = await request('/models');
  const model = models.models.find((m: { id: string }) => m.id === (process.env.AGENT_SMOKE_MODEL ?? 'gpt-6-luna'));
  assert.ok(model);
  const session = await host.service.create(root, model.provider, model.id);
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(`${host.origin}/#token=${token}`);
  await page.locator('nav button').filter({ hasText: root }).click();
  await page.getByRole('tab', { name: '轨迹', exact: true }).click();
  const observed = { live: false, turns: 0, tools: 0, error: false };
  await host.service.prompt(
    session.id,
    'Use native write to create acceptance.txt containing trajectory acceptance. Then use native read to read it. Then use native read once on missing-trajectory.txt (it does not exist), preserve that error and finish with a concise summary. Do not use bash or change other files.',
  );
  const deadline = Date.now() + 180000;
  while (true) {
    const state = await host.service.viewSession(session.id);
    observed.live ||= state.busy && (await page.locator('.trajectory-group').filter({ hasText: '运行中' }).count()) > 0;
    observed.turns = Math.max(observed.turns, await page.locator('.trajectory-turn').count());
    observed.tools = Math.max(observed.tools, await page.locator('[data-call-id]').count());
    observed.error ||= (await page.locator('.trajectory-call').filter({ hasText: '调用失败' }).count()) > 0;
    if (!state.busy) break;
    assert.ok(Date.now() < deadline, 'real model timeout');
    await new Promise((done) => setTimeout(done, 200));
  }
  await page.locator('.trajectory-group').filter({ hasText: '执行已结束' }).waitFor();
  await page.locator('.trajectory-call').filter({ hasText: '调用失败' }).waitFor();
  observed.error = true;
  assert.ok(observed.live && observed.turns >= 2 && observed.tools >= 2 && observed.error);
  await page.locator('.trajectory-call').filter({ hasText: '调用失败' }).click();
  await page.getByText('查看原始证据', { exact: true }).click();
  await page.locator('.diagnostics-evidence pre').filter({ hasText: 'missing-trajectory' }).waitFor();
  await page.screenshot({ path: join(out, 'real-tools.png'), fullPage: true });
  const catalog = await request(`/diagnostics?sessionId=${session.id}`);
  const trace = catalog.items[0];
  assert.ok(trace);
  const detail = await request(`/diagnostics/${trace.id}`);
  const failed = detail.calls.find((call: { status: string }) => call.status === 'error');
  assert.ok(failed?.resultEntryId);
  const ctx = await host.service.memoryUserContext(root);
  const memory = host.service.memory.create(
    { ...ctx, source: { sessionId: session.id, entryId: failed.resultEntryId, project: root } },
    { title: 'Real execution source', content: 'Recorded missing-file result', kind: 'experience', scope: 'project' },
    'Read actual native evidence',
  );
  const suggestion = host.service.evolution.create(
    { actor: 'user', project: root },
    {
      title: 'Real trace source',
      goal: 'inspect',
      reason: 'review',
      value: 'review',
      uncertainty: 'review',
      action: 'review',
      evidence: [{ traceId: trace.id }],
      priority: 'high',
      attentionReason: 'review',
    },
  );
  const nav = (name: string | RegExp) =>
    page
      .locator('aside')
      .getByRole('button', { name, exact: typeof name === 'string' })
      .click();
  await nav('记忆管理');
  await page.locator('.memory-item').filter({ hasText: memory.title }).click();
  await page.getByRole('button', { name: '查看执行证据', exact: true }).first().click();
  await page.locator('.diagnostics-evidence pre').filter({ hasText: 'missing-trajectory' }).waitFor();
  await nav(/^进化建议/);
  await page.locator('.evolution-catalog button').filter({ hasText: suggestion.title }).click();
  await page.locator('.evolution-detail summary').filter({ hasText: '依据与来源' }).click();
  await page.getByRole('button', { name: '查看来源轨迹', exact: true }).click();
  await page.locator(`[data-trace-id="${trace.id}"]`).waitFor();
  const id = randomUUID();
  const db = new DatabaseSync(join(root, 'data', 'product.sqlite'));
  db.prepare(
    'INSERT INTO reflection_jobs(id,session_id,project,provider,model,scheduled_at,created,updated,status,last_marker_entry_id,reflection_session_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    id,
    session.id,
    root,
    model.provider,
    model.id,
    Date.now(),
    Date.now(),
    Date.now(),
    'succeeded',
    'fixture-marker',
    randomUUID(),
  );
  db.prepare(
    'INSERT INTO reflection_job_sources(job_id,session_id,marker_entry_id,settled_at,status) VALUES(?,?,?,?,?)',
  ).run(id, session.id, 'fixture-marker', Date.now(), 'ended');
  db.prepare('INSERT INTO reflections VALUES(?,?,?,?)').run(
    id,
    session.id,
    root,
    JSON.stringify({
      id,
      jobId: id,
      sessionId: session.id,
      reflectionSessionId: randomUUID(),
      project: root,
      status: 'succeeded',
      created: Date.now(),
      updated: Date.now(),
      summary: 'Actual execution evidence link',
      findings: [],
      uncertainties: [],
      evidence: [{ sessionId: session.id, entryId: failed.resultEntryId }],
      changes: [],
    }),
  );
  db.close();
  await nav('反思记录');
  await page.locator('.reflection-item').filter({ hasText: 'Actual execution evidence link' }).click();
  await page.locator('.reflection-detail summary').filter({ hasText: '判断依据与历史引用' }).click();
  await page.getByRole('button', { name: '查看原始证据', exact: true }).first().click();
  await page.locator('.diagnostics-evidence pre').filter({ hasText: 'missing-trajectory' }).waitFor();

  await host.service.prompt(
    session.id,
    'Inspect the just completed run using each of the three native diagnostic tools: diagnostic_search, diagnostic_get, diagnostic_evidence. Use the returned real IDs and read one evidence entry. Do not use bash, read or write. Give a concise report.',
  );
  const toolDeadline = Date.now() + 180000;
  let state = await host.service.viewSession(session.id);
  while (state.busy && Date.now() < toolDeadline) {
    await new Promise((done) => setTimeout(done, 300));
    state = await host.service.viewSession(session.id);
  }
  assert.equal(state.busy, false);
  const tools = state.messages.filter((m) => m.role === 'toolResult').map((m) => m.toolName);
  for (const name of ['diagnostic_search', 'diagnostic_get', 'diagnostic_evidence'])
    assert.ok(tools.includes(name), name);
  const receipt = {
    provider: model.provider,
    model: model.id,
    observed,
    nativeTools: tools,
    time: new Date().toISOString(),
    evidenceNavigation: ['Memory Entry', 'Evolution Trace-only', 'Reflection Entry'],
    reflectionRecord:
      'Deterministic read fixture referencing actual model execution; Reflection executor covered by regression tests',
    passed: true,
  };
  await writeFile(join(out, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally {
  await Promise.all([browser.close(), host.close()]);
  await rm(root, { recursive: true, force: true });
}
