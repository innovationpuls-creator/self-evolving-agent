import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const before = process.argv.includes('--before');
const dir = `evidence/a-results/${before ? 'before' : 'after'}`;
await fs.mkdir(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const errors = [];
async function nav(p, name) {
  if (await p.locator('.app.studio').count())
    await p
      .getByRole('navigation', { name: '工作空间' })
      .getByRole('button', { name: ['反思', '记忆'].includes(name) ? '认识' : '能力', exact: true })
      .click();
  if (!(await p.locator('.sidebar').isVisible()))
    await p.getByRole('button', { name: '打开导航', exact: true }).click();
  await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name, exact: true }).click();
}
async function shot(p, name) {
  await p.evaluate(() => document.fonts.ready);
  if (await p.getByRole('tooltip').isVisible()) await p.keyboard.press('Escape');
  await p.mouse.move(p.viewportSize().width - 2, p.viewportSize().height - 2);
  await p.waitForTimeout(220);
  assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await p.screenshot({ path: `${dir}/${name}.png`, animations: 'disabled' });
}
for (const width of [1440, 850, 390]) {
  const p = await browser.newPage({ viewport: { width, height: width === 1440 ? 1000 : 844 } });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto('http://127.0.0.1:4176/?route=quiet');
  await nav(p, '改进建议');
  await shot(p, `suggestion-${width}`);
  await p.getByRole('button', { name: '开始讨论目标', exact: true }).click();
  await shot(p, `discussion-${width}`);
  await p.getByRole('button', { name: '发送讨论内容', exact: true }).click();
  await p.getByRole('button', { name: '审阅开发授权', exact: true }).click();
  await shot(p, `grant-${width}`);
  await p.keyboard.press('Escape');
  await nav(p, '反思记录');
  await shot(p, `reflection-${width}`);
  if (width === 390) await p.locator('.journal-index button').first().click();
  await shot(p, `finding-${width}`);
  if (width === 390) await p.locator('.reflection-document .mobile-back').click();
  await p.locator('.journal-index button').nth(1).click();
  await shot(p, `none-${width}`);
  if (width === 390) await p.locator('.reflection-document .mobile-back').click();
  await p.locator('.journal-index button').nth(2).click();
  await shot(p, `unavailable-${width}`);
  await p.close();
}
for (const mode of ['quiet', 'studio']) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto(`http://127.0.0.1:4176/?route=${mode}`);
  await shot(p, `${mode}-session`);
  for (const label of mode === 'quiet' ? ['记忆', '技能与工具'] : ['能力改进', '反思', '记忆', '能力库']) {
    await nav(p, label);
    await shot(p, `${mode}-${label}`);
  }
  await p.close();
}
assert.deepEqual(errors, []);
await fs.writeFile(`${dir}/capture.json`, JSON.stringify({ errors, browser: browser.version() }, null, 2));
await browser.close();
console.log(dir);
