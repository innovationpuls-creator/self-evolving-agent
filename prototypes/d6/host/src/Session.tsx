import { useEffect, useRef, useState } from 'react';
import type { useHost } from '../../../../apps/web/src/app/use-host';
import { messageText } from '../../../../apps/web/src/features/chat/session-state';
import { useReflectionCatalog } from '../../../../apps/web/src/features/reflection/reflection-state';
import { MemoryToolFeedback } from '../../../../apps/web/src/features/chat/MemoryToolFeedback';
import { EvidenceView } from '../../../../apps/web/src/features/diagnostics/EvidenceView';
import { Button, Notice } from './ui';
import { Markdown } from '../../src/components/content';
import type { Route } from './navigation';
import { Failure, projectName } from './Reflection';
type Host = ReturnType<typeof useHost>;
export function SessionPage({
  host,
  route,
  go,
}: {
  host: Host;
  route: Extract<Route, { page: 'session' }>;
  go: (route: Route) => void;
}) {
  const id = route.sessionId;
  const [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  const hostRef = useRef(host);
  hostRef.current = host;
  useEffect(() => {
    let active = true;
    setError('');
    if (id)
      void hostRef.current.open(id).catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '会话读取失败');
      });
    return () => {
      active = false;
    };
  }, [id, retry]);
  if (!id)
    return (
      <>
        <h1 tabIndex={-1}>会话</h1>
        {!host.sessions.length && <p>这个 Host 尚无会话。</p>}
        <div className="live-session-picker">
          {host.sessions.map((s) => (
            <button type="button" key={s.id} data-focus={s.id} onClick={() => go({ page: 'session', sessionId: s.id })}>
              <h2>{s.title || '未命名会话'}</h2>
              <span>{s.cwd}</span>
            </button>
          ))}
        </div>
      </>
    );
  const session = host.selected?.id === id ? host.selected : undefined;
  return (
    <>
      <header className="aw-heading">
        <div>
          <h1 tabIndex={-1}>{session?.title || host.sessions.find((s) => s.id === id)?.title || '会话'}</h1>
          <p title={session?.cwd}>{session?.cwd}</p>
        </div>
        <Button data-focus="session-reflections" onClick={() => go({ page: 'reflections', sessionId: id, offset: 0 })}>
          反思记录
        </Button>
      </header>
      {error && <Failure error={error} retry={() => setRetry((n) => n + 1)} />}
      {!session && !error && <p role="status">正在读取会话…</p>}
      {session && (
        <>
          <SessionReflection host={host} sessionId={id} go={go} />
          {session.unavailable && (
            <Notice title="会话暂不可恢复" tone="warn">
              Host 未能恢复完整会话，不能将空内容解释为没有历史。
            </Notice>
          )}
          {session.interrupted && (
            <Notice title="执行曾中断" tone="warn">
              已保存的历史仍可阅读；不会自动重放原任务。
            </Notice>
          )}
          {session.error && (
            <Notice title="会话中的错误" tone="warn">
              {session.error}
            </Notice>
          )}
          {route.entryId && (
            <section className="live-located-source">
              <h2>定位的原始条目</h2>
              <EvidenceView
                key={`${id}:${route.entryId}`}
                api={host.api}
                reference={{ sessionId: id, entryId: route.entryId }}
              />
            </section>
          )}
          <div className="live-conversation">
            {session.messages?.map((message, i) =>
              message.display === false ? null : message.role === 'toolResult' ? (
                <details key={`tool-${i}`} className="live-tool">
                  <summary>
                    {message.toolName || 'Tool'}
                    {message.isError ? ' · 调用失败' : ''}
                  </summary>
                  <MemoryToolFeedback
                    message={message}
                    api={host.api}
                    project={session.cwd}
                    onMemory={(memoryId, revision, project) =>
                      go({
                        page: 'result',
                        target: { kind: 'memory', id: memoryId, revision, project: project || session.cwd },
                        originSession: id,
                      })
                    }
                    onEvidence={(reference) =>
                      go({ page: 'source', reference, project: session.cwd, originSession: id })
                    }
                  />
                  <pre>{messageText(message)}</pre>
                </details>
              ) : message.role === 'user' || message.role === 'assistant' ? (
                <article key={`message-${i}`} className={`live-message ${message.role}`}>
                  <h2>{message.role === 'user' ? '你' : 'Agent'}</h2>
                  <Markdown text={messageText(message)} />
                  {message.errorMessage && <p role="alert">{message.errorMessage}</p>}
                </article>
              ) : null,
            )}
            {session.streamingMessage && (
              <article className="live-message assistant">
                <h2>Agent</h2>
                <Markdown text={messageText(session.streamingMessage)} />
              </article>
            )}
            {session.busy && (
              <p role="status">{session.execution ? `正在执行 ${session.execution.name}` : 'Agent 正在处理…'}</p>
            )}
          </div>
          <Composer
            key={id}
            host={host}
            id={id}
            busy={session.busy}
            disabled={host.connection !== 'ready' || !!session.unavailable}
          />
          <p className="aw-muted live-session-project">
            {projectName(session.cwd)} · {session.model}
          </p>
        </>
      )}
    </>
  );
}
function SessionReflection({ host, sessionId, go }: { host: Host; sessionId: string; go: (route: Route) => void }) {
  const read = useReflectionCatalog(host.api, sessionId, 0, true);
  const job = read.catalog?.jobs[0];
  return (
    <div className="live-session-reflection">
      {read.error ? (
        <Failure error={read.error} retry={read.refresh} />
      ) : job ? (
        <Button
          kind="ghost"
          data-focus="session-latest-reflection"
          onClick={() => go({ page: 'reflections', sessionId, offset: 0 })}
        >
          {job.status === 'pending'
            ? '反思等待中'
            : job.status === 'running'
              ? '反思运行中'
              : job.status === 'succeeded'
                ? '查看任务检查'
                : job.status === 'interrupted'
                  ? '反思已中断'
                  : job.status === 'failed'
                    ? '反思检查失败'
                    : '反思需要处理'}
        </Button>
      ) : null}
      {job?.error && <p className="live-error">{job.error}</p>}
    </div>
  );
}
const drafts = new Map<string, string>();
function Composer({ host, id, busy, disabled }: { host: Host; id: string; busy: boolean; disabled: boolean }) {
  const [draft, setDraft] = useState(drafts.get(id) || ''),
    [sending, setSending] = useState(false),
    [error, setError] = useState('');
  const send = async () => {
    setSending(true);
    setError('');
    try {
      await host.api(`/sessions/${id}/prompt`, 'POST', { text: draft });
      drafts.delete(id);
      setDraft('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '发送失败');
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="live-composer">
      <textarea
        aria-label="继续会话"
        placeholder="继续这个会话…"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          drafts.set(id, e.target.value);
        }}
        disabled={disabled || sending}
      />
      <div>
        {busy ? (
          <Button
            disabled={disabled || sending}
            onClick={async () => {
              try {
                await host.api(`/sessions/${id}/stop`, 'POST', {});
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : '停止失败');
              }
            }}
          >
            停止
          </Button>
        ) : (
          <Button kind="primary" disabled={disabled || sending || !draft.trim()} onClick={() => void send()}>
            {sending ? '发送中…' : '发送'}
          </Button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
