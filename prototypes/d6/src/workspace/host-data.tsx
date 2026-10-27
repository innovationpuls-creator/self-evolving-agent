/// <reference lib="es2023.array" />
import { createContext, useContext, useState, useRef, useEffect, type ReactNode } from 'react';
import type { SkillRecord } from '../../../../apps/host/skills/skills';
import type { Session } from '../state/model';
import type { MemoryView } from '../../../../apps/host/memory/memory';
import type { ReflectionRecord, SessionRecord } from '../../../../apps/host/reflection/reflection-service';
import type { ReflectionJob } from '../../../../apps/host/reflection/reflection-jobs';
import type { EvolutionSuggestion, EvolutionEvidence } from '../../../../apps/host/evolution/evolution';
import type { EvolutionActivity } from '../../../../apps/host/evolution/activities';
import { useDemo } from '../state/store';
import { projectMemory, reviseMemory, type MemoryCommand } from './memory-model';
import {
  createWorkspaceFixtures,
  createStressFixtures,
  fixtureAliases,
  loadedDemoSessions,
  fixtureProjects,
  project as agentProject,
  researchProject,
  uid,
} from './host-fixtures';
import { activityBusy } from './evolution-model';

export type { MemoryView, ReflectionRecord, ReflectionJob, EvolutionSuggestion, EvolutionEvidence, EvolutionActivity };
export interface MemoryDetail {
  current: MemoryView;
  history: MemoryView[];
}
export interface ReflectionDetail {
  job: ReflectionJob;
  record?: ReflectionRecord;
}
export interface WorkspacePayload {
  memories: MemoryDetail[];
  reflections: ReflectionDetail[];
  suggestions: EvolutionSuggestion[];
  activities: EvolutionActivity[];
  sessions: SessionRecord[];
}
function useWorkspaceStore() {
  const x = useDemo();
  const [sessionChoice, chooseSession] = useState('follow');
  const [projectChoice, chooseProject] = useState('follow');
  const [data, setData] = useState<WorkspacePayload>(createWorkspaceFixtures);
  const normalData = useRef<WorkspacePayload | undefined>(undefined);
  useEffect(() => {
    if (x.mode === 'quiet' && x.scenario === 'long' && !normalData.current) {
      normalData.current = data;
      setData(createStressFixtures(data, 240));
    } else if (x.scenario !== 'long' && normalData.current) {
      setData(normalData.current);
      normalData.current = undefined;
    }
  }, [x.scenario]);
  const current = useRef(data);
  current.current = data;
  const changeData = (fn: (data: WorkspacePayload) => WorkspacePayload) => {
    const next = fn(current.current);
    current.current = next;
    setData(next);
    return next;
  };
  const [threads, setThreads] = useState<Record<string, NonNullable<Session['transcript']>>>({});
  const [discussionDrafts, setDiscussionDrafts] = useState<Record<string, string>>({});
  const skillAuthority = useRef<
    Record<string, { signature: string; record: SkillRecord; versions: Record<number, string> }>
  >({});
  const candidates = useRef<Record<string, { signature: string; version: string; digest: string }>>({});
  for (const [index, skill] of x.d.skills.entries()) {
    const signature = JSON.stringify([
      skill.enabled,
      skill.version,
      skill.versions,
      skill.content,
      skill.code,
      skill.candidate,
      skill.candidateFile,
    ]);
    if (skill.candidate) {
      const candidateSignature = JSON.stringify([skill.candidateFile, skill.candidate, skill.content, skill.code]);
      if (candidates.current[skill.id]?.signature !== candidateSignature)
        candidates.current[skill.id] = {
          signature: candidateSignature,
          version: crypto.randomUUID(),
          // Opaque mock Host response. Real digest also covers runtime, file modes and dependencies.
          digest: Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join(
            '',
          ),
        };
    } else delete candidates.current[skill.id];
    let entry = skillAuthority.current[skill.id];
    if (!entry) {
      const id = skill.id === 'text-diff' ? uid(407) : index < 3 ? uid(701 + index) : crypto.randomUUID();
      entry = {
        signature,
        versions: {},
        record: {
          id,
          name: skill.name,
          description: skill.description,
          source: `/Users/person/Skills/${skill.name}`,
          project: skill.id === 'research-notes' ? researchProject : agentProject,
          enabled: skill.enabled,
          revision: 1,
          latest: crypto.randomUUID(),
        },
      };
      skillAuthority.current[skill.id] = entry;
    }
    for (const v of skill.versions) entry.versions[v] ??= crypto.randomUUID();
    if (entry.signature !== signature) {
      entry.record = { ...entry.record, enabled: skill.enabled, revision: entry.record.revision + 1 };
      entry.signature = signature;
    }
    entry.record.current = entry.versions[skill.version];
    entry.record.latest =
      candidates.current[skill.id]?.version ?? entry.versions[Math.max(...skill.versions)] ?? entry.record.latest;
  }
  const [memoryRequest, requestMemory] = useState<{ id: string; revision?: number; project?: string }>();
  const resolve = (kind: keyof typeof fixtureAliases, id: string) => fixtureAliases[kind][id] ?? id;
  const saveMemory = (value: MemoryView) =>
    setData((d) => ({
      ...d,
      memories: d.memories.some((m) => m.current.id === value.id)
        ? d.memories.map((m) =>
            m.current.id === value.id
              ? {
                  current: value,
                  history: [value, ...m.history.map((r) => ({ ...r, isCurrent: false, usable: false }))],
                }
              : m,
          )
        : [...d.memories, { current: value, history: [value] }],
    }));
  const sessionId =
    sessionChoice === 'follow'
      ? (Object.entries(loadedDemoSessions).find(([, id]) => id === x.sid)?.[0] ?? x.sid)
      : sessionChoice;
  const contextSession = data.sessions.find((s) => s.id === sessionId);
  const project =
    projectChoice === 'follow' ? contextSession?.cwd : projectChoice === 'global' ? undefined : projectChoice;
  const projects = [...new Set(data.sessions.map((s) => s.cwd))].filter(Boolean);
  const projectKey = project ? fixtureProjects[project] : undefined;
  const memories = data.memories.flatMap((m) => {
    const projected = projectMemory(m, projectKey);
    return projected ? [projected] : [];
  });
  const editMemory = (id: string, input: MemoryCommand) => {
    const old = data.memories.find((m) => m.current.id === id)?.current;
    if (!old) throw new Error('记忆未载入。');
    const value = reviseMemory(old, input, projectKey);
    saveMemory(value);
    return value;
  };
  const runDevelopment = async (id: string, outcome: string) => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const patchActivity = (patch: Partial<EvolutionActivity>) =>
      changeData((d) => ({
        ...d,
        activities: d.activities.map((a) =>
          a.id === id && activityBusy(a) ? { ...a, ...patch, revision: a.revision + 1, updated: Date.now() } : a,
        ),
      }));
    await wait(350);
    if (!activityBusy(current.current.activities.find((a) => a.id === id))) return;
    patchActivity({ status: 'running' });
    await wait(1100);
    const a = current.current.activities.find((a) => a.id === id);
    if (!a?.grant || !activityBusy(a)) return;
    if (outcome === 'nochange') {
      patchActivity({ status: 'completed', result: { summary: '核对后没有提交技能候选。', packages: [] } });
      return;
    }
    const packages = a.grant.targets.map((t) => ({
      target: t.key,
      skillFile: 'SKILL.md',
      extensions: [],
      knowledgeFiles: [],
      probes: [],
    }));
    patchActivity({ status: 'checking', result: { summary: '候选已提交，等待必要检查。', packages } });
    await wait(1100);
    if (!activityBusy(current.current.activities.find((a) => a.id === id))) return;
    if (outcome === 'failure') {
      patchActivity({ status: 'failed', error: '候选的必要检查未通过。', releases: [] });
      return;
    }
    const releases: EvolutionActivity['releases'] = [];
    const updates: Record<string, { version: number; content: string; name: string }> = {};
    for (const target of a.grant.targets) {
      const localId = Object.keys(skillAuthority.current).find(
        (key) => skillAuthority.current[key].record.id === target.skillId,
      );
      const entry = localId && skillAuthority.current[localId];
      if (entry && entry.record.revision !== target.baseRevision) {
        patchActivity({ status: 'failed', error: '授权后技能已变化，未发布新的版本。' });
        return;
      }
      const local = x.d.skills.find((s) => s.id === localId);
      const version = Math.max(...(local?.versions ?? [0])) + 1;
      const versionId = crypto.randomUUID();
      const skillId = target.skillId ?? crypto.randomUUID();
      if (entry) entry.versions[version] = versionId;
      else
        skillAuthority.current[target.name] = {
          signature: '',
          versions: { [version]: versionId },
          record: {
            id: skillId,
            name: target.name,
            source: target.directory,
            project: a.project,
            description: a.grant.goal,
            enabled: true,
            revision: 1,
            current: versionId,
            latest: versionId,
          },
        };
      updates[localId || target.name] = {
        version,
        name: target.name,
        content: `${local?.content ?? `# ${target.name}`}\n\n${a.grant.goal}`,
      };
      releases.push({ skillId, version: versionId, operationId: crypto.randomUUID() });
    }
    x.mutate((d) => {
      const skills = d.skills.map((s) => {
        const update = updates[s.id];
        if (!update) return s;
        return {
          ...s,
          content: update.content,
          enabled: true,
          trusted: true,
          version: update.version,
          versions: [...s.versions, update.version],
          snapshots: {
            ...s.snapshots,
            [s.version]: { content: s.content, code: s.code },
            [update.version]: { content: update.content, code: s.code },
          },
        };
      });
      for (const [key, value] of Object.entries(updates))
        if (!skills.some((s) => s.id === key))
          skills.push({
            id: key,
            name: value.name,
            description: a.grant?.goal ?? '',
            enabled: true,
            extension: false,
            trusted: true,
            version: value.version,
            versions: [value.version],
            candidate: '',
            content: value.content,
          });
      return { ...d, skills };
    });
    patchActivity({
      status: 'completed',
      result: { summary: '候选已通过必要检查，并保存发布记录。', packages },
      releases,
    });
  };
  return {
    data,
    setData,
    current,
    changeData,
    runDevelopment,
    threads,
    setThreads,
    discussionDrafts,
    setDiscussionDrafts,
    bindPublishedVersion: (id: string, ordinal: number, version: string) => {
      const entry = skillAuthority.current[id];
      if (entry) entry.versions[ordinal] = version;
    },
    candidateBindings: { ...candidates.current },
    skillBindings: Object.fromEntries(Object.entries(skillAuthority.current).map(([id, entry]) => [id, entry.record])),
    skillVersions: Object.fromEntries(
      Object.entries(skillAuthority.current).map(([id, entry]) => [id, entry.versions]),
    ),
    resolve,
    saveMemory,
    memoryRequest,
    requestMemory,
    memories,
    editMemory,
    project,
    projectKey,
    projectChoice,
    chooseProject,
    projects,
    sessionChoice,
    chooseSession,
    contextSession,
  };
}
const Context = createContext<ReturnType<typeof useWorkspaceStore> | null>(null);
export function WorkspaceDataProvider({ children }: { children: ReactNode }) {
  const value = useWorkspaceStore();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useWorkspaceData() {
  const value = useContext(Context);
  if (!value) throw new Error('Missing WorkspaceDataProvider');
  return value;
}
export const formatDate = (time: number) =>
  new Date(time).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
export const actorName = { agent: 'Agent', user: '用户', system: '系统' };
export const memoryKind = { fact: '事实', experience: '经验', decision: '决定', hypothesis: '待核实' };
export const memoryState = (r: MemoryView) =>
  r.status === 'deleted'
    ? '已移除'
    : r.status === 'withdrawn'
      ? '已撤销'
      : !r.isCurrent
        ? '历史修订'
        : r.unavailable
          ? '来源待恢复'
          : r.usable
            ? '当前记忆'
            : '当前不可用';
export const reflectionState: Record<ReflectionJob['status'], string> = {
  pending: '等待检查',
  running: '正在检查',
  waiting_user: '检查等待处理',
  succeeded: '检查已完成',
  failed: '检查失败',
  interrupted: '检查已中断',
};
export const suggestionState: Record<EvolutionSuggestion['status'], string> = {
  pending: '待决定',
  adopted: '已进入讨论',
  ignored: '已忽略',
  archived: '已归档',
};
export function activityState(a: EvolutionActivity) {
  const labels = {
    discussion: '尚未授权开发',
    preparing: '正在准备开发',
    running: '正在调查与开发',
    checking: '正在检查候选',
    completed: a.releases.length ? '开发结束，已有版本发布' : '开发结束，未记录版本发布',
    failed: '开发或检查失败',
    cancelled: '开发已取消',
    interrupted: '开发已中断',
  };
  return labels[a.status];
}
// Saved text is never rewritten into a factual headline by the renderer.
export function reflectionHeadline(detail: ReflectionDetail) {
  const text = detail.record?.summary.trim();
  if (detail.job.status !== 'succeeded') return reflectionState[detail.job.status];
  return text && text.length <= 64 && !text.includes('\n')
    ? text
    : text
      ? '已保存的检查结论'
      : '检查已完成，未保存结论';
}

export { useWorkspacePosition } from './navigation';
