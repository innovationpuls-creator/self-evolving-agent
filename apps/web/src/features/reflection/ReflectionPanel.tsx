import { readPosition, savePosition } from '../../app/view-state';
import { useEffect, useRef, useState } from 'react';
import type { EvolutionEvidence } from '../../../../host/evolution/evolution';
import type { ReflectionJob } from '../../../../host/reflection/reflection-jobs';
import type { ReflectionRecord } from '../../../../host/reflection/reflection-service';
import type { EvidenceTarget } from '../diagnostics/evidence';
import { reflectionStatusLabels, useReflectionCatalog, type ReflectionApi } from './reflection-state';
import './reflection.css';

const date = (value: number) => new Date(value).toLocaleString('zh-CN');
const pageSize = 20;
type Change = ReflectionRecord['changes'][number];
interface Detail {
  record: ReflectionRecord;
  job?: ReflectionJob;
}

function Evidence({
  value,
  onEvidence,
  onMemory,
  onSkill,
  onReflection,
}: {
  value: EvolutionEvidence;
  onEvidence?: (source: EvidenceTarget) => void;
  onMemory?: (id: string, revision?: number, project?: string) => void;
  onReflection?: (id: string) => void;
  onSkill?: (id: string, revision?: number, project?: string, knowledgeRevision?: string) => void;
}) {
  return (
    <li>
      {value.sessionId && (
        <p>
          会话 <code>{value.sessionId}</code>
        </p>
      )}
      {value.entryId && (
        <p>
          历史节点 <code>{value.entryId}</code>
        </p>
      )}
      {value.traceId && (
        <p>
          执行记录 <code>{value.traceId}</code>
        </p>
      )}
      {value.memoryId && (
        <p>
          记忆 <code>{value.memoryId}</code>
          {value.revision ? ` · 修订 #${value.revision}` : ''}
        </p>
      )}
      {value.skillId && (
        <p>
          能力 <code>{value.skillId}</code>
          {value.knowledgeRevision ? ` · 知识修订 ${value.knowledgeRevision}` : ''}
        </p>
      )}
      {value.reflectionId && (
        <p>
          历史反思{' '}
          <button
            type="button"
            onClick={() => {
              if (value.reflectionId) onReflection?.(value.reflectionId);
            }}
          >
            {value.reflectionId}
          </button>
        </p>
      )}
      <div className="reflection-inline-actions">
        {onEvidence && (value.sessionId || value.traceId) && (
          <button
            type="button"
            onClick={() => {
              if (value.sessionId)
                onEvidence({ sessionId: value.sessionId, entryId: value.entryId, traceId: value.traceId });
              else if (value.traceId) onEvidence({ traceId: value.traceId, entryId: value.entryId });
            }}
          >
            查看原始证据
          </button>
        )}
        {onMemory && value.memoryId && (
          <button
            type="button"
            onClick={() => {
              if (value.memoryId) onMemory(value.memoryId, value.revision);
            }}
          >
            查看记忆
          </button>
        )}
        {onSkill && value.skillId && (
          <button
            type="button"
            onClick={() => {
              if (value.skillId) onSkill(value.skillId, undefined, undefined, value.knowledgeRevision);
            }}
          >
            查看能力知识
          </button>
        )}
      </div>
    </li>
  );
}

