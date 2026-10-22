import { resolve } from 'node:path';
import { decodeDataKey } from '../apps/host/storage/data-key.js';
import { backupData, restoreBackup, verifyBackup, type BackupManifest } from '../apps/host/storage/maintenance.js';

const [operation, source, destination] = process.argv.slice(2);
try {
  const encoded = process.env.AGENT_DATA_KEY;
  delete process.env.AGENT_DATA_KEY;
  if (!encoded) throw new Error('需要 AGENT_DATA_KEY');
  const key = decodeDataKey(encoded);
  if (!source) throw new Error('缺少路径');
  let result: BackupManifest;
  if (operation === 'backup' && destination)
    result = await backupData({ dataDir: resolve(source), destination: resolve(destination), key });
  else if (operation === 'restore' && destination)
    result = await restoreBackup({ archive: resolve(source), destination: resolve(destination), key });
  else if (operation === 'verify') result = await verifyBackup({ archive: resolve(source), key });
  else
    throw new Error(
      '用法: npm run data -- backup <dataDir> <newArchive> | verify <archive> | restore <archive> <newDirectory>',
    );
  console.log(
    JSON.stringify({
      operation,
      files: result.files.length,
      sessions: result.sessions,
      previousCheckpoints: result.previousCheckpoints,
      unavailableSessions: result.unavailableSessions,
      unavailableVersions: result.unavailableVersions,
    }),
  );
} catch {
  console.error('维护未完成：请检查参数、密钥、空闲状态、备份完整性及目标是否为新路径。原数据已保留。');
  process.exitCode = 1;
}
