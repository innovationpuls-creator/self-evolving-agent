import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron, chromium, type Page } from 'playwright-core';
import type { EvolutionSuggestion } from '../../apps/host/evolution/evolution.js';
const execution = JSON.parse(await readFile('docs/evidence/d3-signed-integration.json', 'utf8'));
assert.equal(execution.passed, true);
const root = execution.root as string;
const receipt: Record<string, unknown> = { time: new Date().toISOString(), root, checks: [], passed: false };
const checks = receipt.checks as string[];
const app = await _electron.launch({
  executablePath: execution.executable,
  args: [`--user-data-dir=${join(root, 'profile')}`],
  env: { ...process.env, AGENT_DESKTOP_DATA_DIR: join(root, 'data') },
});
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
async function request<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (path) => {
    const response = await fetch(`/api${path}`, {
      headers: { Authorization: `Bearer ${sessionStorage.getItem('agent-connection-token')}` },
    });
    assertResponse(response.ok);
    return await response.json();
    function assertResponse(ok: boolean) {
      if (!ok) throw new Error('Product request failed');
    }
  }, path);
}
try {
  const desktop = await app.firstWindow();
  await desktop.locator('.shell').waitFor({ timeout: 300000 });
  const web = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const token = await desktop.evaluate(() => sessionStorage.getItem('agent-connection-token'));
  await web.goto(`${new URL(desktop.url()).origin}/#token=${token}`);
  await web.locator('.shell').waitFor();
  const record = execution.reflection.records[0];
  const suggestionId = record.changes.find((c: { kind: string }) => c.kind === 'suggestion').id;
  const suggestion = await request<EvolutionSuggestion>(desktop, `/suggestions/${suggestionId}`);
  for (const [name, page] of [
    ['desktop', desktop],
    ['web', web],
  ] as const) {
    await page.getByRole('button', { name: '反思记录', exact: true }).click();
    await page.locator('.reflection-item').filter({ hasText: record.summary }).click();
    await page.getByRole('heading', { name: '形成的判断', exact: true }).waitFor();
    await page.getByRole('button', { name: '查看记忆修订', exact: true }).click();
    await page.getByText('正在查看引用修订 #2，当前修订为 #3。', { exact: false }).waitFor();
    checks.push(`${name}: Reflection links to actual superseded Memory revision`);
    await page.getByRole('button', { name: '反思记录', exact: true }).click();
    await page.locator('.reflection-item').filter({ hasText: record.summary }).click();
    await page.getByRole('button', { name: '查看建议', exact: true }).click();
    await page.getByRole('heading', { name: suggestion.title, exact: true }).waitFor();
    await page.screenshot({
      path: resolve(`release/d3-development-evidence/${name}-suggestion-detail.png`),
      fullPage: true,
    });
    checks.push(`${name}: actual Reflection suggestion detail and evidence visible`);
  }
  const adopt = web.getByRole('button', { name: '采纳并讨论', exact: true });
  if (suggestion.status === 'pending') await adopt.click();
  let adopted = await request<EvolutionSuggestion>(web, `/suggestions/${suggestionId}`);
  for (let i = 0; i < 100 && adopted.status === 'pending'; i++) {
    await web.waitForTimeout(100);
    adopted = await request<EvolutionSuggestion>(web, `/suggestions/${suggestionId}`);
  }
  assert.equal(adopted.status, 'adopted');
  const discussion = adopted.discussionSessionId;
  assert.ok(discussion);
  const session = await request<{ busy: boolean; messages: Array<{ role: string }> }>(web, `/sessions/${discussion}`);
  assert.equal(session.busy, false);
  assert.equal(
    session.messages.some((m) => m.role === 'assistant'),
    false,
  );
  await desktop.getByRole('button', { name: '进入讨论', exact: true }).waitFor();
  receipt.adopted = adopted;
  receipt.discussion = session;
  checks.push('Web adoption synchronizes to Desktop; discussion session starts no model prompt or development');
  receipt.passed = true;
} catch (error) {
  receipt.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await app.close();
  await writeFile('docs/evidence/d3-signed-client.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
}
