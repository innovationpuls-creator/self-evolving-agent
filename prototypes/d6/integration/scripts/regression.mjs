import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const out = new URL('../evidence/', import.meta.url),
  results = [];
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  for (const width of [1440, 850, 390])
    for (const [mode, name, selector] of [
      ['quiet', 'd6-session', '.session-composer textarea'],
      ['studio', 'B', '.conversation'],
    ]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        locale: 'zh-CN',
        timezoneId: 'America/Los_Angeles',
        reducedMotion: 'reduce',
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:4176/?route=${mode}`);
      await page.locator(selector).waitFor();
      await page.evaluate(() => document.fonts.ready);
      const shot = await page.screenshot({ path: new URL(`after/${name}-${width}.png`, out).pathname });
      const before = await fs.readFile(new URL(`before/${name}-${width}.png`, out));
      results.push({
        name: `original mock ${name}`,
        width,
        status: shot.equals(before) ? 'passed' : 'changed',
        expected: 'same PNG bytes under identical browser conditions',
        actual: { identicalPNG: shot.equals(before) },
      });
      await context.close();
    }
} finally {
  await browser.close();
}
// Run original accepted assertions against the independently retained demo, with evidence redirected.
for (const [name, dest] of [
  ['a-product-states.mjs', 'evidence/a-product-20261023'],
  ['workspace-browser.mjs', 'evidence/a-workspace-20261024'],
]) {
  const source = await fs.readFile(new URL(`../../scripts/${name}`, import.meta.url), 'utf8'),
    directory = new URL(`regression-${name.replace('.mjs', '')}/`, out);
  await fs.mkdir(new URL('after/', directory), { recursive: true });
  const script = source
    .replaceAll('http://127.0.0.1:4186/', 'http://127.0.0.1:4176/')
    .replaceAll(dest, fileURLToPath(directory).replace(/\/$/, ''));
  const temporary = new URL(`./.regression-${name}`, import.meta.url);
  await fs.writeFile(temporary, script);
  try {
    const r = spawnSync(process.execPath, [fileURLToPath(temporary)], { encoding: 'utf8', timeout: 180000 });
    results.push({
      name,
      adaptation: 'only server port and evidence output; assertions unchanged',
      status: r.status === 0 ? 'passed' : 'failed',
      exitCode: r.status,
      stdout: r.stdout,
      stderr: r.stderr,
    });
    console.log(name, r.status);
  } finally {
    await fs.rm(temporary);
  }
}
await fs.writeFile(new URL('regression-results.json', out), JSON.stringify(results, null, 2));
console.log(results.map((r) => [r.name, r.width, r.status]));
