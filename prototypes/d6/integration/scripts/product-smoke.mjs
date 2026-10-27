import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';
const out = new URL('../evidence/', import.meta.url),
  c = JSON.parse(await fs.readFile(new URL('../../host/.runtime/connection.json', import.meta.url), 'utf8')),
  s = JSON.parse(await fs.readFile(new URL('../../host/.runtime/scenario.json', import.meta.url), 'utf8')),
  results = [];
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
      reducedMotion: 'reduce',
    });
    await context.addInitScript((t) => sessionStorage.setItem('agent-connection-token', t), c.token);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const test = async (name, fn) => {
      try {
        await fn();
        results.push({ name, width, status: 'passed' });
      } catch (e) {
        results.push({ name, width, status: 'failed', actual: e.message });
        process.exitCode = 1;
        console.log('FAIL', width, name, e.message);
      }
    };
    const navigate = async (name) => {
      if (!(await page.locator('.sidebar').isVisible()))
        await page.getByRole('button', { name: '打开导航', exact: true }).click();
      await page.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name, exact: true }).click();
    };
    await page.goto(
      `${c.origin}/?${new URLSearchParams({ r: JSON.stringify({ page: 'session', sessionId: s.source }) })}`,
    );
    await page.getByLabel('发送给 Agent', { exact: true }).waitFor();
    await test('real file picker, selected reference and draft preservation', async () => {
      await page.getByLabel('发送给 Agent', { exact: true }).fill('继续核对');
      await page.getByRole('button', { name: '引用项目文件', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'POLICY.md', exact: true }).click();
      await page.keyboard.press('Escape');
      assert.match(await page.locator('.session-references').innerText(), /POLICY.md/);
      assert.equal(await page.getByLabel('发送给 Agent', { exact: true }).inputValue(), '继续核对');
    });
    await test('real model selection and branch history are readable', async () => {
      await page.locator('.session-model').click();
      await page.getByRole('dialog').getByLabel('当前会话模型').waitFor();
      assert.equal(await page.getByRole('dialog').getByLabel('当前会话模型').inputValue(), 'openai-codex:gpt-6-luna');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '会话历史与分支', exact: true }).click();
      await page.getByLabel('历史位置').waitFor();
      assert.ok((await page.getByLabel('历史位置').locator('option').count()) > 3);
      await page.keyboard.press('Escape');
    });
    await test('actual trajectory inside A navigation returns to accepted composer', async () => {
      await page.getByRole('button', { name: '轨迹', exact: true }).click();
      await page.locator('.trajectory-group').first().waitFor();
      await page.screenshot({ path: new URL(`after/trajectory-${width}.png`, out).pathname });
      await page.getByRole('button', { name: '回到对话', exact: true }).click();
      await page.getByLabel('发送给 Agent', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('发送给 Agent', { exact: true }).inputValue(), '继续核对');
      assert.match(await page.locator('.session-references').innerText(), /POLICY.md/);
    });
    await test('real Memory catalog preserves filter, project, focus and scroll on detail return', async () => {
      await navigate('记忆');
      await page.locator('.aw-memory-row').first().waitFor();
      await page.getByRole('button', { name: '历史查询', exact: true }).click();
      await page.getByLabel('搜索记忆内容').fill('重试');
      await page.locator('.aw-memory-row').first().waitFor();
      const key = await page.locator('.aw-memory-row').first().getAttribute('data-focus');
      await page.locator('.aw-memory-row').first().click();
      await page.getByRole('heading', { name: '请求重试上限', exact: true }).waitFor();
      await page.getByRole('button', { name: '返回上一页', exact: true }).click();
      await page.locator('.aw-memory-row').first().waitFor();
      assert.equal(await page.getByLabel('搜索记忆内容').inputValue(), '重试');
      assert.equal(
        await page.getByRole('button', { name: '历史查询', exact: true }).getAttribute('aria-pressed'),
        'true',
      );
      assert.equal(await page.locator('.aw-scope-bar select').inputValue(), s.project);
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-focus')), key);
    });
    await test('real Skill and Evolution catalogs expose read scope without fake write actions', async () => {
      await navigate('技能与工具');
      await page.getByRole('heading', { name: '技能与工具', exact: true }).waitFor();
      await page.getByText('此处可阅读已管理技能与工具；导入、发布与开发授权尚未接入。', { exact: true }).waitFor();
      await navigate('改进建议');
      await page.getByRole('heading', { name: '改进建议', exact: true }).waitFor();
      await page.getByText('可以阅读已有建议与讨论。开发授权、成果生效与发布尚未接入。', { exact: true }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    });
    await context.close();
    console.log(
      width,
      results.filter((r) => r.width === width).map((r) => r.status),
    );
  }
} finally {
  await browser.close();
  await fs.writeFile(new URL('product-results.json', out), JSON.stringify(results, null, 2));
}
