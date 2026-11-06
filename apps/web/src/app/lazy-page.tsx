import { Component, useEffect, useReducer, type ComponentType, type ReactNode } from 'react';
import { Failure } from '../components/reading';

class PageLoadError extends Error {}
type Tracked<T> = Promise<T> & { status?: 'fulfilled' | 'rejected'; value?: T; reason?: unknown };
const preloads: (() => Promise<unknown>)[] = [];

// A page whose code loads on first render. Once the code has arrived (on first use or via preloadPages)
// the page renders synchronously like a static import. Until then it renders `fallback` and mounts the
// page in the commit after the code arrives; Suspense is not used because it holds revealed content back
// for its fallback throttle (about 300 ms) even when the code arrives in a few milliseconds.
export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>, fallback: ReactNode = null) {
  let loading: Tracked<ComponentType<P>> | undefined;
  const preload = () => {
    if (!loading) {
      const tracked: Tracked<ComponentType<P>> = load().then(
        (page) => {
          tracked.status = 'fulfilled';
          tracked.value = page;
          return page;
        },
        () => {
          const reason = new PageLoadError('页面未能加载');
          tracked.status = 'rejected';
          tracked.reason = reason;
          throw reason;
        },
      );
      loading = tracked;
    }
    return loading;
  };
  preloads.push(preload);
  function Page(props: P) {
    const current = preload();
    const [, settled] = useReducer((count: number) => count + 1, 0);
    const renderedSettled = !!current.status;
    useEffect(() => {
      if (!current.status) current.then(settled, settled);
      else if (!renderedSettled) settled();
    }, [current, renderedSettled]);
    if (current.status === 'rejected') throw current.reason;
    const Loaded = current.value;
    return Loaded ? <Loaded {...props} /> : fallback;
  }
  return Object.assign(Page, { preload });
}

export function preloadPages() {
  for (const preload of preloads) void preload().catch(() => {});
}

// Shows a reload action when page code cannot be fetched; every other error keeps propagating.
export class PageBoundary extends Component<{ children: ReactNode }, { error?: unknown }> {
  state: { error?: unknown } = {};
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (error === undefined) return this.props.children;
    if (!(error instanceof PageLoadError)) throw error;
    return <Failure error={error.message} retry={() => window.location.reload()} />;
  }
}
