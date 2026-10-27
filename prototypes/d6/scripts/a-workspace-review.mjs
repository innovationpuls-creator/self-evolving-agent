import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root = 'evidence/a-workspace-20261023';
await fs.mkdir(`${root}/video`, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const errors = [],
  results = [];
for (const width of [1440, 850, 390]) {
  const c = await browser.newContext({
    viewport: { width, height: 1000 },
    recordVideo: { dir: `${root}/video`, size: { width, height: 1000 } },
  });
  const p = await c.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto('http://127.0.0.1:4186/?route=quiet');
  const checks = [];
  async function nav(label) {
    if (!(await p.locator('.sidebar').isVisible()))
      await p.getByRole('button', { name: '打开导航', exact: true }).click();
    await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name: label, exact: true }).click();
  }
  async function shot(name) {
    await p.evaluate(() => document.activeElement?.blur());
    await p.mouse.move(width - 1, 999);
    await p.waitForTimeout(850);
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name);
    await p.screenshot({ path: `${root}/after/${name}-${width}.png`, animations: 'disabled' });
  }
  async function click(name) {
    await p.getByRole('button', { name, exact: true }).click();
  }
  await nav('改进建议');
  assert(await p.getByRole('heading', { name: '目前没有需要你决定的建议' }).isVisible());
  checks.push('first-entry-no-false-pending');
  await shot('evolution');
  await p.locator('.aw:visible .aw-proposal-row').first().click();
  assert(await p.getByRole('heading', { name: '现有规则已经覆盖，无需修改技能' }).isVisible());
  await shot('proposal-history');
  await p.locator('.aw:visible .aw-related').filter({ hasText: '文档比较' }).click();
  assert(await p.getByRole('heading', { name: '文档比较', exact: true }).isVisible());
  checks.push('proposal-to-current-skill');
  await shot('skill-detail');
  await click('所有技能与工具');
  await shot('skills');
  await p.getByRole('tab', { name: '执行工具', exact: true }).click();
  await p.locator('.aw:visible .aw-tool-rows button').filter({ hasText: '比较文本' }).click();
  await shot('tools');
  await p.getByRole('button', { name: '查看文档比较技能', exact: true }).click();
  await p.getByRole('switch', { name: '启用当前技能' }).uncheck();
  assert(await p.getByText('Agent 目前不会使用这项技能', { exact: true }).isVisible());
  await click('所有技能与工具');
  await p.getByRole('tab', { name: '执行工具', exact: true }).click();
  await p.locator('.aw:visible .aw-tool-rows button').filter({ hasText: '比较文本' }).click();
  assert(await p.getByText('所属技能未启用或未获信任', { exact: true }).isVisible());
  await click('查看文档比较技能');
  await p.getByRole('switch', { name: '启用当前技能' }).check();
  checks.push('disable-removes-tool-availability');
  await nav('记忆');
  await shot('memory');
  await p.locator('.aw:visible .aw-memory-row').filter({ hasText: '差异报告应单列未核实内容' }).click();
  await shot('memory-detail');
  await click('编辑');
  await p.getByRole('textbox', { name: '记住什么' }).fill('汇总差异，并单列未核实的内容；结论保留来源。');
  await p.getByRole('textbox', { name: '修改依据' }).fill('补充结论来源的阅读要求');
  await shot('memory-edit');
  await click('保存新修订');
  await p.getByRole('button', { name: '修订历史 · 3', exact: true }).click();
  assert(await p.getByText('补充结论来源的阅读要求 · 用户', { exact: true }).isVisible());
  await shot('memory-history');
  await p.getByRole('combobox', { name: '查看修订' }).selectOption('0');
  assert(await p.getByText('默认以表格汇总文档差异。', { exact: true }).isVisible());
  checks.push('memory-edit-new-revision-old-preserved');
  await click('查看来源');
  await shot('memory-source');
  await p.keyboard.press('Escape');
  await click('所有记忆');
  await p.getByRole('tab', { name: '已撤销', exact: true }).click();
  await p.locator('.aw:visible .aw-memory-row').click();
  assert(await p.getByText('这项决定已撤销', { exact: true }).isVisible());
  checks.push('revoked-visible-no-revival');
  await click('所有记忆');
  await p.getByRole('tab', { name: '使用中', exact: true }).click();
  await p.getByRole('textbox', { name: '搜索记忆内容' }).fill('不存在的关键词');
  assert(await p.getByText('没有匹配的内容。试试较短的关键词。', { exact: true }).isVisible());
  await shot('memory-no-results');
  await p.getByRole('textbox', { name: '搜索记忆内容' }).fill('');
  await click('添加记忆');
  await p.getByRole('textbox', { name: '标题', exact: true }).fill('发布说明的格式');
  await p.getByRole('textbox', { name: '记住什么' }).fill('先写用户可见变化，再列兼容限制。');
  await click('保存记忆');
  assert(await p.getByRole('heading', { name: '发布说明的格式', exact: true }).isVisible());
  await click('管理这条记忆');
  await p.getByRole('menuitem', { name: '调整适用范围' }).click();
  await p.getByRole('combobox', { name: '在哪里使用' }).selectOption('全局');
  await click('保存范围');
  assert(await p.locator('.aw:visible .aw-document-heading').getByText('所有项目 · 事实', { exact: true }).isVisible());
  await click('管理这条记忆');
  await p.getByRole('menuitem', { name: '移除记忆' }).click();
  await click('保留记忆');
  assert(await p.getByRole('heading', { name: '发布说明的格式', exact: true }).isVisible());
  await click('管理这条记忆');
  await p.getByRole('menuitem', { name: '移除记忆' }).click();
  await click('确认移除');
  assert.equal(await p.locator('.aw:visible .aw-memory-row').filter({ hasText: '发布说明的格式' }).count(), 0);
  checks.push('add-scope-delete-confirmation');
  await nav('反思记录');
  await shot('reflection');
  await p.locator('.aw:visible .aw-journal-row').first().click();
  await shot('reflection-detail');
  await p.getByRole('button', { name: '改进建议 · 历史记录 查看未采纳的建议', exact: true }).click();
  assert(await p.getByRole('heading', { name: '现有规则已经覆盖，无需修改技能', exact: true }).isVisible());
  await click('返回上一个位置');
  checks.push('reflection-deep-link-to-exact-suggestion');

  await p.locator('.aw:visible .aw-related').filter({ hasText: '旧客户端是否仍可登录' }).click();
  assert(await p.getByText('还没有足够依据。这条内容是待核实的问题，不能当作事实使用。', { exact: true }).isVisible());
  await click('返回上一个位置');
  assert(await p.getByRole('heading', { name: '正文差异已确认，兼容范围尚未确认' }).isVisible());
  checks.push('reflection-memory-return');
  await click('查看依据');
  await shot('reflection-source');
  await p.keyboard.press('Escape');
  await click('所有反思记录');
  await p.getByRole('tab', { name: '未能检查', exact: true }).click();
  await p.locator('.aw:visible .aw-journal-row').click();
  assert(await p.getByText('不会退回普通环境运行', { exact: true }).isVisible());
  await shot('reflection-unavailable');
  await click('查看恢复条件');
  assert(await p.getByRole('dialog').isVisible());
  await p.keyboard.press('Escape');
  checks.push('reflection-unavailable-fail-closed');
  await nav('改进建议');
  if (await p.getByRole('button', { name: '有其他需要？发起讨论', exact: true }).isVisible())
    await click('有其他需要？发起讨论');
  else await click('发起讨论');
  assert.equal(await p.getByRole('textbox', { name: '讨论内容' }).inputValue(), '');
  await shot('discussion');
  await p.getByRole('textbox', { name: '讨论内容' }).fill('我想让比较报告更容易核对来源。');
  await click('发送讨论内容');
  await click('审阅开发授权');
  const dlg = p.getByRole('dialog');
  assert(await dlg.getByRole('button', { name: '批准目标并开始开发' }).isDisabled());
  await dlg.getByRole('textbox', { name: '授权目标' }).fill('核对现有比较报告的来源规则，没有缺口则保留原版本。');
  await shot('permission');
  assert(await dlg.getByText('使用本机用户权限', { exact: true }).isVisible());
  await dlg.getByRole('button', { name: '批准目标并开始开发' }).click();
  await p.waitForTimeout(3900);
  assert(await p.getByText('未产生新版本', { exact: true }).isVisible());
  await shot('nochange');
  checks.push('discussion-grant-nochange');
  await p.locator('.aw:visible').getByRole('button', { name: '改进建议', exact: true }).click();
  assert(await p.getByRole('tab', { name: '历史记录', exact: true }).isVisible());
  await p.locator('.aw:visible .aw-proposal-row').last().click();
  assert(await p.getByText('未产生新版本', { exact: true }).isVisible());
  checks.push('activity-history-return');
  await nav('技能与工具');
  await click('所有技能与工具');
  await p.getByRole('tab', { name: '技能', exact: true }).click();
  await click('导入技能');
  await shot('import');
  await p.keyboard.press('Escape');
  const video = p.video();
  await c.close();
  await video.saveAs(`${root}/video/workspace-${width}.webm`);
  results.push({ width, checks });
}
await browser.close();
assert.deepEqual(errors, []);
await fs.writeFile(`${root}/regression.json`, JSON.stringify({ results, errors }, null, 2));
console.log(JSON.stringify(results));
