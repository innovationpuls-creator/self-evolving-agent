import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useHost } from '../../../../apps/web/src/app/use-host';
import type { Session } from '../../../../apps/web/src/features/chat/session-state';
import {
  TrajectoryPanel,
  type TrajectoryViewState,
} from '../../../../apps/web/src/features/diagnostics/TrajectoryPanel';
import { Failure } from '../../host/src/Reflection';
import { Catalog, ReflectionDetail } from './Reflection';
import { Button, Field, Modal, TipProvider } from '../components/ui';
import { ShellSurface, type ShellController } from '../components/shell';
import type { Page } from '../state/model';
import { useProductNavigation } from './navigation';
import { TaskTitle } from './Title';
import { SessionRoom, type SessionDraft } from './Session';
import { MemoryEditor } from './MemoryEditor';
import { MemoryDrafts } from './memory-management';
import { MemoryCatalog, MemoryReader } from './Memory';
import { Connection } from './Catalogs';
import { Skills } from './Skills';
import { SkillDrafts } from './skill-management';
import { EvolutionCatalog, SuggestionDetail, ActivityView } from './Evolution';
import { Source } from './Source';
import type { Host, Route } from './types';
import './real.css';
function App() {
  const nav = useProductNavigation(),
    r = nav.route;
  const host = useHost(r.page === 'session' || r.page === 'trajectory' ? r.sessionId : undefined);
  const [token, T] = useState(''),
    [create, C] = useState(false),
    [cwd, CWD] = useState(''),
    [model, M] = useState(''),
    [createError, CE] = useState(''),
    [creating, CR] = useState(false),
    [openError, OE] = useState('');
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
    lastId = useRef<string | undefined>(undefined),
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
    archived: false,
  });
  const x: ShellController = {
    mode: 'quiet',
    page,
    sid: id || '',
    session: context
      ? { ...shellSession(context), project: workspaceProject || '' }
      : { id: '', title: '会话', project: workspaceProject || '', run: 'idle' },
    d: {
      sessions: host.sessions.map(shellSession),
      connection: host.connection === 'ready',
      memories: [],
      skills: [],
      phase: '',
    },
    scenario: 'normal',
    history: nav.depth ? [nav.depth] : [],
    go: goPage,
    back: nav.back,
    setSid: (value) => {
      pendingId.current = value;
    },
    updateSession: () => {},
    setObject: () => {},
    createSession: () => C(true),
    notify: () => {},
    toast: '',
  };
  const createSession = async () => {
    const choice = host.models.find((m) => `${m.provider}:${m.id}` === model);
    if (!choice) return;
    CR(true);
    CE('');
    try {
      const session = await host.api<Session>('/sessions', 'POST', {
        cwd,
        provider: choice.provider,
        model: choice.id,
      });
      C(false);
      await host.refresh();
      nav.go({ page: 'session', sessionId: session.id });
    } catch (e) {
      CE(e instanceof Error ? e.message : '创建失败');
    } finally {
      CR(false);
    }
  };
  if (locked)
    return (
      <div className="app quiet product-view host-product">
        <main className="host-connect">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void host
                .connect(token)
                .then(() => T(''))
                .catch(() => {});
            }}
          >
            <h1>连接 Agent Host</h1>
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
        create: () => {
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
        },
        dialogs: (
          <Modal
            open={create}
            onClose={() => C(false)}
            title="开始一段新会话"
            description="任务在 Host 项目目录中执行。"
          >
            <Field label="Host 工作目录">
              <input value={cwd} onChange={(e) => CWD(e.target.value)} placeholder="项目绝对路径" />
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
            {r.page === 'session' && !r.sessionId && <SessionPicker host={host} go={nav.go} />}
            {r.page === 'reflections' && <Catalog api={host.api} sessions={host.sessions} route={r} go={nav.go} />}
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
                sessionIds={host.sessions.map((session) => session.id)}
              />
            )}
            {r.page === 'result' &&
              (r.target.kind === 'memory' ? (
                <MemoryReader host={host} route={r} go={nav.go} back={nav.back} />
              ) : r.target.kind === 'skill' ? (
                <Skills
                  host={host}
                  route={r}
                  store={skillDrafts.current}
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
              />
            )}
            {r.page === 'skills' && (
              <Skills
                host={host}
                route={r}
                store={skillDrafts.current}
                project={r.project ?? context?.cwd ?? ''}
                go={nav.go}
                back={nav.back}
              />
            )}
            {r.page === 'evolution' && <EvolutionCatalog host={host} route={r} go={nav.go} />}
            {r.page === 'activity' && <ActivityView key={r.id} host={host} id={r.id} go={nav.go} back={nav.back} />}
            {r.page === 'settings' && <Connection host={host} />}
            {r.page === 'trajectory' && (
              <>
                <Button
                  kind="ghost"
                  className="aw-return"
                  onClick={() => nav.go({ page: 'session', sessionId: r.sessionId })}
                >
                  回到对话
                </Button>
                <TrajectoryPanel
                  key={r.sessionId}
                  api={host.api}
                  session={selected?.id === r.sessionId ? selected : undefined}
                  active={r.page === 'trajectory'}
                  states={states.current}
                  onTargetDone={() => {}}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </ShellSurface>
  );
}
function SessionPicker({ host, go }: { host: Host; go: (route: Route) => void }) {
  return (
    <>
      <header className="aw-heading">
        <h1 tabIndex={-1}>会话</h1>
      </header>
      {host.connection !== 'ready' && <p role="status">正在同步 Host…</p>}
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
            <small>{s.cwd}</small>
          </button>
        ))}
      </div>
      {host.connection === 'ready' && !host.sessions.length && <p>还没有会话。可以从导航中新建。</p>}
    </>
  );
}
export function renderHostApp(element: HTMLElement) {
  createRoot(element).render(
    <TipProvider>
      <App />
    </TipProvider>,
  );
}
