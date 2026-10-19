import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { _electron, chromium, type ElectronApplication, type Page } from 'playwright-core';
import type { MemoryView } from '../apps/host/memory/memory.js';

interface Tree {
  entry: { id: string; message?: { role: string } };
  children: Tree[];
}
interface State {
  id: string;
  busy: boolean;
  error?: string;
  messages: Array<{ role: string; toolName?: string; content: unknown }>;
  tree: Tree[];
}
const flatten = (tree: Tree[]): Tree[] => tree.flatMap((n) => [n, ...flatten(n.children)]);
const root = await mkdtemp(join(tmpdir(), 'd2-memory-ui-'));
const executable = process.env.AGENT_APP_PATH ?? resolve('release/Agent-darwin-arm64/Agent.app/Contents/MacOS/Agent');
let desktop: ElectronApplication | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const call = <T>(page: Page, path: string, method = 'GET', body?: unknown) =>
  page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(`/api${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem('agent-connection-token')}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(`${response.status}: ${value.error}`);
      return value;
    },
    { path, method, body },
  ) as Promise<T>;
async function idle(page: Page, id: string) {
  const deadline = Date.now() + 240000;
  let state: State;
  do {
    await page.waitForTimeout(300);
    state = await call<State>(page, `/sessions/${id}`);
  } while (state.busy && Date.now() < deadline);
  assert.equal(state.busy, false);
  assert.equal(state.error, undefined);
  assert.ok(!state.messages.some((m) => m.role === 'assistant' && JSON.stringify(m).includes('"stopReason":"error"')));
  return state;
}
async function prompt(page: Page, id: string, text: string) {
  await call(page, `/sessions/${id}/prompt`, 'POST', { text });
  return idle(page, id);
}
function tool(state: State, name: string, text: string) {
  assert.ok(
    state.messages.some((m) => m.toolName === name && JSON.stringify(m.content).includes(text)),
    `${name}: ${text}`,
  );
}
const evidence: Record<string, unknown> = {
  at: new Date().toISOString(),
  client: 'packaged Electron + Chrome',
  model: 'openai-codex/gpt-6-luna',
};
try {
  desktop = await _electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${join(root, 'profile')}`],
    env: { ...process.env, AGENT_DESKTOP_DATA_DIR: join(root, 'data') },
    timeout: 30000,
  });
  const page = await desktop.firstWindow();
  await page.locator('.shell').waitFor();
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.getByLabel('模型提供方').selectOption('openai-codex');
  await page.getByRole('button', { name: '导入 Pi 授权' }).click();
  await page
    .locator('.start select option[value="openai-codex/gpt-6-luna"]')
    .waitFor({ state: 'attached', timeout: 30000 });
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  const nonce = randomUUID(),
    corrected = randomUUID();
  await writeFile(
    join(root, 'decision.txt'),
    `Project deployment marker is ${nonce}. This is a project decision, not a general instruction.`,
  );
  await page.getByPlaceholder('工作目录的绝对路径').fill(root);
  await page.locator('.start select').selectOption('openai-codex/gpt-6-luna');
  await page.getByRole('button', { name: '创建会话 →' }).click();
  await page.getByLabel('任务', { exact: true }).waitFor();
  const [a] = await call<State[]>(page, '/sessions');
  assert.ok(a);
  const saved = await prompt(
    page,
    a.id,
    'Read decision.txt using read. Save exactly one project decision titled deployment-marker using memory_save, with the exact marker from the file in the content and a reason referencing the file. Also save one global fact titled global-memory-probe with content "A triangle has three sides", and one project experience titled project-experience with content "Check evidence before correcting a conclusion". Do not use bash.',
  );
  tool(saved, 'read', nonce);
  tool(saved, 'memory_save', 'deployment-marker');
  const suffix = `?project=${encodeURIComponent(root)}`;
  let catalog = await call<{ items: MemoryView[] }>(page, `/memory${suffix}`);
  const decision = catalog.items.find((m) => m.title === 'deployment-marker');
  assert.ok(decision);
  assert.ok(decision.sources.some((s) => s.sessionId === a.id));
  assert.equal(catalog.items.length, 3);
  const b = await call<State>(page, '/sessions', 'POST', { cwd: root, provider: 'openai-codex', model: 'gpt-6-luna' });
  const used = await prompt(
    page,
    b.id,
    'Find deployment-marker using memory_search and memory_get. Write the exact deployment marker from that memory to memory-use.txt using write. Do not read decision.txt or use bash.',
  );
  tool(used, 'memory_search', nonce);
  tool(used, 'memory_get', nonce);
  assert.ok(used.messages.some((m) => m.toolName === 'write'));
  assert.equal((await readFile(join(root, 'memory-use.txt'), 'utf8')).trim(), nonce);
  evidence.agentSaveAndCrossSessionUse = true;
  evidence.sessionATools = saved.messages.filter((m) => m.toolName).map((m) => m.toolName);
  evidence.sessionBTools = used.messages.filter((m) => m.toolName).map((m) => m.toolName);
  evidence.randomMarker = nonce;
  evidence.correctedMarker = corrected;
  console.log('Agent cross-Session save/search/get/write passed');
  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const web = await browser.newPage({ viewport: { width: 1240, height: 850 } });
  const token = await page.evaluate(() => sessionStorage.getItem('agent-connection-token'));
  await web.goto(`${new URL(page.url()).origin}/#token=${token}`);
  await web.locator('nav button').first().click();
  await page.getByRole('button', { name: '记忆管理', exact: true }).click();
  await web.getByRole('button', { name: '记忆管理', exact: true }).click();
  const row = (p: Page) => p.locator('.memory-item').filter({ hasText: 'deployment-marker' }).first();
  await row(page).click();
  await row(web).click();
  await page.getByRole('button', { name: '编辑与调整作用域', exact: true }).click();
  await web.getByRole('button', { name: '编辑与调整作用域', exact: true }).click();
  await web.getByLabel('知识内容', { exact: true }).fill(`Project deployment marker is ${corrected}`);
  await web.getByLabel('修改依据', { exact: true }).fill('New deployment evidence supersedes the original marker');
  await web.getByRole('button', { name: '保存认识', exact: true }).click();
  await web.getByRole('button', { name: '编辑与调整作用域', exact: true }).waitFor();
  await page.getByLabel('知识内容', { exact: true }).fill('stale local draft');
  await page.getByLabel('修改依据', { exact: true }).fill('Concurrent edit with old revision');
  await page.getByRole('button', { name: '保存认识', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '记忆已被修改' }).waitFor();
  assert.equal(await page.getByLabel('知识内容', { exact: true }).inputValue(), 'stale local draft');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '重新读取最新版本', exact: true }).click();
  await page.getByRole('button', { name: '编辑与调整作用域', exact: true }).waitFor();
  assert.ok(
    await page
      .locator('.memory-detail')
      .innerText()
      .then((text) => text.includes(corrected)),
  );
  const detail = await call<{ current: MemoryView; history: MemoryView[] }>(
    page,
    `/memory/${decision.id}${suffix}&includeHistory=true`,
  );
  assert.equal(detail.history.length, 2);
  assert.equal(detail.history[1]?.content.includes(nonce), true);
  evidence.uiCorrectionConflictAndSync = true;
  console.log('Desktop/Chrome correction, conflict and sync passed');
  const correctedUse = await prompt(
    page,
    b.id,
    'Search deployment-marker again using memory_search, get the latest version with memory_get, then write only its current exact marker to corrected-use.txt. Do not read other files.',
  );
  tool(correctedUse, 'memory_get', corrected);
  assert.equal((await readFile(join(root, 'corrected-use.txt'), 'utf8')).trim(), corrected);
  // User corrections inherit the original source applicability, so A rollback still withdraws this decision.
  const target = flatten(saved.tree).find((n) => n.entry.message?.role === 'user');
  assert.ok(target);
  await call(page, `/sessions/${a.id}/branch`, 'POST', { value: target.entry.id });
  catalog = await call(page, `/memory${suffix}`);
  assert.ok(!catalog.items.some((m) => m.id === decision.id));
  assert.ok(catalog.items.some((m) => m.title === 'project-experience'));
  const afterBranch = await prompt(
    page,
    b.id,
    'Use memory_search for deployment-marker now. Do not write files. Explain whether a current deployment decision exists based only on this new tool result.',
  );
  const lastSearch = afterBranch.messages.filter((m) => m.toolName === 'memory_search').at(-1);
  assert.ok(lastSearch);
  assert.ok(!JSON.stringify(lastSearch.content).includes(corrected));
  evidence.sharedRollbackWithdrawal = true;
  const other = join(root, 'other');
  await mkdir(other);
  const c = await call<State>(page, '/sessions', 'POST', { cwd: other, provider: 'openai-codex', model: 'gpt-6-luna' });
  const isolated = await prompt(
    page,
    c.id,
    'Use memory_search with query "global-memory-probe", then with query "project-experience". Report results; do not use other tools.',
  );
  tool(isolated, 'memory_search', 'A triangle has three sides');
  assert.ok(
    !JSON.stringify(isolated.messages.filter((m) => m.toolName === 'memory_search')).includes(
      'Check evidence before correcting',
    ),
  );
  evidence.globalAndProjectIsolation = true;
  await web.getByRole('checkbox', { name: '包含历史与已删除' }).check();
  await row(web).click();
  await mkdir(resolve('release/d2-memory-evidence'), { recursive: true });
  await web.screenshot({ path: resolve('release/d2-memory-evidence/memory-management.png') });
  // Scope adjustment and deletion through the shared management UI.
  await web.locator('.memory-item').filter({ hasText: 'project-experience' }).first().click();
  await web.getByRole('button', { name: '编辑与调整作用域', exact: true }).click();
  await web.getByLabel('记忆作用域', { exact: true }).selectOption('global');
  await web.getByLabel('修改依据', { exact: true }).fill('General experience applies across projects');
  await web.getByRole('button', { name: '保存认识', exact: true }).click();
  await web.getByRole('button', { name: '编辑与调整作用域', exact: true }).waitFor();
  assert.ok(
    (await call<{ items: MemoryView[] }>(page, `/memory?project=${encodeURIComponent(other)}`)).items.some(
      (m) => m.title === 'project-experience',
    ),
  );
  web.once('dialog', (dialog) => dialog.accept());
  await web.getByRole('button', { name: '删除记忆', exact: true }).click();
  await web.locator('.memory-state').filter({ hasText: '已删除' }).waitFor();
  evidence.scopeAndLogicalDeletion = true;
  const before = await call(page, `/memory/${decision.id}${suffix}&includeHistory=true`);
  await browser.close();
  browser = undefined;
  await desktop.close();
  desktop = undefined;
  desktop = await _electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${join(root, 'profile')}`],
    env: { ...process.env, AGENT_DESKTOP_DATA_DIR: join(root, 'data') },
    timeout: 30000,
  });
  const restored = await desktop.firstWindow();
  await restored.locator('.shell').waitFor();
  assert.deepEqual(await call(restored, `/memory/${decision.id}${suffix}&includeHistory=true`), before);
  assert.equal((await call<State>(restored, `/sessions/${b.id}`)).messages.length, afterBranch.messages.length);
  evidence.restartRetainsKnowledgeSourcesAndHistory = true;
  evidence.result = 'passed';
  await mkdir(resolve('docs/evidence'), { recursive: true });
  await writeFile(resolve('docs/evidence/d2-memory-real-ui.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
} finally {
  await browser?.close();
  await desktop?.close();
  await rm(root, { recursive: true, force: true });
}
