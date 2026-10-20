import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlockDataKey, type SecureStorage } from '../apps/desktop/data-key.js';
import { DesktopStartup, HostStartupError, type HostAttempt, type StartupState } from '../apps/desktop/startup.js';
import { startupAction, startupPage } from '../apps/desktop/startup-page.js';
import { DataKeyError, decodeDataKey } from '../apps/host/storage/data-key.js';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((ok) => setImmediate(ok));
function fixture() {
  const unlocking = deferred<{ key: string; desktopKeyProof: string }>();
  const states: StartupState[] = [];
  const attempts: Array<{
    ready: ReturnType<typeof deferred<string>>;
    exited: ReturnType<typeof deferred<void>>;
    stops: number;
  }> = [];
  let unlocks = 0,
    exits = 0,
    forceExits = 0,
    relaunches = 0,
    opens = 0;
  let stage: (value: 'accessing' | 'restoring' | 'writing') => void = () => {};
  let failOpen = false,
    failFork = false;
  const startup = new DesktopStartup(
    {
      unlock(_signal, notify) {
        unlocks++;
        stage = notify;
        stage('accessing');
        return unlocking.promise;
      },
      launch(): HostAttempt {
        if (failFork) throw new Error('private failure');
        const attempt = { ready: deferred<string>(), exited: deferred<void>(), stops: 0 };
        attempts.push(attempt);
        return {
          ready: attempt.ready.promise,
          exited: attempt.exited.promise,
          async stop() {
            attempt.stops++;
            attempt.exited.resolve();
          },
        };
      },
      async open() {
        opens++;
        if (failOpen) throw new Error('private page failure');
      },
      render: (state) => states.push(state),
      exit() {
        exits++;
      },
      forceExit() {
        forceExits++;
      },
      relaunch() {
        relaunches++;
      },
    },
    { keyWait: 5, hostWait: 5, restart: 5, exit: 10 },
  );
  return {
    startup,
    states,
    attempts,
    attempt(index: number) {
      const value = attempts[index];
      assert.ok(value);
      return value;
    },
    unlocking,
    notify: (value: 'accessing' | 'restoring' | 'writing') => stage(value),
    unlock: () => unlocking.resolve({ key: randomBytes(32).toString('base64'), desktopKeyProof: 'test-proof' }),
    counts: () => ({ unlocks, exits, forceExits, relaunches, opens }),
    failPage: () => {
      failOpen = true;
    },
    failLaunch: () => {
      failFork = true;
    },
  };
}

test('pending unlock stays visible, becomes slow, and never launches duplicate Host', async () => {
  const f = fixture();
  f.startup.begin();
  f.startup.begin();
  await new Promise((ok) => setTimeout(ok, 15));
  assert.deepEqual(f.startup.state, { phase: 'accessing', slow: true });
  assert.equal(f.counts().unlocks, 1);
  assert.equal(f.attempts.length, 0);
  const quitting = f.startup.quit();
  f.unlock();
  await quitting;
  assert.equal(f.attempts.length, 0);
  assert.equal(f.counts().exits, 1);
});

test('native pending exit is bounded; a late completion cannot write or start Host', async () => {
  const f = fixture();
  f.startup.begin();
  const quitting = f.startup.quit();
  await new Promise((ok) => setTimeout(ok, 20));
  assert.equal(f.counts().forceExits, 1);
  assert.equal(f.attempts.length, 0);
  f.unlock();
  await quitting;
});

test('exit waits for an active atomic write rather than force killing it', async () => {
  const f = fixture();
  f.startup.begin();
  f.notify('writing');
  const quitting = f.startup.quit();
  await new Promise((ok) => setTimeout(ok, 20));
  assert.equal(f.counts().forceExits, 0);
  assert.equal(f.counts().exits, 0);
  f.unlock();
  await quitting;
  assert.equal(f.counts().exits, 1);
});

