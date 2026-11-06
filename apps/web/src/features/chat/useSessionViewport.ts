import { useEffect, useLayoutEffect, useRef, useState } from 'react';
type ReadingPosition = {
  top: number;
  following: boolean;
  inputFocused: boolean;
  readerFocused: boolean;
  selection: [number, number];
};

export function useSessionViewport({
  key,
  active,
  draft,
  empty,
  messageSignature,
}: {
  key: string;
  active: boolean;
  draft: string;
  empty: boolean;
  messageSignature: string;
}) {
  const room = useRef<HTMLElement>(null);
  const reader = useRef<HTMLElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const positions = useRef(new Map<string, ReadingPosition>());
  const following = useRef(false);
  const readingTop = useRef(0);
  const focused = useRef(false);
  const readerFocused = useRef(false);
  const selection = useRef<[number, number]>([0, 0]);
  const [away, setAway] = useState(false);
  const [header, setHeader] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setHeader(active ? document.getElementById('a-chat-actions') : null);
  }, [active]);

  // Preserve a reading anchor for each execution branch without retaining source data.
  useLayoutEffect(() => {
    if (!active || !reader.current) return;
    const el = reader.current;
    const saved = positions.current.get(key);
    following.current = saved?.following ?? false;
    el.scrollTop = saved?.following ? el.scrollHeight : (saved?.top ?? 0);
    readingTop.current = el.scrollTop;
    setAway(el.scrollHeight - el.clientHeight - el.scrollTop > 72);
    focused.current = saved?.inputFocused ?? false;
    readerFocused.current = saved?.readerFocused ?? false;
    if (saved?.readerFocused) el.focus({ preventScroll: true });
    if (saved?.inputFocused || (!saved && empty)) {
      input.current?.focus({ preventScroll: true });
      if (saved) input.current?.setSelectionRange(...saved.selection);
    }
    return () => {
      positions.current.set(key, {
        top: readingTop.current,
        following: following.current,
        inputFocused: focused.current,
        readerFocused: readerFocused.current,
        selection: selection.current,
      });
    };
  }, [active, key]);

  useLayoutEffect(() => {
    if (!active || !input.current) return;
    const el = input.current;
    const resize = () => {
      el.style.height = '0px';
      const max = Number.parseFloat(getComputedStyle(el).maxHeight);
      el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    };
    resize();
    // Observe width, not the textarea whose height we change.
    let width = dock.current?.clientWidth;
    const onResize = new ResizeObserver(() => {
      if (width === dock.current?.clientWidth) return;
      width = dock.current?.clientWidth;
      resize();
    });
    if (dock.current) onResize.observe(dock.current);
    window.addEventListener('resize', resize);
    return () => {
      onResize.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [draft, active, key]);

  useLayoutEffect(() => {
    if (!active || !dock.current || !reader.current || !room.current) return;
    const el = reader.current;
    const root = room.current;
    const update = () => {
      root.style.setProperty('--session-dock-height', `${dock.current?.offsetHeight ?? 0}px`);
      if (following.current) el.scrollTop = el.scrollHeight;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(dock.current);
    observer.observe(el);
    return () => observer.disconnect();
  }, [active]);

  useLayoutEffect(() => {
    if (!active || !reader.current) return;
    const el = reader.current;
    if (following.current) el.scrollTop = el.scrollHeight;
    setAway(el.scrollHeight - el.clientHeight - el.scrollTop > 72);
  }, [active, messageSignature]);

  useEffect(() => {
    if (!active) return;
    const app = room.current?.closest<HTMLElement>('.app');
    const viewport = window.visualViewport;
    const resize = () =>
      app?.style.setProperty('--session-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
    resize();
    viewport?.addEventListener('resize', resize);
    return () => {
      viewport?.removeEventListener('resize', resize);
      app?.style.removeProperty('--session-viewport-height');
    };
  }, [active]);

  return { room, reader, dock, input, following, readingTop, focused, readerFocused, selection, away, setAway, header };
}
