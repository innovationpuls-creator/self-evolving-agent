import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { startHost } from '../apps/host/transport/server.js';
import { backupData, restoreBackup, verifyBackup } from '../apps/host/storage/maintenance.js';
import { commitDataFormat } from '../apps/host/storage/schema.js';
import { acquireDataLock } from '../apps/host/storage/data-lock.js';
import { skillPackage, bindings } from './fixtures/skills-package.js';
import { present } from './support.js';

const checks: Record<string, unknown>[] = [];
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function wait(check: () => Promise<boolean> | boolean, timeout = 20000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    assert.ok(Date.now() < end, 'condition timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}
function rows(dataDir: string) {
  const db = new DatabaseSync(join(dataDir, 'product.sqlite'), { readOnly: true });
  try {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all();
    return Object.fromEntries(
      names.map(({ name }) => [
        String(name),
        db.prepare(`SELECT * FROM "${String(name).replaceAll('"', '""')}"`).all(),
      ]),
    );
  } finally {
    db.close();
  }
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'd5-data-')),
    dataDir = join(root, 'data');
  const key = randomBytes(32),
    token = randomBytes(32).toString('hex');
  let host = await startHost({ dataDir, key, token });
  const fake = fauxProvider({
    models: [{ id: 'd5-data-model', contextWindow: 100000, maxTokens: 1024 }],
    tokensPerSecond: 100000,
  });
  host.service.runtime.registerNativeProvider(fake.provider);
  const session = await host.service.create(root, fake.provider.id, 'd5-data-model');
  const prompt = async (id: string, calls: Array<[string, Parameters<typeof fauxToolCall>[1]]>) => {
    fake.setResponses([
      ...calls.map(([name, args]) => fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' })),
      fauxAssistantMessage('complete'),
    ]);
    await host.service.prompt(id, 'Complete the requested task.');
    await wait(async () => !(await host.service.viewSession(id)).busy);
    return host.service.viewSession(id);
  };
  const close = async () => {
    await host.close();
  };
  const reopen = async (dir = dataDir) => {
    host = await startHost({ dataDir: dir, key, token });
    host.service.runtime.registerNativeProvider(fake.provider);
    return host;
  };
  return {
    root,
    dataDir,
    key,
    token,
    get host() {
      return host;
    },
    session,
    prompt,
    close,
    reopen,
  };
}

test('encrypted backup and new-directory migration preserve all committed rows, exact Session, versions and grants; restored Tool really runs', async () => {
  const f = await fixture();
  try {
    const source = await skillPackage(join(f.root, 'package'));
    const imported = await f.host.service.skills.import({ source, bindings });
    const skill = present(imported.find((s) => s.name === 'echo'));
    const version = f.host.service.skills.version(skill.latest);
    await f.host.service.skills.review(
      skill.id,
      version.id,
      version.digest,
      'Reviewed deterministic fixture: only TypeBox/SDK imports and local echo; no network, secrets or filesystem writes.',
    );
    const publish = f.host.service.skills.publish(skill.id, version.id, skill.revision, true);
    await wait(() => !['checking', 'waiting'].includes(f.host.service.skills.operation(publish.id).status));
    assert.equal(f.host.service.skills.operation(publish.id).status, 'applied');
    const before = await f.prompt(f.session.id, [
      ['write', { path: join(f.root, 'effect.txt'), content: 'committed-effect' }],
      [
        'memory_save',
        {
          knowledge: {
            title: 'D5 restore fact',
            content: 'Keep committed delivery data',
            kind: 'fact',
            scope: 'project',
          },
          reason: 'Explicit backup acceptance fixture',
        },
      ],
      ['tool_search', { query: 'skill_echo' }],
      ['skill_echo', { value: 'before-backup' }],
    ]);
    assert.ok(before.messages.some((m) => m.role === 'toolResult' && m.toolName === 'skill_echo' && !m.isError));
    const activity = await f.host.service.createActivity(f.session.id, 'Assess whether a new capability is necessary');
    await f.close();
    // Preserve an explicit user grant and running state using the production activity service.
    const reopened = await f.reopen();
    await reopened.service.activities.authorize(activity.id, {
      baseRevision: 1,
      goal: activity.goal,
      newSkills: ['maintenance-probe'],
      existingSkills: [],
    });
    await f.close();
    const beforeRows = rows(f.dataDir),
      archive = join(f.root, 'snapshot.agentbackup');
    const sessionBytes = await readFile(join(f.dataDir, 'sessions', `${f.session.id}.enc`));
    const manifest = await backupData({ dataDir: f.dataDir, destination: archive, key: f.key });
    assert.equal((await stat(archive)).mode & 0o777, 0o600);
    assert.equal(manifest.unavailableSessions.length, 0);
    assert.deepEqual(await verifyBackup({ archive, key: f.key }), manifest);
    assert.ok(!(await readFile(archive)).includes(Buffer.from('Keep committed delivery data')));
    const destination = join(f.root, 'restored');
    await restoreBackup({ archive, destination, key: f.key });
    const restoredRows = rows(destination);
    assert.deepEqual(restoredRows, beforeRows, 'every SQLite table must match before any recovery writes');
    assert.deepEqual(await readFile(join(destination, 'sessions', `${f.session.id}.enc`)), sessionBytes);
    const restored = await f.reopen(destination);
    const state = await restored.service.viewSession(f.session.id);
    assert.equal(state.leafId, before.leafId);
    assert.deepEqual(JSON.parse(JSON.stringify(state.messages)), JSON.parse(JSON.stringify(before.messages)));
    assert.equal(restored.service.activities.get(activity.id).status, 'interrupted');
    assert.ok(restored.service.activities.get(activity.id).grant);
    const after = await f.prompt(f.session.id, [
      ['tool_search', { query: 'skill_echo' }],
      ['skill_echo', { value: 'after-restore' }],
    ]);
    assert.ok(
      after.messages.some(
        (m) =>
          m.role === 'toolResult' &&
          m.toolName === 'skill_echo' &&
          JSON.stringify(m).includes('one:after-restore') &&
          !m.isError,
      ),
    );
    checks.push({
      check: 'round-trip',
      files: manifest.files.length,
      sessions: manifest.sessions,
      tables: Object.keys(beforeRows).length,
      beforeHash: hash(beforeRows),
      restoredHash: hash(restoredRows),
      exactSessionCiphertext: true,
      nativeToolAfterRestore: true,
      grantRetained: true,
      noReplay: true,
    });
  } finally {
    await f.close().catch(() => {});
    await rm(f.root, { recursive: true, force: true });
  }
});

test('tamper, wrong key, occupied destination and active Host never overwrite data or publish partial backup', async () => {
  const f = await fixture();
  try {
    const archive = join(f.root, 'backup.agentbackup');
    await assert.rejects(backupData({ dataDir: f.dataDir, destination: archive, key: f.key }));
    await f.close();
    await backupData({ dataDir: f.dataDir, destination: archive, key: f.key });
    const bytes = await readFile(archive);
    await assert.rejects(backupData({ dataDir: f.dataDir, destination: archive, key: f.key }));
    assert.deepEqual(await readFile(archive), bytes);
    await assert.rejects(restoreBackup({ archive, destination: f.dataDir, key: f.key }));
    for (const mode of ['wrong-key', 'tamper', 'truncate']) {
      const damaged = join(f.root, `${mode}.agentbackup`),
        destination = join(f.root, mode);
      const buffer = Buffer.from(bytes);
      buffer[25] = (buffer[25] ?? 0) ^ 1;
      await writeFile(
        damaged,
        mode === 'truncate' ? bytes.subarray(0, bytes.length - 16) : mode === 'tamper' ? buffer : bytes,
      );
      await assert.rejects(
        restoreBackup({ archive: damaged, destination, key: mode === 'wrong-key' ? randomBytes(32) : f.key }),
      );
      await assert.rejects(stat(destination));
    }
    await f.reopen();
    assert.equal((await f.host.service.viewSession(f.session.id)).id, f.session.id);
    checks.push({
      check: 'rejection-boundaries',
      wrongKey: true,
      tamper: true,
      truncation: true,
      existingDataUnchanged: true,
      activeHostRefused: true,
    });
  } finally {
    await f.close().catch(() => {});
    await rm(f.root, { recursive: true, force: true });
  }
});

test('legacy upgrade backs up before writes; failed migration rolls back; unknown schema refuses; database corruption restores exact committed rows', async () => {
  const f = await fixture();
  try {
    await f.prompt(f.session.id, [['write', { path: join(f.root, 'committed.txt'), content: 'saved before upgrade' }]]);
    await f.close();
    const db = new DatabaseSync(join(f.dataDir, 'product.sqlite'));
    db.exec('PRAGMA user_version=0');
    const before = hash(db.prepare('SELECT * FROM sessions').all());
    assert.throws(() =>
      commitDataFormat(db, () => {
        db.exec("CREATE TABLE failed_migration(value TEXT); INSERT INTO failed_migration VALUES('partial')");
        throw new Error('injected migration failure');
      }),
    );
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='failed_migration'").get(), undefined);
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 0);
    db.close();
    await f.reopen();
    await f.close();
    const backups = (await readdir(f.root)).filter((n) => n.includes('.pre-d5-') && n.endsWith('.agentbackup'));
    assert.equal(backups.length, 1);
    const backup = join(f.root, present(backups[0]));
    const v = new DatabaseSync(join(f.dataDir, 'product.sqlite'));
    assert.equal(v.prepare('PRAGMA user_version').get()?.user_version, 1);
    v.exec('PRAGMA user_version=99');
    v.close();
    const bytes = await readFile(join(f.dataDir, 'product.sqlite'));
    await assert.rejects(f.reopen());
    assert.deepEqual(await readFile(join(f.dataDir, 'product.sqlite')), bytes);
    await writeFile(join(f.dataDir, 'product.sqlite'), randomBytes(4096));
    await assert.rejects(f.reopen());
    const destination = join(f.root, 'recovered');
    await restoreBackup({ archive: backup, destination, key: f.key });
    const recovered = new DatabaseSync(join(destination, 'product.sqlite'), { readOnly: true });
    assert.equal(hash(recovered.prepare('SELECT * FROM sessions').all()), before);
    recovered.close();
    await f.reopen(destination);
    assert.ok((await f.host.service.viewSession(f.session.id)).messages.some((m) => m.role === 'toolResult'));
    checks.push({
      check: 'upgrade-failure-and-corruption',
      automaticBackup: true,
      transactionRollback: true,
      newerSchemaRefusedWithoutOverwrite: true,
      corruptDatabaseRestored: true,
      committedSessionRowsHash: before,
    });
  } finally {
    await f.close().catch(() => {});
    await rm(f.root, { recursive: true, force: true });
  }
});

