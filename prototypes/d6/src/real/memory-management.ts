import type { MemoryContent, MemoryView } from '../../../../apps/host/memory/memory';
import type { Api, MemoryDetail } from './types';
export type MemoryAction = 'create' | 'revise' | 'confirm' | 'retire' | 'delete';
export interface MemoryDraft {
  key: string;
  project: string;
  id?: string;
  action: MemoryAction;
  base?: MemoryView;
  knowledge: MemoryContent;
  reason: string;
  phase: 'editing' | 'saving' | 'uncertain' | 'failed' | 'conflict' | 'saved';
  error?: string;
  receipt?: MemoryView;
  latest?: MemoryDetail;
}
/** Page-memory drafts only. Never a replacement for Host state or a write queue. */
export class MemoryDrafts {
  private values = new Map<string, MemoryDraft>();
  private revision = 0;
  version = () => this.revision;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get = (key: string) => this.values.get(key);
  all = () => [...this.values.values()];
  set(value: MemoryDraft) {
    this.values.set(value.key, value);
    this.revision++;
    this.listeners.forEach((fn) => {
      fn();
    });
  }
  remove(key: string) {
    this.values.delete(key);
    this.revision++;
    this.listeners.forEach((fn) => {
      fn();
    });
  }
}
export const memoryKey = (project: string, id: string | undefined, action: MemoryAction) =>
  JSON.stringify([project, id, action]);
export const memorySuffix = (project: string) => `?${new URLSearchParams(project ? { project } : {})}`;
export const readMemory = (api: Api, project: string, id: string) =>
  api<MemoryDetail>(
    `/memory/${encodeURIComponent(id)}?${new URLSearchParams({ ...(project ? { project } : {}), includeHistory: 'true' })}`,
  );
export function newMemoryDraft(project: string, action: MemoryAction, base?: MemoryView): MemoryDraft {
  return {
    key: memoryKey(project, base?.id, action),
    project,
    id: base?.id,
    action,
    base,
    knowledge: base
      ? { title: base.title, content: base.content, scope: base.scope, kind: base.kind }
      : { title: '', content: '', scope: project ? 'project' : 'global', kind: 'fact' },
    reason: '',
    phase: 'editing',
  };
}
export async function reconcileMemory(api: Api, store: MemoryDrafts, draft: MemoryDraft) {
  if (!draft.receipt) {
    if (draft.id) {
      const latest = await readMemory(api, draft.project, draft.id);
      store.set({ ...draft, latest });
      return latest;
    }
    return undefined;
  }
  const latest = await readMemory(api, draft.project, draft.receipt.id);
  if (!latest.history.some((r) => r.revision === draft.receipt?.revision))
    throw Error('Host 尚未返回已提交修订，请重新核对。');
  store.set({ ...draft, latest, phase: 'saved', error: undefined });
  return latest;
}
/** No automatic retry: create has no idempotency key, and a lost reply may already be committed. */
export async function submitMemory(api: Api, store: MemoryDrafts, draft: MemoryDraft) {
  if (
    !['editing', 'failed'].includes(draft.phase) ||
    draft.receipt ||
    store.get(draft.key)?.phase === 'saving' ||
    store.get(draft.key)?.receipt
  )
    return;
  const pending = { ...draft, phase: 'saving' as const, error: undefined };
  store.set(pending);
  let receipt: MemoryView;
  try {
    receipt = await api<MemoryView>(
      draft.id
        ? `/memory/${draft.id}${draft.action === 'delete' ? '' : '/revise'}${memorySuffix(draft.project)}`
        : `/memory${memorySuffix(draft.project)}`,
      draft.action === 'delete' ? 'DELETE' : 'POST',
      {
        reason: draft.reason,
        ...(draft.base ? { baseRevision: draft.base.revision } : {}),
        ...(['create', 'revise', 'confirm'].includes(draft.action) ? { knowledge: draft.knowledge } : {}),
        ...(draft.action === 'confirm' ? { confirm: true } : {}),
        ...(draft.action === 'retire' ? { retire: true } : {}),
      },
    );
  } catch (e) {
    const status = e && typeof e === 'object' && 'status' in e ? e.status : undefined;
    store.set({
      ...draft,
      phase: status === 409 ? 'conflict' : typeof status === 'number' && status < 500 ? 'failed' : 'uncertain',
      error: e instanceof Error ? e.message : '操作结果尚未确认',
    });
    return;
  }
  const acknowledged = { ...pending, receipt };
  store.set(acknowledged);
  try {
    await reconcileMemory(api, store, acknowledged);
  } catch (e) {
    store.set({ ...acknowledged, phase: 'uncertain', error: e instanceof Error ? e.message : '尚未完成权威状态同步' });
  }
}
