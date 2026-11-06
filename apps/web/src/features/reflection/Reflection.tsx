import { useState, useEffect, useRef } from 'react';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { useReflectionCatalog, reflectionStatusLabels as labels } from './reflection-state';
import type { Session } from '../chat/session-state';
import type { ReflectionJob } from '../../../../host/reflection/reflection-jobs';
import type { ReflectionRecord } from '../../../../host/reflection/reflection-service';
import { Button, Notice } from '../../components/ui';
import { Markdown } from '../../components/content';
import type { Api } from '../../app/types';
import { useReflectionDetail } from './reflection-data';
import { TaskTitle } from '../../components/Title';
import type { Route } from '../../app/navigation';

export const date = (time: number) =>
  new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(time);
import { Back, Failure, projectName } from '../../components/reading';
export function Catalog({
  api,
  sessions,
  route,
  go,
}: {
  api: Api;
  sessions: Session[];
  route: Extract<Route, { page: 'reflections' }>;
  go: (route: Route) => void;
}) {
  const { catalog, loading, error, refresh } = useReflectionCatalog(api, route.sessionId, route.offset);
  const [checking, setChecking] = useState(false),
    [checkError, setCheckError] = useState('');
  const recheck = async () => {
    setChecking(true);
    setCheckError('');
    try {
      await api('/reflections/recheck', 'POST', {});
      refresh();
    } catch (reason) {
      setCheckError(reason instanceof Error ? reason.message : '环境检查失败');
    } finally {
      setChecking(false);
    }
  };
  return (
    <>
      {route.sessionId && <Back back={() => go({ page: 'session', sessionId: route.sessionId })}>返回会话</Back>}
      <header className="aw-heading">
        <h1 tabIndex={-1}>自动复盘</h1>
      </header>
      <div className="aw-toolbar">
        <select
          aria-label="筛选来源会话"
          value={route.sessionId ?? ''}
          onChange={(e) => go({ page: 'reflections', sessionId: e.target.value || undefined, offset: 0 })}
        >
          <option value="">所有会话</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id} title={s.cwd}>
              {s.title || '未命名会话'} · {projectName(s.cwd)}
            </option>
          ))}
        </select>
      </div>
      {error && <Failure error={error} retry={refresh} />}
      {loading && <p role="status">正在读取自动复盘…</p>}
      {catalog && !error && (
        <>
          {!catalog.availability.available && (
            <Notice title={'checkedAt' in catalog.availability ? '自动复盘暂不可用' : '尚未检查自动复盘环境'}>
              <Button onClick={() => void recheck()} disabled={checking}>
                {checking ? '正在检查…' : '重新检查'}
              </Button>
            </Notice>
          )}
          {catalog.availability.available && catalog.jobs.some((job) => job.status === 'waiting_user') && (
            <Button onClick={() => void recheck()} disabled={checking}>
              {checking ? '正在检查…' : '重新检查'}
            </Button>
          )}
          {checkError && <p role="alert">{checkError}</p>}
          <div className="aw-journal">
            {catalog.jobs.map((job) => {
              const record = catalog.records.find((r) => r.jobId === job.id),
                session = sessions.find((s) => s.id === job.sessionId);
              return (
                <section className="aw-journal-entry" key={job.id}>
                  <div className="aw-journal-date">{date(job.created)}</div>
                  <button
                    type="button"
                    className="aw-journal-row live-record"
                    data-focus={job.id}
                    data-job={job.id}
                    data-status={job.status}
                    onClick={() =>
                      go({
                        page: 'reflection',
                        jobId: job.id,
                        recordId: record?.id,
                        originSession: route.sessionId ?? job.sessionId,
                      })
                    }
                  >
                    <span>
                      {record?.summary && <p className="host-check-summary">{record.summary}</p>}
                      <TaskTitle title={session?.title || '来源会话未返回'} />
                      <span className="aw-muted" title={session?.cwd}>
                        {projectName(session?.cwd)}
                      </span>
                      {job.status !== 'succeeded' && (
                        <span className={job.status === 'failed' ? 'live-error' : 'aw-muted'}>
                          {labels[job.status]}
                        </span>
                      )}
                    </span>
                    <ChevronRight size={17} />
                  </button>
                </section>
              );
            })}
          </div>
          {!catalog.jobs.length && (
            <div className="aw-empty">
              <h2>{catalog.total ? '这一页已没有记录' : '还没有自动复盘'}</h2>
              {!!catalog.total && <Button onClick={() => go({ ...route, offset: 0 })}>返回第一页</Button>}
            </div>
          )}
          {catalog.total > catalog.limit && (
            <nav className="live-pagination" aria-label="自动复盘分页">
              <Button
                disabled={!route.offset || loading}
                onClick={() => go({ ...route, offset: Math.max(0, route.offset - catalog.limit) })}
              >
                上一页
              </Button>
              <span>
                {catalog.jobs.length
                  ? `${route.offset + 1}–${Math.min(route.offset + catalog.limit, catalog.total)}`
                  : '0'}{' '}
                / {catalog.total}
              </span>
              <Button
                disabled={route.offset + catalog.limit >= catalog.total || loading}
                onClick={() => go({ ...route, offset: route.offset + catalog.limit })}
              >
                下一页
              </Button>
            </nav>
          )}
        </>
      )}
    </>
  );
}
export function ReflectionDetail({
  api,
  sessions,
  route,
  go,
  back,
}: {
  api: Api;
  sessions: Session[];
  route: Extract<Route, { page: 'reflection' }>;
  go: (route: Route) => void;
  back: () => void;
}) {
  const read = useReflectionDetail(api, route.jobId);
  const [checking, setChecking] = useState(false),
    [checkError, setCheckError] = useState('');
  const recheck = async () => {
    setChecking(true);
    setCheckError('');
    try {
      await api('/reflections/recheck', 'POST', {});
      read.refresh();
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : '环境检查失败');
    } finally {
      setChecking(false);
    }
  };
  const job = read.value?.job,
    record = read.value?.record;
  const session = sessions.find((s) => s.id === job?.sessionId);
  const focused = useRef('');
  useEffect(() => {
    if (job && focused.current !== job.id) {
      focused.current = job.id;
      if (document.activeElement === document.body)
        document.querySelector<HTMLElement>('.host-reading h1')?.focus({ preventScroll: true });
    }
  }, [job]);
  return (
    <>
      <Back back={back}>自动复盘</Back>
      <header className="aw-heading host-reflection-heading">
        <div className="aw-review-heading">
          <h1 tabIndex={-1}>{job ? `${date(job.created)} 的检查` : '检查记录'}</h1>
          {job && (
            <span className="aw-muted">
              {projectName(job.project)} · {labels[job.status]}
            </span>
          )}
        </div>
      </header>
      {session && (
        <details className="host-reflection-task">
          <summary>来源任务</summary>
          <p>{session.title || '未命名会话'}</p>
        </details>
      )}
      {read.loading && <p role="status">正在读取检查详情…</p>}
      {read.error && <Failure error={read.error} retry={read.refresh} />}
      {checkError && <p role="alert">{checkError}</p>}
      {job?.status === 'waiting_user' && (
        <Button disabled={checking} onClick={() => void recheck()}>
          {checking ? '正在检查…' : '重新检查'}
        </Button>
      )}
      {job && (
        <div className="aw-document-layout">
          <article className="aw-review-article">
            {(job.error || record?.error) && (
              <Notice title="检查未完成" tone="warn">
                <details className="host-reflection-error">
                  <summary>详细信息</summary>
                  <p>{job.error || record?.error}</p>
                </details>
                {!!record?.changes.length && <p>下列变化已保存；检查中断或失败不会撤销这些成果。</p>}
              </Notice>
            )}
            {record ? (
              <>
                {record.summary ? (
                  <div className="aw-review-lead">
                    <Markdown text={record.summary} />
                  </div>
                ) : (
                  <p>{job.status === 'running' ? '正在检查，尚未保存结论。' : '未保存检查结论。'}</p>
                )}
                {!!record.changes.length && (
                  <section>
                    <h2>已保存的变化</h2>
                    <div className="aw-change-list">
                      {record.changes.map((change, i) => (
                        <button
                          type="button"
                          className="aw-related"
                          key={`${change.id}-${i}`}
                          data-focus={`change-${i}`}
                          onClick={() =>
                            go({
                              page: 'result',
                              originSession: route.originSession,
                              target:
                                change.kind === 'memory'
                                  ? { kind: 'memory', id: change.id, revision: change.revision, project: job.project }
                                  : change.kind === 'suggestion'
                                    ? { kind: 'suggestion', id: change.id }
                                    : {
                                        kind: 'skill',
                                        id: change.id,
                                        knowledgeRevision: change.knowledgeRevision,
                                        file: change.file,
                                        version: change.version,
                                      },
                            })
                          }
                        >
                          <span>
                            <strong>
                              {change.summary ||
                                (change.kind === 'memory'
                                  ? '记忆修订'
                                  : change.kind === 'suggestion'
                                    ? '改进建议'
                                    : '技能知识修订')}
                            </strong>
                            <small>
                              {change.kind === 'memory'
                                ? `记忆${change.revision ? ` · 修订 ${change.revision}` : ''}`
                                : change.kind === 'suggestion'
                                  ? '改进建议'
                                  : '技能知识'}
                            </small>
                          </span>
                          <ArrowRight size={16} />
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {!!record.uncertainties.length && (
                  <section className="aw-review-unresolved">
                    <h2>仍待核实</h2>
                    <ul className="aw-finding-list">
                      {record.uncertainties.map((text, i) => (
                        <li key={`${i}-${text}`}>{text}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {!!record.findings.length && (
                  <section>
                    <h2>发现</h2>
                    <ul className="aw-finding-list">
                      {record.findings.map((text, i) => (
                        <li key={`${i}-${text}`}>{text}</li>
                      ))}
                    </ul>
                  </section>
                )}
                <References record={record} job={job} go={go} originSession={route.originSession} />
              </>
            ) : (
              job.status !== 'waiting_user' && (
                <p>
                  {
                    {
                      pending: '等待后台检查。',
                      running: '正在检查，尚未保存结论。',
                      succeeded: '检查已结束，尚无可读取的结论。',
                      failed: '尚无已保存的检查结论。',
                      interrupted: '尚无已保存的检查结论。',
                    }[job.status]
                  }
                </p>
              )
            )}
          </article>
          <aside className="aw-context">
            <Button
              data-focus="origin-session"
              onClick={() => go({ page: 'session', sessionId: route.originSession || job.sessionId })}
            >
              返回原会话
              <ArrowRight size={14} />
            </Button>
            {job.sessionId !== route.originSession && route.originSession && (
              <Button onClick={() => go({ page: 'session', sessionId: job.sessionId })}>打开检查所属会话</Button>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
function References({
  record,
  job,
  go,
  originSession,
}: {
  record: ReflectionRecord;
  job: ReflectionJob;
  go: (route: Route) => void;
  originSession?: string;
}) {
  return (
    <details className="host-reflection-references">
      <summary>依据与来源</summary>
      {!record.evidence.length && <p>未返回独立证据引用，可查看任务结束时保存的来源标记。</p>}
      {record.evidence.map((reference, i) => (
        <Button
          className="live-source-link"
          data-focus={`evidence-${i}`}
          key={`evidence-${i}`}
          onClick={() => go({ page: 'source', reference, project: job.project, originSession })}
        >
          证据 {i + 1}
          <ChevronRight size={14} />
        </Button>
      ))}
      {job.sources.map((source, i) => (
        <Button
          className="live-source-link"
          data-focus={`source-${i}`}
          key={source.markerEntryId}
          onClick={() =>
            go({
              page: 'source',
              reference: source.traceId
                ? { traceId: source.traceId }
                : { sessionId: job.sessionId, entryId: source.markerEntryId },
              project: job.project,
              originSession,
            })
          }
        >
          任务来源 {i + 1} · {{ ended: '已结束', stopped: '已停止', failed: '执行失败' }[source.status]}
          <ChevronRight size={14} />
        </Button>
      ))}
    </details>
  );
}
