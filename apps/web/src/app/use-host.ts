import { useCallback, useEffect, useRef, useState } from 'react';
import { applySessionEvent, type Model, type Session, type SessionEvent } from '../features/chat/session-state';

const connectionKey = 'agent-connection-token';
export type Connection = 'connecting' | 'syncing' | 'ready' | 'offline' | 'auth_required' | 'forbidden';
async function request<T>(path: string, method = 'GET', data?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  const token = sessionStorage.getItem(connectionKey);
  try {
    response = await fetch(`/api${path}`, {
      method,
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('暂时无法连接本机服务，请确认应用仍在运行。');
  }
  const result = await response.json();
  if (response.status === 401 && path !== '/connect' && token === sessionStorage.getItem(connectionKey)) {
    sessionStorage.removeItem(connectionKey);
    window.dispatchEvent(new Event('agent-auth-lost'));
  }
  if (!response.ok)
    throw Object.assign(new Error(result.error ?? '操作未完成'), { status: response.status, code: result.code });
  return result;
}

export function useHost(initialId?: string) {
  const [connection, setConnection] = useState<Connection>('connecting');
  const status = useRef<Connection>('connecting');
  const [error, setError] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [providers, setProviders] = useState<Array<{ id: string }>>([]);
  const [selected, setSelected] = useState<Session>();
  const [selectedId, setSelectedId] = useState(initialId);
  const selectedRef = useRef(initialId);
  const state = useRef<Session | undefined>(undefined);
  const transport = useRef(0);
  const generation = useRef(0),
    selection = useRef(0),
    listEpoch = useRef(0),
    listEvents = useRef(0);
  const pending = useRef<{ id: string; events: SessionEvent[] } | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const transition = (value: Connection) => {
    status.current = value;
    setConnection(value);
  };
  const commit = (value: Session | undefined) => {
    state.current = value;
    setSelected(value);
  };
  const api = useCallback(<T>(path: string, method = 'GET', data?: unknown, signal?: AbortSignal): Promise<T> => {
    if (method !== 'GET' && status.current !== 'ready')
      return Promise.reject(new Error('连接尚未恢复，请等待同步完成后再操作。'));
    return request<T>(path, method, data, signal);
  }, []);
  const refresh = useCallback(async () => {
    const owner = generation.current,
      channel = transport.current,
      epoch = ++listEpoch.current,
      events = listEvents.current;
    const [list, catalog] = await Promise.all([
      request<Session[]>('/sessions'),
      request<{ models: Model[]; providers: Array<{ id: string }> }>('/models'),
    ]);
    if (owner !== generation.current || channel !== transport.current || epoch !== listEpoch.current) return;
    // A concurrent state event may announce a Session absent from this older list.
    if (events === listEvents.current) setSessions(list);
    else
      setSessions((current) => {
        const merged = new Map(list.map((item) => [item.id, item]));
        for (const item of current) {
          const old = merged.get(item.id);
          if (!old || item.stateVersion > old.stateVersion) merged.set(item.id, item);
        }
        return [...merged.values()];
      });
    setModels(catalog.models);
    setProviders(catalog.providers);
  }, []);
  const load = useCallback(async (id: string) => {
    const owner = generation.current,
      channel = transport.current,
      epoch = ++selection.current;
    const buffer = { id, events: [] as SessionEvent[] };
    pending.current = buffer;
    try {
      let snapshot = await request<Session>(`/sessions/${id}`);
      if (
        owner !== generation.current ||
        channel !== transport.current ||
        epoch !== selection.current ||
        selectedRef.current !== id
      )
        return;
      for (const event of buffer.events) snapshot = applySessionEvent(snapshot, event);
      if (state.current?.id === id && state.current.stateVersion > snapshot.stateVersion) return;
      commit(snapshot);
    } catch (reason) {
      if (
        owner !== generation.current ||
        channel !== transport.current ||
        epoch !== selection.current ||
        selectedRef.current !== id
      )
        return;
      throw reason;
    } finally {
      if (pending.current === buffer) pending.current = undefined;
    }
  }, []);
  const open = async (id: string) => {
    selectedRef.current = id;
    setSelectedId(id);
    if (state.current?.id !== id) commit(undefined);
    try {
      await load(id);
    } catch (reason) {
      if (selectedRef.current === id) setError(reason instanceof Error ? reason.message : '会话读取失败');
      throw reason;
    }
  };
  const clearSelection = () => {
    selection.current++;
    pending.current = undefined;
    selectedRef.current = undefined;
    setSelectedId(undefined);
    commit(undefined);
  };
  const connect = async (value: string) => {
    transition('connecting');
    setError('');
    try {
      await request('/connect', 'POST', { token: value });
      sessionStorage.setItem(connectionKey, value);
      setAttempt((n) => n + 1);
    } catch (reason) {
      transition(
        reason instanceof Error && 'status' in reason && reason.status === 403 ? 'forbidden' : 'auth_required',
      );
      setError(reason instanceof Error ? reason.message : '连接失败');
      throw reason;
    }
  };
  useEffect(() => {
    const owner = ++generation.current;
    let stopped = false,
      socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;
    const valid = () => !stopped && generation.current === owner;
    const schedule = (fn: () => void) => {
      clearTimeout(timer);
      timer = setTimeout(fn, delay);
      delay = Math.min(delay * 2, 10000);
    };
    const authenticationLost = () => {
      if (!valid()) return;
      clearTimeout(timer);
      transition('auth_required');
      selection.current++;
      pending.current = undefined;
      state.current = undefined;
      setSessions([]);
      setError('连接令牌已失效，请重新连接。');
      socket?.close();
    };
    window.addEventListener('agent-auth-lost', authenticationLost);
    const synchronize = async () => {
      if (!valid()) return;
      const channel = transport.current;
      transition('syncing');
      let notice = '';
      try {
        await refresh();
        while (selectedRef.current) {
          const restoringId = selectedRef.current;
          try {
            await load(restoringId);
          } catch (reason) {
            if (!(reason instanceof Error && 'status' in reason && reason.status === 404)) throw reason;
            clearSelection();
            notice = '上次打开的会话已不可访问，请选择其他会话。';
          }
          if (selectedRef.current === restoringId || channel !== transport.current || !valid()) break;
        }
        if (!valid() || channel !== transport.current || status.current === 'auth_required') return;
        transition('ready');
        setError(notice);
        delay = 1000;
        window.dispatchEvent(new Event('agent-reconnected'));
      } catch (reason) {
        if (!valid() || channel !== transport.current || status.current === 'auth_required') return;
        if (reason instanceof Error && 'status' in reason && reason.status === 403) {
          transition('forbidden');
          setError(reason.message);
          return;
        }
        transition('offline');
        setError(reason instanceof Error ? reason.message : '状态恢复失败');
        schedule(() => void synchronize());
      }
    };
    const startSocket = () => {
      if (!valid() || !sessionStorage.getItem(connectionKey)) return;
      transport.current++;
      selection.current++;
      pending.current = undefined;
      state.current = undefined;
      setSessions((list) => list.map((item) => ({ ...item, stateVersion: -1 })));
      transition('connecting');
      socket = new WebSocket(`${location.origin.replace('http', 'ws')}/events`);
      const current = socket;
      current.onopen = () =>
        current.send(JSON.stringify({ type: 'authenticate', token: sessionStorage.getItem(connectionKey) }));
      current.onclose = (event) => {
        if (!valid() || current !== socket) return;
        transport.current++;
        selection.current++;
        pending.current = undefined;
        // Keep the last readable projection until the new authoritative baseline arrives.
        state.current = undefined;
        if (event.code === 4401) {
          sessionStorage.removeItem(connectionKey);
          authenticationLost();
          return;
        }
        if (status.current === 'auth_required') return;
        transition('offline');
        schedule(startSocket);
      };
      current.onerror = () => current.close();
      current.onmessage = (message) => {
        if (!valid() || current !== socket) return;
        const data = JSON.parse(message.data);
        if (data.type === 'connected') {
          void synchronize();
          return;
        }
        const names: Record<string, string> = {
          reflection: 'reflection',
          evolution: 'suggestions',
          skills: 'skills',
          memory: 'memory',
          diagnostic: 'diagnostics',
          diagnostics: 'diagnostics',
        };
        if (names[data.type]) window.dispatchEvent(new Event(`agent-${names[data.type]}-changed`));
        if (data.type === 'models') void refresh().catch(() => {});
        if (data.type === 'queue_failed' || data.type === 'blocked') {
          setError(`${data.sessionId === selectedRef.current ? '当前会话' : '后台会话'}：${data.error}`);
        }
        if (data.type !== 'state' && data.type !== 'update') return;
        const event: SessionEvent = data;
        if (event.type === 'state' || event.event.type === 'tool_execution_end')
          window.dispatchEvent(new Event('agent-tools-changed'));
        listEvents.current++;
        if (event.type === 'state')
          setSessions((list) => {
            const old = list.find((item) => item.id === event.sessionId);
            if (old && old.stateVersion > event.state.stateVersion) return list;
            return old
              ? list.map((item) => (item.id === event.sessionId ? event.state : item))
              : [event.state, ...list];
          });
        if (pending.current?.id === event.sessionId) pending.current.events.push(event);
        if (state.current?.id === event.sessionId) commit(applySessionEvent(state.current, event));
      };
    };
    const initialize = async () => {
      const token = new URLSearchParams(location.hash.slice(1)).get('token');
      if (token) {
        history.replaceState(null, '', location.pathname + location.search);
        sessionStorage.setItem(connectionKey, token);
        try {
          await request('/connect', 'POST', { token });
        } catch (reason) {
          if (!valid()) return;
          if (reason instanceof Error && 'status' in reason) {
            if (reason.status === 401) sessionStorage.removeItem(connectionKey);
            transition(reason.status === 403 ? 'forbidden' : 'auth_required');
            setError(reason.message);
            return;
          }
        }
      }
      if (!valid()) return;
      if (sessionStorage.getItem(connectionKey)) startSocket();
      else transition('auth_required');
    };
    void initialize();
    return () => {
      stopped = true;
      generation.current++;
      selection.current++;
      pending.current = undefined;
      clearTimeout(timer);
      socket?.close();
      window.removeEventListener('agent-auth-lost', authenticationLost);
    };
  }, [attempt, refresh, load]);
  return {
    connection,
    error,
    setError,
    api,
    sessions,
    models,
    providers,
    selected,
    selectedId,
    open,
    clearSelection,
    refresh,
    connect,
    retry: () => setAttempt((n) => n + 1),
  };
}
