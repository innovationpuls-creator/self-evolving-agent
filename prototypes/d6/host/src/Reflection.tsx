import { useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ChevronRight, RefreshCw } from 'lucide-react';
import {
  useReflectionCatalog,
  reflectionStatusLabels as labels,
} from '../../../../apps/web/src/features/reflection/reflection-state';
import type { Session } from '../../../../apps/web/src/features/chat/session-state';
import type { ReflectionJob } from '../../../../apps/host/reflection/reflection-jobs';
import type { ReflectionRecord } from '../../../../apps/host/reflection/reflection-service';
import { Button, Notice } from './ui';
import { Markdown } from '../../src/components/content';
import { detailPath, useRead, type Api, type Detail } from './data';
import type { Route } from './navigation';

export const date = (time: number) =>
  new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(time);
export const projectName = (path?: string) => path?.split('/').filter(Boolean).at(-1) || '项目未返回';
export function Failure({ error, retry }: { error: string; retry: () => void }) {
  return (
    <Notice title="读取未完成" tone="warn">
      <p role="alert">{error}</p>
      <Button onClick={retry}>重新读取</Button>
    </Notice>
  );
}
export function Back({ back, children = '返回' }: { back: () => void; children?: React.ReactNode }) {
  return (
    <Button kind="ghost" className="aw-return" onClick={back}>
      <ArrowLeft size={15} />
      {children}
    </Button>
  );
}
export function Catalog({
  api,
  sessions,
  route,
  go,
  renderTitle,
}: {
  api: Api;
  sessions: Session[];
  route: Extract<Route, { page: 'reflections' }>;
  renderTitle?: (title: string, detail: boolean) => ReactNode;
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
        <h1 tabIndex={-1}>反思记录</h1>
        <Button onClick={refresh} disabled={loading}>
          <RefreshCw size={14} />
          刷新
        </Button>
      </header>
      <div className="aw-toolbar">
        <select
          aria-label="筛选来源会话"
          value={route.sessionId ?? ''}
          onChange={(e) => go({ page: 'reflections', sessionId: e.target.value || undefined, offset: 0 })}
        >
          <option value="">所有会话</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title || '未命名会话'} · {s.cwd}
            </option>
          ))}
        </select>
      </div>
      {error && <Failure error={error} retry={refresh} />}
      {loading && <p role="status">正在读取反思记录…</p>}
      {catalog && (
        <>
          {!catalog.availability.available && (
            <Notice
              title={catalog.availability.reason === 'not_checked' ? '反思环境尚未检查' : '反思环境不可用'}
              tone="warn"
            >
              <p>
                {catalog.availability.reason || '受限执行环境尚不可用。'} 已保存的记录仍可阅读。环境可用时，会恢复 Host
                内等待环境的检查任务。
              </p>
              <Button onClick={() => void recheck()} disabled={checking}>
                {checking ? '正在检查…' : '检查环境并恢复等待任务'}
              </Button>
            </Notice>
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
                      {renderTitle ? (
                        renderTitle(session?.title || '来源会话未返回', false)
                      ) : (
                        <h2>{session?.title || '来源会话未返回'}</h2>
                      )}
                      <span className="aw-muted" title={session?.cwd}>
                        {projectName(session?.cwd)}
                        {job.status !== 'succeeded' && ` · ${labels[job.status]}`}
                      </span>
                      {record?.summary && <p>{record.summary}</p>}
                      {job.error && <p className="live-error">{job.error}</p>}
                      {!record?.summary && !job.error && (
                        <p className="aw-muted">{record ? '未保存摘要' : '尚无已保存的检查结论'}</p>
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
              <h2>还没有反思记录</h2>
              <p>任务结束后的检查记录会保存在这里。</p>
            </div>
          )}
          {catalog.total > catalog.limit && (
            <nav className="live-pagination" aria-label="反思分页">
              <Button
                disabled={!route.offset || loading}
                onClick={() => go({ ...route, offset: Math.max(0, route.offset - catalog.limit) })}
              >
                上一页
              </Button>
              <span>
                {route.offset + 1}–{Math.min(route.offset + catalog.limit, catalog.total)} / {catalog.total}
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
  renderTitle,
}: {
  api: Api;
  sessions: Session[];
  route: Extract<Route, { page: 'reflection' }>;
  renderTitle?: (title: string, detail: boolean) => ReactNode;
  go: (route: Route) => void;
  back: () => void;
}) {
  const read = useRead<Detail>(api, detailPath(route.jobId, route.recordId), ['agent-reflection-changed']);
  const job = read.value?.job,
    record = read.value?.record;
  const session = sessions.find((s) => s.id === job?.sessionId);
  return (
    <>
      <Back back={back}>反思记录</Back>
      <header className="aw-review-heading">
        {renderTitle ? (
          renderTitle(session?.title || '反思记录', true)
        ) : (
          <h1 tabIndex={-1}>{session?.title || '反思记录'}</h1>
        )}
        {job && (
          <span className="aw-muted">
            {projectName(job.project)} · {date(job.created)} · {labels[job.status]}
          </span>
        )}
      </header>
      {read.loading && <p role="status">正在读取检查详情…</p>}
      {read.error && <Failure error={read.error} retry={read.refresh} />}
      {job && (
        <div className="aw-document-layout">
          <article className="aw-review-article">
            {(job.error || record?.error) && (
              <Notice title="检查未完成" tone="warn">
                <p>{job.error || record?.error}</p>
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
                  <p>未保存检查结论。</p>
                )}
                {!record.changes.length && (
                  <p className="aw-muted">本次检查未新增变化；来源任务中的操作请见下方「任务来源」。</p>
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
              <p>这项任务尚无已保存的检查结论。</p>
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
    <section>
      <h2>依据与来源</h2>
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
    </section>
  );
}
