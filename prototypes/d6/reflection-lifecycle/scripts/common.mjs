import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';
export const out = new URL(
  process.env.D6_EVIDENCE_SUBDIR ? `../evidence/${process.env.D6_EVIDENCE_SUBDIR}/` : '../evidence/',
  import.meta.url,
);
for (const name of ['', 'after/', 'before/', 'videos/'])
  await fs.mkdir(new URL(name, out), { recursive: true, mode: 0o700 });
export const config = JSON.parse(
  await fs.readFile(
    process.env.D6_CONTROLLED
      ? new URL('../.runtime/controlled-connection.json', import.meta.url)
      : new URL('../../host/.runtime/connection.json', import.meta.url),
    'utf8',
  ),
);
export const requests = [],
  results = [];
export const clean = (value) =>
  JSON.parse(
    JSON.stringify(value)
      .replaceAll(config.token, '<TOKEN>')
      .replaceAll(config.key || '<NO_KEY>', '<KEY>')
      .replaceAll('/Users/torch', '<USER_HOME>'),
  );
export async function api(path, method = 'GET', body) {
  const res = await fetch(`${config.origin}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  requests.push(clean({ path, method, status: res.status, body, response: data }));
  return { status: res.status, data };
}
export const url = (route) => `${config.origin}/?${new URLSearchParams({ r: JSON.stringify(route) })}`;
export async function launch() {
  return chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
}
export async function context(browser, width, video = false) {
  const ctx = await browser.newContext({
    viewport: { width, height: 1000 },
    locale: 'zh-CN',
    timezoneId: 'America/Los_Angeles',
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
    ...(video ? { recordVideo: { dir: new URL('videos/', out).pathname, size: { width, height: 1000 } } } : {}),
  });
  await ctx.addInitScript((token) => sessionStorage.setItem('agent-connection-token', token), config.token);
  return ctx;
}
export function record(page, width) {
  page.on('response', async (res) => {
    if (!res.url().includes('/api/')) return;
    try {
      const path = new URL(res.url());
      let data = await res.json();
      if (path.pathname.endsWith('/models'))
        data = { models: data.models?.map((m) => ({ id: m.id, provider: m.provider })) };
      requests.push(
        clean({
          width,
          path: path.pathname + path.search,
          method: res.request().method(),
          status: res.status(),
          body: res.request().postDataJSON(),
          response: data,
        }),
      );
    } catch {}
  });
}
export async function shot(page, name, width) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: new URL(`after/${name}-${width}.png`, out).pathname });
}
export async function check(name, width, fn) {
  if (process.env.ONLY_CHECK && !name.includes(process.env.ONLY_CHECK)) return;
  try {
    const actual = await fn();
    results.push({ name, width, status: 'passed', actual: clean(actual ?? true) });
    console.log('PASS', width, name);
  } catch (e) {
    results.push({ name, width, status: 'failed', actual: e.stack });
    console.log('FAIL', width, name, e.message);
    process.exitCode = 1;
  }
}
export async function save(name) {
  await fs.writeFile(new URL(`${name}-results.json`, out), JSON.stringify(results, null, 2));
  await fs.writeFile(new URL(`${name}-requests.json`, out), JSON.stringify(clean(requests), null, 2));
}
