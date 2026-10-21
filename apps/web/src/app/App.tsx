import { useCallback, useEffect, useRef, useState } from 'react';
import { useHost } from './use-host';
import { readNavigation, saveNavigation, type View } from './view-state';
import { ChatView } from '../features/chat/ChatView';
import { ModelSettings } from '../features/models/ModelSettings';
import { SkillsPanel } from '../features/skills/SkillsPanel';
import { MemoryPanel } from '../features/memory/MemoryPanel';
import { DiagnosticsPanel } from '../features/diagnostics/DiagnosticsPanel';
import { ReflectionPanel } from '../features/reflection/ReflectionPanel';
import { SuggestionsPanel } from '../features/evolution/SuggestionsPanel';

const labels = {
  connecting: '正在连接',
  syncing: '正在同步',
  ready: '已连接',
  offline: '连接恢复中',
  auth_required: '需要连接',
  forbidden: '访问被拒绝',
};
function initialView(): View {
  const saved = readNavigation();
  if (!saved) return { kind: 'chat' };
  switch (saved.kind) {
    case 'memory':
      return { kind: 'memory', id: saved.id, project: saved.project, revision: saved.revision };
    case 'skills':
      return { kind: 'skills', id: saved.id, project: saved.project, knowledgeRevision: saved.knowledgeRevision };
    case 'diagnostics':
      return {
        kind: 'diagnostics',
        evidence: saved.evidence,
        session: saved.diagnosticSessionId ? { id: saved.diagnosticSessionId, title: '指定会话' } : undefined,
      };
    case 'suggestions':
    case 'reflection':
      return { kind: saved.kind, id: saved.id };
    default:
      return { kind: saved.kind };
  }
}
export function App() {
  const [view, setView] = useState<View>(initialView);
  const [returnView, setReturnView] = useState<View>({ kind: 'chat' });
  const host = useHost(readNavigation()?.sessionId);
  const { api, selected, selectedId, connection } = host;
  const ready = connection === 'ready';
  const navigationEpoch = useRef(0);
  const currentSessionId = useRef(selectedId);
  currentSessionId.current = selectedId;
  const [token, setToken] = useState(''),
    [menu, setMenu] = useState(false),
    [attention, setAttention] = useState(0);
  const [localError, setLocalError] = useState('');
  const memoryDirty = useRef(false),
    skillsDirty = useRef(false);
  const scrollPositions = useRef(new Map<string, number>());
  const drafts = useRef(new Map<string, { text: string; version: number }>());
  const submitting = useRef(new Set<string>());
  const [, renderDraft] = useState(0);
  const updateDraft = (id: string, text: string) => {
    const old = drafts.current.get(id);
    drafts.current.set(id, { text, version: (old?.version ?? 0) + 1 });
    renderDraft((n) => n + 1);
  };
  const leave = (fn: () => void) => {
    if ((memoryDirty.current || skillsDirty.current) && !window.confirm('当前内容有未保存修改，离开并放弃这些修改？'))
      return;
    memoryDirty.current = false;
    skillsDirty.current = false;
    setLocalError('');
    setMenu(false);
    navigationEpoch.current++;
    fn();
  };
  const navigate = (target: View) =>
    leave(() => {
      if (target.kind === 'settings' && view.kind !== 'settings') setReturnView(view);
      setView(target);
    });
  const back = () => navigate({ kind: 'chat' });
  const report = useCallback((message: string) => setLocalError(message), []);
  const expedite = (id?: string) => {
    if (id && ready)
      void api('/reflections/expedite', 'POST', { sessionId: id }).catch(() =>
        window.dispatchEvent(new Event('agent-reflection-changed')),
      );
  };
  const selectSession = async (id: string) => {
    expedite(selectedId !== id ? selectedId : undefined);
    setView({ kind: 'chat' });
    setMenu(false);
    await host.open(id);
  };
  useEffect(() => {
    saveNavigation(view, selectedId);
  }, [view, selectedId]);
  useEffect(() => {
    if (!ready) return;
    let alive = true,
      epoch = 0;
    const refresh = () => {
      const current = ++epoch;
      void api<{ highPriorityPending: number }>('/suggestions?limit=1')
        .then((value) => {
          if (alive && current === epoch) setAttention(value.highPriorityPending);
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener('agent-suggestions-changed', refresh);
    window.addEventListener('agent-reconnected', refresh);
    return () => {
      alive = false;
      window.removeEventListener('agent-suggestions-changed', refresh);
      window.removeEventListener('agent-reconnected', refresh);
    };
  }, [ready, api]);
  const send = async () => {
    if (!selected || !ready || selected.busy || submitting.current.has(selected.id)) return;
    const id = selected.id,
      draft = drafts.current.get(id);
    if (!draft?.text.trim()) return;
    submitting.current.add(id);
    updateDraft(id, '');
    const clearedVersion = drafts.current.get(id)?.version;
    setLocalError('');
    try {
      await api(`/sessions/${id}/prompt`, 'POST', { text: draft.text });
    } catch (reason) {
      if (drafts.current.get(id)?.version === clearedVersion) updateDraft(id, draft.text);
      const uncertain = !(reason instanceof Error && 'status' in reason);
      setLocalError(
        `${selected.title}：${uncertain ? '提交结果尚未确认，请检查会话记录后决定是否再次发送。' : reason instanceof Error ? reason.message : '提交失败'}`,
      );
      if (currentSessionId.current === id) void host.open(id).catch(() => {});
    } finally {
      submitting.current.delete(id);
      renderDraft((n) => n + 1);
    }
  };
  if (
    connection === 'auth_required' ||
    connection === 'forbidden' ||
    ((connection === 'connecting' || connection === 'offline') && !sessionStorage.getItem('agent-connection-token'))
  )
    return (
      <main className="connect">
        <div className="connect-brand">
          Agent<span>个人工作空间</span>
        </div>
        <span className="section-kicker">连接工作区</span>
        <h1>连接 Agent</h1>
        <p>打开正在运行的 Agent Host，连接已有会话与后台任务。</p>
        <div className="host-address">
          <span>当前 Host</span>
          <code>{location.origin}</code>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!token.trim() || connection === 'connecting') return;
            void host
              .connect(token.trim())
              .then(() => setToken(''))
              .catch(() => {});
          }}
        >
          <label>
            连接令牌
            <input
              aria-label="连接令牌"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              required
            />
          </label>
          <button className="primary" type="submit" disabled={!token.trim() || connection === 'connecting'}>
            {connection === 'connecting' ? '正在连接…' : '连接 Agent'}
          </button>
        </form>
        {host.error && (
          <p role="alert" className="notice error">
            {host.error}
          </p>
        )}
        <details className="connection-help">
          <summary>如何连接已有 Host？</summary>
          <p>桌面端：从 Agent 菜单选择“在浏览器打开”，会自动连接同一个 Host。</p>
          <p>独立 Web：先启动 Host，再输入启动时设置的连接令牌。浏览器关闭后，Host 仍会继续已提交的任务。</p>
        </details>
      </main>
    );
  const currentDraft = selectedId ? (drafts.current.get(selectedId)?.text ?? '') : '';
  const project = selected?.cwd ?? '';
  return (
    <div className="shell" data-view={view.kind}>
      <div className="mobile-bar">
        <button type="button" aria-label="打开导航" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          ☰
        </button>
        <span>Agent</span>
        <small>{labels[connection]}</small>
      </div>
      {menu && <button type="button" className="sidebar-scrim" aria-label="关闭导航" onClick={() => setMenu(false)} />}
      <aside className={menu ? 'open' : ''}>
        <div className="brand">
          Agent<span>个人工作空间</span>
        </div>
        <button
          className="new-session"
          type="button"
          onClick={() =>
            leave(() => {
              expedite(selectedId);
              host.clearSelection();
              setView({ kind: 'chat' });
            })
          }
        >
          ＋ 新会话
        </button>
        <div className="nav-caption">会话</div>
        <nav aria-label="会话列表">
          {host.sessions.map((item) => (
            <button
              type="button"
              className={item.id === selectedId && view.kind === 'chat' ? 'selected' : ''}
              key={item.id}
              disabled={item.unavailable}
              title={item.error ?? item.cwd}
              onClick={() =>
                leave(() => {
                  void selectSession(item.id).catch((reason) =>
                    report(reason instanceof Error ? reason.message : '会话读取失败'),
                  );
                })
              }
            >
              <b>
                {item.busy && <span className="running-dot" />}
                {item.title}
              </b>
              <small>
                {item.unavailable ? item.error : item.busy ? '正在处理' : item.interrupted ? '上次运行中断' : item.cwd}
              </small>
            </button>
          ))}
          {!host.sessions.length && <p className="nav-empty">你的会话会保留在这里</p>}
        </nav>
        <div className="workspace-navigation">
          <div className="nav-caption">工作区</div>
          {(
            [
              ['skills', '能力管理'],
              ['memory', '记忆管理'],
              ['diagnostics', '历史日志'],
              ['reflection', '反思记录'],
              ['suggestions', `进化建议${attention ? ` · ${attention}` : ''}`],
              ['settings', '模型设置'],
            ] as const
          ).map(([kind, label]) => (
            <button
              type="button"
              className={view.kind === kind ? 'active' : ''}
              aria-current={view.kind === kind ? 'page' : undefined}
              key={kind}
              onClick={() => navigate({ kind })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="connection" data-connection={connection}>
          <span className="connection-dot" />
          {labels[connection]}
          {connection === 'offline' && (
            <button type="button" onClick={host.retry}>
              重试
            </button>
          )}
        </div>
      </aside>
      <main>
        {connection !== 'ready' && (
          <div className="connection-banner" role="status">
            <span>{labels[connection]} · 正在恢复 Host 状态，已提交任务不会重复执行。</span>
            <button type="button" onClick={host.retry}>
              重新连接
            </button>
          </div>
        )}
        {(localError || host.error) && (
          <div role="alert" className="notice error global-error">
            <span>{localError || host.error}</span>
            <button
              type="button"
              aria-label="关闭提示"
              onClick={() => {
                setLocalError('');
                host.setError('');
              }}
            >
              ×
            </button>
          </div>
        )}
        {view.kind === 'settings' ? (
          <ModelSettings
            api={api}
            providers={host.providers}
            ready={ready}
            onRefresh={host.refresh}
            onClose={() => navigate(returnView)}
          />
        ) : view.kind === 'skills' ? (
          <SkillsPanel
            api={api}
            initialId={view.id}
            initialKnowledgeRevision={view.knowledgeRevision}
            project={view.project ?? project}
            onClose={back}
            onActivity={(id) => {
              void api<{ sessionId: string }>(`/activities/${id}`)
                .then((a) => selectSession(a.sessionId))
                .catch((e) => report(e.message));
            }}
            onDirtyChange={(value) => {
              skillsDirty.current = value;
            }}
            onAssist={(value) =>
              leave(() => {
                if (!selectedId) {
                  report('先创建或选择用于讨论的会话，再从能力管理发起讨论。');
                  return;
                }
                updateDraft(selectedId, value);
                setView({ kind: 'chat' });
              })
            }
          />
        ) : view.kind === 'memory' ? (
          <MemoryPanel
            api={api}
            initialId={view.id}
            initialRevision={view.revision}
            project={view.project ?? project}
            onClose={back}
            onDirtyChange={(value) => {
              memoryDirty.current = value;
            }}
            onEvidence={(evidence) => navigate({ kind: 'diagnostics', evidence })}
          />
        ) : view.kind === 'diagnostics' ? (
          <DiagnosticsPanel
            key={`${view.session?.id ?? ''}:${view.evidence?.entryId ?? ''}`}
            api={api}
            session={view.session}
            initialEvidence={view.evidence}
            onClose={back}
          />
        ) : view.kind === 'reflection' ? (
          <ReflectionPanel
            api={api}
            session={selected}
            initialId={view.id}
            onClose={back}
            onEvidence={(evidence) => navigate({ kind: 'diagnostics', evidence })}
            onMemory={(id, revision, project) => navigate({ kind: 'memory', id, revision, project })}
            onSkill={(id, _revision, project, knowledgeRevision) =>
              navigate({ kind: 'skills', id, project, knowledgeRevision })
            }
            onSuggestion={(id) => navigate({ kind: 'suggestions', id })}
            onReflection={(id) => navigate({ kind: 'reflection', id })}
          />
        ) : view.kind === 'suggestions' ? (
          <SuggestionsPanel
            api={api}
            initialId={view.id}
            session={selected}
            onClose={back}
            onDiscuss={selectSession}
            onEvidence={(evidence) => navigate({ kind: 'diagnostics', evidence })}
            onMemory={(id, revision, project) => navigate({ kind: 'memory', id, revision, project })}
            onSkill={(id, knowledgeRevision, project) => navigate({ kind: 'skills', id, project, knowledgeRevision })}
            onReflection={(id) => navigate({ kind: 'reflection', id })}
          />
        ) : (
          <ChatView
            positions={scrollPositions.current}
            api={api}
            session={selected}
            selectedId={selectedId}
            models={host.models}
            ready={ready}
            draft={currentDraft}
            sending={selectedId ? submitting.current.has(selectedId) : false}
            onDraft={(text) => {
              if (selectedId) updateDraft(selectedId, text);
            }}
            onSend={() => void send()}
            onCreate={async (cwd, model) => {
              const epoch = navigationEpoch.current;
              const created = await api<{ id: string }>('/sessions', 'POST', {
                cwd,
                provider: model.provider,
                model: model.id,
              });
              await host.refresh();
              if (epoch === navigationEpoch.current) await host.open(created.id);
            }}
            onSettings={() => navigate({ kind: 'settings' })}
            onDiagnostics={() => {
              if (selected) navigate({ kind: 'diagnostics', session: { id: selected.id, title: selected.title } });
            }}
            onOpen={selectSession}
            onSkill={(id) => navigate({ kind: 'skills', id })}
            onReflection={() => navigate({ kind: 'reflection' })}
            onError={report}
          />
        )}
      </main>
    </div>
  );
}
