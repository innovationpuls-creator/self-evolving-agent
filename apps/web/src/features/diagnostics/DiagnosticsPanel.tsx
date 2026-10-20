import { readPosition, savePosition } from '../../app/view-state';
import { useEffect, useRef, useState } from 'react';
import type {
  DiagnosticCall as Call,
  DiagnosticEvent,
  DiagnosticTrace as Trace,
  DiagnosticTurn as Turn,
} from '../../../../host/diagnostics/diagnostics';

type Api = <T>(path: string, method?: string, data?: unknown, signal?: AbortSignal) => Promise<T>;
type TraceStatus = Trace['status'];
interface Health {
  available: boolean;
  dropped: number;
}
interface Catalog {
  items: Trace[];
  total: number;
  health?: Health;
  sessionEvents?: DiagnosticEvent[];
  sessionEventTotal?: number;
  sessionEventsTruncated?: boolean;
  sessionEventsUnavailable?: boolean;
}
interface Detail {
  trace: Trace;
  turns: Turn[];
  calls: Call[];
  events: DiagnosticEvent[];
  totals: { turns: number; calls: number; events: number };
  sameToolOccurrences: { name: string; count: number }[];
  health?: Health;
}
export interface EvidenceReference {
  sessionId: string;
  entryId: string;
  toolCallId?: string;
}
interface Evidence extends EvidenceReference {
  available: boolean;
  reason?: string;
  source: 'checkpoint' | 'previous_checkpoint';
  content?: string;
  total: number;
  nextOffset?: number;
  truncated: boolean;
  nested?: boolean;
}
interface Filters {
  sessionId: string;
  traceId: string;
  entryId: string;
  branchLeafId: string;
  from: string;
  to: string;
  toolName: string;
  status: string;
  hasError: boolean;
}
const statuses: Record<TraceStatus, string> = {
  running: '运行中',
  ended: '执行已结束',
  stopped: '已停止',
  failed: '执行失败',
  interrupted: '运行中断',
};
const callStatuses: Record<string, string> = {
  running: '运行中',
  succeeded: '调用成功',
  success: '调用成功',
  completed: '调用已完成',
  failed: '调用失败',
  stopped: '已停止',
  interrupted: '调用中断',
  unknown: '状态未知',
  ok: '调用成功',
  error: '调用失败',
  unfinished: '调用未完成',
};
const date = (value: number | undefined | null) => (value == null ? '未知' : new Date(value).toLocaleString('zh-CN'));
const duration = (value: number | undefined | null) =>
  value == null ? '耗时未知' : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
const pageSize = 30;
const detailPageSize = 50;
const evidencePageSize = 8192;
const emptyFilters = (sessionId = '', entryId = ''): Filters => ({
  sessionId,
  traceId: '',
  entryId,
  branchLeafId: '',
  from: '',
  to: '',
  toolName: '',
  status: '',
  hasError: false,
});

function Metrics({ value }: { value: unknown }) {
  return value && typeof value === 'object' && Object.keys(value).length ? (
    <details>
      <summary>详细指标与关联</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  ) : null;
}

