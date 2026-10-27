import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BookOpen, ChevronRight } from 'lucide-react';
import { Button, Modal, Notice } from '../../src/components/ui';
import { Evidence } from '../../src/workspace/content';
import { WorkspacePage, Heading, Return } from '../../src/workspace/shared';
import { reflectionState } from '../../src/workspace/host-data';
import type { SessionRecord } from '../../../../apps/host/reflection/reflection-service';
import type { Catalog, CatalogJob, Detail, SourceEvidence, Transport } from './fixtures';

const day = (v: number) => new Date(v).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
const time = (v: number) =>
  new Date(v).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const project = (s?: SessionRecord) => s?.cwd.split('/').filter(Boolean).at(-1) || '项目未返回';
const message = (error: unknown) => (error instanceof Error ? error.message : '读取未完成，请重新读取');

function SourceReader({
  transport,
  sessionId,
  entryId,
  title,
  onClose,
}: {
  transport: Transport;
  sessionId: string;
  entryId: string;
  title: string;
  onClose: () => void;
}) {
  const [source, S] = useState<SourceEvidence>();
  const [error, E] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void transport
      .source(sessionId, entryId, controller.signal)
      .then(S)
      .catch((e) => {
        if (!controller.signal.aborted) E(message(e));
      });
    return () => controller.abort();
  }, [transport, sessionId, entryId]);
  let text = source && 'content' in source ? source.content : '';
  try {
    const parsed = JSON.parse(text || '{}');
    if (Array.isArray(parsed.message?.content))
      text = parsed.message.content.map((block: { text?: string }) => block.text || '').join('\n');
  } catch {
    /* A partial JSON response remains readable as returned. */
  }
  return (
    <Modal open onClose={onClose} title={title} drawer>
      {error ? (
        <Notice title="来源读取失败" tone="warn">
          {error}
        </Notice>
      ) : !source ? (
        <p role="status">正在读取来源…</p>
      ) : (
        <>
          <p className="aw-muted">
            {source.onSelectedBranch ? '当前选中分支' : '不在当前选中分支'} ·{' '}
            {source.source === 'checkpoint' ? '保存的检查点' : '上一检查点'}
          </p>
          {!source.available && (
            <Notice title="来源片段不可用" tone="warn">
              {'reason' in source && source.reason === 'entry_missing_from_checkpoint'
                ? '保存的检查点中未找到这条引用。'
                : '原始内容未保存，当前不能核实。'}
            </Notice>
          )}
          {source.available && <pre className="q-source-text">{text}</pre>}
          {source.truncated && (
            <Notice title="来源仅返回部分内容" tone="warn">
              当前片段不代表完整来源。
            </Notice>
          )}
          <details>
            <summary>查看完整来源条目</summary>
            <Evidence value={source} />
          </details>
        </>
      )}
    </Modal>
  );
}

