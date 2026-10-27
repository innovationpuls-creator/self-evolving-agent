import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
const origin = process.env.D6_MOCK_ORIGIN ?? 'http://127.0.0.1:4176';
import assert from 'node:assert/strict';
const dir = new URL(process.env.D6_EVIDENCE_DIR ?? '../evidence/round2/', import.meta.url);
const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const results = [],
  errors = [];
try {
  for (const mode of process.env.D6_MOCK_MODES?.split(',') ?? ['quiet', 'studio']) {
    const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(`${origin}/?route=${mode}&test=1`);
    if (mode === 'studio')
      await p.getByRole('navigation', { name: '工作空间' }).getByRole('button', { name: '能力', exact: true }).click();
    await p
      .getByRole('navigation', { name: '主要模块' })
      .getByRole('button', { name: mode === 'quiet' ? '改进建议' : '能力改进', exact: true })
      .click();
    await p.getByRole('button', { name: '开始讨论目标', exact: true }).click();
    await p.getByRole('button', { name: '发送讨论内容', exact: true }).click();
    await p.getByRole('button', { name: '审阅开发授权', exact: true }).click();
    await p.getByRole('button', { name: '批准这个目标与范围', exact: true }).click();
    await p.getByText('能力变更已正式生效', { exact: true }).waitFor();
    await p.locator('.diff-view').scrollIntoViewIfNeeded();
    assert(await p.getByRole('button', { name: /展开 \d+ 行未改内容/ }).isVisible());
    await p.screenshot({ path: new URL(`${mode}-diff-context.png`, dir).pathname });
    await p.getByRole('button', { name: /展开 \d+ 行未改内容/ }).click();
    assert.equal(await p.getByRole('button', { name: /展开 \d+ 行未改内容/ }).count(), 0);
    await p.locator('.diff-view').getByRole('tab', { name: '完整内容', exact: true }).click();
    assert.equal(await p.locator('.diff-originals .code-view').count(), 2);
    await p.screenshot({ path: new URL(`${mode}-diff-originals.png`, dir).pathname });
    results.push(`${mode}: fold unchanged context, retain changed lines and access both complete originals`);
    await p.close();
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    new URL('diff-results.json', dir),
    JSON.stringify({ browser: b.version(), results, errors }, null, 2),
  );
  console.log('2 Diff inspections passed');
} finally {
  await b.close();
}
