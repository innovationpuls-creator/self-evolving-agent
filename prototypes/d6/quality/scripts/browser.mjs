import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createFixture, fixedNow } from '../src/fixtures.ts';

const base = process.env.QUALITY_URL || 'http://127.0.0.1:4187';
const output = new URL('../evidence/', import.meta.url);
await fs.mkdir(new URL('screenshots/', output), { recursive: true });
await fs.mkdir(new URL('videos/', output), { recursive: true });
await fs.mkdir(new URL('traces/', output), { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const results = [],
  errors = [],
  captures = [],
  metrics = [];
let current;
const fixture = createFixture();
const variants = ['original', 'journal', 'grouped'];
const labels = { original: '当前版本', journal: '日期日志', grouped: '完成情况分区' };
const rowSelector = (variant) => (variant === 'original' ? '.aw-journal-row' : '.q-row');
const rowFor = (page, variant, id) =>
  page.locator(`${rowSelector(variant)}[${variant === 'original' ? 'data-aw-key' : 'data-q-id'}="${id}"]`);
async function record(key, expected, read, verify, knownDefect = false) {
  const item = {
    ...current,
    key,
    expected,
    knownDefect,
    evidence: {
      trace:
        current.scenario === 'mixed'
          ? `traces/${current.variant}-${current.width}.zip`
          : `traces/${current.variant}-states.zip`,
      ...(current.scenario === 'mixed' && current.width === 1440
        ? { video: `videos/${current.variant}-journey-1440.webm` }
        : {}),
    },
  };
  try {
    item.actual = await read();
    verify(item.actual);
    item.status = 'passed';
  } catch (error) {
    item.status = 'failed';
    item.error = String(error);
  }
  results.push(item);
  return item.status === 'passed';
}
async function contextFor(width, video = false) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    timezoneId: 'America/Los_Angeles',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    ...(video ? { recordVideo: { dir: new URL('videos/', output).pathname, size: { width, height: 1000 } } } : {}),
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  page.on('pageerror', (e) => errors.push({ ...current, error: String(e) }));
  return { context, page };
}
async function go(page, variant, scenario = 'mixed', seed = 25) {
  await page.goto(`${base}/?variant=${variant}&scenario=${scenario}&seed=${seed}`);
  await page.evaluate(() => document.fonts.ready);
}
async function shot(page, name) {
  await page.mouse.move(current.width - 1, 999);
  await page.screenshot({ path: new URL(`screenshots/${name}.png`, output).pathname, animations: 'disabled' });
  captures.push({ ...current, name, file: `screenshots/${name}.png` });
  const geometry = await page.evaluate(() => ({
    width: innerWidth,
    overflow: document.documentElement.scrollWidth > innerWidth,
    dialogs: [...document.querySelectorAll('[role="dialog"]')].filter(
      (e) => e.getBoundingClientRect().width > innerWidth,
    ).length,
  }));
  await record(
    `geometry:${name}`,
    'no horizontal overflow or oversized dialog',
    () => geometry,
    (g) => {
      assert.equal(g.overflow, false);
      assert.equal(g.dialogs, 0);
    },
  );
}
async function source(page) {
  await page.getByRole('button', { name: '查看证据与原始记录', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '查看来源片段', exact: true }).first().click();
}
async function back(page) {
  await page.getByRole('button', { name: '所有反思记录', exact: true }).click();
}

try {
  for (const width of [1440, 850, 390])
    for (const variant of variants) {
      current = { variant, width, scenario: 'mixed' };
      const { context, page } = await contextFor(width, width === 1440);
      try {
        await go(page, variant);
        await page.locator(rowSelector(variant)).last().waitFor();
        await record(
          'shared-data',
          '12 records from seed 25',
          () => page.locator(rowSelector(variant)).count(),
          (n) => assert.equal(n, 12),
        );
        await record(
          'no-eager-details',
          'zero detail reads before opening a record',
          () => page.evaluate(() => window.reflectionQuality.calls.filter((c) => c.operation === 'detail').length),
          (n) => assert.equal(n, 0),
        );
        await record(
          'normal-state-not-repeated',
          'no per-record completed label',
          () => page.locator(rowSelector(variant)).allInnerTexts(),
          (rows) => assert(!rows.some((t) => t.includes('检查已完成'))),
          variant === 'original',
        );
        await record(
          'no-detail-counts-in-summary-list',
          'no change or uncertainty counts sourced from details',
          () => page.locator(rowSelector(variant)).allInnerTexts(),
          (rows) => assert(!rows.some((t) => /已保存 \d+ 项变更|\d+ 项待核实/.test(t))),
          variant === 'original',
        );
        for (const status of ['pending', 'running', 'waiting_user', 'succeeded', 'failed', 'interrupted']) {
          const d = fixture.details.find((v) => v.job.status === status);
          await record(
            `state:${status}`,
            'corresponding Host job remains present',
            () => rowFor(page, variant, d.job.id).count(),
            (n) => assert.equal(n, 1),
          );
        }
        metrics.push({
          ...current,
          rows: await page.locator(rowSelector(variant)).evaluateAll((rows) =>
            rows.map((e) => ({
              id: e.dataset.qId || e.dataset.awKey,
              height: e.getBoundingClientRect().height,
              top: e.getBoundingClientRect().top,
            })),
          ),
        });
        await shot(page, `${variant}-list-${width}`);
        const failed = fixture.details.find((d) => d.job.status === 'failed');
        const target = rowFor(page, variant, failed.job.id);
        await target.scrollIntoViewIfNeeded();
        await page.waitForTimeout(width === 1440 ? 650 : 100);
        await target.click();
        await page.getByRole('heading', { name: '已保存的变更', exact: true }).waitFor();
        await record(
          'failed-retains-committed-effects',
          'failure reason and previously saved change remain readable',
          () => page.locator('.aw').innerText(),
          (t) => {
            assert(t.includes(failed.job.error));
            assert(t.includes(failed.record.changes[0].summary));
          },
        );
        await shot(page, `${variant}-detail-${width}`);
        await page.waitForTimeout(width === 1440 ? 650 : 100);
        await source(page);
        await page
          .getByRole('dialog')
          .last()
          .getByText(/已读取检查清单/)
          .first()
          .waitFor();
        await record(
          'source-identity-and-text',
          'source content and branch/checkpoint identity are visible',
          () => page.getByRole('dialog').last().innerText(),
          (t) => {
            assert(t.includes('当前选中分支'));
            assert(t.includes('保存的检查点'));
            assert(t.includes('其余项目未运行'));
          },
        );
        await shot(page, `${variant}-source-${width}`);
        await page.waitForTimeout(width === 1440 ? 900 : 100);
        await page.keyboard.press('Escape');
        await record(
          'nested-source-focus-return',
          'focus returns to source trigger',
          () => page.evaluate(() => document.activeElement?.textContent),
          (t) => assert(t.includes('查看来源片段')),
        );
        await page.keyboard.press('Escape');
        await back(page);
        await record(
          'return-list-focus',
          'focus returns to the opened record',
          () =>
            page.evaluate(
              () =>
                document.activeElement?.getAttribute('data-q-id') ||
                document.activeElement?.getAttribute('data-aw-key'),
            ),
          (v) => assert.equal(v, failed.job.id),
        );
        await record(
          'return-list-position',
          'opened record stays in the visible scroll area',
          () => rowFor(page, variant, failed.job.id).boundingBox(),
          (box) => {
            assert(box.y >= 0);
            assert(box.y < 1000);
          },
        );
        await page.waitForTimeout(width === 1440 ? 650 : 100);
        await page.getByLabel('筛选来源会话', { exact: true }).selectOption(failed.job.sessionId);
        await page.waitForFunction(
          (selector) => document.querySelectorAll(selector).length === 1,
          rowSelector(variant),
        );
        await record(
          'session-filter',
          'only the selected session remains',
          () => page.locator(rowSelector(variant)).count(),
          (n) => assert.equal(n, 1),
        );
        await page.getByLabel('筛选来源会话', { exact: true }).selectOption('all');
        await page.waitForFunction(
          (selector) => document.querySelectorAll(selector).length === 12,
          rowSelector(variant),
        );
        const uncertain = fixture.details.find((d) => d.record?.uncertainties.length);
        await rowFor(page, variant, uncertain.job.id).click();
        await page.getByRole('heading', { name: '仍待核实', exact: true }).waitFor();
        await record(
          'uncertainty-preserved-in-detail',
          'the full uncertainty is visible',
          () => page.locator('.aw').innerText(),
          (t) => assert(t.includes(uncertain.record.uncertainties[0])),
        );
        await back(page);
        if (variant !== 'original') {
          await record(
            'different-organization',
            variant === 'grouped' ? 'two completion groups' : 'date groups',
            () => page.locator('.q-group > h2').allInnerTexts(),
            (titles) =>
              assert(
                variant === 'grouped' ? titles.join('|') === '未完成|已完成' : titles.every((t) => t.includes('月')),
              ),
          );
          await record(
            'responsive-topology',
            variant === 'grouped' && width === 1440 ? 'parallel groups' : 'stacked groups',
            () =>
              page
                .locator('.q-group')
                .evaluateAll((groups) =>
                  groups.map((e) => ({ x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y })),
                ),
            (g) =>
              assert(
                variant === 'grouped' && width === 1440
                  ? g[0].x !== g[1].x && Math.abs(g[0].y - g[1].y) < 2
                  : g[0].y < g[1].y,
              ),
          );
        }
      } catch (error) {
        results.push({ ...current, key: 'journey', status: 'failed', knownDefect: false, error: String(error) });
        await shot(page, `${variant}-unexpected-${width}`);
      } finally {
        await context.tracing.stop({ path: new URL(`traces/${variant}-${width}.zip`, output).pathname });
        const video = page.video();
        await context.close();
        if (video) {
          await video.saveAs(new URL(`videos/${variant}-journey-1440.webm`, output).pathname);
          await video.delete();
        }
      }
      console.log(`${variant} ${width}px journey complete`);
    }

  for (const variant of variants) {
    const { context, page } = await contextFor(1440);
    for (const scenario of [
      'empty',
      'loading',
      'list-error',
      'detail-error',
      'environment-unchecked',
      'environment-unavailable',
      'source-missing',
      'source-truncated',
      'source-old-branch',
      'source-previous',
      'source-denied',
      'metadata-missing',
      'pagination',
    ]) {
      current = { variant, width: 1440, scenario };
      try {
        await go(page, variant, scenario, 7919);
        const rows = page.locator(rowSelector(variant));
        if (scenario === 'empty')
          await record(
            'empty',
            'explicit empty state',
            async () => {
              await page.getByText('还没有任务检查记录', { exact: true }).waitFor();
              return rows.count();
            },
            (n) => assert.equal(n, 0),
          );
        else if (scenario === 'loading') {
          await record(
            'loading',
            'loading is visible before data',
            () => page.getByRole('status').innerText(),
            (t) => assert(t.includes('正在读取')),
          );
          await shot(page, `${variant}-${scenario}`);
          await rows.first().waitFor();
        } else if (scenario === 'list-error') {
          const retry = page.getByRole('button', {
            name: variant === 'original' ? '重新读取' : '重新读取列表',
            exact: true,
          });
          await retry.waitFor();
          await shot(page, `${variant}-${scenario}`);
          await retry.click();
          await rows.first().waitFor();
          await record(
            'list-read-recovery',
            'retry reads data and never executes a job',
            () => rows.count(),
            (n) => assert.equal(n, 12),
          );
        } else {
          await rows.first().waitFor();
          if (scenario.startsWith('environment-'))
            await record(
              'environment-boundary',
              'environment reason visible',
              () => page.locator('.aw').innerText(),
              (t) =>
                assert(t.includes(scenario === 'environment-unchecked' ? '尚未检查反思环境' : '不能在普通环境执行')),
              variant === 'original',
            );
          else if (scenario === 'metadata-missing')
            await record(
              'missing-metadata',
              'fallback identifies missing title/project',
              () => rows.first().innerText(),
              (t) => assert(t.includes('任务检查记录') && t.includes('项目未返回')),
              variant === 'original',
            );
          else if (scenario === 'pagination') {
            let button = page.getByRole('button', { name: /显示更早的记录/ });
            while (await button.count()) {
              await button.click();
              await page.waitForTimeout(180);
              button = page.getByRole('button', { name: /显示更早的记录/ });
            }
            await record(
              'pagination-all-records',
              '47 unique records across pages',
              () => rows.evaluateAll((list) => list.map((e) => e.dataset.qId || e.dataset.awKey)),
              (ids) => {
                assert.equal(ids.length, 47);
                assert.equal(new Set(ids).size, 47);
              },
            );
          } else {
            const f = createFixture({ seed: 7919, scenario });
            const d = f.details.find((v) => v.job.status === 'failed');
            await rowFor(page, variant, d.job.id).click();
            if (scenario === 'detail-error') {
              if (variant === 'original')
                await record(
                  'detail-read-recovery',
                  'independent detail-read error and retry',
                  () => page.getByRole('button', { name: '重新读取详情', exact: true }).count(),
                  (n) => assert.equal(n, 1),
                  true,
                );
              else {
                const retry = page.getByRole('button', { name: '重新读取详情', exact: true });
                await retry.waitFor();
                await shot(page, `${variant}-${scenario}`);
                await retry.click();
                await page.getByRole('heading', { name: '已保存的变更', exact: true }).waitFor();
                await record(
                  'detail-read-recovery',
                  'detail retry preserves saved results',
                  () => page.locator('.aw').innerText(),
                  (t) => assert(t.includes(d.record.changes[0].summary)),
                );
              }
            } else {
              await page.getByRole('button', { name: '查看证据与原始记录', exact: true }).waitFor();
              await source(page);
              const expected = {
                'source-missing': '保存的检查点中未找到这条引用',
                'source-truncated': '来源仅返回部分内容',
                'source-old-branch': '不在当前选中分支',
                'source-previous': '上一检查点',
                'source-denied': '来源不受信任',
              }[scenario];
              if (!(scenario === 'source-denied' && variant === 'original'))
                await page.getByRole('dialog').last().getByText(expected, { exact: false }).first().waitFor();
              await record(
                scenario,
                expected,
                () => page.getByRole('dialog').last().innerText(),
                (t) => assert(t.includes(expected)),
                scenario === 'source-denied' && variant === 'original',
              );
            }
          }
        }
        if (!['loading', 'list-error', 'detail-error'].includes(scenario)) await shot(page, `${variant}-${scenario}`);
      } catch (error) {
        results.push({ ...current, key: 'scenario-flow', status: 'failed', knownDefect: false, error: String(error) });
        await shot(page, `${variant}-${scenario}-unexpected`);
      }
    }
    await context.tracing.stop({ path: new URL(`traces/${variant}-states.zip`, output).pathname });
    await context.close();
  }
} finally {
  await browser.close();
  const unexpected = results.filter((r) => r.status === 'failed' && !r.knownDefect);
  const report = {
    generated: new Date().toISOString(),
    fixtureTime: new Date(fixedNow).toISOString(),
    seed: [25, 7919],
    environment: {
      browser: 'Chrome via playwright-core',
      viewportHeight: 1000,
      widths: [1440, 850, 390],
      locale: 'zh-CN',
      timezoneId: 'America/Los_Angeles',
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    },
    summary: {
      passed: results.filter((r) => r.status === 'passed').length,
      failed: results.filter((r) => r.status === 'failed').length,
      knownDefects: results.filter((r) => r.status === 'failed' && r.knownDefect).length,
      unexpected: unexpected.length,
      pageErrors: errors.length,
    },
    results,
    errors,
    captures,
    metrics,
  };
  await fs.writeFile(new URL('browser-results.json', output), JSON.stringify(report, null, 2));
  const blocks = ['list', 'detail', 'source']
    .flatMap((view) =>
      [1440, 850, 390].map(
        (width) =>
          `<h2>${view} · ${width}px</h2><div class="compare">${variants.map((v) => `<figure><figcaption>${labels[v]}</figcaption><a href="screenshots/${v}-${view}-${width}.png"><img src="screenshots/${v}-${view}-${width}.png" alt="${labels[v]} ${view} ${width}px" loading="lazy"></a></figure>`).join('')}</div>`,
      ),
    )
    .join('');
  await fs.writeFile(
    new URL('comparison.html', output),
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>反思记录对照</title><style>body{font:15px/1.7 system-ui;color:#242923;margin:30px}h1{font-size:24px}h2{margin-top:45px;font-size:18px}a{color:#455c45}.compare{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}figure{margin:0}img,video{width:100%;border:1px solid #e5e8e1}figcaption{margin-bottom:8px}@media(max-width:850px){.compare{grid-template-columns:1fr}}</style><h1>反思记录 · 同条件对照</h1><p>待独立设计验收。截图是评审证据，不是批准基线。</p><p><a href="../">交互入口</a> · <a href="browser-results.json">逐项断言结果</a></p>${blocks}<h2>连续任务操作 · 1440px</h2><div class="compare">${variants.map((v) => `<figure><figcaption>${labels[v]}</figcaption><video controls preload="metadata" src="videos/${v}-journey-1440.webm"></video></figure>`).join('')}</div><h2>状态证据</h2><ul>${captures
      .filter((c) => c.scenario !== 'mixed')
      .map((c) => `<li><a href="${c.file}">${labels[c.variant]} · ${c.scenario}</a></li>`)
      .join('')}</ul></html>`,
  );
  console.log(JSON.stringify(report.summary));
  if (unexpected.length || errors.length) process.exitCode = 1;
}
