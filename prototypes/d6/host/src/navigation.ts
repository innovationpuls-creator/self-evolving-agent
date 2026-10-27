import { useLayoutEffect, useRef, useState } from 'react';
import type { EvolutionEvidence } from '../../../../apps/host/evolution/evolution';
import type { ResultTarget } from './data';
import { parseRoute } from './route';
export type Route =
  | { page: 'session'; sessionId?: string; entryId?: string }
  | { page: 'reflections'; sessionId?: string; offset: number }
  | { page: 'reflection'; jobId: string; recordId?: string; originSession?: string }
  | { page: 'source'; reference: EvolutionEvidence; project: string; originSession?: string }
  | { page: 'result'; target: ResultTarget; originSession?: string };
type Location = { route: Route; key: string; depth: number };
type Position = { top: number; focus?: string };
const positions = new Map<string, Position>();
const sessionPositions = new Map<string, Position>();
export function useNavigation() {
  const [location, setLocation] = useState<Location>(() => {
    const route = parseRoute(new URLSearchParams(window.location.search).get('r'));
    const current = { route, key: crypto.randomUUID(), depth: 0 };
    history.replaceState(current, '', window.location.href);
    return current;
  });
  const [restoring, setRestoring] = useState(false);
  const current = useRef(location);
  current.current = location;
  const save = () => {
    const focus = document.activeElement?.getAttribute('data-focus') ?? undefined;
    const position = { top: document.querySelector('.workspace')?.scrollTop ?? 0, focus };
    positions.set(location.key, position);
    if (location.route.page === 'session' && location.route.sessionId && !location.route.entryId)
      sessionPositions.set(location.route.sessionId, position);
  };
  const go = (route: Route) => {
    save();
    const next = { route, key: crypto.randomUUID(), depth: location.depth + 1 };
    history.pushState(next, '', `?${new URLSearchParams({ r: JSON.stringify(route) })}`);
    const remembered =
      route.page === 'session' && route.sessionId && !route.entryId ? sessionPositions.get(route.sessionId) : undefined;
    if (remembered) positions.set(next.key, remembered);
    setRestoring(!!remembered);
    setLocation(next);
  };
  useLayoutEffect(() => {
    const pop = (event: PopStateEvent) => {
      if (!event.state?.route || !event.state.key) return;
      positions.set(current.current.key, {
        top: document.querySelector('.workspace')?.scrollTop ?? 0,
        focus: document.activeElement?.getAttribute('data-focus') ?? undefined,
      });
      setRestoring(true);
      setLocation(event.state);
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useLayoutEffect(() => {
    const el = document.querySelector<HTMLElement>('.workspace');
    if (!el) return;
    if (!restoring) {
      el.scrollTop = 0;
      el.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
      return;
    }
    const saved = positions.get(location.key);
    const restore = () => {
      if (!saved) return true;
      el.scrollTop = saved.top;
      const target = [...el.querySelectorAll<HTMLElement>('[data-focus]')].find(
        (node) => node.dataset.focus === saved.focus,
      );
      target?.focus({ preventScroll: true });
      return saved.focus ? !!target : !!el.querySelector('h1') && !el.querySelector('[role=status]');
    };
    if (restore()) return;
    const observer = new MutationObserver(() => {
      if (restore()) observer.disconnect();
    });
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [location.key, restoring]);
  return {
    ...location,
    go,
    back: () => (location.depth > 0 ? history.back() : go({ page: 'reflections', offset: 0 })),
  };
}
