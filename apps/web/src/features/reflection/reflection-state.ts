import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReflectionJob, ReflectionJobStatus } from '../../../../host/reflection/reflection-jobs';
import type { ReflectionRecord } from '../../../../host/reflection/reflection-service';

export type ReflectionApi = <T>(path: string, method?: string, data?: unknown, signal?: AbortSignal) => Promise<T>;
export interface ReflectionCatalog {
  records: ReflectionRecord[];
  jobs: ReflectionJob[];
  availability: { available: boolean; reason?: string };
}
export const reflectionStatusLabels: Record<ReflectionJobStatus, string> = {
  pending: '等待中',
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  interrupted: '已中断',
  waiting_user: '需要处理',
};

export function useReflectionCatalog(api: ReflectionApi, sessionId?: string) {
  const scope = sessionId ?? '';
  const [loaded, setLoaded] = useState<{ scope: string; catalog: ReflectionCatalog }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const epoch = useRef(0);
  const owner = useRef({ api, scope });
  if (owner.current.api !== api || owner.current.scope !== scope) {
    epoch.current++;
    owner.current = { api, scope };
  }
  const refresh = useCallback(() => {
    epoch.current++;
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    window.addEventListener('agent-reflection-changed', refresh);
    window.addEventListener('agent-reconnected', refresh);
    return () => {
      epoch.current++;
      window.removeEventListener('agent-reflection-changed', refresh);
      window.removeEventListener('agent-reconnected', refresh);
    };
  }, [refresh]);

  useEffect(() => {
    const generation = ++epoch.current;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const query = sessionId ? `?${new URLSearchParams({ sessionId })}` : '';
    void api<ReflectionCatalog>(`/reflections${query}`, 'GET', undefined, controller.signal)
      .then((catalog) => {
        if (generation === epoch.current) setLoaded({ scope, catalog });
      })
      .catch((reason: unknown) => {
        if (generation === epoch.current) setError(reason instanceof Error ? reason.message : '反思状态读取失败');
      })
      .finally(() => {
        if (generation === epoch.current) setLoading(false);
      });
    return () => {
      epoch.current++;
      controller.abort();
    };
  }, [api, scope, sessionId, revision]);

  return { catalog: loaded?.scope === scope ? loaded.catalog : undefined, loading, error, revision, refresh };
}
