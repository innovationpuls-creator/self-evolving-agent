import { readPosition, savePosition } from '../../app/view-state';
import { useEffect, useRef, useState } from 'react';
import type { EvolutionCatalog, EvolutionEvidence, EvolutionSuggestion } from '../../../../host/evolution/evolution';
import './evolution.css';

type Api = <T>(path: string, method?: string, data?: unknown, signal?: AbortSignal) => Promise<T>;
type Status = EvolutionSuggestion['status'];
import type { EvidenceTarget } from '../diagnostics/evidence';
const labels: Record<Status, string> = {
  pending: '待处理',
  adopted: '已采纳',
  ignored: '已忽略',
  archived: '已归档',
};
const pageSize = 30;
const statusValues: Status[] = ['pending', 'adopted', 'ignored', 'archived'];
const date = (value: number) => new Date(value).toLocaleString('zh-CN');

function Evidence({
  value,
  onEvidence,
  onMemory,
  onSkill,
  onReflection,
}: {
  value: EvolutionEvidence;
  onMemory?: (id: string, revision?: number) => void;
  onSkill?: (id: string, revision?: string) => void;
  onReflection?: (id: string) => void;
  onEvidence?: (reference: EvidenceTarget) => void;
}) {
  return (
    <li>
      {(value.sessionId || value.traceId) && (
        <div>
          <button
            type="button"
            disabled={!onEvidence}
            onClick={() => {
              if (value.sessionId)
                onEvidence?.({ sessionId: value.sessionId, entryId: value.entryId, traceId: value.traceId });
              else if (value.traceId) onEvidence?.({ traceId: value.traceId, entryId: value.entryId });
            }}
          >
            查看来源轨迹
          </button>
        </div>
      )}
      {value.memoryId && (
        <div>
          记忆 <code>{value.memoryId}</code>
          {value.revision ? ` · 修订 ${value.revision}` : ''}
          {onMemory && (
            <button
              type="button"
              onClick={() => {
                if (value.memoryId) onMemory(value.memoryId, value.revision);
              }}
            >
              查看记忆修订
            </button>
          )}
        </div>
      )}
      {value.skillId && (
        <div>
          能力 <code>{value.skillId}</code>
          {value.knowledgeRevision ? ` · 知识修订 ${value.knowledgeRevision}` : ''}
          {onSkill && (
            <button
              type="button"
              onClick={() => {
                if (value.skillId) onSkill(value.skillId, value.knowledgeRevision);
              }}
            >
              查看能力知识
            </button>
          )}
        </div>
      )}
      {value.reflectionId && (
        <div>
          反思 <code>{value.reflectionId}</code>
          {onReflection && (
            <button
              type="button"
              onClick={() => {
                if (value.reflectionId) onReflection(value.reflectionId);
              }}
            >
              查看反思
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function SuggestionsPanel({
  api,
  initialId,
  session,
  onMemory,
  onSkill,
  onReflection,
  onClose,
  onDiscuss,
  onEvidence,
}: {
  api: Api;
  initialId?: string;
  session?: { id: string; cwd: string };
  onMemory?: (id: string, revision?: number, project?: string) => void;
  onSkill?: (id: string, revision?: string, project?: string) => void;
  onReflection?: (id: string) => void;
  onClose: () => void;
  onDiscuss: (sessionId: string) => void | Promise<void>;
  onEvidence?: (reference: EvidenceTarget) => void;
}) {
  const [status, setStatus] = useState<Status | ''>(
    initialId ? '' : (statusValues.find((value) => value === readPosition('suggestions').filter) ?? 'pending'),
  );
  const [offset, setOffset] = useState(initialId ? 0 : (readPosition('suggestions').offset ?? 0));
  const [scope, setScope] = useState(readPosition('suggestions').scope ?? 'all');
  const [catalog, setCatalog] = useState<EvolutionCatalog>();
  const [selectedId, setSelectedId] = useState<string | undefined>(initialId ?? readPosition('suggestions').id);
  const [detail, setDetail] = useState<EvolutionSuggestion>();
  const [selection, setSelection] = useState<Array<{ id: string; baseRevision: number }>>([]);
  const [listBusy, setListBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const listEpoch = useRef(0),
    detailEpoch = useRef(0),
    selected = useRef<string | undefined>(undefined),
    mounted = useRef(true);
  selected.current = selectedId;
  useEffect(() => {
    if (initialId) {
      setSelectedId(initialId);
      setStatus('');
      setOffset(0);
    }
  }, [initialId]);
  useEffect(() => {
    savePosition('suggestions', { id: selectedId, offset, filter: status, scope });
  }, [selectedId, offset, status, scope]);

  useEffect(() => {
    mounted.current = true;
    const update = () => setRefresh((value) => value + 1);
    window.addEventListener('agent-suggestions-changed', update);
    window.addEventListener('agent-reconnected', update);
    return () => {
      mounted.current = false;
      listEpoch.current++;
      detailEpoch.current++;
      window.removeEventListener('agent-suggestions-changed', update);
      window.removeEventListener('agent-reconnected', update);
    };
  }, []);

  useEffect(() => {
    const epoch = ++listEpoch.current;
    const controller = new AbortController();
    setListBusy(true);
    const query = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (status) query.set('status', status);
    if (scope === 'project' && session) query.set('project', session.cwd);
    if (scope === 'session' && session) query.set('sessionId', session.id);
    void api<EvolutionCatalog>(`/suggestions?${query}`, 'GET', undefined, controller.signal)
      .then((value) => {
        if (epoch !== listEpoch.current) return;
        setCatalog(value);
        setSelection((old) =>
          old.filter((item) =>
            value.items.some((current) => current.id === item.id && current.revision === item.baseRevision),
          ),
        );
        if (offset && !value.items.length && value.total <= offset) setOffset(Math.max(0, offset - pageSize));
      })
      .catch((reason: unknown) => {
        if (epoch === listEpoch.current) setError(reason instanceof Error ? reason.message : '建议列表读取失败');
      })
      .finally(() => {
        if (epoch === listEpoch.current) setListBusy(false);
      });
    return () => {
      listEpoch.current++;
      controller.abort();
    };
  }, [api, status, offset, refresh, scope, session?.id, session?.cwd]);

  useEffect(() => {
    const epoch = ++detailEpoch.current;
    const controller = new AbortController();
    if (!selectedId) {
      setDetail(undefined);
      setDetailBusy(false);
      return;
    }
    setDetail((current) => (current?.id === selectedId ? current : undefined));
    setDetailBusy(true);
    void api<EvolutionSuggestion>(`/suggestions/${selectedId}`, 'GET', undefined, controller.signal)
      .then((value) => {
        if (epoch === detailEpoch.current) setDetail(value);
      })
      .catch((reason: unknown) => {
        if (epoch === detailEpoch.current) {
          setDetail(undefined);
          setError(reason instanceof Error ? reason.message : '建议详情读取失败');
        }
      })
      .finally(() => {
        if (epoch === detailEpoch.current) setDetailBusy(false);
      });
    return () => {
      detailEpoch.current++;
      controller.abort();
    };
  }, [api, selectedId, refresh]);

  const guard = async (run: () => Promise<void>) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await run();
    } catch (reason) {
      if (mounted.current) {
        setError(reason instanceof Error ? reason.message : '建议操作未完成');
        setRefresh((value) => value + 1);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const manage = (target: 'ignored' | 'archived', items = selection) =>
    void guard(async () => {
      await api('/suggestions/manage', 'POST', { items, status: target });
      if (!mounted.current) return;
      setSelection([]);
      setNotice(target === 'ignored' ? '建议已忽略。' : '建议已归档。');
      setRefresh((value) => value + 1);
    });
  const adopt = (suggestion: EvolutionSuggestion) =>
    void guard(async () => {
      const value = await api<EvolutionSuggestion>(`/suggestions/${suggestion.id}/adopt`, 'POST', {
        baseRevision: suggestion.revision,
      });
      if (!mounted.current) return;
      if (selected.current === value.id) setDetail(value);
      setRefresh((old) => old + 1);
      setNotice('建议已采纳，可在独立会话继续讨论。');
      if (value.discussionSessionId) await onDiscuss(value.discussionSessionId);
    });
  const selectAll = catalog?.items.length && catalog.items.every((item) => selection.some((s) => s.id === item.id));

  return (
    <section className="evolution-panel">
      <header>
        <div>
          <p className="eyebrow">EVOLUTION</p>
          <h1>进化建议</h1>
          <p>查看值得讨论的改进构想，决定哪些继续探索。</p>
        </div>
        <button type="button" onClick={onClose}>
          返回对话
        </button>
      </header>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="evolution-toolbar">
        <label>
          状态
          <select
            value={status}
            onChange={(event) => {
              setStatus(statusValues.find((value) => value === event.target.value) ?? '');
              setOffset(0);
              setSelection([]);
            }}
          >
            <option value="">全部建议</option>
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          范围
          <select
            aria-label="建议范围"
            value={session ? scope : 'all'}
            onChange={(event) => {
              setScope(event.target.value);
              setOffset(0);
              setSelection([]);
            }}
          >
            <option value="all">全部建议</option>
            {session && (
              <>
                <option value="project">当前项目</option>
                <option value="session">当前会话</option>
              </>
            )}
          </select>
        </label>
        <button type="button" disabled={listBusy} onClick={() => setRefresh((value) => value + 1)}>
          刷新
        </button>
        <span>{catalog ? `${catalog.total} 条建议` : '读取建议'}</span>
      </div>
      <div className="evolution-workspace" data-detail={!!detail || detailBusy}>
        <div className="evolution-catalog" aria-busy={listBusy}>
          <div className="evolution-batch">
            <label>
              <input
                type="checkbox"
                aria-label="选择当前页全部建议"
                checked={Boolean(selectAll)}
                disabled={busy || !catalog?.items.length}
                onChange={(event) =>
                  setSelection(
                    event.target.checked
                      ? (catalog?.items.map((s) => ({ id: s.id, baseRevision: s.revision })) ?? [])
                      : [],
                  )
                }
              />
              本页
            </label>
            <button type="button" disabled={busy || !selection.length} onClick={() => manage('ignored')}>
              批量忽略
            </button>
            <button type="button" disabled={busy || !selection.length} onClick={() => manage('archived')}>
              批量归档
            </button>
          </div>
          {!catalog?.items.length && !listBusy && (
            <p className="evolution-empty">暂无{status ? labels[status] : ''}建议。</p>
          )}
          {catalog?.items.map((item) => (
            <div className={`evolution-row${item.id === selectedId ? ' selected' : ''}`} key={item.id}>
              <input
                type="checkbox"
                aria-label={`选择建议：${item.title}`}
                checked={selection.some((value) => value.id === item.id)}
                disabled={busy}
                onChange={(event) =>
                  setSelection((old) =>
                    event.target.checked
                      ? [...old, { id: item.id, baseRevision: item.revision }]
                      : old.filter((value) => value.id !== item.id),
                  )
                }
              />
              <button
                type="button"
                onClick={() => {
                  if (selectedId !== item.id) setDetail(undefined);
                  setSelectedId(item.id);
                  setError('');
                  setNotice('');
                }}
              >
                <span className="evolution-row-title">{item.title}</span>
                <span className="evolution-row-meta">
                  {labels[item.status]}
                  {item.priority === 'high' && item.status === 'pending' ? ' · 值得关注' : ''}
                </span>
                <small>{date(item.created)}</small>
              </button>
            </div>
          ))}
          <div className="evolution-pagination">
            <button
              type="button"
              disabled={listBusy || offset === 0}
              onClick={() => {
                setOffset((old) => Math.max(0, old - pageSize));
                setSelection([]);
              }}
            >
              上一页
            </button>
            <button
              type="button"
              disabled={listBusy || !catalog || offset + pageSize >= catalog.total}
              onClick={() => {
                setOffset((old) => old + pageSize);
                setSelection([]);
              }}
            >
              下一页
            </button>
          </div>
        </div>
        <article className="evolution-detail" aria-busy={detailBusy}>
          {selectedId && (
            <button type="button" className="back-to-list" onClick={() => setSelectedId(undefined)}>
              ← 建议列表
            </button>
          )}
          {detailBusy && !detail ? (
            <p>正在读取建议…</p>
          ) : detail ? (
            <>
              <p className="evolution-detail-meta">
                {labels[detail.status]} · {date(detail.created)}
              </p>
              <h2>{detail.title}</h2>
              {detail.discussionError && detail.status === 'pending' && (
                <p className="notice error">{detail.discussionError}</p>
              )}
              {detail.priority === 'high' && detail.attentionReason && (
                <p className="evolution-attention">值得关注：{detail.attentionReason}</p>
              )}
              <dl className="evolution-content">
                <dt>改进目标</dt>
                <dd>{detail.goal}</dd>
                <dt>形成原因</dt>
                <dd>{detail.reason}</dd>
                <dt>预期价值</dt>
                <dd>{detail.value}</dd>
                <dt>当前不确定性</dt>
                <dd>{detail.uncertainty}</dd>
                <dt>建议方向</dt>
                <dd>{detail.action}</dd>
              </dl>
              <details className="evolution-sources">
                <summary>依据与来源（{detail.evidence.length} 项引用）</summary>
                {detail.project && (
                  <p>
                    项目：<code>{detail.project}</code>
                  </p>
                )}
                {detail.source && (
                  <p>
                    提交来源：<code>{detail.source.sessionId}</code>
                    {onEvidence && (
                      <button
                        type="button"
                        onClick={() => {
                          if (detail.source) onEvidence(detail.source);
                        }}
                      >
                        查看来源记录
                      </button>
                    )}
                  </p>
                )}
                {detail.evidence.length ? (
                  <ul>
                    {detail.evidence.map((value) => (
                      <Evidence
                        key={JSON.stringify(value)}
                        value={value}
                        onEvidence={onEvidence}
                        onMemory={(id, revision) => onMemory?.(id, revision, detail.project ?? undefined)}
                        onSkill={(id, revision) => onSkill?.(id, revision, detail.project ?? undefined)}
                        onReflection={onReflection}
                      />
                    ))}
                  </ul>
                ) : (
                  <p>当前没有历史引用，构想仍需讨论。</p>
                )}
              </details>
              <footer>
                {detail.status === 'pending' && (
                  <>
                    <p>采纳后进入独立讨论，具体改动需另行确认。</p>
                    <button type="button" disabled={busy} onClick={() => adopt(detail)}>
                      采纳并讨论
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => manage('ignored', [{ id: detail.id, baseRevision: detail.revision }])}
                    >
                      忽略
                    </button>
                  </>
                )}
                {detail.discussionSessionId && detail.status !== 'pending' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void guard(async () => {
                        if (detail.discussionSessionId) await onDiscuss(detail.discussionSessionId);
                      })
                    }
                  >
                    进入讨论
                  </button>
                )}
                {detail.status !== 'archived' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => manage('archived', [{ id: detail.id, baseRevision: detail.revision }])}
                  >
                    归档
                  </button>
                )}
              </footer>
            </>
          ) : (
            <p className="evolution-empty">选择一条建议，查看目标、依据与不确定性。</p>
          )}
        </article>
      </div>
    </section>
  );
}
