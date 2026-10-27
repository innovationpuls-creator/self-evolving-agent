import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root = 'evidence/a-skills-20261023';
const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto('http://127.0.0.1:4186/?route=quiet');
const click = async (name) => p.getByRole('button', { name, exact: true }).click();
const tab = async (name) =>
  p.getByRole('tablist', { name: '候选操作' }).getByRole('tab', { name, exact: true }).click();
async function trust() {
  await click('审查内容与依赖');
  await p.getByRole('checkbox', { name: '我已审查完整内容与依赖引用' }).check();
  await click('记录本次内容审查');
  await p.getByRole('dialog').waitFor({ state: 'hidden' });
}
await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name: '技能与工具', exact: true }).click();
await click('编辑技能');
let editor = p.getByRole('textbox', { name: '编辑 SKILL.md', exact: true });
await editor.fill(`${await editor.inputValue()}\n- 每项变化附上章节位置。`);
await click('保存候选');
await tab('审查与发布');
await trust();
await click('检查并生效');
await p.getByText('必要检查通过，新版本已生效。', { exact: true }).waitFor();
await click('编辑技能');
await p.getByRole('button', { name: 'extension.ts', exact: true }).click();
editor = p.getByRole('textbox', { name: '编辑 extension.ts', exact: true });
await editor.fill(`${await editor.inputValue()}\n// Preserve comparison context.`);
await click('保存候选');
await tab('审查与发布');
await trust();
assert(await p.getByRole('button', { name: '检查并生效', exact: true }).isEnabled());
await p.getByRole('tab', { name: '版本', exact: true }).click();
await click('v1 历史版本');
await click('恢复此版本');
await click('确认恢复 v1');
await p.getByRole('dialog').waitFor({ state: 'hidden' });
await click('审阅候选');
await tab('审查与发布');
assert(!(await p.getByRole('button', { name: '检查并生效', exact: true }).isEnabled()));
assert(await p.getByRole('button', { name: '审查内容与依赖', exact: true }).isVisible());
await p.screenshot({ path: `${root}/after/restore-invalidates-trust-1440.png` });
await fs.writeFile(
  `${root}/trust-base.json`,
  JSON.stringify(
    {
      checks: ['code-candidate-editor', 'full-package-trust', 'restore-preserves-candidate-invalidates-trust'],
      passed: true,
    },
    null,
    2,
  ),
);
await b.close();
console.log('trust/base regression passed');
