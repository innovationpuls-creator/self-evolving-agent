import { mkdir, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
const owned = new Set<string>();
export async function acquireDataLock(dataDir: string): Promise<() => Promise<void>> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const dir = await realpath(dataDir),
    path = join(dir, 'host.lock');
  if (owned.has(dir)) throw new Error('数据目录正被 Host 或维护操作使用，请先安全退出');
  owned.add(dir);
  let release: (() => Promise<void>) | undefined;
  try {
    let deadOwner = false;
    const info = await stat(path).catch(() => undefined);
    if (info) {
      // Preserve compatibility with D1–D4's PID file. D5's directory lock also
      // causes those binaries to refuse access instead of racing maintenance.
      const owner = Number(
        (await readFile(info.isDirectory() ? join(dir, 'host.pid') : path, 'utf8').catch(() => '0')).trim(),
      );
      if (!Number.isSafeInteger(owner) || owner < 0 || (!owner && !info.isDirectory()))
        throw new Error('invalid lock owner');
      try {
        if (!owner) throw Object.assign(new Error('unwritten owner'), { code: 'ESRCH' });
        process.kill(owner, 0);
        throw new Error('live owner');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
      if (info.isFile()) await unlink(path);
      else deadOwner = true;
    }
    release = await lockfile.lock(dir, {
      lockfilePath: path,
      stale: 10000,
      retries: deadOwner ? { retries: 11, minTimeout: 1000, maxTimeout: 1000, randomize: false } : 0,
    });
    await writeFile(join(dir, 'host.pid'), String(process.pid), { mode: 0o600 });
  } catch {
    if (release) await release().catch(() => {});
    owned.delete(dir);
    throw new Error('数据目录正被 Host 或维护操作使用，请先安全退出');
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      await unlink(join(dir, 'host.pid'));
      await release();
    } finally {
      owned.delete(dir);
    }
  };
}
