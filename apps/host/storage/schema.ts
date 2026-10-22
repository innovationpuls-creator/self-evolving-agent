import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const dataFormat = 1;
const supported = new Set(['memory', 'diagnostic', 'evolution', 'reflection_jobs', 'reflection_records']);
// Read-only preflight precedes credentials, migrations and recovery writes.
export function inspectDatabase(dataDir: string) {
  const path = join(dataDir, 'product.sqlite');
  if (!existsSync(path)) return { exists: false, version: 0 };
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (
      db
        .prepare('PRAGMA quick_check')
        .all()
        .some((r) => Object.values(r)[0] !== 'ok')
    )
      throw new Error('业务数据库损坏；请保留原目录并从备份恢复');
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
    if (version > dataFormat || version < 0) throw new Error('数据格式比当前应用新，拒绝不安全的降级');
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='product_migrations'").get())
      for (const row of db.prepare('SELECT name,version FROM product_migrations').all())
        if (!supported.has(String(row.name)) || Number(row.version) !== 1)
          throw new Error('不支持的业务结构版本，原数据已保留');
    return { exists: true, version };
  } finally {
    db.close();
  }
}
export function commitDataFormat(db: DatabaseSync, migrate: () => void = () => {}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    migrate();
    db.exec(`PRAGMA user_version=${dataFormat}; COMMIT`);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
