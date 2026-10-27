import { FilterBar } from './controls';
import { measureWorkspace } from './quality-probe';
import { useEffect, useState } from 'react';
import { Plus, Pencil, Clock3, BookOpen, MoreHorizontal } from 'lucide-react';
import { Button, SearchBox, Modal, Field, Notice, Menu, StateGate } from '../components/ui';
import { Diff, Evidence } from './content';
import { useDemo } from '../state/store';
import { WorkspacePage, Heading, Return, RowArrow, workspaceStateMessages } from './shared';
import {
  useWorkspacePosition,
  useWorkspaceData,
  formatDate,
  actorName,
  memoryKind,
  memoryState,
  type MemoryView,
} from './host-data';
import { fixtureProjects } from './host-fixtures';
import { MemoryScope, projectName } from './Context';
import type { MemoryCommand } from './memory-model';
import { References } from './References';

function MemoryPage() {
  const x = useDemo(),
    w = useWorkspaceData();
  const [open, O] = useState(false),
    [query, Q] = useState(''),
    [filter, F] = useState('可使用'),
    [category, K] = useState('all'),
    [kind, KIND] = useState<MemoryView['kind']>('fact'),
    [error, ERROR] = useState(''),
    [editKey, EDITKEY] = useState<string>(),
    [editId, EDITID] = useState(''),
    [manageBase, MB] = useState(0);
  const [discard, DISCARD] = useState<'list' | 'detail'>();
  const [original, ORIGINAL] = useState('');
  const [limit, LIMIT] = useState(30);
  useEffect(() => LIMIT(30), [query, filter, category, w.project]);
  const [editing, E] = useState(false),
    [adding, A] = useState(false);
  const [text, V] = useState(''),
    [title, T] = useState(''),
    [reason, R] = useState('');
  const [scope, S] = useState<'project' | 'global'>('project'),
    [base, B] = useState(0),
    [conflict, C] = useState(false);
  const [history, H] = useState(false),
    [revision, I] = useState<number>();
  const [source, SO] = useState(false),
    [manage, M] = useState<'scope' | 'delete' | 'retire' | null>(null);
  const detail = w.memories.find(
    (m) => m.current.id === (editing && !adding ? editId : w.resolve('memory', x.objects.memory)),
  );
  const m = detail?.current;
  const rev = history ? detail?.history.find((r) => r.revision === revision) : m;
  useWorkspacePosition(
    'memory',
    open ? `detail:${editing}:${history}:${revision}:${m?.id}` : `list:${w.project}:${filter}:${category}:${query}`,
  );
  useEffect(() => {
    if (!editing && w.memoryRequest?.project !== w.project) {
      O(false);
      H(false);
      SO(false);
      M(null);
      ERROR('');
    }
  }, [w.project]);
  const dirty = editing && (JSON.stringify([title, text, kind, scope]) !== original || !!reason.trim());
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty]);
  const previous = rev && detail?.history.find((r) => r.revision === rev.previousRevision);
  useEffect(() => {
    if (x.focusRequest.type === 'memory') {
      if (editing) return;
      O(true);
      H(false);
      E(false);
      A(false);
    }
  }, [x.focusRequest]);
  useEffect(() => {
    if (!w.memoryRequest || editing) return;
    if (w.memoryRequest.project) w.chooseProject(w.memoryRequest.project);
    I(w.memoryRequest.revision);
    H(w.memoryRequest.revision !== undefined);
    O(true);
    E(false);
  }, [w.memoryRequest]);
  const leaveEdit = (toList: boolean) => {
    E(false);
    if (toList || adding) O(false);
    A(false);
    H(false);
    DISCARD(undefined);
  };
  const cancelEdit = (toList: boolean) => {
    if (dirty) DISCARD(toList ? 'list' : 'detail');
    else leaveEdit(toList);
  };
  const back = () => {
    if (editing) cancelEdit(true);
    else {
      O(false);
      H(false);
    }
  };
  const edit = () => {
    if (!m) return;
    E(true);
    ERROR('');
    EDITKEY(w.projectKey);
    EDITID(m.id);
    w.chooseProject(w.project ?? 'global');
    ORIGINAL(JSON.stringify([m.title, m.content, m.kind, m.scope]));
    KIND(m.kind);
    A(false);
    T(m.title);
    V(m.content);
    R('');
    S(m.scope);
    B(m.revision);
    C(x.memoryConflict);
    x.setMemoryConflict(false);
  };
  const add = () => {
    A(true);
    ORIGINAL(JSON.stringify(['', '', 'fact', w.projectKey ? 'project' : 'global']));
    ERROR('');
    KIND('fact');
    EDITKEY(w.projectKey);
    w.chooseProject(w.project ?? 'global');
    E(true);
    O(true);
    H(false);
    T('');
    V('');
    R('');
    S(w.projectKey ? 'project' : 'global');
    C(false);
  };
  const perform = (input: MemoryCommand) => {
    if (!x.d.connection) {
      ERROR('连接已断开，操作尚未提交。已有内容和编辑均保留。');
      return false;
    }
    if (!m) return false;
    try {
      w.editMemory(m.id, input);
      ERROR('');
      return true;
    } catch (e) {
      ERROR(e instanceof Error ? e.message : '操作未完成。');
      return false;
    }
  };
  const save = () => {
    if (!x.d.connection) {
      ERROR('连接已断开，修改尚未保存。草稿已保留，恢复连接后可再次保存。');
      return;
    }
    if (editKey !== w.projectKey) {
      ERROR('浏览项目已改变。草稿已保留，请返回原项目后保存。');
      return;
    }
    if (!adding && m && (base !== m.revision || conflict)) {
      C(true);
      return;
    }
    if (adding) {
      const value: MemoryView = {
        id: crypto.randomUUID(),
        revision: 1,
        previousRevision: null,
        title: title.trim(),
        content: text.trim(),
        kind,
        scope,
        project: scope === 'project' ? (w.projectKey ?? null) : null,
        status: 'current',
        operation: 'create',
        reason: reason.trim(),
        actor: 'user',
        created: Date.now(),
        sources: [],
        basis: [],
        isCurrent: true,
        usable: true,
        unavailable: false,
      };
      w.saveMemory(value);
      x.setObject('memory', value.id);
    } else if (
      !perform({
        baseRevision: base,
        knowledge: { title, content: text, kind, scope },
        reason,
        ...(m?.status === 'withdrawn' ? { confirm: true } : {}),
      })
    )
      return;
    if (!adding && m) x.setObject('memory', m.id);
    E(false);
    A(false);
    H(false);
    x.notify('记忆已保存，原修订仍然保留。');
  };
  const list = w.memories
    .flatMap((d) => (filter === '全部修订' ? d.history : [d.current]))
    .filter(
      (r) =>
        (filter === '全部修订' ||
          (filter === '已撤销'
            ? r.status === 'withdrawn'
            : filter === '暂不可用'
              ? r.status === 'current' && !r.usable
              : r.usable)) &&
        (category === 'all' || r.kind === category) &&
        `${r.title} ${r.content}`.toLowerCase().includes(query.trim().toLowerCase()),
    );
  const startManage = (value: 'scope' | 'delete' | 'retire') => {
    if (!m) return;
    S(m.scope);
    MB(m.revision);
    R('');
    ERROR('');
    M(value);
  };
  const scopeOptions = (
    <>
      <option value="project" disabled={!w.projectKey}>
        仅 {projectName(w.project)} 项目
      </option>
      <option value="global">全局 · 跨项目</option>
    </>
  );
  const kindOptions = Object.entries(memoryKind).map(([key, name]) => (
    <option key={key} value={key}>
      {name}
    </option>
  ));
  return (
    <StateGate
      messages={workspaceStateMessages.memory}
      emptyAction={
        <Button
          onClick={() => {
            x.setScenario('normal');
            add();
          }}
        >
          添加记忆
        </Button>
      }
    >
      <WorkspacePage page="memory">
        <Modal
          open={!!discard}
          onClose={() => DISCARD(undefined)}
          title="放弃未保存的修改？"
          className="aw-confirm-dialog"
          footer={
            <>
              <Button onClick={() => DISCARD(undefined)}>继续编辑</Button>
              <Button kind="danger" onClick={() => leaveEdit(discard === 'list')}>
                放弃修改
              </Button>
            </>
          }
        >
          <p>当前编辑不会保存。已保存的记忆与修订历史保持原样。</p>
        </Modal>
        {error && (
          <div role="alert">
            <Notice title="操作未完成" tone="warn">
              {error}
            </Notice>
          </div>
        )}
        {editing && editKey !== w.projectKey && (
          <Notice title="编辑草稿仍在原项目">
            <Button onClick={() => w.chooseProject(w.projects.find((p) => fixtureProjects[p] === editKey) ?? 'global')}>
              恢复编辑范围
            </Button>
          </Notice>
        )}
        {!open ? (
          <>
            <Heading
              title="已保存的记忆"
              action={
                <Button onClick={add}>
                  <Plus size={16} />
                  添加记忆
                </Button>
              }
            />
            <MemoryScope
              disabled={editing || !!manage}
              onChange={() => {
                O(false);
                H(false);
                ERROR('');
              }}
            />
            <div className="aw-toolbar aw-memory-toolbar">
              <div className="aw-memory-states">
                <FilterBar items={['可使用', '暂不可用', '已撤销']} value={filter} onChange={F} label="记忆状态" />
                <Button
                  kind="ghost"
                  aria-pressed={filter === '全部修订'}
                  onClick={() => F(filter === '全部修订' ? '可使用' : '全部修订')}
                >
                  <Clock3 size={14} />
                  历史查询
                </Button>
              </div>
              <div className="aw-memory-search">
                <SearchBox value={query} onChange={Q} placeholder="搜索记忆内容" />
                <select aria-label="筛选记忆类别" value={category} onChange={(e) => K(e.target.value)}>
                  <option value="all">所有类别</option>
                  {kindOptions}
                </select>
              </div>
            </div>
            <div className="aw-memory-collection">
              {(['project', 'global'] as const).map((group) => {
                const all = list.filter((m) => m.scope === group);
                const items = all.slice(0, limit);
                return (
                  items.length > 0 && (
                    <section key={group}>
                      <h2 className="aw-group-title">
                        {group === 'project' ? `${projectName(w.project)} 项目` : '全局记忆'}
                        <span>{all.length}</span>
                      </h2>
                      {items.map((m) => (
                        <button
                          key={`${m.id}:${m.revision}`}
                          data-aw-key={`${m.id}:${m.revision}`}
                          type="button"
                          className={`aw-memory-row ${m.kind === 'hypothesis' ? 'is-question' : ''}`}
                          onClick={() => {
                            w.requestMemory({
                              id: m.id,
                              revision: filter === '全部修订' ? m.revision : undefined,
                              project: w.project,
                            });
                            x.setObject('memory', m.id);
                            I(m.revision);
                            H(filter === '全部修订');
                            O(true);
                          }}
                        >
                          <span className="aw-memory-type">{memoryKind[m.kind]}</span>
                          <span>
                            <strong>{m.title}</strong>
                            <p>{m.content}</p>
                            <small>
                              {formatDate(m.created)} · {actorName[m.actor]} · 修订 {m.revision}
                              {filter === '全部修订'
                                ? ` · ${m.isCurrent ? '最新' : '历史'} · ${memoryState(m)}`
                                : !m.usable
                                  ? ` · ${memoryState(m)}`
                                  : ''}
                            </small>
                          </span>
                          <RowArrow />
                        </button>
                      ))}
                      {all.length > limit && (
                        <Button kind="ghost" onClick={() => LIMIT(limit + 30)}>
                          显示更多记忆（剩余 {all.length - limit}）
                        </Button>
                      )}
                    </section>
                  )
                );
              })}
              {!list.length && (
                <div className="empty-search">
                  <strong>
                    {query ? '没有匹配的记忆' : filter === '已撤销' ? '没有已撤销的记忆' : '此范围内没有符合条件的记忆'}
                  </strong>
                  {query && (
                    <Button kind="ghost" onClick={() => Q('')}>
                      清除搜索
                    </Button>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <Return onClick={back}>所有记忆</Return>
            {editing ? (
              <div className="aw-editor-page">
                <Heading
                  title={adding ? '添加记忆' : '编辑记忆'}
                  action={
                    <span className="aw-editor-context">
                      {scope === 'global' ? '全局记忆' : `${projectName(w.project)} 项目`}
                    </span>
                  }
                />
                <Field label="记忆标题">
                  <input
                    value={title}
                    onChange={(e) => T(e.target.value)}
                    maxLength={240}
                    placeholder="概括这条事实、偏好或经验"
                  />
                </Field>
                <Field label="记忆内容">
                  <textarea
                    className="aw-note-editor"
                    value={text}
                    onChange={(e) => V(e.target.value)}
                    maxLength={32000}
                  />
                </Field>
                <Field label="记忆类别">
                  <select value={kind} onChange={(e) => KIND(e.target.value as MemoryView['kind'])}>
                    {kindOptions}
                  </select>
                </Field>
                {adding ? (
                  <Field label="适用范围">
                    <select value={scope} onChange={(e) => S(e.target.value as 'project' | 'global')}>
                      {scopeOptions}
                    </select>
                  </Field>
                ) : (
                  <Field label="修改依据" hint={`以修订 ${base} 为基础，保存为新修订。`}>
                    <input
                      value={reason}
                      onChange={(e) => R(e.target.value)}
                      maxLength={4000}
                      placeholder="说明新增依据或需要修正的地方"
                    />
                  </Field>
                )}
                {adding && (
                  <Field label="记录依据">
                    <input
                      value={reason}
                      onChange={(e) => R(e.target.value)}
                      maxLength={4000}
                      placeholder="为什么保存这条记忆"
                    />
                  </Field>
                )}
                {m?.status === 'withdrawn' && !adding && (
                  <Notice title="保存后将重新确认这条记忆">本次内容和依据会成为新修订，撤销历史保留。</Notice>
                )}
                {conflict && (
                  <Notice title="修订冲突：草稿尚未保存" tone="warn">
                    请核对最新内容后继续编辑。
                    <Diff before={m?.content ?? ''} after={text} file="最新修订 → 我的草稿" />
                    <Button
                      onClick={() => {
                        B(m?.revision ?? 0);
                        C(false);
                      }}
                    >
                      已核对，继续编辑
                    </Button>
                  </Notice>
                )}
                <div className="aw-save-bar">
                  <Button onClick={() => cancelEdit(false)}>取消</Button>
                  <Button
                    kind="primary"
                    disabled={
                      !text.trim() ||
                      !title.trim() ||
                      !reason.trim() ||
                      editKey !== w.projectKey ||
                      conflict ||
                      (!adding && m?.unavailable)
                    }
                    onClick={save}
                  >
                    {adding ? '保存记忆' : m?.status === 'withdrawn' ? '保存并重新确认' : '保存新修订'}
                  </Button>
                </div>
              </div>
            ) : m && rev ? (
              <>
                <div className="aw-document-heading">
                  <div>
                    <h1>{rev.title}</h1>
                    <span className="aw-muted">
                      {rev.scope === 'project' ? `${projectName(w.project)} 项目` : '全局 · 跨项目'} ·{' '}
                      {memoryKind[rev.kind]} · {formatDate(rev.created)}
                      {!rev.usable && ` · ${memoryState(rev)}`}
                    </span>
                    {history && rev.title !== m.title && <p className="aw-muted">最新修订标题：{m.title}</p>}
                  </div>
                  <div className="aw-document-controls">
                    <div className="aw-memory-history-actions">
                      {history && <Button onClick={() => H(false)}>最新修订</Button>}
                      <Button
                        kind="ghost"
                        aria-pressed={history}
                        onClick={() => {
                          I(m.revision);
                          H(true);
                        }}
                      >
                        <Clock3 size={14} />
                        修订历史 · {detail?.history.length}
                      </Button>
                    </div>
                    {!history && m.status !== 'deleted' && (
                      <Button disabled={m.unavailable} onClick={edit}>
                        <Pencil size={14} />
                        {m.status === 'withdrawn' ? '重新确认记忆' : '编辑记忆'}
                      </Button>
                    )}
                    {!history && m.status !== 'deleted' && (
                      <Menu
                        label="管理这条记忆"
                        items={[
                          ...(!m.unavailable
                            ? [
                                {
                                  label: '调整适用范围',
                                  onSelect: () => {
                                    startManage('scope');
                                  },
                                },
                              ]
                            : []),
                          ...(m.status === 'current' && !m.unavailable
                            ? [{ label: '撤销记忆', onSelect: () => startManage('retire') }]
                            : []),
                          { label: '移除记忆', danger: true, onSelect: () => startManage('delete') },
                        ]}
                      >
                        <MoreHorizontal size={19} />
                      </Menu>
                    )}{' '}
                  </div>
                </div>
                <div className="aw-document-layout">
                  <article className="aw-note">
                    {!history && m.status === 'withdrawn' && (
                      <Notice title="这条记忆已撤销" tone="warn">
                        {m.operation === 'retire'
                          ? m.reason
                          : '这条认识不用于当前检索；重新确认需要提交当前内容与新依据。'}
                      </Notice>
                    )}
                    {!history && m.unavailable && (
                      <Notice title="适用依据尚未恢复，当前不可使用" tone="warn">
                        来源恢复前不能编辑或扩大适用范围。
                      </Notice>
                    )}
                    {history && (
                      <Field label="查看修订">
                        <select value={revision} onChange={(e) => I(Number(e.target.value))}>
                          {detail?.history.map((r) => (
                            <option key={r.revision} value={r.revision}>
                              修订 {r.revision} · {formatDate(r.created)}
                              {r.revision === m.revision ? ' · 最新' : ''}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                    {history && previous ? (
                      <>
                        <Diff
                          before={previous.content}
                          after={rev.content}
                          file={`修订 ${previous.revision} → ${rev.revision}`}
                        />
                        {previous.title !== rev.title && (
                          <dl className="aw-source-facts">
                            <dt>原标题</dt>
                            <dd>{previous.title}</dd>
                            <dt>新标题</dt>
                            <dd>{rev.title}</dd>
                          </dl>
                        )}
                      </>
                    ) : (
                      <p className="aw-note-body">{rev.content}</p>
                    )}
                    {history && rev.previousRevision && !previous && (
                      <p className="aw-muted">上一修订未返回，当前仅显示所选修订内容。</p>
                    )}
                  </article>
                  <aside className="aw-context">
                    <h2 className="aw-context-title">{rev.operation === 'create' ? '记录依据' : '修改依据'}</h2>
                    <p>{rev.reason}</p>
                    <button type="button" className="aw-text-link" onClick={() => SO(true)}>
                      <BookOpen size={14} />
                      查看修订来源
                    </button>
                    <details className="aw-memory-properties">
                      <summary>
                        修订 {rev.revision}
                        {rev.isCurrent ? '' : ' · 历史只读'} · 属性
                      </summary>
                      <dl>
                        <dt>适用范围</dt>
                        <dd>{rev.scope === 'project' ? `${projectName(w.project)} 项目` : '全局 · 跨项目'}</dd>
                        <dt>修订时间</dt>
                        <dd>
                          {formatDate(rev.created)} · {actorName[rev.actor]}
                        </dd>
                        <dt>修订</dt>
                        <dd>
                          {rev.revision}
                          {rev.isCurrent ? ' · 最新' : ' · 历史只读'}
                        </dd>
                        <dt>状态</dt>
                        <dd>{rev.status === 'current' ? '有效' : rev.status === 'withdrawn' ? '已撤销' : '已移除'}</dd>
                        <dt>检索使用</dt>
                        <dd>
                          {rev.usable
                            ? rev.kind === 'hypothesis'
                              ? '可检索 · 仍待核实'
                              : '可检索'
                            : rev.unavailable
                              ? '暂停 · 适用依据未恢复'
                              : '不用于当前检索'}
                        </dd>
                      </dl>
                    </details>
                  </aside>
                </div>
              </>
            ) : (
              <Notice title={m ? '所选修订未返回' : '这条记忆不在当前浏览范围或未载入'}>
                <Button onClick={() => H(false)}>返回最新修订</Button>
              </Notice>
            )}
          </>
        )}
        <Modal
          open={source}
          onClose={() => SO(false)}
          title={`修订来源：${rev?.title ?? ''}`}
          description={rev && `修订 ${rev.revision} · ${formatDate(rev.created)}`}
          drawer
        >
          <p>{rev?.reason}</p>
          <h3>记录来源</h3>
          <References
            project={w.project}
            onNavigate={() => SO(false)}
            items={rev?.sources.map((s) => ({ sessionId: s.sessionId, entryId: s.entryId })) ?? []}
          />
          {!!rev?.basis.length && (
            <>
              <h3>适用依据</h3>
              <References
                project={w.project}
                onNavigate={() => SO(false)}
                items={rev.basis.map((s) => ({ sessionId: s.sessionId, entryId: s.entryId }))}
              />
            </>
          )}
          <details>
            <summary>修订原始记录</summary>
            <Evidence value={rev} />
          </details>
        </Modal>
        <Modal
          open={!!manage}
          onClose={() => M(null)}
          title={manage === 'scope' ? '调整记忆的适用范围' : manage === 'retire' ? '撤销这条记忆' : '移除记忆'}
          description={m?.title}
        >
          {manage === 'scope' && (
            <>
              <Field label="适用范围">
                <select value={scope} onChange={(e) => S(e.target.value as 'project' | 'global')}>
                  {scopeOptions}
                </select>
              </Field>
              <Notice title="来源访问范围保持独立">全局记忆可跨项目使用，原项目的历史和来源只在相应项目中查看。</Notice>
            </>
          )}
          {manage === 'retire' && (
            <p>Agent 不再将这条认识用于当前检索。正文、来源和修订历史保留，可以根据新依据重新确认。</p>
          )}
          {manage === 'delete' && <p>Agent 将不再检索这条记忆。历史仍可查询，移除后不能直接重新启用。</p>}
          <Field label="操作依据">
            <textarea value={reason} onChange={(e) => R(e.target.value)} maxLength={4000} />
          </Field>
          {error && (
            <div role="alert">
              <Notice title="操作未完成" tone="warn">
                {error}
              </Notice>
            </div>
          )}
          {editing && editKey !== w.projectKey && (
            <Notice title="编辑草稿仍在原项目">
              <Button
                onClick={() => w.chooseProject(w.projects.find((p) => fixtureProjects[p] === editKey) ?? 'global')}
              >
                恢复编辑范围
              </Button>
            </Notice>
          )}
          <div className="modal-footer">
            <Button onClick={() => M(null)}>取消</Button>
            <Button
              kind={manage === 'scope' ? 'primary' : 'danger'}
              disabled={
                !reason.trim() || (m?.unavailable && manage !== 'delete') || (manage === 'scope' && scope === m?.scope)
              }
              onClick={() => {
                if (
                  !m ||
                  !perform({
                    baseRevision: manageBase,
                    reason,
                    ...(manage === 'delete'
                      ? { remove: true }
                      : manage === 'retire'
                        ? { retire: true }
                        : { knowledge: { title: m.title, content: m.content, kind: m.kind, scope } }),
                  })
                )
                  return;
                M(null);
                H(false);
                x.notify(
                  manage === 'scope'
                    ? '适用范围已保存。'
                    : manage === 'retire'
                      ? '记忆已撤销，修订历史保留。'
                      : '记忆已移除，历史可查询。',
                );
              }}
            >
              {manage === 'scope' ? '保存范围' : manage === 'retire' ? '撤销记忆' : '移除记忆'}
            </Button>
          </div>
        </Modal>
      </WorkspacePage>
    </StateGate>
  );
}

export const WorkspaceMemory = measureWorkspace('memory', MemoryPage);
