import React, { useEffect, useRef, useState } from 'react';
import { SkillsPanel } from '../features/skills/SkillsPanel';
import { MemoryPanel } from '../features/memory/MemoryPanel';
import { DiagnosticsPanel, type EvidenceReference } from '../features/diagnostics/DiagnosticsPanel';

interface Model {
  provider: string;
  id: string;
  name: string;
}
interface Message {
  role: string;
  content: string | Array<{ type: string; text?: string; name?: string; arguments?: unknown }>;
  toolName?: string;
  isError?: boolean;
  errorMessage?: string;
}
interface Tree {
  entry: { id: string; type: string; customType?: string; message?: Message };
  children: Tree[];
}
interface Session {
  id: string;
  title: string;
  cwd: string;
  provider: string;
  model: string;
  busy: boolean;
  skillFailed?: boolean;
  queued?: number;
  interrupted?: boolean;
  error?: string;
  unavailable?: boolean;
  messages?: Message[];
  tree?: Tree[];
  leafId?: string;
  thinkingLevel?: string;
  thinkingLevels?: string[];
}
const connectionKey = 'agent-connection-token';
function lostAuthentication() {
  sessionStorage.removeItem(connectionKey);
  window.dispatchEvent(new Event('agent-auth-lost'));
}
async function api<T>(path: string, method = 'GET', data?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionStorage.getItem(connectionKey)
        ? { Authorization: `Bearer ${sessionStorage.getItem(connectionKey)}` }
        : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (response.status === 401) lostAuthentication();
  if (!response.ok)
    throw Object.assign(new Error(result.error ?? '连接失败'), { status: response.status, code: result.code });
  return result;
}
function text(message: Message) {
  if (typeof message.content === 'string') return message.content;
  return (
    message.content
      ?.map((part) =>
        part.type === 'text'
          ? part.text
          : part.type === 'toolCall'
            ? `${part.name}\n${JSON.stringify(part.arguments, null, 2)}`
            : '',
      )
      .filter(Boolean)
      .join('\n') ?? ''
  );
}
export function App() {
  const [connected, setConnected] = useState(false),
    [online, setOnline] = useState(false),
    [token, setToken] = useState(''),
    [error, setError] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]),
    [selected, setSelected] = useState<Session>(),
    [models, setModels] = useState<Model[]>([]),
    [providers, setProviders] = useState<Array<{ id: string }>>([]);
  const [cwd, setCwd] = useState(''),
    [model, setModel] = useState(''),
    [prompt, setPrompt] = useState(''),
    [settings, setSettings] = useState(false),
    [provider, setProvider] = useState('openai-codex'),
    [key, setKey] = useState('');
  const [showSkills, setShowSkills] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [diagnostics, setDiagnostics] = useState<{
    session?: { id: string; title: string };
    evidence?: EvidenceReference;
  }>();
  const memoryDirty = useRef(false);
  const skillsDirty = useRef(false);
  const leaveSkills = (fn: () => void) => {
    if ((skillsDirty.current || memoryDirty.current) && !window.confirm('当前内容有未保存修改，离开并放弃这些修改？'))
      return;
    fn();
  };
  const selectionEpoch = useRef(0);
  const selectedRef = useRef<string | undefined>(undefined),
    bottom = useRef<HTMLDivElement>(null);
  const guard = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const refresh = async () => {
    const [list, catalog] = await Promise.all([
      api<Session[]>('/sessions'),
      api<{ models: Model[]; providers: Array<{ id: string }> }>('/models'),
    ]);
    setSessions(list);
    setModels(catalog.models);
    setProviders(catalog.providers);
    setModel((old) => old || (catalog.models[0] ? `${catalog.models[0].provider}/${catalog.models[0].id}` : ''));
  };
  const open = async (id: string) => {
    const epoch = ++selectionEpoch.current;
    selectedRef.current = id;
    const state = await api<Session>(`/sessions/${id}`);
    if (epoch === selectionEpoch.current) setSelected(state);
  };
  const connectHost = async (value: string) => {
    await api('/connect', 'POST', { token: value });
    sessionStorage.setItem(connectionKey, value);
  };
  useEffect(() => {
    const lost = () => {
      setConnected(false);
      setOnline(false);
      setSelected(undefined);
      selectedRef.current = undefined;
      selectionEpoch.current++;
    };
    window.addEventListener('agent-auth-lost', lost);
    return () => window.removeEventListener('agent-auth-lost', lost);
  }, []);
  useEffect(() => {
    void guard(async () => {
      const initial = new URLSearchParams(location.hash.slice(1)).get('token');
      if (initial) {
        history.replaceState(null, '', location.pathname);
        await connectHost(initial);
      }
      try {
        await refresh();
        setConnected(true);
      } catch {
        setConnected(false);
      }
    });
  }, []);
  useEffect(() => {
    if (!connected) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>,
      socket: WebSocket;
    const connect = () => {
      socket = new WebSocket(`${location.origin.replace('http', 'ws')}/events`);
      socket.onopen = () =>
        socket.send(JSON.stringify({ type: 'authenticate', token: sessionStorage.getItem(connectionKey) }));
      socket.onclose = (event) => {
        setOnline(false);
        if (event.code === 4401) {
          lostAuthentication();
          return;
        }
        if (!stopped) timer = setTimeout(connect, 1500);
      };
      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'skills') window.dispatchEvent(new Event('agent-skills-changed'));
        if (data.type === 'memory') window.dispatchEvent(new Event('agent-memory-changed'));
        if (data.type === 'diagnostic' || data.type === 'diagnostics')
          window.dispatchEvent(new Event('agent-diagnostics-changed'));
        if (data.type === 'queue_failed') setError(data.error);
        if (data.type === 'connected') {
          window.dispatchEvent(new Event('agent-reconnected'));
          setOnline(true);
          void guard(async () => {
            await refresh();
            if (selectedRef.current) await open(selectedRef.current);
          });
        }
        if (data.type === 'blocked' && data.sessionId === selectedRef.current) {
          setError(data.error);
          setSelected((old) => (old && old.id === data.sessionId ? { ...old, busy: false, error: data.error } : old));
        }
        if (data.type === 'state') {
          setSessions((old) =>
            old.some((s) => s.id === data.state.id)
              ? old.map((s) => (s.id === data.state.id ? data.state : s))
              : [data.state, ...old],
          );
          if (data.sessionId === selectedRef.current) setSelected(data.state);
        }
        if (data.type === 'update' && data.sessionId === selectedRef.current) {
          const e = data.event;
          if (e.type === 'message_start')
            setSelected((old) =>
              old && old.id === data.sessionId ? { ...old, messages: [...(old.messages ?? []), e.message] } : old,
            );
          if (e.type === 'message_update' || e.type === 'message_end')
            setSelected((old) => {
              if (!old || old.id !== data.sessionId) return old;
              const messages = [...(old.messages ?? [])];
              messages[messages.length - 1] = e.message;
              return { ...old, messages };
            });
        }
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [connected]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selected?.messages]);
  const newSession = () =>
    guard(async () => {
      const m = models.find((m) => `${m.provider}/${m.id}` === model);
      if (!m) throw new Error('请先配置模型');
      const s = await api<Session>('/sessions', 'POST', { cwd, provider: m.provider, model: m.id });
      selectionEpoch.current++;
      selectedRef.current = s.id;
      setSelected(s);
      await refresh();
    });
  const send = () =>
    guard(async () => {
      if (!selected || selected.busy || !prompt.trim()) return;
      if (selectedRef.current !== selected.id) throw new Error('会话切换中，请稍后发送');
      setSelected({ ...selected, busy: true });
      const value = prompt;
      setPrompt('');
      try {
        await api(`/sessions/${selected.id}/prompt`, 'POST', { text: value });
      } catch (e) {
        setPrompt(value);
        setSelected((old) => (old?.id === selected.id ? { ...old, busy: false } : old));
        throw e;
      }
    });
  const internalNode = (node: Tree) => node.entry.type === 'custom' && node.entry.customType === 'diagnostic_trace_v1';
  const internalLeaf = (tree: Tree[]): boolean =>
    tree.some((node) => (node.entry.id === selected?.leafId && internalNode(node)) || internalLeaf(node.children));
  const nodes = (tree: Tree[], depth = 0): React.ReactNode =>
    tree.map((node) => (
      <React.Fragment key={node.entry.id}>
        {!internalNode(node) && (
          <option value={node.entry.id}>
            {'　'.repeat(depth)}
            {node.entry.type} {node.entry.message ? text(node.entry.message).slice(0, 35) : ''}
          </option>
        )}
        {nodes(node.children, depth + (internalNode(node) ? 0 : 1))}
      </React.Fragment>
    ));
  if (!connected)
    return (
      <main className="connect">
        <p className="eyebrow">YOUR WORKSPACE, IN CONVERSATION</p>
        <h1>连接 Agent</h1>
        <p>输入本机 Agent Host 的连接令牌。</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void guard(async () => {
              await connectHost(token);
              setToken('');
              await refresh();
              setConnected(true);
            });
          }}
        >
          <input
            aria-label="连接令牌"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
          <button type="submit">连接</button>
        </form>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          Agent <span>个人工作空间</span>
        </div>
        <button
          type="button"
          onClick={() =>
            leaveSkills(() => {
              setDiagnostics(undefined);
              selectionEpoch.current++;
              selectedRef.current = undefined;
              setSelected(undefined);
            })
          }
        >
          ＋ 新会话
        </button>
        <nav>
          {sessions.map((s) => (
            <button
              type="button"
              className={s.id === selected?.id ? 'selected' : ''}
              key={s.id}
              disabled={s.unavailable}
              onClick={() =>
                leaveSkills(() => {
                  setDiagnostics(undefined);
                  void guard(() => open(s.id));
                })
              }
            >
              <b>{s.title}</b>
              <small>{s.unavailable ? s.error : s.busy ? '正在处理' : s.interrupted ? '上次运行中断' : s.cwd}</small>
            </button>
          ))}
        </nav>
        <button
          type="button"
          onClick={() =>
            leaveSkills(() => {
              setDiagnostics(undefined);
              setShowMemory(false);
              setShowSkills(!showSkills);
            })
          }
        >
          能力管理
        </button>
        <button
          type="button"
          onClick={() =>
            leaveSkills(() => {
              setDiagnostics(undefined);
              setShowSkills(false);
              setShowMemory(!showMemory);
            })
          }
        >
          记忆管理
        </button>
        <button
          type="button"
          onClick={() =>
            leaveSkills(() => {
              setShowMemory(false);
              setShowSkills(false);
              setDiagnostics({});
            })
          }
        >
          历史日志
        </button>
        <button type="button" onClick={() => setSettings(!settings)}>
          模型设置
        </button>
        <p className="connection">{online ? '● 已连接' : '○ 连接恢复中'}</p>
      </aside>
      <main>
        {diagnostics ? (
          <DiagnosticsPanel
            key={`${diagnostics.session?.id ?? 'all'}:${diagnostics.evidence?.sessionId ?? ''}:${diagnostics.evidence?.entryId ?? ''}`}
            api={api}
            session={diagnostics.session}
            initialEvidence={diagnostics.evidence}
            onClose={() => setDiagnostics(undefined)}
          />
        ) : showMemory ? (
          <MemoryPanel
            api={api}
            project={selected?.cwd ?? cwd}
            onDirtyChange={(value) => {
              memoryDirty.current = value;
            }}
            onClose={() => leaveSkills(() => setShowMemory(false))}
            onEvidence={(source) =>
              leaveSkills(() => {
                setShowMemory(false);
                setDiagnostics({ evidence: source });
              })
            }
          />
        ) : showSkills ? (
          <SkillsPanel
            api={api}
            project={selected?.cwd ?? cwd}
            onDirtyChange={(value) => {
              skillsDirty.current = value;
            }}
            onClose={() => leaveSkills(() => setShowSkills(false))}
            onAssist={(value) =>
              leaveSkills(() => {
                setPrompt(value);
                setShowSkills(false);
              })
            }
          />
        ) : (
          <>
            <header>
              <div>
                <h1>{selected?.title ?? '开始一项工作'}</h1>
                <p>{selected?.cwd ?? '选择工作目录，Agent 将使用本机文件与命令完成任务。'}</p>
              </div>
              {selected && (
                <div className="actions">
                  <button
                    type="button"
                    onClick={() => setDiagnostics({ session: { id: selected.id, title: selected.title } })}
                  >
                    运行诊断
                  </button>
                  <button
                    type="button"
                    disabled={selected.busy}
                    onClick={() => void guard(() => api(`/sessions/${selected.id}/compact`, 'POST', {}))}
                  >
                    压缩上下文
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void guard(async () => {
                        const data = await api(`/sessions/${selected.id}/export`);
                        const url = URL.createObjectURL(
                          new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
                        );
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'conversation.json';
                        a.click();
                        URL.revokeObjectURL(url);
                      })
                    }
                  >
                    导出
                  </button>
                </div>
              )}
            </header>
            {error && (
              <div role="alert" className="notice error">
                {error}
              </div>
            )}
            {settings && (
              <section className="settings">
                <h2>模型连接</h2>
                <p>凭据加密保存在本机。可导入本机 Pi 中已有的授权。</p>
                <select aria-label="模型提供方" value={provider} onChange={(e) => setProvider(e.target.value)}>
                  {providers.map((p) => (
                    <option key={p.id}>{p.id}</option>
                  ))}
                </select>
                <input
                  aria-label="API Key"
                  type="password"
                  placeholder="API Key"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() =>
                    void guard(async () => {
                      await api('/credentials', 'POST', { provider, key });
                      setKey('');
                      await refresh();
                    })
                  }
                >
                  保存 Key
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void guard(async () => {
                      await api('/credentials', 'POST', { provider, importExisting: true });
                      await refresh();
                    })
                  }
                >
                  导入 Pi 授权
                </button>
              </section>
            )}
            {!selected ? (
              <section className="start">
                <p className="eyebrow">LET’S MAKE SOMETHING</p>
                <h2>从一个具体任务开始。</h2>
                <label>
                  工作目录
                  <input placeholder="工作目录的绝对路径" value={cwd} onChange={(e) => setCwd(e.target.value)} />
                </label>
                <label>
                  模型
                  <select value={model} onChange={(e) => setModel(e.target.value)}>
                    {models.map((m) => (
                      <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                        {m.name} · {m.provider}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" disabled={!cwd || !model} onClick={() => void newSession()}>
                  创建会话 →
                </button>
                {!models.length && <p>先打开模型设置，配置或导入模型授权。</p>}
              </section>
            ) : (
              <>
                <div className="session-tools">
                  <select
                    aria-label="当前模型"
                    value={`${selected.provider}/${selected.model}`}
                    disabled={selected.busy}
                    onChange={(e) => {
                      const m = models.find((m) => `${m.provider}/${m.id}` === e.target.value);
                      if (m)
                        void guard(() =>
                          api(`/sessions/${selected.id}/model`, 'POST', { provider: m.provider, value: m.id }),
                        );
                    }}
                  >
                    {models.map((m) => (
                      <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="推理强度"
                    disabled={selected.busy}
                    value={selected.thinkingLevel}
                    onChange={(e) =>
                      void guard(() => api(`/sessions/${selected.id}/thinking`, 'POST', { value: e.target.value }))
                    }
                  >
                    {selected.thinkingLevels?.map((level) => (
                      <option key={level}>{level}</option>
                    ))}
                  </select>
                  <select
                    aria-label="历史分支"
                    disabled={selected.busy}
                    value={selected.leafId ?? ''}
                    onChange={(e) =>
                      void guard(() => api(`/sessions/${selected.id}/branch`, 'POST', { value: e.target.value }))
                    }
                  >
                    <option value="" disabled>
                      选择历史节点
                    </option>
                    {internalLeaf(selected.tree ?? []) && (
                      <option value={selected.leafId} disabled>
                        当前执行位置
                      </option>
                    )}
                    {nodes(selected.tree ?? [])}
                  </select>
                </div>
                {(selected.error || (selected.interrupted && !selected.busy)) && (
                  <div className="notice">
                    {selected.error ?? '上次运行已中断。请先检查工具结果与实际文件，再决定下一步；系统不会自动重放。'}
                  </div>
                )}
                {selected.skillFailed && (
                  <button
                    type="button"
                    onClick={() => void guard(() => api(`/sessions/${selected.id}/recover-skills`, 'POST', {}))}
                  >
                    重试恢复能力
                  </button>
                )}
                <section className="transcript">
                  {(selected.messages ?? [])
                    .filter((m) => ['user', 'assistant', 'toolResult'].includes(m.role))
                    .map((m, i) =>
                      m.role === 'toolResult' ? (
                        <details key={i}>
                          <summary>
                            {m.isError ? '工具失败' : '工具结果'} · {m.toolName}
                          </summary>
                          <pre>{text(m)}</pre>
                        </details>
                      ) : (
                        <article key={i} className={m.role}>
                          <span>{m.role === 'user' ? '你' : 'Agent'}</span>
                          <pre>{text(m)}</pre>
                          {m.errorMessage && <p role="alert">{m.errorMessage}</p>}
                        </article>
                      ),
                    )}
                  {!!selected.queued && <p className="working">等待能力切换完成 · {selected.queued} 条消息</p>}
                  {selected.busy && <p className="working">正在处理…</p>}
                  <div ref={bottom} />
                </section>
                <form
                  className="composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <textarea
                    aria-label="任务"
                    placeholder="描述你想完成的任务…"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <div>
                    <small>⌘ / Ctrl + Enter 发送</small>
                    {selected.busy ? (
                      <button
                        type="button"
                        onClick={() => void guard(() => api(`/sessions/${selected.id}/stop`, 'POST', {}))}
                      >
                        停止
                      </button>
                    ) : (
                      <button type="submit" disabled={!prompt.trim() || !online}>
                        发送 ↑
                      </button>
                    )}
                  </div>
                </form>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
