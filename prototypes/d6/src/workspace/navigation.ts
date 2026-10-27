import { useLayoutEffect, useRef } from 'react';
import { useDemo } from '../state/store';

type Position = { top: number; focus?: string };
const controls = 'button,input,textarea,select,summary,a[href],[tabindex]';
const token = (element: HTMLElement) =>
  element.dataset.awKey ||
  element.id ||
  `${element.tagName}:${element.getAttribute('aria-label') || element.textContent?.trim()}`;

// Local navigation state, never record data or source-access authority.
export function useWorkspacePosition(
  page: 'memory' | 'reflection' | 'evolution' | 'skills',
  location: string,
  active = true,
) {
  const x = useDemo();
  const positions = useRef(new Map<string, Position>());
  useLayoutEffect(() => {
    if (x.mode !== 'quiet' || x.page !== page || !active) return;
    const root = document.querySelector<HTMLElement>(`[data-aw-page="${page}"]`);
    const scroll = document.querySelector<HTMLElement>('.workspace');
    if (!root || !scroll || root.closest('[hidden]')) return;
    const saved = positions.current.get(location);
    const position: Position = saved ?? { top: 0 };
    positions.current.set(location, position);
    const target = saved?.focus
      ? [...root.querySelectorAll<HTMLElement>(controls)].find(
          (e) => token(e) === saved.focus && e.getClientRects().length,
        )
      : undefined;
    const heading = [...root.querySelectorAll<HTMLElement>('h1,h2')].find((e) => e.getClientRects().length);
    const current = document.activeElement;
    const keepFocus = current instanceof HTMLElement && root.contains(current) && current.getClientRects().length;
    if (keepFocus) {
      /* A filter or tab update keeps its keyboard focus. */
    } else if (target) target.focus({ preventScroll: true });
    else if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    scroll.scrollTop = position.top;
    const rememberScroll = () => {
      position.top = scroll.scrollTop;
    };
    const rememberFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && root.contains(event.target)) {
        position.focus = token(event.target);
        rememberScroll();
      }
    };
    scroll.addEventListener('scroll', rememberScroll, { passive: true });
    root.addEventListener('focusin', rememberFocus);
    return () => {
      scroll.removeEventListener('scroll', rememberScroll);
      root.removeEventListener('focusin', rememberFocus);
    };
  }, [x.mode, x.page, page, location, active]);
}
