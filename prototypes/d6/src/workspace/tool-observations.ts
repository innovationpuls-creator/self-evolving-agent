import type { ToolCatalogEntry } from '../../../../apps/host/skills/tool-catalog';
import { uid } from './host-fixtures';
// Saved snapshots of GET /tools?project=...; membership is independent for each dimension.
export const toolObservations: ToolCatalogEntry[] = [
  {
    name: 'read',
    description: '读取项目文件内容。',
    source: 'Pi 原生基础 Tool',
    exposure: 'native',
    status: 'available',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    sessions: [uid(1), uid(2), uid(7)],
    activeSessions: [uid(1), uid(2), uid(7)],
    callableSessions: [uid(1), uid(2), uid(7)],
  },
  {
    name: 'bash',
    description: '执行 Shell 命令。',
    source: 'Pi 原生基础 Tool',
    exposure: 'native',
    status: 'available',
    parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    sessions: [uid(1), uid(2), uid(7)],
    activeSessions: [uid(1), uid(2), uid(7)],
    callableSessions: [uid(1), uid(2), uid(7)],
  },
  {
    name: 'text_diff',
    description: '比较两份文本。',
    source: '/agent-data/skills/text-diff/extension.ts',
    skillId: uid(407),
    skillName: 'text-diff',
    exposure: 'discovery',
    status: 'available',
    parameters: {
      type: 'object',
      properties: { before: { type: 'string' }, after: { type: 'string' } },
      required: ['before', 'after'],
    },
    sessions: [uid(1), uid(2)],
    activeSessions: [uid(1)],
    callableSessions: [uid(1)],
  },
];
export function toolMembership(entry: ToolCatalogEntry | undefined, sessionId?: string, fresh = true) {
  if (!entry || !sessionId || !fresh) return { loaded: undefined, active: undefined, callable: undefined };
  return {
    loaded: entry.sessions.includes(sessionId),
    active: entry.activeSessions.includes(sessionId),
    callable: entry.callableSessions.includes(sessionId),
  };
}
