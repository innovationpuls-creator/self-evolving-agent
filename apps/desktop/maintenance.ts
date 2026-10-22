import { utilityProcess } from 'electron';
import { fileURLToPath } from 'node:url';
import type { UnlockedKey } from './data-key.js';

interface MaintenanceSummary {
  unavailableSessions: string[];
  unavailableVersions: string[];
  previousCheckpoints: string[];
}
export function runMaintenance(
  input: {
    kind: 'backup' | 'restore';
    dataDir: string;
    destination: string;
    archive?: string;
  },
  unlocked: UnlockedKey,
): Promise<MaintenanceSummary> {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(fileURLToPath(new URL('./maintenance-worker.js', import.meta.url)), [], {
      stdio: 'pipe',
      serviceName: 'Agent Data Maintenance',
    });
    child.stdout?.resume();
    child.stderr?.resume();
    let summary: MaintenanceSummary | undefined;
    child.once('spawn', () => child.postMessage({ ...input, key: unlocked.key }));
    child.on('message', (message: unknown) => {
      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === 'done' &&
        'summary' in message
      )
        summary = message.summary as MaintenanceSummary;
    });
    child.once('exit', (code) => {
      if (code === 0 && summary) resolve(summary);
      else reject(new Error('maintenance-failed'));
    });
  });
}
