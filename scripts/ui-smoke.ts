import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
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
  await page.locator('.shell').waitFor({ timeout: 30000 });
  return page;
}
async function state(page: Page): ReturnType<AgentService['viewSession']> {
  return page.evaluate(async () => {
    const headers = { Authorization: `Bearer ${sessionStorage.getItem('agent-connection-token')}` };
    const list = await (await fetch('/api/sessions', { headers })).json();
    return (await fetch(`/api/sessions/${list[0].id}`, { headers })).json();
  });
}
async function idle(page: Page) {
  const deadline = Date.now() + 180000;
  let current: Awaited<ReturnType<typeof state>>;
  do {
    await new Promise((ok) => setTimeout(ok, 400));
    current = await state(page);
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
  await page.getByLabel('任务', { exact: true }).fill(prompt);
  await page.getByRole('button', { name: '发送 ↑' }).click();
  await page.getByRole('button', { name: '停止', exact: true }).waitFor();
}
try {
  desktop = await launch();
  let page = await ready(desktop);
  const origin = new URL(page.url()).origin;
  assert.equal(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require), 'undefined');
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.getByLabel('模型提供方').selectOption('openai-codex');
  await page.getByRole('button', { name: '导入 Pi 授权' }).click();
  await page
    .locator('.start select option[value="openai-codex/gpt-6-luna"]')
    .waitFor({ state: 'attached', timeout: 30000 });
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.getByPlaceholder('工作目录的绝对路径').fill(root);
  await page.locator('.start select').selectOption('openai-codex/gpt-6-luna');
  await page.getByRole('button', { name: '创建会话 →' }).click();
  await submit(
    page,
    'Use the native write tool to create ui-acceptance.txt in the current directory with exactly UI real model success. Then read it with the native read tool. Do not use bash or modify any other file.',
  );
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible()), false);
  await idle(page);
  assert.equal((await readFile(join(root, 'ui-acceptance.txt'), 'utf8')).trim(), 'UI real model success');
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.show());
  await page.reload();
  await page.locator('.shell').waitFor();
  await page.locator('nav button').first().click();
  await page.getByLabel('任务', { exact: true }).waitFor();
  assert.ok((await page.locator('details').count()) >= 2);
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const web = await browser.newPage({ acceptDownloads: true });
  const token = await page.evaluate(() => sessionStorage.getItem('agent-connection-token'));
  await web.goto(`${origin}/#token=${encodeURIComponent(token!)}`);
  await web.locator('.shell').waitFor();
  await web.locator('nav button').first().click();
  await writeFile(join(root, 'ui-acceptance.txt'), 'UI real model success\npassword="mac acceptance phrase"\n');
  await submit(
    web,
    'Continue this session. Read ui-acceptance.txt with the native read tool and report its content. Do not modify files.',
  );
  await idle(page);
  await web.getByRole('button', { name: '发送 ↑' }).waitFor({ timeout: 180000 });
  assert.ok((await web.locator('.assistant').last().innerText()).includes('UI real model success'));
  assert.ok(!(await web.locator('main').innerText()).includes('mac acceptance phrase'));
  const download = web.waitForEvent('download');
  await web.getByRole('button', { name: '导出', exact: true }).click();
  const exportPath = join(root, 'export.json');
  await (await download).saveAs(exportPath);
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
    await client.waitForFunction(() => document.querySelector('.connection')?.textContent?.includes('已连接'), {
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
  await page.locator('nav button').first().click();
  await page.getByLabel('任务', { exact: true }).waitFor();
  const reopened = await state(page);
  assert.equal(reopened.id, interrupted.id);
  assert.equal(reopened.interrupted, true);
  assert.equal(reopened.messages.length, interrupted.messages.length);
  await submit(
    page,
    'Read crash-once.txt with the native read tool. Report what it contains. Do not run bash, retry the previous operation, or modify any file.',
  );
  await idle(page);
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
