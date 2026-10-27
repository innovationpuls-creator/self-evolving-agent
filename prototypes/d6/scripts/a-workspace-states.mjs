import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = 'evidence/a-workspace-20261023';
const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const p = await b.newPage({ viewport: { width: 390, height: 1000 } });
await p.goto('http://127.0.0.1:4186/?route=quiet&test=1');
const checks = [];
async function click(name) {
  await p.getByRole('button', { name, exact: true }).click();
}
async function nav(name) {
  if (!(await p.locator('.sidebar').isVisible())) await click('打开导航');
  await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name, exact: true }).click();
}
async function scenario(name) {
  await click('切换演示场景');
  await p.getByRole('menuitem', { name, exact: true }).click();
}
async function shot(name) {
  await p.evaluate(() => document.activeElement?.blur());
  await p.mouse.move(389, 999);
  await p.waitForTimeout(650);
  await p.screenshot({ path: `${root}/after/${name}-390.png`, animations: 'disabled' });
}
await nav('记忆');
await scenario('读取失败');
await shot('read-error');
await click('重新读取');
assert(await p.getByRole('heading', { name: '记忆', exact: true }).isVisible());
checks.push('read-error-retry');
await scenario('空内容');
await shot('empty-memory');
await click('添加记忆');
assert(await p.getByRole('textbox', { name: '标题', exact: true }).isVisible());
await click('取消');
checks.push('empty-add-and-return');
await nav('技能与工具');
await p.locator('.aw:visible .aw-skill-tile').filter({ hasText: '研究笔记' }).click();
await click('讨论能力改进');
assert(await p.getByRole('heading', { name: '一起讨论改进', exact: true }).isVisible());
assert(await p.locator('.aw-discussion-context').getByText('research-notes · v1', { exact: true }).isVisible());
await shot('selected-skill-discussion');
await click('审阅开发授权');
const dlg = p.getByRole('dialog');
assert(await dlg.getByText('研究笔记 / research-notes', { exact: true }).isVisible());
await p.keyboard.press('Tab');
assert(await p.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')));
await p.keyboard.press('Escape');
await p.waitForFunction(() => document.activeElement?.textContent?.trim() === '审阅开发授权', null, { timeout: 2000 });
checks.push('skill-discussion-uses-selected-skill-and-focus-restores');
await p.getByRole('textbox', { name: '讨论内容' }).fill('保留尚未发送的改进讨论。');
await scenario('连接中断');
assert(await p.getByRole('button', { name: '发送讨论内容', exact: true }).isDisabled());
await shot('offline-discussion');
await click('重新连接');
assert.equal(await p.getByRole('textbox', { name: '讨论内容' }).inputValue(), '保留尚未发送的改进讨论。');
checks.push('offline-preserves-draft-disables-send');
await nav('记忆');
await click('添加记忆');
await p.getByRole('textbox', { name: '标题', exact: true }).fill('仅供删除测试的记忆');
await p.getByRole('textbox', { name: '记住什么', exact: true }).fill('移除之后不应出现在搜索。');
await click('保存记忆');
await click('管理这条记忆');
await p.getByRole('menuitem', { name: '移除记忆', exact: true }).click();
await click('确认移除');
await p.keyboard.press('Meta+k');
await p.getByRole('textbox', { name: '搜索会话、记忆或技能' }).fill('仅供删除测试的记忆');
assert.equal(await p.locator('.search-results button').count(), 0);
await p.keyboard.press('Escape');
checks.push('removed-memory-excluded-from-global-search');
await b.close();
await fs.writeFile(`${root}/states.json`, JSON.stringify({ checks }, null, 2));
console.log(checks);
