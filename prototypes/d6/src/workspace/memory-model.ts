import type { MemoryView, MemoryDetail } from './host-data';

export type MemoryKnowledge = Pick<MemoryView, 'title' | 'content' | 'scope' | 'kind'>;
export interface MemoryCommand {
  baseRevision: number;
  reason: string;
  knowledge?: MemoryKnowledge;
  confirm?: boolean;
  retire?: boolean;
  remove?: boolean;
}
export const accessibleMemory = (r: MemoryView, key?: string) => r.scope === 'global' || (!!key && r.project === key);
// Fixture projection mirrors MemoryService.view/get. Host remains the authority in an integration.
export function projectMemory(detail: MemoryDetail, key?: string): MemoryDetail | undefined {
  if (!accessibleMemory(detail.current, key)) return;
  const view = (r: MemoryView): MemoryView => ({
    ...r,
    sources: r.sources.filter((s) => s.project === key),
    basis: r.basis.filter((s) => s.project === key),
  });
  return { current: view(detail.current), history: detail.history.filter((r) => accessibleMemory(r, key)).map(view) };
}
export function reviseMemory(old: MemoryView, input: MemoryCommand, key?: string, now = Date.now()): MemoryView {
  if (!accessibleMemory(old, key)) throw new Error('这条记忆不在当前项目范围内。');
  if (old.revision !== input.baseRevision) throw new Error('记忆已更新；请核对最新修订，本地草稿仍保留。');
  if (old.status === 'deleted') throw new Error('已移除的记忆不能重新启用。');
  if (old.unavailable && !input.remove) throw new Error('适用依据尚未恢复，暂时不能修改。');
  if (!input.reason.trim() || input.reason.trim().length > 4000) throw new Error('请填写本次操作的依据。');
  if (input.confirm && !input.knowledge) throw new Error('重新确认需要提交当前认识。');
  const next = input.knowledge ?? old;
  if (
    !next.title.trim() ||
    next.title.trim().length > 240 ||
    !next.content.trim() ||
    next.content.trim().length > 32000
  )
    throw new Error('请填写标题和记忆内容，并保持在长度限制内。');
  if (next.scope === 'project' && !key) throw new Error('请先选择项目。');
  const scopeChanged = next.scope !== old.scope || (next.scope === 'project' && old.project !== key);
  const status = input.remove ? 'deleted' : input.retire ? 'withdrawn' : input.confirm ? 'current' : old.status;
  return {
    ...old,
    ...next,
    title: next.title.trim(),
    content: next.content.trim(),
    revision: old.revision + 1,
    previousRevision: old.revision,
    project: next.scope === 'global' ? null : (key ?? null),
    status,
    operation: input.remove
      ? 'delete'
      : input.retire
        ? 'retire'
        : input.confirm
          ? 'confirm'
          : scopeChanged
            ? 'scope'
            : 'revise',
    reason: input.reason.trim(),
    actor: 'user',
    created: now,
    // User-context HTTP writes have no new Session source. Preserve raw prior sources, including hidden ones.
    basis:
      next.kind !== 'decision' || next.scope !== 'project' || input.confirm || scopeChanged || old.kind !== 'decision'
        ? []
        : old.basis,
    isCurrent: true,
    usable: status === 'current',
    unavailable: false,
  };
}
