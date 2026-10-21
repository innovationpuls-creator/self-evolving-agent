import { ActivityPanel } from '../evolution/ActivityPanel';
import React, { useEffect, useRef, useState } from 'react';
import { Markdown } from '../../components/Markdown';
import { ReflectionStatus } from '../reflection/ReflectionStatus';
import { pendingToolNames, messageText, type Message, type Model, type Session, type Tree } from './session-state';
import type { ReflectionApi } from '../reflection/reflection-state';

function Content({ message }: { message: Message }) {
  const value = messageText(message);
  return (
    <>
      {message.role === 'user' ? <p className="user-text">{value}</p> : <Markdown>{value}</Markdown>}
      {Array.isArray(message.content) &&
        message.content
          .filter((part) => part.type === 'toolCall')
          .map((part, index) => (
            <details className="tool-call" key={index}>
              <summary>调用工具 · {part.name}</summary>
              <pre>{JSON.stringify(part.arguments, null, 2)}</pre>
            </details>
          ))}
      {message.errorMessage && (
        <p role="alert" className="inline-error">
          {message.errorMessage}
        </p>
      )}
    </>
  );
}
const internal = (node: Tree) =>
  node.entry.type === 'custom' &&
  ['diagnostic_trace_v1', 'reflection_settled_v1'].includes(node.entry.customType ?? '');
function nodes(tree: Tree[], depth = 0): React.ReactNode {
  return tree.map((node) => (
    <React.Fragment key={node.entry.id}>
      {!internal(node) && (
        <option value={node.entry.id}>
          {'　'.repeat(depth)}
          {node.entry.type} {node.entry.message ? messageText(node.entry.message).slice(0, 35) : ''}
        </option>
      )}
      {nodes(node.children, depth + (internal(node) ? 0 : 1))}
    </React.Fragment>
  ));
}

