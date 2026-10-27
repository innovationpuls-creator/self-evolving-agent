import { DatabaseSync } from 'node:sqlite';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { snapshot as saveSnapshot } from '../apps/host/storage/storage.js';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { startHost } from '../apps/host/transport/server.js';
const root = await realpath(await mkdtemp(join(tmpdir(), 'trajectory-ui-')));
const token = randomBytes(32).toString('hex');
const host = await startHost({ dataDir: join(root, 'data'), key: randomBytes(32), token, webDir: resolve('dist/web') });
const fake = fauxProvider({
  models: [{ id: 'browser-model', contextWindow: 100000, maxTokens: 2048 }],
  tokensPerSecond: 60,
});
host.service.runtime.registerNativeProvider(fake.provider);
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const out = resolve(process.env.AGENT_VALIDATION_OUT ?? 'release/trajectory-browser');
await mkdir(out, { recursive: true });
const checks: string[] = [];
try {
  await writeFile(join(root, 'large.txt'), 'ACTUAL_EVIDENCE '.repeat(1800));
  const a = await host.service.create(root, fake.provider.id, 'browser-model');
  const other = join(root, 'other');
  await mkdir(other);
  await host.service.create(other, fake.provider.id, 'browser-model');
  fake.setResponses([
    fauxAssistantMessage(fauxToolCall('read', { path: 'large.txt' }, { id: 'read-success' }), {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage(fauxToolCall('read', { path: 'missing.txt' }, { id: 'read-error' }), {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage('Completed the real native tool chain, including the recorded missing-file error.'),
  ]);
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(20000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let disconnect = () => {};
  await page.routeWebSocket('**/events', (route) => {
    route.connectToServer();
    disconnect = () => route.close({ code: 1001, reason: 'test reconnect' });
  });
  await page.goto(`${host.origin}/#token=${token}`);
  const ready = () =>
    page.waitForFunction(() => document.querySelector('.connection')?.textContent?.includes('已连接'));
  await ready();
  const select = async (cwd: string) => {
    if (await page.getByRole('button', { name: '打开导航' }).isVisible())
      await page.getByRole('button', { name: '打开导航' }).click();
    await page
      .locator('nav button')
      .filter({
        has: page.locator('small').filter({ hasText: new RegExp(`^${cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }),
      })
      .last()
      .click();
    await page.getByLabel('任务', { exact: true }).waitFor();
  };
  await select(root);
  assert.equal(await page.getByRole('button', { name: '历史日志', exact: true }).count(), 0);
  await page.getByLabel('任务', { exact: true }).fill('keep draft A');
  await page.getByRole('tab', { name: '轨迹', exact: true }).click();
  assert.equal(await page.getByLabel('任务', { exact: true }).inputValue(), 'keep draft A');
  await select(other);
  await page.getByLabel('任务', { exact: true }).fill('keep draft B');
  assert.equal(await page.getByRole('tab', { name: '对话', exact: true }).getAttribute('aria-selected'), 'true');
  await select(root);
  assert.equal(await page.getByRole('tab', { name: '轨迹', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.getByLabel('任务', { exact: true }).inputValue(), 'keep draft A');
  checks.push('standalone navigation removed; Tabs, drafts and Session state isolated');
  await host.service.prompt(a.id, 'Read large.txt then missing.txt, finish.');
  await page.locator('.trajectory-group').filter({ hasText: '运行中' }).waitFor();
  await page.locator('[data-call-id="read-success"]').waitFor();
  assert.ok((await host.service.viewSession(a.id)).busy, 'Tool row updates while Agent is running');
  await page.locator('[data-call-id="read-error"]').filter({ hasText: '调用失败' }).waitFor();
  await page.locator('.trajectory-group').filter({ hasText: '执行已结束' }).waitFor();
  checks.push('live Trace, model Turns, native Tool success/error and completion update without refresh');
  await page.locator('[data-call-id="read-success"]').click();
  await page.getByText('查看原始证据', { exact: true }).click();
  await page.locator('.diagnostics-evidence pre').filter({ hasText: 'ACTUAL_EVIDENCE' }).waitFor();
  await page.getByRole('button', { name: '后一段证据', exact: true }).click();
  await page.getByRole('button', { name: '前一段证据', exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.getByLabel('搜索已加载轨迹').fill('missing.txt');
  await select(other);
  assert.equal(await page.locator('.trajectory-group:visible').count(), 0);
  await select(root);
  assert.equal(await page.getByLabel('搜索已加载轨迹').inputValue(), 'missing.txt');
  await page.getByLabel('搜索已加载轨迹').fill('');
  disconnect();
  await ready();
  await page.locator('[data-call-id="read-error"]').waitFor();
  checks.push('lazy raw evidence pagination; local search isolation; websocket reconnect snapshot');
  let releaseSnapshot = () => {};
  let requestEntered = () => {};
  const heldSnapshot = new Promise<void>((done) => {
    releaseSnapshot = done;
  });
  const snapshotEntered = new Promise<void>((done) => {
    requestEntered = done;
  });
  await page.route(
    `**/api/sessions/${a.id}`,
    async (route) => {
      requestEntered();
      await heldSnapshot;
      await route.continue().catch(() => {});
    },
    { times: 1 },
  );
  await page.evaluate(() => window.dispatchEvent(new Event('agent-diagnostics-changed')));
  await snapshotEntered;
  await select(other);
  releaseSnapshot();
  await page.getByRole('tab', { name: '轨迹', exact: true }).click();
  assert.equal(await page.locator('[data-call-id="read-success"]').count(), 0);
  await select(root);
  await page.locator('[data-call-id="read-success"]').waitFor();
  checks.push('cancelled in-flight Session snapshot cannot populate another Session');
  await page.route(
    `**/api/sessions/${a.id}`,
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporary snapshot failure' }),
      }),
    { times: 1 },
  );
  await page.evaluate(() => window.dispatchEvent(new Event('agent-diagnostics-changed')));
  await page.getByRole('button', { name: '重试轨迹', exact: true }).waitFor();
  await page.getByRole('button', { name: '重试轨迹', exact: true }).click();
  await page.getByRole('button', { name: '重试轨迹', exact: true }).waitFor({ state: 'hidden' });
  checks.push('snapshot failure preserves recorded content and offers inline retry');

  const snapshot = await host.service.viewSession(a.id);
  const entries: Array<{ id: string; message?: { role: string } }> = [];
  const walk = (nodes: typeof snapshot.tree) => {
    for (const node of nodes ?? []) {
      entries.push(node.entry);
      walk(node.children);
    }
  };
  walk(snapshot.tree);
  const result = entries.find((e) => e.message?.role === 'toolResult');
  assert.ok(result);
  const ctx = await host.service.memoryUserContext(root);
  const memory = host.service.memory.create(
    { ...ctx, source: { sessionId: a.id, entryId: result.id, project: root } },
    { title: 'Trajectory source memory', content: 'A recorded native source', kind: 'experience', scope: 'project' },
    'Evidence test',
  );
  const suggestion = host.service.evolution.create(
    { actor: 'user', project: root },
    {
      title: 'Trajectory source suggestion',
      goal: 'inspect',
      reason: 'source',
      value: 'inspect',
      uncertainty: 'review',
      action: 'review',
      evidence: [{ sessionId: a.id }],
      priority: 'high',
      attentionReason: 'review',
    },
  );
  const nav = async (name: string | RegExp) => {
    await page
      .locator('aside')
      .getByRole('button', { name, exact: typeof name === 'string' })
      .click();
  };
  await nav('记忆管理');
  await page.locator('.memory-item').filter({ hasText: memory.title }).click();
  await page.getByRole('button', { name: '查看执行证据', exact: true }).first().click();
  await page.locator('.diagnostics-evidence pre').filter({ hasText: 'ACTUAL_EVIDENCE' }).waitFor();
  await nav(/^进化建议/);
  await page.locator('.evolution-catalog button').filter({ hasText: suggestion.title }).click();
  await page.locator('.evolution-detail summary').filter({ hasText: '依据与来源' }).click();
  await page.getByRole('button', { name: '查看来源轨迹', exact: true }).click();
  await page.getByRole('tab', { name: '轨迹', exact: true }).waitFor();
  checks.push('Memory Entry reference and Evolution Session-only reference locate in Session trajectory');
  // Persist a restricted source without activating a background Agent.
  const manager = SessionManager.inMemory(root);
  const restrictedId = manager.getSessionId();
  const restrictedEntry = manager.appendMessage(fauxAssistantMessage('RESTRICTED_REFLECTION_SOURCE'));
  await host.service.store.write(`sessions/${restrictedId}.enc`, {
    record: {
      id: restrictedId,
      cwd: root,
      provider: fake.provider.id,
      model: 'browser-model',
      title: 'Background reflection',
      updated: Date.now(),
      purpose: 'reflection',
    },
    session: saveSnapshot(manager),
  });
  await assert.rejects(host.service.viewSession(restrictedId), /受控历史/);
  const db = new DatabaseSync(join(root, 'data', 'product.sqlite'));
  const jobId = randomUUID();
  const reflection = {
    id: jobId,
    jobId,
    sessionId: a.id,
    reflectionSessionId: restrictedId,
    project: root,
    status: 'succeeded',
    created: Date.now(),
    updated: Date.now(),
    summary: 'Trajectory reflection evidence',
    findings: [],
    uncertainties: [],
    evidence: [{ sessionId: restrictedId, entryId: restrictedEntry }],
    changes: [],
  };
  db.prepare(
    'INSERT INTO reflection_jobs(id,session_id,project,provider,model,scheduled_at,created,updated,status,last_marker_entry_id,reflection_session_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    jobId,
    a.id,
    root,
    fake.provider.id,
    'browser-model',
    Date.now(),
    Date.now(),
    Date.now(),
    'succeeded',
    'fixture-marker',
    restrictedId,
  );
  db.prepare(
    'INSERT INTO reflection_job_sources(job_id,session_id,marker_entry_id,settled_at,status) VALUES(?,?,?,?,?)',
  ).run(jobId, a.id, 'fixture-marker', Date.now(), 'ended');
  db.prepare('INSERT INTO reflections VALUES(?,?,?,?)').run(jobId, a.id, root, JSON.stringify(reflection));
  db.close();
  await nav('反思记录');
  await page.locator('.reflection-item').filter({ hasText: 'Trajectory reflection evidence' }).click();
  await page.locator('.reflection-detail summary').filter({ hasText: '判断依据与历史引用' }).first().click();
  await page.getByRole('button', { name: '查看原始证据', exact: true }).first().click();
  await page.locator('.diagnostics-evidence pre').filter({ hasText: 'RESTRICTED_REFLECTION_SOURCE' }).waitFor();
  assert.equal((await host.service.viewSession(a.id)).leafId, snapshot.leafId);
  checks.push(
    'Reflection restricted source reads existing encrypted evidence without Agent activation or branch mutation',
  );
  const sourcePage = await browser.newPage();
  await sourcePage.goto(`${host.origin}/#token=${token}`);
  await sourcePage.evaluate(
    ({ sessionId, entryId }) =>
      sessionStorage.setItem('agent-navigation', JSON.stringify({ kind: 'chat', evidence: { sessionId, entryId } })),
    { sessionId: restrictedId, entryId: restrictedEntry },
  );
  await sourcePage.reload();
  await sourcePage.locator('.diagnostics-evidence pre').filter({ hasText: 'RESTRICTED_REFLECTION_SOURCE' }).waitFor();
  assert.equal(await sourcePage.getByLabel('任务', { exact: true }).count(), 0);
  assert.equal(await sourcePage.locator('.session-tools').count(), 0);
  await sourcePage.close();
  checks.push('restricted evidence opens without selected Session or execution controls');
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  const assistantEntry = entries.find((e) => e.message?.role === 'assistant');
  assert.ok(assistantEntry);
  await host.service.action(a.id, 'branch', assistantEntry.id);
  await select(other);
  await select(root);
  await page.getByRole('tab', { name: '轨迹', exact: true }).click();
  await page.locator('.trajectory-group').filter({ hasText: '当前分支片段' }).waitFor();
  assert.equal(await page.locator('[data-call-id="read-error"]').count(), 0);
  assert.ok(!(await page.locator('[data-call-id="read-success"]').innerText()).includes('调用完成'));
  await nav('记忆管理');
  await page.locator('.memory-item').filter({ hasText: memory.title }).click();
  await page.getByRole('button', { name: '查看执行证据', exact: true }).first().click();
  await page.locator('.diagnostics-evidence pre').filter({ hasText: 'ACTUAL_EVIDENCE' }).waitFor();
  await page.getByText('此证据来自历史分支', { exact: false }).waitFor();
  checks.push(
    'rollback inside Trace excludes abandoned calls/results; old-branch Memory evidence remains read-only accessible',
  );
  await page.screenshot({ path: join(out, 'trajectory-desktop.png'), fullPage: true });
  if (await page.getByRole('button', { name: '关闭详情', exact: true }).isVisible())
    await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-call-id="read-success"]').click();
  await page.screenshot({ path: join(out, 'trajectory-mobile.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const archive = SessionManager.inMemory(root);
  const archiveId = archive.getSessionId();
  for (let index = 0; index < 40; index++) {
    const traceId = randomUUID();
    archive.appendCustomEntry('diagnostic_trace_v1', { version: 1, phase: 'start', traceId, at: Date.now() });
    archive.appendMessage({ role: 'user', content: `Historical task ${index}`, timestamp: Date.now() });
    archive.appendMessage(fauxAssistantMessage(`Historical answer ${index}`));
    archive.appendCustomEntry('diagnostic_trace_v1', {
      version: 1,
      phase: 'end',
      traceId,
      at: Date.now(),
      status: 'ended',
    });
  }
  await host.service.store.write(`sessions/${archiveId}.enc`, {
    record: {
      id: archiveId,
      cwd: root,
      provider: fake.provider.id,
      model: 'browser-model',
      title: 'Historical fixture',
      updated: Date.now(),
    },
    session: saveSnapshot(archive),
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(
    (sessionId) =>
      sessionStorage.setItem(
        'agent-navigation',
        JSON.stringify({ kind: 'diagnostics', diagnosticSessionId: sessionId }),
      ),
    archiveId,
  );
  await page.reload();
  await ready();
  await page.getByRole('tab', { name: '轨迹', exact: true }).waitFor();
  await page.locator('.trajectory-group').filter({ hasText: 'Historical task 39' }).waitFor();
  assert.equal(await page.locator('.trajectory-group').count(), 30);
  await page.locator('.trajectory-ledger').evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll'));
  });
  await page.getByRole('button', { name: '加载更早轨迹', exact: true }).click();
  await page.locator('.trajectory-group').filter({ hasText: 'Historical task 0' }).waitFor();
  fake.setResponses([fauxAssistantMessage('New answer after opening historical session')]);
  await host.service.prompt(archiveId, 'Continue history');
  await page.getByRole('button', { name: '查看最新执行 ↓', exact: true }).waitFor();
  assert.ok(
    await page.locator('.trajectory-ledger').evaluate((el) => el.scrollTop < el.scrollHeight - el.clientHeight - 80),
  );
  await page.getByRole('button', { name: '查看最新执行 ↓', exact: true }).click();
  await page.locator('.trajectory-group').filter({ hasText: 'New answer after opening historical session' }).waitFor();
  checks.push(
    'legacy navigation migrates into Session trajectory; historical load-more and scroll-up pause/tail resume',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    join(out, 'receipt.json'),
    JSON.stringify(
      { checks, provider: 'Faux model; real Host, Pi sessions and native tools', time: new Date().toISOString() },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks }));
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await browser.close();
  await host.close();
  await rm(root, { recursive: true, force: true });
}
