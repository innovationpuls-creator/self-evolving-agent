import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';

export type VMProcessIdentity = { pid: number; startAbsolute: number };
type Manifest = {
  id: string;
  ownerPid: number;
  disk: string;
  config: string;
  launched: boolean;
  identities: VMProcessIdentity[];
};
export const VM_DISK_BYTES = 2 * 1024 ** 3;
export const VM_FREE_RESERVE = 16 * 1024 ** 3;
const budgetRoot = join(homedir(), 'Library/Caches/dev.personal.agent/d4-vm-leases');

export async function withVMDiskBudgetLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  // Preserve the previous implementation's unproven crash state on upgrade.
  if (
    await stat(join(root, 'lock')).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    })
  )
    throw new Error('isolated_disk_legacy_lock_retained');
  const database = new DatabaseSync(join(root, 'budget.sqlite'));
  let acquired = false;
  try {
    // SQLite's OS file lock is released on process death, including SIGKILL.
    // Keep the transaction across the asynchronous filesystem operation.
    for (let n = 0; n < 100; n++) {
      try {
        database.exec('BEGIN IMMEDIATE');
        acquired = true;
        break;
      } catch (error) {
        if ((error as { errcode?: number }).errcode !== 5) throw error;
      }
      await delay(50);
    }
    if (!acquired) throw new Error('isolated_disk_budget_locked');
    return await action();
  } finally {
    try {
      if (acquired) database.exec('ROLLBACK');
    } finally {
      database.close();
    }
  }
}
const locked = withVMDiskBudgetLock;

/** Two persistent slots bound disposable disks across all experimental Host processes. */
export class VMDisk {
  private manifest: Manifest;
  private ownsDisk = false;
  private ownsConfig = false;
  private disposed = false;
  private constructor(
    private root: string,
    private slot: string,
    id: string,
  ) {
    this.manifest = {
      id,
      ownerPid: process.pid,
      disk: join(slot, `${id}.ext4`),
      config: join(slot, `${id}.json`),
      launched: false,
      identities: [],
    };
  }
  get disk() {
    return this.manifest.disk;
  }
  get config() {
    return this.manifest.config;
  }
  private async persist() {
    await writeFile(join(this.slot, 'manifest.next'), JSON.stringify(this.manifest), { mode: 0o600 });
    await rename(join(this.slot, 'manifest.next'), join(this.slot, 'manifest.json'));
  }
  static async allocate(
    id: string,
    work: string,
    source: string,
    options: {
      root?: string;
      available?: () => Promise<number>;
    } = {},
  ) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('isolated_disk_id_invalid');
    const root = options.root ?? budgetRoot;
    return locked(root, async () => {
      let slot: string | undefined;
      for (let i = 0; i < 2; i++) {
        const path = join(root, String(i));
        try {
          await mkdir(path);
          slot = path;
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
      }
      if (!slot) throw new Error('isolated_disk_budget_exhausted: recover retained leases before starting more VMs');
      const lease = new VMDisk(root, slot, id);
      try {
        await lease.persist();
        await mkdir(work, { recursive: true });
        if ((await stat(source)).size > VM_DISK_BYTES) throw new Error('isolated_disk_size_limit');
        const fs = await statfs(slot);
        const free = options.available ? await options.available() : fs.bavail * fs.bsize;
        if (free < VM_FREE_RESERVE + 2 * VM_DISK_BYTES) throw new Error('isolated_disk_free_space_floor');
        await copyFile(source, lease.disk, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL);
        lease.ownsDisk = true;
        await writeFile(lease.config, '{}', { flag: 'wx', mode: 0o600 });
        lease.ownsConfig = true;
        return lease;
      } catch (error) {
        await lease.removeFiles();
        throw error;
      }
    });
  }
  /** Persist before spawn. A crash before OS binding retains the slot. */
  async launch() {
    await locked(this.root, async () => {
      this.manifest.launched = true;
      await this.persist();
    });
  }
  async bind(identities: VMProcessIdentity[]) {
    await locked(this.root, async () => {
      this.manifest.identities = identities;
      await this.persist();
    });
  }
  private async removeFiles() {
    if (this.ownsDisk) await rm(this.disk, { force: true });
    if (this.ownsConfig) await rm(this.config, { force: true });
    await rm(this.slot, { recursive: true });
    this.disposed = true;
  }
  async dispose(stopped: boolean) {
    await locked(this.root, async () => {
      if (this.disposed) return;
      if (this.manifest.launched && !stopped) throw new Error('isolated_disk_shutdown_unproven');
      await this.removeFiles();
    });
  }
  /** Explicit recovery uses trusted OS observations, never Guest completion. */
  static async recover(inspect: (pid: number) => Promise<VMProcessIdentity | { absent: true }>, root = budgetRoot) {
    return locked(root, async () => {
      const recovered: string[] = [];
      for (let i = 0; i < 2; i++) {
        const slot = join(root, String(i));
        let manifest: Manifest;
        try {
          manifest = JSON.parse(await readFile(join(slot, 'manifest.json'), 'utf8')) as Manifest;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
        if (!Number.isInteger(manifest.ownerPid) || manifest.ownerPid <= 0)
          throw new Error('isolated_disk_manifest_invalid');
        try {
          process.kill(manifest.ownerPid, 0);
          continue;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
        if (manifest.launched) {
          if (manifest.identities.length !== 1) continue;
          const previous = manifest.identities[0]!;
          const current = await inspect(previous.pid);
          if (!('absent' in current) && current.startAbsolute === previous.startAbsolute) continue;
        }
        const lease = new VMDisk(root, slot, manifest.id);
        if (lease.disk !== manifest.disk || lease.config !== manifest.config || !/^[a-f0-9-]{36}$/.test(manifest.id))
          throw new Error('isolated_disk_manifest_invalid');
        lease.manifest = manifest;
        lease.ownsDisk = lease.ownsConfig = true;
        await lease.removeFiles();
        recovered.push(manifest.id);
      }
      return recovered;
    });
  }
}