export function ChatView({
  api,
  positions,
  session,
  selectedId,
  models,
  ready,
  draft,
  sending,
  onDraft,
  onSend,
  onCreate,
  onSettings,
  onDiagnostics,
  onReflection,
  onOpen,
  onSkill,
  onError,
}: {
  api: ReflectionApi;
  positions: Map<string, number>;
  session?: Session;
  selectedId?: string;
  models: Model[];
  ready: boolean;
  draft: string;
  sending: boolean;
  onDraft: (text: string) => void;
  onSend: () => void;
  onCreate: (cwd: string, model: Model) => Promise<void>;
  onSettings: () => void;
  onDiagnostics: () => void;
  onReflection: () => void;
  onOpen: (id: string) => Promise<void>;
  onSkill: (id: string) => void;
  onError: (message: string) => void;
}) {
  const [cwd, setCwd] = useState(''),
    [model, setModel] = useState(''),
    [creating, setCreating] = useState(false);
  const [newContent, setNewContent] = useState(false);
  const transcript = useRef<HTMLElement>(null),
    follow = useRef(true);
  const currentId = useRef<string | undefined>(undefined);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : '操作未完成');
    }
  };
  useEffect(() => {
    if (!model && models[0]) setModel(`${models[0].provider}/${models[0].id}`);
  }, [models, model]);
  useEffect(() => {
    if (!transcript.current) return;
    const el = transcript.current;
    if (currentId.current !== session?.id) {
      currentId.current = session?.id;
      const position = session ? positions.get(session.id) : undefined;
      el.scrollTop = position ?? el.scrollHeight;
      follow.current = position === undefined || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      setNewContent(false);
    } else if (follow.current) el.scrollTop = el.scrollHeight;
    else setNewContent(true);
  }, [session?.id, session?.messages, session?.streamingMessage]);
  const messages = [
    ...(session?.messages ?? []),
    ...(session?.streamingMessage ? [session.streamingMessage] : []),
  ].filter((m) => ['user', 'assistant', 'toolResult'].includes(m.role) || (m.role === 'custom' && m.display !== false));
  const selectedModel = models.find((m) => `${m.provider}/${m.id}` === model);
  return (
    <div className="chat-view">
      <header>
        <div>
          <h1>{session?.title ?? (selectedId ? '正在恢复会话' : '开始一项工作')}</h1>
          <p>{session?.cwd ?? 'Agent 在 Host 所在的设备上使用文件与工具。'}</p>
        </div>
        {session && (
          <div className="actions">
            <button type="button" onClick={onDiagnostics}>
              运行诊断
            </button>
            <details className="action-menu">
              <summary>会话操作</summary>
              <div>
                <button
                  type="button"
                  disabled={session.busy || !ready}
                  onClick={() => void run(() => api(`/sessions/${session.id}/compact`, 'POST', {}))}
                >
                  压缩上下文
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void run(async () => {
                      const data = await api(`/sessions/${session.id}/export`);
                      const url = URL.createObjectURL(
                        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
                      );
                      const link = document.createElement('a');
                      link.href = url;
                      link.download = 'conversation.json';
                      link.click();
                      URL.revokeObjectURL(url);
                    })
                  }
                >
                  导出
                </button>
              </div>
            </details>
          </div>
        )}
      </header>
      {session && (
        <ActivityPanel
          key={session.id}
          api={api}
          session={session}
          ready={ready}
          onOpen={onOpen}
          onSkill={onSkill}
          onError={onError}
        />
      )}
      <ReflectionStatus api={api} sessionId={session?.id} onOpen={onReflection} />
      {!session ? (
        selectedId ? (
          <section className="start">
            <h2>正在同步会话</h2>
            <p>连接恢复后会重新读取历史和运行状态，不会重复执行任务。</p>
          </section>
        ) : (
          <section className="start">
            <span className="section-kicker">新会话</span>
            <h2>从一个具体任务开始</h2>
            <p>选择工作目录与模型，让上下文留在同一项工作中。</p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (creating || !ready || !selectedModel) return;
                setCreating(true);
                void run(() => onCreate(cwd, selectedModel)).finally(() => setCreating(false));
              }}
            >
              <label>
                工作目录
                <input
                  placeholder="工作目录的绝对路径"
                  value={cwd}
                  onChange={(event) => setCwd(event.target.value)}
                  required
                />
              </label>
              <label>
                模型
                <select value={model} onChange={(event) => setModel(event.target.value)}>
                  {models.map((item) => (
                    <option key={`${item.provider}/${item.id}`} value={`${item.provider}/${item.id}`}>
                      {item.name} · {item.provider}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary" type="submit" disabled={creating || !ready || !cwd.trim() || !selectedModel}>
                {creating ? '正在创建…' : '创建会话 →'}
              </button>
            </form>
            {!models.length && (
              <p className="empty-action">
                还没有可用模型。
                <button type="button" onClick={onSettings}>
                  配置或导入模型授权
                </button>
              </p>
            )}
          </section>
        )
      ) : (
        <>
          <div className="session-tools">
            <label>
              模型
              <select
                aria-label="当前模型"
                value={`${session.provider}/${session.model}`}
                disabled={session.busy || !ready}
                onChange={(event) => {
                  const next = models.find((m) => `${m.provider}/${m.id}` === event.target.value);
                  if (next)
                    void run(() =>
                      api(`/sessions/${session.id}/model`, 'POST', { provider: next.provider, value: next.id }),
                    );
                }}
              >
                {models.map((m) => (
                  <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              推理强度
              <select
                aria-label="推理强度"
                disabled={session.busy || !ready}
                value={session.thinkingLevel}
                onChange={(event) =>
                  void run(() => api(`/sessions/${session.id}/thinking`, 'POST', { value: event.target.value }))
                }
              >
                {session.thinkingLevels?.map((level) => (
                  <option key={level}>{level}</option>
                ))}
              </select>
            </label>
            <label>
              历史分支
              <select
                aria-label="历史分支"
                disabled={session.busy || !ready}
                value={session.leafId ?? ''}
                onChange={(event) =>
                  void run(() => api(`/sessions/${session.id}/branch`, 'POST', { value: event.target.value }))
                }
              >
                <option value="" disabled>
                  选择历史节点
                </option>
                <option value={session.leafId} hidden>
                  当前执行位置
                </option>
                {nodes(session.tree ?? [])}
              </select>
            </label>
          </div>
          {(session.error || (session.interrupted && !session.busy)) && (
            <div className="notice" role="status">
              {session.error ?? '上次运行已中断。请检查工具结果与实际文件后继续，系统不会自动重放。'}
            </div>
          )}
          {session.skillFailed && (
            <div className="notice">
              <button
                type="button"
                disabled={!ready}
                onClick={() => void run(() => api(`/sessions/${session.id}/recover-skills`, 'POST', {}))}
              >
                重试恢复能力
              </button>
            </div>
          )}
          <section
            className="transcript"
            ref={transcript}
            aria-label="会话消息"
            onScroll={() => {
              const el = transcript.current;
              if (!el) return;
              follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              positions.set(session.id, el.scrollTop);
              if (follow.current) setNewContent(false);
            }}
          >
            {!messages.length && (
              <div className="conversation-empty">
                <h2>这项工作，从这里开始</h2>
                <p>描述目标、已有材料，以及你希望得到的结果。</p>
              </div>
            )}
            {messages.map((message, index) =>
              message.role === 'toolResult' ? (
                <details className="tool-result" key={index}>
                  <summary>
                    {message.isError ? '工具失败' : '工具结果'} · {message.toolName}
                  </summary>
                  <pre>{messageText(message)}</pre>
                </details>
              ) : (
                <article className={message.role} key={index}>
                  <span className="message-author">{message.role === 'user' ? '你' : 'Agent'}</span>
                  <Content message={message} />
                </article>
              ),
            )}
            {!!session.queued && (
              <p className="working" role="status">
                等待能力切换完成 · {session.queued} 条消息
              </p>
            )}
            {session.busy && (
              <p className="working" role="status">
                {session.execution && !pendingToolNames(session).length
                  ? `正在执行工具 · ${session.execution.name}`
                  : session.streamingMessage
                    ? '正在生成…'
                    : (() => {
                        const tools = pendingToolNames(session);
                        return tools.length ? `正在执行工具 · ${tools.join('、')}` : '正在处理…';
                      })()}
              </p>
            )}
          </section>
          {newContent && (
            <button
              className="new-content"
              type="button"
              onClick={() => {
                follow.current = true;
                setNewContent(false);
                if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
              }}
            >
              查看新内容 ↓
            </button>
          )}
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              onSend();
            }}
          >
            <textarea
              aria-label="任务"
              placeholder="描述你想完成的任务…"
              value={draft}
              onChange={(event) => onDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  onSend();
                }
              }}
            />
            <div>
              <small>{ready ? '⌘ / Ctrl + Enter 发送' : '连接恢复后可继续发送，草稿保留在本页。'}</small>
              {session.busy ? (
                <button
                  type="button"
                  disabled={!ready}
                  onClick={() => void run(() => api(`/sessions/${session.id}/stop`, 'POST', {}))}
                >
                  停止
                </button>
              ) : (
                <button className="primary" type="submit" disabled={!draft.trim() || !ready || sending}>
                  {sending ? '提交中…' : '发送 ↑'}
                </button>
              )}
            </div>
          </form>
        </>
      )}
    </div>
  );
}
