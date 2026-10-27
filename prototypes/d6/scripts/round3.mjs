import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const out = new URL('../evidence/round3/supplement/', import.meta.url);
await fs.mkdir(out, { recursive: true });
const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [],
  requests = [],
  checks = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('request', (r) => {
  if (!r.url().startsWith('http://127.0.0.1:4176/')) requests.push(r.url());
});
try {
  await p.goto('http://127.0.0.1:4176/?route=quiet');
  for (const title of ['修正异步读取', '研究：如何判断证据', '整理文件清单']) {
    await p.getByRole('button', { name: '会话样例', exact: true }).click();
    await p.getByRole('menuitem', { name: title, exact: true }).click();
    assert.equal(await p.locator('.transcript-message').count(), 2);
    await p.screenshot({ path: decodeURIComponent(new URL(`${title}.png`, out).pathname) });
  }
  await p.getByRole('textbox', { name: '发送给 Agent', exact: true }).fill('进一步说明数据缺失时如何处理。');
  await p.getByRole('button', { name: '发送任务', exact: true }).click();
  await p.waitForTimeout(2500);
  assert.equal(await p.locator('.transcript-message').count(), 4);
  assert.match(await p.locator('.transcript-message').last().textContent(), /未调用模型/);
  await p.locator('.transcript-message').last().scrollIntoViewIfNeeded();
  await p.screenshot({ path: new URL('multi-turn.png', out).pathname });
  checks.push('three data-driven tasks and ordered multi-turn response');
  for (const width of [1440, 1280, 850, 768, 390]) {
    await p.setViewportSize({ width, height: width === 850 ? 600 : 900 });
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await p.screenshot({ path: new URL(`conversation-${width}.png`, out).pathname });
  }
  checks.push('five viewports without document overflow');
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  await fs.writeFile(new URL('results.json', out), JSON.stringify({ checks, errors, requests }, null, 2));
} finally {
  await b.close();
}
