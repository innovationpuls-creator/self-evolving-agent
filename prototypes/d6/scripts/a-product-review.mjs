import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root = 'evidence/a-product-20261023';
await fs.mkdir(`${root}/video`, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const results = [],
  errors = [];
for (const width of [1440, 850, 390]) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    recordVideo: { dir: `${root}/video`, size: { width, height: 1000 } },
  });
  const p = await context.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto('http://127.0.0.1:4186/?route=quiet');
  async function shot(name) {
    await p.mouse.move(width - 2, 998);
    await p.waitForTimeout(500);
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name);
    await p.screenshot({ path: `${root}/after/${name}-${width}.png` });
  }
  async function nav(name) {
    if (!(await p.locator('.sidebar').isVisible()))
      await p.getByRole('button', { name: '打开导航', exact: true }).click();
    await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name, exact: true }).click();
  }
  await shot('chat');
  await p.locator('.execution-summary > summary').click();
  assert(await p.getByRole('button', { name: '查看执行记录', exact: true }).isVisible());
  await p.getByRole('button', { name: '查看执行记录', exact: true }).click();
  await shot('trace');
  await p.getByRole('button', { name: '回到对话', exact: true }).click();
  assert(await p.getByRole('textbox', { name: '发送给 Agent' }).isVisible());
  await nav('记忆');
  if (width === 390) await p.locator('.knowledge-item').first().click();
  await p.getByRole('button', { name: '编辑当前版本', exact: true }).click();
  assert(await p.getByRole('dialog').isVisible());
  await shot('memory-edit');
  await p.keyboard.press('Escape');
  await nav('改进建议');
  assert(await p.getByText('现有能力已经覆盖', { exact: true }).isVisible());
  await p.getByRole('button', { name: '继续讨论', exact: true }).click();
  assert.equal(await p.getByRole('textbox', { name: '讨论内容' }).inputValue(), '');
  assert(await p.getByRole('button', { name: '审阅开发授权', exact: true }).isEnabled());
  await shot('discussion');
  await p.getByRole('textbox', { name: '讨论内容' }).fill('现有规则已经覆盖材料缺失，还有修改依据吗？');
  await p.getByRole('button', { name: '发送讨论内容', exact: true }).click();
  assert(await p.getByText('仅凭附件缺失，无需修改技能。', { exact: false }).isVisible());
  await p.getByRole('button', { name: '审阅开发授权', exact: true }).click();
  const dlg = p.getByRole('dialog');
  assert(await dlg.getByText('使用本机用户权限', { exact: true }).isVisible());
  assert(await dlg.getByRole('button', { name: '批准这个目标与范围', exact: true }).isDisabled());
  await dlg
    .getByRole('textbox', { name: '授权目标' })
    .fill('检查现有报告规则是否已覆盖材料缺口；没有缺口则保留原版本。');
  assert(await dlg.getByRole('button', { name: '批准这个目标与范围', exact: true }).isEnabled());
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${root}/after/permission-${width}.png`, animations: 'disabled' });
  await dlg.getByRole('button', { name: '批准这个目标与范围', exact: true }).click();
  await p.waitForTimeout(3800);
  assert(await p.getByText('没有产生新版本', { exact: true }).isVisible());
  await shot('nochange');
  await nav('技能与工具');
  if (width === 390) await p.locator('.skill-index > button').first().click();
  await p.getByRole('tab', { name: '版本与信任', exact: true }).click();
  await shot('versions');
  await nav('反思记录');
  if (width === 390) await p.locator('.journal-index button').first().click();
  await p.getByRole('button', { name: '查看执行依据', exact: true }).click();
  assert(await p.getByRole('dialog').isVisible());
  await shot('evidence');
  await p.keyboard.press('Escape');
  await p.getByRole('button', { name: '返回上一个位置', exact: true }).click();
  await p.keyboard.press('Meta+k');
  assert(await p.getByRole('dialog').isVisible());
  await p.keyboard.press('Escape');
  // First new session and draft: no generated request and no automatic send.
  if (!(await p.locator('.sidebar').isVisible()))
    await p.getByRole('button', { name: '打开导航', exact: true }).click();
  await p.getByRole('button', { name: '新会话', exact: true }).click();
  await p.getByRole('dialog').getByRole('button', { name: /创建/ }).click();
  assert.equal(await p.getByRole('textbox', { name: '发送给 Agent' }).inputValue(), '');
  await shot('new-session');
  const video = p.video();
  await context.close();
  await video.saveAs(`${root}/video/journey-${width}.webm`);
  results.push({
    width,
    status: 'passed',
    checks: [
      'first-entry',
      'trace-and-return',
      'memory-editor',
      'discussion',
      'no-formal-message-gate',
      'grant-validation',
      'nochange-keeps-version',
      'versions',
      'source-drawer',
      'back',
      'command-search',
      'new-session',
      'no-horizontal-overflow',
    ],
  });
}
// Error/empty/offline states remain reachable through the existing testing controls.
const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto('http://127.0.0.1:4186/?route=quiet&test=1');
for (const state of ['空内容', '读取失败', '连接中断']) {
  await p.getByRole('button', { name: '切换演示场景', exact: true }).click();
  await p.getByRole('menuitem', { name: state, exact: true }).click();
  await p.waitForTimeout(150);
  await p.screenshot({ path: `${root}/after/state-${state}.png` });
}
await browser.close();
assert.deepEqual(errors, []);
await fs.writeFile(`${root}/regression.json`, JSON.stringify({ results, errors }, null, 2));
console.log(JSON.stringify(results));
