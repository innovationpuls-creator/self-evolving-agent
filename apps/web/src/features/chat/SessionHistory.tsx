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
      ? message.content.filter((part) => part.type === 'toolCall').map((part) => part.name || '工具')
      : [];
    const role =
      { user: '用户', assistant: 'Agent', toolResult: `执行步骤 · ${message.toolName || '工具'}`, system: '系统' }[
        message.role
      ] || message.role;
    const text = messageText(message) || message.errorMessage || (calls.length ? `调用 ${calls.join('、')}` : '');
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
      className="host-history-dialog"
      footer={
        <div className="host-history-footer">
          <span>{selected?.role}</span>
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
                {current.size > 0 && !current.has(entry.id) && <span>历史分支</span>}
                {entry.message?.isError && <span className="host-history-error">失败</span>}
              </span>
              {text.trim() && <span className="host-history-excerpt">{text}</span>}
            </span>
          </label>
        ))}
        {!matches.length && (
          <p className="empty-search" role="status">
            {entries.length ? '没有匹配的消息。' : '还没有保存的历史消息。'}
          </p>
        )}
      </fieldset>
      <details className="host-history-actions">
        <summary>从某条消息继续或整理上下文</summary>
        <Notice title="从所选消息继续会改变后续对话" tone="warn">
          之后的对话会从所选消息接着进行，基于原来对话做出的项目决定可能被撤销。
        </Notice>
        <div className="inline-actions">
          <Button disabled={!selected || blocked} onClick={() => void act('branch')}>
            {busy === 'branch' ? '正在切换…' : '从所选消息继续'}
          </Button>
          <Button kind="ghost" disabled={blocked} onClick={() => void act('compact')}>
            {busy === 'compact' ? '正在整理…' : '整理上下文'}
          </Button>
        </div>
        {session.busy && <p role="status">会话正在执行，结束后可调整。</p>}
      </details>
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}
