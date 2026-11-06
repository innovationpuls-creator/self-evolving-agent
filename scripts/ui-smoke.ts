import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, chromium, type ElectronApplication, type Page } from 'playwright-core';
import type { AgentService } from '../apps/host/runtime/agent.js';

const root = await mkdtemp(join(tmpdir(), 'agent-ui-'));
const executable = process.env.AGENT_APP_PATH ?? resolve('release/Agent-darwin-arm64/Agent.app/Contents/MacOS/Agent');
const launch = () =>
  _electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${join(root, 'profile')}`],
    env: { ...process.env, AGENT_DESKTOP_DATA_DIR: join(root, 'data') },
    timeout: 30000,
  });
let desktop: ElectronApplication | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
async function ready(app: ElectronApplication) {
  const page = await app.firstWindow();
  await page.locator('.app.host-product').waitFor({ timeout: 30000 });
  return page;
}
async function state(page: Page): ReturnType<AgentService['viewSession']> {
  return page.evaluate(async () => {
    const headers = { Authorization: `Bearer ${sessionStorage.getItem('agent-connection-token')}` };
    const list = await (await fetch('/api/sessions', { headers })).json();
    return (await fetch(`/api/sessions/${list[0].id}`, { headers })).json();
  });
}
async function stateAt(origin: string, token: string): Promise<Awaited<ReturnType<AgentService['viewSession']>>> {
  const headers = { Authorization: `Bearer ${token}` };
  const sessions = await (await fetch(`${origin}/api/sessions`, { headers })).json();
  const response = await fetch(`${origin}/api/sessions/${sessions[0].id}`, { headers });
  assert.equal(response.ok, true, `Host returned ${response.status}`);
  return response.json();
}
async function idle(getState: () => Promise<Awaited<ReturnType<AgentService['viewSession']>>>) {
  const deadline = Date.now() + 180000;
  let current: Awaited<ReturnType<typeof state>>;
  do {
    await new Promise((ok) => setTimeout(ok, 400));
    current = await getState();
  } while (current.busy && Date.now() < deadline);
  assert.equal(current.busy, false);
  const lastMessage = current.messages.at(-1);
  assert.equal(
    current.error,
    undefined,
    (lastMessage?.role === 'assistant' ? lastMessage.errorMessage : undefined) ?? current.error ?? '模型运行失败',
  );
  return current;
}
async function submit(page: Page, prompt: string) {
  await page.getByLabel('发送给 Agent', { exact: true }).fill(prompt);
  await page.getByLabel('发送任务', { exact: true }).click();
  await page.getByLabel('停止当前执行', { exact: true }).waitFor();
}

async function openSession(page: Page) {
  const session = page.locator('.session-list [data-session]').first();
  await session.waitFor();
  await session.click();
  await page.getByLabel('发送给 Agent', { exact: true }).waitFor();
}
try {
  desktop = await launch();
  let page = await ready(desktop);
  const origin = new URL(page.url()).origin;
  const token = await page.evaluate(() => sessionStorage.getItem('agent-connection-token'));
  if (!token) throw new Error('Desktop did not receive the Host connection token');
  assert.equal(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require), 'undefined');
  await page.getByLabel('模型与连接', { exact: true }).click();
  await page.getByLabel('模型提供方').selectOption('openai-codex');
  await page.getByRole('button', { name: '从本机导入已有登录' }).click();
  await page.getByRole('status').filter({ hasText: '已导入本机已有登录' }).waitFor();
  await page.getByRole('button', { name: '返回上一个位置', exact: true }).click();
  await page.getByRole('button', { name: '新会话', exact: true }).click();
  const create = page.getByRole('dialog', { name: '开始一段新会话' });
  await create
    .getByLabel('模型')
    .locator('option[value="openai-codex:gpt-6-luna"]')
    .waitFor({ state: 'attached', timeout: 30000 });
  await create.getByLabel('项目文件夹').fill(root);
  await create.getByLabel('模型').selectOption('openai-codex:gpt-6-luna');
  await create.getByRole('button', { name: '创建会话', exact: true }).click();
  await submit(
    page,
    'Use the native write tool to create ui-acceptance.txt in the current directory with exactly UI real model success. Then read it with the native read tool. Do not use bash or modify any other file.',
  );
  const hidden = await desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return undefined;
    window.close();
    return window.isVisible();
  });
  assert.equal(hidden, false, 'Desktop window did not hide after close');
  await idle(() => stateAt(origin, token));
  assert.equal((await readFile(join(root, 'ui-acceptance.txt'), 'utf8')).trim(), 'UI real model success');
  await desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error('Desktop window disappeared after close');
    window.show();
  });
  await page.reload();
  await page.locator('.app.host-product').waitFor();
  await openSession(page);
  assert.ok((await page.locator('details').count()) >= 2);
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const web = await browser.newPage({ acceptDownloads: true });
  await web.goto(`${origin}/#token=${encodeURIComponent(token)}`);
  await web.locator('.app.host-product').waitFor();
  await openSession(web);
  await writeFile(join(root, 'ui-acceptance.txt'), 'UI real model success\npassword="mac acceptance phrase"\n');
  await submit(
    web,
    'Continue this session. Read ui-acceptance.txt with the native read tool and report its content. Do not modify files.',
  );
  await idle(() => state(web));
  await web.getByLabel('发送任务', { exact: true }).waitFor({ timeout: 180000 });
  assert.ok((await web.getByLabel('Agent 回复').last().innerText()).includes('UI real model success'));
  assert.ok(!(await web.locator('main').innerText()).includes('mac acceptance phrase'));
  const [download] = await Promise.all([
    web.waitForEvent('download'),
    web.getByLabel('导出会话', { exact: true }).click(),
  ]);
  const exportPath = join(root, 'export.json');
  await download.saveAs(exportPath);
  const exported = await readFile(exportPath, 'utf8');
  assert.ok(!exported.includes('mac acceptance phrase'));
  assert.equal(JSON.parse(exported).resumable, false);
  await submit(
    web,
    "Use the native bash tool exactly once to run: printf 'started\\n' >> crash-once.txt; sleep 8; printf 'completed\\n' >> crash-once.txt . Do not retry this command or modify any other file.",
  );
  const marker = join(root, 'crash-once.txt'),
    deadline = Date.now() + 180000;
  while (true) {
    try {
      if ((await readFile(marker, 'utf8')).includes('started')) break;
    } catch {}
    assert.ok(Date.now() < deadline, 'real native bash did not start');
    await new Promise((ok) => setTimeout(ok, 100));
  }
  assert.equal((await state(page)).busy, true);
  const hostPid = await desktop.evaluate(
    ({ app }) => app.getAppMetrics().find((p) => p.type === 'Utility' && p.name === 'Agent Host')?.pid,
  );
  assert.ok(hostPid);
  process.kill(hostPid, 'SIGKILL');
  const recoveryDeadline = Date.now() + 30000;
  let recoveredPid: number | undefined;
  do {
    await new Promise((ok) => setTimeout(ok, 300));
    recoveredPid = await desktop.evaluate(
      ({ app }) => app.getAppMetrics().find((p) => p.type === 'Utility' && p.name === 'Agent Host')?.pid,
    );
  } while ((!recoveredPid || recoveredPid === hostPid) && Date.now() < recoveryDeadline);
  assert.ok(recoveredPid && recoveredPid !== hostPid);
  for (const client of [page, web])
    await client.waitForFunction(() => document.querySelector('.sidebar-bottom')?.textContent?.includes('已连接'), {
      timeout: 30000,
    });
  const interrupted = await state(page);
  assert.equal(interrupted.busy, false);
  assert.equal(interrupted.interrupted, true);
  await new Promise((ok) => setTimeout(ok, 9000));
  const markerBefore = await readFile(marker, 'utf8');
  assert.equal(markerBefore.split('started').length - 1, 1);
  // A killed Host may terminate its child or leave it to finish. Neither outcome authorizes replay.
  assert.ok(markerBefore.split('completed').length - 1 <= 1);
  await browser.close();
  browser = undefined;
  await desktop.close();
  desktop = undefined;
  desktop = await launch();
  page = await ready(desktop);
  await openSession(page);
  const reopened = await state(page);
  assert.equal(reopened.id, interrupted.id);
  assert.equal(reopened.interrupted, true);
  assert.equal(reopened.messages.length, interrupted.messages.length);
  await submit(
    page,
    'Read crash-once.txt with the native read tool. Report what it contains. Do not run bash, retry the previous operation, or modify any file.',
  );
  await idle(() => state(page));
  assert.equal(await readFile(marker, 'utf8'), markerBefore);
  console.log(
    JSON.stringify({
      result: 'passed',
      packagedDesktop: true,
      webBrowser: 'Chrome',
      realModel: 'openai-codex/gpt-6-luna',
      nativeTools: true,
      windowCloseKeepsHost: true,
      sharedSessionMultiTurn: true,
      activeHostCrashRecovery: true,
      appReopen: true,
      noSideEffectReplay: true,
      protectedExport: true,
      rendererNode: false,
    }),
  );
} finally {
  await browser?.close();
  await desktop?.close();
  await rm(root, { recursive: true, force: true });
}
