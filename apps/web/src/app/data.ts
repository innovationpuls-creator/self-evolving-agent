import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReflectionApi } from '../features/reflection/reflection-state';
import type { ReflectionJob } from '../../../host/reflection/reflection-jobs';
import type { ReflectionRecord } from '../../../host/reflection/reflection-service';
import type { MemoryService } from '../../../host/memory/memory';
import type { AgentService } from '../../../host/runtime/agent';
import type { EvolutionSuggestion } from '../../../host/evolution/evolution';

export type Api = ReflectionApi;
export type Detail = { job: ReflectionJob; record?: ReflectionRecord };
export type MemoryDetail = ReturnType<MemoryService['get']>;
export type SkillDetail = Awaited<ReturnType<AgentService['skillDetail']>>;
export type ResultTarget =
  | { kind: 'memory'; id: string; project: string; revision?: number }
  | { kind: 'suggestion'; id: string }
  | { kind: 'skill'; id: string; knowledgeRevision?: string; file?: string; version?: string };
export type ResultData = MemoryDetail | EvolutionSuggestion | SkillDetail;
export function detailPath(jobId: string, recordId?: string) {
  return recordId ? `/reflections/${encodeURIComponent(recordId)}` : `/reflections/jobs/${encodeURIComponent(jobId)}`;
}
export function resultPath(target: ResultTarget) {
  if (target.kind === 'memory')
    return `/memory/${encodeURIComponent(target.id)}?${new URLSearchParams({ project: target.project, includeHistory: 'true' })}`;
  return `/${target.kind === 'suggestion' ? 'suggestions' : 'skills'}/${encodeURIComponent(target.id)}`;
}
export function useRead<T>(api: Api, path: string, events: string[] = []) {
  const [loaded, setLoaded] = useState<{ path: string; value: T }>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const epoch = useRef(0);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  const eventKey = events.join(',');
  useEffect(() => {
    const names = ['agent-reconnected', ...eventKey.split(',').filter(Boolean)];
    for (const name of names) window.addEventListener(name, refresh);
    return () => {
      for (const name of names) window.removeEventListener(name, refresh);
    };
  }, [eventKey, refresh]);
  useEffect(() => {
    const generation = ++epoch.current;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void api<T>(path, 'GET', undefined, controller.signal)
      .then((value) => {
        if (generation === epoch.current) setLoaded({ path, value });
      })
      .catch((reason: unknown) => {
        if (generation === epoch.current) setError(reason instanceof Error ? reason.message : '读取失败');
      })
      .finally(() => {
        if (generation === epoch.current) setLoading(false);
      });
    return () => {
      epoch.current++;
      controller.abort();
    };
  }, [api, path, revision]);
  // A failed refresh cannot leave stale content looking current.
  return { value: !error && loaded?.path === path ? loaded.value : undefined, loading, error, refresh };
}
