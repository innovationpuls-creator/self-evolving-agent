import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, chromium, type Page } from 'playwright-core';
import type { EvolutionActivity } from '../apps/host/evolution/activities.js';
const root = await mkdtemp(join(tmpdir(), 'd4-desktop-')),
  output = resolve(`docs/evidence/d4-desktop-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`);
await mkdir(output, { recursive: true });
const executable = resolve(process.env.AGENT_APP_PATH ?? 'release/Agent-darwin-arm64/Agent.app/Contents/MacOS/Agent');
const app = await _electron.launch({
  executablePath: executable,
  args: [`--user-data-dir=${join(root, 'profile')}`],
  env: { ...process.env, AGENT_DESKTOP_DATA_DIR: join(root, 'data') },
  timeout: 30000,
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const receipt: Record<string, unknown> = {
  time: new Date().toISOString(),
  platform: process.platform,
  executable,
  result: 'running',
};
const request = async <T>(page: Page, path: string, method = 'GET', body?: unknown): Promise<T> =>
  page.evaluate(
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
try {
  const page = await app.firstWindow({ timeout: 60000 });
  page.setDefaultTimeout(20000);
  await page
    .locator('.sidebar-bottom')
    .getByText('已连接', { exact: true })
    .waitFor({ timeout: 60000 })
    .catch(async (e) => {
      receipt.startup = await page.locator('body').innerText();
      await page.screenshot({ path: join(output, 'startup-failure.png') });
      throw e;
    });
  receipt.compiledSha256 = createHash('sha256')
    .update(await readFile(resolve(executable, '../../Resources/app/dist/host/runtime/agent.js')))
    .digest('hex');
  await request(page, '/credentials', 'POST', { provider: 'openai-codex', importExisting: true });
  const models = await request<{ models: Array<{ provider: string; id: string }> }>(page, '/models');
  const model = models.models.find((m) => m.id === 'gpt-6.1-sol') ?? models.models[0];
  assert.ok(model);
  const draftPath = join(root, 'unpublished-package');
  await mkdir(draftPath);
  await writeFile(
    join(draftPath, 'SKILL.md'),
    '---\nname: format-draft\ndescription: Unpublished format checker\n---\nPending development.\n',
  );
  await writeFile(
    join(draftPath, 'package.json'),
    JSON.stringify({ name: 'format-draft', pi: { skills: ['SKILL.md'], extensions: ['tool.js'] } }),
  );
  await writeFile(join(draftPath, 'tool.js'), "throw new Error('unpublished code must not execute');");
  const imported = await request<{ id: string }>(page, '/skills', 'POST', {
    source: draftPath,
    bindings: [{ skill: 'SKILL.md', extensions: ['tool.js'] }],
  });
  const importDeadline = Date.now() + 10000;
  for (;;) {
    const operation = await request<{ status: string; message: string }>(page, `/skills/operations/${imported.id}`);
    if (operation.status === 'applied') break;
    assert.notEqual(operation.status, 'failed', operation.message);
    assert.ok(Date.now() < importDeadline, 'draft import timeout');
    await new Promise((r) => setTimeout(r, 100));
  }
  const s = await request<{ id: string }>(page, '/sessions', 'POST', {
    cwd: root,
    provider: model.provider,
    model: model.id,
  });
  const shown = (client: Page) => client.locator('.host-retained-session:not([hidden])');
  const activityPanel = (client: Page) => shown(client).getByLabel('能力目标与改进进度', { exact: true });
  await page.locator(`.session-list [data-session="${s.id}"]`).click();
  // The capability entry belongs to a session with a finished turn, so the user first works in it.
  await shown(page).getByLabel('发送给 Agent', { exact: true }).fill('这一轮不要使用任何工具，只简短回复收到。');
  await shown(page).getByLabel('发送任务', { exact: true }).click();
  const turnDeadline = Date.now() + 180000;
  for (;;) {
    const view = await request<{ busy: boolean; error?: string }>(page, `/sessions/${s.id}`);
    if (!view.busy) {
      assert.equal(view.error, undefined);
      break;
    }
    assert.ok(Date.now() < turnDeadline, 'first turn timeout');
    await new Promise((r) => setTimeout(r, 300));
  }
  await activityPanel(page).getByText('让 Agent 改进这类任务', { exact: true }).click();
  await activityPanel(page).getByLabel('希望获得的能力', { exact: true }).fill('讨论一个以后再实现的文件格式检查能力');
  await activityPanel(page).getByRole('button', { name: '进入独立讨论', exact: true }).click();
  await activityPanel(page)
    .locator('[data-activity-status="discussion"]')
    .getByText('讨论中', { exact: true })
    .waitFor();
  const [a] = await request<EvolutionActivity[]>(page, '/activities');
  assert.ok(a, 'activity required');
  await page.locator(`.session-list [data-session="${a.sessionId}"][aria-current="page"]`).waitFor();
  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const web = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  web.setDefaultTimeout(20000);
  const token = await page.evaluate(() => sessionStorage.getItem('agent-connection-token'));
  await web.goto(`${new URL(page.url()).origin}/#token=${token}`);
  await web.locator('.sidebar-bottom').getByText('已连接', { exact: true }).waitFor();
  await web.locator(`.session-list [data-session="${a.sessionId}"]`).click();
  await activityPanel(web).getByRole('button', { name: '审阅开发授权', exact: true }).click();
  const grant = web.getByRole('dialog', { name: '授权能力开发' });
  await grant.locator('summary').filter({ hasText: '允许修改的已有技能' }).click();
  await grant.getByRole('checkbox', { name: /^format-draft\s*尚未生效候选$/ }).check();
  receipt.unpublishedDraftCanBeSelected = true;
  await grant.getByLabel('允许新建的技能名称', { exact: true }).fill('format-check');
  await web.screenshot({ path: join(output, 'web-discussion-same-host.png') });
  await activityPanel(page).getByRole('button', { name: '取消活动', exact: true }).click();
  await page.getByRole('dialog', { name: '取消改进' }).getByRole('button', { name: '确认取消', exact: true }).click();
  const cancelled = (client: Page) =>
    shown(client).locator('.host-activity[data-activity-status="cancelled"]').getByText('已取消', { exact: true });
  await cancelled(web).waitFor();
  assert.equal((await request<EvolutionActivity>(web, `/activities/${a.id}`)).status, 'cancelled');
  const catalog = await request<{ skills: Array<{ current?: string }> }>(page, '/skills');
  assert.equal(catalog.skills.length, 1);
  assert.ok(catalog.skills.every((s) => !s.current));
  await page.screenshot({ path: join(output, 'desktop-cancel.png') });
  await web.reload();
  await web.locator('.sidebar-bottom').getByText('已连接', { exact: true }).waitFor();
  await web.locator(`.session-list [data-session="${a.sessionId}"]`).click();
  await cancelled(web).waitFor();
  receipt.sharedHost = {
    sourceSession: s.id,
    discussionSession: a.sessionId,
    activityId: a.id,
    cancelled: true,
    webReload: true,
    unapprovedCodeLoaded: false,
  };
  // Suggestion adoption also creates the same D4 discussion/authorization entry.
  const suggestion = await request<{ id: string; revision: number }>(page, '/suggestions', 'POST', {
    title: '文件检查建议',
    goal: '评估是否需要格式检查能力',
    reason: '用户实际工作目标',
    value: '减少手工格式核对',
    uncertainty: '需要先明确格式',
    action: '先讨论',
    priority: 'normal',
    evidence: [],
  });
  const adopted = await request<{ discussionSessionId: string }>(page, `/suggestions/${suggestion.id}/adopt`, 'POST', {
    baseRevision: suggestion.revision,
  });
  const after = await request<EvolutionActivity[]>(page, '/activities');
  assert.ok(
    after.some(
      (x) =>
        x.sessionId === adopted.discussionSessionId && x.status === 'discussion' && x.suggestionId === suggestion.id,
    ),
  );
  receipt.suggestionDiscussion = true;
  receipt.result = 'passed';
  console.log(JSON.stringify(receipt));
} catch (e) {
  receipt.result = 'failed';
  receipt.error = e instanceof Error ? e.message : String(e);
  throw e;
} finally {
  await writeFile(join(output, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  await browser?.close();
  await app.close();
  await rm(root, { recursive: true, force: true });
}
