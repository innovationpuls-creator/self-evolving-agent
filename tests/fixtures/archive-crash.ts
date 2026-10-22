import { backupData, restoreBackup } from '../../apps/host/storage/maintenance.js';
process.once(
  'message',
  async (c: { operation: string; dataDir: string; archive: string; destination: string; key: string }) => {
    const key = Buffer.from(c.key, 'base64');
    try {
      if (c.operation === 'backup') await backupData({ dataDir: c.dataDir, destination: c.destination, key });
      else await restoreBackup({ archive: c.archive, destination: c.destination, key });
      process.send?.({ type: 'done' });
      process.exit(0);
    } catch {
      process.exit(1);
    }
  },
);
