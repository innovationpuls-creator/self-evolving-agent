import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const p = await b.newPage({ viewport: { width: 390, height: 1000 } });
await p.goto('http://127.0.0.1:4186/?route=quiet&test=1');
async function scene(name) {
  await p.getByRole('button', { name: '切换演示场景', exact: true }).click();
  await p.getByRole('menuitem', { name, exact: true }).click();
}
await scene('读取失败');
await p.getByRole('button', { name: '重新读取', exact: true }).click();
assert(await p.getByRole('textbox', { name: '发送给 Agent' }).isVisible());
await p.getByRole('textbox', { name: '发送给 Agent' }).fill('保留这份草稿');
await scene('连接中断');
assert(await p.getByRole('button', { name: '发送任务', exact: true }).isDisabled());
await p.getByRole('button', { name: '重新连接', exact: true }).click();
assert.equal(await p.getByRole('textbox', { name: '发送给 Agent' }).inputValue(), '保留这份草稿');
await scene('空内容');
assert(await p.getByRole('heading', { name: '还没有对话', exact: true }).isVisible());
await scene('日常状态');
assert.equal(await p.getByRole('textbox', { name: '发送给 Agent' }).inputValue(), '保留这份草稿');
await b.close();
await fs.writeFile(
  'evidence/a-product-20261023/states.json',
  JSON.stringify(
    ['read-retry', 'offline-disables-send', 'reconnect-preserves-unsent-draft', 'empty-state-return'],
    null,
    2,
  ),
);
console.log('states passed');
