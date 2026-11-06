import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUpRight, RefreshCw, ShieldCheck } from 'lucide-react';
import type {
  EvolutionCatalog as SuggestionCatalog,
  EvolutionEvidence,
  EvolutionInput,
  EvolutionSuggestion,
} from '../../../../host/evolution/evolution';
import type { EvolutionActivity } from '../../../../host/evolution/activities';
import type { SkillOperation, SkillRecord } from '../../../../host/skills/skills';
import type { Session } from '../chat/session-state';
import { Button, Field, Modal, Notice, SearchBox } from '../../components/ui';
import { Markdown } from '../../components/content';
import { Back, Failure, projectName } from '../../components/reading';
import { useRead, type Host, type Route } from '../../app/types';
import './capability-evolution.css';

const labels: Record<EvolutionSuggestion['status'], string> = {
  pending: '待处理',
  adopted: '已有讨论',
  ignored: '已忽略',
  archived: '已归档',
};
const activityLabels: Record<EvolutionActivity['status'], string> = {
  discussion: '讨论中',
  preparing: '准备开发',
  running: '开发中',
  checking: '检查与发布中',
  completed: '开发已完成',
  failed: '开发未完成',
  cancelled: '已取消',
  interrupted: '开发中断',
};
const active = (a: EvolutionActivity) => ['discussion', 'preparing', 'running', 'checking'].includes(a.status);
const date = (time: number) => new Date(time).toLocaleString('zh-CN');
const pageSize = 20;
type Go = (route: Route) => void;
type GrantDraft = { baseRevision: number; goal: string; existingSkills: string[]; newSkills: string };
type WriteState = { uncertain: boolean; pending?: boolean; receipt?: string };
// Drafts live only in this browser page. They never stand in for Host objects or replay writes.
const proposalDrafts = new WeakMap<Host['api'], WriteState & { draft: EvolutionInput }>();
const goalDrafts = new WeakMap<Host['api'], Map<string, WriteState & { goal: string }>>();
const grantDrafts = new WeakMap<Host['api'], Map<string, WriteState & { grant?: GrantDraft }>>();
let draftRevision = 0;
const draftListeners = new Set<() => void>();
const draftVersion = () => draftRevision;
const subscribeDraft = (listener: () => void) => {
  draftListeners.add(listener);
  return () => {
    draftListeners.delete(listener);
  };
};
const changedDraft = () => {
  draftRevision++;
  draftListeners.forEach((listener) => {
    listener();
  });
};
const useDraftRevision = () => useSyncExternalStore(subscribeDraft, draftVersion);
type EvolutionRoute = {
  page: 'evolution';
  project?: string;
  sessionId?: string;
  offset?: number;
  status?: EvolutionSuggestion['status'] | '';
};
function failure(reason: unknown) {
  const message = reason instanceof Error ? reason.message : '操作未完成';
  const status = reason && typeof reason === 'object' && 'status' in reason ? reason.status : undefined;
  return {
    message:
      status === 409
        ? `${message}。已重新读取，请核对当前版本后再操作。`
        : typeof status === 'number' && status < 500
          ? message
          : `${message} 结果尚未确认，请先刷新核对，避免重复提交。`,
    uncertain: !(typeof status === 'number' && status < 500),
  };
}
function useLive() {
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  return live;
}

