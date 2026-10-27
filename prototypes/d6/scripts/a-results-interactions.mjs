import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir = 'evidence/a-results';
await fs.mkdir(`${dir}/video`, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const results = [],
  errors = [];
async function nav(p, name) {
  if (!(await p.locator('.sidebar').isVisible()))
    await p.getByRole('button', { name: '打开导航', exact: true }).click();
  await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name, exact: true }).click();
}
async function shot(p, name) {
  await p.mouse.move(p.viewportSize().width - 2, p.viewportSize().height - 2);
  if (await p.getByRole('tooltip').isVisible()) await p.keyboard.press('Escape');
  await p.waitForTimeout(220);
  assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await p.screenshot({ path: `${dir}/after/${name}.png`, animations: 'disabled' });
}
for (const width of [1440, 850, 390]) {
  const context = await browser.newContext({
    viewport: { width, height: width === 1440 ? 1000 : 844 },
    recordVideo: { dir: `${dir}/video`, size: { width, height: width === 1440 ? 1000 : 844 } },
  });
  const p = await context.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto('http://127.0.0.1:4176/?route=quiet');
  await p.evaluate(() => document.fonts.ready);
  await nav(p, '改进建议');
  assert.equal(await p.getByText('ENOENT', { exact: true }).filter({ visible: true }).count(), 0);
  await p.locator('.proposal-sources summary').click();
  await shot(p, `sources-${width}`);
  await p.getByRole('button', { name: '反思记录', exact: true }).last().click();
  assert(await p.getByRole('heading', { name: '比较两版项目说明', exact: true }).isVisible());
  await p.getByRole('button', { name: '查看执行依据', exact: true }).click();
  const dlg = p.getByRole('dialog');
  assert(await dlg.getByText('正文读取成功', { exact: false }).isVisible());
  await dlg.getByText('原始记录', { exact: true }).click();
  await dlg.getByRole('button', { name: '展开完整脱敏记录', exact: true }).click();
  assert(await dlg.getByText('兼容附件 ENOENT', { exact: false }).isVisible());
  await shot(p, `evidence-${width}`);
  await dlg.getByRole('button', { name: '查看附件读取记录', exact: true }).click();
  assert.equal(await p.locator('#ledger-fail').getAttribute('aria-selected'), 'true');
  await nav(p, '反思记录');
  if (width === 390 && (await p.locator('.journal-index').isVisible()))
    await p.locator('.journal-index button').first().click();
  await p.getByRole('button', { name: /记忆已修订 差异报告应单列/ }).click();
  assert(await p.getByRole('heading', { name: '差异报告应单列未核实内容', exact: true }).isVisible());
  await p.getByRole('button', { name: '返回上一个位置', exact: true }).click();
  await p.getByRole('button', { name: /改进建议 完善文档比较/ }).click();
  await p.getByRole('button', { name: '开始讨论目标', exact: true }).click();
  assert(await p.getByRole('button', { name: '审阅开发授权', exact: true }).isDisabled());
  assert(await p.getByText('当前仅讨论。', { exact: false }).isVisible());
  await p.getByRole('button', { name: '返回建议', exact: true }).click();
  await p.getByRole('button', { name: '开始讨论目标', exact: true }).click();
  await p.getByRole('button', { name: '发送讨论内容', exact: true }).click();
  await p.getByRole('button', { name: '审阅开发授权', exact: true }).click();
  assert(await dlg.getByText('使用本机用户权限', { exact: true }).count());
  assert(await dlg.getByText('取消和版本回退不能撤销已发生的外部副作用。', { exact: true }).count());
  await shot(p, `permission-${width}`);
  await p.keyboard.press('Escape');
  await p.getByRole('button', { name: '返回建议', exact: true }).click();
  await p.getByRole('button', { name: '忽略建议', exact: true }).click();
  await p.getByRole('tab', { name: '已处理', exact: true }).click();
  assert(await p.getByText('已忽略', { exact: true }).isVisible());
  await shot(p, `ignored-${width}`);
  await p.getByRole('button', { name: '恢复为待决定', exact: true }).click();
  await nav(p, '反思记录');
  if (width === 390 && !(await p.locator('.journal-index').isVisible()))
    await p.getByRole('button', { name: '返回反思记录', exact: true }).click();
  await p.locator('.journal-index button').nth(1).click();
  assert(await p.getByRole('heading', { name: '没有需要保留的新发现', exact: true }).isVisible());
  assert.equal(await p.locator('.result-changes button').count(), 0);
  await p.getByRole('button', { name: '查看执行依据', exact: true }).click();
  await dlg.getByText('原始记录', { exact: true }).click();
  assert(await dlg.locator('.evidence > p').getByText('整理版本发布说明 · 昨天 17:08', { exact: true }).isVisible());
  await p.keyboard.press('Escape');
  if (width === 390) {
    await p.getByRole('button', { name: '返回反思记录', exact: true }).click();
    await p.waitForFunction(() => document.activeElement?.matches('.journal-index button.selected'));
    assert(await p.locator('.journal-index button.selected').evaluate((el) => el === document.activeElement));
  }
  await p.locator('.journal-index button').last().click();
  await p.getByRole('button', { name: '检查恢复条件', exact: true }).click();
  assert.equal(await dlg.getByRole('button', { name: '模拟环境恢复并重新审查', exact: true }).count(), 0);
  await shot(p, `recovery-${width}`);
  await p.keyboard.press('Escape');
  if (width === 390) await p.getByRole('button', { name: '返回反思记录', exact: true }).click();
  await shot(p, `returned-${width}`);
  const video = p.video();
  await context.close();
  await video.saveAs(`${dir}/video/results-${width}.webm`);
  await video.delete();
  results.push(
    `${width}: source links, raw evidence, selected trace, memory revision, read-only discussion, grant boundary, ignore/restore, no findings, unavailable, mobile return focus`,
  );
}
const p = await browser.newPage();
await p.goto('http://127.0.0.1:4176/?route=quiet&test=1');
for (const page of ['改进建议', '反思记录']) {
  await nav(p, page);
  for (const state of ['加载', '空内容', '读取失败', '长内容']) {
    await p.getByRole('button', { name: '切换演示场景', exact: true }).click();
    await p.getByRole('menuitem', { name: state, exact: true }).click();
    await shot(p, `${page}-${state}`);
    await p.getByRole('button', { name: '切换演示场景', exact: true }).click();
    await p.getByRole('menuitem', { name: '日常状态', exact: true }).click();
  }
}
await p.locator('.journal-index button').last().click();
await p.getByRole('button', { name: '检查恢复条件', exact: true }).click();
await p.getByRole('button', { name: '模拟环境恢复并重新审查', exact: true }).click();
assert(await p.getByRole('heading', { name: '没有需要保留的新发现', exact: true }).isVisible());
results.push(
  'Test tools retain simulated recovery; loading, empty, error, long content remain accessible for both pages',
);
await p.close();
assert.deepEqual(errors, []);
await fs.writeFile(`${dir}/interactions.json`, JSON.stringify({ results, errors }, null, 2));
await browser.close();
console.log(results.join('\n'));
