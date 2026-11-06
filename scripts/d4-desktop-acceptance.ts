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
    .locator('.shell')
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
  await page.locator('nav button').filter({ hasText: root }).click();
  await page.getByText('能力目标与开发活动', { exact: true }).click();
  await page.getByLabel('能力目标', { exact: true }).fill('讨论一个以后再实现的文件格式检查能力');
  await page.getByRole('button', { name: '进入独立讨论', exact: true }).click();
  await page.getByRole('region', { name: '能力开发活动' }).waitFor();
  const [a] = await request<EvolutionActivity[]>(page, '/activities');
  assert.ok(a, 'activity required');
  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const web = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  web.setDefaultTimeout(20000);
  const token = await page.evaluate(() => sessionStorage.getItem('agent-connection-token'));
  await web.goto(`${new URL(page.url()).origin}/#token=${token}`);
  await web.locator('.shell').waitFor();
  await web.locator('nav button').filter({ hasText: '讨论一个以后再实现的文件格式检查能力' }).click();
  await web.getByText('确认开发范围', { exact: true }).click();
  await web.getByRole('checkbox', { name: 'format-draft（未生效候选）' }).check();
  receipt.unpublishedDraftCanBeSelected = true;
  await web.getByLabel('允许创建的能力名称').fill('format-check');
  await web.screenshot({ path: join(output, 'web-discussion-same-host.png') });
  await page.getByRole('button', { name: '取消活动', exact: true }).click();
  await web.getByText('已取消', { exact: true }).waitFor();
  assert.equal((await request<EvolutionActivity>(web, `/activities/${a.id}`)).status, 'cancelled');
  const catalog = await request<{ skills: Array<{ current?: string }> }>(page, '/skills');
  assert.equal(catalog.skills.length, 1);
  assert.ok(catalog.skills.every((s) => !s.current));
  await page.screenshot({ path: join(output, 'desktop-cancel.png') });
  await web.reload();
  await web.getByText('已取消', { exact: true }).waitFor();
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
