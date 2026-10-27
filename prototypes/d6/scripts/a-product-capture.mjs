import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
const phase = process.argv[2] || 'before';
const root = `evidence/a-product-20261023/${phase}`;
await fs.mkdir(root, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
for (const width of [1440, 850, 390]) {
  const p = await browser.newPage({ viewport: { width, height: 1000 } });
  await p.goto('http://127.0.0.1:4186/?route=quiet');
  async function shot(name) {
    await p.mouse.move(width - 2, 998);
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${root}/${name}-${width}.png` });
  }
  await shot('chat');
  for (const [name, label] of [
    ['memory', '记忆'],
    ['reflection', '反思记录'],
    ['evolution', '改进建议'],
    ['skills', '技能与工具'],
  ]) {
    if (!(await p.locator('.sidebar').isVisible()))
      await p.getByRole('button', { name: '打开导航', exact: true }).click();
    await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name: label, exact: true }).click();
    await shot(name);
  }
  if (!(await p.locator('.sidebar').isVisible()))
    await p.getByRole('button', { name: '打开导航', exact: true }).click();
  await p.getByRole('button', { name: '模型与连接', exact: true }).click();
  await shot('settings');
  await p.close();
}
const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto('http://127.0.0.1:4186/?route=studio');
await p.screenshot({ path: `${root}/B.png` });
await browser.close();
