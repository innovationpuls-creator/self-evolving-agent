import type { Message } from '../../../../apps/web/src/features/chat/session-state';
import { messageText } from '../../../../apps/web/src/features/chat/session-state';
import { MemoryToolFeedback } from '../../../../apps/web/src/features/chat/MemoryToolFeedback';
import { Code, Markdown } from '../components/content';
import type { Api, Route } from './types';
export function ToolResult({
  message,
  api,
  project,
  originSession,
  go,
  technical = true,
}: {
  message: Message;
  api: Api;
  project: string;
  originSession?: string;
  go: (route: Route) => void;
  technical?: boolean;
}) {
  const memory =
    !message.isError &&
    message.details?.memory &&
    ['memory_save', 'memory_revise', 'memory_retire'].includes(message.toolName || '');
  return (
    <section className="host-tool" data-tool={message.toolName}>
      <div className="host-tool-heading">
        <strong>{message.toolName || 'Tool'}</strong>
        <span>{message.isError ? '调用失败' : '已返回'}</span>
      </div>
      {memory ? (
        <MemoryToolFeedback
          message={message}
          api={api}
          project={project}
          onMemory={(id, revision, scope) =>
            go({ page: 'result', target: { kind: 'memory', id, revision, project: scope || project }, originSession })
          }
          onEvidence={(reference) => go({ page: 'source', reference, project, originSession })}
        />
      ) : (
        <details className="host-tool-output">
          <summary>查看调用结果</summary>
          <pre>{messageText(message) || '原生结果未包含文本。'}</pre>
        </details>
      )}
      {technical && (
        <details className="host-technical">
          <summary>原始 Tool 结果</summary>
          <Code text={JSON.stringify(message, null, 2)} language="json" />
        </details>
      )}
    </section>
  );
}

export function ToolCalls({ message }: { message: Message }) {
  const calls = Array.isArray(message.content) ? message.content.filter((p) => p.type === 'toolCall') : [];
  return (
    <>
      {calls.map((call, i) => {
        const args =
          call.arguments && typeof call.arguments === 'object' ? (call.arguments as Record<string, unknown>) : {};
        return (
          <section className="host-tool-request" key={call.id || i}>
            <h2>{call.name}</h2>
            <span className="aw-muted">操作请求</span>
            {['title', 'content', 'knowledge', 'reason'].map((key) =>
              typeof args[key] === 'string' ? (
                <div key={key}>
                  <h3>{{ title: '标题', content: '正文', knowledge: '正文', reason: '依据' }[key]}</h3>
                  <Markdown text={args[key] as string} />
                </div>
              ) : null,
            )}
            <details className="host-technical">
              <summary>原始调用参数</summary>
              <Code text={JSON.stringify(call.arguments, null, 2)} language="json" />
            </details>
          </section>
        );
      })}
    </>
  );
}
