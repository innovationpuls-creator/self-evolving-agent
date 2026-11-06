import { useState } from 'react';
import type { Session, Tree } from './session-state';
import { messageText } from './session-state';
import { branchPath, matchesSearch } from '../diagnostics/trajectory-state';
import { Button, Modal, Notice, SearchBox } from '../../components/ui';
import type { Host, Route } from '../../app/types';

export function SessionHistory({
  host,
  session,
  go,
  close,
}: {
  host: Host;
  session: Session;
  go: (route: Route) => void;
  close: () => void;
}) {
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'branch' | 'compact'>();
  const nodes: Tree['entry'][] = [];
  const visit = (tree: Tree[]) => {
    for (const node of tree) {
      if (node.entry.message) nodes.push(node.entry);
      visit(node.children);
    }
  };
  visit(session.tree || []);
  const current = new Set(branchPath(session.tree || [], session.leafId).map((entry) => entry.id));
  const entries = nodes.flatMap((entry) => {
    const message = entry.message;
    if (!message) return [];
    const calls = Array.isArray(message.content)
      ? message.content.filter((part) => part.type === 'toolCall').map((part) => part.name || 'Tool')
      : [];
    const role =
      { user: '用户', assistant: 'Agent', toolResult: `工具 · ${message.toolName || 'Tool'}`, system: '系统' }[
        message.role
      ] || message.role;
    const text =
      messageText(message) || message.errorMessage || (calls.length ? `调用 ${calls.join('、')}` : '没有可显示的文本');
    return [{ entry, role, text }];
  });
  const matches = entries.filter(({ entry, role, text }) => matchesSearch(`${role} ${text} ${entry.id}`, query));
  const selected = matches.find(({ entry }) => entry.id === target);
  const blocked = !!busy || session.busy || session.unavailable || session.skillFailed || host.connection !== 'ready';
  const act = async (action: 'branch' | 'compact') => {
    if (blocked || (action === 'branch' && !selected)) return;
    setBusy(action);
    setError('');
    try {
      await host.api(`/sessions/${session.id}/${action}`, 'POST', { value: selected?.entry.id || '' });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作未完成');
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <Modal
      open
      onClose={close}
      title="会话历史与分支"
      description="查看历史不会切换执行位置。"
      className="host-history-dialog"
      footer={
        <div className="host-history-footer">
          <span>{selected ? `${selected.role} · ${selected.entry.id}` : '选择一条消息查看原文'}</span>
          <Button
            kind="primary"
            disabled={!selected || !!busy}
            onClick={() => {
              if (!selected) return;
              close();
              go({
                page: 'source',
                reference: { sessionId: session.id, entryId: selected.entry.id },
                project: session.cwd,
                originSession: session.id,
              });
            }}
          >
            只读查看
          </Button>
        </div>
      }
    >
      <SearchBox
        value={query}
        onChange={(value) => {
          setQuery(value);
          setTarget('');
        }}
        placeholder="搜索消息内容或工具"
      />
      <fieldset className="host-history-list">
        <legend className="sr-only">历史消息</legend>
        {matches.map(({ entry, role, text }) => (
          <label key={entry.id} className="host-history-row">
            <input
              type="radio"
              name="history-entry"
              value={entry.id}
              checked={target === entry.id}
              onChange={() => setTarget(entry.id)}
            />
            <span className="host-history-message">
              <span className="host-history-meta">
                <strong>{role}</strong>
                <span>{current.size ? (current.has(entry.id) ? '当前分支' : '历史分支') : '分支位置未知'}</span>
                {entry.message?.isError && <span className="host-history-error">调用失败</span>}
              </span>
              <span className="host-history-excerpt">{text}</span>
            </span>
          </label>
        ))}
        {!matches.length && (
          <p className="empty-search" role="status">
            {nodes.length ? '没有匹配的消息，试试其他关键词。' : '还没有保存的历史消息。'}
          </p>
        )}
      </fieldset>
      <details className="host-history-actions">
        <summary>调整执行位置与上下文</summary>
        <Notice title="切换执行位置会影响来源决定" tone="warn">
          来源分支变化可能撤销已有项目决定。查看原始证据不会切换分支。
        </Notice>
        <div className="inline-actions">
          <Button disabled={!selected || blocked} onClick={() => void act('branch')}>
            {busy === 'branch' ? '正在切换…' : '切换到所选位置'}
          </Button>
          <Button kind="ghost" disabled={blocked} onClick={() => void act('compact')}>
            {busy === 'compact' ? '正在压缩…' : '压缩当前上下文'}
          </Button>
        </div>
        {session.busy && <p role="status">会话正在执行，结束后可调整。</p>}
      </details>
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}
