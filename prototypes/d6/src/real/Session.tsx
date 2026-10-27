import { SessionActivity } from './Evolution';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Square,
  Paperclip,
  Sparkles,
  ChevronDown,
  GitBranch,
  FileText,
  X,
  Check,
  ChevronRight,
  Folder,
  ArrowLeft,
} from 'lucide-react';
import type { Session as HostSession } from '../../../../apps/web/src/features/chat/session-state';
import { messageText } from '../../../../apps/web/src/features/chat/session-state';
import { presentSession } from './session-presentation';
import {
  useReflectionCatalog,
  reflectionStatusLabels,
} from '../../../../apps/web/src/features/reflection/reflection-state';
import { useSessionViewport } from '../pages/conversation/useSessionViewport';
import { Button, IconButton, Modal, Field, Notice, Status, SearchBox } from '../components/ui';
import { Markdown } from '../components/content';
import { ToolResult, ToolCalls } from './ToolResult';
import { Source } from './Source';
import { useRead, type Host, type Route } from './types';
import { SessionHistory } from './SessionHistory';
import './session-dialogs.css';
export type SessionDraft = { text: string; files: string[] };
export function SessionRoom({
  host,
  session,
  active,
  route,
  draft,
  onDraft,
  go,
}: {
  host: Host;
  session: HostSession;
  active: boolean;
  route: Extract<Route, { page: 'session' }>;
  draft: SessionDraft;
  onDraft: (id: string, value: SessionDraft | ((old: SessionDraft) => SessionDraft)) => void;
  go: (route: Route) => void;
}) {
  const [sending, setSending] = useState(false),
    [error, setError] = useState(''),
    [picker, setPicker] = useState<'files' | 'skills'>(),
    [query, setQuery] = useState(''),
    [model, setModel] = useState(false),
    [branch, setBranch] = useState(false);
  const composing = useRef(false),
    currentId = useRef(session.id);
  currentId.current = session.id;
  useEffect(() => {
    setError('');
    setSending(false);
  }, [session.id]);
  const blocks = presentSession(session);
  const rows = blocks.flatMap((b) => b.entries);
  const v = useSessionViewport({
    key: `${session.id}:${route.entryId || 'conversation'}`,
    active,
    draft: draft.text,
    empty: !rows.length,
    messageSignature: `${session.stateVersion}:${session.streamingMessage ? messageText(session.streamingMessage).length : 0}`,
  });
  const ready = host.connection === 'ready' && !session.unavailable && !session.skillFailed;
  useLayoutEffect(() => {
    if (!active || !route.entryId) return;
    const row = [...(v.reader.current?.querySelectorAll<HTMLElement>('[data-entry]') || [])].find(
      (n) => n.dataset.entry === route.entryId,
    );
    if (row) {
      const disclosure = row.closest<HTMLDetailsElement>('details.execution-summary');
      const wasOpen = disclosure?.open;
      if (disclosure) disclosure.open = true;
      row.scrollIntoView({ block: 'center' });
      row.focus({ preventScroll: true });
      return () => {
        if (disclosure && !wasOpen) disclosure.open = false;
      };
    }
  }, [active, route.entryId, session.id, rows.length]);
  const update = (value: Partial<SessionDraft>) => onDraft(session.id, { ...draft, ...value });
  const send = async () => {
    if (!ready || session.busy || sending || !draft.text.trim() || composing.current) return;
    const sent = draft;
    setSending(true);
    setError('');
    v.following.current = true;
    try {
      await host.api(`/sessions/${session.id}/prompt`, 'POST', { text: sent.text, files: sent.files });
      onDraft(session.id, (old) => (old === sent ? { text: '', files: [] } : old));
    } catch (e) {
      if (currentId.current === session.id) setError(e instanceof Error ? e.message : '发送未完成');
    } finally {
      if (currentId.current === session.id) setSending(false);
    }
  };
  const stop = async () => {
    try {
      await host.api(`/sessions/${session.id}/stop`, 'POST', {});
    } catch (e) {
      setError(e instanceof Error ? e.message : '停止未完成');
    }
  };
  return (
    <>
      {v.header &&
        createPortal(
          <button type="button" className="session-branch" aria-label="会话历史与分支" onClick={() => setBranch(true)}>
            <GitBranch size={15} />
          </button>,
          v.header,
        )}
      <section className="session-room" ref={v.room} aria-label="会话内容">
        <section
          className="session-scroll"
          ref={v.reader}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: The independent message reader supports keyboard scrolling and focus restoration.
          tabIndex={0}
          aria-label="对话消息"
          onFocusCapture={() => {
            v.readerFocused.current = true;
            v.focused.current = false;
          }}
          onScroll={(e) => {
            const el = e.currentTarget;
            v.readingTop.current = el.scrollTop;
            v.following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
            v.setAway(!v.following.current);
          }}
        >
          <div className="session-column">
            {session.unavailable && (
              <Notice title="会话暂不可恢复" tone="warn">
                不能将空内容解释为没有历史。
              </Notice>
            )}
            {session.interrupted && (
              <Notice title="执行曾中断" tone="warn">
                已保存历史仍可阅读，不会自动重放。
              </Notice>
            )}
            {session.error && (
              <Notice title="会话错误" tone="warn">
                {session.error}
              </Notice>
            )}
            {route.entryId && !rows.some((e) => e.id === route.entryId) && (
              <section className="host-located">
                <Source
                  api={host.api}
                  sessionIds={host.sessions.map((s) => s.id)}
                  route={{
                    page: 'source',
                    reference: { sessionId: session.id, entryId: route.entryId },
                    project: session.cwd,
                    originSession: session.id,
                  }}
                  go={go}
                  back={() => go({ page: 'session', sessionId: session.id })}
                />
              </section>
            )}
            {!rows.length && !session.unavailable && (
              <div className="session-start">
                <h2>想一起完成什么？</h2>
              </div>
            )}
            {blocks.map((block, index) =>
              block.kind === 'tools' ? (
                <details className="execution-summary" key={`${session.id}:tools:${block.entries[0].id}`}>
                  <summary>
                    <ChevronRight size={14} />
                    <span>
                      {block.entries.some((e) => e.message.role === 'toolResult')
                        ? `${block.entries.filter((e) => e.message.role === 'toolResult').length} 次工具返回`
                        : '工具调用'}
                    </span>
                    {block.entries.some((e) => e.message?.isError) && (
                      <span className="execution-gap">包含调用失败</span>
                    )}
                  </summary>
                  <div className="tool-activity">
                    {block.entries.map((entry) => (
                      <div
                        key={entry.id}
                        data-entry={
                          !entry.id.startsWith('projection:') && !entry.id.startsWith('live:') ? entry.id : undefined
                        }
                        tabIndex={route.entryId === entry.id ? -1 : undefined}
                        className={route.entryId === entry.id ? 'host-located-message' : ''}
                      >
                        {entry.message.role === 'assistant' ? (
                          <ToolCalls message={entry.message} />
                        ) : (
                          <ToolResult
                            message={entry.message}
                            api={host.api}
                            project={session.cwd}
                            originSession={session.id}
                            go={go}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  <Button kind="ghost" onClick={() => go({ page: 'trajectory', sessionId: session.id })}>
                    查看执行记录
                    <ArrowUpRight size={14} />
                  </Button>
                </details>
              ) : (
                block.entries.map((entry) => {
                  const m = entry.message;
                  const native = !entry.id.startsWith('projection:') && !entry.id.startsWith('live:');
                  return (
                    <article
                      key={`${session.id}:${entry.id}:${index}`}
                      className={`session-message ${m.role === 'user' ? 'user' : 'assistant'} ${m === session.streamingMessage ? 'host-stream' : ''} ${route.entryId === entry.id ? 'host-located-message' : ''}`}
                      data-entry={native ? entry.id : undefined}
                      tabIndex={route.entryId === entry.id ? -1 : undefined}
                      aria-label={m.role === 'user' ? '你的消息' : 'Agent 回复'}
                    >
                      {m.role === 'assistant' && <div className="session-author">Agent</div>}
                      <Markdown text={messageText(m)} />
                      {m.errorMessage && <p role="alert">{m.errorMessage}</p>}
                    </article>
                  );
                })
              ),
            )}
            {session.busy && (
              <div className="session-run" role="status">
                <Status tone="busy">{session.execution ? `正在执行 ${session.execution.name}` : '正在处理请求'}</Status>
              </div>
            )}
            {active && <SessionActivity key={session.id} host={host} session={session} go={go} />}
            {active && <SessionReflection host={host} id={session.id} go={go} />}
          </div>
        </section>
        <div className="session-dock" ref={v.dock}>
          {v.away && (
            <button
              type="button"
              className="session-latest"
              aria-label="回到最新消息"
              onClick={() => {
                v.following.current = true;
                v.reader.current?.scrollTo({ top: v.reader.current.scrollHeight });
                v.setAway(false);
              }}
            >
              <ArrowDown size={16} />
            </button>
          )}
          <div className="session-composer">
            {!!draft.files.length && (
              <section className="session-references" aria-label="引用材料">
                {draft.files.map((f) => (
                  <span key={f} title={f}>
                    <FileText size={14} />
                    <span>{f}</span>
                    <button
                      type="button"
                      aria-label={`移除 ${f}`}
                      onClick={() => update({ files: draft.files.filter((v) => v !== f) })}
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </section>
            )}
            <textarea
              ref={v.input}
              aria-label="发送给 Agent"
              placeholder="发送消息…"
              rows={1}
              value={draft.text}
              onChange={(e) => update({ text: e.target.value })}
              onFocus={() => {
                v.focused.current = true;
                v.readerFocused.current = false;
              }}
              onBlur={(e) => {
                if (e.relatedTarget && v.room.current?.contains(e.relatedTarget)) v.focused.current = false;
              }}
              onSelect={(e) => {
                v.selection.current = [e.currentTarget.selectionStart, e.currentTarget.selectionEnd];
              }}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="session-compose-actions">
              <div>
                <IconButton
                  label="引用项目文件"
                  disabled={!ready}
                  onClick={() => {
                    setQuery('');
                    setPicker('files');
                  }}
                >
                  <Paperclip size={18} />
                </IconButton>
                <IconButton
                  label="引用 Skill"
                  disabled={!ready}
                  onClick={() => {
                    setQuery('');
                    setPicker('skills');
                  }}
                >
                  <Sparkles size={18} />
                </IconButton>
                <button
                  type="button"
                  className="session-model"
                  title={`${session.provider} / ${session.model}`}
                  onClick={() => setModel(true)}
                >
                  {session.model}
                  <ChevronDown size={12} />
                </button>
              </div>
              <div>
                {session.busy ? (
                  <IconButton label="停止当前执行" disabled={!ready} onClick={() => void stop()}>
                    <Square size={16} />
                  </IconButton>
                ) : (
                  <button
                    type="button"
                    className="session-send"
                    aria-label="发送任务"
                    title="发送任务 (⌘/Ctrl + Enter)"
                    disabled={!ready || sending || !draft.text.trim()}
                    onClick={() => void send()}
                  >
                    <ArrowUp size={19} />
                  </button>
                )}
              </div>
            </div>
            {(!ready || error) && (
              <div className="session-compose-error" role={error ? 'alert' : 'status'}>
                {error || (!ready && host.connection !== 'ready' ? '连接中断，草稿已保留。' : '当前会话尚不可执行。')}
              </div>
            )}
          </div>
        </div>
      </section>
      <Modal
        open={!!picker}
        onClose={() => setPicker(undefined)}
        title={picker === 'files' ? '引用项目文件' : '引用 Skill'}
        description={picker === 'files' ? undefined : '指引不会改变执行权限。'}
        className="host-resources-dialog"
        footer={
          picker === 'files' && (
            <div className="host-resource-footer">
              <span role="status">已选 {draft.files.length} / 8 个文件</span>
              <Button kind="primary" onClick={() => setPicker(undefined)}>
                完成引用
              </Button>
            </div>
          )
        }
      >
        {picker && (
          <Resources
            host={host}
            session={session}
            kind={picker}
            query={query}
            onQuery={setQuery}
            selected={draft.files}
            onSelect={(value) => {
              if (picker === 'files')
                update({
                  files: draft.files.includes(value) ? draft.files.filter((v) => v !== value) : [...draft.files, value],
                });
              else {
                update({ text: `${draft.text}${draft.text ? '\n' : ''}/skill:${value} ` });
                setPicker(undefined);
                v.input.current?.focus();
              }
            }}
          />
        )}
      </Modal>
      <Modal open={model} onClose={() => setModel(false)} title="模型与推理">
        {model && <ModelSettings host={host} session={session} />}
      </Modal>
      {branch && (
        <SessionHistory key={session.id} host={host} session={session} go={go} close={() => setBranch(false)} />
      )}
    </>
  );
}
function SessionReflection({ host, id, go }: { host: Host; id: string; go: (route: Route) => void }) {
  const read = useReflectionCatalog(host.api, id, 0, true),
    job = read.catalog?.jobs[0];
  return (
    <nav className="session-related" aria-label="关联工作空间">
      <button
        type="button"
        data-focus="session-reflections"
        onClick={() => go({ page: 'reflections', sessionId: id, offset: 0 })}
      >
        反思记录{job && !['succeeded'].includes(job.status) && <span> · {reflectionStatusLabels[job.status]}</span>}
        <ArrowUpRight size={13} />
      </button>
      {read.error && (
        <span role="alert">
          {read.error}
          <button type="button" onClick={read.refresh}>
            重新读取
          </button>
        </span>
      )}
    </nav>
  );
}
function Resources({
  host,
  session,
  kind,
  query,
  onQuery,
  selected,
  onSelect,
}: {
  host: Host;
  session: HostSession;
  kind: 'files' | 'skills';
  query: string;
  onQuery: (v: string) => void;
  selected: string[];
  onSelect: (v: string) => void;
}) {
  const read = useRead<{
    files?: Array<{ path: string; directory: boolean }>;
    skills?: Array<{ name: string; description: string }>;
  }>(host.api, `/sessions/${session.id}/input-resources?${new URLSearchParams({ kind, query })}`);
  const directory = query.slice(0, query.lastIndexOf('/') + 1);
  const parent = directory.replace(/[^/]+\/$/, '');
  return (
    <>
      {kind === 'files' && (
        <div className="host-resource-location">
          <Button kind="ghost" disabled={!directory} onClick={() => onQuery(parent)} aria-label="返回上级目录">
            <ArrowLeft size={15} />
          </Button>
          <span title={session.cwd + (directory ? `/${directory}` : '')}>
            {directory || session.cwd.split('/').filter(Boolean).at(-1) || session.cwd}
          </span>
          {directory && (
            <Button kind="ghost" onClick={() => onQuery('')}>
              项目根目录
            </Button>
          )}
        </div>
      )}
      <SearchBox value={query} onChange={onQuery} placeholder={kind === 'files' ? '搜索项目文件' : '搜索 Skill'} />
      {read.loading && <p role="status">正在读取…</p>}
      {read.error && (
        <Notice title="候选读取失败" tone="warn">
          {read.error}
          <Button onClick={read.refresh}>重新读取</Button>
        </Notice>
      )}
      {read.value?.files?.map((f) => (
        <button
          type="button"
          className="picker-row"
          key={f.path}
          aria-pressed={f.directory ? undefined : selected.includes(f.path)}
          onClick={() => (f.directory ? onQuery(f.path) : onSelect(f.path))}
          disabled={!f.directory && !selected.includes(f.path) && selected.length >= 8}
        >
          {f.directory ? <Folder size={17} /> : <FileText size={17} />}
          <span>{f.path.slice(directory.length)}</span>
          {f.directory && <ChevronRight size={15} />}
          {selected.includes(f.path) && <Check size={16} />}
        </button>
      ))}
      {read.value?.skills?.map((s) => (
        <button type="button" className="picker-row" key={s.name} onClick={() => onSelect(s.name)}>
          <Sparkles size={17} />
          <span>
            {s.name}
            <small>{s.description}</small>
          </span>
        </button>
      ))}
      {read.value && !(read.value.files?.length || read.value.skills?.length) && <p>没有匹配的候选。</p>}
    </>
  );
}
function ModelSettings({ host, session }: { host: Host; session: HostSession }) {
  const [error, E] = useState(''),
    [busy, B] = useState(false);
  const action = async (kind: 'model' | 'thinking', value: string, provider?: string) => {
    B(true);
    E('');
    try {
      await host.api(`/sessions/${session.id}/${kind}`, 'POST', { value, provider });
    } catch (e) {
      E(e instanceof Error ? e.message : '未完成');
    } finally {
      B(false);
    }
  };
  return (
    <>
      <Field label="当前会话模型">
        <select
          disabled={busy || session.busy || host.connection !== 'ready'}
          value={`${session.provider}:${session.model}`}
          onChange={(e) => {
            const model = host.models.find((m) => `${m.provider}:${m.id}` === e.target.value);
            if (model) void action('model', model.id, model.provider);
          }}
        >
          {host.models.map((m) => (
            <option key={`${m.provider}:${m.id}`} value={`${m.provider}:${m.id}`}>
              {m.name} · {m.provider}
            </option>
          ))}
        </select>
      </Field>
      {session.thinkingLevels?.length && (
        <Field label="推理投入">
          <select
            value={session.thinkingLevel}
            disabled={busy || session.busy || host.connection !== 'ready'}
            onChange={(e) => void action('thinking', e.target.value)}
          >
            {session.thinkingLevels.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </Field>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
