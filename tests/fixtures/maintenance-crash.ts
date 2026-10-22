import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { acquireDataLock } from '../../apps/host/storage/data-lock.js';
process.once('message', async (config: { dataDir: string }) => {
  await acquireDataLock(config.dataDir);
  const db = new DatabaseSync(join(config.dataDir, 'product.sqlite'));
  db.exec(
    "BEGIN IMMEDIATE; CREATE TABLE interrupted_upgrade(value TEXT); INSERT INTO interrupted_upgrade VALUES('not committed')",
  );
  process.send?.({ type: 'inside-transaction' });
  setInterval(() => {}, 1000);
});
