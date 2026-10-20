import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { startHost } from '../apps/host/transport/server.js';

const root = await mkdtemp(join(tmpdir(), 'memory-browser-'));
const token = randomBytes(32).toString('hex');
const host = await startHost({ dataDir: join(root, 'data'), key: randomBytes(32), token, webDir: resolve('dist/web') });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1240, height: 850 } });
  await page.goto(`${host.origin}/#token=${token}`);
  await page.getByRole('button', { name: '记忆管理', exact: true }).click();
  await page.getByRole('button', { name: '新建记忆', exact: true }).click();
  await page.getByLabel('记忆标题').fill('browser-memory');
  await page.getByLabel('知识内容', { exact: true }).fill('Original browser knowledge');
  await page.getByLabel('修改依据', { exact: true }).fill('User observation');
  await page.getByRole('button', { name: '保存认识', exact: true }).click();
  const edit = page.getByRole('button', { name: '编辑与调整作用域', exact: true });
  await edit.waitFor();
  await edit.click();
  await page.getByLabel('知识内容', { exact: true }).fill('Updated browser knowledge');
  await page.getByLabel('修改依据', { exact: true }).fill('New evidence');
  let release: (() => void) | undefined;
  const held = new Promise<void>((ok) => {
    release = ok;
  });
  let committed: (() => void) | undefined;
  const ready = new Promise<void>((ok) => {
    committed = ok;
  });
  await page.route('**/api/memory/*/revise?*', async (route) => {
    const response = await route.fetch();
    committed?.();
    await held;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: '保存认识', exact: true }).click();
  await ready;
  // Let the commit's WS refresh finish before releasing the delayed POST response.
  await page.waitForTimeout(250);
  assert.equal(await page.getByLabel('知识内容', { exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel('搜索记忆', { exact: true }).isDisabled(), true);
  assert.equal(await page.locator('.memory-item').first().isDisabled(), true);
  release?.();
  await edit.waitFor();
  await page.unroute('**/api/memory/*/revise?*');
  const ctx = await host.service.memoryUserContext(root);
  let current = host.service.memory.search(ctx).items[0];
  assert.ok(current);
  // A remotely narrowed scope clears stale non-editing detail.
  host.service.memory.revise(ctx, current.id, {
    baseRevision: current.revision,
    content: { title: current.title, content: current.content, scope: 'project', kind: current.kind },
    reason: 'Project-specific evidence',
  });
  await page.locator('.memory-detail h2').waitFor({ state: 'detached' });
  assert.equal(await edit.count(), 0);
  current = host.service.memory.get(ctx, current.id, true).current;
  host.service.memory.revise(ctx, current.id, {
    baseRevision: current.revision,
    content: { title: current.title, content: current.content, scope: 'global', kind: current.kind },
    reason: 'General evidence',
  });
  await page.locator('.memory-item').first().click();
  await edit.click();
  await page.getByLabel('知识内容', { exact: true }).fill('Preserved draft after access loss');
  current = host.service.memory.get(ctx, current.id, true).current;
  host.service.memory.revise(ctx, current.id, {
    baseRevision: current.revision,
    content: { title: current.title, content: current.content, scope: 'project', kind: current.kind },
    reason: 'Narrowed again',
  });
  await page.getByRole('status').filter({ hasText: '已移出当前作用域' }).waitFor();
  assert.equal(await page.getByLabel('知识内容', { exact: true }).inputValue(), 'Preserved draft after access loss');
  assert.equal(await page.getByRole('button', { name: '保存认识', exact: true }).isDisabled(), true);
  current = host.service.memory.get(ctx, current.id, true).current;
  host.service.memory.revise(ctx, current.id, {
    baseRevision: current.revision,
    content: { title: current.title, content: current.content, scope: 'global', kind: current.kind },
    reason: 'Restored access',
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '重新读取最新版本', exact: true }).click();
  await edit.waitFor();
  await edit.click();
  await page.getByLabel('修改依据', { exact: true }).fill('Access restored');
  assert.equal(await page.getByRole('button', { name: '保存认识', exact: true }).isEnabled(), true);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '记忆管理', exact: true }).click();
  await page.locator('.memory-item').first().click();
  await edit.waitFor();
  console.log(
    JSON.stringify({
      result: 'passed',
      uiCreate: true,
      delayedMutationFreeze: true,
      scopeLossClearsDetail: true,
      accessLossPreservesDraft: true,
      accessRecovery: true,
      authoritativeReload: true,
    }),
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await Promise.race([browser.close(), new Promise<void>((done) => setTimeout(done, 5000).unref())]);
  await host.close();
  await rm(root, { recursive: true, force: true });
}