export function EvolutionCatalog({ host, route, go }: { host: Host; route: EvolutionRoute; go: Go }) {
  const live = useLive();
  const offset = route.offset || 0;
  const status = route.status === undefined ? 'pending' : route.status;
  const query = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
  if (route.project) query.set('project', route.project);
  if (route.sessionId) query.set('sessionId', route.sessionId);
  if (status) query.set('status', status);
  const read = useRead<SuggestionCatalog>(host.api, `/suggestions?${query}`, ['agent-suggestions-changed']);
  const activities = useRead<EvolutionActivity[]>(host.api, '/activities', ['agent-suggestions-changed']);
  const projects = [...new Set([...host.sessions.map((s) => s.cwd), ...(route.project ? [route.project] : [])])];
  const [create, setCreate] = useState(false);
  const [selection, setSelection] = useState<Array<{ id: string; baseRevision: number }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    setSelection([]);
  }, [route.project, route.sessionId, status, offset]);
  useEffect(() => {
    if (read.value)
      setSelection((old) =>
        old.filter((item) => read.value?.items.some((s) => s.id === item.id && s.revision === item.baseRevision)),
      );
  }, [read.value]);
  const manage = async (next: 'ignored' | 'archived') => {
    setBusy(true);
    setError('');
    try {
      await host.api('/suggestions/manage', 'POST', { items: selection, status: next });
      if (!live.current) return;
      setSelection([]);
      read.refresh();
    } catch (reason) {
      if (!live.current) return;
      const f = failure(reason);
      setError(f.message);
      setUncertain(f.uncertain);
      read.refresh();
    } finally {
      if (live.current) setBusy(false);
    }
  };
  const refresh = () => {
    setUncertain(false);
    read.refresh();
    activities.refresh();
  };
  const history = activities.value?.filter((a) => !route.project || a.project === route.project) || [];
  return (
    <section className="host-evolution">
      <header className="aw-heading">
        <h1 tabIndex={-1}>改进建议</h1>
        <div className="inline-actions">
          <Button onClick={refresh} disabled={read.loading}>
            <RefreshCw size={14} />
            刷新
          </Button>
          <Button onClick={() => setCreate(!create)} aria-expanded={create}>
            提出建议
          </Button>
        </div>
      </header>
      {create && <CreateSuggestion host={host} go={go} close={() => setCreate(false)} />}
      <div className="aw-toolbar host-evolution-toolbar">
        <select
          aria-label="建议状态"
          value={status}
          onChange={(e) => go({ ...route, status: e.target.value as EvolutionRoute['status'], offset: 0 })}
        >
          <option value="">全部状态</option>
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="建议项目"
          value={route.project || ''}
          onChange={(e) => go({ ...route, project: e.target.value || undefined, sessionId: undefined, offset: 0 })}
        >
          <option value="">所有项目</option>
          {projects.map((project) => (
            <option key={project} value={project}>
              {projectName(project)} · {project}
            </option>
          ))}
        </select>
        <select
          aria-label="建议来源会话"
          value={route.sessionId || ''}
          onChange={(e) => go({ ...route, sessionId: e.target.value || undefined, offset: 0 })}
        >
          <option value="">所有来源会话</option>
          {route.sessionId && !host.sessions.some((s) => s.id === route.sessionId) && (
            <option value={route.sessionId}>来源会话不在当前目录中</option>
          )}
          {host.sessions
            .filter((s) => !route.project || s.cwd === route.project)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || '未命名会话'}
              </option>
            ))}
        </select>
      </div>
      {error && <p role="alert">{error}</p>}
      {read.error && <Failure error={read.error} retry={refresh} />}
      {read.loading && <p role="status">正在读取建议…</p>}
      {read.value && (
        <>
          {!!selection.length && (
            <div className="inline-actions host-evolution-batch">
              <span>已选 {selection.length} 项</span>
              <Button
                disabled={busy || uncertain || host.connection !== 'ready'}
                onClick={() => void manage('ignored')}
              >
                忽略所选
              </Button>
              <Button
                disabled={busy || uncertain || host.connection !== 'ready'}
                onClick={() => void manage('archived')}
              >
                归档所选
              </Button>
            </div>
          )}
          <div className="aw-proposals">
            {read.value.items.map((s) => (
              <div className="host-suggestion-row" key={s.id}>
                <input
                  type="checkbox"
                  aria-label={`选择建议：${s.title}`}
                  checked={selection.some((item) => item.id === s.id)}
                  disabled={busy}
                  onChange={(e) =>
                    setSelection((old) =>
                      e.target.checked
                        ? [...old, { id: s.id, baseRevision: s.revision }]
                        : old.filter((item) => item.id !== s.id),
                    )
                  }
                />
                <button
                  type="button"
                  className="aw-proposal-row"
                  data-focus={`suggestion:${s.id}`}
                  data-suggestion={s.id}
                  onClick={() => go({ page: 'result', target: { kind: 'suggestion', id: s.id } })}
                >
                  <span>
                    <strong>{s.title}</strong>
                    <p>{s.reason}</p>
                    <small>
                      {date(s.created)} · {s.actor === 'user' ? '你提出的建议' : 'Agent 提出的建议'}
                      {s.priority === 'high' && s.status === 'pending' ? ' · 值得关注' : ''}
                      {s.status !== 'pending' ? ` · ${labels[s.status]}` : ''}
                    </small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              </div>
            ))}
          </div>
          {!read.value.items.length && (
            <p className="empty-search">
              {offset
                ? '这一页已没有建议。'
                : status === 'pending'
                  ? '目前没有需要处理的建议。'
                  : '没有符合条件的建议。'}
            </p>
          )}
          <nav className="host-pagination" aria-label="建议分页">
            <Button
              disabled={read.loading || !offset}
              onClick={() => go({ ...route, offset: Math.max(0, offset - pageSize) })}
            >
              上一页
            </Button>
            <span>
              {read.value.items.length
                ? `${offset + 1}–${offset + read.value.items.length} / ${read.value.total}`
                : `共 ${read.value.total} 项`}
            </span>
            <Button
              disabled={read.loading || offset + pageSize >= read.value.total}
              onClick={() => go({ ...route, offset: offset + pageSize })}
            >
              下一页
            </Button>
            {offset >= read.value.total && offset > 0 && (
              <Button onClick={() => go({ ...route, offset: 0 })}>返回第一页</Button>
            )}
          </nav>
        </>
      )}
      <details className="host-technical host-activity-history">
        <summary>开发活动{history.length ? ` · ${history.length}` : ''}</summary>
        {activities.error && <Failure error={activities.error} retry={activities.refresh} />}
        {activities.loading && <p role="status">正在读取活动…</p>}
        {history.map((a) => (
          <button
            type="button"
            className="host-activity-row"
            key={a.id}
            data-focus={`activity:${a.id}`}
            onClick={() => go({ page: 'activity', id: a.id })}
          >
            <span>{a.goal}</span>
            <small>
              {activityLabels[a.status]} · {date(a.updated)}
            </small>
          </button>
        ))}
        {activities.value && !history.length && <p>还没有开发活动。</p>}
      </details>
    </section>
  );
}

