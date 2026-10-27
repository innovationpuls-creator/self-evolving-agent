import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import type { ReflectionCatalog } from '../../../../apps/web/src/features/reflection/reflection-state';
import { connection, request, root, saveTranscript } from './client';

const scenario = JSON.parse(await readFile(join(root, '.runtime/scenario.json'), 'utf8')) as { source: string };
const catalog = await request<ReflectionCatalog>(`/reflections?view=summary&sessionId=${scenario.source}`);
const job = catalog.jobs[0];
assert.ok(job);
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  slowMo: 200,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: 'zh-CN',
  timezoneId: 'America/Los_Angeles',
  reducedMotion: 'reduce',
  deviceScaleFactor: 1,
  recordVideo: { dir: join(root, 'evidence/videos'), size: { width: 1440, height: 1000 } },
});
await context.addInitScript((token) => sessionStorage.setItem('agent-connection-token', token), connection.token);
const page = await context.newPage();
const steps: Array<{ action: string; elapsedMs: number }> = [];
const start = Date.now();
const pause = async (action: string) => {
  steps.push({ action, elapsedMs: Date.now() - start });
  await page.waitForTimeout(3000);
};
try {
  await page.goto(connection.origin);
  await page.locator(`.live-session-picker [data-focus="${scenario.source}"]`).click();
  await page.getByLabel('继续会话', { exact: true }).fill('返回后继续核对重试策略');
  await pause('进入真实来源会话并保留未发送草稿');
  await page.getByRole('button', { name: '反思记录', exact: true }).last().click();
  await page.locator(`[data-job="${job.id}"]`).waitFor();
  await pause('查看该会话的反思摘要列表');
  await page.locator(`[data-job="${job.id}"]`).click();
  await page.getByRole('button', { name: /任务来源 1/ }).waitFor();
  await pause('阅读反思详情及无新增变化的边界');
  await page.getByRole('button', { name: /任务来源 1/ }).click();
  await page.getByRole('button', { name: /^memory_revise/ }).click();
  await page.getByRole('button', { name: '查看本次修订', exact: true }).waitFor();
  await pause('打开来源任务实际执行的 memory_revise 结果');
  await page.getByRole('button', { name: '查看本次修订', exact: true }).click();
  await page.getByRole('heading', { name: '实际变化', exact: true }).waitFor();
  await page.getByText('项目请求的重试上限是 3 次。', { exact: true }).first().waitFor();
  await pause('查看修订 2 与修订 1 的实际正文差异');
  await page.getByRole('button', { name: '记忆来源 1', exact: true }).click();
  await page.locator('.diagnostics-evidence pre').waitFor();
  await pause('读取保存依据对应的真实来源 Entry');
  await page.getByRole('button', { name: '在来源会话中定位', exact: true }).click();
  await page.getByRole('heading', { name: '定位的原始条目', exact: true }).waitFor();
  assert.equal(await page.getByLabel('继续会话').inputValue(), '返回后继续核对重试策略');
  await pause('定位原始会话条目，未发送草稿保留');
  await writeFile(
    join(root, 'evidence/journey-recording.json'),
    JSON.stringify(
      { status: 'passed', origin: connection.origin, width: 1440, height: 1000, steps, syntheticResponses: false },
      null,
      2,
    ),
  );
} finally {
  const video = page.video();
  await context.close();
  if (video) {
    await video.saveAs(join(root, 'evidence/videos/real-host-journey-1440.webm'));
    await video.delete();
  }
  await browser.close();
  await saveTranscript('journey-recording-requests');
  execFileSync('python3', [join(root, 'scripts/redact.py')], { stdio: 'pipe' });
}
console.log('Real Host journey recording saved; 7 actual navigation steps.');
