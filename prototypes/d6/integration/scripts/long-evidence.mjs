import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const out = new URL('../evidence/', import.meta.url),
  c = JSON.parse(await fs.readFile(new URL('../../host/.runtime/connection.json', import.meta.url), 'utf8')),
  s = JSON.parse(await fs.readFile(new URL('../../host/.runtime/scenario.json', import.meta.url), 'utf8'));
const file = `${s.otherProject}/long-evidence.md`;
const content = Array.from(
  { length: 180 },
  (_, i) =>
    `检查条目 ${String(i + 1).padStart(3, '0')}：这是用于验证来源证据分段读取的本地测试材料，记录本条目的范围、依据和核对结果。测试要求保留完整原始事实，不由前端制造操作成功，也不修改项目决策。`,
).join('\n');
await fs.writeFile(file, content);
const results = [],
  requests = [];
const clean = (v) =>
  JSON.parse(
    JSON.stringify(v).replaceAll(c.token, '<TOKEN>').replaceAll('/Users/torch/Documents/ChatGPT/agent', '<WORKSPACE>'),
  );
async function api(path, method = 'GET', body) {
  const r = await fetch(`${c.origin}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await r.json();
  requests.push(clean({ path, method, status: r.status, response: value }));
  assert.ok(r.ok);
  return value;
}
const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN',
    timezoneId: 'America/Los_Angeles',
    reducedMotion: 'reduce',
  });
await context.addInitScript((t) => sessionStorage.setItem('agent-connection-token', t), c.token);
await context.tracing.start({ screenshots: true, snapshots: true });
const page = await context.newPage();
try {
  const session = await api('/sessions', 'POST', {
    cwd: s.otherProject,
    provider: 'openai-codex',
    model: 'gpt-6-luna',
  });
  await page.goto(
    `${c.origin}/?${new URLSearchParams({ r: JSON.stringify({ page: 'session', sessionId: session.id }) })}`,
  );
  await page
    .getByLabel('发送给 Agent', { exact: true })
    .fill('请使用 read 完整读取 long-evidence.md，确认首末条目的编号即可，不要修改文件或保存记忆。');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await page.getByRole('button', { name: '停止当前执行', exact: true }).waitFor();
  let saved;
  const until = Date.now() + 180000;
  while (Date.now() < until) {
    saved = await api(`/sessions/${session.id}`);
    if (!saved.busy && saved.messages.some((m) => m.role === 'toolResult')) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(saved.busy, false);
  const entries = [];
  function visit(tree) {
    for (const n of tree || []) {
      if (n.entry.message?.role === 'toolResult' && n.entry.message.toolName === 'read') entries.push(n.entry);
      visit(n.children);
    }
  }
  visit(saved.tree);
  assert.ok(entries.length);
  const entry = entries.reduce((a, b) => (JSON.stringify(a).length > JSON.stringify(b).length ? a : b));
  const first = await api(
    `/diagnostics/evidence?${new URLSearchParams({ sessionId: session.id, entryId: entry.id, limit: '8192' })}`,
  );
  assert.ok(first.total > 8192);
  assert.ok(first.nextOffset);
  for (const width of [1440, 850, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(
      c.origin +
        '/?' +
        new URLSearchParams({
          r: JSON.stringify({
            page: 'source',
            reference: { sessionId: session.id, entryId: entry.id },
            project: s.otherProject,
            originSession: session.id,
          }),
        }),
    );
    await page.getByText('完整原始证据', { exact: true }).click();
    await page.locator('.diagnostics-evidence pre').waitFor();
    const text = await page.locator('.diagnostics-evidence pre').innerText();
    assert.equal(text, first.content);
    await page.getByRole('button', { name: '后一段证据', exact: true }).click();
    await page.waitForFunction(
      (before) => document.querySelector('.diagnostics-evidence pre')?.textContent !== before,
      text,
    );
    const second = await api(
      '/diagnostics/evidence?' +
        new URLSearchParams({
          sessionId: session.id,
          entryId: entry.id,
          limit: '8192',
          offset: String(first.nextOffset),
        }),
    );
    assert.equal(await page.locator('.diagnostics-evidence pre').innerText(), second.content);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: new URL(`after/long-evidence-${width}.png`, out).pathname });
    results.push({
      name: 'real read Tool evidence paging',
      width,
      status: 'passed',
      expected: 'actual 8192-character segments, nextOffset and no overflow',
      actual: {
        session: session.id,
        entry: entry.id,
        total: first.total,
        firstLength: text.length,
        secondLength: second.content.length,
      },
    });
  }
} catch (e) {
  results.push({ name: 'long evidence', status: 'failed', actual: e.message });
  process.exitCode = 1;
} finally {
  await context.tracing.stop({ path: new URL('long-evidence-trace.zip', out).pathname });
  await context.close();
  await browser.close();
  await fs.writeFile(new URL('long-evidence-results.json', out), JSON.stringify(clean(results), null, 2));
  await fs.writeFile(new URL('long-evidence-requests.json', out), JSON.stringify(clean(requests), null, 2));
}
