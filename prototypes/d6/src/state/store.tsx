import { createContext, useContext, useState, useRef, type ReactNode } from 'react';
import { report, initial, type Store, type Mode, type Page, type Scenario, type Session } from './model';
function useDemoStore() {
  const [mode, setModeState] = useState<Mode>(
    new URLSearchParams(location.search).get('route') === 'studio' ? 'studio' : 'quiet',
  );
  const [stores, setStores] = useState({ quiet: initial(), studio: initial() });
  const [page, setPage] = useState<Page>('chat');
  const [history, setHistory] = useState<Page[]>([]);
  const [sid, setSid] = useState('compare');
  const [scenario, setScenario] = useState<Scenario>('normal');
  const [objects, setObjects] = useState({
    memory: 'report',
    skills: 'text-diff',
    reflection: 'finding',
    trace: 'diff',
    evolution: '',
  });
  const [focusRequest, setFocusRequest] = useState({ type: '', serial: 0 });
  const setObject = (type: keyof typeof objects, id: string) => {
    setObjects((v) => ({ ...v, [type]: id }));
    setFocusRequest((v) => ({ type, serial: v.serial + 1 }));
  };
  const [outcomes, setOutcomes] = useState({ quiet: 'nochange', studio: 'success' });
  const outcome = outcomes[mode];
  const setOutcome = (value: string) => setOutcomes((all) => ({ ...all, [mode]: value }));
  const [toast, setToast] = useState('');
  const [memoryConflict, setMemoryConflict] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const timers = useRef<Record<string, number>>({});
  const d = stores[mode];
  const session = d.sessions.find((s) => s.id === sid) ?? d.sessions[0];
  const mutate = (fn: (s: Store) => Store, target: Mode = mode) =>
    setStores((all) => ({ ...all, [target]: fn(all[target]) }));
  const patch = (p: Partial<Store>) => mutate((s) => ({ ...s, ...p }));
  const updateSession = (p: Partial<Session>) =>
    mutate((s) => ({ ...s, sessions: s.sessions.map((x) => (x.id === session.id ? { ...x, ...p } : x)) }));
  const go = (p: Page) => {
    if (p !== page) setHistory((h) => [...h, page]);
    setPage(p);
    setScenario('normal');
  };
  const back = () => {
    const p = history.at(-1);
    if (p) {
      setPage(p);
      setHistory((h) => h.slice(0, -1));
      setScenario('normal');
    }
  };
  const switchMode = (m: Mode) => {
    setModeState(m);
    setHistory([]);
    setPage('chat');
    setSid('compare');
    setScenario('normal');
    window.history.replaceState({}, '', `?route=${m}`);
  };
  const notify = (t: string) => {
    setToast(t);
    window.setTimeout(() => setToast(''), 3500);
  };
  const createSession = (title = '新会话', project = '~/Projects/agent') => {
    const id = `s-${Date.now()}`;
    mutate((s) => ({
      ...s,
      sessions: [
        {
          id,
          title,
          project,
          draft: '',
          messages: [],
          refs: [],
          model: '通用模型',
          reasoning: '标准',
          run: 'idle',
          branch: 1,
          archived: false,
        },
        ...s.sessions,
      ],
    }));
    setSid(id);
    go('chat');
    notify(`已在 ${project} 创建会话`);
  };
  const send = () => {
    if (!session.draft.trim() || !d.connection || (d.auth !== 'saved' && !d.env) || session.run === 'running') return;
    const id = session.id;
    const m = mode;
    const key = `${m}:${id}`;
    timers.current[key] = (timers.current[key] ?? 0) + 1;
    const generation = timers.current[key];
    updateSession({
      title: session.messages.length ? session.title : session.draft.slice(0, 24),
      draft: '',
      messages: [...session.messages, session.draft],
      ...(mode === 'quiet'
        ? {
            transcript: [
              ...(session.transcript ??
                (session.id === 'compare'
                  ? [
                      { role: 'user' as const, text: session.messages[0] },
                      { role: 'assistant' as const, text: report },
                    ]
                  : [])),
              { role: 'user' as const, text: session.draft },
            ],
          }
        : {}),
      run: 'running',
    });
    window.setTimeout(() => {
      if (timers.current[key] !== generation) return;
      mutate(
        (s) => ({
          ...s,
          sessions: s.sessions.map((x) =>
            x.id === id
              ? {
                  ...x,
                  run: 'done',
                  ...(m === 'quiet'
                    ? {
                        transcript: [
                          ...(x.transcript ?? []),
                          {
                            role: 'assistant' as const,
                            text: '已收到这条请求。这里演示消息续接与阅读状态，未调用模型或执行工具。',
                          },
                        ],
                      }
                    : {}),
                }
              : x,
          ),
        }),
        m,
      );
    }, 2300);
  };
  const stop = () => {
    const key = `${mode}:${session.id}`;
    timers.current[key] = (timers.current[key] ?? 0) + 1;
    updateSession({ run: 'stopped' });
  };
  const develop = (outcome: string, approvedGrant: Store['grant'] = d.grant) => {
    if (!approvedGrant) return;
    const m = mode;
    const tokenKey = `dev:${m}`;
    timers.current[tokenKey] = (timers.current[tokenKey] ?? 0) + 1;
    const token = timers.current[tokenKey];
    patch({
      phase: 'developing',
      devEvents: [
        '已冻结具体目标、Skill 范围与基础版本',
        m === 'quiet' ? 'Agent 正在调查已授权的目标与现有能力' : 'Agent 正在调查并修改报告指引',
      ],
    });
    window.setTimeout(
      () =>
        mutate(
          (s) =>
            s.phase === 'developing' && timers.current[tokenKey] === token
              ? { ...s, phase: 'checking', devEvents: [...s.devEvents, 'Agent 自测完成；Host 开始必要检查'] }
              : s,
          m,
        ),
      1700,
    );
    window.setTimeout(
      () =>
        mutate((s) => {
          if (s.phase !== 'checking' || timers.current[tokenKey] !== token) return s;
          if (
            m === 'quiet' &&
            approvedGrant.skill &&
            s.skills.find((k) => k.id === approvedGrant.skill)?.version !== approvedGrant.base
          ) {
            return {
              ...s,
              phase: 'failed',
              devEvents: [...s.devEvents, '基础版本已改变；候选未生效，保留当前正式版本'],
            };
          }
          const ok = outcome === 'success';
          const addition =
            m === 'quiet'
              ? `\n\n## 用户授权的补充要求\n${approvedGrant.goal}`
              : '\n\n## 材料覆盖边界\n单列未核实材料，不将缺失推断为没有变化。';
          return {
            ...s,
            phase: ok ? 'applied' : outcome === 'failure' ? 'failed' : 'nochange',
            devEvents: [
              ...s.devEvents,
              ok
                ? '归属、基础版本、依赖与实际调用检查通过；候选已自动生效'
                : outcome === 'failure'
                  ? 'Tool 名称冲突；候选未生效，继续使用 v1'
                  : '调查后无需修改；没有产生新版本',
            ],
            skills: ok
              ? [
                  ...s.skills.map((x) =>
                    x.id === approvedGrant.skill
                      ? {
                          ...x,
                          version: approvedGrant.base + 1,
                          content: `${x.content}${addition}`,
                          snapshots: {
                            ...x.snapshots,
                            [x.version]: { content: x.content, code: x.code },
                            [approvedGrant.base + 1]: {
                              content: `${x.content}${addition}`,
                              code: x.code,
                            },
                          },
                          versions: [...new Set([...x.versions, approvedGrant.base + 1])],
                        }
                      : x,
                  ),
                  ...(approvedGrant.allowNew
                    ? [
                        {
                          id: approvedGrant.allowNew,
                          name: approvedGrant.allowNew,
                          description: '在指定目标授权下形成的材料覆盖指引。',
                          enabled: true,
                          extension: false,
                          version: 1,
                          versions: [1],
                          candidate: '',
                          trusted: true,
                          content: `# ${approvedGrant.allowNew}\n明确输入材料覆盖边界，不补造缺失结论。`,
                        },
                      ]
                    : []),
                ]
              : s.skills,
          };
        }, m),
      3500,
    );
  };
  const reset = () => {
    setMemoryConflict(false);
    for (const key of Object.keys(timers.current)) timers.current[key]++;
    setEpoch((v) => v + 1);
    setObjects({ memory: 'report', skills: 'text-diff', reflection: 'finding', trace: 'diff', evolution: '' });
    setOutcome(mode === 'studio' ? 'success' : 'nochange');
    mutate(() => initial());
    setSid('compare');
    go('chat');
    notify('已恢复初始演示案例');
  };
  return {
    mode,
    memoryConflict,
    setMemoryConflict,
    objects,
    focusRequest,
    setObject,
    outcome,
    setOutcome,
    epoch,
    switchMode,
    d,
    mutate,
    patch,
    page,
    go,
    back,
    history,
    sid,
    setSid,
    session,
    updateSession,
    scenario,
    setScenario,
    toast,
    notify,
    createSession,
    send,
    stop,
    develop,
    reset,
  };
}
export type Demo = ReturnType<typeof useDemoStore>;
const Context = createContext<Demo | null>(null);
// Visual primitives also render in the real app without constructing a demo store.
export function useVisualMode() {
  return useContext(Context)?.mode ?? 'quiet';
}
export function Provider({ children }: { children: ReactNode }) {
  const value = useDemoStore();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useDemo() {
  const d = useContext(Context);
  if (!d) throw Error('Demo provider missing');
  return d;
}
