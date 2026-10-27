import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  DiagnosticCall,
  DiagnosticEvent,
  DiagnosticTrace,
  DiagnosticTurn,
} from '../../../../host/diagnostics/diagnostics';
import { messageText, type Session } from '../chat/session-state';
import { EvidenceView } from './EvidenceView';
import type { Api, EvidenceReference, EvidenceTarget } from './evidence';
import { callStatuses, date, duration, Metrics, statuses } from './presentation';
import {
  matchesSearch,
  projectTrajectory,
  turnText,
  type TrajectoryCall,
  type TrajectoryGroup,
} from './trajectory-state';
import './trajectory.css';

interface Detail {
  trace: DiagnosticTrace;
  turns: DiagnosticTurn[];
  calls: DiagnosticCall[];
  events: DiagnosticEvent[];
  totals: { turns: number; calls: number; events: number };
  health?: { available: boolean; dropped: number };
}
type Selection = { group: string; turn?: string; call?: string; entry?: string };
export interface TrajectoryViewState {
  query: string;
  count: number;
  collapsed: string[];
  callsCollapsed: string[];
  selection?: Selection;
  scroll?: number;
  follow: boolean;
}
const initialState = (): TrajectoryViewState => ({
  query: '',
  count: 30,
  collapsed: [],
  callsCollapsed: [],
  follow: true,
});

