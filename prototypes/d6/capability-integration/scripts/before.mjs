import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import { launch, context, url, out } from './common.mjs';
const m = JSON.parse(await fs.readFile(new URL('../.runtime/manifest.json', import.meta.url), 'utf8'));
await fs.mkdir(new URL('before/', out), { recursive: true });
const b = await launch();
for (const w of [1440, 850, 390]) {
  const c = await context(b, w);
  const p = await c.newPage();
  for (const [name, route] of [
    ['skills', { page: 'skills', project: m.sourceProject }],
    ['suggestion', { page: 'result', target: { kind: 'suggestion', id: m.userSuggestionId } }],
  ]) {
    await p.goto(url(route));
    await p.locator('.aw h1').waitFor();
    await p.waitForTimeout(600);
    await p.screenshot({ path: new URL(`before/${name}-${w}.png`, out).pathname });
  }
  await c.close();
}
await b.close();
