import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright-core';

// Serve the built client with controlled API responses; no Agent or executable Package is loaded.
const server = createServer(async (req, res) => {
  try {
    const path = resolve('dist/web', req.url === '/' ? 'index.html' : `.${req.url}`);
    const bytes = await readFile(path);
    const mime = extname(path) === '.html' ? 'text/html' : extname(path) === '.js' ? 'text/javascript' : 'text/css';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const sessionA = '00000000-0000-4000-8000-000000000001';
  const sessionB = '00000000-0000-4000-8000-000000000002';
  const skillId = '00000000-0000-4000-8000-000000000003';
  const projectA = '/workspace/project-a',
    projectB = '/workspace/project-b';
  const skill = (name: string, project = projectA) => ({
    id: skillId,
    name,
    description: 'Ordinary Skill response-order fixture',
    source: `${project}/skill`,
    project,
    enabled: false,
    revision: 1,
    latest: skillId,
    current: skillId,
  });
  const catalog = (name: string, project = projectA) => ({
    skills: [skill(name, project)],
    discovered: [],
    operations: [],
  });
  const detail = (name: string, project = projectA) => ({
    skill: skill(name, project),
    versions: [{ id: skillId, skillFile: 'SKILL.md', extensions: [], knowledgeFiles: [], digest: name, created: 1 }],
    files: ['SKILL.md'],
    snapshotFiles: ['SKILL.md'],
    operations: [],
    draftDir: '/workspace/draft',
    knowledge: [],
  });
  const session = (id: string, title: string, cwd: string) => ({
    id,
    title,
    cwd,
    provider: 'fixture',
    model: 'fixture',
    busy: false,
    messages: [],
    tree: [],
  });
  const a = session(sessionA, 'Session A', projectA),
    b = session(sessionB, 'Session B', projectB);
  const listA = `/api/skills?project=${encodeURIComponent(projectA)}`,
    listB = `/api/skills?project=${encodeURIComponent(projectB)}`,
    detailPath = `/api/skills/${skillId}`,
    filePath = `${detailPath}/files?version=${skillId}&path=SKILL.md`;
  const responses = new Map<string, unknown>([
    ['/api/models', { models: [], providers: [] }],
    ['/api/sessions', [a, b]],
    [`/api/sessions/${sessionA}`, a],
    [`/api/sessions/${sessionB}`, b],
    [listA, catalog('INITIAL')],
    [listB, catalog('PROJECT_B', projectB)],
    [detailPath, detail('DETAIL_INITIAL')],
    [filePath, { content: 'Original Skill text', baseRevision: 1, version: skillId, latest: skillId }],
  ]);
  const holds = new Map<string, { entered: () => void; release: Promise<void> }>();
  const delay = (path: string) => {
    let entered: () => void = () => {},
      release: () => void = () => {};
    const ready = new Promise<void>((ok) => {
      entered = ok;
    });
    const released = new Promise<void>((ok) => {
      release = ok;
    });
    holds.set(path, { entered, release: released });
    return { ready, release };
  };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = `${url.pathname}${url.search}`;
    assert.ok(responses.has(path), `Unexpected API request: ${path}`);
    const value = structuredClone(responses.get(path));
    const hold = holds.get(path);
    if (hold) {
      holds.delete(path);
      hold.entered();
      await hold.release;
    }
    await route.fulfill({ json: value });
  });
  const refresh = (event = 'agent-skills-changed') =>
    page.evaluate((type) => window.dispatchEvent(new Event(type)), event);
  const release = async (held: ReturnType<typeof delay>, path: string) => {
    const response = page.waitForResponse(
      (value) => `${new URL(value.url()).pathname}${new URL(value.url()).search}` === path,
    );
    held.release();
    await response;
    await page.evaluate(
      () => new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok()))),
    );
  };
  const item = (name: string) => page.locator('.skill-item').filter({ hasText: name });
  const heading = page.locator('.skill-detail h2');
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.getByRole('button', { name: 'Session A', exact: false }).click();
  await page.locator('header h1').filter({ hasText: 'Session A' }).waitFor();
  await page.getByRole('button', { name: '能力管理', exact: true }).click();
  await item('INITIAL').waitFor();

  // A request admitted before reconnect must not overwrite the newly read authority.
  const staleCatalog = delay(listA);
  await refresh();
  await staleCatalog.ready;
  responses.set(listA, catalog('RECONNECTED'));
  await refresh('agent-reconnected');
  await item('RECONNECTED').waitFor();
  await release(staleCatalog, listA);
  assert.match(await page.locator('.skill-list').innerText(), /RECONNECTED/);
  assert.equal(await item('INITIAL').count(), 0);

  await item('RECONNECTED').click();
  await heading.filter({ hasText: 'DETAIL_INITIAL' }).waitFor();
  const staleDetail = delay(detailPath);
  await refresh();
  await staleDetail.ready;
  responses.set(detailPath, detail('DETAIL_RECONNECTED'));
  await refresh('agent-reconnected');
  await heading.filter({ hasText: 'DETAIL_RECONNECTED' }).waitFor();
  await release(staleDetail, detailPath);
  assert.equal(await heading.innerText(), 'DETAIL_RECONNECTED');

  // Explicitly opening the same Skill after a refresh wins over its delayed detail.
  const beforeOpen = delay(detailPath);
  await refresh();
  await beforeOpen.ready;
  responses.set(detailPath, detail('DETAIL_OPENED'));
  await item('RECONNECTED').click();
  await heading.filter({ hasText: 'DETAIL_OPENED' }).waitFor();
  await release(beforeOpen, detailPath);
  assert.equal(await heading.innerText(), 'DETAIL_OPENED');

  // A newer authority refresh also wins over an earlier explicit open.
  const oldOpen = delay(detailPath);
  await item('RECONNECTED').click();
  await oldOpen.ready;
  responses.set(detailPath, detail('DETAIL_AFTER_OPEN'));
  await refresh('agent-reconnected');
  await heading.filter({ hasText: 'DETAIL_AFTER_OPEN' }).waitFor();
  await release(oldOpen, detailPath);
  assert.equal(await heading.innerText(), 'DETAIL_AFTER_OPEN');

  const beforeRead = delay(detailPath);
  await refresh();
  await beforeRead.ready;
  await page.getByRole('button', { name: '查看说明', exact: true }).click();
  const editor = page.getByLabel('Skill 内容', { exact: true });
  await editor.fill('Unsaved Skill draft');
  await release(beforeRead, detailPath);
  await refresh('agent-reconnected');
  await page.evaluate(() => new Promise<void>((ok) => requestAnimationFrame(() => ok())));
  assert.equal(await editor.inputValue(), 'Unsaved Skill draft');

  // The A -> B -> A context has a new generation even when the project string matches again.
  const oldProject = delay(listA);
  await refresh();
  await oldProject.ready;
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Session B', exact: false }).click();
  await item('PROJECT_B').waitFor();
  assert.equal(await editor.count(), 0);
  responses.set(listA, catalog('PROJECT_A_RETURNED'));
  await page.getByRole('button', { name: 'Session A', exact: false }).click();
  await item('PROJECT_A_RETURNED').waitFor();
  await release(oldProject, listA);
  assert.equal(await item('PROJECT_A_RETURNED').count(), 1);
  assert.equal(await item('RECONNECTED').count(), 0);

  await item('PROJECT_A_RETURNED').click();
  await heading.filter({ hasText: 'DETAIL_AFTER_OPEN' }).waitFor();
  const oldRead = delay(filePath);
  await page.getByRole('button', { name: '查看说明', exact: true }).click();
  await oldRead.ready;
  await page.getByRole('button', { name: 'Session B', exact: false }).click();
  await item('PROJECT_B').waitFor();
  await release(oldRead, filePath);
  assert.equal(await editor.count(), 0);
  assert.equal(await heading.innerText(), '选择一项能力');

  const unmounted = delay(listB);
  await refresh();
  await unmounted.ready;
  await page.getByRole('button', { name: '返回对话', exact: true }).click();
  await page.locator('.skill-panel').waitFor({ state: 'detached' });
  responses.set(listB, catalog('PROJECT_B_REMOUNTED', projectB));
  await page.getByRole('button', { name: '能力管理', exact: true }).click();
  await item('PROJECT_B_REMOUNTED').waitFor();
  await release(unmounted, listB);
  assert.equal(await item('PROJECT_B_REMOUNTED').count(), 1);

  // An old mutation callback must not refresh its former project after navigation.
  responses.set(detailPath, detail('DETAIL_PROJECT_B', projectB));
  const enabledPath = `${detailPath}/enabled`;
  responses.set(enabledPath, { ok: true });
  await item('PROJECT_B_REMOUNTED').click();
  await heading.filter({ hasText: 'DETAIL_PROJECT_B' }).waitFor();
  const oldMutation = delay(enabledPath);
  await page.getByRole('button', { name: '启用', exact: true }).click();
  await oldMutation.ready;
  responses.set(listA, catalog('PROJECT_A_AFTER_MUTATION'));
  await page.getByRole('button', { name: 'Session A', exact: false }).click();
  await item('PROJECT_A_AFTER_MUTATION').waitFor();
  await release(oldMutation, enabledPath);
  assert.equal(await item('PROJECT_A_AFTER_MUTATION').count(), 1);
  assert.equal(await item('PROJECT_B_REMOUNTED').count(), 0);

  // Saving in A may finish after its draft was explicitly discarded to navigate to B.
  responses.set(detailPath, detail('DETAIL_PROJECT_A'));
  const editPath = `${detailPath}/edit`;
  responses.set(editPath, detail('SAVED_PROJECT_A'));
  await item('PROJECT_A_AFTER_MUTATION').click();
  await heading.filter({ hasText: 'DETAIL_PROJECT_A' }).waitFor();
  await page.getByRole('button', { name: '查看说明', exact: true }).click();
  await editor.fill('Saved draft from project A');
  const oldSave = delay(editPath);
  await page.getByRole('button', { name: '保存修改为候选', exact: true }).click();
  await oldSave.ready;
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Session B', exact: false }).click();
  await item('PROJECT_B_REMOUNTED').waitFor();
  assert.equal(await heading.innerText(), '选择一项能力');
  await release(oldSave, editPath);
  assert.equal(await item('PROJECT_B_REMOUNTED').count(), 1);
  assert.equal(await heading.innerText(), '选择一项能力');
  assert.equal(await editor.count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      result: 'passed',
      reconnectCatalogOrder: true,
      reconnectDetailOrder: true,
      refreshBeforeOpen: true,
      openBeforeRefresh: true,
      readAndDirtyDraft: true,
      projectRoundTrip: true,
      projectInvalidatesRead: true,
      unmountInvalidatesResponse: true,
      oldMutationRefreshContext: true,
      oldSaveDoesNotReplaceProject: true,
    }),
  );
} finally {
  await browser.close();
  await new Promise<void>((ok, fail) => server.close((error) => (error ? fail(error) : ok())));
}
