import { FilterBar } from './controls';
import { measureWorkspace } from './quality-probe';
import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, SearchCheck } from 'lucide-react';
import { Button, Modal, Notice, StateGate } from '../components/ui';
import { Evidence } from './content';
import { useDemo } from '../state/store';
import { WorkspacePage, Heading, Return, Related, RowArrow, workspaceStateMessages } from './shared';
import { useWorkspacePosition, useWorkspaceData, formatDate, reflectionState, reflectionHeadline } from './host-data';
import { loadedDemoSessions } from './host-fixtures';
import { projectName } from './Context';
import { References } from './References';

function ReflectionPage() {
  const x = useDemo(),
    w = useWorkspaceData();
  const [limit, LIMIT] = useState(24);
  const [open, O] = useState(false),
    [filter, F] = useState('全部'),
    [source, S] = useState(false),
    [sessionFilter, SF] = useState('all'),
    [recovery, R] = useState(false);
  useEffect(() => LIMIT(24), [filter, sessionFilter]);
  useEffect(() => {
    if (x.focusRequest.type === 'reflection') O(true);
  }, [x.focusRequest]);
  const detail = w.data.reflections.find((r) => r.job.id === w.resolve('reflection', x.objects.reflection));
  const title = (id: string) => w.data.sessions.find((s) => s.id === id)?.title || '任务检查记录';
  const list = w.data.reflections
    .filter(
      (r) =>
        (sessionFilter === 'all' || r.job.sessionId === sessionFilter) &&
        (filter === '全部' ||
          (filter === '待核实'
            ? !!r.record?.uncertainties.length
            : ['pending', 'running', 'failed', 'interrupted', 'waiting_user'].includes(r.job.status))),
    )
    .sort((a, b) => b.job.updated - a.job.updated || b.job.created - a.job.created);
  useWorkspacePosition('reflection', open ? `detail:${detail?.job.id}` : `list:${filter}:${sessionFilter}`);
  const record = detail?.record,
    job = detail?.job;
  const headline = detail && reflectionHeadline(detail);
  const loadedSession = job && loadedDemoSessions[job.sessionId];
  return (
    <StateGate
      messages={workspaceStateMessages.reflection}
      emptyAction={<Button onClick={() => x.go('chat')}>返回会话</Button>}
    >
      <WorkspacePage page="reflection">
        {!open ? (
          <>
            <Heading title="任务检查记录" />
            <div className="aw-toolbar">
              <FilterBar items={['全部', '待核实', '未完成']} value={filter} onChange={F} label="任务检查结果" />
              <select aria-label="筛选来源会话" value={sessionFilter} onChange={(e) => SF(e.target.value)}>
                <option value="all">所有会话</option>
                {w.data.sessions
                  .filter((s) => w.data.reflections.some((r) => r.job.sessionId === s.id))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} · {projectName(s.cwd)}
                    </option>
                  ))}
              </select>
            </div>
            <div className="aw-journal">
              {list.slice(0, limit).map((r) => (
                <section key={r.job.id} className="aw-journal-entry">
                  <div className="aw-journal-date">
                    <time dateTime={new Date(r.job.updated).toISOString()}>{formatDate(r.job.updated)}</time>
                    <span>{projectName(r.job.project)}</span>
                  </div>
                  <button
                    type="button"
                    className="aw-journal-row"
                    data-aw-key={r.job.id}
                    onClick={() => {
                      x.setObject('reflection', r.job.id);
                      O(true);
                    }}
                  >
                    <span className={`aw-journal-symbol ${r.job.status === 'succeeded' ? 'finding' : 'unavailable'}`}>
                      <SearchCheck size={21} />
                    </span>
                    <span>
                      <span className="aw-journal-state">
                        {reflectionState[r.job.status]}
                        {r.record?.uncertainties.length ? ` · ${r.record.uncertainties.length} 项待核实` : ''}
                      </span>
                      <h2>{title(r.job.sessionId)}</h2>
                      {(r.record?.summary || r.job.error || r.record?.error || r.job.status === 'succeeded') && (
                        <p>
                          {r.job.status === 'succeeded'
                            ? r.record?.summary || '未保存检查结论'
                            : r.job.error || r.record?.error || reflectionState[r.job.status]}
                        </p>
                      )}
                      {!!r.record?.changes.length && (
                        <span className="aw-journal-output">已保存 {r.record.changes.length} 项变更</span>
                      )}
                    </span>
                    <RowArrow />
                  </button>
                </section>
              ))}
            </div>
            {list.length > limit && (
              <Button kind="ghost" onClick={() => LIMIT(limit + 24)}>
                显示更早的记录（剩余 {list.length - limit}）
              </Button>
            )}
            {!list.length && <p className="empty-search">没有符合当前筛选条件的检查记录</p>}
          </>
        ) : job && detail ? (
          <>
            <Return onClick={() => O(false)}>所有反思记录</Return>
            <div className="aw-review-heading">
              <h1>{title(job.sessionId)}</h1>
              <span className="aw-muted">
                {projectName(job.project)} · {formatDate(job.updated)}
                {job.status === 'succeeded' && ` · ${reflectionState[job.status]}`}
              </span>
            </div>
            <div className="aw-document-layout">
              <article className="aw-review-article">
                {headline !== '已保存的检查结论' && <h2 className="aw-check-conclusion">{headline}</h2>}
                {(job.error || record?.error) && (
                  <Notice title="记录中的错误" tone="warn">
                    {job.error || record?.error}
                  </Notice>
                )}
                {record?.summary && record.summary !== headline && <p className="aw-review-lead">{record.summary}</p>}
                {!record && <p className="aw-muted">暂时没有可查看的检查结论。</p>}
                {!!record?.changes.length && (
                  <section>
                    <h3>已保存的变更</h3>
                    <div className="aw-change-list">
                      {record.changes.map((c, i) => {
                        const memory = w.data.memories.find((m) => m.current.id === c.id);
                        const revision = memory?.history.find((r) => r.revision === c.revision);
                        const suggestion = w.data.suggestions.find((s) => s.id === c.id);
                        return (
                          <div key={`${c.id}-${i}`}>
                            {c.kind === 'memory' ? (
                              <References
                                identifiers={false}
                                project={job.project}
                                items={[{ memoryId: c.id, revision: c.revision }]}
                              />
                            ) : c.kind === 'suggestion' && suggestion ? (
                              <Related
                                title={suggestion.title}
                                meta="改进建议"
                                page="evolution"
                                object={{ type: 'evolution', id: suggestion.id }}
                              />
                            ) : (
                              <>
                                <p>{c.kind === 'skill_knowledge' ? '技能知识修订' : '建议记录未载入'}</p>
                                <Evidence value={c} />
                              </>
                            )}
                            {c.summary && c.summary !== revision?.title && c.summary !== suggestion?.title && (
                              <p className="aw-muted">{c.summary}</p>
                            )}
                          </div>
                        );
                      })}
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
                {['waiting_user', 'failed', 'interrupted'].includes(job.status) && (
                  <Button onClick={() => R(true)}>查看重新检查的条件</Button>
                )}
              </article>
              <aside className="aw-context">
                {loadedSession && (
                  <Button
                    kind="ghost"
                    onClick={() => {
                      x.setSid(loadedSession);
                      x.go('chat');
                    }}
                  >
                    打开来源会话
                    <ArrowRight size={14} />
                  </Button>
                )}
                <button className="aw-text-link" type="button" onClick={() => S(true)}>
                  <BookOpen size={14} />
                  查看证据与原始记录
                </button>
                {loadedSession && (
                  <Button
                    kind="ghost"
                    onClick={() => {
                      x.setSid(loadedSession);
                      x.mutate((s) => ({
                        ...s,
                        sessions: s.sessions.map((v) =>
                          v.id === loadedSession
                            ? { ...v, draft: '请根据这次检查保留的来源重新审查结论，明确还缺少哪些依据。' }
                            : v,
                        ),
                      }));
                      x.go('chat');
                    }}
                  >
                    起草重新审查请求
                    <ArrowRight size={14} />
                  </Button>
                )}
              </aside>
            </div>
          </>
        ) : (
          <>
            <Return onClick={() => O(false)}>所有反思记录</Return>
            <Heading title="检查记录未载入" />
          </>
        )}
        <Modal
          open={source}
          onClose={() => S(false)}
          title={`检查依据：${job ? title(job.sessionId) : '记录未载入'}`}
          drawer
        >
          <References project={job?.project} onNavigate={() => S(false)} items={record?.evidence ?? []} />
          {job && (
            <details>
              <summary>任务来源标记</summary>
              <Evidence value={job.sources} />
            </details>
          )}
          <details>
            <summary>检查原始记录</summary>
            <Evidence value={{ job, record }} />
          </details>
        </Modal>
        <Modal open={recovery} onClose={() => R(false)} title="重新检查的条件">
          <Notice title={job ? reflectionState[job.status] : '状态未返回'} tone="warn">
            {job?.error || record?.error || '需要重新读取状态并确认受限执行环境可用。'}
          </Notice>
          <p>环境检查与任务重试分开处理。此处只查看条件，不启动本机服务，也不重放原任务。</p>
          <div className="modal-footer">
            <Button onClick={() => R(false)}>关闭</Button>
          </div>
        </Modal>
      </WorkspacePage>
    </StateGate>
  );
}

export const WorkspaceReflection = measureWorkspace('reflection', ReflectionPage);