function KnowledgeChange({
  change,
  onMemory,
  onSkill,
  onSuggestion,
}: {
  change: Change;
  onSuggestion?: (id: string) => void;
  onMemory?: (id: string, revision?: number, project?: string) => void;
  onSkill?: (id: string, revision?: number, project?: string, knowledgeRevision?: string) => void;
}) {
  const label = change.kind === 'memory' ? '记忆' : change.kind === 'skill_knowledge' ? '能力知识' : '进化建议';
  return (
    <li className="reflection-change">
      <div>
        <strong>{label}</strong>
        {change.revision ? <span> · 修订 #{change.revision}</span> : null}
      </div>
      {change.file && (
        <p>
          {change.file} · {change.knowledgeRevision}
        </p>
      )}
      {change.summary && <p>{change.summary}</p>}
      <code>{change.id}</code>
      {change.kind === 'suggestion' && onSuggestion && (
        <button type="button" onClick={() => onSuggestion(change.id)}>
          查看建议
        </button>
      )}
      {change.kind === 'memory' && onMemory && (
        <button type="button" onClick={() => onMemory(change.id, change.revision)}>
          查看记忆修订
        </button>
      )}
      {change.kind === 'skill_knowledge' && onSkill && (
        <button type="button" onClick={() => onSkill(change.id, change.revision, undefined, change.knowledgeRevision)}>
          查看能力知识
        </button>
      )}
    </li>
  );
}

export function ReflectionPanel({
  api,
  session,
  initialId,
  onSuggestion,
  onClose,
  onEvidence,
  onMemory,
  onSkill,
  onReflection,
}: {
  api: ReflectionApi;
  session?: { id: string; title: string };
  initialId?: string;
  onSuggestion?: (id: string) => void;
  onClose: () => void;
  onEvidence?: (source: EvidenceTarget) => void;
  onMemory?: (id: string, revision?: number, project?: string) => void;
  onReflection?: (id: string) => void;
  onSkill?: (id: string, revision?: number, project?: string, knowledgeRevision?: string) => void;
}) {
  const [scope, setScope] = useState<'session' | 'all'>(
    initialId || readPosition('reflection').scope === 'all' ? 'all' : session ? 'session' : 'all',
  );
  const sessionId = scope === 'session' ? session?.id : undefined;
  const [offset, setOffset] = useState(readPosition('reflection').offset ?? 0);
  const { catalog, loading, error, revision, refresh } = useReflectionCatalog(api, sessionId, offset);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialId ?? readPosition('reflection').id);
  const [detail, setDetail] = useState<Detail & { context: string }>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [busy, setBusy] = useState(false);
  const detailEpoch = useRef(0);
  const operationEpoch = useRef(0);
  const environmentController = useRef<AbortController | undefined>(undefined);
  const sourceController = useRef<AbortController | undefined>(undefined);
  const [sourceDetail, setSourceDetail] = useState<{ context: string; job: ReflectionJob }>();
  const context = `${scope}:${session?.id ?? ''}:${selectedId ?? ''}`;
  const owner = useRef(context);
  if (owner.current !== context) {
    owner.current = context;
    detailEpoch.current++;
    operationEpoch.current++;
    environmentController.current?.abort();
    sourceController.current?.abort();
  }
  const jobs = [...(catalog?.jobs ?? [])].sort((a, b) => b.created - a.created || b.id.localeCompare(a.id));
  const selectedJob = jobs.find((job) => job.id === selectedId);
  const recordId = selectedJob ? (selectedJob.reflectionSessionId ? selectedJob.id : undefined) : selectedId;

  useEffect(() => {
    setSelectedId(initialId ?? readPosition('reflection').id);
    setDetail(undefined);
    setOffset(readPosition('reflection').offset ?? 0);
    setBusy(false);
    setOperationError('');
  }, [scope, session?.id, initialId]);
  useEffect(() => {
    savePosition('reflection', { id: selectedId, offset, scope });
  }, [selectedId, offset, scope]);

  useEffect(() => {
    const generation = ++detailEpoch.current;
    const controller = new AbortController();
    setDetail((current) => (current?.context === context ? current : undefined));
    setDetailError('');
    setDetailLoading(Boolean(recordId));
    if (recordId) {
      void api<Detail>(`/reflections/${recordId}`, 'GET', undefined, controller.signal)
        .then((value) => {
          if (sessionId && value.record.sessionId !== sessionId) throw new Error('该反思不在当前会话范围内');
          if (generation === detailEpoch.current) setDetail({ ...value, context });
        })
        .catch((reason: unknown) => {
          if (generation === detailEpoch.current)
            setDetailError(reason instanceof Error ? reason.message : '反思详情读取失败');
        })
        .finally(() => {
          if (generation === detailEpoch.current) setDetailLoading(false);
        });
    }
    return () => {
      detailEpoch.current++;
      controller.abort();
    };
  }, [api, recordId, context, revision, sessionId]);

  useEffect(
    () => () => {
      operationEpoch.current++;
      environmentController.current?.abort();
      sourceController.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (catalog && offset && offset >= catalog.total && !loading)
      setOffset(Math.max(0, Math.floor((catalog.total - 1) / pageSize) * pageSize));
  }, [offset, catalog, loading]);

  const recheck = async () => {
    const generation = ++operationEpoch.current;
    environmentController.current?.abort();
    const controller = new AbortController();
    environmentController.current = controller;
    setBusy(true);
    setOperationError('');
    try {
      await api('/reflections/recheck', 'POST', {}, controller.signal);
      if (generation === operationEpoch.current) refresh();
    } catch (reason) {
      if (generation === operationEpoch.current)
        setOperationError(reason instanceof Error ? reason.message : '环境检查未完成');
    } finally {
      if (generation === operationEpoch.current) setBusy(false);
    }
  };
  const currentDetail = detail?.context === context ? detail : undefined;
  const currentJob = currentDetail?.job ?? selectedJob;
  const record = currentDetail?.record;
  const sources =
    currentDetail?.job?.sources ?? (sourceDetail?.context === context ? sourceDetail.job.sources : undefined);
  const loadSources = async () => {
    if (!currentJob || sources) return;
    sourceController.current?.abort();
    const controller = new AbortController();
    sourceController.current = controller;
    const generation = detailEpoch.current;
    try {
      const value = await api<{ job: ReflectionJob }>(
        `/reflections/jobs/${currentJob.id}`,
        'GET',
        undefined,
        controller.signal,
      );
      if (!controller.signal.aborted && generation === detailEpoch.current)
        setSourceDetail({ context, job: value.job });
    } catch (reason) {
      if (!controller.signal.aborted && generation === detailEpoch.current)
        setDetailError(reason instanceof Error ? reason.message : '触发来源读取失败');
    }
  };
  return (
    <section className="reflection-panel">
      <header>
        <div>
          <h1>反思记录</h1>
          <p>{scope === 'session' && session ? session.title : '跨会话历史与知识变化'}</p>
        </div>
        <div className="actions">
          <button type="button" onClick={refresh} disabled={loading}>
            刷新
          </button>
          <button type="button" onClick={onClose}>
            返回对话
          </button>
        </div>
      </header>
      {(error || operationError) && (
        <div className="notice error" role="alert">
          {error || operationError}
        </div>
      )}
      <div className="reflection-toolbar">
        <label>
          查看范围{' '}
          <select
            aria-label="反思范围"
            value={scope}
            onChange={(event) => setScope(event.target.value === 'session' ? 'session' : 'all')}
          >
            {session && <option value="session">当前会话</option>}
            <option value="all">全部会话</option>
          </select>
        </label>
        <span>{catalog?.total ?? 0} 项反思</span>
      </div>
      {catalog && !catalog.availability.available && (
        <div className="reflection-availability" role="status">
          <div>
            <strong>后台反思暂不可用</strong>
            <p>{catalog.availability.reason || '请检查反思运行环境后重试。'}</p>
          </div>
          <button type="button" disabled={busy} onClick={() => void recheck()}>
            {busy ? '检查中…' : '重新检查环境'}
          </button>
        </div>
      )}
      <div className="reflection-layout" data-detail={!!selectedId}>
        <section className="reflection-list" aria-label="反思列表">
          {!jobs.length && (
            <p className="reflection-empty">
              {loading ? '正在读取反思记录…' : '还没有反思记录。任务结束后的反思会显示在这里。'}
            </p>
          )}
          {jobs.map((job) => {
            const item = catalog?.records.find((candidate) => candidate.jobId === job.id);
            return (
              <button
                type="button"
                key={job.id}
                className={`reflection-item ${job.id === selectedId ? 'selected' : ''}`}
                aria-pressed={job.id === selectedId}
                onClick={() => {
                  setSelectedId(job.id);
                  setBusy(false);
                }}
              >
                <span className="reflection-item-meta">
                  <span data-reflection-status={job.status}>{reflectionStatusLabels[job.status]}</span>
                  <time dateTime={new Date(job.created).toISOString()}>{date(job.created)}</time>
                </span>
                <strong>
                  {item?.summary ||
                    (job.status === 'pending'
                      ? '等待任务后的反思'
                      : job.status === 'running'
                        ? '正在审查历史与认识'
                        : '任务反思')}
                </strong>
                <small>
                  {job.sourceCount} 段执行记录{scope === 'all' ? ` · 会话 ${job.sessionId.slice(0, 8)}` : ''}
                </small>
              </button>
            );
          })}
          {(catalog?.total ?? 0) > pageSize && (
            <div className="reflection-pagination">
              <button
                type="button"
                disabled={!offset || loading}
                onClick={() => setOffset((value) => Math.max(0, value - pageSize))}
              >
                上一页
              </button>
              <small>
                {Math.floor(offset / pageSize) + 1} / {Math.ceil((catalog?.total ?? 0) / pageSize)}
              </small>
              <button
                type="button"
                disabled={loading || offset + pageSize >= (catalog?.total ?? 0)}
                onClick={() => setOffset((value) => value + pageSize)}
              >
                下一页
              </button>
            </div>
          )}
        </section>
        <div className="reflection-detail" aria-busy={detailLoading}>
          {selectedId && (
            <button type="button" className="back-to-list" onClick={() => setSelectedId(undefined)}>
              ← 反思列表
            </button>
          )}
          {selectedId && !selectedJob && !currentDetail && !loading && !detailLoading && (
            <p className="notice" role="status">
              指定反思不在当前范围内，或来源已不可用。可切换到全部会话查看。
            </p>
          )}
          {!currentJob && <p className="reflection-empty">选择一项反思，查看判断、依据与知识变化。</p>}
          {detailError && (
            <p className="reflection-error" role="alert">
              {detailError}
            </p>
          )}
          {currentJob && (
            <>
              <div className="reflection-detail-meta">
                <span data-reflection-status={currentJob.status}>{reflectionStatusLabels[currentJob.status]}</span> ·{' '}
                {date(currentJob.updated)}
              </div>
              <h2>{record?.summary || (currentJob.status === 'running' ? '正在审查历史与认识' : '任务反思')}</h2>
              {currentJob.status === 'pending' && (
                <p className="reflection-muted">计划在 {date(currentJob.scheduledAt)} 后执行；正常对话优先。</p>
              )}
              {currentJob.status === 'running' && !record && (
                <p className="reflection-muted">正在分析历史记录，完成后可查看判断和知识变化。</p>
              )}
              {(record?.error || currentJob.error) && (
                <p className="reflection-error">{record?.error || currentJob.error}</p>
              )}
              {currentJob.status === 'interrupted' && (
                <p className="reflection-muted">这次反思未完整结束。已经保存的知识变化保留，系统不会自动重复执行。</p>
              )}
              {currentJob.status === 'waiting_user' && (
                <button type="button" disabled={busy} onClick={() => void recheck()}>
                  {busy ? '检查中…' : '重新检查环境'}
                </button>
              )}
              {detailLoading && !record && <p className="reflection-muted">正在读取反思详情…</p>}
              {record && (
                <>
                  <section className="reflection-content">
                    <h3>形成的判断</h3>
                    {record.findings.length ? (
                      <ul>
                        {record.findings.map((finding, index) => (
                          <li key={`${index}:${finding}`}>{finding}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="reflection-muted">本次没有新增发现。</p>
                    )}
                  </section>
                  <section className="reflection-content">
                    <h3>尚不确定</h3>
                    {record.uncertainties.length ? (
                      <ul>
                        {record.uncertainties.map((uncertainty, index) => (
                          <li key={`${index}:${uncertainty}`}>{uncertainty}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="reflection-muted">没有另外记录不确定事项。</p>
                    )}
                  </section>
                  <section className="reflection-content">
                    <h3>关联知识变化</h3>
                    {record.changes.length ? (
                      <ul className="reflection-changes">
                        {record.changes.map((change, index) => (
                          <KnowledgeChange
                            key={`${change.kind}:${change.id}:${change.revision ?? index}`}
                            change={change}
                            onSuggestion={onSuggestion}
                            onMemory={(id, revision) => onMemory?.(id, revision, detail?.record.project)}
                            onSkill={(id, revision, _project, knowledgeRevision) =>
                              onSkill?.(id, revision, detail?.record.project, knowledgeRevision)
                            }
                          />
                        ))}
                      </ul>
                    ) : (
                      <p className="reflection-muted">本次没有知识变更或新建议。</p>
                    )}
                  </section>
                  <details className="reflection-evidence">
                    <summary>判断依据与历史引用 · {record.evidence.length} 项</summary>
                    {record.evidence.length ? (
                      <ul>
                        {record.evidence.map((value, index) => (
                          <Evidence
                            key={`${index}:${JSON.stringify(value)}`}
                            value={value}
                            onEvidence={onEvidence}
                            onReflection={onReflection}
                            onMemory={(id, revision) => onMemory?.(id, revision, detail?.record.project)}
                            onSkill={(id, revision, _project, knowledgeRevision) =>
                              onSkill?.(id, revision, detail?.record.project, knowledgeRevision)
                            }
                          />
                        ))}
                      </ul>
                    ) : (
                      <p>没有额外的历史引用。</p>
                    )}
                  </details>
                </>
              )}
              <details
                className="reflection-evidence"
                onToggle={(event) => {
                  if (event.currentTarget.open) void loadSources();
                  else sourceController.current?.abort();
                }}
              >
                <summary>
                  触发来源 · {sources?.length ?? ('sourceCount' in currentJob ? currentJob.sourceCount : 0)} 段执行记录
                </summary>
                <p>
                  来源会话 <code>{currentJob.sessionId}</code>
                </p>
                <ul>
                  {!sources && <li>展开后按需读取来源记录。</li>}
                  {sources?.map((source) => (
                    <li key={source.markerEntryId}>
                      <p>
                        {date(source.settledAt)} ·{' '}
                        {source.status === 'ended' ? '执行结束' : source.status === 'stopped' ? '已停止' : '执行失败'}
                      </p>
                      {source.traceId && (
                        <p>
                          执行记录 <code>{source.traceId}</code>
                        </p>
                      )}
                      <p>
                        历史节点 <code>{source.markerEntryId}</code>
                      </p>
                      {onEvidence && (
                        <button
                          type="button"
                          onClick={() => onEvidence({ sessionId: currentJob.sessionId, entryId: source.markerEntryId })}
                        >
                          查看来源记录
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
