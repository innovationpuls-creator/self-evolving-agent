import type { MemoryView } from './memory.js';

export function memoryFeedback(memory: MemoryView) {
  const action = {
    create: '新增记忆',
    revise: '更新认识',
    confirm: '重新确认认识',
    retire: '撤销认识',
    scope: '调整作用域',
    delete: '删除记忆',
    branch: '来源分支变化',
  }[memory.operation];
  return {
    operation: memory.operation,
    message: `${action}：${memory.title} · 修订 #${memory.revision}${memory.previousRevision ? `（替代 #${memory.previousRevision}）` : ''}`,
    id: memory.id,
    revision: memory.revision,
    previousRevision: memory.previousRevision,
    currentKnowledge: memory.isCurrent && memory.status === 'current' && memory.usable,
    kind: memory.kind,
    status: memory.status,
    sources: memory.sources,
  };
}
