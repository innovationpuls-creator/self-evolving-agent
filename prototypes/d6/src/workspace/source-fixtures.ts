import type { DiagnosticHistory } from '../../../../apps/host/diagnostics/diagnostic-history';
import { uid } from './host-fixtures';
type SourceEvidence = Awaited<ReturnType<DiagnosticHistory['evidence']>>;
const messages: Array<[number, string, string]> = [
  [1, 'comparison', '两版正文已比较。登录方式由密码登录改为设备授权；兼容附件未读取，旧客户端支持范围无法确认。'],
  [1, 'task-result', '新版项目说明采用设备授权登录；默认差异报告应单列未核实材料。'],
  [2, 'release-notes', '已整理发布说明结构，本次没有提出新的认识。'],
  [3, 'build-result', 'Build completed. Exit code: 0.\n集成测试：未运行。'],
  [3, 'task-result', '发布检查需区分已运行与未运行的测试。'],
  [4, 'partial-check', '已核验两个文件，校验值匹配。其余文件尚未核验；检查随后超时。'],
  [4, 'task-result', '恢复核验只覆盖了清单中的两个文件。'],
  [7, 'research-note', '研究摘录保留原文页码与版本。直接观察与推断应分开记录。'],
];
export const sourceEvidence: SourceEvidence[] = messages.map(([n, entryId, text]) => {
  const content = JSON.stringify({
    id: entryId,
    type: 'message',
    parentId: null,
    timestamp: '2026-10-23T06:33:00.000Z',
    message: {
      role: 'toolResult',
      toolCallId: `call-${entryId}`,
      toolName: n === 3 && entryId === 'build-result' ? 'bash' : 'read',
      content: [{ type: 'text', text }],
      isError: false,
      timestamp: 1792737180000,
    },
  });
  return {
    sessionId: uid(n),
    entryId,
    source: 'checkpoint',
    recovered: false,
    nested: false,
    onSelectedBranch: true,
    available: true,
    truncated: false,
    total: content.length,
    content,
  };
});

sourceEvidence.push({
  sessionId: uid(5),
  entryId: 'settled-task',
  source: 'checkpoint',
  recovered: false,
  onSelectedBranch: false,
  available: false,
  reason: 'entry_missing_from_checkpoint',
  truncated: false,
  total: 0,
});
