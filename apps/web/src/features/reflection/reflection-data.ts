import { useCallback, useEffect, useRef, useState } from 'react';
import type { Api, Detail } from '../../app/types';

// A Job route remains stable while its initially absent Record becomes available.
export async function readReflectionDetail(api: Api, jobId: string, signal?: AbortSignal): Promise<Detail> {
  const { job } = await api<Detail>(`/reflections/jobs/${encodeURIComponent(jobId)}`, 'GET', undefined, signal);
  if (!job.reflectionSessionId) return { job };
  try {
    return await api<Detail>(`/reflections/${encodeURIComponent(jobId)}`, 'GET', undefined, signal);
  } catch (e) {
    if (e instanceof Error && 'status' in e && e.status === 404) return { job };
    throw e;
  }
}
export function useReflectionDetail(api: Api, jobId: string) {
  const [loaded, L] = useState<{ id: string; value: Detail }>();
  const [loading, B] = useState(true),
    [error, E] = useState(''),
    [revision, R] = useState(0);
  const epoch = useRef(0);
  const refresh = useCallback(() => R((r) => r + 1), []);
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
      clearTimeout(timer);
      window.removeEventListener('agent-reflection-changed', changed);
      window.removeEventListener('agent-reconnected', refresh);
    };
  }, [refresh]);
  useEffect(() => {
    const generation = ++epoch.current,
      controller = new AbortController();
    B(true);
    E('');
    void readReflectionDetail(api, jobId, controller.signal)
      .then((value) => {
        if (generation === epoch.current) L({ id: jobId, value });
      })
      .catch((e) => {
        if (generation === epoch.current) E(e instanceof Error ? e.message : '检查详情读取失败');
      })
      .finally(() => {
        if (generation === epoch.current) B(false);
      });
    return () => {
      epoch.current++;
      controller.abort();
    };
  }, [api, jobId, revision]);
  return { value: !error && loaded?.id === jobId ? loaded.value : undefined, loading, error, refresh };
}
