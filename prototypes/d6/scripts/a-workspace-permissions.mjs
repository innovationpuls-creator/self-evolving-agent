import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = 'evidence/a-workspace-20261023';
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  slowMo: 140,
});
const checks = [],
  errors = [];
async function setup(width = 1440) {
  const c = await browser.newContext({
    viewport: { width, height: 1000 },
    recordVideo: { dir: `${root}/video`, size: { width, height: 1000 } },
  });
  const p = await c.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto('http://127.0.0.1:4186/?route=quiet&test=1');
  return { c, p };
}
async function click(p, name) {
  await p.getByRole('button', { name, exact: true }).click();
}
async function nav(p, label) {
  if (!(await p.locator('.sidebar').isVisible())) await click(p, '打开导航');
  await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name: label, exact: true }).click();
}
async function shot(p, name) {
  await p.evaluate(() => document.activeElement?.blur());
  await p.mouse.move(1439, 999);
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${root}/after/${name}.png`, animations: 'disabled' });
}
async function end(c, p, name) {
  await p.waitForTimeout(1000);
  const v = p.video();
  await c.close();
  await v.saveAs(`${root}/video/${name}.webm`);
  await v.delete();
}
for (const outcome of ['success', 'failure', 'cancel']) {
  const { c, p } = await setup();
  await click(p, '开发演示结果');
  await p.getByRole('menuitem', { name: outcome === 'failure' ? '检查失败' : '检查通过', exact: true }).click();
  await nav(p, '改进建议');
  await click(p, '发起讨论');
  await click(p, '审阅开发授权');
  const dlg = p.getByRole('dialog');
  await dlg.getByRole('textbox', { name: '授权目标' }).fill('比较报告中为结论保留原文件章节位置，不增加执行工具。');
  await dlg.getByRole('checkbox').uncheck();
  assert(await dlg.getByRole('button', { name: '批准目标并开始开发' }).isDisabled());
  await dlg.getByRole('textbox', { name: '允许新建的技能', exact: true }).fill('text-diff');
  assert(await dlg.getByRole('button', { name: '批准目标并开始开发' }).isDisabled());
  await dlg.getByRole('textbox', { name: '允许新建的技能', exact: true }).fill('');
  await dlg.getByRole('checkbox').check();
  await dlg.getByRole('button', { name: '批准目标并开始开发' }).click();
  if (outcome === 'cancel') {
    await p.locator('.aw:visible').getByRole('button', { name: '改进建议 · 活动仍在运行', exact: true }).click();
    assert(await p.getByRole('button', { name: '查看当前活动', exact: true }).isVisible());
    await click(p, '查看当前活动');
    await click(p, '取消开发');
    checks.push('running-activity-return-preserves-activity');
  }
  await p.waitForTimeout(3800);
  await shot(p, `development-${outcome}`);
  if (outcome === 'success') {
    assert(await p.getByRole('heading', { name: '改进已生效', exact: true }).isVisible());
    await click(p, '查看技能与版本');
    await p.getByRole('tab', { name: '版本', exact: true }).click();
    await p.getByRole('button', { name: '恢复此版本', exact: true }).click();
    assert(await p.getByRole('dialog').getByText('只恢复能力内容', { exact: true }).isVisible());
    await p.getByRole('button', { name: '确认恢复 v1', exact: true }).click();
    assert(await p.getByText('text-diff · v1', { exact: true }).isVisible());
    checks.push('success-and-rollback');
  } else
    assert(
      await p
        .getByRole('heading', { name: outcome === 'failure' ? '候选未通过检查' : '开发已取消', exact: true })
        .isVisible(),
    );
  checks.push(`development-${outcome}-preserves-boundaries`);
  await end(c, p, `development-${outcome}`);
}
{
  const { c, p } = await setup(390);
  await nav(p, '技能与工具');
  await p.locator('.aw:visible .aw-skill-tile').first().click();
  await p.getByRole('tab', { name: '文件与候选', exact: true }).click();
  await p.getByRole('button', { name: 'SKILL.md', exact: true }).click();
  await p
    .getByRole('textbox', { name: '编辑 SKILL.md', exact: true })
    .fill('# text-diff\n比较两份文本，为每项结论保留章节位置。');
  await click(p, '保存为候选');
  assert(await p.getByRole('button', { name: '审查精确内容', exact: true }).isVisible());
  await click(p, '审查精确内容');
  assert(await p.getByRole('button', { name: '记录本次内容审查', exact: true }).isDisabled());
  await shot(p, 'candidate-trust-390');
  await p.getByRole('checkbox').check();
  await click(p, '记录本次内容审查');
  assert(await p.getByRole('button', { name: '检查并生效', exact: true }).isVisible());
  // Exact-content trust must become invalid when the file changes again.
  await p.getByRole('button', { name: 'SKILL.md', exact: true }).click();
  await p
    .getByRole('textbox', { name: '编辑 SKILL.md', exact: true })
    .fill('# text-diff\n再次调整，保留章节与文件路径。');
  await click(p, '保存为候选');
  assert(await p.getByRole('button', { name: '审查精确内容', exact: true }).isVisible());
  checks.push('exact-content-trust-invalidated-on-edit');
  await click(p, '审查精确内容');
  await p.getByRole('checkbox').check();
  await click(p, '记录本次内容审查');
  await p.getByRole('checkbox', { name: '模拟依赖检查失败', exact: true }).check();
  await click(p, '检查并生效');
  await p.waitForTimeout(1800);
  assert(await p.getByText('候选检查失败', { exact: true }).isVisible());
  await shot(p, 'candidate-failure-390');
  assert(await p.getByText('text-diff · v1', { exact: true }).isVisible());
  await p.getByRole('checkbox', { name: '模拟依赖检查失败', exact: true }).uncheck();
  await click(p, '检查并生效');
  await p.waitForTimeout(1800);
  assert(await p.getByText('text-diff · v2', { exact: true }).isVisible());
  checks.push('candidate-failure-retry');
  await end(c, p, 'candidate-trust');
}
{
  const { c, p } = await setup(390);
  await nav(p, '记忆');
  await click(p, '切换演示场景');
  await p.getByRole('menuitem', { name: '下次编辑发生冲突', exact: true }).click();
  await p.locator('.aw:visible .aw-memory-row').filter({ hasText: '差异报告应单列未核实内容' }).click();
  await click(p, '编辑');
  const content = await p.getByRole('textbox', { name: '记住什么' }).inputValue();
  await p.getByRole('textbox', { name: '修改依据' }).fill('新的材料依据');
  assert(await p.getByRole('button', { name: '保存新修订', exact: true }).isDisabled());
  await shot(p, 'memory-conflict-390');
  assert.equal(await p.getByRole('textbox', { name: '记住什么' }).inputValue(), content);
  await click(p, '已核对，以草稿保存新修订');
  await click(p, '保存新修订');
  checks.push('memory-conflict-preserves-draft');
  await end(c, p, 'memory-conflict');
}
await browser.close();
assert.deepEqual(errors, []);
await fs.writeFile(`${root}/permissions.json`, JSON.stringify({ checks, errors }, null, 2));
console.log(checks);
