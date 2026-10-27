import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import { launch, context, url, out } from './common.mjs';
const s = JSON.parse(await fs.readFile(new URL('../../host/.runtime/scenario.json', import.meta.url), 'utf8'));
const b = await launch();
for (const width of [1440, 850, 390]) {
  const c = await context(b, width),
    p = await c.newPage();
  await p.goto(url({ page: 'reflections', sessionId: s.source, offset: 0 }));
  await p.locator('[data-job]').first().waitFor();
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: new URL(`after/comparison-${width}.png`, out).pathname });
  await c.close();
}
await b.close();
