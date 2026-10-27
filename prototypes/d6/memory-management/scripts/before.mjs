import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import { launch, context, url, out } from './common.mjs';
const s = JSON.parse(await fs.readFile(new URL('../../host/.runtime/scenario.json', import.meta.url), 'utf8'));
const browser = await launch();
for (const width of [1440, 850, 390]) {
  const ctx = await context(browser, width);
  const page = await ctx.newPage();
  for (const [name, address, selector] of [
    ['memory', url({ page: 'memory', project: s.project }), 'h1'],
    ['A', 'http://127.0.0.1:4176/?route=quiet', '.session-composer'],
    ['B', 'http://127.0.0.1:4176/?route=studio', '.conversation'],
  ]) {
    const path = new URL(`before/${name}-${width}.png`, out);
    try {
      await fs.access(path);
      throw Error('before exists');
    } catch (e) {
      if (e.message === 'before exists') throw e;
    }
    await page.goto(address);
    await page.locator(selector).first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    if (name === 'memory') await page.locator('.aw-memory-row').first().waitFor();
    await page.screenshot({ path: path.pathname });
  }
  await ctx.close();
}
await browser.close();
