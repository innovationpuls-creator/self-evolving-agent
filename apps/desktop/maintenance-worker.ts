import { backupData, restoreBackup } from '../host/storage/maintenance.js';
import { decodeDataKey } from '../host/storage/data-key.js';

interface Input {
  kind: 'backup' | 'restore';
  key: string;
  dataDir: string;
  archive?: string;
  destination: string;
}
process.parentPort?.once('message', (event) => {
  void (async () => {
    const input = event.data as Input;
    const key = decodeDataKey(input.key);
    let result: Awaited<ReturnType<typeof backupData>>;
    if (input.kind === 'backup')
      result = await backupData({ dataDir: input.dataDir, destination: input.destination, key });
    else if (input.kind === 'restore' && input.archive)
      result = await restoreBackup({ archive: input.archive, destination: input.destination, key });
    else throw new Error('invalid-maintenance-operation');
    process.parentPort?.postMessage({
      type: 'done',
      summary: {
        unavailableSessions: result.unavailableSessions,
        unavailableVersions: result.unavailableVersions,
        previousCheckpoints: result.previousCheckpoints,
      },
    });
    process.exit(0);
  })().catch(() => {
    process.parentPort?.postMessage({ type: 'failed' });
    process.exit(1);
  });
});
