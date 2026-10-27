import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root = 'evidence/a-titles-20261023';
const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const results = [];
for (const width of [1440, 850, 390]) {
  const p = await b.newPage({ viewport: { width, height: 1000 } });
  p.setDefaultTimeout(6000);
  const click = (name) => p.getByRole('button', { name, exact: true }).click();
  async function nav(name) {
    if (!(await p.locator('.sidebar').isVisible())) await click('打开导航');
    await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name, exact: true }).click();
  }
  await p.goto('http://127.0.0.1:4186/?route=quiet');
  await nav('记忆');
  await p.getByPlaceholder('搜索记忆内容').fill('测试');
  assert.equal(await p.locator('.aw-memory-row').count(), 1);
  await p.getByPlaceholder('搜索记忆内容').fill('不存在的检索项');
  assert(await p.getByText('没有匹配的记忆', { exact: true }).isVisible());
  await click('清除搜索');
  await click('添加记忆');
  await p.getByLabel('记忆标题', { exact: true }).fill('每周整理研究笔记');
  await p.getByLabel('记忆内容', { exact: true }).fill('整理笔记时保留出处和仍需核实的问题。');
  await click('保存记忆');
  await p.getByRole('heading', { name: '每周整理研究笔记', exact: true }).waitFor();
  await click('管理这条记忆');
  await p.getByRole('menuitem', { name: '调整适用范围', exact: true }).click();
  await p.getByRole('dialog').getByLabel('适用范围', { exact: true }).selectOption('global');
  await click('保存范围');
  await click('修订历史 · 2');
  await p.getByLabel('查看修订', { exact: true }).selectOption('1');
  assert(
    await p
      .locator('.aw-document-heading')
      .innerText()
      .then((t) => t.includes('仅当前项目')),
  );
  await click('查看修订来源');
  await p.keyboard.press('Escape');
  assert.equal(await p.getByRole('dialog').count(), 0);
  await click('最新修订');
  await click('管理这条记忆');
  await p.getByRole('menuitem', { name: '移除记忆', exact: true }).click();
  await p.getByRole('dialog').getByRole('button', { name: '移除记忆', exact: true }).click();
  assert.equal(await p.locator('.aw-memory-row').filter({ hasText: '每周整理研究笔记' }).count(), 0);
  const hide = await p.addStyleTag({ content: '.aw-footnote,.aw-small,.field-hint{display:none !important}' });
  for (const [page, row, title, name] of [
    ['记忆', '.aw-memory-row', '差异报告应单列未核实内容', 'memory'],
    ['反思记录', '.aw-journal-row', '核对发布测试范围', 'reflection'],
    ['改进建议', '.aw-proposal-row', '为发布报告附上实际运行的测试范围', 'evolution'],
  ]) {
    await nav(page);
    await p.locator(row).filter({ hasText: title }).click();
    await p.locator('.aw:visible h1').waitFor();
    await p.evaluate(() => document.activeElement?.blur());
    await p.mouse.move(width - 1, 999);
    await p.waitForTimeout(120);
    await p.screenshot({ path: `${root}/after/headings-only-${name}-${width}.png` });
  }
  await hide.evaluate((e) => e.remove());
  await click('讨论这项建议');
  await p.getByRole('heading', { name: '为发布报告附上实际运行的测试范围', exact: true }).waitFor();
  await click('审阅开发授权');
  assert(!(await p.getByRole('button', { name: '授权并开始开发', exact: true }).isEnabled()));
  await click('返回讨论');
  await p.locator('.aw:visible .aw-return').click();
  await p.getByRole('tab', { name: '处理历史', exact: true }).click();
  assert(
    await p
      .locator('.aw-proposal-row')
      .filter({ hasText: '为发布报告附上实际运行的测试范围' })
      .innerText()
      .then((t) => t.includes('已进入讨论')),
  );
  await p.goto('http://127.0.0.1:4186/?route=studio');
  const studio = [];
  await p
    .getByRole('navigation', { name: '工作空间', exact: true })
    .getByRole('button', { name: '认识', exact: true })
    .click();
  assert(await p.locator('h1:visible').count());
  studio.push('记忆');
  await nav('反思');
  assert(await p.locator('h1:visible').count());
  studio.push('反思');
  await p
    .getByRole('navigation', { name: '工作空间', exact: true })
    .getByRole('button', { name: '能力', exact: true })
    .click();
  assert(await p.locator('h1:visible').count());
  studio.push('能力库');
  await nav('能力改进');
  assert(await p.locator('h1:visible').count());
  studio.push('能力改进');
  await p
    .getByRole('navigation', { name: '工作空间', exact: true })
    .getByRole('button', { name: '工作', exact: true })
    .click();
  await nav('执行记录');
  assert(await p.locator('h1:visible').count());
  studio.push('执行记录');
  results.push({
    width,
    search: true,
    createScopeHistoryDelete: true,
    escape: true,
    adoptWithoutGrant: true,
    studioPages: studio,
  });
  await p.close();
}
await b.close();
await fs.writeFile(`${root}/extra.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
