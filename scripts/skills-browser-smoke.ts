import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { startHost } from '../apps/host/server.js';
import { skillPackage, bindings } from '../tests/fixtures/skills-package.js';
const root = await mkdtemp(join(tmpdir(), 'skills-browser-')),
  token = randomBytes(32).toString('hex');
const host = await startHost({ dataDir: join(root, 'data'), key: randomBytes(32), token, webDir: resolve('dist/web') });
const fake = fauxProvider({ models: [{ id: 'browser-model', contextWindow: 100000, maxTokens: 512 }] });
host.service.runtime.registerNativeProvider(fake.provider);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
async function open(page: Page, id: string) {
  await page.goto(`${host.origin}/#token=${token}`);
  await page.getByRole('button', { name: '能力管理', exact: true }).click();
  await page
    .locator('.skill-item')
    .filter({ hasText: host.service.skills.record(id).name })
    .click();
  await page.getByRole('button', { name: '查看说明', exact: true }).first().click();
}
try {
  const pkg = await skillPackage(join(root, 'pkg'));
  const [skill] = await host.service.skills.import({ source: pkg, bindings });
  assert.ok(skill);
  const a = await browser.newPage({ viewport: { width: 1240, height: 850 } }),
    b = await browser.newPage();
  await open(a, skill.id);
  await open(b, skill.id);
  // An untouched but stale buffer must not borrow a newer authoritative revision.
  const editorA = a.getByLabel('Skill 内容'),
    editorB = b.getByLabel('Skill 内容');
  const initial = await editorA.inputValue();
  await editorB.fill(initial + '\nB change.');
  await b.getByRole('button', { name: '保存修改为候选', exact: true }).click();
  await b.getByRole('status').filter({ hasText: '候选已保存' }).waitFor();
  await a.waitForTimeout(150);
  await editorA.fill(initial + '\nA stale overwrite.');
  await a.getByRole('button', { name: '保存修改为候选', exact: true }).click();
  await a.getByRole('alert').filter({ hasText: '其他窗口修改' }).waitFor();
  a.once('dialog', (dialog) => dialog.dismiss());
  await a.getByRole('button', { name: '返回对话', exact: true }).click();
  assert.equal(await a.getByLabel('Skill 内容').inputValue(), initial + '\nA stale overwrite.');
  a.once('dialog', (dialog) => dialog.accept());
  await a.getByRole('button', { name: '返回对话', exact: true }).click();
  await a.locator('.skill-panel').waitFor({ state: 'detached' });
  // Reviewing V1 does not prefill the approval of changed V2 bytes.
  await b.getByText('代码、依赖与执行信任', { exact: true }).click();
  for (const checkbox of await b.locator('fieldset input').all()) await checkbox.check();
  await b
    .getByLabel('审查结论')
    .fill('Reviewed fixture code and host aliases, no external dependencies or filesystem effects.');
  assert.equal(await b.getByRole('button', { name: '批准此精确版本' }).isEnabled(), true);
  await editorB.fill(initial + '\nV2 change.');
  await b.getByRole('button', { name: '保存修改为候选', exact: true }).click();
  await b.waitForFunction(() =>
    Array.from(document.querySelectorAll('fieldset input')).every((i) => !(i as HTMLInputElement).checked),
  );
  assert.equal(await b.getByRole('button', { name: '批准此精确版本' }).isEnabled(), false);
  // Ordinary import is asynchronous and observable through the shared WebSocket.
  const plain = join(root, 'plain');
  await mkdir(plain);
  await writeFile(
    join(plain, 'SKILL.md'),
    '---\nname: browser-plain\ndescription: Browser ordinary Skill.\n---\nUse native read.',
  );
  await a.getByRole('button', { name: '能力管理', exact: true }).click();
  await a.getByText('添加 Skill', { exact: true }).click();
  await a.getByLabel('Skill 来源', { exact: true }).fill(plain);
  await a.getByRole('button', { name: '保存候选', exact: true }).click();
  await a.locator('.skill-item').filter({ hasText: 'browser-plain' }).waitFor();
  await b.locator('.skill-item').filter({ hasText: 'browser-plain' }).waitFor();
  await a.locator('.skill-item').filter({ hasText: 'browser-plain' }).click();
  await a.getByRole('button', { name: '检查并生效', exact: true }).click();
  await a.locator('[data-operation-status="applied"]').filter({ hasText: '已生效' }).waitFor();
  await a.getByRole('button', { name: '禁用', exact: true }).click();
  await a.getByRole('button', { name: '启用', exact: true }).waitFor();
  await a.reload();
  await a.getByRole('button', { name: '能力管理', exact: true }).click();
  await a.locator('.skill-item').filter({ hasText: 'browser-plain' }).click();
  await a.getByRole('button', { name: '启用', exact: true }).waitFor();
  await mkdir(resolve('release/d2-evidence'), { recursive: true });
  await a.screenshot({ path: resolve('release/d2-evidence/skills-browser.png'), fullPage: true });
  console.log(
    JSON.stringify({
      result: 'passed',
      twoClientConflict: true,
      cleanStaleBufferConflict: true,
      unsavedExitGuard: true,
      exactReviewReset: true,
      asyncImportWebSocket: true,
      reconnectAuthoritativeState: true,
      ordinaryPublishDisable: true,
    }),
  );
} finally {
  await browser.close();
  await host.close();
  await rm(root, { recursive: true, force: true });
}