const initialProposal: EvolutionInput = {
  title: '',
  goal: '',
  reason: '',
  value: '',
  uncertainty: '',
  action: '',
  evidence: [],
  priority: 'normal',
};
function CreateSuggestion({ host, go, close }: { host: Host; go: Go; close: () => void }) {
  const live = useLive();
  useDraftRevision();
  const [draft, updateDraft] = useState(proposalDrafts.get(host.api)?.draft || initialProposal);
  const setDraft = (value: EvolutionInput) => {
    proposalDrafts.set(host.api, { ...proposalDrafts.get(host.api), draft: value, uncertain });
    updateDraft(value);
  };
  const [working, setBusy] = useState(false);
  const busy = working || !!proposalDrafts.get(host.api)?.pending;
  const [error, setError] = useState('');
  const [uncertainty, updateUncertain] = useState(proposalDrafts.get(host.api)?.uncertain || false);
  const uncertain = uncertainty || !!proposalDrafts.get(host.api)?.uncertain;
  const setUncertain = (value: boolean) => {
    proposalDrafts.set(host.api, { ...proposalDrafts.get(host.api), draft, uncertain: value });
    updateUncertain(value);
  };
  const fields = [
    ['title', '建议名称'],
    ['goal', '希望改变什么'],
    ['reason', '为什么需要改变'],
    ['value', '预期作用'],
    ['uncertainty', '尚不确定的部分'],
    ['action', '建议怎样开始'],
  ] as const;
  const save = async () => {
    const saved = proposalDrafts.get(host.api);
    if (saved?.pending || saved?.receipt || saved?.uncertain) return;
    proposalDrafts.set(host.api, { draft, uncertain: false, pending: true });
    changedDraft();
    setBusy(true);
    setError('');
    try {
      const receipt = await host.api<EvolutionSuggestion>('/suggestions', 'POST', draft);
      proposalDrafts.set(host.api, { draft, uncertain: false, pending: true, receipt: receipt.id });
      const current = await host.api<EvolutionSuggestion>(`/suggestions/${receipt.id}`);
      proposalDrafts.set(host.api, { draft, uncertain: false, pending: false, receipt: current.id });
      changedDraft();
      if (!live.current) return;
      proposalDrafts.delete(host.api);
      go({ page: 'result', target: { kind: 'suggestion', id: current.id } });
    } catch (reason) {
      const f = failure(reason);
      proposalDrafts.set(host.api, { ...proposalDrafts.get(host.api), draft, uncertain: f.uncertain, pending: false });
      changedDraft();
      if (!live.current) return;
      setError(f.message);
      setUncertain(f.uncertain);
    } finally {
      if (live.current) setBusy(false);
    }
  };
  return (
    <form
      className="host-proposal-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="aw-muted">你提出的建议会保存在所有项目中；此处不会开始开发。</p>
      {fields.map(([key, label]) => (
        <Field label={label} key={key}>
          {key === 'title' ? (
            <input
              required
              disabled={busy}
              maxLength={240}
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          ) : (
            <textarea
              required
              disabled={busy}
              rows={3}
              maxLength={8000}
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          )}
        </Field>
      ))}
      {error && <p role="alert">{error}</p>}
      {uncertain && <p>请先在建议目录核对是否已保存。草稿仍在本页，不会自动重发。</p>}
      <div className="inline-actions">
        <Button
          kind="primary"
          type="submit"
          disabled={
            busy ||
            uncertain ||
            !!proposalDrafts.get(host.api)?.receipt ||
            !!proposalDrafts.get(host.api)?.uncertain ||
            host.connection !== 'ready' ||
            fields.some(([key]) => !draft[key].trim())
          }
        >
          {busy ? '正在保存…' : '保存建议'}
        </Button>
        <Button disabled={busy} onClick={close}>
          收起
        </Button>
        {proposalDrafts.get(host.api)?.receipt && (
          <Button
            onClick={() => {
              const receipt = proposalDrafts.get(host.api)?.receipt;
              if (receipt) go({ page: 'result', target: { kind: 'suggestion', id: receipt } });
            }}
          >
            查看 Host 返回的建议
          </Button>
        )}
        {uncertain && (
          <>
            <Button onClick={() => go({ page: 'evolution', status: '' })}>核对所有建议</Button>
            <Button
              kind="ghost"
              onClick={() => {
                if (!window.confirm('放弃本地草稿不会删除 Host 中可能已经保存的建议。继续？')) return;
                proposalDrafts.delete(host.api);
                updateDraft(initialProposal);
                updateUncertain(false);
                setError('');
              }}
            >
              放弃本地草稿
            </Button>
          </>
        )}
      </div>
    </form>
  );
}

