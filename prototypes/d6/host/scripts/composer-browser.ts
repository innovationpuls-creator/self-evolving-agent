import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { connection, root, request, saveTranscript } from './client';
import type { Session } from '../../../../apps/web/src/features/chat/session-state';
const scenario = JSON.parse(await readFile(join(root, '.runtime/scenario.json'), 'utf8')) as { otherProject: string };
const source = await request<Session>('/sessions', 'POST', {
  cwd: scenario.otherProject,
  provider: 'openai-codex',
  model: 'gpt-6-luna',
});
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript((token) => sessionStorage.setItem('agent-connection-token', token), connection.token);
  await page.goto(
    `${connection.origin}/?${new URLSearchParams({ r: JSON.stringify({ page: 'session', sessionId: source.id }) })}`,
  );
  await page.getByLabel('继续会话').fill('这是一条真实连接验证消息，请只回复：收到。');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.locator('.live-message.assistant').filter({ hasText: '收到' }).waitFor({ timeout: 180000 });
  const saved = await request<Session>(`/sessions/${source.id}`);
  assert.ok(saved.messages?.some((m) => m.role === 'assistant'));
  assert.equal(await page.getByLabel('继续会话').inputValue(), '');
  results.push({
    name: 'actual composer click sends Host prompt and receives native Agent response over reused WebSocket state',
    session: source.id,
    expected: 'saved assistant response and empty accepted draft',
    actual: 'saved assistant response and empty accepted draft',
    status: 'passed',
  });
  await page.getByLabel('继续会话').fill('请写一段五百字的连接使用说明。');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.getByRole('button', { name: '发送', exact: true }).waitFor();
  const stopped = await request<Session>(`/sessions/${source.id}`);
  assert.equal(stopped.busy, false);
  results.push({
    name: 'actual stop click settles Host execution without replay',
    expected: false,
    actual: stopped.busy,
    status: 'passed',
  });
} catch (error) {
  results.push({
    name: 'live composer',
    actual: error instanceof Error ? error.message : String(error),
    status: 'failed',
  });
  process.exitCode = 1;
} finally {
  await browser.close();
  await saveTranscript('composer-requests');
  await writeFile(join(root, 'evidence/composer-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
}
