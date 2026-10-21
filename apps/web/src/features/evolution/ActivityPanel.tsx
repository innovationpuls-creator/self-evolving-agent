import { useEffect, useState } from 'react';
import type { EvolutionActivity } from '../../../../host/evolution/activities';
import type { SkillRecord } from '../../../../host/skills/skills';
import type { Session } from '../chat/session-state';
import './evolution.css';
type Api = <T>(path: string, method?: string, data?: unknown, signal?: AbortSignal) => Promise<T>;
const labels: Record<EvolutionActivity['status'], string> = {
  discussion: '讨论目标',
  preparing: '准备开发',
  running: '自主开发中',
  checking: '检查与生效中',
  completed: '已完成',
  failed: '未完成',
  cancelled: '已取消',
  interrupted: '运行中断',
};
export function ActivityPanel({
  api,
  session,
  ready,
  onOpen,
  onSkill,
  onError,
}: {
  api: Api;
  session: Session;
  ready: boolean;
  onOpen: (id: string) => Promise<void>;
  onSkill: (id: string) => void;
  onError: (message: string) => void;
}) {
  const [activity, setActivity] = useState<EvolutionActivity | undefined>(session.activity);
  const [goal, setGoal] = useState(session.activity?.goal ?? '');
  const [newSkills, setNewSkills] = useState('');
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [existing, setExisting] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<EvolutionActivity[]>([]);
  useEffect(() => {
    let alive = true,
      epoch = 0;
    const refresh = () => {
      const request = ++epoch;
      void api<EvolutionActivity[]>('/activities')
        .then((items) => {
          if (alive && request === epoch) {
            setActivity(items.find((a) => a.sessionId === session.id));
            setHistory(items.filter((a) => a.project === session.cwd));
          }
        })
        .catch((e) => {
          if (alive) onError(e.message);
        });
    };
    refresh();
    window.addEventListener('agent-suggestions-changed', refresh);
    window.addEventListener('agent-reconnected', refresh);
    return () => {
      alive = false;
      window.removeEventListener('agent-suggestions-changed', refresh);
      window.removeEventListener('agent-reconnected', refresh);
    };
  }, [api, session.id, session.cwd, onError]);
  useEffect(() => {
    if (!activity || activity.status !== 'discussion') return;
    let alive = true;
    void api<{ skills: SkillRecord[] }>(`/skills?project=${encodeURIComponent(session.cwd)}`)
      .then((x) => {
        if (alive) setSkills(x.skills);
      })
      .catch((e) => {
        if (alive) onError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [api, activity?.id, activity?.status, session.cwd, onError]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError(e instanceof Error ? e.message : '活动操作未完成');
    } finally {
      setBusy(false);
    }
  };
  if (!activity)
    return (
      <details className="activity-panel" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>能力目标与开发活动</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const a = await api<EvolutionActivity>('/activities', 'POST', { sessionId: session.id, goal });
              await onOpen(a.sessionId);
            });
          }}
        >
          <label>
            希望获得的能力
            <textarea
              aria-label="能力目标"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              required
              maxLength={8000}
            />
          </label>
          <button type="submit" disabled={!ready || busy || !goal.trim()}>
            进入独立讨论
          </button>
        </form>
        {history.length > 0 && (
          <ul>
            {history.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => void run(() => onOpen(a.sessionId))}>
                  {a.goal.slice(0, 100)} · {labels[a.status]}
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>
    );
  return (
    <section className="activity-panel" aria-label="能力开发活动">
      <header>
        <strong>{labels[activity.status]}</strong>
        <span>{activity.goal}</span>
      </header>
      {activity.status === 'discussion' ? (
        <details>
          <summary>确认开发范围</summary>
          <p>讨论明确后，在这里授权具体目标。检查通过的版本会自动生效。</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                setActivity(
                  await api<EvolutionActivity>(`/activities/${activity.id}/authorize`, 'POST', {
                    baseRevision: activity.revision,
                    goal: goal || activity.goal,
                    existingSkills: existing,
                    newSkills: newSkills.split(/[\s,，]+/).filter(Boolean),
                  }),
                );
              });
            }}
          >
            <label>
              授权目标与限制
              <textarea
                aria-label="授权目标与限制"
                value={goal || activity.goal}
                onChange={(e) => setGoal(e.target.value)}
                required
                maxLength={8000}
              />
            </label>
            {skills.length > 0 && (
              <fieldset>
                <legend>允许改进的已有能力</legend>
                {skills.map((s) => (
                  <label className="activity-choice" key={s.id}>
                    <input
                      type="checkbox"
                      checked={existing.includes(s.id)}
                      onChange={(e) =>
                        setExisting(e.target.checked ? [...existing, s.id] : existing.filter((id) => id !== s.id))
                      }
                    />
                    {s.name}
                    {!s.current && '（未生效候选）'}
                  </label>
                ))}
              </fieldset>
            )}
            <label>
              允许创建的能力名称
              <input
                aria-label="允许创建的能力名称"
                placeholder="例如 document-diff，多个名称用空格分隔"
                value={newSkills}
                onChange={(e) => setNewSkills(e.target.value)}
              />
            </label>
            <p>
              开发使用本机原生 Shell，可安装依赖并运行代码，具有当前用户权限。候选目录与版本检查不提供系统沙箱隔离。
            </p>
            <button
              className="primary"
              type="submit"
              disabled={!ready || busy || session.busy || (!existing.length && !newSkills.trim())}
            >
              授权并开始开发
            </button>
          </form>
        </details>
      ) : (
        activity.grant && (
          <details>
            <summary>查看授权范围</summary>
            <p>{activity.grant.goal}</p>
            <ul>
              {activity.grant.targets.map((t) => (
                <li key={t.key}>
                  {t.name}
                  <code>{t.directory}</code>
                </li>
              ))}
            </ul>
            <small>{new Date(activity.grant.at).toLocaleString('zh-CN')}</small>
          </details>
        )
      )}
      {activity.error && <p role="alert">{activity.error}</p>}
      {activity.result && (
        <p className="activity-result">
          {activity.result.summary}
          {!activity.result.packages.length && '（无代码成果）'}
        </p>
      )}
      {activity.releases.length > 0 && (
        <ul>
          {activity.releases.map((r) => (
            <li key={r.operationId}>
              <button type="button" onClick={() => onSkill(r.skillId)}>
                查看能力版本与回退
              </button>
              <code>{r.version}</code>
            </li>
          ))}
        </ul>
      )}
      {['discussion', 'preparing', 'running', 'checking'].includes(activity.status) && (
        <button
          type="button"
          disabled={!ready || busy}
          onClick={() =>
            void run(async () => {
              setActivity(await api(`/activities/${activity.id}/cancel`, 'POST', {}));
            })
          }
        >
          取消活动
        </button>
      )}
    </section>
  );
}
