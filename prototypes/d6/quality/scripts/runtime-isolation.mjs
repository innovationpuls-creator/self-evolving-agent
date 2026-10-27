import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { chromium } from 'playwright-core';

const output = new URL('../evidence/isolation/', import.meta.url);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const results = [];
try {
  for (const width of [1440, 850, 390])
    for (const surface of ['A-chat', 'A-reflection', 'B-reflection']) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        locale: 'zh-CN',
        timezoneId: 'America/Los_Angeles',
        reducedMotion: 'reduce',
        deviceScaleFactor: 1,
      });
      const p = await context.newPage();
      await p.goto(`http://127.0.0.1:4176/?route=${surface === 'B-reflection' ? 'studio' : 'quiet'}`);
      if (surface === 'B-reflection')
        await p
          .getByRole('navigation', { name: '工作空间', exact: true })
          .getByRole('button', { name: '认识', exact: true })
          .click();
      if (surface !== 'A-chat') {
        if (!(await p.locator('.sidebar').isVisible()))
          await p.getByRole('button', { name: '打开导航', exact: true }).click();
        await p
          .getByRole('navigation', { name: '主要模块', exact: true })
          .getByRole('button', { name: surface === 'A-reflection' ? '反思记录' : '反思', exact: true })
          .click();
      }
      await p.evaluate(() => document.fonts.ready);
      await p.mouse.move(width - 1, 999);
      await p.waitForTimeout(400);
      const before = await p.screenshot({
        path: new URL(`${surface}-${width}-before.png`, output).pathname,
        animations: 'disabled',
      });
      const q = await context.newPage();
      await q.goto('http://127.0.0.1:4187/?variant=original&seed=7919');
      await q.locator('.aw-journal-row').first().waitFor();
      assert.equal(await q.locator('.aw-journal-row').count(), 12);
      await q.close();
      await p.bringToFront();
      const after = await p.screenshot({
        path: new URL(`${surface}-${width}-after.png`, output).pathname,
        animations: 'disabled',
      });
      const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
      const result = {
        surface,
        width,
        before: hash(before),
        after: hash(after),
        status: hash(before) === hash(after) ? 'passed' : 'failed',
      };
      results.push(result);
      if (surface === 'A-reflection') assert.equal(await p.locator('.aw-journal-row').count(), 8);
      await context.close();
    }
} finally {
  await browser.close();
  await fs.writeFile(new URL('../evidence/runtime-isolation.json', import.meta.url), JSON.stringify(results, null, 2));
}
assert(results.every((r) => r.status === 'passed'));
console.log(`${results.length} protected runtime screenshots unchanged`);
