import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { connection, root } from './client';
const scenario = JSON.parse(await readFile(join(root, '.runtime/scenario.json'), 'utf8')) as {
  source: string;
  project: string;
};
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const results = [];
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 1000 },
    locale: 'zh-CN',
    timezoneId: 'America/Los_Angeles',
    reducedMotion: 'reduce',
  });
  await context.addInitScript((token) => sessionStorage.setItem('agent-connection-token', token), connection.token);
  const page = await context.newPage();
  await page.goto(
    `${connection.origin}/?${new URLSearchParams({ r: JSON.stringify({ page: 'reflections', offset: 0 }) })}`,
  );
  const row = page.locator('[data-job]').last();
  await row.waitFor();
  await row.focus();
  const saved = await page.locator('.workspace').evaluate((node) => node.scrollTop);
  assert.ok(saved > 0, 'real records create scrollable list');
  const id = await row.getAttribute('data-job');
  await row.click();
  await page.getByRole('button', { name: '反思记录', exact: true }).last().click();
  await page.waitForFunction((id) => document.activeElement?.getAttribute('data-focus') === id, id);
  const restored = await page.locator('.workspace').evaluate((node) => node.scrollTop);
  assert.ok(Math.abs(restored - saved) <= 1);
  results.push({
    name: 'back restores scrolled real catalog and row focus',
    expected: saved,
    actual: restored,
    status: 'passed',
  });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.aw-heading button')?.hasAttribute('disabled'));
  const afterRefresh = await page.locator('.workspace').evaluate((node) => node.scrollTop);
  assert.ok(afterRefresh < 30, 'finished restoration cannot keep snapping user back on later updates');
  results.push({
    name: 'later refresh does not replay completed scroll restoration',
    expected: 'near top after activating refresh',
    actual: afterRefresh,
    status: 'passed',
  });
  const trigger = page.getByRole('button', { name: '打开导航', exact: true });
  await trigger.click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByRole('dialog').locator(`[data-session="${scenario.source}"]`).count(), 1);
  await page.screenshot({ path: join(root, 'evidence/screenshots/navigation-390.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.ok(await trigger.evaluate((node) => node === document.activeElement));
  results.push({
    name: 'mobile real Session drawer and Escape focus restoration',
    expected: 'trigger focused',
    actual: 'trigger focused',
    status: 'passed',
  });
  await page.goto(
    `${connection.origin}/?${new URLSearchParams({ r: JSON.stringify({ page: 'source', reference: { sessionId: scenario.source, entryId: 'missing-entry-for-return' }, project: scenario.project, originSession: scenario.source }) })}`,
  );
  await page.getByRole('button', { name: '返回原会话', exact: true }).click();
  await page.getByLabel('继续会话').waitFor();
  const route = JSON.parse(new URL(page.url()).searchParams.get('r') || '{}');
  assert.equal(route.sessionId, scenario.source);
  results.push({
    name: 'explicit return preserves source Session identity',
    expected: scenario.source,
    actual: route.sessionId,
    status: 'passed',
  });
  await context.close();
} catch (error) {
  results.push({
    name: 'navigation browser run',
    status: 'failed',
    actual: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(join(root, 'evidence/navigation-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
}
