import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';

const persistent = process.argv.includes('--persistent');
const pendingExit = process.argv.includes('--pending-exit');
assert.ok(!(persistent && pendingExit), 'pending-exit must use isolated data');
const root = await mkdtemp(join(tmpdir(), 'agent-keychain-runtime-'));
const data = persistent
  ? join(homedir(), 'Library/Application Support/self-evolving-agent/agent-data')
  : join(root, 'data');
const executable = resolve(process.env.AGENT_APP_PATH ?? 'release/Agent-darwin-arm64/Agent.app/Contents/MacOS/Agent');
const output = resolve(
  `docs/evidence/desktop-keychain-${persistent ? 'persistent' : pendingExit ? 'pending-exit' : 'isolated'}.json`,
);
const receipt: Record<string, unknown> = {
  time: new Date().toISOString(),
  dataScope: persistent ? 'real persistent user directory' : 'temporary isolated directory',
  systemAuthorization: 'real Keychain; no mock or automated system approval',
  reflectionBusinessChain: 'blocked',
};
const hashKey = async () =>
  createHash('sha256')
    .update(await readFile(join(data, 'data-key.enc')))
    .digest('hex');
let app: ElectronApplication | undefined;
const launch = async () => {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  delete env.AGENT_DESKTOP_DATA_DIR;
  if (!persistent) env.AGENT_DESKTOP_DATA_DIR = data;
  return _electron.launch({
    executablePath: executable,
    args: persistent ? [] : [`--user-data-dir=${join(root, 'profile')}`],
    env,
    timeout: 30000,
  });
};
async function request(page: Page, path: string, body?: unknown) {
  return page.evaluate(
    async ({ path, body }) => {
      const response = await fetch(`/api${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem('agent-connection-token')}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    },
    { path, body },
  );
}
try {
  if (persistent) receipt.wrappedKeyBefore = await hashKey();
  const started = Date.now();
  app = await launch();
  receipt.mockKeychainSwitch = await app.evaluate(({ app }) => app.commandLine.hasSwitch('use-mock-keychain'));
  assert.equal(receipt.mockKeychainSwitch, false);
  const page = await app.firstWindow({ timeout: 10000 });
  receipt.firstWindowMs = Date.now() - started;
  receipt.initialPhase = await page
    .locator('main')
    .getAttribute('data-startup-phase')
    .catch(() => null);
  console.log(JSON.stringify({ firstWindow: true, dataScope: receipt.dataScope, phase: receipt.initialPhase }));
  if (pendingExit) {
    await page.waitForTimeout(16000);
    const phase = await page
      .locator('main')
      .getAttribute('data-startup-phase')
      .catch(() => null);
    receipt.phaseAfter16Seconds = phase;
    if (phase === 'accessing') {
      assert.match(await page.locator('h1').innerText(), /仍在等待/);
      await page.screenshot({ path: resolve('release/keychain-waiting.png') });
      const process = app.process(),
        exit = new Promise<{ code: number | null; signal: string | null }>((ok) =>
          process.once('exit', (code, signal) => ok({ code, signal })),
        );
      const beforeQuit = Date.now();
      await page.getByRole('link', { name: '退出 Agent' }).click({ noWaitAfter: true });
      const result = await Promise.race([
        exit,
        new Promise<never>((_, fail) => setTimeout(() => fail(new Error('pending exit exceeded 8 seconds')), 8000)),
      ]);
      const elapsedMs = Date.now() - beforeQuit;
      assert.equal(result.signal, 'SIGKILL');
      assert.ok(elapsedMs >= 1800 && elapsedMs < 8000, `unexpected pending-exit duration: ${elapsedMs}`);
      receipt.pendingExit = { ...result, elapsedMs };
      app = undefined;
      receipt.result = 'passed';
    } else {
      receipt.result = 'not-observed';
      receipt.pendingExit = 'native operation already settled; not a pending-exit pass';
    }
  } else {
    await page.locator('.shell').waitFor({ timeout: 180000 });
    const keyHash = await hashKey();
    receipt.wrappedKeyAfter = keyHash;
    if (persistent) assert.equal(keyHash, receipt.wrappedKeyBefore);
    const sessions = await request(page, '/sessions');
    receipt.initialSessionCount = sessions.length;
    const session = persistent
      ? undefined
      : await request(page, '/sessions', { cwd: root, provider: 'openai-codex', model: 'gpt-6-luna' });
    await app.evaluate(({ safeStorage }) => {
      const counts = { availability: 0, decrypt: 0, encrypt: 0 };
      const availability = safeStorage.isAsyncEncryptionAvailable.bind(safeStorage);
      const decrypt = safeStorage.decryptStringAsync.bind(safeStorage),
        encrypt = safeStorage.encryptStringAsync.bind(safeStorage);
      safeStorage.isAsyncEncryptionAvailable = () => {
        counts.availability++;
        return availability();
      };
      safeStorage.decryptStringAsync = (bytes) => {
        counts.decrypt++;
        return decrypt(bytes);
      };
      safeStorage.encryptStringAsync = (text) => {
        counts.encrypt++;
        return encrypt(text);
      };
      Object.assign(globalThis, { keychainSmokeCounts: counts });
    });
    const oldPid = await app.evaluate(({ app }) => app.getAppMetrics().find((item) => item.name === 'Agent Host')?.pid);
    assert.ok(oldPid);
    process.kill(oldPid, 'SIGKILL');
    const deadline = Date.now() + 30000;
    let newPid: number | undefined;
    while (Date.now() < deadline) {
      await page.waitForTimeout(300);
      newPid = await app.evaluate(({ app }) => app.getAppMetrics().find((item) => item.name === 'Agent Host')?.pid);
      if (newPid && newPid !== oldPid) break;
    }
    assert.ok(newPid && newPid !== oldPid);
    await page.waitForFunction(() => document.querySelector('.connection')?.textContent?.includes('已连接'), {
      timeout: 30000,
    });
    const counts = await app.evaluate(() => Reflect.get(globalThis, 'keychainSmokeCounts'));
    assert.deepEqual(counts, { availability: 0, decrypt: 0, encrypt: 0 });
    receipt.hostRecoveryKeychainCalls = counts;
    if (session) assert.equal((await request(page, `/sessions/${session.id}`)).id, session.id);
    await app.close();
    app = undefined;
    app = await launch();
    const reopened = await app.firstWindow();
    await reopened.locator('.shell').waitFor({ timeout: 180000 });
    assert.equal(await hashKey(), keyHash);
    if (session) assert.equal((await request(reopened, `/sessions/${session.id}`)).id, session.id);
    else
      assert.deepEqual(
        (await request(reopened, '/sessions')).map((item: { id: string }) => item.id).sort(),
        sessions.map((item: { id: string }) => item.id).sort(),
      );
    receipt.sameBuildReopen = 'passed';
    receipt.result = 'passed';
    await app.close();
    app = undefined;
  }
} catch (error) {
  receipt.result = 'blocked';
  receipt.error = error instanceof Error ? error.message : 'runtime failure';
  console.log(JSON.stringify({ result: 'blocked', reason: receipt.error }));
  process.exitCode = 1;
} finally {
  if (persistent && receipt.wrappedKeyBefore) {
    receipt.wrappedKeyAfter = await hashKey();
    assert.equal(receipt.wrappedKeyAfter, receipt.wrappedKeyBefore);
  }
  if (app) {
    // Exercise the product quit path; kill only this test's child if cleanup itself stalls.
    const timer = setTimeout(() => app?.process().kill('SIGKILL'), 12000);
    await app.close().catch(() => {});
    clearTimeout(timer);
  }
  await mkdir(resolve('docs/evidence'), { recursive: true });
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(receipt));
}