export function DiagnosticsPanel({
  api,
  session,
  initialEvidence,
  onClose,
}: {
  api: Api;
  session?: { id: string; title: string };
  initialEvidence?: EvidenceReference;
  onClose: () => void;
}) {
  const initial = {
    ...emptyFilters(session?.id ?? initialEvidence?.sessionId, initialEvidence?.entryId),
    status: readPosition('diagnostics').filter ?? '',
  };
  const [filters, setFilters] = useState(initial);
  const [applied, setApplied] = useState(initial);
  const [catalog, setCatalog] = useState<Catalog>();
  const [detail, setDetail] = useState<Detail>();
  const [selectedId, setSelectedId] = useState<string | undefined>(
    initialEvidence ? undefined : readPosition('diagnostics').id,
  );
  const [offset, setOffset] = useState(readPosition('diagnostics').offset ?? 0);
  const [detailOffset, setDetailOffset] = useState(0);
  const [reference, setReference] = useState<EvidenceReference | undefined>(initialEvidence);
  const [evidence, setEvidence] = useState<Evidence>();
  const [evidenceOffset, setEvidenceOffset] = useState(0);
  const [listBusy, setListBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [error, setError] = useState('');
  const [evidenceError, setEvidenceError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    savePosition('diagnostics', { id: selectedId, offset, filter: applied.status });
  }, [selectedId, offset, applied.status]);
  const listEpoch = useRef(0);
  const detailEpoch = useRef(0);
  const evidenceEpoch = useRef(0);

  useEffect(() => {
    const update = () => {
      listEpoch.current++;
      detailEpoch.current++;
      evidenceEpoch.current++;
      setRefresh((value) => value + 1);
    };
    window.addEventListener('agent-diagnostics-changed', update);
    window.addEventListener('agent-reconnected', update);
    return () => {
      listEpoch.current++;
      detailEpoch.current++;
      evidenceEpoch.current++;
      window.removeEventListener('agent-diagnostics-changed', update);
      window.removeEventListener('agent-reconnected', update);
    };
  }, []);

  useEffect(() => {
    const epoch = ++listEpoch.current;
    const controller = new AbortController();
    setListBusy(true);
    setError('');
    const query = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    for (const [key, value] of Object.entries(applied)) {
      if (key === 'hasError') {
        if (value) query.set(key, 'true');
      } else if (value) {
        query.set(key, key === 'from' || key === 'to' ? String(new Date(String(value)).getTime()) : String(value));
      }
    }
    void api<Catalog>(`/diagnostics?${query}`, 'GET', undefined, controller.signal)
      .then((value) => {
        if (epoch === listEpoch.current) setCatalog(value);
      })
      .catch((reason: unknown) => {
        if (epoch === listEpoch.current) setError(reason instanceof Error ? reason.message : '诊断读取失败');
      })
      .finally(() => {
        if (epoch === listEpoch.current) setListBusy(false);
      });
    return () => {
      listEpoch.current++;
      controller.abort();
    };
  }, [api, applied, offset, refresh]);

  useEffect(() => {
    const epoch = ++detailEpoch.current;
    const controller = new AbortController();
    if (!selectedId) {
      setDetail(undefined);
      setDetailBusy(false);
      return;
    }
    setDetailBusy(true);
    void api<Detail>(
      `/diagnostics/${encodeURIComponent(selectedId)}?limit=${detailPageSize}&offset=${detailOffset}`,
      'GET',
      undefined,
      controller.signal,
    )
      .then((value) => {
        if (epoch === detailEpoch.current) setDetail(value);
      })
      .catch((reason: unknown) => {
        if (epoch === detailEpoch.current) {
          setDetail(undefined);
          setError(reason instanceof Error ? reason.message : '执行详情读取失败');
        }
      })
      .finally(() => {
        if (epoch === detailEpoch.current) setDetailBusy(false);
      });
    return () => {
      detailEpoch.current++;
      controller.abort();
    };
  }, [api, selectedId, detailOffset, refresh]);

  useEffect(() => {
    const epoch = ++evidenceEpoch.current;
    const controller = new AbortController();
    if (!reference) {
      setEvidence(undefined);
      setEvidenceBusy(false);
      return;
    }
    setEvidence(undefined);
    setEvidenceError('');
    setEvidenceBusy(true);
    const query = new URLSearchParams({
      sessionId: reference.sessionId,
      entryId: reference.entryId,
      ...(reference.toolCallId ? { toolCallId: reference.toolCallId } : {}),
      offset: String(evidenceOffset),
      limit: String(evidencePageSize),
    });
    void api<Evidence>(`/diagnostics/evidence?${query}`, 'GET', undefined, controller.signal)
      .then((value) => {
        if (epoch === evidenceEpoch.current) setEvidence(value);
      })
      .catch((reason: unknown) => {
        if (epoch === evidenceEpoch.current) {
          setEvidenceError(reason instanceof Error ? reason.message : '原始证据读取失败');
        }
      })
      .finally(() => {
        if (epoch === evidenceEpoch.current) setEvidenceBusy(false);
      });
    return () => {
      evidenceEpoch.current++;
      controller.abort();
    };
  }, [api, reference, evidenceOffset, refresh]);

  const showEvidence = (entryId: string, toolCallId?: string, sessionId = detail?.trace.sessionId) => {
    if (!sessionId) return;
    evidenceEpoch.current++;
    setEvidenceOffset(0);
    setReference({ sessionId, entryId, ...(toolCallId ? { toolCallId } : {}) });
  };
  const evidenceButton = (
    entryId: string | undefined | null,
    label = '查看原始证据',
    toolCallId?: string,
    sessionId?: string,
  ) =>
    entryId ? (
      <button type="button" onClick={() => showEvidence(entryId, toolCallId, sessionId)}>
        {label}
      </button>
    ) : null;
  const trace = detail?.trace;
  const health = catalog?.health;
  return (
    <section className="diagnostics-panel">
      <header>
        <div>
          <h1>{session ? '会话运行诊断' : '历史日志'}</h1>
          <p>{session ? session.title : '按执行记录查找历史行为与原始证据'}</p>
        </div>
        <div className="actions">
          <button type="button" onClick={() => setRefresh((value) => value + 1)}>
            刷新
          </button>
          <button type="button" onClick={onClose}>
            返回对话
          </button>
        </div>
      </header>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {health && (!health.available || health.dropped > 0) && (
        <p className="notice" role="status">
          {!health.available ? '诊断采集暂不可用。' : ''}
          {health.dropped > 0 ? `有 ${health.dropped} 项采集记录缺失。` : ''} 已有记录仍可按需查看。
        </p>
      )}
      <form
        className="diagnostics-filters"
        onSubmit={(event) => {
          event.preventDefault();
          listEpoch.current++;
          detailEpoch.current++;
          evidenceEpoch.current++;
          setApplied({ ...filters });
          setOffset(0);
          setCatalog(undefined);
          setSelectedId(undefined);
          setDetail(undefined);
          setReference(undefined);
        }}
      >
        <label>
          Tool
          <input
            aria-label="诊断 Tool 筛选"
            value={filters.toolName}
            placeholder="全部 Tool"
            onChange={(e) => setFilters({ ...filters, toolName: e.target.value })}
          />
        </label>
        <label>
          执行状态
          <select
            aria-label="诊断状态筛选"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">全部状态</option>
            {Object.entries(statuses).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="diagnostics-checkbox">
          <input
            type="checkbox"
            checked={filters.hasError}
            onChange={(e) => setFilters({ ...filters, hasError: e.target.checked })}
          />{' '}
          仅含异常
        </label>
        <button type="submit">筛选</button>
        <details className="diagnostics-advanced">
          <summary>会话、时间与证据定位</summary>
          <div className="diagnostics-filter-fields">
            <label>
              Session ID
              <input
                aria-label="诊断 Session ID"
                readOnly={!!session}
                value={filters.sessionId}
                onChange={(e) => setFilters({ ...filters, sessionId: e.target.value })}
              />
            </label>
            <label>
              Trace ID
              <input
                aria-label="诊断 Trace ID"
                value={filters.traceId}
                onChange={(e) => setFilters({ ...filters, traceId: e.target.value })}
              />
            </label>
            <label>
              Entry ID
              <input
                aria-label="诊断 Entry ID"
                value={filters.entryId}
                onChange={(e) => setFilters({ ...filters, entryId: e.target.value })}
              />
            </label>
            <label>
              分支节点
              <input
                aria-label="诊断分支节点"
                value={filters.branchLeafId}
                onChange={(e) => setFilters({ ...filters, branchLeafId: e.target.value })}
              />
            </label>
            <label>
              开始时间
              <input
                aria-label="诊断开始时间"
                type="datetime-local"
                value={filters.from}
                onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              />
            </label>
            <label>
              结束时间
              <input
                aria-label="诊断结束时间"
                type="datetime-local"
                value={filters.to}
                onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              />
            </label>
          </div>
        </details>
      </form>
      <div className="diagnostics-layout" data-detail={!!selectedId || !!reference}>
        <div className="diagnostics-list" aria-busy={listBusy}>
          {listBusy && (
            <p className="diagnostics-muted" role="status">
              正在读取执行记录…
            </p>
          )}
          {!listBusy && catalog && !catalog.items.length && (
            <p className="diagnostics-muted">没有符合条件的执行记录。较早的原始历史可通过来源引用直接查看。</p>
          )}
          {catalog?.items.map((item) => (
            <button
              type="button"
              className={`diagnostics-item ${item.id === selectedId ? 'selected' : ''}`}
              key={item.id}
              onClick={() => {
                detailEpoch.current++;
                evidenceEpoch.current++;
                setSelectedId(item.id);
                setRefresh((value) => value + 1);
                setDetailOffset(0);
                setDetail(undefined);
                setReference(undefined);
              }}
            >
              <small>{date(item.started)}</small>
              <b>{statuses[item.status]}</b>
              <span>
                {item.toolCount} 次 Tool · {item.errorCount} 项异常 ·{' '}
                {duration(item.ended == null ? null : item.ended - item.started)}
              </span>
              <small>
                Session {item.sessionId.slice(0, 8)} · Trace {item.id.slice(0, 8)}
                {item.incomplete ? ' · 记录不完整' : ''}
              </small>
            </button>
          ))}
          <div className="diagnostics-controls">
            <button
              type="button"
              disabled={!offset || listBusy}
              onClick={() => setOffset((old) => Math.max(0, old - pageSize))}
            >
              上一页
            </button>
            <small>{catalog?.total ?? 0} 条</small>
            <button
              type="button"
              disabled={listBusy || offset + pageSize >= (catalog?.total ?? 0)}
              onClick={() => setOffset((old) => old + pageSize)}
            >
              下一页
            </button>
          </div>
        </div>
        <div className="diagnostics-detail" aria-busy={detailBusy}>
          {(selectedId || reference) && (
            <button
              type="button"
              className="back-to-list"
              onClick={() => {
                setSelectedId(undefined);
                setReference(undefined);
              }}
            >
              ← 日志列表
            </button>
          )}
          {applied.sessionId && catalog?.sessionEvents && (
            <details>
              <summary>会话级事件 · {catalog.sessionEventTotal ?? catalog.sessionEvents.length} 项</summary>
              <p>最近 100 项，不属于某次任务的压缩等运行事件。</p>
              {(catalog.sessionEventsTruncated || (catalog.sessionEventTotal ?? 0) > catalog.sessionEvents.length) && (
                <p>更早事件未在此列表展示；原始历史仍可按 Entry 引用查阅。</p>
              )}
              {catalog.sessionEventsUnavailable ? (
                <p>会话证据暂不可用；已有诊断指标仍可查看。</p>
              ) : (
                !catalog.sessionEvents.length && <p>暂无会话级事件。</p>
              )}
              {catalog.sessionEvents.map((event) => (
                <article key={event.id}>
                  <b>{event.kind}</b>
                  <p>{date(event.at)}</p>
                  {evidenceButton(event.entryId, '查看事件证据', undefined, applied.sessionId)}
                  <Metrics value={event.data} />
                </article>
              ))}
            </details>
          )}
          {!trace && (
            <p className="diagnostics-muted">
              {detailBusy ? '正在读取详情…' : '选择一次执行，按需查看调用、指标与证据。'}
            </p>
          )}
          {trace && detail && (
            <>
              <h2>{statuses[trace.status]}</h2>
              <p className="diagnostics-muted">
                {date(trace.started)} · {duration(trace.ended == null ? null : trace.ended - trace.started)}
              </p>
              <p className="diagnostics-muted">执行结束状态只描述运行结果，任务是否达成需结合证据判断。</p>
              {trace.incomplete && <p className="notice">部分诊断记录缺失；请结合原始历史检查。</p>}
              <div className="diagnostics-controls">{evidenceButton(trace.userEntryId, '查看任务原文')}</div>
              <details>
                <summary>执行来源与分支</summary>
                <p className="diagnostics-id">
                  Session {trace.sessionId}
                  <br />
                  Trace {trace.id}
                  <br />
                  起点 {trace.startLeafId ?? '无'}
                  <br />
                  终点 {trace.endLeafId ?? '未知'}
                </p>
              </details>
              <Metrics value={trace.data} />
              {!!detail.sameToolOccurrences?.length && (
                <details>
                  <summary>同名 Tool 调用次数</summary>
                  {detail.sameToolOccurrences.map((item) => (
                    <p key={item.name}>
                      {item.name} · {item.count} 次
                    </p>
                  ))}
                </details>
              )}
              <details open>
                <summary>Tool 调用 · {detail.totals.calls} 次</summary>
                {!detail.calls.length && <p>本页没有 Tool 调用。</p>}
                {detail.calls.map((call) => (
                  <article className="diagnostics-call" key={call.id}>
                    <b>
                      #{call.sequence} {call.toolName}
                    </b>
                    <p>
                      {callStatuses[call.status] ?? call.status} · {duration(call.durationMs)} ·{' '}
                      {call.outputBytes == null ? '输出规模未知' : `${call.outputBytes.toLocaleString()} bytes`}
                    </p>
                    {call.parentToolCallId && <p className="diagnostics-id">父调用 {call.parentToolCallId}</p>}
                    <div className="diagnostics-controls">
                      {evidenceButton(call.resultEntryId, '查看调用结果', call.toolCallId)}
                      {evidenceButton(call.assistantEntryId, '查看调用参数')}
                    </div>
                    {!call.resultEntryId && <p className="diagnostics-muted">原生结果尚不可用或未单独保存。</p>}
                    <Metrics value={call.data} />
                  </article>
                ))}
              </details>
              <details>
                <summary>模型与 Turn · {detail.totals.turns} 轮</summary>
                {detail.turns.map((turn) => (
                  <article key={turn.id}>
                    <b>
                      Turn {turn.ordinal} · {turn.model ?? '模型未知'}
                    </b>
                    <p>
                      {turn.provider ?? '提供方未知'} · {turn.stopReason ?? '结束原因未知'}
                    </p>
                    {evidenceButton(turn.assistantEntryId, '查看原始消息')}
                    <Metrics value={{ ...(turn.usage ? { usage: turn.usage } : {}), ...turn.data }} />
                  </article>
                ))}
              </details>
              <details>
                <summary>上下文与运行事件 · {detail.totals.events} 项</summary>
                {detail.events.map((event) => (
                  <article key={event.id}>
                    <b>{event.kind}</b>
                    <p>{date(event.at)}</p>
                    {evidenceButton(event.entryId)}
                    <Metrics value={event.data} />
                  </article>
                ))}
              </details>
              <div className="diagnostics-controls">
                <button
                  type="button"
                  disabled={!detailOffset || detailBusy}
                  onClick={() => setDetailOffset((old) => Math.max(0, old - detailPageSize))}
                >
                  详情上一页
                </button>
                <small>第 {Math.floor(detailOffset / detailPageSize) + 1} 页</small>
                <button
                  type="button"
                  disabled={detailBusy || detailOffset + detailPageSize >= Math.max(...Object.values(detail.totals))}
                  onClick={() => setDetailOffset((old) => old + detailPageSize)}
                >
                  详情下一页
                </button>
              </div>
            </>
          )}
          {reference && (
            <section className="diagnostics-evidence" aria-label="原始执行证据" aria-busy={evidenceBusy}>
              <div className="diagnostics-controls">
                <h2>原始执行证据</h2>
                <button type="button" onClick={() => setReference(undefined)}>
                  收起证据
                </button>
              </div>
              <p className="diagnostics-id">
                Session {reference.sessionId}
                <br />
                Entry {reference.entryId}
                {reference.toolCallId && (
                  <>
                    <br />
                    调用 {reference.toolCallId}
                  </>
                )}
              </p>
              {evidenceBusy && <p role="status">正在读取原始证据…</p>}
              {evidenceError && (
                <p role="alert" className="notice error">
                  {evidenceError}
                </p>
              )}
              {evidence && (
                <>
                  {evidence.source === 'previous_checkpoint' && (
                    <p className="notice">来自上一有效检查点，可能缺少最新执行进度。</p>
                  )}
                  {evidence.nested && <p>嵌套调用仅保留原生摘要，完整子调用结果未单独保存。</p>}
                  {!evidence.available && (
                    <p className="notice">
                      {evidence.reason === 'not_persisted_native'
                        ? 'Pi 原生历史未保存这项完整结果。'
                        : `此证据暂不可用${evidence.reason ? `：${evidence.reason}` : ''}。`}
                    </p>
                  )}
                  {evidence.content !== undefined && <pre>{evidence.content}</pre>}
                  <div className="diagnostics-controls">
                    <button
                      type="button"
                      disabled={!evidenceOffset || evidenceBusy}
                      onClick={() => setEvidenceOffset((old) => Math.max(0, old - evidencePageSize))}
                    >
                      前一段证据
                    </button>
                    <small>
                      {evidenceOffset + 1}–{Math.min(evidenceOffset + (evidence.content?.length ?? 0), evidence.total)}{' '}
                      / {evidence.total}
                    </small>
                    <button
                      type="button"
                      disabled={evidenceBusy || evidence.nextOffset === undefined}
                      onClick={() => {
                        if (evidence.nextOffset !== undefined) setEvidenceOffset(evidence.nextOffset);
                      }}
                    >
                      后一段证据
                    </button>
                  </div>
                  {evidence.truncated && <small>当前仅展示原始证据的一段，可继续翻阅。</small>}
                </>
              )}
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
