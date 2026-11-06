import React from 'react';
import type { MemoryView } from '../../../../host/memory/memory.js';
import type { EvidenceTarget } from '../diagnostics/evidence.js';
import type { Api } from '../diagnostics/evidence.js';
import type { Message } from './session-state.js';

export function MemoryToolFeedback({
  message,
  api,
  project,
  onMemory,
  onEvidence,
}: {
  message: Message;
  api: Api;
  project: string;
  onMemory: (id: string, revision?: number, project?: string) => void;
  onEvidence: (target: EvidenceTarget) => void;
}) {
  const feedback =
    !message.isError && ['memory_save', 'memory_revise', 'memory_retire'].includes(message.toolName ?? '')
      ? message.details?.memory
      : undefined;
  const [expanded, setExpanded] = React.useState(false);
  const [current, setCurrent] = React.useState<MemoryView>();
  const [error, setError] = React.useState('');
  const [revision, setRevision] = React.useState(0);
  React.useEffect(() => {
    if (!expanded || !feedback) return;
    let controller: AbortController | undefined;
    const load = () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      void api<{ current: MemoryView }>(
        `/memory/${feedback.id}?${new URLSearchParams({ project })}`,
        'GET',
        undefined,
        signal,
      )
        .then((value) => {
          if (!signal.aborted) {
            setCurrent(value.current);
            setError('');
          }
        })
        .catch((reason: unknown) => {
          if (!signal.aborted) {
            setCurrent(undefined);
            setError(reason instanceof Error ? reason.message : '当前记忆状态不可用');
          }
        });
    };
    load();
    window.addEventListener('agent-memory-changed', load);
    window.addEventListener('agent-reconnected', load);
    return () => {
      controller?.abort();
      window.removeEventListener('agent-memory-changed', load);
      window.removeEventListener('agent-reconnected', load);
    };
  }, [api, project, expanded, feedback?.id, revision]);
  if (!feedback) return null;
  return (
    <section className="memory-tool-feedback" aria-label="记忆操作结果">
      <p>{feedback.message}</p>
      <div className="actions">
        <button type="button" onClick={() => onMemory(feedback.id, feedback.revision, project)}>
          查看本次修订
        </button>
        {feedback.sources.map((source) => (
          <button
            type="button"
            key={`${source.sessionId}:${source.entryId}`}
            onClick={() => onEvidence({ sessionId: source.sessionId, entryId: source.entryId })}
          >
            查看来源证据
          </button>
        ))}
      </div>
      <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary>当前记忆状态</summary>
        {current && (
          <p>
            {current.status === 'deleted'
              ? '已删除'
              : current.status === 'withdrawn'
                ? '已停用'
                : current.usable
                  ? '生效中'
                  : '来源不可用'}{' '}
            · 最新修订 #{current.revision}
            {current.revision !== feedback.revision ? ' · 本次操作的修订已成为历史' : ''}
          </p>
        )}
        {!current && !error && <p role="status">正在读取当前状态…</p>}
        {error && (
          <p role="alert">
            {error}{' '}
            <button type="button" onClick={() => setRevision((value) => value + 1)}>
              重试
            </button>
          </p>
        )}
        <button type="button" onClick={() => onMemory(feedback.id, undefined, project)}>
          查看当前记忆
        </button>
      </details>
    </section>
  );
}
