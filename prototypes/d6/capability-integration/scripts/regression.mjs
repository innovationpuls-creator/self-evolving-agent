import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { join } from 'node:path';
const out = new URL('../evidence/', import.meta.url);
const marker = JSON.parse(await fs.readFile(join(process.env.D6_RUN_ROOT, '.d6-run.json'), 'utf8'));
const references = join(marker.source, 'prototypes/d6/capability-integration/evidence/before');
const launch = () =>
  chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const browser = await launch(),
  results = [];
try {
  for (const width of [1440, 850, 390])
    for (const [route, name, selector] of [
      ['quiet', 'A', '.session-composer'],
      ['studio', 'B', '.conversation'],
    ]) {
      const ctx = await browser.newContext({
          viewport: { width, height: 1000 },
          locale: 'zh-CN',
          timezoneId: 'America/Los_Angeles',
          reducedMotion: 'reduce',
          deviceScaleFactor: 1,
        }),
        page = await ctx.newPage();
      await page.goto(`${process.env.D6_MOCK_ORIGIN ?? 'http://127.0.0.1:4176'}/?route=${route}`);
      await page.locator(selector).waitFor();
      await page.evaluate(() => document.fonts.ready);
      const png = await page.screenshot({ path: new URL(`after/${name}-${width}.png`, out).pathname }),
        before = await fs.readFile(join(references, `${name}-${width}.png`));
      results.push({
        name: `unchanged mock ${name}`,
        width,
        status: png.equals(before) ? 'passed' : 'failed',
        expected: 'identical PNG bytes',
        actual: png.equals(before),
      });
      await ctx.close();
    }
} finally {
  await browser.close();
}
const script = new URL('regression-workspace.mjs', import.meta.url),
  r = spawnSync(process.execPath, [fileURLToPath(script)], { encoding: 'utf8', timeout: 180000 });
results.push({
  name: 'original A workspace interaction assertions',
  status: r.status === 0 ? 'passed' : 'failed',
  stdout: r.stdout,
  stderr: r.stderr,
});
await fs.writeFile(new URL('regression-results.json', out), JSON.stringify(results, null, 2));
assert.ok(results.every((r) => r.status === 'passed'));
console.log('Mock A/B screenshot parity and workspace interactions passed');
