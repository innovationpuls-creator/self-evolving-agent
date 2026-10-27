import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, out } from './common.mjs';
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
      await page.goto(`http://127.0.0.1:4176/?route=${route}`);
      await page.locator(selector).waitFor();
      await page.evaluate(() => document.fonts.ready);
      const png = await page.screenshot({ path: new URL(`after/${name}-${width}.png`, out).pathname }),
        before = await fs.readFile(new URL(`before/${name}-${width}.png`, out));
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
