import type { Message } from './session-state';
import { messageText } from './session-state';
import { MemoryToolFeedback } from './MemoryToolFeedback';
import { Code, Markdown } from '../../components/content';
import type { Api, Route } from '../../app/types';

type ToolCall = Extract<Message['content'], unknown[]>[number];

const readableArguments = { title: '标题', content: '正文', knowledge: '正文', reason: '依据' } as const;

function CallArguments({ call }: { call?: ToolCall }) {
  const args = call?.arguments && typeof call.arguments === 'object' ? (call.arguments as Record<string, unknown>) : {};
  return (
    <>
      {(Object.keys(readableArguments) as Array<keyof typeof readableArguments>).map((key) =>
        typeof args[key] === 'string' ? (
          <div key={key}>
            <h3>{readableArguments[key]}</h3>
            <Markdown text={args[key] as string} />
          </div>
        ) : null,
      )}
    </>
  );
}

export function toolCalls(message: Message): ToolCall[] {
  return Array.isArray(message.content) ? message.content.filter((p) => p.type === 'toolCall') : [];
}

export function ToolResult({
  message,
  call,
  api,
  project,
  originSession,
  go,
  technical = false,
}: {
  message: Message;
  call?: ToolCall;
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
        <strong>{message.toolName || call?.name || '工具'}</strong>
        {message.isError && <span>失败</span>}
      </div>
      <CallArguments call={call} />
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
          <summary>查看结果</summary>
          <pre>{messageText(message) || '这一步没有文字结果。'}</pre>
          {technical && <Code text={JSON.stringify(message, null, 2)} language="json" />}
        </details>
      )}
    </section>
  );
}

/** Renders tool calls that have no result in view; `status` marks them as running or unfinished. */
export function ToolCalls({
  message,
  settled,
  status,
}: {
  message: Message;
  settled?: ReadonlySet<string>;
  status?: string;
}) {
  return (
    <>
      {toolCalls(message)
        .filter((call) => !call.id || !settled?.has(call.id))
        .map((call, i) => (
          <section className="host-tool-request" key={call.id || i}>
            <h2>{call.name}</h2>
            {status && <span>{status}</span>}
            <CallArguments call={call} />
          </section>
        ))}
    </>
  );
}
