import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const results = [],
  errors = [];
try {
  for (const width of [1440, 850, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.setDefaultTimeout(7000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${process.env.D6_MOCK_ORIGIN ?? 'http://127.0.0.1:4176'}/?route=quiet`);
    const nav = async (name) => {
      if (!(await page.locator('.sidebar').isVisible()))
        await page.getByRole('button', { name: '打开导航', exact: true }).click();
      await page
        .getByRole('navigation', { name: '主要模块', exact: true })
        .getByRole('button', { name, exact: true })
        .click();
    };
    const draft = page.getByRole('textbox', { name: '发送给 Agent', exact: true });
    await draft.fill('跨页面保留的原工作空间草稿');
    await page.locator('.execution-summary > summary').first().click();
    await page.getByRole('button', { name: '查看执行记录', exact: true }).click();
    await page.getByRole('button', { name: '回到对话', exact: true }).click();
    assert.equal(await draft.inputValue(), '跨页面保留的原工作空间草稿');
    results.push({ width, name: 'accepted SessionRoom → trajectory → conversation preserves draft', status: 'passed' });
    await nav('记忆');
    await page.locator('.aw-memory-row').first().click();
    await page.getByRole('button', { name: '查看修订来源', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    assert.ok(await page.locator('.aw:visible h1').innerText());
    results.push({ width, name: 'current memory detail and source dialog', status: 'passed' });
    await nav('技能与工具');
    await page.locator('.asm-items .asm-item').first().click();
    await page.getByRole('tab', { name: '版本', exact: true }).click();
    assert.ok(await page.locator('.asm-detail').isVisible());
    results.push({ width, name: 'current Skill manager and version tab', status: 'passed' });
    await nav('改进建议');
    await page.locator('.aw:visible h1').waitFor();
    const rows = await page.locator('.aw-proposal-row').count();
    if (rows) {
      await page.locator('.aw-proposal-row').first().click();
      assert.ok(await page.locator('.aw:visible h1').innerText());
    }
    results.push({ width, name: 'current Evolution catalog and available detail', rows, status: 'passed' });
    await nav('反思记录');
    assert.equal(await page.locator('.aw-journal-row').count(), 8);
    await page.locator('.aw-journal-row').first().click();
    await page.getByRole('button', { name: '查看证据与原始记录', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    results.push({ width, name: 'unchanged original reflection and source dialog', status: 'passed' });
    await page.close();
  }
  assert.deepEqual(errors, []);
} catch (error) {
  results.push({ name: 'current workspace smoke', status: 'failed', error: String(error) });
  process.exitCode = 1;
} finally {
  await browser.close();
  await fs.writeFile(
    new URL('../evidence/workspace-smoke.json', import.meta.url),
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: results.filter((item) => item.status === 'passed').length,
      failed: results.filter((item) => item.status === 'failed').length,
      errors,
    }),
  );
}