for (const [message, code] of [
  ['safeStorage.decryptStringAsync is temporarily unavailable. Please try again.', 'storage-unavailable'],
  ['private low-level error containing a secret', 'storage-failed'],
] as const)
  test(`storage failure maps to ${code} without inventing an OS choice`, async () => {
    const f = fixture();
    f.startup.begin();
    f.unlocking.reject(new Error(message));
    await tick();
    assert.deepEqual(f.startup.state, { phase: 'failed', code, retryHost: false });
    assert.ok(!decodeURIComponent(startupPage(f.startup.state)).includes(message));
    f.startup.restart();
    await tick();
    assert.equal(f.counts().relaunches, 1);
    assert.equal(f.counts().exits, 1);
  });

test('Host crash reconnects using cached key and ignores stale messages', async () => {
  const f = fixture();
  f.startup.begin();
  f.unlock();
  await tick();
  const first = f.attempt(0);
  first.ready.resolve('http://127.0.0.1:1111');
  await tick();
  assert.equal(f.startup.state.phase, 'ready');
  first.exited.resolve();
  await new Promise((ok) => setTimeout(ok, 15));
  assert.equal(f.attempts.length, 2);
  assert.equal(f.counts().unlocks, 1);
  f.attempt(1).ready.resolve('http://127.0.0.1:1111');
  await tick();
  assert.equal(f.startup.state.phase, 'ready');
  await f.startup.quit();
});

test('early exit, explicit startup failure, fork failure and page failure have recovery', async () => {
  for (const kind of ['exit', 'failure', 'fork', 'page'] as const) {
    const f = fixture();
    if (kind === 'fork') f.failLaunch();
    if (kind === 'page') f.failPage();
    f.startup.begin();
    f.unlock();
    await tick();
    const first = kind === 'fork' ? undefined : f.attempt(0);
    if (kind === 'exit' && first) first.exited.resolve();
    if (kind === 'failure' && first) first.ready.reject(new HostStartupError('host-failed'));
    if (kind === 'page' && first) first.ready.resolve('http://127.0.0.1:1111');
    await tick();
    assert.equal(f.startup.state.phase, 'failed', kind);
    if (kind !== 'fork') {
      f.startup.retryHost();
      f.startup.retryHost();
      assert.equal(f.attempts.length, 2, kind);
      assert.equal(f.counts().unlocks, 1);
    }
    await f.startup.quit();
  }
});

test('quit cancels crash restart and rejects late ready', async () => {
  const f = fixture();
  f.startup.begin();
  f.unlock();
  await tick();
  f.attempt(0).ready.resolve('http://127.0.0.1:1111');
  await tick();
  f.attempt(0).exited.resolve();
  await tick();
  await f.startup.quit();
  await new Promise((ok) => setTimeout(ok, 15));
  assert.equal(f.attempts.length, 1);
  const g = fixture();
  g.startup.begin();
  g.unlock();
  await tick();
  await g.startup.quit();
  g.attempt(0).ready.resolve('http://127.0.0.1:1111');
  await tick();
  assert.equal(g.counts().opens, 0);
});

test('startup commands are restricted to the current main-frame page and lifecycle', () => {
  const state = { phase: 'failed', code: 'storage-failed', retryHost: false } as const;
  const url = startupPage(state);
  assert.equal(startupAction('https://agent-startup.invalid/restart', url, url, true, state), 'restart');
  for (const target of [
    'https://agent-startup.invalid/restart?x=1',
    'https://evil.invalid/quit',
    'https://agent-startup.invalid/retry',
  ])
    assert.equal(startupAction(target, url, url, true, state), undefined);
  assert.equal(startupAction('https://agent-startup.invalid/quit', url, url, false, state), undefined);
  assert.equal(
    startupAction('https://agent-startup.invalid/quit', 'http://127.0.0.1:1234/', url, true, state),
    undefined,
  );
  assert.equal(startupAction('https://agent-startup.invalid/quit', url, url, true, { phase: 'ready' }), undefined);
  assert.ok(!decodeURIComponent(url).includes('<script'));
  assert.ok(decodeURIComponent(url).includes("default-src 'none'"));
});