function ReflectionDetail({
  selectedId,
  sessions,
  transport,
  onBack,
}: {
  selectedId: string;
  sessions: SessionRecord[];
  transport: Transport;
  onBack: () => void;
}) {
  const [detail, D] = useState<Detail>();
  const [error, E] = useState('');
  const [retry, R] = useState(0);
  const [sources, S] = useState(false);
  const [entry, ENTRY] = useState<{ sessionId: string; entryId: string }>();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    D(undefined);
    E('');
    void transport
      .detail(selectedId, controller.signal)
      .then(D)
      .catch((e) => {
        if (!controller.signal.aborted) E(message(e));
      });
    return () => controller.abort();
  }, [transport, selectedId, retry]);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [detail, error]);
  const job = detail?.job,
    record = detail?.record;
  const session = sessions.find((s) => s.id === job?.sessionId);
  return (
    <WorkspacePage page="reflection">
      <Return onClick={onBack}>所有反思记录</Return>
      <h1 ref={heading} tabIndex={-1}>
        {session?.title || '任务检查记录'}
      </h1>
      {error ? (
        <>
          <Notice title="检查记录读取失败" tone="warn">
            {error}。这不代表检查本身失败。
          </Notice>
          <Button onClick={() => R((n) => n + 1)}>重新读取详情</Button>
        </>
      ) : !detail || !job ? (
        <p role="status">正在读取检查记录…</p>
      ) : (
        <>
          <p className="q-detail-meta">
            {project(session)} · {day(job.updated)} {time(job.updated)}
          </p>
          <div className="aw-document-layout">
            <article className="aw-review-article">
              {job.status !== 'succeeded' && <h2>{reflectionState[job.status]}</h2>}
              {(job.error || record?.error) && (
                <Notice title="记录中的错误" tone="warn">
                  {job.error || record?.error}
                </Notice>
              )}
              {record?.summary ? (
                <p className="aw-review-lead">{record.summary}</p>
              ) : (
                <p className="aw-muted">{record ? '未保存检查结论。' : '暂时没有可查看的检查结论。'}</p>
              )}
              {!!record?.changes.length && (
                <section>
                  <h3>已保存的变更</h3>
                  <div className="aw-change-list">
                    {record.changes.map((change) => (
                      <div key={`${change.id}-${change.revision || change.knowledgeRevision}`}>
                        <p>
                          {change.kind === 'memory'
                            ? '记忆修订'
                            : change.kind === 'skill_knowledge'
                              ? '技能知识修订'
                              : '改进建议'}
                        </p>
                        {change.summary && <p>{change.summary}</p>}
                        <details>
                          <summary>查看变更引用</summary>
                          <Evidence value={change} />
                        </details>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {!!record?.uncertainties.length && (
                <section className="aw-review-unresolved">
                  <h3>仍待核实</h3>
                  <ul className="aw-finding-list">
                    {record.uncertainties.map((v, i) => (
                      <li key={`${i}-${v}`}>{v}</li>
                    ))}
                  </ul>
                </section>
              )}
              {!!record?.findings.length && (
                <section>
                  <h3>发现</h3>
                  <ul className="aw-finding-list">
                    {record.findings.map((v, i) => (
                      <li key={`${i}-${v}`}>{v}</li>
                    ))}
                  </ul>
                </section>
              )}
              {record && !record.evidence.length && (
                <Notice title="未返回证据引用">当前没有可打开的证据条目，请结合来源材料判断结论。</Notice>
              )}
            </article>
            <aside className="aw-context">
              <button type="button" className="aw-text-link" onClick={() => S(true)}>
                <BookOpen size={14} />
                查看证据与原始记录
              </button>
            </aside>
          </div>
          <Modal open={sources} onClose={() => S(false)} title={`检查依据：${session?.title || '任务检查记录'}`} drawer>
            {record?.evidence.length ? (
              record.evidence.map((ref, i) => (
                <div className="aw-reference" key={`${i}-${ref.entryId}`}>
                  <strong>{sessions.find((s) => s.id === ref.sessionId)?.title || '来源会话标题未返回'}</strong>
                  {ref.sessionId && ref.entryId ? (
                    <Button
                      kind="ghost"
                      onClick={() => {
                        if (ref.sessionId && ref.entryId) ENTRY({ sessionId: ref.sessionId, entryId: ref.entryId });
                      }}
                    >
                      查看来源片段
                    </Button>
                  ) : (
                    <Notice title="来源定位信息不足">引用没有返回可定位的会话与节点。</Notice>
                  )}
                  <details>
                    <summary>来源标识</summary>
                    <Evidence value={ref} />
                  </details>
                </div>
              ))
            ) : (
              <p>未返回可打开的证据引用。</p>
            )}
            <details>
              <summary>任务来源标记</summary>
              <Evidence value={job.sources} />
            </details>
            <details>
              <summary>检查原始记录</summary>
              <Evidence value={detail} />
            </details>
          </Modal>
          {entry && (
            <SourceReader
              {...entry}
              transport={transport}
              title={sessions.find((s) => s.id === entry.sessionId)?.title || '来源记录'}
              onClose={() => ENTRY(undefined)}
            />
          )}
        </>
      )}
    </WorkspacePage>
  );
}

export function Candidate({
  variant,
  sessions,
  transport,
}: {
  variant: 'journal' | 'grouped';
  sessions: SessionRecord[];
  transport: Transport;
}) {
  const [scope, SCOPE] = useState('all');
  const [data, DATA] = useState<Catalog>();
  const [offset, OFFSET] = useState(0);
  const [loading, L] = useState(true);
  const [error, E] = useState('');
  const [retry, RETRY] = useState(0);
  const [selected, SELECT] = useState<string>();
  const position = useRef<{ top: number; id?: string }>({ top: 0 });
  const wasDetail = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    L(true);
    E('');
    void transport
      .catalog({ sessionId: scope === 'all' ? undefined : scope, offset }, controller.signal)
      .then((next) => {
        DATA((old) =>
          offset && old
            ? { ...next, jobs: [...old.jobs, ...next.jobs], records: [...old.records, ...next.records] }
            : next,
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted) E(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) L(false);
      });
    return () => controller.abort();
  }, [transport, scope, offset, retry]);
  useLayoutEffect(() => {
    const scroll = document.querySelector<HTMLElement>('.workspace');
    if (!scroll) return;
    if (selected) {
      scroll.scrollTop = 0;
      wasDetail.current = true;
    } else if (wasDetail.current) {
      scroll.scrollTop = position.current.top;
      document.querySelector<HTMLButtonElement>(`[data-q-id="${position.current.id}"]`)?.focus({ preventScroll: true });
      wasDetail.current = false;
    }
  }, [selected]);
  if (selected)
    return (
      <ReflectionDetail
        selectedId={selected}
        sessions={sessions}
        transport={transport}
        onBack={() => SELECT(undefined)}
      />
    );
  const open = (job: CatalogJob) => {
    position.current = { top: document.querySelector('.workspace')?.scrollTop || 0, id: job.id };
    SELECT(job.id);
  };
  const rows = data?.jobs || [];
  const groups =
    variant === 'grouped'
      ? [
          { title: '未完成', jobs: rows.filter((j) => j.status !== 'succeeded') },
          { title: '已完成', jobs: rows.filter((j) => j.status === 'succeeded') },
        ]
      : [...new Set(rows.map((j) => day(j.created)))].map((title) => ({
          title,
          jobs: rows.filter((j) => day(j.created) === title),
        }));
  const row = (job: CatalogJob) => {
    const session = sessions.find((s) => s.id === job.sessionId);
    const summary = data?.records.find((r) => r.jobId === job.id)?.summary;
    const body = job.error || summary || (job.status === 'succeeded' ? '未保存检查结论' : '');
    return (
      <li key={job.id}>
        <button type="button" className="q-row" data-q-id={job.id} data-status={job.status} onClick={() => open(job)}>
          <span className="q-row-main">
            <span className="q-row-title">
              <h3>{session?.title || '任务检查记录'}</h3>
              {job.status !== 'succeeded' && (
                <span className={`q-state q-${job.status}`}>{reflectionState[job.status]}</span>
              )}
            </span>
            {body && <p className={job.error ? 'q-error-text' : ''}>{body}</p>}
            <span className="q-meta">
              <time dateTime={new Date(job.created).toISOString()}>
                {variant === 'grouped' ? `${day(job.created)} ` : ''}
                {time(job.created)}
              </time>
              <span>{project(session)}</span>
            </span>
          </span>
          <ChevronRight size={16} className="q-arrow" />
        </button>
      </li>
    );
  };
  return (
    <WorkspacePage page="reflection">
      <div className={`q-candidate q-${variant}`}>
        <Heading
          title="任务检查记录"
          action={
            <select
              aria-label="筛选来源会话"
              value={scope}
              onChange={(e) => {
                SCOPE(e.target.value);
                OFFSET(0);
                DATA(undefined);
              }}
            >
              <option value="all">所有会话</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} · {project(s)} · {day(s.updated)} {time(s.updated)}
                </option>
              ))}
            </select>
          }
        />
        {data && !data.availability.available && (
          <Notice title={'checkedAt' in data.availability ? '检查环境不可用' : '检查环境尚未检查'} tone="warn">
            {data.availability.reason}
          </Notice>
        )}
        {error && (
          <div role="alert">
            <Notice title="检查记录读取失败" tone="warn">
              {error}
            </Notice>
            <Button onClick={() => RETRY((n) => n + 1)}>重新读取列表</Button>
          </div>
        )}
        {loading && (
          <p role="status" className="q-loading">
            正在读取任务检查记录…
          </p>
        )}
        {!loading && !error && !rows.length && <p className="empty-search">还没有任务检查记录</p>}
        {!!rows.length && (
          <div className="q-groups">
            {groups.map((group) => (
              <section className="q-group" key={group.title}>
                <h2>{group.title}</h2>
                <ol>{group.jobs.map(row)}</ol>
                {!group.jobs.length && <p className="q-empty-group">暂无记录</p>}
              </section>
            ))}
          </div>
        )}
        {data && rows.length < data.total && !error && (
          <Button kind="ghost" disabled={loading} onClick={() => OFFSET(rows.length)}>
            显示更早的记录
          </Button>
        )}
      </div>
    </WorkspacePage>
  );
}
