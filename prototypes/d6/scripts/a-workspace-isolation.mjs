import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root = 'evidence/a-workspace-20261023';
await fs.mkdir(`${root}/isolation`, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const checks = [],
  errors = [];
for (const width of [1440, 850, 390]) {
  const p = await browser.newPage({ viewport: { width, height: 1000 } });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto('http://127.0.0.1:4186/?route=quiet');
  async function click(name) {
    await p.getByRole('button', { name, exact: true }).click();
  }
  await p.locator('.execution-summary > summary').click();
  await click('查看执行记录');
  assert(await p.getByRole('button', { name: '回到对话', exact: true }).isVisible());
  await p.screenshot({ path: `${root}/isolation/trace-${width}.png` });
  await click('回到对话');
  await p.getByRole('textbox', { name: '发送给 Agent' }).fill('暂时保留这条草稿');
  if (!(await p.locator('.sidebar').isVisible())) await click('打开导航');
  await click('模型与连接');
  assert(await p.locator('.settings-page').isVisible());
  await click('返回上一个位置');
  assert.equal(await p.getByRole('textbox', { name: '发送给 Agent' }).inputValue(), '暂时保留这条草稿');
  checks.push(`A-chat-trace-settings-return-${width}`);
  await p.close();
}
for (const width of [1440, 850, 390]) {
  const p = await browser.newPage({ viewport: { width, height: 1000 } });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto('http://127.0.0.1:4186/?route=studio');
  assert.equal(await p.locator('.aw').count(), 0);
  const pages = [
    ['工作', '工作结果', '.workbook-conversation'],
    ['认识', '记忆', '.memory-page'],
    ['认识', '反思', '.reflection-page'],
    ['能力', '能力库', '.skills-page'],
    ['能力', '能力改进', '.evolution-page'],
  ];
  for (const [primary, label, selector] of pages) {
    await p
      .getByRole('navigation', { name: '工作空间', exact: true })
      .getByRole('button', { name: primary, exact: true })
      .click();
    if (!(await p.locator('.sidebar').isVisible()))
      await p.getByRole('button', { name: '打开导航', exact: true }).click();
    await p
      .getByRole('navigation', { name: '主要模块', exact: true })
      .getByRole('button', { name: label, exact: true })
      .click();
    if (label !== '工作结果') assert(await p.locator(selector).isVisible());
    assert.equal(await p.locator('.aw-active').count(), 0);
    await p.evaluate(() => document.activeElement?.blur());
    await p.mouse.move(width - 1, 999);
    await p.waitForTimeout(600);
    await p.screenshot({ path: `${root}/isolation/B-${label}-${width}.png` });
    checks.push(`B-${label}-${width}`);
    if (label === '工作结果') {
      if (!(await p.locator('.sidebar').isVisible()))
        await p.getByRole('button', { name: '打开导航', exact: true }).click();
      await p
        .getByRole('navigation', { name: '主要模块', exact: true })
        .getByRole('button', { name: '执行记录', exact: true })
        .click();
      assert(await p.locator('.trace-page').isVisible());
      checks.push(`B-trace-${width}`);
    }
  }
  await p.getByRole('button', { name: '模型与连接', exact: true }).first().click();
  assert(await p.locator('.settings-page').isVisible());
  checks.push(`B-settings-${width}`);
  await p.close();
}
// The B fixture outcome must still be success after an A nochange setting.
const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto('http://127.0.0.1:4186/?route=quiet&test=1');
await p.getByRole('button', { name: '比较 B', exact: true }).click();
await p
  .getByRole('navigation', { name: '工作空间', exact: true })
  .getByRole('button', { name: '能力', exact: true })
  .click();
await p
  .getByRole('navigation', { name: '主要模块', exact: true })
  .getByRole('button', { name: '能力改进', exact: true })
  .click();
await p.getByRole('button', { name: '开始讨论目标', exact: true }).click();
await p.getByRole('button', { name: '发送讨论内容', exact: true }).click();
await p.getByRole('button', { name: '审阅开发授权', exact: true }).click();
await p.getByRole('button', { name: '批准这个目标与范围', exact: true }).click();
await p.waitForTimeout(3800);
assert(await p.getByText('能力变更已正式生效', { exact: true }).isVisible());
checks.push('A-B-outcome-state-isolation');
await browser.close();
assert.deepEqual(errors, []);
await fs.writeFile(`${root}/isolation.json`, JSON.stringify({ checks, errors }, null, 2));
console.log(checks);
