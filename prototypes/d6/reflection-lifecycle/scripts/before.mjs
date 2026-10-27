import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import { launch, context, url, out } from './common.mjs';
const s = JSON.parse(await fs.readFile(new URL('../../host/.runtime/scenario.json', import.meta.url), 'utf8'));
const b = await launch();
for (const width of [1440, 850, 390]) {
  const ctx = await context(b, width),
    p = await ctx.newPage();
  for (const [name, address, selector] of [
    ['reflections', url({ page: 'reflections', sessionId: s.source, offset: 0 }), '[data-job]'],
    ['A', 'http://127.0.0.1:4176/?route=quiet', '.session-composer'],
    ['B', 'http://127.0.0.1:4176/?route=studio', '.conversation'],
  ]) {
    const dest = new URL(`before/${name}-${width}.png`, out);
    try {
      await fs.access(dest);
      continue;
    } catch {}
    await p.goto(address);
    await p.locator(selector).first().waitFor();
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: dest.pathname });
  }
  await ctx.close();
}
await b.close();
