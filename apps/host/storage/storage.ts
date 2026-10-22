import { type SessionEntry, type SessionHeader, SessionManager } from '@earendil-works/pi-coding-agent';

export { EncryptedStore } from './encrypted-store.js';

export interface Snapshot {
  header: SessionHeader;
  entries: SessionEntry[];
  leafId: string | null;
}
export function snapshot(manager: SessionManager): Snapshot {
  const header = manager.getHeader();
  if (!header) throw new Error('会话没有有效头信息');
  return structuredClone({ header, entries: manager.getEntries(), leafId: manager.getLeafId() });
}
export function restore(saved: Snapshot) {
  if (
    !saved ||
    !saved.header ||
    !Array.isArray(saved.entries) ||
    (saved.leafId !== null && !saved.entries.some((entry) => entry.id === saved.leafId))
  )
    throw new Error('会话检查点结构无效');
  const manager = SessionManager.inMemory(saved.header.cwd, { id: saved.header.id }, [saved.header, ...saved.entries]);
  if (saved.leafId === null) manager.resetLeaf();
  else if (saved.leafId !== manager.getLeafId()) manager.branch(saved.leafId);
  return manager;
}

export { SensitiveData } from '../../shared/sensitive-data.js';