export function SuggestionDetail({
  host,
  id,
  project = '',
  go,
  back,
}: {
  host: Host;
  id: string;
  project?: string;
  go: Go;
  back: () => void;
}) {
  const live = useLive();
  const read = useRead<EvolutionSuggestion>(host.api, `/suggestions/${id}`, ['agent-suggestions-changed']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const manage = async (action: 'adopt' | 'ignored' | 'archived') => {
    const s = read.value;
    if (!s) return;
    setBusy(true);
    setError('');
    try {
      if (action === 'adopt') {
        const adopted = await host.api<EvolutionSuggestion>(`/suggestions/${s.id}/adopt`, 'POST', {
          baseRevision: s.revision,
        });
        const current = await host.api<EvolutionSuggestion>(`/suggestions/${adopted.id}`);
        if (!live.current) return;
        if (!current.discussionSessionId || current.status !== 'adopted') throw new Error('Host 尚未确认讨论会话');
        go({ page: 'session', sessionId: current.discussionSessionId });
      } else {
        await host.api('/suggestions/manage', 'POST', {
          items: [{ id: s.id, baseRevision: s.revision }],
          status: action,
        });
        if (!live.current) return;
        read.refresh();
      }
    } catch (reason) {
      if (!live.current) return;
      const f = failure(reason);
      setError(f.message);
      setUncertain(f.uncertain);
      read.refresh();
    } finally {
      if (live.current) setBusy(false);
    }
  };
  const reload = async () => {
    setBusy(true);
    try {
      await host.api<EvolutionSuggestion>(`/suggestions/${id}`);
      if (!live.current) return;
      setUncertain(false);
      setError('');
      read.refresh();
    } catch (reason) {
      if (live.current) setError(reason instanceof Error ? reason.message : '建议读取失败');
    } finally {
      if (live.current) setBusy(false);
    }
  };
  return (
    <section className="host-evolution">
      <Back back={back}>返回建议</Back>
      <header className="aw-heading">
        <h1 tabIndex={-1}>{read.value?.title || '改进建议'}</h1>
        <Button disabled={read.loading || busy} onClick={() => void reload()}>
          <RefreshCw size={14} />
          刷新
        </Button>
      </header>
      {error && <p role="alert">{error}</p>}
      {read.error && <Failure error={read.error} retry={read.refresh} />}
      {read.loading && <p role="status">正在读取建议…</p>}
      {read.value && (
        <>
          <p className="host-evolution-meta">
            {labels[read.value.status]} · {read.value.actor === 'user' ? '你提出的建议' : 'Agent 提出的建议'} ·{' '}
            {date(read.value.created)}
          </p>
          {read.value.discussionError && (
            <Notice title="讨论未能建立" tone="warn">
              {read.value.discussionError}
            </Notice>
          )}
          {read.value.priority === 'high' && read.value.attentionReason && (
            <p className="host-evolution-attention">{read.value.attentionReason}</p>
          )}
          <div className="host-suggestion-reading">
            <Markdown text={read.value.reason} />
            <section>
              <h2>拟议改变</h2>
              <Markdown text={read.value.goal} />
              <p className="aw-muted">{read.value.value}</p>
            </section>
            <section>
              <h2>需要核对</h2>
              <Markdown text={read.value.uncertainty} />
            </section>
            <section>
              <h2>下一步</h2>
              <Markdown text={read.value.action} />
            </section>
          </div>
          <div className="inline-actions host-evolution-decisions">
            {read.value.status === 'pending' && (
              <>
                <Button
                  kind="primary"
                  disabled={busy || uncertain || host.connection !== 'ready'}
                  onClick={() => void manage('adopt')}
                >
                  采纳并讨论
                </Button>
                <Button
                  disabled={busy || uncertain || host.connection !== 'ready'}
                  onClick={() => void manage('ignored')}
                >
                  忽略
                </Button>
              </>
            )}
            {read.value.discussionSessionId && (
              <Button onClick={() => go({ page: 'session', sessionId: read.value?.discussionSessionId })}>
                继续讨论
                <ArrowUpRight size={14} />
              </Button>
            )}
            {read.value.status !== 'archived' && (
              <Button
                kind="ghost"
                disabled={busy || uncertain || host.connection !== 'ready'}
                onClick={() => void manage('archived')}
              >
                归档
              </Button>
            )}
          </div>
          {read.value.status === 'pending' && <p className="aw-muted">采纳只开启讨论；开发范围需要单独授权。</p>}
          <details className="host-technical">
            <summary>依据与来源{read.value.evidence.length ? ` · ${read.value.evidence.length}` : ''}</summary>
            <p>{read.value.project ? projectName(read.value.project) : '所有项目'}</p>
            {read.value.source && (
              <EvidenceLink reference={read.value.source} project={read.value.project || project} go={go} />
            )}
            {read.value.evidence.map((reference) => (
              <EvidenceLink
                key={JSON.stringify(reference)}
                reference={reference}
                project={read.value?.project || project}
                go={go}
              />
            ))}
            {!read.value.source && !read.value.evidence.length && <p>这条建议没有保存历史引用。</p>}
          </details>
        </>
      )}
    </section>
  );
}
function EvidenceLink({ reference, project, go }: { reference: EvolutionEvidence; project: string; go: Go }) {
  return (
    <div className="inline-actions host-evidence-links">
      {(reference.sessionId || reference.traceId) && (
        <Button kind="ghost" onClick={() => go({ page: 'source', reference, project })}>
          查看原始依据
        </Button>
      )}
      {reference.memoryId && (
        <Button
          kind="ghost"
          onClick={() =>
            reference.memoryId &&
            go({
              page: 'result',
              target: { kind: 'memory', id: reference.memoryId, revision: reference.revision, project },
            })
          }
        >
          查看记忆{reference.revision ? `修订 ${reference.revision}` : ''}
        </Button>
      )}
      {reference.skillId && (
        <Button
          kind="ghost"
          onClick={() =>
            reference.skillId &&
            go({
              page: 'result',
              project,
              target: { kind: 'skill', id: reference.skillId, knowledgeRevision: reference.knowledgeRevision },
            })
          }
        >
          查看技能知识
        </Button>
      )}
      {reference.reflectionId && (
        <Button
          kind="ghost"
          onClick={() =>
            reference.reflectionId &&
            go({ page: 'reflection', jobId: reference.reflectionId, recordId: reference.reflectionId })
          }
        >
          查看反思
        </Button>
      )}
    </div>
  );
}

export function ActivityView({ host, id, go, back }: { host: Host; id: string; go: Go; back: () => void }) {
  const read = useRead<EvolutionActivity>(host.api, `/activities/${id}`, ['agent-suggestions-changed']);
  return (
    <section className="host-evolution">
      <Back back={back}>返回</Back>
      <header className="aw-heading">
        <h1 tabIndex={-1}>开发活动</h1>
        <Button disabled={read.loading} onClick={read.refresh}>
          <RefreshCw size={14} />
          刷新
        </Button>
      </header>
      {read.error && <Failure error={read.error} retry={read.refresh} />}
      {read.loading && <p role="status">正在读取活动…</p>}
      {read.value && <ActivityBody host={host} activity={read.value} go={go} refresh={read.refresh} />}
    </section>
  );
}

export function SessionActivity({ host, session, go }: { host: Host; session: Session; go: Go }) {
  const live = useLive();
  useDraftRevision();
  const activities = useRead<EvolutionActivity[]>(host.api, '/activities', ['agent-suggestions-changed']);
  const activity = activities.value?.find((a) => a.sessionId === session.id);
  let drafts = goalDrafts.get(host.api);
  if (!drafts) {
    drafts = new Map();
    goalDrafts.set(host.api, drafts);
  }
  const [goal, updateGoal] = useState(drafts.get(session.id)?.goal || '');
  const setGoal = (value: string) => {
    drafts.set(session.id, { ...drafts.get(session.id), goal: value, uncertain });
    updateGoal(value);
  };
  const [working, setBusy] = useState(false);
  const busy = working || !!drafts.get(session.id)?.pending;
  const [error, setError] = useState('');
  const [uncertainty, updateUncertain] = useState(drafts.get(session.id)?.uncertain || false);
  const uncertain = uncertainty || !!drafts.get(session.id)?.uncertain;
  const setUncertain = (value: boolean) => {
    drafts.set(session.id, { ...drafts.get(session.id), goal, uncertain: value });
    updateUncertain(value);
  };
  const create = async () => {
    const saved = drafts.get(session.id);
    if (saved?.pending || saved?.receipt || saved?.uncertain) return;
    drafts.set(session.id, { goal, uncertain: false, pending: true });
    changedDraft();
    setBusy(true);
    setError('');
    try {
      const receipt = await host.api<EvolutionActivity>('/activities', 'POST', { sessionId: session.id, goal });
      drafts.set(session.id, { goal, uncertain: false, pending: true, receipt: receipt.id });
      const current = await host.api<EvolutionActivity>(`/activities/${receipt.id}`);
      drafts.set(session.id, { goal, uncertain: false, pending: false, receipt: current.id });
      changedDraft();
      if (!live.current) return;
      drafts.delete(session.id);
      go({ page: 'session', sessionId: current.sessionId });
      setGoal('');
    } catch (reason) {
      const f = failure(reason);
      drafts.set(session.id, { ...drafts.get(session.id), goal, uncertain: f.uncertain, pending: false });
      changedDraft();
      if (!live.current) return;
      setError(f.message);
      setUncertain(f.uncertain);
      activities.refresh();
    } finally {
      if (live.current) setBusy(false);
    }
  };
  return (
    <section className="host-session-activity" aria-label="能力目标与开发活动">
      {activities.error && <Failure error={activities.error} retry={activities.refresh} />}
      {activity ? (
        <ActivityBody
          host={host}
          activity={activity}
          go={go}
          refresh={activities.refresh}
          compact
          sessionBusy={session.busy}
        />
      ) : (
        activities.value && (
          <details>
            <summary>发起能力改进讨论</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <Field label="希望获得的能力">
                <textarea
                  rows={3}
                  maxLength={8000}
                  required
                  disabled={busy}
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                />
              </Field>
              <p className="aw-muted">另开讨论会话，保留这里的工作；讨论本身不会授予开发权限。</p>
              {error && <p role="alert">{error}</p>}
              {uncertain && (
                <div className="inline-actions">
                  <Button onClick={() => go({ page: 'evolution', status: '' })}>核对开发活动</Button>
                  <Button
                    kind="ghost"
                    onClick={() => {
                      if (!window.confirm('放弃本地草稿不会删除 Host 中可能已经创建的讨论活动。继续？')) return;
                      drafts.delete(session.id);
                      updateGoal('');
                      updateUncertain(false);
                      setError('');
                    }}
                  >
                    放弃本地草稿
                  </Button>
                </div>
              )}
              {drafts.get(session.id)?.receipt && (
                <Button
                  onClick={() => {
                    const receipt = drafts.get(session.id)?.receipt;
                    if (receipt) go({ page: 'activity', id: receipt });
                  }}
                >
                  查看 Host 返回的活动
                </Button>
              )}
              <Button
                type="submit"
                disabled={
                  busy || uncertain || !!drafts.get(session.id)?.receipt || host.connection !== 'ready' || !goal.trim()
                }
              >
                进入独立讨论
              </Button>
            </form>
          </details>
        )
      )}
    </section>
  );
}

function ActivityBody({
  host,
  activity,
  go,
  refresh,
  compact = false,
  sessionBusy = false,
}: {
  host: Host;
  activity: EvolutionActivity;
  go: Go;
  refresh: () => void;
  compact?: boolean;
  sessionBusy?: boolean;
}) {
  const live = useLive();
  useDraftRevision();
  let drafts = grantDrafts.get(host.api);
  if (!drafts) {
    drafts = new Map();
    grantDrafts.set(host.api, drafts);
  }
  const [grant, updateGrant] = useState<GrantDraft | undefined>(drafts.get(activity.id)?.grant);
  const setGrant = (value: GrantDraft | undefined) => {
    drafts.set(activity.id, { ...drafts.get(activity.id), grant: value, uncertain });
    updateGrant(value);
  };
  const [cancel, setCancel] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const [working, setBusy] = useState(false);
  const busy = working || !!drafts.get(activity.id)?.pending;
  const [error, setError] = useState('');
  const [uncertainty, updateUncertain] = useState(drafts.get(activity.id)?.uncertain || false);
  const uncertain = uncertainty || !!drafts.get(activity.id)?.uncertain;
  const setUncertain = (value: boolean) => {
    drafts.set(activity.id, { ...drafts.get(activity.id), grant, uncertain: value });
    updateUncertain(value);
  };
  const skills = useRead<{ skills: SkillRecord[] }>(
    host.api,
    `/skills?${new URLSearchParams({ project: activity.project })}`,
    ['agent-skills-changed'],
  );
  const session = host.sessions.find((s) => s.id === activity.sessionId);
  const run = async (kind: 'authorize' | 'cancel') => {
    if (drafts.get(activity.id)?.pending || drafts.get(activity.id)?.uncertain) return;
    drafts.set(activity.id, { grant, uncertain: false, pending: true });
    changedDraft();
    setBusy(true);
    setError('');
    try {
      const receipt = await host.api<EvolutionActivity>(
        `/activities/${activity.id}/${kind}`,
        'POST',
        kind === 'authorize' && grant ? { ...grant, newSkills: grant.newSkills.split(/[\s,，]+/).filter(Boolean) } : {},
      );
      await host.api<EvolutionActivity>(`/activities/${receipt.id}`);
      drafts.set(activity.id, { uncertain: false, pending: false });
      changedDraft();
      if (!live.current) return;
      setGrant(undefined);
      setCancel(false);
      refresh();
    } catch (reason) {
      const f = failure(reason);
      drafts.set(activity.id, { grant, uncertain: f.uncertain, pending: false });
      changedDraft();
      if (!live.current) return;
      setError(f.message);
      setUncertain(f.uncertain);
      refresh();
    } finally {
      if (live.current) setBusy(false);
    }
  };
  const reconcile = async () => {
    setBusy(true);
    try {
      await host.api<EvolutionActivity>(`/activities/${activity.id}`);
      if (!live.current) return;
      setUncertain(false);
      setError('');
      refresh();
    } catch (reason) {
      if (live.current) setError(reason instanceof Error ? reason.message : '活动读取失败');
    } finally {
      if (live.current) setBusy(false);
    }
  };
  const staleGrant = grant && (grant.baseRevision !== activity.revision || activity.status !== 'discussion');
  const targets = grant?.newSkills.split(/[\s,，]+/).filter(Boolean) || [];
  const invalidNames =
    targets.some((name) => !/^[a-z][a-z0-9-]{0,63}$/.test(name)) || new Set(targets).size !== targets.length;
  return (
    <div className={`host-activity ${compact ? 'compact' : ''}`} data-activity-status={activity.status}>
      <div className="host-activity-heading">
        <strong>{activityLabels[activity.status]}</strong>
        <div className="inline-actions">
          {!compact && (
            <Button onClick={() => go({ page: 'session', sessionId: activity.sessionId })}>
              继续讨论
              <ArrowUpRight size={14} />
            </Button>
          )}
          {activity.status === 'discussion' && (
            <Button
              disabled={host.connection !== 'ready' || busy || sessionBusy || session?.busy || uncertain}
              onClick={() => {
                setError('');
                setGrant({ baseRevision: activity.revision, goal: activity.goal, existingSkills: [], newSkills: '' });
              }}
            >
              <ShieldCheck size={14} />
              审阅开发授权
            </Button>
          )}
          {compact && (
            <Button kind="ghost" onClick={() => go({ page: 'activity', id: activity.id })}>
              查看活动
            </Button>
          )}
        </div>
      </div>
      {!compact && <p className="host-activity-goal">{activity.goal}</p>}
      {activity.suggestionId && (
        <Button
          kind="ghost"
          onClick={() =>
            activity.suggestionId && go({ page: 'result', target: { kind: 'suggestion', id: activity.suggestionId } })
          }
        >
          返回原建议
        </Button>
      )}
      {activity.error && <p role="alert">{activity.error}</p>}
      {error && <p role="alert">{error}</p>}
      {activity.result && (
        <div className="host-activity-result">
          <Markdown text={activity.result.summary} />
          {!!activity.result.packages.length && (
            <details>
              <summary>提交的候选内容 · {activity.result.packages.length}</summary>
              {activity.result.packages.map((p) => (
                <div className="host-activity-package" key={p.target}>
                  <strong>{activity.grant?.targets.find((t) => t.key === p.target)?.name || p.target}</strong>
                  <code>{p.skillFile}</code>
                  {p.extensions.map((file) => (
                    <code key={file}>{file}</code>
                  ))}
                  {p.knowledgeFiles.map((file) => (
                    <code key={file}>{file}</code>
                  ))}
                </div>
              ))}
            </details>
          )}
        </div>
      )}
      {!!activity.releases.length && (
        <section className="host-activity-releases" aria-label="实际发布结果">
          {activity.releases.map((release) => (
            <Release key={release.operationId} host={host} activity={activity} release={release} go={go} />
          ))}
        </section>
      )}
      {activity.grant && (
        <details className="host-technical">
          <summary>开发授权范围</summary>
          <Markdown text={activity.grant.goal} />
          <ul>
            {activity.grant.targets.map((t) => (
              <li key={t.key}>
                {t.skillId ? '允许修改' : '允许新建'}：{t.name}
                <code>{t.directory}</code>
              </li>
            ))}
          </ul>
          <p>{date(activity.grant.at)}</p>
        </details>
      )}
      {active(activity) && (
        <Button
          kind="ghost"
          disabled={host.connection !== 'ready' || busy || uncertain}
          onClick={() => setCancel(true)}
        >
          取消活动
        </Button>
      )}
      {uncertain && (
        <Button disabled={busy} onClick={() => void reconcile()}>
          核对操作结果
        </Button>
      )}
      <Modal
        open={!!grant}
        onClose={() => !busy && setGrant(undefined)}
        title="授权能力开发"
        className="host-grant-dialog"
        wide
        footer={
          <>
            <Button disabled={busy} onClick={() => setGrant(undefined)}>
              返回讨论
            </Button>
            <Button
              kind="primary"
              disabled={
                busy ||
                uncertain ||
                !grant?.goal.trim() ||
                !grant ||
                staleGrant ||
                invalidNames ||
                !skills.value ||
                !!skills.error ||
                (!grant.existingSkills.length && !targets.length) ||
                host.connection !== 'ready' ||
                sessionBusy ||
                session?.busy
              }
              onClick={() => void run('authorize')}
            >
              {busy ? '正在提交…' : '授权并开始开发'}
            </Button>
          </>
        }
      >
        {grant && (
          <>
            <Field label="授权目标与限制">
              <textarea
                rows={4}
                required
                disabled={busy}
                maxLength={8000}
                value={grant.goal}
                onChange={(e) => setGrant({ ...grant, goal: e.target.value })}
              />
            </Field>
            {skills.error && <Failure error={skills.error} retry={skills.refresh} />}
            {skills.loading && <p role="status">正在读取可授权技能…</p>}
            <details className="host-grant-choices">
              <summary>
                允许修改的已有技能
                {grant.existingSkills.length ? ` · 已选 ${grant.existingSkills.length} 项` : ' · 未选择'}
              </summary>
              <SearchBox value={skillQuery} onChange={setSkillQuery} placeholder="查找允许修改的技能" />
              <fieldset className="host-grant-skills">
                <legend>允许修改的已有技能</legend>
                {skills.value?.skills
                  .filter(
                    (skill) =>
                      !skillQuery ||
                      `${skill.name} ${skill.description}`.toLowerCase().includes(skillQuery.toLowerCase()),
                  )
                  .map((skill) => (
                    <label key={skill.id}>
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={grant.existingSkills.includes(skill.id)}
                        onChange={(e) =>
                          setGrant({
                            ...grant,
                            existingSkills: e.target.checked
                              ? [...grant.existingSkills, skill.id]
                              : grant.existingSkills.filter((id) => id !== skill.id),
                          })
                        }
                      />
                      <span>
                        {skill.name}
                        <small>{skill.current ? (skill.project ? '当前项目' : '所有项目') : '尚未生效候选'}</small>
                      </span>
                    </label>
                  ))}
                {skills.value && !skills.value.skills.length && <p>这个项目还没有可修改的已管理技能。</p>}
              </fieldset>
            </details>
            {!!grant.existingSkills.length && (
              <p>
                允许修改：
                {skills.value?.skills
                  .filter((s) => grant.existingSkills.includes(s.id))
                  .map((s) => s.name)
                  .join('、')}
              </p>
            )}
            <Field label="允许新建的技能名称">
              <input
                disabled={busy}
                value={grant.newSkills}
                onChange={(e) => setGrant({ ...grant, newSkills: e.target.value })}
                placeholder="如 document-diff；多个名称用空格分隔"
              />
            </Field>
            {invalidNames && (
              <p role="alert">名称须以小写字母开头，只含小写字母、数字和连字符，最长 64 字符，不能重复。</p>
            )}
            <Notice title="开发可执行本机代码" tone="warn">
              授权后 Agent 可使用
              Shell、安装依赖并运行代码。当前没有操作系统沙箱，代码可访问本机用户能访问的文件、环境变量和网络。
              通过必要检查的授权版本会自动生效；取消活动不保证终止已脱离的子进程，版本恢复也不能撤销外部操作。
            </Notice>
            {staleGrant && <p role="alert">活动修订已变化。本次授权仍绑定打开时的版本，请返回讨论并重新审阅。</p>}
            {error && <p role="alert">{error}</p>}
            <details className="host-technical">
              <summary>授权绑定</summary>
              <p>Activity 修订 {grant.baseRevision}</p>
              <code>{activity.id}</code>
            </details>
          </>
        )}
      </Modal>
      <Modal
        open={cancel}
        onClose={() => !busy && setCancel(false)}
        title="取消开发活动"
        footer={
          <>
            <Button disabled={busy} onClick={() => setCancel(false)}>
              继续活动
            </Button>
            <Button
              kind="danger"
              disabled={busy || uncertain || host.connection !== 'ready'}
              onClick={() => void run('cancel')}
            >
              确认取消
            </Button>
          </>
        }
      >
        <p>
          停止接收后续开发与发布。已经提交的版本会保留，不会自动回退；已脱离的子进程可能继续运行，外部操作不会被撤销。
        </p>
        {error && <p role="alert">{error}</p>}
      </Modal>
    </div>
  );
}

function Release({
  host,
  activity,
  release,
  go,
}: {
  host: Host;
  activity: EvolutionActivity;
  release: EvolutionActivity['releases'][number];
  go: Go;
}) {
  const read = useRead<SkillOperation>(host.api, `/skills/operations/${release.operationId}`, [
    'agent-skills-changed',
    'agent-suggestions-changed',
  ]);
  const skill = useRead<{
    skill: SkillRecord;
    versions: Array<{ id: string; evolution?: { activityId: string; digest: string }; digest: string }>;
  }>(host.api, `/skills/${release.skillId}`, ['agent-skills-changed']);
  const version = skill.value?.versions.find((v) => v.id === release.version);
  const confirmed =
    read.value?.status === 'applied' &&
    read.value.evolution?.activityId === activity.id &&
    read.value.skillId === release.skillId &&
    version?.evolution?.activityId === activity.id &&
    version.evolution.digest === version.digest;
  const name =
    skill.value?.skill.name || activity.grant?.targets.find((t) => t.skillId === release.skillId)?.name || '能力版本';
  return (
    <div
      className="host-activity-release"
      data-release-status={confirmed ? 'applied' : read.value?.status || 'unconfirmed'}
    >
      <strong>{name}</strong>
      <p>
        {confirmed
          ? skill.value?.skill.current === release.version
            ? '已发布，当前正式版本'
            : '此活动已发布的历史版本'
          : read.value?.status === 'failed'
            ? read.value.message
            : read.value?.status === 'interrupted'
              ? '发布中断，已提交内容仍保留'
              : '尚未确认发布结果'}
      </p>
      {(read.error || skill.error) && (
        <Failure
          error={read.error || skill.error}
          retry={() => {
            read.refresh();
            skill.refresh();
          }}
        />
      )}
      <Button
        onClick={() =>
          go({
            page: 'result',
            project: activity.project,
            target: { kind: 'skill', id: release.skillId, version: release.version },
          })
        }
      >
        查看精确版本
        <ArrowUpRight size={14} />
      </Button>
      {!!read.value?.checks?.length && (
        <details>
          <summary>实际检查</summary>
          {read.value.checks.map((check, index) => (
            <div key={`${check.tool}:${index}`}>
              <strong>
                {check.tool} · {check.passed ? '通过' : '未通过'}
              </strong>
              <pre>{check.output}</pre>
            </div>
          ))}
        </details>
      )}
      <details className="host-technical">
        <summary>发布记录</summary>
        <p>
          版本 <code>{release.version}</code>
        </p>
        <p>
          Operation <code>{release.operationId}</code>
        </p>
        {read.value && <p>{read.value.message}</p>}
      </details>
    </div>
  );
}
