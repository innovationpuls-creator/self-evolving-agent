import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const phase = process.argv.includes('--before') ? 'before' : 'after';
const dir = new URL(`../evidence/a-refinement/${phase}/scenes/`, import.meta.url);
await fs.mkdir(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const errors = [],
  screens = [];
async function shot(p, name) {
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(200);
  await p.screenshot({ path: fileURLToPath(new URL(`${name}.png`, dir)) });
  screens.push({ name, viewport: p.viewportSize() });
}
async function nav(p, name) {
  const opener = p.getByRole('button', { name: '打开导航', exact: true });
  if (!(await p.locator('.sidebar').isVisible())) await opener.click();
  await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name, exact: true }).click();
}
try {
  for (const [width, height] of [
    [1440, 1000],
    [1240, 850],
    [850, 600],
    [390, 844],
  ]) {
    const p = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(`${process.env.D6_BASE_URL ?? 'http://127.0.0.1:4176'}/?route=quiet&test=1`);
    await shot(p, `会话-${width}`);
    await p.locator('.reading-scroll').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await shot(p, `会话-内容-${width}`);
    await nav(p, '记忆');
    if (width <= 700) await p.locator('.knowledge-item').first().click();
    await shot(p, `记忆-${width}`);
    await p.getByRole('tab', { name: '修订比较', exact: true }).click();
    await shot(p, `记忆-比较-${width}`);
    await p.getByRole('button', { name: /^(修正|编辑当前版本)$/ }).click();
    await shot(p, `记忆-编辑-${width}`);
    await p.keyboard.press('Escape');
    await nav(p, '改进建议');
    await shot(p, `能力改进-${width}`);
    await p.getByRole('button', { name: '开始讨论目标', exact: true }).click();
    await p.getByRole('button', { name: '发送讨论内容', exact: true }).click();
    await p.getByRole('button', { name: '审阅开发授权', exact: true }).click();
    await shot(p, `能力改进-授权-${width}`);
    await p.locator('.modal-body').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await shot(p, `能力改进-权限-${width}`);
    await p.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await fs.writeFile(
    new URL('capture.json', dir),
    JSON.stringify({ phase, browser: browser.version(), screens, errors }, null, 2),
  );
  await browser.close();
}
console.log(`${phase}: ${screens.length} same-size scene captures`);
