import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import { VMDisk, withVMDiskBudgetLock } from '../apps/host/evolution/sandbox/vm-disk.js';
import { desktopPackagePolicy } from '../scripts/desktop-package-policy.js';
import { trimDependencyMetadata } from '../scripts/desktop-package-resources.js';
import { writeNewDownload } from '../scripts/d4-download.js';

test('VM disk lifecycle removes files and reuses slots across repeated runs', async () => {
  const work = await mkdtemp(join(tmpdir(), 'd4-disk-test-'));
  try {
    const source = join(work, 'base');
    const root = join(work, 'leases');
    await writeFile(source, 'fixed base disk');
    for (let i = 0; i < 20; i++) {
      const lease = await VMDisk.allocate(randomUUID(), work, source, { root });
      await lease.launch();
      await lease.bind([{ pid: process.pid, startAbsolute: 123 }]);
      await assert.rejects(lease.dispose(false), /shutdown_unproven/);
      assert.ok((await stat(lease.disk)).size);
      await lease.dispose(true);
      await assert.rejects(stat(lease.disk), { code: 'ENOENT' });
      await assert.rejects(stat(lease.config), { code: 'ENOENT' });
    }
    assert.deepEqual(await readdir(root), ['budget.sqlite']);
    assert.equal(await readFile(source, 'utf8'), 'fixed base disk');
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test('VM disk budget counts retained failures and refuses low space before copying', async () => {
  const work = await mkdtemp(join(tmpdir(), 'd4-disk-test-'));
  try {
    const source = join(work, 'base'),
      root = join(work, 'leases');
    await writeFile(source, 'base');
    await assert.rejects(
      VMDisk.allocate(randomUUID(), work, source, { root, available: async () => 1024 }),
      /free_space_floor/,
    );
    assert.deepEqual(await readdir(root), ['budget.sqlite']);
    const a = await VMDisk.allocate(randomUUID(), work, source, { root });
    const b = await VMDisk.allocate(randomUUID(), work, source, { root });
    await a.launch();
    await assert.rejects(VMDisk.allocate(randomUUID(), work, source, { root }), /budget_exhausted/);
    await assert.rejects(a.dispose(false), /shutdown_unproven/);
    await b.dispose(false);
    await a.dispose(true);
    const id = randomUUID(),
      disk = join(work, `${id}.ext4`);
    await writeFile(disk, 'pre-existing');
    const separate = await VMDisk.allocate(id, work, source, { root });
    assert.notEqual(separate.disk, disk);
    await separate.dispose(false);
    assert.equal(await readFile(disk, 'utf8'), 'pre-existing');
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test('disk recovery requires dead Host, bound VM identity and trusted absence', async () => {
  const work = await mkdtemp(join(tmpdir(), 'd4-disk-test-'));
  try {
    const source = join(work, 'base'),
      root = join(work, 'leases');
    await writeFile(source, 'base');
    const lease = await VMDisk.allocate(randomUUID(), work, source, { root });
    await lease.launch();
    await lease.bind([{ pid: 1234, startAbsolute: 789 }]);
    assert.deepEqual(await VMDisk.recover(async () => ({ absent: true }), root), []);
    const manifestPath = join(root, '0/manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.ownerPid = 2147483647;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      VMDisk.recover(async () => {
        throw Error('observer unavailable');
      }, root),
      /observer unavailable/,
    );
    assert.deepEqual(await VMDisk.recover(async () => ({ pid: 1234, startAbsolute: 789 }), root), []);
    assert.deepEqual(await VMDisk.recover(async () => ({ pid: 1234, startAbsolute: 790 }), root), [manifest.id]);
    await assert.rejects(stat(lease.disk), { code: 'ENOENT' });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test('desktop package profiles keep experimental components out of the normal output', () => {
  assert.deepEqual(desktopPackagePolicy({}), { xpc: false, vm: false, profile: 'desktop', out: 'release' });
  assert.equal(desktopPackagePolicy({ AGENT_D4_VM_PROTOTYPE: '1' }).out, 'release/d4-vm-client');
  assert.throws(
    () => desktopPackagePolicy({ AGENT_D4_VM_PROTOTYPE: '1', AGENT_D4_SANDBOX_PROTOTYPE: '1' }),
    /separate packages/,
  );
  assert.throws(
    () => desktopPackagePolicy({ AGENT_D4_VM_PROTOTYPE: '1', AGENT_PACKAGE_OUT: 'release' }),
    /cannot overwrite/,
  );
});

test('concurrent recoveries cannot remove a newly reused disk slot', async () => {
  const work = await mkdtemp(join(tmpdir(), 'd4-disk-test-'));
  try {
    const source = join(work, 'base'),
      root = join(work, 'leases');
    await writeFile(source, 'base');
    const old = await VMDisk.allocate(randomUUID(), work, source, { root });
    await old.launch();
    await old.bind([{ pid: 1234, startAbsolute: 789 }]);
    const path = join(root, '0/manifest.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    manifest.ownerPid = 2147483647;
    await writeFile(path, JSON.stringify(manifest));
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((ok) => {
      entered = ok;
    });
    const gate = new Promise<void>((ok) => {
      release = ok;
    });
    const recovery = VMDisk.recover(async () => {
      entered();
      await gate;
      return { absent: true };
    }, root);
    await ready;
    const second = VMDisk.recover(async () => ({ absent: true }), root);
    const allocation = VMDisk.allocate(randomUUID(), work, source, { root });
    release();
    await Promise.all([recovery, second]);
    const current = await allocation;
    assert.ok((await stat(current.disk)).size);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).disk, current.disk);
    await current.dispose(false);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test('package trimming preserves runtime files and output aliases cannot target normal release', async () => {
  const work = await mkdtemp(join(tmpdir(), 'd4-package-test-'));
  try {
    for (const name of ['index.js', 'source.ts', 'package.json', 'README.md', 'index.js.map', 'index.d.ts'])
      await writeFile(join(work, name), name);
    await trimDependencyMetadata(work);
    assert.deepEqual((await readdir(work)).sort(), ['README.md', 'index.js', 'package.json', 'source.ts']);
    const alias = join(work, 'release-alias');
    await symlink(join(process.cwd(), 'release'), alias);
    assert.throws(
      () => desktopPackagePolicy({ AGENT_D4_VM_PROTOTYPE: '1', AGENT_PACKAGE_OUT: alias }),
      /cannot overwrite/,
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test('different-cwd Host processes share one disk budget', { timeout: 15000 }, async () => {
  const work = await mkdtemp(join(tmpdir(), 'd4-disk-process-test-'));
  const children: ReturnType<typeof spawn>[] = [];
  const endings: Promise<void>[] = [];
  try {
    await writeFile(join(work, 'base'), 'base');
    const launch = async (cwd: string) => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          import.meta.resolve('tsx'),
          fileURLToPath(new URL('./fixtures/d4-disk-child.ts', import.meta.url)),
          work,
        ],
        { cwd, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      children.push(child);
      endings.push(new Promise<void>((ok) => child.once('close', () => ok())));
      return await new Promise<{ disk?: string; error?: string }>((ok, fail) => {
        let buffer = '';
        child.once('error', fail);
        child.stdout.on('data', (bytes: Buffer) => {
          buffer += bytes.toString();
          if (buffer.includes('\n')) ok(JSON.parse(buffer.slice(0, buffer.indexOf('\n'))));
        });
        child.once('close', () => fail(Error('disk child exited before receipt')));
      });
    };
    const first = await launch(work),
      second = await launch(tmpdir());
    assert.ok(first.disk);
    assert.ok(second.disk);
    assert.equal(dirname(dirname(first.disk)), dirname(dirname(second.disk)));
    const third = await launch(tmpdir());
    assert.match(third.error ?? '', /budget_exhausted/);
  } finally {
    for (const child of children) child.stdin?.end();
    await Promise.all(endings);
    await rm(work, { recursive: true, force: true });
  }
});

test('failed download removes only its own partial file', async () => {
  const work = await mkdtemp(join(tmpdir(), 'd4-download-test-'));
  try {
    const path = join(work, 'archive.next');
    await writeFile(path, 'previous-attempt');
    const broken = () =>
      Readable.from(
        (async function* () {
          yield 'partial';
          throw Error('network failed');
        })(),
      );
    await assert.rejects(writeNewDownload(path, broken(), new PassThrough()), { code: 'EEXIST' });
    assert.equal(await readFile(path, 'utf8'), 'previous-attempt');
    await rm(path);
    await assert.rejects(writeNewDownload(path, broken(), new PassThrough()), /network failed/);
    await assert.rejects(stat(path), { code: 'ENOENT' });
    await writeNewDownload(path, Readable.from(['complete']), new PassThrough());
    assert.equal(await readFile(path, 'utf8'), 'complete');
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test('OS disk budget lock survives competing Hosts and releases after SIGKILL', { timeout: 15000 }, async () => {
  const work = await mkdtemp(join(tmpdir(), 'd4-lock-crash-'));
  const child = spawn(
    process.execPath,
    [
      '--import',
      import.meta.resolve('tsx'),
      fileURLToPath(new URL('./fixtures/d4-disk-child.ts', import.meta.url)),
      work,
      'hold-lock',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const ended = new Promise<void>((ok) => child.once('close', () => ok()));
  try {
    await new Promise<void>((ok, fail) => {
      child.once('error', fail);
      child.stdout.once('data', () => ok());
      child.once('close', () => fail(Error('lock holder closed early')));
    });
    let entered = false;
    const contender = withVMDiskBudgetLock(join(work, 'leases'), async () => {
      entered = true;
    });
    await new Promise((ok) => setTimeout(ok, 150));
    assert.equal(entered, false, 'live Host owns the OS lock');
    child.kill('SIGKILL');
    await ended;
    await contender;
    assert.equal(entered, true, 'kernel released the dead Host lock');
    await withVMDiskBudgetLock(join(work, 'leases'), async () => {});
  } finally {
    child.kill('SIGKILL');
    await ended;
    await rm(work, { recursive: true, force: true });
  }
});
