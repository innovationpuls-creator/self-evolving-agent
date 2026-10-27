import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root = 'evidence/a-skills-20261023';
const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const p = await b.newPage({ viewport: { width: 390, height: 1000 } });
const checks = [],
  errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto('http://127.0.0.1:4186/?route=quiet&test=1');
async function click(name) {
  await p.getByRole('button', { name, exact: true }).click();
}
async function tab(name) {
  await p.getByRole('tablist', { name: '候选操作' }).getByRole('tab', { name, exact: true }).click();
}
async function nav(name) {
  if (!(await p.locator('.sidebar').isVisible())) await click('打开导航');
  await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name, exact: true }).click();
}
async function shot(n) {
  await p.evaluate(() => document.activeElement?.blur());
  await p.mouse.move(389, 999);
  await p.waitForTimeout(350);
  await p.screenshot({ path: `${root}/after/${n}-390.png` });
}
await nav('技能与工具');
await p.locator('.asm-item').filter({ hasText: '文档比较' }).click();
await click('编辑技能');
const editor = p.getByRole('textbox', { name: '编辑 SKILL.md', exact: true });
const original = await editor.inputValue();
await editor.fill(`${original}\n\n- 每项变化附上章节位置。`);
await click('保存候选');
await tab('审查与发布');
await click('审查内容与依赖');
await p.getByRole('checkbox', { name: '我已审查完整内容与依赖引用' }).check();
await click('记录本次内容审查');
await p.getByRole('dialog').waitFor({ state: 'hidden' });
await p.getByRole('checkbox', { name: '模拟依赖检查失败' }).check();
await click('检查并生效');
await p.getByText('候选检查失败', { exact: true }).waitFor();
assert(await p.getByText('当前正式 v1', { exact: true }).isVisible());
await shot('failed');
checks.push('failed-check-preserves-formal-and-candidate');
await tab('编辑');
await editor.fill(`${original}\n\n- 每项变化附上章节位置，附原文。`);
await click('保存候选');
await tab('审查与发布');
assert(!(await p.getByRole('button', { name: '检查并生效', exact: true }).isEnabled()));
checks.push('editing-invalidates-exact-trust');
await shot('trust-invalidated');
await click('返回技能列表');
await p.getByRole('textbox', { name: '搜索已添加的技能' }).fill('不存在');
assert(await p.getByText('没有匹配的内容。试试较短的关键词。', { exact: true }).isVisible());
await shot('no-results');
await p.getByRole('textbox', { name: '搜索已添加的技能' }).fill('');
await p.locator('.asm-item').filter({ hasText: '研究笔记' }).click();
await click('编辑技能');
await editor.fill('# research-notes\n保留当前编辑。');
await click('返回技能列表');
await p.locator('.asm-item').filter({ hasText: '文档比较' }).click();
await click('返回技能列表');
await p.locator('.asm-item').filter({ hasText: '研究笔记' }).click();
await click('编辑技能');
assert.equal(await editor.inputValue(), '# research-notes\n保留当前编辑。');
checks.push('draft-survives-skill-navigation');
await click('返回技能列表');
await p.getByRole('tablist', { name: '能力类型' }).getByRole('tab', { name: '工具', exact: true }).click();
await p.locator('.asm-item').filter({ hasText: '文档信息' }).click();
assert(await p.getByText('状态未确认', { exact: true }).isVisible());
await shot('unknown-tool');
checks.push('unknown-tool-does-not-claim-loaded');
await click('返回工具列表');
await p.locator('.asm-item').filter({ hasText: '执行命令' }).click();
assert((await p.getByText('需活动授权', { exact: true }).count()) >= 1);
await shot('shell-permission');
checks.push('loaded-shell-does-not-imply-execution-permission');
await click('返回工具列表');
await p.getByRole('tablist', { name: '能力类型' }).getByRole('tab', { name: '技能', exact: true }).click();
await click('导入技能');
await p.getByRole('textbox', { name: '候选名称' }).fill('coverage-check');
await click('保存候选');
await p.getByRole('dialog').waitFor({ state: 'hidden' });
assert(await p.getByText('尚无正式版本', { exact: true }).isVisible());
assert(!(await p.getByRole('switch', { name: '启用当前技能' }).isEnabled()));
await shot('import');
checks.push('import-does-not-enable-or-trust');
await click('切换演示场景');
await p.getByRole('menuitem', { name: '连接中断', exact: true }).click();
await tab('审查与发布');
assert(!(await p.getByRole('button', { name: '检查并生效', exact: true }).isEnabled()));
await shot('offline');
checks.push('offline-blocks-check-preserves-candidate');
await click('切换演示场景');
await p.getByRole('menuitem', { name: '读取失败', exact: true }).click();
await shot('read-error');
await click('重新读取');
checks.push('read-error-retry');
await fs.writeFile(`${root}/states.json`, JSON.stringify({ checks, errors }, null, 2));
await b.close();
assert.equal(errors.length, 0);
console.log(checks);
