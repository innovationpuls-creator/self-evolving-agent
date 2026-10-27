import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
const origin = process.env.D6_MOCK_ORIGIN ?? 'http://127.0.0.1:4176';
import assert from 'node:assert/strict';
const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const dir = new URL(process.env.D6_EVIDENCE_DIR ?? '../evidence/round2/', import.meta.url);
const results = [],
  errors = [];
async function shot(p, n) {
  await p.waitForTimeout(120);
  await p.screenshot({ path: new URL(`${n}.png`, dir).pathname });
  assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
}
async function nav(p, m, key) {
  if (m === 'studio')
    await p
      .getByRole('navigation', { name: '工作空间' })
      .getByRole('button', {
        name: ['memory', 'reflection'].includes(key) ? '认识' : ['skills', 'evolution'].includes(key) ? '能力' : '工作',
        exact: true,
      })
      .click();
  if (!(await p.locator('.sidebar').isVisible()))
    await p.getByRole('button', { name: '打开导航', exact: true }).click();
  if (key === 'trace') {
    if (m === 'quiet') {
      await p.locator('.session-list button').first().click();
      await p.getByRole('tab', { name: '轨迹', exact: true }).click();
    } else
      await p
        .getByRole('navigation', { name: '主要模块' })
        .getByRole('button', { name: '执行记录', exact: true })
        .click();
  } else
    await p
      .getByRole('navigation', { name: '主要模块' })
      .getByRole('button', {
        name: (m === 'quiet'
          ? { memory: '记忆', reflection: '反思记录', skills: '技能与工具', evolution: '改进建议' }
          : { memory: '记忆', reflection: '反思', skills: '能力库', evolution: '能力改进' })[key],
        exact: true,
      })
      .click();
}
for (const mode of process.env.D6_MOCK_MODES?.split(',') ?? ['quiet', 'studio']) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(`${origin}/?route=${mode}&test=1`);
  await p.waitForTimeout(300);
  await nav(p, mode, 'memory');
  await p
    .locator(mode === 'quiet' ? '.knowledge-item' : '.knowledge-register tbody button')
    .first()
    .click();
  await shot(p, `${mode}-memory-detail-390`);
  await p.getByRole('tab', { name: '修订比较', exact: true }).click();
  await shot(p, `${mode}-memory-diff-390`);
  await nav(p, mode, 'reflection');
  await p
    .locator(mode === 'quiet' ? '.journal-index button' : '.reflection-dates button')
    .first()
    .click();
  await shot(p, `${mode}-reflection-detail-390`);
  await nav(p, mode, 'skills');
  await p
    .locator(mode === 'quiet' ? '.skill-index button' : '.capability-matrix button')
    .first()
    .click();
  await shot(p, `${mode}-skill-detail-390`);
  await p.getByRole('tab', { name: '工具与依赖', exact: true }).click();
  await shot(p, `${mode}-skill-dependencies-390`);
  await nav(p, mode, 'trace');
  await (mode === 'quiet'
    ? p.getByRole('row', { name: /核实旧版兼容承诺/ })
    : p.getByRole('button', { name: '核实旧版兼容承诺', exact: true })
  ).click();
  await shot(p, `${mode}-tool-error-detail-390`);
  await p.getByRole('tab', { name: mode === 'quiet' ? '原文' : '原始记录', exact: true }).click();
  await shot(p, `${mode}-json-detail-390`);
  await nav(p, mode, 'evolution');
  await p.getByRole('button', { name: '开始讨论目标' }).click();
  await p.getByRole('button', { name: '发送讨论内容' }).click();
  await p.getByRole('button', { name: '审阅开发授权' }).click();
  if (mode === 'studio') await p.locator('.workspace').evaluate((el) => (el.scrollTop = 0));
  await shot(p, `${mode}-grant-top-390`);
  await p.locator(mode === 'quiet' ? '.modal-body' : '.workspace').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await shot(p, `${mode}-grant-bottom-390`);
  assert(await p.getByRole('button', { name: '批准这个目标与范围' }).isVisible());
  await p.setViewportSize({ width: 850, height: 600 });
  await p.locator(mode === 'quiet' ? '.modal-body' : '.workspace').evaluate((el) => (el.scrollTop = 0));
  await shot(p, `${mode}-grant-850`);
  results.push(`${mode}: narrow object, diff, dependencies, failed tool, JSON, grant top/bottom and 850 grant`);
  await p.close();
}
assert.deepEqual(errors, []);
await fs.writeFile(
  new URL('details-results.json', dir),
  JSON.stringify({ browser: await b.version(), results, errors }, null, 2),
);
await b.close();
console.log(`${results.length} detailed visual groups`);
