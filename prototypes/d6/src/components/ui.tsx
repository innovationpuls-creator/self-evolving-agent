import { type ReactNode, type ButtonHTMLAttributes, useId, isValidElement, cloneElement, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as Tabs from '@radix-ui/react-tabs';
import {
  X,
  Check,
  AlertTriangle,
  Circle,
  LoaderCircle,
  ChevronRight,
  ArrowLeft,
  Search,
  FileText,
  Info,
} from 'lucide-react';
import { useDemo, useVisualMode } from '../state/store';
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
  const mode = useVisualMode();
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
  const mode = useVisualMode();
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
  const mode = useVisualMode();
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
  const mode = useVisualMode();
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
  const mode = useVisualMode();
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
const stateCopy = {
  chat: ['还没有对话', '从一个具体目标开始。可以引用项目文件或让 Agent 选择合适的 Skill。'],
  trace: ['这里还没有执行记录', '发送任务后，可在这里查看模型轮次、Tool 调用和原始证据。'],
  memory: ['还没有保存的认识', '完成工作后，Agent 可以按需记录经验与项目背景。也可以手动补充。'],
  reflection: ['还没有反思记录', '任务结束后的反思会保留在这里；没有新发现也是正常结果。'],
  skills: ['还没有纳入管理的 Skill', '导入已有 Skill，或从一个具体目标开始讨论新能力。'],
  evolution: ['没有待处理的建议', 'Agent 会在有依据时提出改进构想。你也可以主动发起能力讨论。'],
  settings: ['尚未配置模型', '选择提供方，使用设备登录或保存演示 Key，随后检查调用状态。'],
};
export function StateGate({
  children,
  emptyAction,
  messages,
}: {
  children: ReactNode;
  emptyAction?: ReactNode;
  messages?: { empty: [string, string]; loading: string; error: [string, string] };
}) {
  const { scenario, setScenario, page } = useDemo();
  if (!['empty', 'loading', 'error'].includes(scenario)) return children;
  const [title, copy] = messages?.empty ?? stateCopy[page];
  return (
    <div className="state-view">
      {scenario === 'loading' ? (
        <>
          <div className="skeleton-line" />
          <div className="skeleton-line short" />
          <div className="skeleton-block" />
          <p className="muted" role="status">
            {messages?.loading ?? `正在读取${page === 'chat' ? '会话' : '记录'}…`}
          </p>
          <Button onClick={() => setScenario('normal')}>显示已读取内容</Button>
        </>
      ) : scenario === 'empty' ? (
        <>
          <FileText size={30} strokeWidth={1.2} />
          <h2>{title}</h2>
          <p>{copy}</p>
          {emptyAction ?? <Button onClick={() => setScenario('normal')}>返回已有示例</Button>}
        </>
      ) : (
        <>
          <AlertTriangle size={30} strokeWidth={1.3} />
          <h2>{messages?.error[0] ?? `暂时无法读取${page === 'settings' ? '授权状态' : '这部分内容'}`}</h2>
          <p>{messages?.error[1] ?? '连接已断开，已有内容没有被删除。重新连接后再读取，不自动重发任务。'}</p>
          <Button kind="primary" onClick={() => setScenario('normal')}>
            重新读取
          </Button>
        </>
      )}
    </div>
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
