import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root = 'evidence/a-workspace-20261024',
  checks = [];
const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
for (const width of [1440, 850, 390]) {
  const p = await b.newPage({ viewport: { width, height: 1000 } });
  p.setDefaultTimeout(6000);
  const click = (name) => p.getByRole('button', { name, exact: true }).click();
  async function nav(name) {
    if (!(await p.locator('.sidebar').isVisible())) await click('打开导航');
    await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name, exact: true }).click();
  }
  async function shot(name) {
    await p.evaluate(() => document.activeElement?.blur());
    await p.mouse.move(width - 1, 999);
    await p.waitForTimeout(150);
    await p.screenshot({ path: `${root}/after/${name}-${width}.png` });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  async function manage(name) {
    await click('管理这条记忆');
    await p.getByRole('menuitem', { name, exact: true }).click();
  }
  const row = (title) => p.locator('.aw-memory-row').filter({ hasText: title });
  await p.goto('http://127.0.0.1:4186/?route=quiet&test=1');
  await nav('记忆');
  await row('新版使用设备授权登录').click();
  await manage('调整适用范围');
  await p.getByLabel('适用范围', { exact: true }).selectOption('global');
  assert.equal(await p.getByRole('button', { name: '保存范围', exact: true }).isEnabled(), false);
  await p.getByLabel('操作依据', { exact: true }).fill('作为跨项目认证参考保留，适用版本仍见正文');
  await shot('memory-scope');
  await click('保存范围');
  await click('所有记忆');
  await p.getByLabel('浏览范围', { exact: true }).selectOption('/Users/person/Projects/research');
  await row('新版使用设备授权登录').click();
  await click('修订历史 · 1');
  assert.equal(await p.getByLabel('查看修订', { exact: true }).locator('option').count(), 1);
  await click('最新修订');
  await manage('调整适用范围');
  await p.getByLabel('适用范围', { exact: true }).selectOption('project');
  await p.getByLabel('操作依据', { exact: true }).fill('仅在研究项目的认证案例中保留');
  await click('保存范围');
  await click('所有记忆');
  await p.getByLabel('浏览范围', { exact: true }).selectOption('/Users/person/Projects/agent');
  assert.equal(await row('新版使用设备授权登录').count(), 0);
  await click('切换演示场景');
  await p.getByRole('menuitem', { name: '下次编辑发生冲突', exact: true }).click();
  await row('发布检查需区分已运行与未运行的测试').click();
  await click('编辑记忆');
  await p.getByLabel('记忆标题', { exact: true }).fill('发布报告保留检查覆盖范围');
  assert.equal(await p.getByRole('button', { name: '保存新修订', exact: true }).isEnabled(), false);
  await shot('memory-conflict');
  await click('已核对，继续编辑');
  await p.getByLabel('修改依据', { exact: true }).fill('与较新修订核对后保留覆盖范围');
  await nav('反思记录');
  await nav('记忆');
  assert.equal(await p.getByLabel('记忆标题', { exact: true }).inputValue(), '发布报告保留检查覆盖范围');
  await click('保存新修订');
  await p.getByRole('heading', { name: '发布报告保留检查覆盖范围', exact: true }).waitFor();
  await nav('改进建议');
  await p.locator('.aw-proposal-row').filter({ hasText: '为发布报告附上实际运行的测试范围' }).click();
  await click('归档');
  await click('归档建议');
  assert.match(await p.locator('.aw:visible').innerText(), /已归档/);
  await shot('suggestion-archive-action');
  checks.push({ width, scopeHistoryIsolation: true, conflictDraft: true, draftAcrossModules: true, archive: true });
  await p.close();
}
await b.close();
await fs.writeFile(`${root}/memory-edges.json`, JSON.stringify(checks, null, 2));
console.log(JSON.stringify(checks));
