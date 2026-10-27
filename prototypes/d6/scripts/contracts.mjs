import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
const origin = process.env.D6_MOCK_ORIGIN ?? 'http://127.0.0.1:4176';
import assert from 'node:assert/strict';
const dir = new URL(process.env.D6_EVIDENCE_DIR ?? '../evidence/round2/', import.meta.url);
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const results = [],
  errors = [];
for (const mode of process.env.D6_MOCK_MODES?.split(',') ?? ['quiet', 'studio']) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(`${origin}/?route=${mode}&test=1`);
  await p.getByRole('button', { name: '模型与连接', exact: true }).first().click();
  await p.getByRole('combobox', { name: '模型提供方' }).selectOption('兼容 API');
  assert(await p.getByText('尚未配置 Host 授权', { exact: true }).isVisible());
  await p.getByRole('combobox', { name: '模型提供方' }).selectOption('OpenAI');
  assert(await p.getByText('Host 已保存授权', { exact: true }).isVisible());
  results.push(`${mode}: provider switch preserves independent authorization state`);
  await p.keyboard.press('Meta+k');
  await p.getByRole('dialog').getByRole('textbox').fill('text-diff');
  await p.getByRole('dialog').getByRole('button', { name: 'text-diff Skill' }).click();
  await p.waitForTimeout(180);
  await p.getByRole('button', { name: '编辑说明', exact: true }).click();
  await p.getByRole('dialog').getByRole('textbox').fill('# text-diff\n未审查的候选，不改变正式版本。');
  await p.getByRole('button', { name: '保存为候选', exact: true }).click();
  assert(await p.getByRole('button', { name: '审查精确候选内容' }).isVisible());
  await p.getByRole('tab', { name: 'Tool', exact: true }).click();
  assert.equal(await p.locator('.availability-ladder').getByText('可用', { exact: true }).count(), 4);
  await p.getByRole('tab', { name: 'Skill', exact: true }).click();
  results.push(`${mode}: unreviewed candidate preserves formal version execution trust`);
  await p.getByRole('switch', { name: '启用当前 Skill' }).uncheck();
  await p.getByRole('tab', { name: 'Tool', exact: true }).click();
  await p.getByRole('button', { name: /text_diff text-diff/ }).click();
  assert.equal(await p.locator('.availability-ladder').getByText('未提供', { exact: true }).count(), 4);
  await p.screenshot({ path: new URL(`${mode}-tool-disabled.png`, dir).pathname });
  results.push(`${mode}: disabled skill does not claim callable extension tool`);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.keyboard.press('Meta+k');
  await p.getByRole('dialog').getByRole('textbox').fill('旧客户端');
  await p.getByRole('dialog').getByRole('button', { name: '旧客户端是否仍可登录 记忆' }).click();
  await p.waitForTimeout(180);
  assert(await p.getByRole('heading', { name: '旧客户端是否仍可登录', exact: true }).isVisible());
  await p.screenshot({ path: new URL(`${mode}-search-object-390.png`, dir).pathname });
  results.push(`${mode}: narrow global search opens the requested knowledge object`);
  await p.close();
}
assert.deepEqual(errors, []);
await fs.writeFile(
  new URL('contracts-results.json', dir),
  JSON.stringify({ browser: browser.version(), results, errors }, null, 2),
);
await browser.close();
console.log(`${results.length} cross-module contracts`);
