import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir = new URL(process.env.D6_EVIDENCE_DIR ?? '../evidence/trace-ledger/', import.meta.url);
await fs.mkdir(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const errors = [],
  requests = [],
  results = [];
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:4176/')) requests.push(r.url());
  });
  const shot = async (name) => {
    await p.waitForTimeout(100);
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name);
    await p.screenshot({ path: new URL(`${name}.png`, dir).pathname });
  };
  const row = (name) => p.locator('.ledger-row').filter({ hasText: name });
  await p.goto('http://127.0.0.1:4176/?route=quiet&test=1');
  await p.getByRole('tab', { name: '轨迹', exact: true }).click();
  assert.equal(await p.locator('.ledger-row').count(), 10);
  assert.equal(await p.locator('.ledger-row[data-kind="tool"]').count(), 5);
  const density = await p
    .locator('.ledger-row')
    .evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().height));
  assert(
    density.every((h) => h <= 31),
    JSON.stringify(density),
  );
  assert(
    await p
      .locator('.ledger-row')
      .last()
      .evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight),
  );
  await shot('quiet-ledger-1440');
  await row('项目说明 v2').click();
  await p.getByRole('tab', { name: '输入', exact: true }).click();
  assert.match(await p.locator('.ledger-inspector').textContent(), /项目说明-v2/);
  await p.getByRole('tab', { name: '输出', exact: true }).click();
  assert.match(await p.locator('.ledger-inspector').textContent(), /设备授权/);
  await shot('quiet-ledger-file');
  await row('ENOENT').click();
  await shot('quiet-ledger-error');
  await p.locator('.ledger-inspector .tabbar').first().getByRole('tab', { name: '原文', exact: true }).click();
  assert.match(await p.locator('.ledger-inspector').textContent(), /call_demo_fail/);
  await shot('quiet-ledger-evidence');
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('.ledger-inspector').count(), 0);
  await p.waitForTimeout(40);
  assert(await row('ENOENT').evaluate((el) => document.activeElement === el));
  await row('兼容说明不存在').click();
  await shot('quiet-ledger-model');
  await p.getByRole('tab', { name: '输入', exact: true }).click();
  await shot('quiet-ledger-context');
  await p.getByRole('button', { name: '关闭记录详情', exact: true }).click();
  results.push(
    '10 event rows at 30px, all visible on first screen; exact tool inputs/outputs; model/context and raw error inspector; Escape restores row focus',
  );
  await p.getByRole('button', { name: '折叠工具调用', exact: true }).click();
  assert.equal(await p.locator('.ledger-row').count(), 5);
  await shot('quiet-ledger-folded-calls');
  await p.getByRole('button', { name: '展开工具调用', exact: true }).click();
  await p.getByRole('button', { name: '折叠轮次', exact: true }).click();
  assert.equal(await p.locator('.ledger-row').count(), 1);
  await p.getByRole('button', { name: '展开轮次', exact: true }).click();
  await p.getByRole('textbox', { name: '搜索轨迹', exact: true }).fill('ENOENT');
  assert.equal(await p.locator('.ledger-row').count(), 1);
  await shot('quiet-ledger-search');
  await p.getByRole('textbox', { name: '搜索轨迹', exact: true }).fill('not-found');
  assert.match(await p.locator('.ledger-no-records').textContent(), /没有匹配/);
  await p.getByRole('textbox', { name: '搜索轨迹', exact: true }).fill('');
  await p.locator('.ledger-history').click();
  assert.equal(await p.locator('.ledger-row').count(), 7);
  assert.equal(await p.locator('.ledger-row').filter({ hasText: '两版正文有两类主要变化' }).count(), 0);
  await shot('quiet-ledger-checkpoint');
  await p.locator('.ledger-history').click();
  await p.locator('.ledger-time-mark').last().click();
  assert.match(await p.locator('.ledger-inspector').textContent(), /模型调用 #4/);
  await p.getByRole('button', { name: '关闭记录详情', exact: true }).click();
  await p.getByRole('button', { name: '显示时间概览', exact: true }).click();
  assert.equal(await p.locator('.ledger-overview').count(), 0);
  await p.getByRole('button', { name: '显示时间概览', exact: true }).click();
  results.push(
    'Tool and turn folding, search/no matches, checkpoint without final response, timestamp overview selection and visibility',
  );
  await p.locator('.ledger-row').first().focus();
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('Enter');
  assert.match(await p.locator('.ledger-inspector').textContent(), /模型调用 #1/);
  await p.keyboard.press('Escape');
  for (const width of [1240, 850, 768, 390]) {
    await p.setViewportSize({ width, height: width === 850 ? 600 : 900 });
    await shot(`quiet-ledger-${width}`);
    await row('ENOENT').click();
    await shot(`quiet-ledger-error-${width}`);
    assert(await p.getByRole('button', { name: '关闭记录详情', exact: true }).isVisible());
    await p.keyboard.press('Escape');
  }
  await p.getByRole('button', { name: '切换演示场景', exact: true }).click();
  await p.getByRole('menuitem', { name: '长内容', exact: true }).click();
  await shot('quiet-ledger-long-390');
  await p.getByRole('button', { name: '切换演示场景', exact: true }).click();
  await p.getByRole('menuitem', { name: '日常状态', exact: true }).click();
  results.push(
    'Keyboard row navigation and five viewport sizes; inspector close remains visible; long paths truncate within row',
  );
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.getByRole('button', { name: '回到对话', exact: true }).click();
  const composer = p.getByRole('textbox', { name: '发送给 Agent', exact: true });
  await composer.fill('再次核对兼容说明');
  await composer.press('Meta+Enter');
  await p.getByRole('tab', { name: '轨迹', exact: true }).click();
  assert.equal(await p.locator('.ledger-row').count(), 1);
  await shot('quiet-ledger-running');
  await p.locator('.ledger-terminal').getByRole('button', { name: '停止', exact: true }).click();
  await shot('quiet-ledger-stopped');
  assert.equal(await p.locator('.ledger-row[data-kind="tool"]').count(), 0);
  await p.goto('http://127.0.0.1:4176/?route=studio');
  await p.getByRole('button', { name: '执行记录', exact: true }).click();
  assert.equal(await p.locator('.trace-register tbody tr').count(), 4);
  results.push('Pending/interrupted requests retain only recorded events; B register remains unchanged');
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  await fs.writeFile(
    new URL('browser-results.json', dir),
    JSON.stringify(
      { browser: await browser.version(), density, results, errors, unexpectedRequests: requests },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ results, errors, unexpectedRequests: requests }, null, 2));
} finally {
  await browser.close();
}
