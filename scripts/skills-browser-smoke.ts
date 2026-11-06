import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { startHost } from '../apps/host/transport/server.js';
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
const within = async <T>(promise: Promise<T>, label: string, ms = 15000) => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, fail) => {
        timer = setTimeout(() => fail(new Error(`timed out: ${label}`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
const detailOf = (page: Page) => page.getByRole('region', { name: '技能详情' });
async function openSkills(page: Page) {
  await page.getByLabel('技能与工具', { exact: true }).click();
  await page.getByRole('heading', { name: '技能与工具' }).waitFor();
}
const skillItem = (page: Page, name: string) =>
  page
    .getByRole('complementary', { name: '能力目录' })
    .getByRole('button')
    .filter({ has: page.getByText(name, { exact: true }) });
async function openSkill(page: Page, name: string) {
  await openSkills(page);
  await skillItem(page, name).click();
  await detailOf(page).getByRole('heading', { name, exact: true }).waitFor();
}
async function open(page: Page, id: string) {
  await page.goto(`${host.origin}/#token=${token}`);
  await page.locator('.app.host-product').waitFor();
  await openSkill(page, host.service.skills.record(id).name);
  await detailOf(page).getByRole('button', { name: '编辑', exact: true }).click();
}
async function publish(page: Page) {
  const detail = detailOf(page);
  await detail.getByRole('tab', { name: '审查与发布' }).click();
  await detail.getByRole('button', { name: '检查并发布', exact: true }).click();
  await page.getByRole('dialog', { name: '发布候选' }).getByRole('button', { name: '确认发布', exact: true }).click();
  await detail.locator('[role="status"][data-operation-status="applied"]').filter({ hasText: '已生效' }).waitFor();
}
async function setEnabled(page: Page, enabled: boolean) {
  const detail = detailOf(page);
  await detail.getByRole('button', { name: enabled ? '启用' : '禁用', exact: true }).click();
  await page
    .getByRole('dialog', { name: enabled ? '启用技能' : '禁用技能' })
    .getByRole('button', { name: enabled ? '确认启用' : '确认禁用', exact: true })
    .click();
  await detail.getByRole('button', { name: enabled ? '禁用' : '启用', exact: true }).waitFor();
}
try {
  const pkg = await skillPackage(join(root, 'pkg'));
  const [skill] = await host.service.skills.import({ source: pkg, bindings });
  assert.ok(skill);
  const a = await browser.newPage({ viewport: { width: 1240, height: 850 } });
  const b = await browser.newPage();
  await open(a, skill.id);
  await open(b, skill.id);
  // An untouched but stale buffer must not borrow a newer authoritative revision.
  const editorA = () => detailOf(a).getByLabel('Skill 内容'),
    editorB = detailOf(b).getByLabel('Skill 内容');
  const saveA = () => detailOf(a).getByRole('button', { name: '保存候选', exact: true });
  const latestContent = async () => {
    const record = host.service.skills.record(skill.id);
    return (
      await host.service.skills.read(skill.id, record.latest, host.service.skills.version(record.latest).skillFile)
    ).content;
  };
  const initial = await editorA().inputValue();
  await editorB.fill(initial + '\nB change.');
  await detailOf(b).getByRole('button', { name: '保存候选', exact: true }).click();
  await detailOf(b).getByRole('status').filter({ hasText: '候选已保存' }).waitFor();
  await a.waitForFunction(
    () => (document.querySelector('textarea[aria-label="Skill 内容"]') as HTMLTextAreaElement | null)?.readOnly,
  );
  assert.equal(await editorA().isEditable(), false, 'stale buffer must not accept edits for a newer candidate');
  assert.equal(await saveA().count(), 0, 'stale buffer must not offer saving over a newer candidate');
  assert.equal(await latestContent(), initial + '\nB change.');
  // A dirty draft based on an older revision is flagged and cannot be saved over the other window's candidate.
  await a.reload();
  await a.locator('.app.host-product').waitFor();
  await openSkill(a, skill.name);
  await detailOf(a).getByRole('button', { name: '编辑', exact: true }).click();
  const second = await editorA().inputValue();
  assert.equal(second, initial + '\nB change.');
  await editorA().fill(initial + '\nA stale overwrite.');
  await editorB.fill(second + '\nB second change.');
  await detailOf(b).getByRole('button', { name: '保存候选', exact: true }).click();
  await detailOf(b).getByRole('status').filter({ hasText: '候选已保存' }).waitFor();
  await detailOf(a).getByText('候选已被其他窗口修改', { exact: true }).waitFor();
  assert.ok((await saveA().count()) === 0 || (await saveA().isDisabled()), 'stale draft must not be savable');
  assert.equal(await latestContent(), second + '\nB second change.');
  // Leaving the page in-app keeps the unsaved draft; leaving the document is guarded.
  await a.getByLabel('记忆', { exact: true }).click();
  await a.getByRole('heading', { name: '已保存的记忆' }).waitFor();
  await openSkills(a);
  await a.getByRole('button', { name: `继续编辑 ${skill.name}`, exact: true }).click();
  await editorA().waitFor();
  assert.equal(await editorA().inputValue(), initial + '\nA stale overwrite.');
  const guarded = new Promise<string>((ok) =>
    a.once('dialog', (dialog) => {
      ok(dialog.type());
      void dialog.dismiss();
    }),
  );
  const leaving = a.goto('about:blank', { timeout: 15000 }).then(
    () => 'left',
    () => 'stayed',
  );
  assert.equal(await within(guarded, 'beforeunload guard dialog'), 'beforeunload');
  assert.equal(await leaving, 'stayed', 'dismissing the guard must keep the page');
  assert.equal(await editorA().inputValue(), initial + '\nA stale overwrite.');
  a.once('dialog', (dialog) => void dialog.accept());
  await a.goto('about:blank');
  assert.equal(a.url(), 'about:blank');
  // Reviewing V1 does not prefill the approval of changed V2 bytes.
  await detailOf(b).getByRole('tab', { name: '审查与发布' }).click();
  await detailOf(b).getByRole('button', { name: '记录精确内容审查', exact: true }).click();
  const reviewB = b.getByRole('dialog', { name: '记录候选审查' });
  for (const checkbox of await reviewB.getByRole('checkbox').all()) await checkbox.check();
  await reviewB
    .getByLabel('审查结论')
    .fill('Reviewed fixture code and host aliases, no external dependencies or filesystem effects.');
  assert.equal(await reviewB.getByRole('button', { name: '记录审查', exact: true }).isEnabled(), true);
  await open(a, skill.id);
  await editorA().fill(initial + '\nV2 change.');
  await detailOf(a).getByRole('button', { name: '保存候选', exact: true }).click();
  await detailOf(a).getByRole('status').filter({ hasText: '候选已保存' }).waitFor();
  await reviewB.waitFor({ state: 'detached' });
  await detailOf(b).getByRole('button', { name: '记录精确内容审查', exact: true }).click();
  await reviewB.waitFor();
  const checks = await reviewB.getByRole('checkbox').all();
  assert.equal(checks.length, 3);
  for (const checkbox of checks) assert.equal(await checkbox.isChecked(), false);
  assert.equal(await reviewB.getByLabel('审查结论').inputValue(), '');
  assert.equal(await reviewB.getByRole('button', { name: '记录审查', exact: true }).isEnabled(), false);
  await reviewB.getByRole('button', { name: '关闭', exact: true }).click();
  // Ordinary import is asynchronous and observable through the shared WebSocket.
  const plain = join(root, 'plain');
  await mkdir(plain);
  await writeFile(
    join(plain, 'SKILL.md'),
    '---\nname: browser-plain\ndescription: Browser ordinary Skill.\n---\nUse native read.',
  );
  await openSkills(a);
  await a.getByRole('button', { name: '导入技能', exact: true }).click();
  const importA = a.getByRole('dialog', { name: '导入技能' });
  await importA.getByLabel('Skill 来源', { exact: true }).fill(plain);
  await importA.getByRole('button', { name: '保存候选', exact: true }).click();
  await skillItem(a, 'browser-plain').waitFor();
  await skillItem(b, 'browser-plain').waitFor();
  await skillItem(a, 'browser-plain').click();
  await detailOf(a).getByRole('heading', { name: 'browser-plain', exact: true }).waitFor();
  await publish(a);
  await setEnabled(a, false);
  await a.reload();
  await a.locator('.app.host-product').waitFor();
  await openSkill(a, 'browser-plain');
  await detailOf(a).getByRole('button', { name: '启用', exact: true }).waitFor();
  await detailOf(a).getByText('已禁用', { exact: true }).waitFor();
  const screenshotDir = resolve(process.env.AGENT_ACCEPTANCE_SCREENSHOTS ?? 'release/d2-evidence');
  await mkdir(screenshotDir, { recursive: true });
  await a.screenshot({ path: join(screenshotDir, 'skills-browser.png'), fullPage: true });
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
