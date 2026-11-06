import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, ArrowRight, Clock3, FolderOpen } from 'lucide-react';
import type { MemoryService } from '../../../../host/memory/memory';
import type { MemoryDetail, Route, Host } from '../../app/types';
import { useRead, resultPath } from '../../app/types';
import { Button, SearchBox, Notice, Field } from '../../components/ui';
import { Diff } from '../../components/structured-content';
import { Markdown } from '../../components/content';
import type { MemoryDrafts } from './memory-management';
import { projectName, date, Failure } from '../../components/reading';
const kinds = { fact: '事实', experience: '经验', decision: '决定', hypothesis: '怀疑' };
export function MemoryCatalog({
  host,
  store,
  route,
  go,
  replace,
}: {
  host: Host;
  store: MemoryDrafts;
  route: Extract<Route, { page: 'memory' }>;
  go: (route: Route) => void;
  replace: (route: Route) => void;
}) {
  useSyncExternalStore(store.subscribe, store.version);
  const pending = store.all().filter((d) => d.project === (route.project || ''));
  const query = route.query || '',
    history = !!route.history;
  const params = new URLSearchParams({
    limit: '30',
    offset: String(route.offset || 0),
    includeHistory: String(history),
    query,
  });
  if (route.project) params.set('project', route.project);
  else params.set('scope', 'global');
  if (route.project && route.scope) params.set('scope', route.scope);
  const read = useRead<ReturnType<MemoryService['search']>>(host.api, `/memory?${params}`, ['agent-memory-changed']);
  const projects = [...new Set([...host.sessions.map((s) => s.cwd), ...(route.project ? [route.project] : [])])];
  // One control over the existing route fields (project, scope). Without a project the request is always
  // scope=global, so scope is ignored there; with a project every scope value has its own option.
  const range = (project?: string, scope?: 'global' | 'project') =>
    JSON.stringify(project ? [project, scope ?? ''] : ['', '']);
  const groups = (['project', 'global'] as const).filter((scope) => read.value?.items.some((m) => m.scope === scope));
  return (
    <>
      <header className="aw-heading">
        <h1 tabIndex={-1}>已保存的记忆</h1>
        <Button
          kind="primary"
          data-focus="memory-create"
          onClick={() => go({ page: 'memory-edit', project: route.project, action: 'create' })}
        >
          新建记忆
        </Button>
      </header>
      <div className="aw-scope-bar">
        <FolderOpen size={19} />
        <select
          aria-label="浏览范围"
          title={route.project || '所有项目通用'}
          value={range(route.project, route.scope)}
          onChange={(e) => {
            const [project, scope] = JSON.parse(e.target.value) as [string, '' | 'global' | 'project'];
            const next = { ...route, project: project || undefined, scope: scope || undefined, offset: 0 };
            if (next.project === route.project) replace(next);
            else go(next);
          }}
        >
          <option value={range()}>所有项目通用</option>
          {projects.map((p) => [
            <option value={range(p)} key={p} title={p}>
              {projectName(p)}
            </option>,
            <option value={range(p, 'project')} key={`${p}:project`} title={p}>
              {projectName(p)} · 仅此项目
            </option>,
            <option value={range(p, 'global')} key={`${p}:global`} title={p}>
              {projectName(p)} · 仅通用
            </option>,
          ])}
        </select>
      </div>
      {pending.length > 0 && (
        <div className="host-memory-drafts">
          {pending.map((d) => (
            <Button
              key={d.key}
              onClick={() => go({ page: 'memory-edit', project: d.project || undefined, id: d.id, action: d.action })}
            >
              {d.phase === 'saved' ? '查看保存结果' : '继续草稿'} · {d.knowledge.title || '未命名记忆'}
              {d.phase === 'uncertain' ? ' · 结果尚未确认' : ''}
            </Button>
          ))}
        </div>
      )}
      <div className="aw-toolbar aw-memory-toolbar">
        <Button
          kind="ghost"
          aria-pressed={history}
          onClick={() => {
            replace({ ...route, history: !history, offset: 0 });
          }}
        >
          <Clock3 size={14} />
          历史查询
        </Button>
        <SearchBox
          value={query}
          onChange={(v) => {
            replace({ ...route, query: v, offset: 0 });
          }}
          placeholder="搜索记忆内容"
        />
      </div>
      {read.loading && <p role="status">正在读取记忆…</p>}
      {read.error && <Failure error={read.error} retry={read.refresh} />}
      {read.value && (
        <div className="aw-memory-collection">
          {groups.map((scope) => (
            <section key={scope}>
              {groups.length > 1 && (
                <h2 className="aw-group-title" title={scope === 'project' ? route.project : undefined}>
                  {scope === 'project' ? projectName(route.project) : '所有项目通用'}
                </h2>
              )}
              {read.value?.items
                .filter((m) => m.scope === scope)
                .map((m) => (
                  <button
                    type="button"
                    className="aw-memory-row"
                    aria-label={`${m.title}${history ? ` · 修订 ${m.revision}` : ''}${!m.isCurrent ? ' · 历史' : m.status === 'withdrawn' ? ' · 已停用' : m.status === 'deleted' ? ' · 已删除' : m.unavailable ? ' · 来源不可用' : ''}`}
                    key={`${m.id}:${m.revision}`}
                    data-focus={`${m.id}:${m.revision}`}
                    onClick={() =>
                      go({
                        page: 'result',
                        target: {
                          kind: 'memory',
                          id: m.id,
                          project: route.project || '',
                          revision: history ? m.revision : undefined,
                        },
                      })
                    }
                  >
                    <span className="aw-memory-type">{kinds[m.kind]}</span>
                    <span>
                      <strong title={m.title}>{m.title}</strong>
                      <p>{m.content}</p>
                      <small>
                        {date(m.created)}
                        {history ? ` · 修订 ${m.revision}` : ''}
                        {!m.isCurrent
                          ? ' · 历史修订'
                          : !m.usable
                            ? ` · ${m.status === 'withdrawn' ? '已停用' : m.status === 'deleted' ? '已删除' : '来源不可用'}`
                            : ''}
                      </small>
                    </span>
                    <ArrowRight size={16} />
                  </button>
                ))}
            </section>
          ))}
          {!read.value.items.length &&
            (query || history || route.scope || read.value.total ? (
              <p className="empty-search">此范围内没有符合条件的记忆</p>
            ) : (
              <p className="aw-empty">还没有记忆</p>
            ))}
          {!!read.value.unavailable && <p>有 {read.value.unavailable} 项记忆的来源暂不可用，可通过历史查询阅读。</p>}
          {read.value.total > 30 && (
            <nav className="host-pagination" aria-label="记忆分页">
              <Button
                disabled={!route.offset}
                onClick={() => go({ ...route, offset: Math.max(0, (route.offset || 0) - 30) })}
              >
                上一页
              </Button>
              <span>
                {(route.offset || 0) + 1}–{Math.min((route.offset || 0) + 30, read.value.total)} / {read.value.total}
              </span>
              <Button
                disabled={(route.offset || 0) + 30 >= read.value.total}
                onClick={() => go({ ...route, offset: (route.offset || 0) + 30 })}
              >
                下一页
              </Button>
            </nav>
          )}
        </div>
      )}
    </>
  );
}
export function MemoryReader({
  host,
  route,
  go,
  back,
  showBack,
}: {
  host: Host;
  route: Extract<Route, { page: 'result' }>;
  go: (route: Route) => void;
  back: () => void;
  /** False when the shell header already offers the same back control. */
  showBack: boolean;
}) {
  const target = route.target,
    read = useRead<MemoryDetail>(host.api, resultPath(target), ['agent-memory-changed']);
  const [history, H] = useState(target.kind === 'memory' && target.revision !== undefined);
  const heading = useRef<HTMLHeadingElement>(null),
    announced = useRef('');
  const selectionKey = target.kind === 'memory' ? JSON.stringify(target) : '';
  useEffect(() => {
    if (!read.value || !heading.current || announced.current === selectionKey) return;
    announced.current = selectionKey;
    if (document.activeElement === document.body) heading.current.focus({ preventScroll: true });
  }, [read.value, selectionKey]);
  if (target.kind !== 'memory') return null;
  const value = read.value,
    m = value?.current,
    rev = target.revision ? value?.history.find((r) => r.revision === target.revision) : m;
  const previous = rev && value?.history.find((r) => r.revision === rev.previousRevision);
  const refs = rev
    ? [...rev.sources, ...rev.basis].filter(
        (v, i, all) => all.findIndex((a) => a.sessionId === v.sessionId && a.entryId === v.entryId) === i,
      )
    : [];
  // A user-authored source-less revision needs no source panel; Agent/system revisions keep the
  // "no visible source" line because it bears on trust.
  const showSources = !!rev && (refs.length > 0 || rev.actor !== 'user' || !!route.originSession);
  return (
    <>
      {showBack && (
        <Button kind="ghost" className="aw-return" onClick={back}>
          <ArrowLeft size={15} />
          返回上一页
        </Button>
      )}
      {read.loading && <p role="status">正在读取记忆…</p>}
      {read.error && <Failure error={read.error} retry={read.refresh} />}
      {value && !rev && (
        <Notice title="引用的修订未返回" tone="warn">
          当前内容不能替代历史修订。
        </Notice>
      )}
      {rev && (
        <>
          <header className="aw-document-heading">
            <div>
              <h1 ref={heading} tabIndex={-1}>
                {rev.title}
              </h1>
              <span className="aw-muted" title={rev.scope === 'project' ? target.project : undefined}>
                {rev.scope === 'project' ? projectName(target.project) : '所有项目通用'} · {kinds[rev.kind]} ·{' '}
                {m && m.revision !== rev.revision ? `修订 ${rev.revision} · ` : ''}
                {date(rev.created)}
              </span>
            </div>
            <div className="aw-document-controls">
              {m?.revision === rev.revision && m.status !== 'deleted' && (
                <Button
                  data-focus="memory-edit"
                  disabled={host.connection !== 'ready' || m.unavailable}
                  onClick={() =>
                    go({
                      page: 'memory-edit',
                      id: m.id,
                      project: target.project,
                      action: 'revise',
                      originSession: route.originSession,
                    })
                  }
                >
                  编辑记忆
                </Button>
              )}
              {(value?.history.length ?? 0) > 1 && (
                <Button kind="ghost" aria-pressed={history} onClick={() => H((v) => !v)}>
                  <Clock3 size={14} />
                  修订历史
                </Button>
              )}
            </div>
          </header>
          <div className="aw-document-layout">
            <article className="aw-note">
              {m && m.revision !== rev.revision && (
                <Notice title="历史修订">
                  当前已是修订 {m.revision}
                  {m.status === 'withdrawn' ? '（已停用）' : m.status === 'deleted' ? '（已删除）' : ''}
                  ，此处保留引用时的内容，Agent 不会参考。
                  <Button kind="ghost" onClick={() => go({ ...route, target: { ...target, revision: undefined } })}>
                    查看当前认识
                  </Button>
                </Notice>
              )}
              {history && (
                <Field label="查看修订">
                  <select
                    value={rev.revision}
                    onChange={(e) => go({ ...route, target: { ...target, revision: Number(e.target.value) } })}
                  >
                    {value?.history.map((r) => (
                      <option value={r.revision} key={r.revision}>
                        修订 {r.revision} · {date(r.created)}
                        {r.isCurrent ? ' · 最新' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {history && previous ? (
                <section>
                  <h2>实际变化</h2>
                  <Diff
                    file={`记忆正文 · 修订 ${previous.revision} → ${rev.revision}`}
                    before={previous.content}
                    after={rev.content}
                  />
                </section>
              ) : (
                <Markdown text={rev.content} />
              )}
              {m?.revision === rev.revision && (
                <section className="host-memory-state" aria-label="使用状态">
                  {!m.usable && (
                    <p>
                      {m.status === 'withdrawn'
                        ? '已停用，Agent 不会参考'
                        : m.status === 'deleted'
                          ? '已删除，Agent 不会参考'
                          : '来源暂不可确认，Agent 不会参考'}
                    </p>
                  )}
                  {m.status !== 'deleted' && (
                    <div className="host-memory-actions">
                      {/* Offered where Host revise({confirm}) has an effect for a user: it restores a withdrawn
                          memory, records a user check of an Agent/system revision, and resets the basis of a
                          project decision (a plain edit keeps it). Otherwise it would add an identical revision. */}
                      {(m.status === 'withdrawn' ||
                        m.actor !== 'user' ||
                        (m.kind === 'decision' && m.scope === 'project' && m.basis.length > 0)) && (
                        <Button
                          disabled={host.connection !== 'ready' || m.unavailable}
                          onClick={() =>
                            go({
                              page: 'memory-edit',
                              id: m.id,
                              project: target.project,
                              action: 'confirm',
                              originSession: route.originSession,
                            })
                          }
                        >
                          确认仍然有效
                        </Button>
                      )}
                      {m.status === 'current' && (
                        <Button
                          disabled={host.connection !== 'ready' || m.unavailable}
                          onClick={() =>
                            go({
                              page: 'memory-edit',
                              id: m.id,
                              project: target.project,
                              action: 'retire',
                              originSession: route.originSession,
                            })
                          }
                        >
                          停用
                        </Button>
                      )}
                      <Button
                        kind="ghost"
                        disabled={host.connection !== 'ready'}
                        onClick={() =>
                          go({
                            page: 'memory-edit',
                            id: m.id,
                            project: target.project,
                            action: 'delete',
                            originSession: route.originSession,
                          })
                        }
                      >
                        删除
                      </Button>
                    </div>
                  )}
                </section>
              )}
              <section className="host-revision-reason">
                <h2>{rev.operation === 'create' ? '保存原因' : '修改原因'}</h2>
                <p>{rev.reason}</p>
                {rev.actor !== 'user' && (
                  <small>
                    {rev.actor === 'agent' ? 'Agent 操作' : '系统变更'} ·{' '}
                    {
                      {
                        create: '创建',
                        revise: '修订',
                        confirm: '确认仍然有效',
                        retire: '停用',
                        delete: '删除',
                        scope: '调整适用范围',
                        branch: '来源回档',
                      }[rev.operation]
                    }
                  </small>
                )}
              </section>
            </article>
            {showSources && (
              <aside className="aw-context">
                <h2>来源</h2>
                {refs.map((r, i) => (
                  <Button
                    key={`${r.sessionId}:${r.entryId}`}
                    data-focus={`memory-source-${i}`}
                    onClick={() =>
                      go({
                        page: 'source',
                        reference: { sessionId: r.sessionId, entryId: r.entryId },
                        project: target.project,
                        originSession: route.originSession,
                      })
                    }
                  >
                    记忆来源 {i + 1}
                    <ArrowRight size={14} />
                  </Button>
                ))}
                {!refs.length && rev.actor !== 'user' && <p>此修订没有当前范围内可见的来源引用。</p>}
                {route.originSession && (
                  <Button
                    data-focus="origin-session"
                    onClick={() => go({ page: 'session', sessionId: route.originSession })}
                  >
                    返回原会话
                  </Button>
                )}
              </aside>
            )}
          </div>
        </>
      )}
    </>
  );
}
