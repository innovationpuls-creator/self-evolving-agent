import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopStartup, HostStartupError, type HostAttempt } from '../apps/desktop/startup.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => {
    resolve = ok;
  });
  return { promise, resolve };
}
const tick = () => new Promise<void>((ok) => setImmediate(ok));
async function fixture(failStartup: boolean | 'data-unreadable' = false) {
  const attempts: Array<{ exited: ReturnType<typeof deferred<void>>; stops: number }> = [];
  let busy = false;
  let exits = 0;
  const startup = new DesktopStartup({
    async unlock() {
      return { key: 'key-available-only-to-maintenance', desktopKeyProof: 'proof' };
    },
    launch(): HostAttempt {
      const attempt = { exited: deferred<void>(), stops: 0 };
      attempts.push(attempt);
      return {
        ready: failStartup
          ? Promise.reject(new HostStartupError(failStartup === 'data-unreadable' ? 'data-unreadable' : 'host-failed'))
          : Promise.resolve('http://127.0.0.1:1234'),
        exited: attempt.exited.promise,
        async stop() {
          attempt.stops++;
          attempt.exited.resolve();
        },
        async prepareMaintenance() {
          if (busy) throw new Error('maintenance-busy');
          attempt.exited.resolve();
          await attempt.exited.promise;
        },
      };
    },
    async open() {},
    render() {},
    forceExit() {},
    relaunch() {},
    exit() {
      exits++;
    },
  });
  startup.begin();
  await tick();
  assert.equal(startup.state.phase, failStartup ? 'failed' : 'ready');
  return {
    startup,
    attempts,
    busy: (value: boolean) => {
      busy = value;
    },
    exits: () => exits,
  };
}

test('maintenance refuses busy Host without stopping it or running a backup', async () => {
  const f = await fixture();
  f.busy(true);
  let ran = false;
  await assert.rejects(
    f.startup.maintain(async () => {
      ran = true;
    }),
  );
  assert.equal(ran, false);
  assert.equal(f.attempts.length, 1);
  assert.equal(f.attempts[0]?.stops, 0);
  assert.equal(f.startup.state.phase, 'ready');
  await f.startup.quit();
});

test('maintenance stops gracefully, rejects overlap and restarts after a failed backup', async () => {
  const f = await fixture();
  const work = deferred<void>();
  const active = f.startup.maintain(async (key) => {
    assert.equal(key.desktopKeyProof, 'proof');
    await work.promise;
    throw new Error('disk-full');
  });
  await tick();
  await assert.rejects(f.startup.maintain(async () => {}));
  assert.equal(f.attempts.length, 1);
  assert.equal(f.attempts[0]?.stops, 0);
  work.resolve();
  await assert.rejects(active, /disk-full/);
  await tick();
  assert.equal(f.attempts.length, 2);
  assert.equal(f.startup.state.phase, 'ready');
  await f.startup.quit();
});

test('quitting waits for a maintenance write and does not restart the Host', async () => {
  const f = await fixture();
  const work = deferred<void>();
  const active = f.startup.maintain(async () => work.promise);
  await tick();
  const quit = f.startup.quit();
  await tick();
  assert.equal(f.exits(), 0);
  work.resolve();
  await active;
  await quit;
  assert.equal(f.exits(), 1);
  assert.equal(f.attempts.length, 1);
});

test('offline restore uses cached unlocked key only after the failed Host fully exits', async () => {
  const f = await fixture(true);
  await assert.rejects(f.startup.maintain(async () => {}));
  assert.equal(f.attempts[0]?.stops, 1);
  const value = await f.startup.maintain(async (key) => key.desktopKeyProof, { allowOffline: true });
  assert.equal(value, 'proof');
  assert.equal(f.startup.state.phase, 'failed');
  assert.equal(f.attempts.length, 1);
  await f.startup.quit();
});

test('offline restore cannot bypass failed secure storage', async () => {
  const startup = new DesktopStartup({
    async unlock() {
      throw new Error('secure-storage-unavailable');
    },
    launch() {
      throw new Error('must not launch');
    },
    async open() {},
    render() {},
    exit() {},
    forceExit() {},
    relaunch() {},
  });
  startup.begin();
  await tick();
  assert.equal(startup.canRestoreOffline, false);
  await assert.rejects(startup.maintain(async () => {}, { allowOffline: true }));
  await startup.quit();
});

test('offline restore remains available with an unlocked key when encrypted credentials are corrupt', async () => {
  const f = await fixture('data-unreadable');
  assert.deepEqual(f.startup.state, { phase: 'failed', code: 'data-unreadable', retryHost: false });
  assert.equal(f.startup.canRestoreOffline, true);
  await f.startup.maintain(async (key) => assert.equal(key.desktopKeyProof, 'proof'), { allowOffline: true });
  assert.equal(f.attempts.length, 1);
  await f.startup.quit();
});
