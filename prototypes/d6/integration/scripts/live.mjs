import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';
const out = new URL('../evidence/', import.meta.url),
  config = JSON.parse(await fs.readFile(new URL('../../host/.runtime/connection.json', import.meta.url), 'utf8')),
  scenario = JSON.parse(await fs.readFile(new URL('../../host/.runtime/scenario.json', import.meta.url), 'utf8'));
const streamOnly = process.argv.includes('--stream-only');
const prior = streamOnly ? JSON.parse(await fs.readFile(new URL('live-results.json', out), 'utf8')) : [];
const results = [],
  requests = [],
  events = [];
const clean = (value) =>
  JSON.parse(
    JSON.stringify(value)
      .replaceAll(config.token, '<TOKEN>')
      .replaceAll('/Users/torch/Documents/ChatGPT/agent', '<WORKSPACE>'),
  );
async function api(path, method = 'GET', body) {
  const r = await fetch(`${config.origin}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await r.json();
  requests.push(clean({ path, method, status: r.status, response: value }));
  assert.ok(r.ok, `${path}: ${r.status}`);
  return value;
}
async function poll(read, done, timeout = 180000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await read();
    if (done(v)) return v;
    if (Date.now() > end) throw Error('Host condition timed out');
    await new Promise((r) => setTimeout(r, 400));
  }
}
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  for (const width of [1440, 850, 390]) {
    const session = streamOnly
      ? await api(`/sessions/${prior.find((r) => r.width === width && r.actual?.session).actual.session}`)
      : await api('/sessions', 'POST', { cwd: scenario.otherProject, provider: 'openai-codex', model: 'gpt-6-luna' });
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      locale: 'zh-CN',
      timezoneId: 'America/Los_Angeles',
      reducedMotion: 'reduce',
      recordVideo: { dir: new URL('videos/', out).pathname, size: { width, height: 1000 } },
    });
    await context.addInitScript((t) => sessionStorage.setItem('agent-connection-token', t), config.token);
    await context.tracing.start({ snapshots: true, screenshots: true, sources: false });
    const page = await context.newPage();
    let updates = 0;
    page.on('websocket', (ws) =>
      ws.on('framereceived', ({ payload }) => {
        try {
          const e = JSON.parse(String(payload));
          if (e.sessionId === session.id) {
            events.push({
              width,
              type: e.type,
              eventType: e.event?.type,
              version: e.stateVersion ?? e.state?.stateVersion,
            });
            if (e.event?.type === 'message_update') updates++;
          }
        } catch {}
      }),
    );
    page.on('response', async (r) => {
      if (!r.url().includes('/api/')) return;
      try {
        const data = await r.json();
        requests.push(
          clean({
            width,
            path: new URL(r.url()).pathname,
            method: r.request().method(),
            status: r.status(),
            response: data,
          }),
        );
      } catch {}
    });
    try {
      await page.goto(
        `${config.origin}/?${new URLSearchParams({ r: JSON.stringify({ page: 'session', sessionId: session.id }) })}`,
      );
      await page.getByLabel('发送给 Agent', { exact: true }).waitFor();
      if (!streamOnly) {
        await page
          .getByLabel('发送给 Agent', { exact: true })
          .fill(`这是一条真实会话连接验证。请只用中文回复一句“已收到”，不要调用工具。窗口编号 ${width}。`);
        await page.getByRole('button', { name: '发送任务', exact: true }).click();
        await page.getByRole('button', { name: '停止当前执行', exact: true }).waitFor();
        await poll(
          () => api(`/sessions/${session.id}`),
          (s) => !s.busy && s.messages?.some((m) => m.role === 'assistant'),
        );
        await page.getByRole('button', { name: '发送任务', exact: true }).waitFor();
        assert.equal(await page.getByLabel('发送给 Agent', { exact: true }).inputValue(), '');
        assert.ok(updates > 0, 'actual WebSocket message_update');
        assert.match(await page.locator('.session-message.assistant').last().innerText(), /已收到/);
        results.push({
          name: 'actual prompt, native streaming updates, saved response and accepted-draft clearing',
          width,
          status: 'passed',
          expected: 'native response and message_update',
          actual: { session: session.id, updates },
        });
        await page.screenshot({ path: new URL(`after/live-response-${width}.png`, out).pathname });
      }
      const before = updates;
      await page
        .getByLabel('发送给 Agent', { exact: true })
        .fill('请逐项写出 100 条软件测试的做法，每条至少两句话。直接开始，不要调用任何工具。');
      await page.getByRole('button', { name: '发送任务', exact: true }).click();
      await page.getByRole('button', { name: '停止当前执行', exact: true }).waitFor();
      await page.waitForFunction(() => {
        const e = document.querySelector('.host-stream');
        return e && e.textContent.replace(/^Agent/, '').trim().length > 12;
      });
      await page.screenshot({ path: new URL(`after/visible-stream-${width}.png`, out).pathname });
      await page.getByRole('button', { name: '停止当前执行', exact: true }).click();
      await page.getByRole('button', { name: '发送任务', exact: true }).waitFor();
      const stopped = await api(`/sessions/${session.id}`);
      assert.equal(stopped.busy, false);
      assert.ok(
        stopped.messages.some((m) => m.stopReason === 'aborted' || m.errorMessage?.includes('abort')),
        'native aborted outcome retained',
      );
      await page.getByLabel('发送给 Agent', { exact: true }).fill('停止后保留的草稿');
      await page.screenshot({ path: new URL(`after/stopped-${width}.png`, out).pathname });
      results.push({
        name: 'stop after actual partial text is visible',
        width,
        status: 'passed',
        expected: 'Host busy=false; native aborted outcome',
        actual: {
          busy: stopped.busy,
          updates: updates - before,
          stopReasons: stopped.messages.filter((m) => m.role === 'assistant').map((m) => m.stopReason),
        },
      });
    } catch (e) {
      results.push({ name: 'live composer sequence', width, status: 'failed', actual: e.message });
      process.exitCode = 1;
      await page.screenshot({ path: new URL(`after/live-failure-${width}.png`, out).pathname });
    } finally {
      await context.tracing.stop({
        path: new URL(`${streamOnly ? 'visible-stream' : 'live'}-trace-${width}.zip`, out).pathname,
      });
      const video = page.video();
      await context.close();
      if (video) {
        await video.saveAs(
          new URL(`videos/${streamOnly ? 'visible-stream' : 'live-session'}-${width}.webm`, out).pathname,
        );
        await video.delete();
      }
    }
    console.log(
      width,
      results.filter((r) => r.width === width).map((r) => r.status),
    );
  }
} finally {
  await browser.close();
  await fs.writeFile(
    new URL(streamOnly ? 'visible-stream-results.json' : 'live-results.json', out),
    JSON.stringify(clean(results), null, 2),
  );
  await fs.writeFile(
    new URL(streamOnly ? 'visible-stream-requests.json' : 'live-requests.json', out),
    JSON.stringify(clean(requests), null, 2),
  );
  await fs.writeFile(
    new URL(streamOnly ? 'visible-stream-events.json' : 'live-events.json', out),
    JSON.stringify(clean(events), null, 2),
  );
}
