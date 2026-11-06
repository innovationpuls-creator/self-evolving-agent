import { type ReactNode, type ButtonHTMLAttributes, useId, isValidElement, cloneElement, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as Tabs from '@radix-ui/react-tabs';
import { X, Check, AlertTriangle, Circle, LoaderCircle, ChevronRight, ArrowLeft, Search, Info } from 'lucide-react';
export function Button({
  children,
  kind = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return (
    <button type="button" className={`btn ${kind} ${className}`} {...props}>
      {children}
    </button>
  );
}
export function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  const mode = 'quiet' as string;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button type="button" className="icon-btn" aria-label={label} {...props}>
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={`tooltip ${mode === 'quiet' ? 'quiet-surface' : ''}`} sideOffset={6}>
          {label}
          <Tooltip.Arrow />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
export function TipProvider({ children }: { children: ReactNode }) {
  return <Tooltip.Provider delayDuration={400}>{children}</Tooltip.Provider>;
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
  drawer = false,
  footer,
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  drawer?: boolean;
  footer?: ReactNode;
  className?: string;
}) {
  const mode = 'quiet' as string;
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) opener.current = document.activeElement as HTMLElement;
  wasOpen.current = open;
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={`modal-overlay ${mode === 'quiet' ? 'quiet-surface' : ''}`} />
        <Dialog.Content
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            const focused = document.activeElement;
            if (!focused || focused === document.body || focused.closest('[role="dialog"]')) opener.current?.focus();
          }}
          className={`modal ${mode === 'studio' ? 'studio-surface' : 'quiet-surface'} ${wide ? 'wide' : ''} ${drawer ? 'drawer' : ''} ${className}`}
        >
          <div className="modal-head">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description className={description ? 'muted' : 'sr-only'}>
                {description ?? '查看内容与相关操作'}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="icon-btn" aria-label="关闭">
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-actions">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Menu({
  label,
  children,
  items,
}: {
  label: string;
  children: ReactNode;
  items: { label: string; onSelect: () => void; danger?: boolean }[];
}) {
  const mode = 'quiet' as string;
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button type="button" className="icon-btn" aria-label={label}>
          {children}
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content className={`dropdown ${mode === 'quiet' ? 'quiet-surface' : ''}`} align="end" sideOffset={5}>
          {items.map((i) => (
            <Dropdown.Item key={i.label} className={i.danger ? 'danger-text' : ''} onSelect={i.onSelect}>
              {i.label}
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
export function TabBar({
  items,
  value,
  onChange,
  label = '内容切换',
}: {
  items: string[];
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <Tabs.Root value={value} onValueChange={onChange}>
      <Tabs.List className="tabbar" aria-label={label}>
        {items.map((x) => (
          <Tabs.Trigger key={x} value={x}>
            {x}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <Tabs.Content value={value} className="sr-only">
        {value}
      </Tabs.Content>
    </Tabs.Root>
  );
}
export function Status({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'busy';
  children: ReactNode;
}) {
  const I =
    tone === 'good'
      ? Check
      : tone === 'bad' || tone === 'warn'
        ? AlertTriangle
        : tone === 'busy'
          ? LoaderCircle
          : Circle;
  return (
    <span className={`status ${tone}`}>
      <I size={13} className={tone === 'busy' ? 'spin' : ''} />
      {children}
    </span>
  );
}
export function Notice({
  title,
  children,
  tone = 'neutral',
  action,
}: {
  title: string;
  children?: ReactNode;
  tone?: 'neutral' | 'warn' | 'bad' | 'good';
  action?: ReactNode;
}) {
  const mode = 'quiet' as string;
  return (
    <div className={`notice ${tone}`}>
      <div className="notice-icon">
        {tone === 'good' ? (
          <Check size={17} />
        ) : tone === 'neutral' && mode === 'quiet' ? (
          <Info size={17} />
        ) : (
          <AlertTriangle size={17} />
        )}
      </div>
      <div>
        <strong>{title}</strong>
        {children && <div className="notice-copy">{children}</div>}
        {action && <div className="notice-action">{action}</div>}
      </div>
    </div>
  );
}
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  const id = useId();
  const child = isValidElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>(children)
    ? children
    : null;
  const controlId = child?.props.id ?? id;
  const describedBy = [child?.props['aria-describedby'], hint ? `${id}-hint` : '', error ? `${id}-error` : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className="field">
      <label htmlFor={controlId}>{label}</label>
      {child
        ? cloneElement(child, {
            id: controlId,
            'aria-describedby': describedBy || undefined,
            ...(error ? { 'aria-invalid': true } : {}),
          })
        : children}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {error && (
        <small className="field-error" id={`${id}-error`} role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
export function SectionTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const mode = 'quiet' as string;
  return (
    <header className="section-head">
      <div>
        {eyebrow && mode === 'studio' && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}
export function LinkRow({ title, meta, onClick }: { title: string; meta?: string; onClick: () => void }) {
  return (
    <button type="button" className="link-row" onClick={onClick}>
      <span>
        <strong>{title}</strong>
        {meta && <small>{meta}</small>}
      </span>
      <ChevronRight size={16} />
    </button>
  );
}
export function Back({ onClick, children = '返回列表' }: { onClick: () => void; children?: ReactNode }) {
  return (
    <Button kind="ghost" className="back" onClick={onClick}>
      <ArrowLeft size={15} />
      {children}
    </Button>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = '搜索',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-box">
      <Search size={15} />
      <input
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
export function EmptySearch() {
  return <div className="empty-search">没有匹配的内容。试试较短的关键词。</div>;
}