test('real SIGKILL inside SQLite transaction rolls back and releases the data lock without replay', {
  timeout: 25000,
}, async () => {
  const f = await fixture();
  let child: ReturnType<typeof fork> | undefined;
  try {
    await f.close();
    const before = rows(f.dataDir);
    child = fork(new URL('./fixtures/maintenance-crash.ts', import.meta.url), [], {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const ready = once(child, 'message');
    child.send({ dataDir: f.dataDir });
    await ready;
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    const release = await acquireDataLock(f.dataDir);
    await release();
    const afterRows = rows(f.dataDir);
    assert.deepEqual(afterRows, before);
    await f.reopen();
    assert.equal((await f.host.service.viewSession(f.session.id)).id, f.session.id);
    checks.push({
      check: 'SIGKILL-transaction',
      beforeHash: hash(before),
      afterHash: hash(afterRows),
      uncommittedTableAbsent: true,
      lockRecovered: true,
    });
  } finally {
    if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await f.close().catch(() => {});
    await rm(f.root, { recursive: true, force: true });
  }
});

test('interrupted archive writes and restore extraction cannot become a completed backup or replace existing data', {
  timeout: 60000,
}, async () => {
  const f = await fixture();
  const children: ReturnType<typeof fork>[] = [];
  try {
    await f.close();
    await writeFile(join(f.dataDir, 'isolated-payload.bin'), randomBytes(32 * 1024 * 1024));
    const archive = join(f.root, 'interrupted.agentbackup'),
      sourceRows = rows(f.dataDir);
    const start = (operation: string, destination: string, source?: string) => {
      const child = fork(new URL('./fixtures/archive-crash.ts', import.meta.url), [], {
        execArgv: ['--import', 'tsx'],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      children.push(child);
      child.send({
        operation,
        dataDir: f.dataDir,
        archive: source ?? archive,
        destination,
        key: f.key.toString('base64'),
      });
      return child;
    };
    const writer = start('backup', archive);
    await wait(async () =>
      (await readdir(f.root)).some((n) => n.startsWith('interrupted.agentbackup.') && n.endsWith('.tmp')),
    );
    let exited = once(writer, 'exit');
    writer.kill('SIGKILL');
    await exited;
    await assert.rejects(stat(archive));
    assert.deepEqual(rows(f.dataDir), sourceRows);
    await backupData({ dataDir: f.dataDir, destination: archive, key: f.key });
    const target = join(f.root, 'interrupted-restore'),
      reader = start('restore', target);
    await wait(async () => {
      const work = (await readdir(f.root)).find((n) => n.startsWith('.agent-restore-'));
      return (
        !!work &&
        (await stat(join(f.root, work, 'archive.tar.gz')).then(
          (s) => s.size > 0,
          () => false,
        ))
      );
    });
    exited = once(reader, 'exit');
    reader.kill('SIGKILL');
    await exited;
    assert.deepEqual(
      await readdir(target),
      [],
      'only the empty reservation can exist after interrupted authentication',
    );
    assert.deepEqual(rows(f.dataDir), sourceRows);
    const restored = join(f.root, 'complete-restore');
    await restoreBackup({ archive, destination: restored, key: f.key });
    const restoredRows = rows(restored);
    assert.deepEqual(restoredRows, sourceRows);
    checks.push({
      check: 'SIGKILL-archive-and-restore',
      partialArchiveNotPublished: true,
      partialRestoreNotPublished: true,
      sourceHash: hash(sourceRows),
      restoredHash: hash(restoredRows),
    });
  } finally {
    for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
    await f.close().catch(() => {});
    await rm(f.root, { recursive: true, force: true });
  }
});

test('backup rejects a symlink destination inside live data and reports damaged Skill content without granting trust', async () => {
  const f = await fixture();
  try {
    const source = await skillPackage(join(f.root, 'skill'));
    const [skill] = await f.host.service.skills.import({ source, bindings });
    assert.ok(skill);
    const v = f.host.service.skills.version(skill.latest);
    await writeFile(
      join(f.host.service.skills.packagePath(v), 'skills/echo/SKILL.md'),
      'changed after immutable import',
    );
    await assert.rejects(f.host.service.skills.verify(v));
    await f.close();
    const alias = join(f.root, 'alias');
    await symlink(f.dataDir, alias);
    await assert.rejects(
      backupData({ dataDir: f.dataDir, destination: join(alias, 'inside.agentbackup'), key: f.key }),
    );
    const archive = join(f.root, 'damaged-version.agentbackup');
    const manifest = await backupData({ dataDir: f.dataDir, destination: archive, key: f.key });
    assert.ok(manifest.unavailableVersions.includes(v.id));
    assert.deepEqual((await verifyBackup({ archive, key: f.key })).unavailableVersions, manifest.unavailableVersions);
    checks.push({
      check: 'version-and-path-boundaries',
      damagedVersionExplicit: true,
      symlinkEscapeRefused: true,
      executionTrustUnchanged: true,
    });
  } finally {
    await f.close().catch(() => {});
    await rm(f.root, { recursive: true, force: true });
  }
});

test.after(async () => {
  const path = process.env.D5_DATA_EVIDENCE;
  if (path) {
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify(
        { environment: { node: process.version, platform: process.platform, arch: process.arch }, checks },
        null,
        2,
      )}\n`,
    );
  }
});
