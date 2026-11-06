import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReflectionJobStatus } from '../../../../host/reflection/reflection-jobs';
import type { ReflectionService } from '../../../../host/reflection/reflection-service';

export type ReflectionApi = <T>(path: string, method?: string, data?: unknown, signal?: AbortSignal) => Promise<T>;
export type ReflectionCatalog = ReturnType<ReflectionService['catalog']>;
export const reflectionStatusLabels: Record<ReflectionJobStatus, string> = {
  pending: '等待中',
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  interrupted: '已中断',
  waiting_user: '需要重新检查',
};

export function useReflectionCatalog(api: ReflectionApi, sessionId?: string, offset = 0, statusOnly = false) {
  const scope = `${sessionId ?? ''}:${offset}:${statusOnly}`;
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      timer ??= setTimeout(() => {
        timer = undefined;
        refresh();
      }, 120);
    };
    window.addEventListener('agent-reflection-changed', changed);
    window.addEventListener('agent-reconnected', refresh);
    return () => {
      epoch.current++;
      clearTimeout(timer);
      window.removeEventListener('agent-reflection-changed', changed);
      window.removeEventListener('agent-reconnected', refresh);
    };
  }, [refresh]);

  useEffect(() => {
    const generation = ++epoch.current;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const query = `?${new URLSearchParams({ view: statusOnly ? 'status' : 'summary', limit: '20', offset: String(offset), ...(sessionId ? { sessionId } : {}) })}`;
    void api<ReflectionCatalog>(`/reflections${query}`, 'GET', undefined, controller.signal)
      .then((catalog) => {
        if (generation === epoch.current) setLoaded({ scope, catalog });
      })
      .catch((reason: unknown) => {
        if (generation === epoch.current) setError(reason instanceof Error ? reason.message : '自动复盘状态读取失败');
      })
      .finally(() => {
        if (generation === epoch.current) setLoading(false);
      });
    return () => {
      epoch.current++;
      controller.abort();
    };
  }, [api, scope, sessionId, revision, offset, statusOnly]);

  return { catalog: loaded?.scope === scope ? loaded.catalog : undefined, loading, error, revision, refresh };
}
