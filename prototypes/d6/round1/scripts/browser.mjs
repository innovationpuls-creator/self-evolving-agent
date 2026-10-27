import { chromium } from 'playwright-core';
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const out = new URL('../evidence/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const checks = [];
const errors = [];
const forbidden = [];
try {
  for (const mode of ['quiet', 'studio']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => {
      if (!r.url().startsWith('http://127.0.0.1:4176') && !r.url().startsWith('ws://127.0.0.1:4176'))
        forbidden.push(r.url());
    });
    await page.goto(`http://127.0.0.1:4176/?route=${mode}`);
    await page.getByText('项目说明有哪些变化？', { exact: true }).waitFor();
    await page.screenshot({ path: new URL(`${mode}-result.png`, out).pathname, fullPage: true });
    await page.getByRole('button', { name: '浏览结构化结果' }).click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('button', { name: '查看完整脱敏原文' }).click();
    await page.getByRole('button', { name: '后一段', exact: true }).click();
    await page.getByRole('button', { name: '关闭详情' }).click();
    checks.push(`${mode}: structured data and evidence pagination`);
    await page.getByRole('button', { name: '查看保存的认识' }).click();
    await page.getByRole('button', { name: '修正这条认识' }).click();
    await page.getByLabel('记忆正文').fill('先列出变更，再单列未核实事项。');
    await page.getByLabel('修正理由').fill('让报告覆盖范围更清楚');
    await page.getByRole('button', { name: '核对并保存新修订' }).click();
    await page.getByText('修订 3', { exact: true }).waitFor();
    await page.screenshot({ path: new URL(`${mode}-memory.png`, out).pathname, fullPage: true });
    checks.push(`${mode}: memory creates immutable revision`);
    await page.getByRole('button', { name: '能力建议与开发', exact: true }).click();
    await page.getByRole('button', { name: '采纳并建立讨论' }).click();
    await page.getByLabel('讨论消息').fill('请保留原始输出，只完善报告说明。');
    await page.getByRole('button', { name: '发送讨论消息' }).click();
    await page.getByRole('button', { name: '确认目标与开发范围' }).click();
    await page.screenshot({ path: new URL(`${mode}-grant.png`, out).pathname, fullPage: true });
    await page.getByRole('button', { name: '批准此目标并开始开发' }).click();
    await page.getByText('当前正式版本 v2。历史活动保留，未完成请求不会自动重放。').waitFor();
    await page.getByRole('button', { name: '查看能力与版本 →' }).click();
    await page.getByRole('button', { name: '恢复此版本' }).click();
    await page.getByText('当前能力已切换至 v1。已有记录与 Memory 保留。').waitFor();
    await page.getByRole('button', { name: '关闭详情' }).click();
    await page.getByText('v2 · 授权开发成果').waitFor();
    checks.push(`${mode}: explicit grant, automatic application, rollback preserves version history`);
    await page.getByRole('button', { name: '＋ 开始新会话' }).click();
    await page.getByLabel('任务', { exact: true }).fill('比较新说明');
    await page.getByRole('button', { name: '发送 ↑' }).click();
    await page.getByRole('button', { name: '停止', exact: true }).click();
    await page.waitForTimeout(1600);
    assert.equal(await page.getByText('项目说明有哪些变化？', { exact: true }).count(), 0);
    checks.push(`${mode}: stopped task does not complete later`);
    await page.locator('aside button').filter({ hasText: '比较项目说明' }).first().click();
    for (const [width, height] of [
      [1240, 850],
      [850, 600],
      [768, 900],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: new URL(`${mode}-${width}.png`, out).pathname, fullPage: true });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    checks.push(`${mode}: five viewport layouts without document overflow`);
    await page.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
} finally {
  await browser.close();
  await writeFile(
    new URL('browser.json', out),
    JSON.stringify(
      {
        time: new Date().toISOString(),
        checks,
        errors,
        forbidden,
        scope: 'Standalone simulated browser workflows; no real Host or native Desktop acceptance',
      },
      null,
      2,
    ),
  );
}