const testStorage = (key: string): SecureStorage => ({
  async isAsyncEncryptionAvailable() {
    return true;
  },
  async decryptStringAsync() {
    return { result: key };
  },
  async encryptStringAsync() {
    return Buffer.from('test-double-wrapped-key');
  },
});
async function directory(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'desktop-key-unit-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('new wrapped key is atomic; existing wrapped bytes remain unchanged', () =>
  directory(async (dir) => {
    const key = randomBytes(32).toString('base64'),
      storage = testStorage(key);
    await unlockDataKey(dir, storage, new AbortController().signal, () => {});
    const before = await readFile(join(dir, 'data-key.enc'));
    const second = await unlockDataKey(dir, storage, new AbortController().signal, () => {});
    assert.equal(second.key, key);
    assert.deepEqual(await readFile(join(dir, 'data-key.enc')), before);
    assert.deepEqual(await readdir(dir), ['data-key.enc']);
  }));

test('missing key in an existing data directory does not call secure storage or create identity', () =>
  directory(async (dir) => {
    await writeFile(join(dir, 'product.sqlite'), 'old-data');
    let calls = 0;
    const storage = testStorage(randomBytes(32).toString('base64'));
    storage.isAsyncEncryptionAvailable = async () => {
      calls++;
      return true;
    };
    await assert.rejects(
      unlockDataKey(dir, storage, new AbortController().signal, () => {}),
      (error) => error instanceof DataKeyError && error.code === 'key-missing',
    );
    assert.equal(calls, 0);
    assert.deepEqual(await readdir(dir), ['product.sqlite']);
  }));

test('cancelled native operation never writes a wrapped key on late success', () =>
  directory(async (dir) => {
    const abort = new AbortController(),
      available = deferred<boolean>();
    const storage = testStorage(randomBytes(32).toString('base64'));
    storage.isAsyncEncryptionAvailable = () => available.promise;
    const pending = unlockDataKey(dir, storage, abort.signal, () => {});
    await tick();
    abort.abort();
    available.resolve(true);
    await assert.rejects(pending);
    assert.deepEqual(await readdir(dir), []);
  }));

test('empty and noncanonical decoded keys are rejected while wrapped bytes stay intact', () =>
  directory(async (dir) => {
    const original = Buffer.from('existing-wrapped-key');
    await writeFile(join(dir, 'data-key.enc'), original);
    for (const value of ['', randomBytes(31).toString('base64'), `${randomBytes(32).toString('base64')}\n`]) {
      assert.throws(() => decodeDataKey(value));
      await assert.rejects(unlockDataKey(dir, testStorage(value), new AbortController().signal, () => {}));
    }
    assert.deepEqual(await readFile(join(dir, 'data-key.enc')), original);
  }));

test('directory populated during authorization cannot receive a new master key', () =>
  directory(async (dir) => {
    const storage = testStorage(randomBytes(32).toString('base64'));
    storage.encryptStringAsync = async () => {
      await writeFile(join(dir, 'product.sqlite'), 'old');
      return Buffer.from('wrapped');
    };
    await assert.rejects(unlockDataKey(dir, storage, new AbortController().signal, () => {}));
    assert.deepEqual(await readdir(dir), ['product.sqlite']);
  }));

test('initial local-page failure enters a restartable state before any unlock', async () => {
  const f = fixture();
  f.startup.initialPageFailed();
  assert.deepEqual(f.startup.state, { phase: 'failed', code: 'page-failed', retryHost: false });
  const url = startupPage(f.startup.state);
  assert.equal(startupAction('https://agent-startup.invalid/restart', url, url, true, f.startup.state), 'restart');
  f.startup.restart();
  await tick();
  assert.equal(f.counts().unlocks, 0);
  assert.equal(f.counts().relaunches, 1);
});
