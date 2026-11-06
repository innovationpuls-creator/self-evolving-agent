import { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { Message } from '../chat/session-state';
import { messageText } from '../chat/session-state';
import { EvidenceView } from './EvidenceView';
import type { Evidence } from './evidence';
import { nativeMemoryOperation } from './SourceEvidence';
import { Source as ReferenceSource } from './TraceSource';
import { Button, Notice } from '../../components/ui';
import { Markdown } from '../../components/content';
import { useRead, type Api, type Route } from '../../app/types';
import { ToolResult, ToolCalls } from '../chat/ToolResult';
function nativeMessage(content?: string): Message | undefined {
  try {
    const value = JSON.parse(content || '');
    const m = value.message;
    if (
      value.type === 'message' &&
      ['user', 'assistant', 'toolResult'].includes(m?.role) &&
      (typeof m.content === 'string' || Array.isArray(m.content))
    )
      return m;
  } catch {
    /* No interpretation of incomplete evidence. */
  }
}
export function Source({
  api,
  route,
  go,
  back,
  showBack,
  sessionIds,
}: {
  api: Api;
  route: Extract<Route, { page: 'source' }>;
  go: (route: Route) => void;
  back: () => void;
  /** False when the shell header already offers the same back control. */
  showBack: boolean;
  sessionIds: string[];
}) {
  if (!route.reference.sessionId || !route.reference.entryId)
    return <ReferenceSource api={api} route={route} go={go} back={back} showBack={showBack} />;
  return (
    <EntrySource
      key={`${route.reference.sessionId}:${route.reference.entryId}`}
      api={api}
      route={route}
      go={go}
      back={back}
      showBack={showBack}
      canLocate={sessionIds.includes(route.reference.sessionId)}
    />
  );
}
function EntrySource({
  api,
  route,
  go,
  back,
  showBack,
  canLocate,
}: {
  api: Api;
  route: Extract<Route, { page: 'source' }>;
  go: (route: Route) => void;
  back: () => void;
  showBack: boolean;
  canLocate: boolean;
}) {
  const reference = { sessionId: route.reference.sessionId || '', entryId: route.reference.entryId || '' };
  const query = new URLSearchParams({ ...reference, limit: '32768' });
  const read = useRead<Evidence>(api, `/diagnostics/evidence?${query}`);
  const [raw, setRaw] = useState(false);
  const evidence = read.value;
  const message = evidence?.available && !evidence.truncated ? nativeMessage(evidence.content) : undefined;
  // Only the previously validated, complete native feedback establishes persisted operations.
  const memory = evidence?.available && !evidence.truncated ? nativeMemoryOperation(evidence.content) : undefined;
  return (
    <>
      {showBack && (
        <Button kind="ghost" className="aw-return" onClick={back}>
          <ArrowLeft size={15} />
          返回上一页
        </Button>
      )}
      <header className="aw-heading">
        <h1 tabIndex={-1}>依据与来源</h1>
        {canLocate && (
          <Button
            data-focus="locate-session"
            onClick={() => go({ page: 'session', sessionId: reference.sessionId, entryId: reference.entryId })}
          >
            在来源会话中定位
            <ArrowRight size={14} />
          </Button>
        )}
      </header>
      {read.loading && <p role="status">正在读取来源…</p>}
      {evidence?.available && !canLocate && (
        <p className="aw-muted">来源不在当前会话列表中，可在此阅读保存的执行历史。</p>
      )}
      {read.error && (
        <Notice title="来源读取未完成" tone="warn">
          <p role="alert">{read.error}</p>
          <Button onClick={read.refresh}>重新读取</Button>
        </Notice>
      )}
      {evidence?.source === 'previous_checkpoint' && (
        <Notice title="来自上一检查点" tone="warn">
          可能缺少最新进度。
        </Notice>
      )}
      {evidence?.onSelectedBranch === false && <Notice title="历史分支">查看来源不会切换当前执行分支。</Notice>}
      {evidence && !evidence.available && (
        <Notice title="来源暂不可用" tone="warn">
          {evidence.reason || '完整来源暂时读不到，请稍后重试。'}
        </Notice>
      )}
      {message?.role === 'toolResult' ? (
        <ToolResult
          technical={false}
          message={memory || { ...message, details: undefined }}
          api={api}
          project={route.project}
          originSession={route.originSession}
          go={go}
        />
      ) : message ? (
        <article className="aw-review-article">
          <div className="host-source-person">{message.role === 'user' ? '用户请求' : 'Agent'}</div>
          <Markdown text={messageText(message)} />
          <ToolCalls message={message} />
          {message.errorMessage && <p role="alert">{message.errorMessage}</p>}
        </article>
      ) : (
        evidence?.available && <p>此来源没有可单独显示的完整消息，请查看原始记录。</p>
      )}
      {evidence?.truncated && (
        <Notice title="来源内容分段返回">当前段不足以确认完整操作；可在原始记录中逐段阅读。</Notice>
      )}
      <details className="host-raw-evidence" onToggle={(e) => setRaw(e.currentTarget.open)}>
        <summary>完整原始记录</summary>
        {raw && <EvidenceView api={api} reference={reference} titled={false} />}
      </details>
      {route.originSession && (
        <Button data-focus="origin-session" onClick={() => go({ page: 'session', sessionId: route.originSession })}>
          返回原会话
        </Button>
      )}
    </>
  );
}
