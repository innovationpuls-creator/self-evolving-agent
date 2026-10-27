import { useLayoutEffect, useRef, useState } from 'react';
import { parseRoute } from '../../host/src/route';
import type { Route as ReferenceRoute } from '../../host/src/navigation';
export type Route =
  | Exclude<ReferenceRoute, { page: 'result' }>
  | (Extract<ReferenceRoute, { page: 'result' }> & { project?: string })
  | {
      page: 'memory';
      project?: string;
      query?: string;
      history?: boolean;
      offset?: number;
      scope?: 'global' | 'project';
    }
  | {
      page: 'memory-edit';
      project?: string;
      id?: string;
      action: import('./memory-management').MemoryAction;
      originSession?: string;
    }
  | { page: 'skills'; project?: string }
  | {
      page: 'evolution';
      project?: string;
      sessionId?: string;
      offset?: number;
      status?: 'pending' | 'adopted' | 'ignored' | 'archived' | '';
    }
  | { page: 'activity'; id: string }
  | { page: 'settings' }
  | { page: 'trajectory'; sessionId: string };
export function parseProductRoute(raw: string | null): Route {
  try {
    const value = JSON.parse(raw || 'null');
    if (value?.page === 'result' && value.project !== undefined && typeof value.project !== 'string')
      return { page: 'session' };
    if (value?.page === 'settings') return { page: 'settings' };
    if (value?.page === 'skills' && (value.project === undefined || typeof value.project === 'string')) return value;
    if (value?.page === 'activity' && /^[a-f0-9-]{36}$/.test(value.id)) return value;
    if (value?.page === 'trajectory' && /^[a-f0-9-]{36}$/.test(value.sessionId))
      return { page: 'trajectory', sessionId: value.sessionId };
    if (
      value?.page === 'memory-edit' &&
      ['create', 'revise', 'confirm', 'retire', 'delete'].includes(value.action) &&
      (value.project === undefined || typeof value.project === 'string') &&
      (value.action === 'create' ? value.id === undefined : /^[a-f0-9-]{36}$/.test(value.id)) &&
      (value.originSession === undefined || /^[a-f0-9-]{36}$/.test(value.originSession))
    )
      return value;
    if (
      ['memory', 'evolution'].includes(value?.page) &&
      (value.project === undefined || typeof value.project === 'string') &&
      (value.status === undefined || ['', 'pending', 'adopted', 'ignored', 'archived'].includes(value.status)) &&
      (value.sessionId === undefined || /^[a-f0-9-]{36}$/.test(value.sessionId)) &&
      (value.scope === undefined || value.scope === 'global' || value.scope === 'project') &&
      (value.query === undefined || typeof value.query === 'string') &&
      (value.history === undefined || typeof value.history === 'boolean') &&
      (value.offset === undefined || (Number.isSafeInteger(value.offset) && value.offset >= 0))
    )
      return value;
  } catch {
    /* Fall through to the validated reference route parser. */
  }
  return parseRoute(raw);
}
type Workspace = 'reflection' | 'memory' | 'skills' | 'evolution' | 'trace';
function workspaceFor(route: Route, previous?: Workspace): Workspace | undefined {
  if (route.page === 'activity') return 'evolution';
  if (route.page === 'memory-edit') return 'memory';
  if (route.page === 'result')
    return route.target.kind === 'memory' ? 'memory' : route.target.kind === 'skill' ? 'skills' : 'evolution';
  if (route.page === 'reflection' || route.page === 'reflections') return 'reflection';
  if (route.page === 'session' || route.page === 'trajectory') return 'trace';
  if (route.page === 'memory' || route.page === 'skills' || route.page === 'evolution') return route.page;
  return previous;
}
type Position = { top: number; focus?: string };
// Same restoration contract as the reference adapter, extended only for A's workspace routes.
export function useProductNavigation() {
  const [location, setLocation] = useState(() => {
    const route = parseProductRoute(new URLSearchParams(window.location.search).get('r'));
    return { route, key: crypto.randomUUID(), depth: 0, workspace: workspaceFor(route) };
  });
  const initial = useRef(location);
  const current = useRef(location);
  current.current = location;
  const positions = useRef(new Map<string, Position>());
  const restoring = useRef(false);
  const objects = useRef(new Map<string, Position>());
  const save = () => {
    const position = {
      top: document.querySelector('.workspace')?.scrollTop || 0,
      focus: document.activeElement?.getAttribute('data-focus') || undefined,
    };
    positions.current.set(current.current.key, position);
    objects.current.set(JSON.stringify(current.current.route), position);
  };
  const go = (route: Route, replace = false) => {
    save();
    const next = {
      route,
      key: crypto.randomUUID(),
      depth: location.depth + (replace ? 0 : 1),
      workspace: workspaceFor(route, location.workspace),
    };
    const query = new URLSearchParams(window.location.search);
    query.set('r', JSON.stringify(route));
    if (replace) history.replaceState(next, '', `?${query}`);
    else history.pushState(next, '', `?${query}`);
    const remembered = objects.current.get(JSON.stringify(route));
    if (remembered) positions.current.set(next.key, remembered);
    restoring.current = !!remembered;
    setLocation(next);
  };
  useLayoutEffect(() => {
    const pop = (event: PopStateEvent) => {
      save();
      restoring.current = true;
      const parsed = parseProductRoute(new URLSearchParams(window.location.search).get('r'));
      setLocation(
        event.state?.key
          ? event.state
          : JSON.stringify(parsed) === JSON.stringify(initial.current.route)
            ? initial.current
            : { route: parsed, key: crypto.randomUUID(), depth: 0, workspace: workspaceFor(parsed) },
      );
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useLayoutEffect(() => {
    const el = document.querySelector<HTMLElement>('.workspace');
    if (!el) return;
    const saved = restoring.current ? positions.current.get(location.key) : undefined;
    const restore = () => {
      el.scrollTop = saved?.top || 0;
      const target = saved?.focus
        ? [...el.querySelectorAll<HTMLElement>('[data-focus]')].find((n) => n.dataset.focus === saved.focus)
        : undefined;
      target?.focus({ preventScroll: true });
      return saved?.focus ? !!target : !!el.querySelector('h1');
    };
    if (restore()) return;
    const observer = new MutationObserver(() => {
      if (restore()) observer.disconnect();
    });
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [location.key]);
  return { ...location, go, back: () => (location.depth > 0 ? history.back() : go({ page: 'session' })) };
}
