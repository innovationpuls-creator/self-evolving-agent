import { useEffect, useRef, useState } from 'react';
import { useHost } from './use-host';
import { readNavigation, saveNavigation } from './view-state';
import type { Session } from '../features/chat/session-state';
import { TrajectoryPanel, type TrajectoryViewState } from '../features/diagnostics/TrajectoryPanel';
import { Failure } from '../components/reading';
import { Catalog, ReflectionDetail } from '../features/reflection/Reflection';
import { Button, Field, Modal, Notice } from '../components/ui';
import { ShellSurface, folderName, type ShellController, type Page } from './Shell';
import { useProductNavigation } from './navigation';
import { TaskTitle } from '../components/Title';
import { SessionRoom, type SessionDraft } from '../features/chat/Session';
import { MemoryEditor } from '../features/memory/MemoryEditor';
import { MemoryDrafts } from '../features/memory/memory-management';
import { MemoryCatalog, MemoryReader } from '../features/memory/Memory';
import { Settings } from '../features/models/Settings';
import { Skills } from '../features/skills/Skills';
import { SkillDrafts } from '../features/skills/skill-management';
import { EvolutionCatalog, SuggestionDetail, ActivityView } from '../features/evolution/Evolution';
import { Source } from '../features/diagnostics/Source';
import type { Host, Route } from './types';
import '../styles/product.css';
import './onboarding.css';
export function App() {
  const nav = useProductNavigation(),
    r = nav.route;
  const routeKey = useRef(nav.key);
  routeKey.current = nav.key;
  const createOpen = useRef(false);
  const host = useHost(r.page === 'session' || r.page === 'trajectory' ? r.sessionId : readNavigation()?.sessionId);
  const [token, T] = useState(''),
    [create, C] = useState(false),
    [cwd, CWD] = useState(''),
    [model, M] = useState(''),
    [createError, CE] = useState(''),
    [creating, CR] = useState(false),
    [openError, OE] = useState('');
  createOpen.current = create;
  const [drafts, D] = useState<Record<string, SessionDraft>>({});
  const memoryDrafts = useRef(new MemoryDrafts());
  const skillDrafts = useRef(new SkillDrafts());
  useEffect(() => {
    const protect = (e: BeforeUnloadEvent) => {
      if (
        memoryDrafts.current.all().some((d) => d.phase !== 'saved') ||
        skillDrafts.current.all().length ||
        skillDrafts.current.knowledge.size
      ) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, []);
  const lastMemoryRoute = useRef<Extract<Route, { page: 'memory' }> | undefined>(undefined);
  if (r.page === 'memory') lastMemoryRoute.current = r;
  const lastReflectionRoute = useRef<Extract<Route, { page: 'reflections' }> | undefined>(undefined);
  if (r.page === 'reflections') lastReflectionRoute.current = r;
  const lastEvolutionRoute = useRef<Extract<Route, { page: 'evolution' }> | undefined>(undefined);
  if (r.page === 'evolution') lastEvolutionRoute.current = r;
  const lastSkillsRoute = useRef<Extract<Route, { page: 'skills' }> | undefined>(undefined);
  if (r.page === 'skills') lastSkillsRoute.current = r;
  const pendingId = useRef<string | undefined>(undefined),
    lastId = useRef<string | undefined>(readNavigation()?.sessionId),
    states = useRef(new Map<string, TrajectoryViewState>());
  const hostRef = useRef(host);
  hostRef.current = host;
  const authorizationBlocked = useRef(false);
  if (['auth_required', 'forbidden'].includes(host.connection)) authorizationBlocked.current = true;
  else if (host.connection === 'ready') authorizationBlocked.current = false;
  const locked = authorizationBlocked.current;
  const id = r.page === 'session' || r.page === 'trajectory' ? r.sessionId : undefined;
  if (id) lastId.current = id;
  useEffect(() => {
    saveNavigation({ kind: 'chat' }, lastId.current);
  }, [id]);
  useEffect(() => {
    let active = true;
    OE('');
    if (id && host.connection === 'ready' && hostRef.current.selected?.id !== id)
      void hostRef.current.open(id).catch((e) => {
        if (active) OE(e instanceof Error ? e.message : '会话读取失败');
      });
    return () => {
      active = false;
    };
  }, [id, host.connection]);
  const selected = host.selected;
  const retained = useRef<Session | undefined>(undefined);
  if (selected) retained.current = selected;
  const viewSession = selected || retained.current;
  const routeSession = r.page === 'reflections' ? r.sessionId : r.page === 'reflection' ? r.originSession : undefined;
  const context = host.sessions.find((s) => s.id === (id || routeSession || lastId.current)) || selected;
  const page: Page =
    r.page === 'activity'
      ? 'evolution'
      : r.page === 'memory-edit'
        ? 'memory'
        : r.page === 'session'
          ? 'chat'
          : r.page === 'trajectory'
            ? 'trace'
            : r.page === 'source'
              ? nav.workspace || 'reflection'
              : r.page === 'reflections' || r.page === 'reflection'
                ? 'reflection'
                : r.page === 'result'
                  ? r.target.kind === 'memory'
                    ? 'memory'
                    : r.target.kind === 'skill'
                      ? 'skills'
                      : 'evolution'
                  : r.page;
  const workspaceProject =
    r.page === 'memory' || r.page === 'memory-edit'
      ? r.project
      : r.page === 'result' && r.target.kind === 'memory'
        ? r.target.project
        : r.page === 'result' && r.project !== undefined
          ? r.project
          : r.page === 'source'
            ? r.project
            : r.page === 'reflections' || r.page === 'reflection'
              ? host.sessions.find((s) => s.id === routeSession)?.cwd
              : context?.cwd;
  const goPage = (page: Page) => {
    const sid = pendingId.current || lastId.current || host.sessions[0]?.id;
    pendingId.current = undefined;
    if (page === 'chat') nav.go({ page: 'session', sessionId: sid });
    else if (page === 'trace' && sid) nav.go({ page: 'trajectory', sessionId: sid });
    else if (page === 'reflection') nav.go(lastReflectionRoute.current || { page: 'reflections', offset: 0 });
    else if (page === 'memory')
      nav.go(
        r.page === 'session' || r.page === 'trajectory'
          ? { page: 'memory', project: context?.cwd }
          : lastMemoryRoute.current || { page: 'memory', project: context?.cwd },
      );
    else if (page === 'evolution') nav.go(lastEvolutionRoute.current || { page: 'evolution', project: context?.cwd });
    else if (page === 'skills') nav.go(lastSkillsRoute.current || { page: 'skills', project: context?.cwd });
    else if (page === 'settings') nav.go({ page });
  };
  const shellSession = (s: Session) => ({
    id: s.id,
    title: s.title || '未命名会话',
    project: s.cwd,
    run: s.busy ? ('running' as const) : ('idle' as const),
    unavailable: s.unavailable,
    error: s.error,
  });
  const x: ShellController = {
    page,
    sid: id || '',
    session: context
      ? { ...shellSession(context), project: workspaceProject || '' }
      : { id: '', title: '会话', project: workspaceProject || '', run: 'idle' },
    sessions: host.sessions.map(shellSession),
    connected: host.connection === 'ready',
    history: nav.depth ? [nav.depth] : [],
    go: goPage,
    back: nav.back,
    setSid: (value) => {
      pendingId.current = value;
    },
  };
  const assistSkill = lastId.current || host.sessions.find((s) => !s.unavailable)?.id;
  const onAssist = assistSkill
    ? (text: string) => {
        D((old) => ({ ...old, [assistSkill]: { text, files: [] } }));
        nav.go({ page: 'session', sessionId: assistSkill });
      }
    : undefined;
  const createSession = async () => {
    const choice = host.models.find((m) => `${m.provider}:${m.id}` === model);
    if (!choice) return;
    const owner = nav.key;
    CR(true);
    CE('');
    try {
      const session = await host.api<Session>('/sessions', 'POST', {
        cwd,
        provider: choice.provider,
        model: choice.id,
      });
      await host.refresh();
      if (owner === routeKey.current && createOpen.current) {
        C(false);
        nav.go({ page: 'session', sessionId: session.id });
      }
    } catch (e) {
      CE(e instanceof Error ? e.message : '创建失败');
    } finally {
      CR(false);
    }
  };
  const openCreate = () => {
    CWD(workspaceProject || context?.cwd || '');
    M(
      context
        ? `${context.provider}:${context.model}`
        : host.models[0]
          ? `${host.models[0].provider}:${host.models[0].id}`
          : '',
    );
    CE('');
    C(true);
  };
  if (locked || (host.connection !== 'ready' && !sessionStorage.getItem('agent-connection-token')))
    return (
      <div className="app quiet product-view host-product">
        <main className="host-connect">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void host
                .connect(token.trim())
                .then(() => T(''))
                .catch(() => {});
            }}
          >
            <h1>连接 Agent</h1>
            {host.error && <p role="alert">{host.error}</p>}
            <Field label="连接令牌">
              <input type="password" value={token} onChange={(e) => T(e.target.value)} autoComplete="off" />
            </Field>
            <Button
              type="submit"
              kind="primary"
              disabled={!token || ['connecting', 'syncing'].includes(host.connection)}
            >
              连接
            </Button>
          </form>
        </main>
      </div>
    );
  return (
    <ShellSurface
      x={x}
      host={{
        connection:
          host.connection === 'ready' ? '已连接' : host.connection === 'syncing' ? '正在同步' : '等待重新连接',
        retry: host.retry,
        create: openCreate,
        dialogs: (
          <Modal open={create} onClose={() => C(false)} title="开始一段新会话">
            <Field label="项目文件夹">
              <input value={cwd} onChange={(e) => CWD(e.target.value)} placeholder="例如 /Users/you/project" />
            </Field>
            <Field label="模型">
              <select value={model} onChange={(e) => M(e.target.value)}>
                {host.models.map((m) => (
                  <option key={`${m.provider}:${m.id}`} value={`${m.provider}:${m.id}`}>
                    {m.name} · {m.provider}
                  </option>
                ))}
              </select>
            </Field>
            {!host.models.length && (
              <Notice title="还没有可用的模型">
                <p>先在“模型与连接”中连接一个模型，再回来创建会话。</p>
                <Button
                  onClick={() => {
                    C(false);
                    nav.go({ page: 'settings' });
                  }}
                >
                  去连接模型
                </Button>
              </Notice>
            )}
            {createError && <p role="alert">{createError}</p>}
            <div className="modal-footer">
              <Button onClick={() => C(false)}>取消</Button>
              <Button
                kind="primary"
                disabled={!cwd || !model || creating || host.connection !== 'ready'}
                onClick={() => void createSession()}
              >
                {creating ? '正在创建…' : '创建会话'}
              </Button>
            </div>
          </Modal>
        ),
      }}
    >
      <div className="host-views">
        {host.error && (
          <Notice
            title="操作未完成"
            tone="warn"
            action={
              <Button kind="ghost" onClick={() => host.setError('')}>
                关闭提示
              </Button>
            }
          >
            <p role="alert">{host.error}</p>
          </Notice>
        )}
        <div hidden={r.page !== 'session' || !r.sessionId} className="host-conversation">
          {openError && (
            <Failure
              error={openError}
              retry={() => {
                OE('');
                if (id) void host.open(id).catch((e) => OE(String(e)));
              }}
            />
          )}
          {viewSession ? (
            <div className="host-retained-session" hidden={r.page === 'session' && r.sessionId !== viewSession.id}>
              <SessionRoom
                host={host}
                session={viewSession}
                active={r.page === 'session' && !!r.sessionId && viewSession.id === r.sessionId}
                route={r.page === 'session' ? r : { page: 'session', sessionId: viewSession.id }}
                draft={drafts[viewSession.id] || { text: '', files: [] }}
                onDraft={(sid, value) =>
                  D((old) => ({
                    ...old,
                    [sid]: typeof value === 'function' ? value(old[sid] || { text: '', files: [] }) : value,
                  }))
                }
                go={nav.go}
              />
            </div>
          ) : (
            !openError && (
              <p className="host-loading" role="status">
                正在读取会话…
              </p>
            )
          )}
        </div>
        <div hidden={r.page === 'session' && !!r.sessionId} className="host-workspace-view">
          <div className={`aw host-reading ${r.page === 'trajectory' ? 'host-trajectory' : ''}`} data-aw-page={page}>
            {r.page === 'session' && !r.sessionId && <SessionPicker host={host} go={nav.go} create={openCreate} />}
            {r.page === 'reflections' && (
              <Catalog
                api={host.api}
                sessions={host.sessions}
                route={r}
                go={nav.go}
                connected={host.connection === 'ready'}
              />
            )}
            {r.page === 'reflection' && (
              <ReflectionDetail api={host.api} sessions={host.sessions} route={r} go={nav.go} back={nav.back} />
            )}
            {r.page === 'source' && (
              <Source
                key={JSON.stringify(r.reference)}
                api={host.api}
                route={r}
                go={nav.go}
                back={nav.back}
                showBack={!nav.depth}
                sessionIds={host.sessions.map((session) => session.id)}
              />
            )}
            {r.page === 'result' &&
              (r.target.kind === 'memory' ? (
                <MemoryReader host={host} route={r} go={nav.go} back={nav.back} showBack={!nav.depth} />
              ) : r.target.kind === 'skill' ? (
                <Skills
                  host={host}
                  route={r}
                  store={skillDrafts.current}
                  onAssist={onAssist}
                  project={r.project ?? lastSkillsRoute.current?.project ?? context?.cwd ?? ''}
                  go={nav.go}
                  back={nav.back}
                />
              ) : (
                <SuggestionDetail
                  key={r.target.id}
                  host={host}
                  id={r.target.id}
                  project={lastEvolutionRoute.current?.project || context?.cwd}
                  go={nav.go}
                  back={nav.back}
                />
              ))}
            {r.page === 'memory' && (
              <MemoryCatalog
                store={memoryDrafts.current}
                host={host}
                route={r}
                go={nav.go}
                replace={(route) => nav.go(route, true)}
              />
            )}
            {r.page === 'memory-edit' && (
              <MemoryEditor
                key={JSON.stringify(r)}
                host={host}
                route={r}
                store={memoryDrafts.current}
                go={(route) => nav.go(route, true)}
                back={nav.back}
                showBack={!nav.depth}
              />
            )}
            {r.page === 'skills' && (
              <Skills
                host={host}
                route={r}
                store={skillDrafts.current}
                onAssist={onAssist}
                project={r.project ?? context?.cwd ?? ''}
                go={nav.go}
                back={nav.back}
              />
            )}
            {r.page === 'evolution' && <EvolutionCatalog host={host} route={r} go={nav.go} />}
            {r.page === 'activity' && <ActivityView key={r.id} host={host} id={r.id} go={nav.go} back={nav.back} />}
            {r.page === 'settings' && <Settings host={host} back={nav.back} />}
            {r.page === 'trajectory' && (
              <TrajectoryPanel
                key={r.sessionId}
                api={host.api}
                session={selected?.id === r.sessionId ? selected : undefined}
                active={r.page === 'trajectory'}
                states={states.current}
                onTargetDone={() => {}}
              />
            )}
          </div>
        </div>
      </div>
    </ShellSurface>
  );
}
function SessionPicker({ host, go, create }: { host: Host; go: (route: Route) => void; create: () => void }) {
  return (
    <>
      <header className="aw-heading">
        <h1 tabIndex={-1}>会话</h1>
      </header>
      {host.connection !== 'ready' && <p role="status">正在同步…</p>}
      <div className="host-session-picker">
        {host.sessions.map((s) => (
          <button
            type="button"
            key={s.id}
            data-session={s.id}
            data-focus={s.id}
            onClick={() => go({ page: 'session', sessionId: s.id })}
          >
            <TaskTitle title={s.title || '未命名会话'} />
            <small title={s.cwd}>{folderName(s.cwd) || s.cwd}</small>
          </button>
        ))}
      </div>
      {host.connection === 'ready' && !host.sessions.length && (
        <FirstRun modelReady={host.models.length > 0} settings={() => go({ page: 'settings' })} create={create} />
      )}
    </>
  );
}
function FirstRun({ modelReady, settings, create }: { modelReady: boolean; settings: () => void; create: () => void }) {
  // No session exists yet, so steps 2 and 3 complete only when the first session is created.
  const steps = [
    { title: '连接模型', done: modelReady, action: '去设置', run: settings },
    { title: '选择项目文件夹', done: false, action: '新建会话', run: create },
    { title: '开始提问', done: false, action: '新建会话', run: create },
  ];
  const current = steps.findIndex((step) => !step.done);
  return (
    <section className="onboarding" aria-label="开始使用">
      <ol>
        {steps.map((step, i) => (
          <li
            key={step.title}
            className={step.done ? 'done' : i === current ? 'current' : undefined}
            aria-current={i === current ? 'step' : undefined}
          >
            <span className="onboarding-mark" aria-hidden="true">
              {step.done ? '✓' : i + 1}
            </span>
            <span className="onboarding-title">
              {step.title}
              {step.done && <span className="sr-only">（已完成）</span>}
            </span>
            {i === current && (
              <Button kind="primary" onClick={step.run}>
                {step.action}
              </Button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
