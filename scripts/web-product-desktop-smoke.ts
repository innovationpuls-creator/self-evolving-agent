import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, chromium, type Page } from 'playwright-core';
const root = await mkdtemp(join(tmpdir(), 'web-product-'));
const executable = resolve(process.env.AGENT_APP_PATH ?? 'release/Agent-darwin-arm64/Agent.app/Contents/MacOS/Agent');
const screenshots = resolve('release/web-product-evidence');
await mkdir(screenshots, { recursive: true });
const receipt: Record<string, unknown> = {
  time: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  executable,
  scope: 'Packaged Desktop/Web integration; unavailable Reflection is never substituted',
  checks: [],
  reflectionBusinessChain: 'blocked',
};
const checks = receipt.checks as string[];
const app = await _electron.launch({
  executablePath: executable,
  args: [`--user-data-dir=${join(root, 'profile')}`],
  env: { ...process.env, AGENT_DESKTOP_DATA_DIR: join(root, 'data') },
  timeout: 30000,
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
try {
  const page = await app.firstWindow({ timeout: 60000 });
  page.setDefaultTimeout(20000);
  await page.locator('.shell').waitFor({ timeout: 30000 });
  receipt.packageEntrySha256 = createHash('sha256')
    .update(await readFile(executable))
    .digest('hex');
  const contents = resolve(executable, '../..');
  receipt.nativeRuntime = JSON.parse(
    await readFile(join(contents, 'Helpers/ReflectionBridge.app/Contents/Resources/reflection-runtime.json'), 'utf8'),
  );
  receipt.compiledSha256 = Object.fromEntries(
    await Promise.all(
      ['host/reflection/reflection-service.js', 'host/reflection/worker.js', 'desktop/main.js'].map(async (file) => [
        file,
        createHash('sha256')
          .update(await readFile(join(contents, 'Resources/app/dist', file)))
          .digest('hex'),
      ]),
    ),
  );
  const catalog = await request<{ availability: { available: boolean; reason?: string } }>(page, '/reflections');
  receipt.availability = catalog.availability;
  assert.equal(catalog.availability.available, false);
  assert.match(catalog.availability.reason ?? '', /签名/);
  checks.push('ad-hoc package reports unavailable rather than privileged fallback');
  let providerImported = false;
  try {
    await request(page, '/credentials', 'POST', { provider: 'openai-codex', importExisting: true });
    providerImported = true;
  } catch {
    receipt.provider = 'blocked: existing credentials unavailable';
  }
  const session = await request<{ id: string }>(page, '/sessions', 'POST', {
    cwd: root,
    provider: 'openai-codex',
    model: 'gpt-6-luna',
  });
  if (providerImported) {
    await request(page, `/sessions/${session.id}/prompt`, 'POST', {
      text: 'Use your native write tool to create web-acceptance.txt with exactly WEB_PRODUCT_REAL_TOOL_OK, then use the native read tool to read it. Do not use bash or change any other files.',
    });
    const deadline = Date.now() + 120000;
    let state: {
      busy: boolean;
      error?: string;
      messages: Array<{ role: string; toolName?: string; stopReason?: string }>;
    };
    do {
      await new Promise((r) => setTimeout(r, 250));
      state = await request(page, `/sessions/${session.id}`);
      assert.ok(Date.now() < deadline, 'ordinary Provider task timed out');
    } while (state.busy);
    assert.equal(state.error, undefined, 'real Provider task must succeed');
    assert.equal(
      state.messages.some((m) => m.stopReason === 'error'),
      false,
    );
    assert.equal((await readFile(join(root, 'web-acceptance.txt'), 'utf8')).trim(), 'WEB_PRODUCT_REAL_TOOL_OK');
    const toolNames = state.messages.filter((m) => m.role === 'toolResult').map((m) => m.toolName);
    assert.ok(toolNames.includes('write') && toolNames.includes('read'));
    checks.push('real Provider native write/read results match actual file');
    receipt.provider = {
      provider: 'openai-codex',
      model: 'gpt-6-luna',
      sessionId: session.id,
      status: state.error ? 'failed' : 'succeeded',
    };
    await request(page, '/reflections/expedite', 'POST', { sessionId: session.id });
    let stateAfter: { jobs: Array<{ id: string; status: string; sources: unknown[] }> };
    const statusDeadline = Date.now() + 30000;
    do {
      stateAfter = await request(page, `/reflections?sessionId=${session.id}`);
      if (stateAfter.jobs[0]?.status === 'waiting_user') break;
      await page.waitForTimeout(200);
    } while (Date.now() < statusDeadline);
    assert.equal(stateAfter.jobs.length, 1);
    assert.equal(stateAfter.jobs[0]?.status, 'waiting_user');
    receipt.trigger = stateAfter.jobs[0];
    checks.push('real ordinary Provider task produces durable settled source and explicit waiting_user');
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const web = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const token = await page.evaluate(() => sessionStorage.getItem('agent-connection-token'));
  await web.goto(`${new URL(page.url()).origin}/#token=${token}`);
  await web.locator('.shell').waitFor();
  const title = `D3 discussion ${randomUUID().slice(0, 8)}`;
  const suggestion = await request<{ id: string; revision: number }>(page, '/suggestions', 'POST', {
    title,
    goal: 'Review a workflow idea',
    reason: 'Integration fixture submitted explicitly through the user interface API',
    value: 'Assess whether it helps',
    uncertainty: 'No implementation authorized',
    action: 'Discuss evidence first',
    evidence: [],
    priority: 'high',
    attentionReason: 'Inspect the discussion entry',
  });
  await web.getByRole('button', { name: /^进化建议/ }).click();
  await web
    .locator('.evolution-catalog')
    .getByRole('button', { name: new RegExp(title) })
    .click();
  await web.getByRole('heading', { name: title, exact: true }).waitFor();
  await web.getByRole('button', { name: '采纳并讨论' }).click();
  await web.locator('header h1').filter({ hasText: title }).waitFor();
  assert.ok((await web.locator('main').innerText()).includes('尚未授权开发'));
  checks.push('Web adoption opens visible native discussion context without automatic prompt');
  const adopted = await request<{ status: string; discussionSessionId: string; revision: number }>(
    page,
    `/suggestions/${suggestion.id}`,
  );
  assert.equal(adopted.status, 'adopted');
  const discussion = await request<{ busy: boolean; messages: Array<{ role: string }> }>(
    page,
    `/sessions/${adopted.discussionSessionId}`,
  );
  assert.equal(discussion.busy, false);
  assert.equal(
    discussion.messages.some((m) => m.role === 'assistant'),
    false,
  );
  receipt.discussion = { suggestionId: suggestion.id, sessionId: adopted.discussionSessionId };
  await page.getByRole('button', { name: /^进化建议/ }).click();
  await page.getByRole('combobox', { name: '状态' }).selectOption('adopted');
  await page
    .locator('.evolution-catalog')
    .getByRole('button', { name: new RegExp(title) })
    .click();
  await page.getByRole('heading', { name: title, exact: true }).waitFor();
  await page.getByRole('checkbox', { name: `选择建议：${title}`, exact: true }).check();
  await page.getByRole('button', { name: '批量归档' }).click();
  await web.getByRole('button', { name: /^进化建议/ }).click();
  await web.getByRole('combobox', { name: '状态' }).selectOption('archived');
  await web
    .locator('.evolution-catalog')
    .getByRole('button', { name: new RegExp(title) })
    .click();
  await web.locator('.evolution-detail-meta').getByText('已归档', { exact: false }).waitFor();
  checks.push('Desktop archive is authoritative in Web and retains discussion link');
  await web.screenshot({ path: join(screenshots, 'suggestions.png'), fullPage: true });
  await page.getByRole('button', { name: '反思记录', exact: true }).click();
  await page
    .getByText(/需要 Apple Development 或 Developer ID/)
    .first()
    .waitFor();
  await page.screenshot({ path: join(screenshots, 'reflection-unavailable.png'), fullPage: true });
  const pid = await app.evaluate(({ app }) => app.getAppMetrics().find((m) => m.name === 'Agent Host')?.pid);
  assert.ok(pid);
  process.kill(pid, 'SIGKILL');
  await page.locator('.connection-banner').waitFor({ timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('.connection')?.textContent?.includes('已连接'), {
    timeout: 30000,
  });
  assert.equal((await request<{ status: string }>(page, `/suggestions/${suggestion.id}`)).status, 'archived');
  checks.push('Host SIGKILL reconnect reads persisted suggestion state');
  if (providerImported) {
    const blocked = await request<{ jobs: Array<{ status: string }> }>(page, `/reflections?sessionId=${session.id}`);
    assert.equal(blocked.jobs[0]?.status, 'waiting_user');
    checks.push('Host restart preserves real ordinary task Reflection waiting_user');
  }
  receipt.blocker =
    'No Apple-issued signing identity is installed. Same-team XPC authentication cannot be accepted with ad-hoc signing. Full real Provider Reflection chain and OS deny probes remain unverified.';
} catch (error) {
  receipt.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await app.close();
  await rm(root, { recursive: true, force: true });
  await mkdir('docs/evidence', { recursive: true });
  await writeFile('docs/evidence/web-product-desktop.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
}
