import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';

const root = await mkdtemp(join(tmpdir(), 'd5-desktop-'));
const output = resolve('docs/evidence/d5-desktop-delivery.json');
const executable = resolve(process.env.AGENT_APP_PATH ?? 'release/Agent-darwin-arm64/Agent.app/Contents/MacOS/Agent');
const previousExecutable = resolve(
  process.env.AGENT_PREVIOUS_APP_PATH ??
    'release/d4-development-2026-10-21/Agent-darwin-arm64/Agent.app/Contents/MacOS/Agent',
);
const dataDir = join(root, 'data');
const receipt: Record<string, unknown> = {
  time: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  executable,
  previousExecutable,
  checks: [],
  result: 'running',
};
const checks = receipt.checks as string[];
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const tick = () => new Promise<void>((ok) => setTimeout(ok, 100));
let desktop: ElectronApplication | undefined;
async function closeDesktop() {
  const current = desktop;
  desktop = undefined;
  await current?.close();
}
async function launch(path: string, dir = dataDir, expectFailure = false) {
  desktop = await _electron.launch({
    executablePath: path,
    args: [`--user-data-dir=${join(root, 'profile')}`],
    env: { ...process.env, AGENT_DESKTOP_DATA_DIR: dir },
    timeout: 60000,
  });
  await desktop.evaluate(({ app }) => {
    const state = globalThis as typeof globalThis & { d5ProcessExits?: unknown[] };
    state.d5ProcessExits = [];
    app.on('child-process-gone', (_event, details) => state.d5ProcessExits?.push(details));
  });
  const page = await desktop.firstWindow();
  await page.locator(expectFailure ? '[data-startup-phase="failed"]' : '.shell').waitFor({ timeout: 60000 });
  return page;
}
async function request<T>(page: Page, path: string, method = 'GET', body?: unknown): Promise<T> {
  return page.evaluate(
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
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${value.error}`);
      return value;
    },
    { path, method, body },
  );
}
async function waitUntil(check: () => Promise<boolean>, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, 'Desktop acceptance timed out');
    await tick();
  }
}
interface State {
  id: string;
  busy: boolean;
  messages: Array<{ role: string; toolName?: string }>;
  error?: string;
}
interface Skill {
  id: string;
  latest: string;
  current?: string;
  revision: number;
}
interface SkillDetail {
  skill: Skill;
  versions: unknown[];
  knowledge: unknown[];
}
async function operation(page: Page, id: string) {
  await waitUntil(async () => {
    const result = await request<{ status: string; message?: string }>(page, `/skills/operations/${id}`);
    assert.notEqual(result.status, 'failed', result.message ?? 'Skill operation failed');
    return result.status === 'applied';
  });
}
async function menuAction(id: string, archive: string, destination: string, expectBusy = false) {
  assert.ok(desktop);
  const current = desktop;
  await current.evaluate(
    ({ dialog, Menu, shell }, input) => {
      const state = globalThis as typeof globalThis & { d5Messages?: Array<{ type?: string; message: string }> };
      state.d5Messages = [];
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: input.destination });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input.archive] });
      dialog.showMessageBox = async (
        arg1: Electron.BaseWindow | Electron.MessageBoxOptions,
        arg2?: Electron.MessageBoxOptions,
      ) => {
        const options = arg2 ?? arg1;
        if ('message' in options) state.d5Messages?.push({ message: options.message, type: options.type });
        return { response: 0, checkboxChecked: false };
      };
      shell.showItemInFolder = () => {};
      const menu = Menu.getApplicationMenu();
      const item = menu?.getMenuItemById(input.id);
      if (!item || !menu) throw new Error('Missing maintenance menu');
      item.click(undefined, undefined, {} as Electron.KeyboardEvent);
    },
    { id, archive, destination },
  );
  await waitUntil(async () =>
    current.evaluate(() => !!(globalThis as typeof globalThis & { d5Messages?: unknown[] }).d5Messages?.length),
  );
  const messages = await desktop.evaluate(
    () => (globalThis as typeof globalThis & { d5Messages?: Array<{ type?: string; message: string }> }).d5Messages,
  );
  assert.ok(messages?.length);
  assert.equal(
    messages.some((message) => message.type === 'error'),
    expectBusy,
    JSON.stringify(messages),
  );
}
try {
  const appBundle = resolve(executable, '../../..');
  execFileSync('codesign', ['--verify', '--deep', '--strict', appBundle], { stdio: 'pipe' });
  receipt.applicationSha256 = hash(await readFile(executable));
  receipt.hostSha256 = hash(await readFile(resolve(executable, '../../Resources/app/dist/host/main.js')));
  receipt.compiledSha256 = Object.fromEntries(
    await Promise.all(
      [
        'host/storage/maintenance.js',
        'host/storage/schema.js',
        'host/runtime/agent.js',
        'host/reflection/reflection-service.js',
        'desktop/maintenance-worker.js',
      ].map(async (path) => [path, hash(await readFile(resolve(executable, '../../Resources/app/dist', path)))]),
    ),
  );
  checks.push('macOS deep strict signature verification');
  let page = await launch(previousExecutable);
  await request(page, '/credentials', 'POST', { provider: 'openai-codex', importExisting: true });
  const model = { provider: 'openai-codex', model: process.env.AGENT_SMOKE_MODEL ?? 'gpt-6-luna' };
  const session = await request<{ id: string }>(page, '/sessions', 'POST', { cwd: root, ...model });
  const memory = await request<{ id: string }>(page, '/memory', 'POST', {
    knowledge: {
      title: 'Desktop migration fixture',
      content: 'Committed before manual upgrade',
      kind: 'fact',
      scope: 'global',
    },
    reason: 'Isolated D5 acceptance fixture',
  });
  const source = join(root, 'fixture-skill');
  await mkdir(source);
  await writeFile(
    join(source, 'SKILL.md'),
    '---\nname: d5-fixture\ndescription: Local upgrade fixture\n---\nRead fixture.txt when asked to recover the local marker.\n',
  );
  const imported = await request<{ id: string }>(page, '/skills', 'POST', { source });
  await operation(page, imported.id);
  const skill = (await request<{ skills: Skill[] }>(page, '/skills')).skills[0];
  assert.ok(skill);
  const published = await request<{ id: string }>(page, `/skills/${skill.id}/publish`, 'POST', {
    version: skill.latest,
    baseRevision: skill.revision,
  });
  await operation(page, published.id);
  await writeFile(join(root, 'fixture.txt'), 'D5-DESKTOP-RECOVERY-MARKER\n');
  await request(page, `/sessions/${session.id}/prompt`, 'POST', {
    text: 'Use read to inspect fixture.txt, then reply with the exact marker. Do not change any files.',
  });
  await waitUntil(async () => !(await request<State>(page, `/sessions/${session.id}`)).busy);
  const before = await request<State>(page, `/sessions/${session.id}`);
  assert.equal(before.error, undefined);
  assert.ok(before.messages.some((message) => message.toolName === 'read'));
  const keyBefore = hash(await readFile(join(dataDir, 'data-key.enc')));
  const memoryBefore = await request(page, `/memory/${memory.id}?includeHistory=true`);
  const skillBefore = await request<SkillDetail>(page, `/skills/${skill.id}`);
  await closeDesktop();
  checks.push('previous signed version committed real Provider Tool call, Memory and formal Skill');
  page = await launch(executable);
  assert.equal(hash(await readFile(join(dataDir, 'data-key.enc'))), keyBefore);
  assert.deepEqual(await request(page, `/memory/${memory.id}?includeHistory=true`), memoryBefore);
  const skillAfter = await request<SkillDetail>(page, `/skills/${skill.id}`);
  assert.deepEqual(skillAfter, skillBefore);
  const upgraded = await request<State>(page, `/sessions/${session.id}`);
  assert.deepEqual(upgraded.messages, before.messages);
  assert.equal(
    (await request<{ availability: { available: boolean } }>(page, '/reflections')).availability.available,
    true,
  );
  checks.push(
    'manual application replacement preserved Keychain key, exact Session messages, Memory, Skill and XPC availability',
  );
  const archive = join(root, 'desktop.agentbackup');
  await menuAction('backup-data', '', archive);
  await waitUntil(async () => {
    try {
      return (await request<State>(page, `/sessions/${session.id}`)).id === session.id;
    } catch {
      return false;
    }
  });
  const backupBytes = await readFile(archive);
  assert.ok(backupBytes.length > 0);
  receipt.backup = { bytes: backupBytes.length, sha256: hash(backupBytes) };
  checks.push('native menu created encrypted backup after graceful idle Host shutdown and resumed Host');
  const restoredDir = join(root, 'restored');
  await menuAction('restore-data', archive, restoredDir);
  assert.equal(hash(await readFile(join(restoredDir, 'data-key.enc'))), keyBefore);
  await closeDesktop();
  page = await launch(executable, restoredDir);
  assert.deepEqual(await request(page, `/memory/${memory.id}?includeHistory=true`), memoryBefore);
  assert.deepEqual((await request<State>(page, `/sessions/${session.id}`)).messages, before.messages);
  await request(page, `/sessions/${session.id}/prompt`, 'POST', {
    text: 'Use read to inspect fixture.txt again and reply with the marker. Do not change files.',
  });
  assert.equal((await request<State>(page, `/sessions/${session.id}`)).busy, true);
  const pid = () => desktop?.evaluate(({ app }) => app.getAppMetrics().find((item) => item.name === 'Agent Host')?.pid);
  const hostPid = await pid();
  assert.ok(hostPid);
  const refusedBackup = join(root, 'busy.agentbackup');
  await menuAction('backup-data', '', refusedBackup, true);
  await assert.rejects(readFile(refusedBackup), { code: 'ENOENT' });
  assert.equal(await pid(), hostPid);
  await waitUntil(async () => !(await request<State>(page, `/sessions/${session.id}`)).busy);
  const continued = await request<State>(page, `/sessions/${session.id}`);
  assert.equal(continued.error, undefined);
  assert.ok(continued.messages.length > before.messages.length);
  assert.ok(continued.messages.slice(before.messages.length).some((message) => message.toolName === 'read'));
  checks.push('restored sibling directory reopened through Keychain and continued real Provider native Tool Calling');
  checks.push('busy native backup menu refused without replacing Host or aborting the real Provider task');
  receipt.session = {
    id: session.id,
    messagesBefore: before.messages.length,
    messagesAfter: continued.messages.length,
  };
  await closeDesktop();
  const damaged = Buffer.from('D5 isolated SQLite corruption fixture');
  await writeFile(join(restoredDir, 'product.sqlite'), damaged);
  page = await launch(executable, restoredDir, true);
  assert.ok((await page.locator('body').innerText()).includes('服务启动失败'));
  const recoveredFromFailure = join(root, 'recovered-after-sqlite-damage');
  await menuAction('restore-data', archive, recoveredFromFailure);
  assert.deepEqual(await readFile(join(restoredDir, 'product.sqlite')), damaged);
  await closeDesktop();
  page = await launch(executable, recoveredFromFailure);
  assert.deepEqual(await request(page, `/memory/${memory.id}?includeHistory=true`), memoryBefore);
  assert.deepEqual((await request<State>(page, `/sessions/${session.id}`)).messages, before.messages);
  const afterDamage = await request<SkillDetail>(page, `/skills/${skill.id}`);
  assert.deepEqual(afterDamage.skill, skillBefore.skill);
  assert.deepEqual(afterDamage.versions, skillBefore.versions);
  assert.deepEqual(afterDamage.knowledge, skillBefore.knowledge);
  checks.push(
    'corrupt SQLite failed closed; native restore menu used unlocked Keychain key offline, preserved damaged bytes and reopened restored Session/Memory/formal Skill',
  );
  receipt.damagedDatabaseSha256 = hash(damaged);
  await closeDesktop();
  const damagedCredentials = Buffer.from('D5 isolated encrypted credential corruption fixture');
  await writeFile(join(recoveredFromFailure, 'credentials.enc'), damagedCredentials);
  page = await launch(executable, recoveredFromFailure, true);
  assert.ok((await page.locator('body').innerText()).includes('无法读取加密数据'));
  const recoveredCredentials = join(root, 'recovered-after-credentials-damage');
  await menuAction('restore-data', archive, recoveredCredentials);
  assert.deepEqual(await readFile(join(recoveredFromFailure, 'credentials.enc')), damagedCredentials);
  await closeDesktop();
  page = await launch(executable, recoveredCredentials);
  assert.deepEqual(await request(page, `/memory/${memory.id}?includeHistory=true`), memoryBefore);
  assert.deepEqual((await request<State>(page, `/sessions/${session.id}`)).messages, before.messages);
  await request(page, `/sessions/${session.id}/prompt`, 'POST', {
    text: 'Use read to inspect fixture.txt and reply with the marker. Do not change files.',
  });
  await waitUntil(async () => !(await request<State>(page, `/sessions/${session.id}`)).busy);
  const withRecoveredCredentials = await request<State>(page, `/sessions/${session.id}`);
  assert.equal(withRecoveredCredentials.error, undefined);
  assert.ok(
    withRecoveredCredentials.messages.slice(before.messages.length).some((message) => message.toolName === 'read'),
  );
  checks.push(
    'corrupt credentials failed closed; offline restore authenticated backup with unlocked key, preserved damaged ciphertext and reused restored real Provider credentials',
  );
  receipt.damagedCredentialsSha256 = hash(damagedCredentials);
  receipt.result = 'passed';
  console.log(JSON.stringify(receipt));
} catch (error) {
  receipt.result = 'failed';
  receipt.error = error instanceof Error ? error.message : String(error);
  receipt.processExits = await desktop
    ?.evaluate(() => (globalThis as typeof globalThis & { d5ProcessExits?: unknown[] }).d5ProcessExits)
    .catch(() => []);
  throw error;
} finally {
  await mkdir(resolve('docs/evidence'), { recursive: true });
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
  await desktop?.close();
  await rm(root, { recursive: true, force: true });
}
