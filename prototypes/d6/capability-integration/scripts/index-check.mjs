import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launch, out } from './common.mjs';
const html = await fs.readFile(new URL('index.html', out), 'utf8');
let count = 0;
const missing = [];
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const target = match[1];
  if (target.startsWith('http')) continue;
  count++;
  try {
    await fs.access(new URL(target, out));
  } catch {
    missing.push(target);
  }
}
assert.deepEqual(missing, []);
const b = await launch(),
  p = await b.newPage({ viewport: { width: 850, height: 1000 } });
await p.goto(new URL('index.html', out).href);
await p.locator('[data-width="390"]').click();
assert.equal(await p.locator('[data-gallery="390"]').isVisible(), true);
const video = await p
  .locator('video')
  .first()
  .evaluate(async (v) => {
    if (v.readyState < 1) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
    return { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
  });
assert.ok(video.duration > 1);
assert.equal(video.width, 1440);
assert.equal(video.height, 1000);
await b.close();
await fs.writeFile(
  new URL('index-check.json', out),
  JSON.stringify({ mediaAndLinks: count, missing, tab390: true, completeChainVideo: video, passed: true }, null, 2),
);
console.log(JSON.stringify({ mediaAndLinks: count, missing, video }));
