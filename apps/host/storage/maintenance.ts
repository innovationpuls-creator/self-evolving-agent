import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  chmod,
  cp,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { backup, DatabaseSync } from 'node:sqlite';
import { versionDigest, type SkillVersion } from '../skills/skills.js';
import { dependencyIdentity } from '../skills/skill-dependencies.js';
import { acquireDataLock } from './data-lock.js';
import { EncryptedStore, restore, type Snapshot } from './storage.js';
import { inspectDatabase, dataFormat } from './schema.js';

const magic = Buffer.from('AGBAK001');
const excluded = new Set(['host.lock', 'host.pid', 'product.sqlite', 'product.sqlite-wal', 'product.sqlite-shm']);
interface FileRecord {
  path: string;
  size: number;
  sha256?: string;
  link?: string;
}
export interface BackupManifest {
  format: 1;
  dataFormat: number;
  pi: '1.3.0';
  created: string;
  files: FileRecord[];
  sessions: number;
  previousCheckpoints: string[];
  unavailableSessions: string[];
  unavailableVersions: string[];
}
function inside(root: string, path: string) {
  const r = relative(root, path);
  return !isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`);
}
async function syncDir(path: string) {
  if (process.platform === 'win32') return;
  const fd = await open(path, 'r');
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
}
async function digest(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function inventory(root: string, dir = root): Promise<FileRecord[]> {
  const files: FileRecord[] = [];
  for (const entry of (await readdir(dir)).sort()) {
    const path = join(dir, entry),
      name = relative(root, path);
    if (name === 'backup-manifest.json') continue;
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      if (!inside(root, await realpath(path))) throw new Error('备份包含越界符号链接');
      files.push({ path: name, size: 0, link: await readlink(path) });
    } else if (info.isDirectory()) files.push(...(await inventory(root, path)));
    else if (info.isFile()) files.push({ path: name, size: info.size, sha256: await digest(path) });
    else throw new Error('备份包含不支持的文件类型');
  }
  return files;
}
async function validateData(dir: string, key: Buffer) {
  dir = await realpath(dir);
  inspectDatabase(dir);
  const store = new EncryptedStore(dir, key);
  if (!(await store.read('credentials.enc'))) throw new Error('备份缺少可验证的加密凭据身份');
  const ids = new Set<string>();
  for (const name of await readdir(join(dir, 'sessions')).catch(() => [] as string[])) {
    const id = /^([a-f0-9-]{36})\.enc(?:\.prev)?$/.exec(name)?.[1];
    if (id) ids.add(id);
  }
  const previousCheckpoints: string[] = [];
  const unavailableSessions: string[] = [];
  const unavailableVersions: string[] = [];
  for (const id of ids) {
    let valid = false;
    for (const suffix of ['', '.prev']) {
      try {
        const saved = await store.read<{ record: { id: string; cwd: string }; session: Snapshot }>(
          `sessions/${id}.enc${suffix}`,
        );
        if (
          !saved ||
          saved.record.id !== id ||
          saved.session.header.id !== id ||
          saved.record.cwd !== saved.session.header.cwd
        )
          continue;
        restore(saved.session);
        valid = true;
        if (suffix) previousCheckpoints.push(id);
        break;
      } catch {
        /* Try previous authenticated checkpoint; preserve both. */
      }
    }
    if (!valid) unavailableSessions.push(id);
  }
  const db = new DatabaseSync(join(dir, 'product.sqlite'), { readOnly: true });
  try {
    if (
      db
        .prepare('PRAGMA integrity_check')
        .all()
        .some((r) => Object.values(r)[0] !== 'ok')
    )
      throw new Error('备份数据库完整性检查失败');
    if (db.prepare("SELECT name FROM sqlite_master WHERE name='sessions'").get())
      for (const row of db.prepare('SELECT id FROM sessions').all())
        if (!ids.has(String(row.id))) unavailableSessions.push(String(row.id));
    if (db.prepare("SELECT name FROM sqlite_master WHERE name='skill_versions'").get())
      for (const row of db.prepare('SELECT data FROM skill_versions').all()) {
        const version = JSON.parse(String(row.data)) as SkillVersion;
        const root = resolve(dir, 'skills', 'versions'),
          path = resolve(root, version.snapshot);
        try {
          if (!inside(root, path) || !(await stat(path)).isDirectory()) throw new Error('missing snapshot');
          const packagePath = resolve(path, version.packageRoot || '.');
          if (!inside(path, packagePath)) throw new Error('escaping package');
          if (version.extensions.length) await dependencyIdentity(path, packagePath);
          if ((await versionDigest(path, version)) !== version.digest) throw new Error('invalid snapshot');
        } catch {
          unavailableVersions.push(version.id);
        }
      }
  } finally {
    db.close();
  }
  return { sessions: ids.size, previousCheckpoints, unavailableSessions, unavailableVersions };
}
function tar(args: string[]) {
  const child = spawn(process.platform === 'darwin' ? '/usr/bin/tar' : '/bin/tar', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: '/usr/bin:/bin', COPYFILE_DISABLE: '1' },
  });
  child.stderr.resume();
  const done = new Promise<void>((ok, fail) => {
    child.once('error', () => fail(new Error('系统 tar 不可用')));
    child.once('exit', (code) => (code === 0 ? ok() : fail(new Error('归档操作失败'))));
  });
  void done.catch(() => {});
  return { child, done };
}
/** lockHeld is reserved for startup migration under the same directory lock. */
export async function backupData(input: { dataDir: string; destination: string; key: Buffer; lockHeld?: boolean }) {
  if (input.key.length !== 32) throw new Error('数据密钥无效');
  const source = await realpath(input.dataDir),
    destination = join(await realpath(dirname(resolve(input.destination))), basename(input.destination));
  if (inside(source, destination)) throw new Error('备份必须保存在数据目录外');
  const release = input.lockHeld ? async () => {} : await acquireDataLock(source);
  let work: string | undefined;
  const temp = `${destination}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await validateData(source, input.key);
    work = await mkdtemp(join(dirname(source), '.agent-backup-'));
    await chmod(work, 0o700);
    const data = join(work, 'data');
    await mkdir(data, { mode: 0o700 });
    for (const name of await readdir(source)) {
      if (excluded.has(name) || name.endsWith('.tmp')) continue;
      await cp(join(source, name), join(data, name), { recursive: true, dereference: false, verbatimSymlinks: true });
    }
    const db = new DatabaseSync(join(source, 'product.sqlite'), { readOnly: true });
    try {
      await backup(db, join(data, 'product.sqlite'));
    } finally {
      db.close();
    }
    const state = await validateData(data, input.key);
    const manifest: BackupManifest = {
      format: 1,
      dataFormat,
      pi: '1.3.0',
      created: new Date().toISOString(),
      files: await inventory(data),
      ...state,
    };
    const file = await open(join(data, 'backup-manifest.json'), 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(manifest));
    } finally {
      await file.close();
    }
    const nonce = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', input.key, nonce);
    cipher.setAAD(magic);
    const output = await open(temp, 'wx', 0o600);
    try {
      await output.write(Buffer.concat([magic, nonce]));
    } finally {
      await output.close();
    }
    const packed = tar(['-czf', '-', '-C', data, '.']);
    try {
      await pipeline(packed.child.stdout, cipher, createWriteStream(temp, { flags: 'a' }));
      await packed.done;
    } finally {
      if (packed.child.exitCode === null) packed.child.kill();
    }
    const final = await open(temp, 'a');
    try {
      await final.write(cipher.getAuthTag());
      await final.sync();
    } finally {
      await final.close();
    }
    await link(temp, destination);
    await syncDir(dirname(destination));
    return manifest;
  } finally {
    await rm(temp, { force: true });
    if (work) await rm(work, { recursive: true, force: true });
    await release();
  }
}
async function unpack(archive: string, key: Buffer, work: string) {
  const info = await stat(archive);
  if (key.length !== 32 || info.size < 36) throw new Error('备份或数据密钥无效');
  const fd = await open(archive, 'r');
  const header = Buffer.alloc(20),
    tag = Buffer.alloc(16);
  try {
    await fd.read(header, 0, 20, 0);
    await fd.read(tag, 0, 16, info.size - 16);
  } finally {
    await fd.close();
  }
  if (!header.subarray(0, 8).equals(magic)) throw new Error('不支持的备份格式');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(8));
  decipher.setAAD(magic);
  decipher.setAuthTag(tag);
  const plain = join(work, 'archive.tar.gz');
  // Authenticate the entire archive before extraction.
  await pipeline(
    createReadStream(archive, { start: 20, end: info.size - 17 }),
    decipher,
    createWriteStream(plain, { flags: 'wx', mode: 0o600 }),
  );
  const data = join(work, 'data');
  await mkdir(data, { mode: 0o700 });
  const extracted = tar(['-xzf', plain, '-C', data, '--no-same-owner']);
  extracted.child.stdout.resume();
  await extracted.done;
  const manifest = JSON.parse(await readFile(join(data, 'backup-manifest.json'), 'utf8')) as BackupManifest;
  if (manifest.format !== 1 || manifest.pi !== '1.3.0' || manifest.dataFormat > dataFormat)
    throw new Error('备份版本与当前应用不兼容');
  if (JSON.stringify(await inventory(data)) !== JSON.stringify(manifest.files)) throw new Error('备份文件校验不一致');
  const state = await validateData(data, key);
  if (
    state.sessions !== manifest.sessions ||
    JSON.stringify(state.previousCheckpoints) !== JSON.stringify(manifest.previousCheckpoints) ||
    JSON.stringify(state.unavailableSessions) !== JSON.stringify(manifest.unavailableSessions) ||
    JSON.stringify(state.unavailableVersions) !== JSON.stringify(manifest.unavailableVersions)
  )
    throw new Error('备份状态校验不一致');
  return { manifest, data };
}
export async function verifyBackup(input: { archive: string; key: Buffer }) {
  const work = await mkdtemp(join(dirname(resolve(input.archive)), '.agent-verify-'));
  await chmod(work, 0o700);
  try {
    return (await unpack(input.archive, input.key, work)).manifest;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
export async function restoreBackup(input: { archive: string; destination: string; key: Buffer }) {
  const destination = resolve(input.destination);
  await mkdir(destination, { mode: 0o700 }); // Never replace an existing directory.
  let work: string | undefined;
  try {
    work = await mkdtemp(join(dirname(destination), '.agent-restore-'));
    await chmod(work, 0o700);
    const { manifest, data } = await unpack(input.archive, input.key, work);
    await rm(join(data, 'backup-manifest.json'));
    for (const file of manifest.files) {
      if (file.link) continue;
      const fd = await open(join(data, file.path), 'r');
      try {
        await fd.sync();
      } finally {
        await fd.close();
      }
    }
    await syncDir(data);
    await rename(data, destination);
    await syncDir(dirname(destination));
    return manifest;
  } finally {
    if (work) await rm(work, { recursive: true, force: true });
    await rmdir(destination).catch(() => {}); // Only our empty reservation.
  }
}
