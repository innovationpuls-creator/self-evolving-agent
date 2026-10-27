import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root = 'evidence/a-workspace-20261024';
const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const results = [];
for (const width of [1440, 850, 390]) {
  const p = await b.newPage({ viewport: { width, height: 1000 } });
  await p.goto('http://127.0.0.1:4186/?route=quiet');
  if (!(await p.locator('.sidebar').isVisible()))
    await p.getByRole('button', { name: '打开导航', exact: true }).click();
  await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name: '反思记录', exact: true }).click();
  await p.locator('.aw-journal-row').filter({ hasText: '整理项目结构' }).click();
  await p.getByRole('button', { name: '查看来源记录', exact: true }).click();
  assert.match(await p.getByRole('dialog').innerText(), /不在当前选中分支/);
  assert.match(await p.getByRole('dialog').innerText(), /来源片段不可用/);
  await p.evaluate(() => document.activeElement?.blur());
  await p.mouse.move(width - 1, 999);
  await p.screenshot({ path: `${root}/after/source-unavailable-${width}.png` });
  await p.close();
}
const p = await b.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto('http://127.0.0.1:4186/evidence/a-workspace-20261024/index.html');
const keys = await p.locator('#scene option').evaluateAll((es) => es.map((e) => e.value));
for (const width of [1440, 850, 390])
  for (const key of keys) {
    await p.locator('#width').selectOption(String(width));
    await p.locator('#scene').selectOption(key);
    const names = await p.locator('img').evaluateAll(async (es) => {
      await Promise.all(es.filter((e) => !e.hidden).map((e) => e.decode()));
      return es.filter((e) => !e.hidden).map((e) => e.naturalWidth);
    });
    assert(names.every(Boolean));
    results.push({ width, key });
  }
await p.locator('video').evaluate(async (v) => {
  v.muted = true;
  await v.play();
});
await p.waitForTimeout(500);
const video = await p
  .locator('video')
  .evaluate((v) => ({ duration: v.duration, currentTime: v.currentTime, error: v.error?.message }));
assert(video.duration > 40);
assert(video.currentTime > 0);
assert(!video.error);
assert.deepEqual(errors, []);
await fs.writeFile(
  `${root}/delivery-check.json`,
  JSON.stringify({ imageScenarios: results.length, video, errors }, null, 2),
);
await b.close();
console.log(JSON.stringify({ imageScenarios: results.length, video, errors }));
