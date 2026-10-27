import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
const out = new URL('../evidence/before/', import.meta.url);
const connection = JSON.parse(
  await fs.readFile(new URL('../../host/.runtime/connection.json', import.meta.url), 'utf8'),
);
const scenario = JSON.parse(await fs.readFile(new URL('../../host/.runtime/scenario.json', import.meta.url), 'utf8'));
// This snapshot describes the pre-integration checkout; never overwrite it on a rerun.
try {
  await fs.access(new URL('d6-session-1440.png', out));
  console.log('Pre-integration captures already preserved.');
  process.exit(0);
} catch {}
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  for (const width of [1440, 850, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      locale: 'zh-CN',
      timezoneId: 'America/Los_Angeles',
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4176/?route=quiet');
    await page.locator('.session-composer textarea').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: new URL(`d6-session-${width}.png`, out).pathname });
    const studio = await context.newPage();
    await studio.goto('http://127.0.0.1:4176/?route=studio');
    await studio.locator('.conversation').waitFor();
    await studio.evaluate(() => document.fonts.ready);
    await studio.screenshot({ path: new URL(`B-${width}.png`, out).pathname });
    await context.addInitScript((t) => sessionStorage.setItem('agent-connection-token', t), connection.token);
    await page.goto(
      connection.origin +
        '/?' +
        new URLSearchParams({ r: JSON.stringify({ page: 'session', sessionId: scenario.source }) }),
    );
    await page.locator('.live-composer textarea').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: new URL(`reference-session-${width}.png`, out).pathname });
    await page.getByRole('button', { name: '反思记录', exact: true }).last().click();
    await page.locator('[data-job]').first().waitFor();
    await page.screenshot({ path: new URL(`reference-reflections-${width}.png`, out).pathname });
    await context.close();
  }
} finally {
  await browser.close();
}
console.log('Current A, B and reference screenshots saved.');
