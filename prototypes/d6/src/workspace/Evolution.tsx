import { measureWorkspace } from './quality-probe';
import { useEffect, useState, useRef } from 'react';
import { ArrowUp, ShieldCheck, LoaderCircle } from 'lucide-react';
import { Button, Field, Modal, Notice, StateGate } from '../components/ui';
import { Markdown } from '../components/content';
import { Evidence } from './content';
import { EvolutionRecords, ActivityOutcome } from './EvolutionRecords';
import { useWorkspaceData, useWorkspacePosition, type EvolutionSuggestion } from './host-data';
import { useDemo } from '../state/store';
import { WorkspacePage, Heading, Return, skillName, workspaceStateMessages } from './shared';
import { projectName } from './Context';
import './evolution.css';
import { beginDiscussion, grantDevelopment, activityBusy } from './evolution-model';

// Stored replies for the local conversation fixture; they do not report execution or inspection.
const discussionReplies = [
  '先核对已有技能是否已经覆盖这个行为。请提供一个不符合预期的输出，或明确希望保留的行为；确定差距后再决定是否修改。',
  '这条约束会保留在讨论中。授权前请将最终要实现的目标写入开发授权，并选择允许改动的技能。讨论消息本身不会扩大授权范围。',
  '可以继续补充例子、约束或验收条件。开发只以单独批准的目标和技能范围为准。',
];

