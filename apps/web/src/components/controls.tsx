import type { ReactNode, KeyboardEvent } from 'react';

function move(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (current < 0) return;
  event.preventDefault();
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[index]?.focus();
  buttons[index]?.click();
}

// Filters are toggle controls, not empty tab panels pretending to contain the results.
export function FilterBar({
  items,
  value,
  onChange,
  label = '内容筛选',
}: {
  items: string[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <div className="aw-filterbar" data-orientation="horizontal">
      <div className="tabbar" role="toolbar" aria-label={label} onKeyDown={move}>
        {items.map((item) => (
          <button
            type="button"
            key={item}
            data-state={item === value ? 'active' : 'inactive'}
            aria-pressed={item === value}
            tabIndex={item === value ? 0 : -1}
            onClick={() => onChange(item)}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ViewTabs({
  items,
  value,
  onChange,
  label,
  id,
}: {
  items: string[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  id: string;
}) {
  return (
    <div className="tabbar" role="tablist" aria-label={label} onKeyDown={move}>
      {items.map((item, i) => (
        <button
          type="button"
          role="tab"
          id={`${id}-tab-${i}`}
          key={item}
          data-state={item === value ? 'active' : 'inactive'}
          aria-selected={item === value}
          aria-controls={`${id}-panel-${i}`}
          tabIndex={item === value ? 0 : -1}
          onClick={() => onChange(item)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

export function ViewPanel({
  id,
  items,
  value,
  children,
}: {
  id: string;
  items: string[];
  value: string;
  children: ReactNode;
}) {
  return (
    <>
      {items.map((item, index) => (
        <div
          key={item}
          role="tabpanel"
          id={`${id}-panel-${index}`}
          aria-labelledby={`${id}-tab-${index}`}
          hidden={item !== value}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: APG panels are keyboard destinations for non-interactive content.
          tabIndex={0}
          className="aw-view-panel"
        >
          {item === value ? children : null}
        </div>
      ))}
    </>
  );
}
