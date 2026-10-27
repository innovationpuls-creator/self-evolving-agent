import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root = 'evidence/a-product-20261023';
const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const checks = [];
for (const outcome of ['success', 'failure', 'cancel']) {
  const c = await b.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: { dir: `${root}/video`, size: { width: 1440, height: 1000 } },
  });
  const p = await c.newPage();
  await p.goto('http://127.0.0.1:4186/?route=quiet&test=1');
  if (outcome !== 'cancel') {
    await p.getByRole('button', { name: '开发演示结果', exact: true }).click();
    await p.getByRole('menuitem', { name: outcome === 'success' ? '检查通过' : '检查失败', exact: true }).click();
  }
  await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name: '改进建议', exact: true }).click();
  await p.getByRole('button', { name: '继续讨论', exact: true }).click();
  await p.getByRole('button', { name: '审阅开发授权', exact: true }).click();
  const d = p.getByRole('dialog');
  await d.getByRole('textbox', { name: '授权目标' }).fill('审查报告指引，在确有缺口时修订；检查失败保留旧版。');
  await d.getByRole('button', { name: '批准这个目标与范围', exact: true }).click();
  if (outcome === 'cancel') await p.getByRole('button', { name: '取消开发', exact: true }).click();
  await p.waitForTimeout(3800);
  assert(
    await p
      .getByText({ success: '能力变更已正式生效', failure: '检查失败，旧版保留', cancel: '开发已取消' }[outcome], {
        exact: true,
      })
      .isVisible(),
  );
  await p.screenshot({ path: `${root}/after/development-${outcome}.png`, animations: 'disabled' });
  await p.getByRole('button', { name: '查看能力与版本', exact: true }).click();
  await p.getByRole('tab', { name: '版本与信任', exact: true }).click();
  assert.equal(
    await p
      .locator('.version-list strong')
      .filter({ hasText: /^v2(?:\s|$)/ })
      .count(),
    outcome === 'success' ? 1 : 0,
  );
  if (outcome === 'success') {
    await p.getByRole('button', { name: '恢复此版本', exact: true }).click();
    await p.getByRole('dialog').getByRole('button', { name: '确认恢复 v1', exact: true }).click();
    assert(
      await p
        .locator('.version-list strong')
        .filter({ hasText: /^v1.*当前版本/ })
        .isVisible(),
    );
    checks.push('rollback-to-v1');
  }
  const v = p.video();
  await c.close();
  await v.saveAs(`${root}/video/development-${outcome}.webm`);
  checks.push(outcome);
}
const c = await b.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: { dir: `${root}/video`, size: { width: 1440, height: 1000 } },
});
const p = await c.newPage();
await p.goto('http://127.0.0.1:4186/?route=quiet');
await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name: '技能与工具', exact: true }).click();
await p.getByRole('button', { name: '编辑说明', exact: true }).click();
const d = p.getByRole('dialog');
const t = d.locator('textarea');
await t.fill(`${await t.inputValue()}\n\n保留来源文件位置。`);
await d.getByRole('button', { name: '保存为候选', exact: true }).click();
await p.getByRole('button', { name: '审查精确候选内容', exact: true }).click();
assert(await p.getByRole('dialog').getByRole('button', { name: '记录本次内容审查', exact: true }).isDisabled());
await p.getByRole('dialog').getByRole('checkbox').check();
await p.getByRole('dialog').getByRole('button', { name: '记录本次内容审查', exact: true }).click();
assert(await p.getByRole('button', { name: '检查并自动生效', exact: true }).isEnabled());
// Editing a reviewed candidate must invalidate that exact-content approval.
await p.getByRole('button', { name: 'SKILL.md', exact: true }).click();
const e = p.getByRole('dialog').locator('textarea');
await e.fill(`${await e.inputValue()}\n保留章节。`);
await p.getByRole('button', { name: '保存为候选', exact: true }).click();
assert(await p.getByRole('button', { name: '审查精确候选内容', exact: true }).isVisible());
await p.screenshot({ path: `${root}/after/trust-invalidated.png`, animations: 'disabled' });
const v = p.video();
await c.close();
await v.saveAs(`${root}/video/exact-content-trust.webm`);
checks.push('exact-content-trust-invalidated-on-edit');
await b.close();
await fs.writeFile(`${root}/permissions.json`, JSON.stringify(checks, null, 2));
console.log(checks);