function EvolutionPage() {
  const x = useDemo(),
    w = useWorkspaceData();
  const connected = useRef(x.d.connection);
  connected.current = x.d.connection;
  const [view, VIEW] = useState<'records' | 'discussion'>('records');
  const [activityId, ID] = useState<string>();
  const [busy, BUSY] = useState(false),
    [error, ERROR] = useState('');
  const [grant, GRANT] = useState(false),
    [grantBase, BASE] = useState(0);
  const [goal, GOAL] = useState(''),
    [targets, TARGETS] = useState<string[]>([]),
    [newSkills, NEW] = useState('');
  const [grantError, GE] = useState(''),
    [raw, RAW] = useState(false);
  useWorkspacePosition('evolution', `${view}:${activityId}`, view === 'discussion');
  const activity = w.data.activities.find((a) => a.id === activityId);
  const proposal = w.data.suggestions.find((s) => s.id === activity?.suggestionId);
  const sessionId = activity?.sessionId ?? 'new';
  const draft = w.discussionDrafts[sessionId] ?? '';
  const messages = w.threads[sessionId] ?? [];
  const composer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (x.page === 'evolution' && view === 'discussion' && messages.length)
      composer.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);
  const title = proposal?.title ?? activity?.goal ?? '发起改进讨论';
  const setDraft = (text: string) => w.setDiscussionDrafts((all) => ({ ...all, [sessionId]: text }));
  const openActivity = (id: string) => {
    ID(id);
    ERROR('');
    VIEW('discussion');
  };
  useEffect(() => {
    if (x.focusRequest.type === 'evolution') VIEW('records');
  }, [x.focusRequest]);
  const discuss = async (suggestion?: EvolutionSuggestion) => {
    ERROR('');
    if (!suggestion) {
      ID(undefined);
      VIEW('discussion');
      return;
    }
    BUSY(true);
    try {
      if (!x.d.connection) throw new Error('连接已断开，请重新连接后进入讨论。');
      await new Promise((resolve) => setTimeout(resolve, 180));
      if (!connected.current) throw new Error('连接已断开，尚未进入讨论。恢复连接后再试。');
      let id = '';
      w.changeData((data) => {
        const next = beginDiscussion(data, { suggestionId: suggestion.id, baseRevision: suggestion.revision });
        id = next.activity.id;
        return next.data;
      });
      openActivity(id);
    } catch (e) {
      ERROR((e as Error).message);
    } finally {
      BUSY(false);
    }
  };
  const send = async () => {
    if (!draft.trim() || busy || activityBusy(activity) || !x.d.connection) return;
    BUSY(true);
    ERROR('');
    try {
      let sid = sessionId;
      if (!activity) {
        const origin = w.contextSession;
        if (!origin) throw new Error('请选择参考会话，再开始独立讨论。');
        w.changeData((data) => {
          const next = beginDiscussion(data, { sessionId: origin.id, goal: draft.trim() });
          sid = next.activity.sessionId;
          ID(next.activity.id);
          return next.data;
        });
      }
      const text = draft.trim();
      w.setDiscussionDrafts((all) => ({ ...all, [sessionId]: '', [sid]: '' }));
      w.setThreads((all) => ({ ...all, [sid]: [...(all[sid] ?? []), { role: 'user', text }] }));
      await new Promise((resolve) => setTimeout(resolve, 650));
      if (!connected.current)
        throw new Error('连接已断开，尚未收到回复。消息已保留，重连后请先核对会话，避免重复发送。');
      const answer =
        discussionReplies[Math.min(messages.filter((m) => m.role === 'user').length, discussionReplies.length - 1)];
      w.setThreads((all) => ({ ...all, [sid]: [...(all[sid] ?? []), { role: 'assistant', text: answer }] }));
    } catch (e) {
      ERROR((e as Error).message);
    } finally {
      BUSY(false);
    }
  };
  const available = Object.entries(w.skillBindings).filter(([, s]) => !s.project || s.project === activity?.project);
  const authorize = () => {
    if (!activity || !x.d.connection) return;
    try {
      const input = {
        baseRevision: grantBase,
        goal,
        existingSkills: targets,
        newSkills: newSkills.split(/[\s,，]+/).filter(Boolean),
      };
      w.changeData((data) => ({
        ...data,
        activities: data.activities.map((a) =>
          a.id === activity.id ? grantDevelopment(a, input, Object.values(w.skillBindings)) : a,
        ),
      }));
      GRANT(false);
      void w.runDevelopment(activity.id, x.outcome);
    } catch (e) {
      GE((e as Error).message);
    }
  };
  return (
    <StateGate
      messages={workspaceStateMessages.evolution}
      emptyAction={
        <Button
          onClick={() => {
            x.setScenario('normal');
            void discuss();
          }}
        >
          发起改进讨论
        </Button>
      }
    >
      <WorkspacePage page="evolution">
        {error && (
          <div role="alert">
            <Notice tone="warn" title="操作未完成">
              {error}
            </Notice>
          </div>
        )}
        <div hidden={view !== 'records'}>
          <EvolutionRecords onDiscuss={discuss} onActivity={openActivity} busy={busy} active={view === 'records'} />
        </div>
        {view === 'discussion' && (
          <>
            <Return onClick={() => VIEW('records')}>改进建议</Return>
            <Heading
              title={title}
              description={activity ? `${projectName(activity.project)} · 独立讨论` : undefined}
              action={
                activity?.status === 'discussion' && (
                  <Button
                    disabled={busy || !x.d.connection}
                    onClick={() => {
                      GOAL(activity.goal);
                      BASE(activity.revision);
                      TARGETS([]);
                      NEW('');
                      GE('');
                      RAW(false);
                      GRANT(true);
                    }}
                  >
                    <ShieldCheck size={15} />
                    审阅开发授权
                  </Button>
                )
              }
            />
            <div className="ae-conversation">
              {proposal && (
                <details className="ae-discussion-context">
                  <summary>查看原建议</summary>
                  <p>{proposal.reason}</p>
                  <blockquote>{proposal.goal}</blockquote>
                  {proposal.uncertainty && <p className="aw-muted">{proposal.uncertainty}</p>}
                </details>
              )}
              {activity && activity.status !== 'discussion' && (
                <ActivityOutcome
                  activity={activity}
                  onCancel={
                    activityBusy(activity)
                      ? () => {
                          w.changeData((data) => ({
                            ...data,
                            activities: data.activities.map((a) =>
                              a.id === activity.id && activityBusy(a)
                                ? {
                                    ...a,
                                    status: 'cancelled',
                                    revision: a.revision + 1,
                                    updated: Date.now(),
                                    error: '用户取消；已产生的变更不会自动回退。',
                                  }
                                : a,
                            ),
                          }));
                        }
                      : undefined
                  }
                />
              )}
              <section className="ae-messages" aria-label="改进讨论" aria-live="polite">
                {!messages.length && (
                  <div className="ae-conversation-start">
                    {activity ? (
                      <>
                        <p>{activity.goal}</p>
                        <span>从例子、约束或需要核对的内容开始。</span>
                      </>
                    ) : (
                      <p>你希望 Agent 改变什么行为？</p>
                    )}
                  </div>
                )}
                {messages.map((m, index) => (
                  <article key={`${sessionId}-${index}`} className={`ae-message ${m.role}`}>
                    <strong>{m.role === 'user' ? '你' : 'Agent'}</strong>
                    <Markdown text={m.text} />
                  </article>
                ))}
                {busy && view === 'discussion' && (
                  <p className="ae-thinking" role="status">
                    <LoaderCircle size={14} className="spin" />
                    正在回复…
                  </p>
                )}
              </section>
              <div className="ae-composer" ref={composer}>
                {!activity && (
                  <label className="ae-origin">
                    参考会话
                    <select
                      aria-label="讨论参考会话"
                      value={w.sessionChoice}
                      onChange={(e) => w.chooseSession(e.target.value)}
                    >
                      <option value="follow">
                        当前会话{w.contextSession ? ` · ${w.contextSession.title}` : ' · 未选择'}
                      </option>
                      <option value="">不选择会话</option>
                      {w.data.sessions
                        .filter((s) => s.purpose === 'chat')
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.title} · {projectName(s.cwd)}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <textarea
                  aria-label="讨论消息"
                  placeholder="继续讨论…"
                  value={draft}
                  disabled={activityBusy(activity)}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <div className="ae-compose-actions">
                  <small>{activityBusy(activity) ? '开发执行中' : '讨论不授予开发权限'}</small>
                  <Button
                    kind="primary"
                    aria-label="发送讨论消息"
                    disabled={
                      !draft.trim() ||
                      busy ||
                      activityBusy(activity) ||
                      !x.d.connection ||
                      (!activity && !w.contextSession)
                    }
                    onClick={() => void send()}
                  >
                    <ArrowUp size={16} />
                    发送
                  </Button>
                </div>
              </div>
              {activity && (
                <details className="ae-session-record">
                  <summary>会话与活动记录</summary>
                  <Evidence value={{ sessionId: activity.sessionId, activity }} />
                </details>
              )}
            </div>
          </>
        )}
        <Modal
          open={grant}
          onClose={() => GRANT(false)}
          title="授权这次开发"
          className="ae-grant-dialog"
          footer={
            <>
              <Button onClick={() => GRANT(false)}>取消</Button>
              <Button
                kind="primary"
                disabled={!goal.trim() || (!targets.length && !newSkills.trim()) || !x.d.connection || busy}
                onClick={authorize}
              >
                批准并开始开发
              </Button>
            </>
          }
        >
          <Field label="开发目标">
            <textarea value={goal} maxLength={8000} onChange={(e) => GOAL(e.target.value)} rows={3} />
          </Field>
          <fieldset className="ae-grant-targets">
            <legend>允许修改的技能</legend>
            {available.length ? (
              available.map(([local, s]) => (
                <label key={s.id}>
                  <input
                    type="checkbox"
                    checked={targets.includes(s.id)}
                    onChange={(e) =>
                      TARGETS((all) => (e.target.checked ? [...all, s.id] : all.filter((id) => id !== s.id)))
                    }
                  />
                  <span>
                    <strong>{skillName(local)}</strong>
                    <small>{s.name}</small>
                  </span>
                </label>
              ))
            ) : (
              <p>这个项目没有可修改的已载入技能。</p>
            )}
          </fieldset>
          <details className="ae-new-target">
            <summary>允许新建技能</summary>
            <Field label="新技能名称">
              <input
                value={newSkills}
                placeholder="例如 release-report，多个名称用逗号分隔"
                onChange={(e) => NEW(e.target.value)}
              />
            </Field>
          </details>
          <Notice tone="warn" title="Agent 将执行开发与检查">
            可调用 Host 工具、运行检查命令，并在检查通过后尝试发布所选技能。执行使用 Host
            本机用户权限；取消不会撤销已经发生的外部操作。
          </Notice>
          {grantError && (
            <p className="field-error" role="alert">
              {grantError}
            </p>
          )}
          <Button kind="ghost" onClick={() => RAW(!raw)}>
            查看授权请求
          </Button>
          {raw && (
            <Evidence
              value={{
                baseRevision: grantBase,
                goal,
                existingSkills: targets,
                newSkills: newSkills.split(/[\s,，]+/).filter(Boolean),
              }}
            />
          )}
        </Modal>
      </WorkspacePage>
    </StateGate>
  );
}

export const WorkspaceEvolution = measureWorkspace('evolution', EvolutionPage);
