import type { ActivityService, EvolutionActivity } from '../../../../apps/host/evolution/activities';
import type { SkillRecord } from '../../../../apps/host/skills/skills';
import type { WorkspacePayload } from './host-data';

export type DevelopmentGrant = Parameters<ActivityService['authorize']>[1];
export const activityBusy = (a?: EvolutionActivity) => !!a && ['preparing', 'running', 'checking'].includes(a.status);

export function beginDiscussion(
  data: WorkspacePayload,
  input: { suggestionId: string; baseRevision: number } | { sessionId: string; goal: string },
  now = Date.now(),
): { data: WorkspacePayload; activity: EvolutionActivity } {
  const suggestion = 'suggestionId' in input ? data.suggestions.find((s) => s.id === input.suggestionId) : undefined;
  if ('suggestionId' in input && !suggestion) throw new Error('建议不存在或尚未载入。');
  if (suggestion?.status === 'adopted') {
    const activity = data.activities.find((a) => a.sessionId === suggestion.discussionSessionId);
    if (!activity) throw new Error('讨论会话尚未载入，请重新读取。');
    return { data, activity };
  }
  if (suggestion && 'baseRevision' in input) {
    if (suggestion.revision !== input.baseRevision) throw new Error('建议已变化，请重新读取后再进入讨论。');
    if (suggestion.status !== 'pending') throw new Error('这项建议已处理，请从列表发起新的讨论。');
  }
  const origin = 'sessionId' in input ? data.sessions.find((s) => s.id === input.sessionId) : undefined;
  if (!suggestion && !origin) throw new Error('请选择参考会话，再开始独立讨论。');
  const goal = suggestion?.goal ?? ('goal' in input ? input.goal.trim() : '');
  if (!goal || goal.length > 8000) throw new Error('讨论目标需要 1–8000 个字符。');
  const project = suggestion?.project ?? origin?.cwd ?? '/Users/person/Library/Application Support/Agent';
  const sessionId = suggestion?.discussionSessionId ?? crypto.randomUUID();
  const activity: EvolutionActivity = {
    id: crypto.randomUUID(),
    sessionId,
    project,
    goal,
    ...(suggestion ? { suggestionId: suggestion.id } : {}),
    status: 'discussion',
    revision: 1,
    created: now,
    updated: now,
    releases: [],
  };
  return {
    activity,
    data: {
      ...data,
      sessions: [
        ...data.sessions,
        {
          id: sessionId,
          title: suggestion?.title ?? goal.slice(0, 100),
          cwd: project,
          provider: origin?.provider ?? 'example',
          model: origin?.model ?? 'example-model',
          purpose: 'discussion',
          updated: now,
        },
      ],
      activities: [activity, ...data.activities],
      suggestions: data.suggestions.map((s) =>
        s.id === suggestion?.id
          ? {
              ...s,
              status: 'adopted',
              discussionSessionId: sessionId,
              revision: s.revision + 1,
              updated: now,
              discussionError: undefined,
            }
          : s,
      ),
    },
  };
}

export function grantDevelopment(
  a: EvolutionActivity,
  input: DevelopmentGrant,
  skills: SkillRecord[],
  now = Date.now(),
): EvolutionActivity {
  if (a.status !== 'discussion' || a.revision !== input.baseRevision) throw new Error('活动已变化，请重新读取后授权。');
  if (!input.goal.trim() || input.goal.trim().length > 8000) throw new Error('开发目标需要 1–8000 个字符。');
  if (!input.existingSkills.length && !input.newSkills.length) throw new Error('请选择允许修改或新建的技能。');
  if (input.existingSkills.length > 20 || input.newSkills.length > 20) throw new Error('每类授权范围最多包含 20 项。');
  if (
    new Set(input.existingSkills).size !== input.existingSkills.length ||
    new Set(input.newSkills).size !== input.newSkills.length
  )
    throw new Error('授权目标不能重复。');
  const workspace = `/Users/person/Library/Application Support/Agent/evolution/${a.id}`;
  const targets: NonNullable<EvolutionActivity['grant']>['targets'] = input.existingSkills.map((id) => {
    const s = skills.find((s) => s.id === id);
    if (!s) throw new Error('所选技能尚未载入。');
    if (s.project && s.project !== a.project) throw new Error('技能不属于当前项目。');
    return { key: id, name: s.name, skillId: id, baseRevision: s.revision, directory: `${workspace}/${id}` };
  });
  for (const name of input.newSkills) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(name))
      throw new Error('新技能名称须以小写字母开头，只含小写字母、数字和连字符，最多 64 个字符。');
    if (
      targets.some((t) => t.name === name) ||
      skills.some((s) => s.name === name && (!s.project || s.project === a.project))
    )
      throw new Error('新技能名称已存在。');
    targets.push({ key: name, name, directory: `${workspace}/${name}` });
  }
  return {
    ...a,
    revision: a.revision + 1,
    updated: now,
    status: 'preparing',
    grant: { id: crypto.randomUUID(), goal: input.goal.trim(), actor: 'user', at: now, targets },
  };
}

export function manageSuggestion(
  data: WorkspacePayload,
  id: string,
  baseRevision: number,
  status: 'ignored' | 'archived',
): WorkspacePayload {
  const current = data.suggestions.find((s) => s.id === id);
  if (!current) throw new Error('建议不存在或尚未载入。');
  if (current.revision !== baseRevision) throw new Error('建议已变化，请重新读取后再操作。');
  return {
    ...data,
    suggestions: data.suggestions.map((s) =>
      s.id === id
        ? { ...s, status, revision: s.status === status ? s.revision : s.revision + 1, updated: Date.now() }
        : s,
    ),
  };
}
