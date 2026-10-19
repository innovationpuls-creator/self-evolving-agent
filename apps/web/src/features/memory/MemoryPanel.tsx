import { useEffect, useRef, useState } from 'react';
import type { MemoryContent, MemoryView } from '../../../../host/memory/memory';
import type { EvidenceReference } from '../diagnostics/DiagnosticsPanel';

type Api = <T>(path: string, method?: string, data?: unknown) => Promise<T>;
interface Catalog {
  items: MemoryView[];
  total: number;
  unavailable: number;
}
interface Detail {
  current: MemoryView;
  history: MemoryView[];
}
const kinds = { fact: '事实', experience: '经验', decision: '决定', hypothesis: '怀疑 · 未验证' };
const statuses = { current: '当前认识', withdrawn: '已撤销', deleted: '已删除' };
const blank = (project: string): MemoryContent => ({
  title: '',
  content: '',
  kind: 'experience',
  scope: project ? 'project' : 'global',
});

export function MemoryPanel({
  api,
  project,
  onClose,
  onDirtyChange,
  onEvidence,
}: {
  api: Api;
  project: string;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onEvidence: (source: EvidenceReference) => void;
}) {
  const [catalog, setCatalog] = useState<Catalog>({ items: [], total: 0, unavailable: 0 });
  const [detail, setDetail] = useState<Detail>();
  const [form, setForm] = useState<MemoryContent>(blank(project));
  const [reason, setReason] = useState(''),
    [query, setQuery] = useState(''),
    [scope, setScope] = useState('');
  const [history, setHistory] = useState(false),
    [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState(false),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [lostAccess, setLostAccess] = useState(false);
  const dirtyRef = useRef(false),
    selected = useRef<string | undefined>(undefined),
    listEpoch = useRef(0),
    detailEpoch = useRef(0);
  const context = useRef(project),
    callbacks = useRef({ onDirtyChange });
  const generation = useRef(0),
    operations = useRef(0),
    editingRef = useRef(false);
  if (context.current !== project) {
    context.current = project;
    generation.current++;
    operations.current = 0;
  }
  callbacks.current = { onDirtyChange };
  const markDirty = (value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
    callbacks.current.onDirtyChange(value);
  };
  const suffix = (extra: Record<string, string> = {}) =>
    `?${new URLSearchParams({ ...(project ? { project } : {}), ...extra })}`;
  const discard = () => !dirtyRef.current || window.confirm('当前记忆有未保存修改，离开并放弃这些修改？');
  const loadDetail = async (id: string, replace = false) => {
    const epoch = ++detailEpoch.current,
      owner = generation.current;
    let value: Detail;
    try {
      value = await api<Detail>(`/memory/${id}${suffix({ includeHistory: 'true' })}`);
    } catch (error) {
      if (
        epoch === detailEpoch.current &&
        generation.current === owner &&
        selected.current === id &&
        error instanceof Error &&
        'status' in error &&
        error.status === 404
      ) {
        if (editingRef.current) {
          setLostAccess(true);
          setNotice('此记忆已移出当前作用域，草稿已保留；可复制内容或取消编辑。');
        } else {
          selected.current = undefined;
          setDetail(undefined);
        }
      }
      throw error;
    }
    if (epoch !== detailEpoch.current || generation.current !== owner || selected.current !== id) return;
    if (editingRef.current && !replace) {
      setNotice('当前编辑内容及基础修订已保留。保存前可重新读取最新版本。');
      return;
    }
    setDetail(value);
    if (replace) {
      setLostAccess(false);
      markDirty(false);
      editingRef.current = false;
      setEditing(false);
      setReason('');
    }
  };
  const refresh = async () => {
    const epoch = ++listEpoch.current,
      owner = generation.current;
    const value = await api<Catalog>(
      `/memory${suffix({ query, includeHistory: String(history), ...(scope ? { scope } : {}), limit: '30', offset: String(offset) })}`,
    );
    if (epoch !== listEpoch.current || generation.current !== owner) return;
    setCatalog(value);
    if (selected.current) await loadDetail(selected.current);
  };
  const guard = async (fn: () => Promise<unknown>) => {
    const owner = generation.current;
    operations.current++;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      if (generation.current === owner) setError(e instanceof Error ? e.message : '操作未完成');
    } finally {
      if (generation.current === owner) {
        operations.current--;
        setBusy(operations.current > 0);
      }
    }
  };
  useEffect(() => {
    selected.current = undefined;
    detailEpoch.current++;
    listEpoch.current++;
    setDetail(undefined);
    setCatalog({ items: [], total: 0, unavailable: 0 });
    editingRef.current = false;
    setEditing(false);
    markDirty(false);
    setReason('');
    setError('');
    setNotice('');
    setLostAccess(false);
    setOffset(0);
    setBusy(false);
  }, [project]);
  useEffect(() => {
    const timer = setTimeout(() => {
      void guard(refresh);
    }, 180);
    const handler = () => {
      void guard(refresh);
    };
    window.addEventListener('agent-memory-changed', handler);
    window.addEventListener('agent-reconnected', handler);
    return () => {
      clearTimeout(timer);
      listEpoch.current++;
      detailEpoch.current++;
      window.removeEventListener('agent-memory-changed', handler);
      window.removeEventListener('agent-reconnected', handler);
    };
  }, [project, query, scope, history, offset]);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', before);
    return () => {
      window.removeEventListener('beforeunload', before);
      callbacks.current.onDirtyChange(false);
      generation.current++;
    };
  }, []);
  const open = (id: string) => {
    if (!discard()) return;
    markDirty(false);
    setEditing(false);
    setError('');
    setNotice('');
    setLostAccess(false);
    selected.current = id;
    setDetail(undefined);
    void guard(() => loadDetail(id, true));
  };
  const start = () => {
    if (!discard()) return;
    detailEpoch.current++;
    selected.current = undefined;
    setDetail(undefined);
    setForm(blank(project));
    setReason('');
    editingRef.current = true;
    setEditing(true);
    setNotice('');
    setError('');
    setLostAccess(false);
    markDirty(false);
  };
  const edit = () => {
    if (!detail) return;
    const { title, content, kind, scope: currentScope } = detail.current;
    setForm({ title, content, kind, scope: currentScope });
    setReason('');
    editingRef.current = true;
    setEditing(true);
    markDirty(false);
  };
  const change = (patch: Partial<MemoryContent>) => {
    setForm((old) => ({ ...old, ...patch }));
    markDirty(true);
  };
  const save = (confirm = false) =>
    void guard(async () => {
      const owner = generation.current,
        current = detail?.current;
      const value = await api<MemoryView>(
        current ? `/memory/${current.id}/revise${suffix()}` : `/memory${suffix()}`,
        'POST',
        { knowledge: form, reason, ...(current ? { baseRevision: current.revision, confirm } : {}) },
      );
      if (generation.current !== owner) return;
      markDirty(false);
      editingRef.current = false;
      setEditing(false);
      selected.current = value.id;
      setNotice('');
      await loadDetail(value.id, true);
      await refresh();
    });
  const remove = () => {
    const current = detail?.current;
    if (!current || !window.confirm('删除后不再用于当前检索，来源与修订历史仍会保留。删除这条记忆？')) return;
    void guard(async () => {
      const owner = generation.current;
      await api(`/memory/${current.id}${suffix()}`, 'DELETE', {
        baseRevision: current.revision,
        reason: '用户在记忆管理中删除',
      });
      if (generation.current !== owner) return;
      await loadDetail(current.id, true);
      await refresh();
    });
  };
  return (
    <section className="memory-panel">
      <header>
        <div>
          <h1>记忆管理</h1>
          <p>{project || '未选择项目，仅显示全局记忆'}</p>
        </div>
        <div className="actions">
          <button type="button" disabled={busy} onClick={start}>
            新建记忆
          </button>
          <button type="button" onClick={onClose}>
            返回对话
          </button>
        </div>
      </header>
      {error && (
        <div role="alert" className="notice error">
          {error}
          {dirty && '；未保存内容仍在编辑器中。'}
        </div>
      )}
      {notice && (
        <div role="status" className="notice">
          {notice}
        </div>
      )}
      <div className="memory-filters">
        <input
          aria-label="搜索记忆"
          disabled={busy}
          placeholder="搜索知识内容…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
        <select
          aria-label="记忆作用域筛选"
          disabled={busy}
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">全局与当前项目</option>
          <option value="global">全局</option>
          <option value="project">当前项目</option>
        </select>
        <label>
          <input
            type="checkbox"
            disabled={busy}
            checked={history}
            onChange={(e) => {
              setHistory(e.target.checked);
              setOffset(0);
            }}
          />{' '}
          包含历史与已删除
        </label>
      </div>
      {catalog.unavailable > 0 && (
        <p role="status" className="notice">
          有 {catalog.unavailable} 项决定的来源正在切换或无法确认，暂不作为当前认识提供。
        </p>
      )}
      <div className="memory-layout">
        <div className="memory-list">
          {!catalog.items.length && <p className="memory-empty">{busy ? '正在读取…' : '没有符合条件的记忆'}</p>}
          {catalog.items.map((item) => (
            <button
              type="button"
              disabled={busy}
              className={`memory-item ${selected.current === item.id ? 'selected' : ''}`}
              key={`${item.id}:${item.revision}`}
              onClick={() => open(item.id)}
            >
              <small>
                {item.scope === 'global' ? '全局' : '项目'} · {kinds[item.kind]}
              </small>
              <b>{item.title}</b>
              <span>{item.content.slice(0, 90)}</span>
              <small>
                {item.isCurrent ? statuses[item.status] : '历史版本'} · #{item.revision}
              </small>
            </button>
          ))}
          <div className="memory-controls">
            <button type="button" disabled={!offset || busy} onClick={() => setOffset((old) => Math.max(0, old - 30))}>
              上一页
            </button>
            <small>{catalog.total} 条</small>
            <button
              type="button"
              disabled={offset + 30 >= catalog.total || busy}
              onClick={() => setOffset((old) => old + 30)}
            >
              下一页
            </button>
          </div>
        </div>
        <div className="memory-detail">
          {!detail && !editing && <p className="memory-empty">选择一条记忆，查看认识与依据。</p>}
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save(detail?.current.status === 'withdrawn');
              }}
            >
              <h2>{detail ? '编辑认识' : '新建认识'}</h2>
              <fieldset disabled={busy}>
                <label>
                  标题
                  <input
                    aria-label="记忆标题"
                    required
                    maxLength={240}
                    value={form.title}
                    onChange={(e) => change({ title: e.target.value })}
                  />
                </label>
                <label>
                  知识内容
                  <textarea
                    aria-label="知识内容"
                    required
                    maxLength={32000}
                    value={form.content}
                    onChange={(e) => change({ content: e.target.value })}
                  />
                </label>
                <div className="memory-fields">
                  <label>
                    性质
                    <select
                      aria-label="知识性质"
                      value={form.kind}
                      onChange={(e) => change({ kind: e.target.value as MemoryContent['kind'] })}
                    >
                      {Object.entries(kinds).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    作用域
                    <select
                      aria-label="记忆作用域"
                      value={form.scope}
                      onChange={(e) => change({ scope: e.target.value as MemoryContent['scope'] })}
                    >
                      <option value="global">Global · 跨项目</option>
                      <option value="project" disabled={!project}>
                        Project · 当前项目
                      </option>
                    </select>
                  </label>
                </div>
                <label>
                  修改依据
                  <textarea
                    aria-label="修改依据"
                    required
                    maxLength={4000}
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value);
                      markDirty(true);
                    }}
                    placeholder="记录支持这一认识的新证据或调整原因"
                  />
                </label>
                {detail?.current.status === 'withdrawn' && (
                  <p>保存将依据本次说明重新确认当前认识，旧结论和撤销记录保留。</p>
                )}
                <div className="memory-controls">
                  <button
                    type="submit"
                    disabled={busy || lostAccess || !form.title.trim() || !form.content.trim() || !reason.trim()}
                  >
                    保存认识
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (discard()) {
                        markDirty(false);
                        editingRef.current = false;
                        setEditing(false);
                        if (selected.current) void guard(() => loadDetail(selected.current ?? '', true));
                      }
                    }}
                  >
                    取消编辑
                  </button>
                  {detail && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (discard()) void guard(() => loadDetail(detail.current.id, true));
                      }}
                    >
                      重新读取最新版本
                    </button>
                  )}
                </div>
                {detail && <small>编辑基础修订 #{detail.current.revision}</small>}
              </fieldset>
            </form>
          ) : (
            detail && (
              <>
                <small>
                  {detail.current.scope === 'global' ? 'Global · 全局' : 'Project · 当前项目'} ·{' '}
                  {kinds[detail.current.kind]}
                </small>
                <h2>{detail.current.title}</h2>
                <p className="memory-state">
                  {statuses[detail.current.status]} · 修订 #{detail.current.revision}
                  {detail.current.unavailable && ' · 来源暂不可确认'}
                </p>
                <pre>{detail.current.content}</pre>
                {detail.current.status !== 'deleted' ? (
                  <div className="memory-controls">
                    <button type="button" disabled={busy || detail.current.unavailable} onClick={edit}>
                      {detail.current.status === 'withdrawn' ? '重新确认认识' : '编辑与调整作用域'}
                    </button>
                    <button type="button" disabled={busy} onClick={remove}>
                      删除记忆
                    </button>
                  </div>
                ) : (
                  <p>已从当前检索移除；下方保留来源与修订历史。</p>
                )}
                <details>
                  <summary>来源与修改历史 · {detail.history.length} 个修订</summary>
                  {detail.history.map((rev) => (
                    <article className="memory-revision" key={rev.revision}>
                      <small>
                        #{rev.revision} · {rev.actor === 'agent' ? 'Agent' : rev.actor === 'user' ? '用户' : '系统'} ·{' '}
                        {new Date(rev.created).toLocaleString('zh-CN')}
                      </small>
                      <p>
                        {rev.isCurrent ? statuses[rev.status] : '历史认识'} · {kinds[rev.kind]}
                        {rev.previousRevision && ` · 替代 #${rev.previousRevision}`}
                      </p>
                      <b>{rev.title}</b>
                      <pre>{rev.content}</pre>
                      <p>依据：{rev.reason}</p>
                      {rev.sources.map((source) => (
                        <p className="memory-source" key={`${source.sessionId}:${source.entryId}`}>
                          Session {source.sessionId}
                          <br />
                          Entry {source.entryId}
                          <br />
                          <button type="button" onClick={() => onEvidence(source)}>
                            查看执行证据
                          </button>
                        </p>
                      ))}
                    </article>
                  ))}
                </details>
              </>
            )
          )}
        </div>
      </div>
    </section>
  );
}