export function TrajectoryPanel({
  api,
  session: inputSession,
  active,
  states,
  target,
  onTargetDone,
}: {
  api: Api;
  session?: Session;
  active: boolean;
  states: Map<string, TrajectoryViewState>;
  target?: EvidenceTarget;
  onTargetDone: () => void;
}) {
  const session: Session = inputSession ?? {
    id: target?.sessionId ?? 'source',
    title: '来源会话',
    cwd: '',
    model: '',
    provider: '',
    busy: false,
    stateVersion: 0,
  };
  const [ui, setUi] = useState(() => states.get(session.id) ?? initialState());
  const [snapshot, setSnapshot] = useState(session);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');
  const [newContent, setNewContent] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [source, setSource] = useState<{
    sessionId: string;
    detail?: Detail;
    reference?: EvidenceReference;
    error?: string;
  }>();
  const [sourceTarget, setSourceTarget] = useState<EvidenceTarget>();
  const scroll = useRef<HTMLDivElement>(null);
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const update = (value: Partial<TrajectoryViewState>) =>
    setUi((old) => {
      const next = { ...old, ...value };
      states.set(session.id, next);
      return next;
    });
  useEffect(() => {
    if (inputSession) setSnapshot(inputSession);
  }, [inputSession?.tree, inputSession?.leafId]);
  useEffect(() => {
    const update = () => setRefresh((n) => n + 1);
    window.addEventListener('agent-diagnostics-changed', update);
    window.addEventListener('agent-reconnected', update);
    return () => {
      window.removeEventListener('agent-diagnostics-changed', update);
      window.removeEventListener('agent-reconnected', update);
    };
  }, []);
  useEffect(() => {
    if (!active || !inputSession) return;
    const controller = new AbortController();
    let live = true;
    void api<Session>(`/sessions/${session.id}`, 'GET', undefined, controller.signal)
      .then((next) => {
        if (live) {
          setSnapshot(next);
          setError('');
        }
      })
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : '轨迹读取失败');
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [api, session.id, session.messages, session.busy, refresh, active]);
  const groups = useMemo(
    () =>
      projectTrajectory({
        ...snapshot,
        busy: session.busy,
        messages: session.messages,
        streamingMessage: session.streamingMessage,
      }),
    [snapshot, session.busy, session.messages, session.streamingMessage],
  );
  const [details, setDetails] = useState<Map<string, Detail>>(new Map());
  const selection = ui.selection;
  const selectedGroup = groups.find((g) => g.id === selection?.group);
  useEffect(() => {
    const id = selectedGroup?.traceId;
    if (!active || !id) return;
    const controller = new AbortController();
    let live = true;
    const load = async () => {
      let result: Detail | undefined;
      for (let offset = 0; ; offset += 200) {
        const page = await api<Detail>(
          `/diagnostics/${id}?limit=200&offset=${offset}`,
          'GET',
          undefined,
          controller.signal,
        );
        if (!result) result = page;
        else
          result = {
            ...page,
            turns: [...result.turns, ...page.turns],
            calls: [...result.calls, ...page.calls],
            events: [...result.events, ...page.events],
          };
        if (offset + 200 >= Math.max(page.totals.turns, page.totals.calls, page.totals.events)) break;
      }
      if (live && result) {
        const detail = result;
        setDetails((old) => new Map(old).set(id, detail));
        setError('');
      }
    };
    void load().catch((reason: unknown) => {
      if (live) setError(reason instanceof Error ? reason.message : '指标读取失败');
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [api, active, selectedGroup?.traceId, refresh]);

  // Evidence may identify an old branch or a restricted background Session. Read the
  // existing diagnostic projection, never navigate the native branch or activate an Agent.
  useEffect(() => {
    if (target) setSourceTarget(target);
  }, [target]);
  useEffect(() => {
    if (!sourceTarget) return;
    const controller = new AbortController();
    let live = true;
    const load = async () => {
      let id = sourceTarget.sessionId;
      let detail: Detail | undefined;
      if (sourceTarget.traceId)
        detail = await api<Detail>(`/diagnostics/${sourceTarget.traceId}`, 'GET', undefined, controller.signal);
      else if (id && sourceTarget.entryId) {
        const page = await api<{ items: DiagnosticTrace[] }>(
          `/diagnostics?${new URLSearchParams({ sessionId: id, entryId: sourceTarget.entryId })}`,
          'GET',
          undefined,
          controller.signal,
        );
        if (page.items[0])
          detail = await api<Detail>(`/diagnostics/${page.items[0].id}`, 'GET', undefined, controller.signal);
      }
      id = detail?.trace.sessionId ?? id;
      if (!id) throw new Error('来源会话不可用');
      if (!live) return;
      const reference = sourceTarget.entryId
        ? {
            sessionId: id,
            entryId: sourceTarget.entryId,
            ...(sourceTarget.toolCallId ? { toolCallId: sourceTarget.toolCallId } : {}),
          }
        : undefined;
      const own = groups.find(
        (g) => (!!detail && g.traceId === detail.trace.id) || g.entries.some((e) => e.id === sourceTarget.entryId),
      );
      if (id === session.id && own) {
        const matchesCall = (c: TrajectoryCall) =>
          (!!sourceTarget.toolCallId && c.id === sourceTarget.toolCallId) ||
          (!!sourceTarget.entryId && c.resultEntryId === sourceTarget.entryId);
        const turn = own.turns.find(
          (t) => (!!sourceTarget.entryId && t.entryId === sourceTarget.entryId) || t.calls.some(matchesCall),
        );
        const call = turn?.calls.find(matchesCall);
        update({
          count: Math.max(uiRef.current.count, groups.length - groups.indexOf(own)),
          query: '',
          collapsed: uiRef.current.collapsed.filter((x) => x !== own.id),
          callsCollapsed: uiRef.current.callsCollapsed.filter((x) => x !== turn?.id),
          follow: false,
          selection: { group: own.id, turn: turn?.id, call: call?.id, entry: sourceTarget.entryId },
        });
        if (detail) {
          const loaded = detail;
          setDetails((old) => new Map(old).set(loaded.trace.id, loaded));
        }
        setSource(undefined);
        setRawOpen(!!reference);
      } else if (id === session.id && !sourceTarget.entryId && !sourceTarget.traceId && inputSession) {
        setSource(undefined);
        update({ count: uiRef.current.count, follow: true, selection: undefined });
      } else setSource({ sessionId: id, detail, reference });
      onTargetDone();
    };
    void load().catch((reason: unknown) => {
      if (live)
        setSource({
          sessionId: sourceTarget.sessionId ?? '',
          error: reason instanceof Error ? reason.message : '来源读取失败',
        });
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [api, sourceTarget]);

  useEffect(() => {
    if (!active || !scroll.current) return;
    const el = scroll.current;
    if (uiRef.current.follow) {
      el.scrollTop = el.scrollHeight;
      setNewContent(false);
    } else if (uiRef.current.scroll !== undefined) el.scrollTop = uiRef.current.scroll;
  }, [active]);
  const contentVersion = JSON.stringify(groups);
  const seenContent = useRef(contentVersion);
  useEffect(() => {
    if (!active || !scroll.current) return;
    const changed = seenContent.current !== contentVersion;
    seenContent.current = contentVersion;
    if (uiRef.current.follow) scroll.current.scrollTop = scroll.current.scrollHeight;
    else if (changed) setNewContent(true);
  }, [contentVersion, active]);
  useEffect(() => {
    if (!selection || !active) return;
    const row = scroll.current?.querySelector<HTMLElement>('[aria-current="true"]');
    row?.scrollIntoView({ block: 'nearest' });
  }, [selection, active]);
  const choose = (value: Selection) => {
    setRawOpen(false);
    setSource(undefined);
    setSourceTarget(undefined);
    update({ selection: value });
  };
  const toggle = (key: 'collapsed' | 'callsCollapsed', id: string) =>
    update({ [key]: ui[key].includes(id) ? ui[key].filter((x) => x !== id) : [...ui[key], id] });
  const visible = groups.slice(-ui.count);
  const nativeDetail = selectedGroup?.traceId ? details.get(selectedGroup.traceId) : undefined;
  const turn = selectedGroup?.turns.find((t) => t.id === selection?.turn);
  const call = turn?.calls.find((c) => c.id === selection?.call);
  const recordedCall = nativeDetail?.calls.find((c) => c.toolCallId === call?.id);
  const recordedTurn = nativeDetail?.turns.find((t) => t.assistantEntryId === turn?.entryId);
  const reference = selection?.entry
    ? {
        sessionId: session.id,
        entryId: selection.entry,
        ...(call?.resultEntryId === selection.entry ? { toolCallId: call.id } : {}),
      }
    : call?.resultEntryId
      ? { sessionId: session.id, entryId: call.resultEntryId, toolCallId: call.id }
      : turn?.entryId
        ? { sessionId: session.id, entryId: turn.entryId }
        : selectedGroup?.user && !selectedGroup.user.id.startsWith('live:')
          ? { sessionId: session.id, entryId: selectedGroup.user.id }
          : undefined;
  const showStatus = (g: TrajectoryGroup) =>
    g.complete
      ? (({ ...statuses } as Record<string, string>)[g.status ?? 'ended'] ?? '执行已结束')
      : g === groups.at(-1) && session.busy
        ? '运行中'
        : g.traceId
          ? '当前分支片段'
          : '原生历史';
  const callStatus = (item: TrajectoryCall) =>
    item.result
      ? item.result.isError
        ? '调用失败'
        : '调用完成'
      : session.busy && selectedGroup === groups.at(-1)
        ? '等待结果'
        : '当前分支未包含结果';
  return (
    <section className="trajectory-panel" aria-label="会话轨迹">
      <div className="trajectory-toolbar">
        <button type="button" onClick={() => update({ collapsed: ui.collapsed.length ? [] : groups.map((g) => g.id) })}>
          {ui.collapsed.length ? '展开轮次' : '折叠轮次'}
        </button>
        <button
          type="button"
          onClick={() =>
            update({ callsCollapsed: ui.callsCollapsed.length ? [] : groups.flatMap((g) => g.turns.map((t) => t.id)) })
          }
        >
          {ui.callsCollapsed.length ? '展开调用' : '折叠调用'}
        </button>
        <input
          aria-label="搜索已加载轨迹"
          placeholder="搜索已加载轨迹"
          value={ui.query}
          onChange={(e) => update({ query: e.target.value })}
        />
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}{' '}
          <button type="button" onClick={() => setRefresh((n) => n + 1)}>
            重试轨迹
          </button>
        </p>
      )}
      <div className="trajectory-workspace" data-detail={!!selection || !!source}>
        <div
          className="trajectory-ledger"
          ref={scroll}
          onScroll={() => {
            const el = scroll.current;
            if (!el) return;
            const follow = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            update({ scroll: el.scrollTop, follow });
            if (follow) setNewContent(false);
          }}
        >
          {groups.length > ui.count && (
            <button type="button" onClick={() => update({ count: ui.count + 30, follow: false })}>
              加载更早轨迹
            </button>
          )}
          {!groups.length && <p className="diagnostics-muted">此会话尚无执行记录。</p>}
          {visible
            .filter((g) => matchesSearch(JSON.stringify(g), ui.query))
            .map((g) => (
              <section className="trajectory-group" key={g.id} data-trace-id={g.traceId}>
                <div className="trajectory-group-heading">
                  <button
                    type="button"
                    aria-label={`切换轮次 ${g.id}`}
                    aria-expanded={!ui.collapsed.includes(g.id)}
                    onClick={() => toggle('collapsed', g.id)}
                  >
                    {ui.collapsed.includes(g.id) ? '▸' : '▾'}
                  </button>
                  <button
                    type="button"
                    aria-current={selection?.group === g.id && !selection.turn && !selection.entry ? 'true' : undefined}
                    onClick={() => choose({ group: g.id })}
                  >
                    <b>
                      {g.traceId ? 'Trace' : g.turns.length ? '早期历史' : '会话事件'} · {showStatus(g)}
                    </b>
                    <span>
                      {g.user?.message ? messageText(g.user.message) : '执行概要'} · {g.turns.length} 个模型轮次 ·{' '}
                      {g.turns.reduce((n, t) => n + t.calls.length, 0)} 次 Tool
                    </span>
                  </button>
                </div>
                {!ui.collapsed.includes(g.id) && (
                  <>
                    {g.turns.map((t, ordinal) => (
                      <div className="trajectory-turn" key={t.id} data-turn-id={t.entryId}>
                        <button
                          type="button"
                          className="trajectory-row"
                          aria-current={selection?.turn === t.id && !selection.call ? 'true' : undefined}
                          onClick={() => choose({ group: g.id, turn: t.id })}
                        >
                          <small>
                            Turn {ordinal + 1} · {t.message.model ?? (t.live ? session.model : '模型未知')}
                          </small>
                          <span>{turnText(t)}</span>
                          {t.message.errorMessage && <span className="inline-error">{t.message.errorMessage}</span>}
                        </button>
                        {!!t.calls.length && (
                          <button
                            type="button"
                            className="trajectory-fold"
                            onClick={() => toggle('callsCollapsed', t.id)}
                          >
                            {ui.callsCollapsed.includes(t.id) ? '展开' : '收起'} {t.calls.length} 次调用
                          </button>
                        )}
                        {!ui.callsCollapsed.includes(t.id) &&
                          t.calls.map((c) => (
                            <button
                              type="button"
                              key={c.id}
                              data-call-id={c.id}
                              className="trajectory-row trajectory-call"
                              aria-current={selection?.call === c.id ? 'true' : undefined}
                              onClick={() => choose({ group: g.id, turn: t.id, call: c.id })}
                            >
                              <small>
                                Tool · {c.name} ·{' '}
                                {c.result
                                  ? c.result.isError
                                    ? '调用失败'
                                    : '调用完成'
                                  : session.busy && g === groups.at(-1)
                                    ? '等待结果'
                                    : '当前分支未包含结果'}
                              </small>
                              <span>{c.result ? messageText(c.result) : JSON.stringify(c.args)}</span>
                            </button>
                          ))}
                      </div>
                    ))}
                    {g.entries
                      .filter(
                        (e) =>
                          e.type !== 'session' &&
                          (!e.message ||
                            (e.message.role !== 'user' &&
                              e.message.role !== 'assistant' &&
                              !g.turns.some((t) => t.calls.some((c) => c.resultEntryId === e.id)))),
                      )
                      .map((e) => (
                        <button
                          type="button"
                          key={e.id}
                          className="trajectory-row"
                          aria-current={selection?.entry === e.id ? 'true' : undefined}
                          onClick={() => choose({ group: g.id, entry: e.id })}
                        >
                          <small>
                            {e.message?.toolName ??
                              (
                                {
                                  compaction: '上下文压缩',
                                  model_change: '模型设置',
                                  thinking_level_change: '推理强度调整',
                                  custom_message: '运行消息',
                                } as Record<string, string>
                              )[e.type] ??
                              e.type}
                          </small>
                          <span>
                            {e.message
                              ? messageText(e.message)
                              : date(e.timestamp ? Date.parse(e.timestamp) : undefined)}
                          </span>
                        </button>
                      ))}
                  </>
                )}
              </section>
            ))}
          {ui.query && !visible.some((g) => matchesSearch(JSON.stringify(g), ui.query)) && (
            <p>已加载轨迹中没有匹配记录。</p>
          )}
          {newContent && (
            <button
              className="trajectory-new"
              type="button"
              onClick={() => {
                update({ follow: true });
                setNewContent(false);
                if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
              }}
            >
              查看最新执行 ↓
            </button>
          )}
        </div>
        {(selection || source) && (
          <aside className="trajectory-inspector" aria-label="轨迹详情">
            <button
              type="button"
              onClick={() => {
                update({ selection: undefined });
                setSource(undefined);
                setSourceTarget(undefined);
              }}
            >
              关闭详情
            </button>
            {source ? (
              <>
                <h2>来源会话轨迹</h2>
                <p className="diagnostics-id">Session {source.sessionId}</p>
                <p>只读查看来源；当前执行分支保持不变。</p>
                {source.error ? (
                  <p role="alert">
                    {source.error}{' '}
                    <button type="button" onClick={() => sourceTarget && setSourceTarget({ ...sourceTarget })}>
                      重试来源
                    </button>
                  </p>
                ) : (
                  <SourceTrace api={api} source={source} refresh={refresh} />
                )}
              </>
            ) : (
              <>
                <h2>{call ? call.name : turn ? '模型轮次' : '执行概要'}</h2>
                {call ? (
                  <>
                    <p>
                      {callStatus(call)} ·{' '}
                      {duration(
                        call.result && recordedCall?.resultEntryId === call.resultEntryId
                          ? recordedCall?.durationMs
                          : call.result?.durationMs,
                      )}
                    </p>
                    <details>
                      <summary>参数</summary>
                      <pre>{JSON.stringify(call.args, null, 2)}</pre>
                    </details>
                    {call.result && (
                      <details>
                        <summary>{call.result.isError ? '错误结果' : '结果'}</summary>
                        <pre>{messageText(call.result)}</pre>
                      </details>
                    )}
                    <Metrics value={call.result ? recordedCall?.data : undefined} />
                  </>
                ) : turn ? (
                  <>
                    <p>
                      {turn.message.model ?? (turn.live ? session.model : '模型未知')} ·{' '}
                      {turn.message.provider ?? (turn.live ? session.provider : 'Provider 未知')} ·{' '}
                      {duration(
                        recordedTurn?.ended != null && recordedTurn.started != null
                          ? recordedTurn.ended - recordedTurn.started
                          : turn.message.durationMs,
                      )}
                    </p>
                    {turn.message.errorMessage && <p role="alert">{turn.message.errorMessage}</p>}
                    <pre>{messageText(turn.message)}</pre>
                    <Metrics value={recordedTurn?.usage ?? turn.message.usage} />
                    <Metrics value={recordedTurn?.data} />
                  </>
                ) : (
                  selectedGroup && (
                    <>
                      <p>
                        {showStatus(selectedGroup)} · {selectedGroup.turns.length} 个模型轮次 ·{' '}
                        {selectedGroup.turns.reduce((n, t) => n + t.calls.length, 0)} 次 Tool
                      </p>
                      {selectedGroup.user?.message && <p>{messageText(selectedGroup.user.message)}</p>}
                      {selectedGroup.complete && nativeDetail && (
                        <>
                          <p>
                            {date(nativeDetail.trace.started)} ·{' '}
                            {duration(
                              nativeDetail.trace.ended == null
                                ? null
                                : nativeDetail.trace.ended - nativeDetail.trace.started,
                            )}
                          </p>
                          <Metrics value={nativeDetail.trace.data} />
                          <details>
                            <summary>上下文与运行事件 · {nativeDetail.events.length} 项</summary>
                            {nativeDetail.events.map((e) => (
                              <article key={e.id}>
                                <b>{e.kind}</b>
                                <Metrics value={e.data} />
                                {e.entryId && (
                                  <button
                                    type="button"
                                    onClick={() => choose({ group: selectedGroup.id, entry: e.entryId ?? '' })}
                                  >
                                    查看事件证据
                                  </button>
                                )}
                              </article>
                            ))}
                          </details>
                        </>
                      )}
                      {nativeDetail?.health && (!nativeDetail.health.available || nativeDetail.health.dropped > 0) && (
                        <p className="notice">诊断索引不完整；以原始会话证据为准。</p>
                      )}
                      {nativeDetail?.trace.incomplete && <p className="notice">部分诊断记录缺失。</p>}
                    </>
                  )
                )}
                {reference && (
                  <details open={rawOpen} onToggle={(event) => setRawOpen(event.currentTarget.open)}>
                    <summary>查看原始证据</summary>
                    {rawOpen && (
                      <EvidenceView
                        key={`${reference.entryId}:${reference.toolCallId ?? ''}`}
                        api={api}
                        reference={reference}
                        refresh={refresh}
                      />
                    )}
                  </details>
                )}
              </>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}

function SourceTrace({
  api,
  source,
  refresh,
}: {
  api: Api;
  source: { sessionId: string; detail?: Detail; reference?: EvidenceReference };
  refresh: number;
}) {
  const [reference, setReference] = useState(source.reference);
  const [traceId, setTraceId] = useState(source.detail?.trace.id);
  const [detail, setDetail] = useState(source.detail);
  const [catalog, setCatalog] = useState<{ items: DiagnosticTrace[]; total: number }>();
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(30);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setReference(source.reference);
    setDetail(source.detail);
    setTraceId(source.detail?.trace.id);
    setLimit(30);
    setOffset(0);
  }, [source]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setBusy(true);
    setError('');
    const load = async () => {
      if (!traceId) {
        const page = await api<NonNullable<typeof catalog>>(
          `/diagnostics?sessionId=${source.sessionId}&limit=30&offset=${offset}`,
          'GET',
          undefined,
          controller.signal,
        );
        if (active) setCatalog(page);
      } else {
        let result: Detail | undefined;
        for (let pageOffset = 0; ; pageOffset += 200) {
          const page = await api<Detail>(
            `/diagnostics/${traceId}?limit=200&offset=${pageOffset}`,
            'GET',
            undefined,
            controller.signal,
          );
          result = result
            ? {
                ...page,
                turns: [...result.turns, ...page.turns],
                calls: [...result.calls, ...page.calls],
                events: [...result.events, ...page.events],
              }
            : page;
          if (pageOffset + 200 >= Math.max(page.totals.turns, page.totals.calls, page.totals.events)) break;
        }
        if (active) {
          setDetail(result);
          if (source.reference) setLimit(Math.max(30, result?.turns.length ?? 0, result?.calls.length ?? 0));
        }
      }
    };
    void load()
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '来源读取失败');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [api, source.sessionId, traceId, offset, refresh, retry]);
  const calls = (items: DiagnosticCall[]) =>
    items.slice(0, limit).map((c) => (
      <details
        key={c.id}
        data-call-id={c.toolCallId}
        open={c.resultEntryId === source.reference?.entryId || c.toolCallId === source.reference?.toolCallId}
      >
        <summary>
          {c.toolName} · {callStatuses[c.status]} · {duration(c.durationMs)}
        </summary>
        {c.assistantEntryId && (
          <button
            type="button"
            onClick={() => setReference({ sessionId: source.sessionId, entryId: c.assistantEntryId ?? '' })}
          >
            查看调用参数
          </button>
        )}
        {c.resultEntryId && (
          <button
            type="button"
            onClick={() =>
              setReference({ sessionId: source.sessionId, entryId: c.resultEntryId ?? '', toolCallId: c.toolCallId })
            }
          >
            查看调用结果
          </button>
        )}
        <Metrics value={c.data} />
      </details>
    ));
  return (
    <>
      {busy && <p role="status">正在读取来源轨迹…</p>}
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            重试来源轨迹
          </button>
        </p>
      )}
      {!traceId && catalog && (
        <>
          {catalog.items.map((trace) => (
            <button
              className="trajectory-row"
              type="button"
              key={trace.id}
              data-trace-id={trace.id}
              onClick={() => setTraceId(trace.id)}
            >
              Trace · {statuses[trace.status]} · {date(trace.started)}
            </button>
          ))}
          {!catalog.items.length && <p>此来源没有 Trace 索引；原始 Entry 仍可按引用查看。</p>}
          <div className="diagnostics-controls">
            <button type="button" disabled={busy || !offset} onClick={() => setOffset(Math.max(0, offset - 30))}>
              来源上一页
            </button>
            <button
              type="button"
              disabled={busy || offset + 30 >= catalog.total}
              onClick={() => setOffset(offset + 30)}
            >
              来源下一页
            </button>
          </div>
        </>
      )}
      {traceId && detail && (
        <>
          <button
            type="button"
            onClick={() => {
              setTraceId(undefined);
              setDetail(undefined);
            }}
          >
            返回来源会话轨迹
          </button>
          <h3>Trace · {statuses[detail.trace.status]}</h3>
          <p className="diagnostics-id">{detail.trace.id}</p>
          <p>
            {date(detail.trace.started)} ·{' '}
            {duration(detail.trace.ended == null ? null : detail.trace.ended - detail.trace.started)}
          </p>
          {detail.trace.incomplete && <p className="notice">部分诊断记录缺失。</p>}
          <Metrics value={detail.trace.data} />
          {detail.turns.slice(0, limit).map((t) => (
            <details
              key={t.id}
              data-turn-id={t.id}
              open={
                t.assistantEntryId === source.reference?.entryId ||
                detail.calls.some(
                  (c) =>
                    c.assistantEntryId === t.assistantEntryId &&
                    (c.resultEntryId === source.reference?.entryId || c.toolCallId === source.reference?.toolCallId),
                )
              }
            >
              <summary>
                Turn {t.ordinal} · {t.model ?? '模型未知'}
              </summary>
              <Metrics value={t.usage} />
              {t.assistantEntryId && (
                <button
                  type="button"
                  onClick={() => setReference({ sessionId: source.sessionId, entryId: t.assistantEntryId ?? '' })}
                >
                  查看原始消息
                </button>
              )}
              {calls(detail.calls.filter((c) => !!c.assistantEntryId && c.assistantEntryId === t.assistantEntryId))}
            </details>
          ))}
          {calls(
            detail.calls.filter(
              (c) => !c.assistantEntryId || !detail.turns.some((t) => t.assistantEntryId === c.assistantEntryId),
            ),
          )}
          {(detail.turns.length > limit || detail.calls.length > limit) && (
            <button type="button" onClick={() => setLimit(limit + 30)}>
              显示更多来源记录
            </button>
          )}
          <details>
            <summary>上下文与运行事件</summary>
            {detail.events.map((e) => (
              <article key={e.id}>
                <b>{e.kind}</b>
                <Metrics value={e.data} />
                {e.entryId && (
                  <button
                    type="button"
                    onClick={() => setReference({ sessionId: source.sessionId, entryId: e.entryId ?? '' })}
                  >
                    查看事件证据
                  </button>
                )}
              </article>
            ))}
          </details>
        </>
      )}
      {reference && (
        <EvidenceView
          key={`${reference.sessionId}:${reference.entryId}:${reference.toolCallId ?? ''}`}
          api={api}
          reference={reference}
          refresh={refresh}
        />
      )}
    </>
  );
}
