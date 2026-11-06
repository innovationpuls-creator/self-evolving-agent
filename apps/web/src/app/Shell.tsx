import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Command,
  Search,
  MessageSquare,
  Plus,
  BookOpen,
  Layers,
  Settings,
  PanelLeftClose,
  MoreHorizontal,
  Lightbulb,
  History,
  Folder,
  ArrowLeft,
  Menu as MenuIcon,
} from 'lucide-react';
import { Button, IconButton, Modal, SearchBox, Menu } from '../components/ui';
export type Page = 'chat' | 'trace' | 'memory' | 'reflection' | 'skills' | 'evolution' | 'settings';
type SessionLink = {
  id: string;
  title: string;
  project: string;
  run: 'idle' | 'running';
  unavailable?: boolean;
  error?: string;
};
export interface ShellController {
  page: Page;
  sid: string;
  session: SessionLink;
  sessions: SessionLink[];
  connected: boolean;
  history: unknown[];
  go: (page: Page) => void;
  back: () => void;
  setSid: (id: string) => void;
}
const modules = [
  { id: 'memory', label: '记忆', icon: BookOpen },
  { id: 'reflection', label: '反思记录', icon: History },
  { id: 'skills', label: '技能与工具', icon: Layers },
  { id: 'evolution', label: '改进建议', icon: Lightbulb },
] as const;
export function ShellSurface({
  children,
  x,
  host,
}: {
  children: ReactNode;
  x: ShellController;
  host: { create: () => void; retry: () => void; connection: string; dialogs?: ReactNode };
}) {
  const [search, setSearch] = useState(false),
    [query, setQuery] = useState('');
  const [mobile, setMobile] = useState(false),
    [collapsed, setCollapsed] = useState(false);
  const [titleOpen, setTitleOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const chat = x.page === 'chat',
    sessionView = chat || x.page === 'trace';
  const select = (page: Page) => {
    x.go(page);
    setMobile(false);
  };
  const selectSession = (id: string) => {
    x.setSid(id);
    select('chat');
    setSearch(false);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobile(false);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearch((value) => !value);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (!mobile || !window.matchMedia('(max-width: 700px)').matches) return;
    const previous = document.activeElement as HTMLElement | null;
    sidebar.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = sidebar.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      const first = controls?.[0],
        last = controls?.[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.removeEventListener('keydown', trap);
      previous?.focus();
    };
  }, [mobile]);
  return (
    <div
      className={`app host-product quiet product-view ${['memory', 'reflection', 'skills', 'evolution'].includes(x.page) ? 'aw-active' : ''} ${x.page === 'settings' ? 'settings-active' : ''} ${chat ? 'chat-active' : ''}`}
    >
      <div className="app-body">
        <aside ref={sidebar} className={`sidebar ${mobile ? 'shown' : ''} ${collapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-brand">
            <Command size={23} />
            <strong>Agent</strong>
            <IconButton
              label="收起导航"
              onClick={() => {
                setMobile(false);
                setCollapsed(true);
              }}
            >
              <PanelLeftClose size={16} />
            </IconButton>
          </div>
          <button type="button" className="sidebar-search" onClick={() => setSearch(true)}>
            <Search size={15} />
            搜索会话<kbd>⌘ K</kbd>
          </button>
          <Button
            className="new-session"
            onClick={() => {
              host.create();
              setMobile(false);
            }}
          >
            <Plus size={16} />
            新会话
          </Button>
          <div className="nav-label">
            最近会话 <span>{x.sessions.length}</span>
          </div>
          <nav className="session-list" aria-label="最近会话">
            {x.sessions.map((s) => (
              <button
                type="button"
                key={s.id}
                data-session={s.id}
                disabled={s.unavailable}
                title={s.error || s.project}
                className={s.id === x.sid && sessionView ? 'selected' : ''}
                aria-current={s.id === x.sid && sessionView ? 'page' : undefined}
                onClick={() => selectSession(s.id)}
              >
                <MessageSquare size={14} />
                <span>
                  {s.run === 'running' && <i className="running-dot" />}
                  <strong>{s.title}</strong>
                  <small>{s.unavailable ? s.error || '暂不可恢复' : s.project.split('/').filter(Boolean).at(-1)}</small>
                </span>
              </button>
            ))}
            {!x.sessions.length && <p className="muted">你的会话会保留在这里</p>}
          </nav>
          <div className="nav-label">项目</div>
          <div className="project-path" title={x.session.project}>
            <Folder size={15} />
            {x.session.project.split('/').filter(Boolean).at(-1) || (x.page === 'memory' ? '全局记忆' : '未选择项目')}
            <small>{x.session.project}</small>
          </div>
          <div className="navigation-divider" />
          <div className="nav-label">工作空间</div>
          <nav className="module-nav" aria-label="主要模块">
            {modules.map(({ id, label, icon: Icon }) => (
              <button
                type="button"
                key={id}
                aria-label={label}
                aria-current={x.page === id ? 'page' : undefined}
                className={`${id === 'skills' ? 'aw-nav-group-start' : ''} ${x.page === id ? 'selected' : ''} ${id === 'reflection' ? 'secondary-entry' : ''}`}
                onClick={() => select(id)}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <button type="button" aria-label="模型与连接" onClick={() => select('settings')}>
              <span className={`connection-dot ${x.connected ? '' : 'offline'}`} />
              <span>
                模型与连接<small>{host.connection}</small>
              </span>
              <Settings size={15} />
            </button>
          </div>
        </aside>
        {mobile && !collapsed && (
          <button type="button" className="navigation-scrim" aria-label="关闭导航" onClick={() => setMobile(false)} />
        )}
        <main className={`workspace ${collapsed ? 'expanded' : ''}`}>
          <header className="workspace-head">
            <div className="breadcrumbs">
              {!!x.history.length && !chat && (
                <IconButton label="返回上一个位置" onClick={x.back}>
                  <ArrowLeft size={15} />
                </IconButton>
              )}
              <IconButton
                label="打开导航"
                onClick={() => {
                  setMobile(!mobile);
                  setCollapsed(false);
                }}
              >
                <MenuIcon size={18} />
              </IconButton>
              <span>{sessionView ? x.session.project.split('/').filter(Boolean).at(-1) : '工作空间'}</span>
              <span>/</span>
              {chat ? (
                <div className="session-heading">
                  <span title={x.session.project}>{x.session.project.split('/').filter(Boolean).at(-1)}</span>
                  <h1 title={x.session.title}>{x.session.title}</h1>
                </div>
              ) : (
                <strong>
                  {sessionView ? x.session.title : modules.find((item) => item.id === x.page)?.label || '模型与连接'}
                </strong>
              )}
            </div>
            <div className="head-actions">
              {sessionView && !!x.sid && (
                <>
                  <div id="a-chat-actions" />
                  <nav className="session-view-switch" aria-label="会话视图">
                    <button type="button" aria-current={chat ? 'page' : undefined} onClick={() => select('chat')}>
                      对话
                    </button>
                    <button type="button" aria-current={!chat ? 'page' : undefined} onClick={() => select('trace')}>
                      轨迹
                    </button>
                  </nav>
                  <Menu
                    label="当前会话操作"
                    items={[{ label: '查看完整任务标题', onSelect: () => setTitleOpen(true) }]}
                  >
                    <MoreHorizontal size={18} />
                  </Menu>
                </>
              )}
            </div>
          </header>
          {!x.connected && (
            <div className="connection-banner" role="status">
              {host.connection}，已提交任务不会重复执行。
              <button type="button" onClick={host.retry}>
                重新连接
              </button>
            </div>
          )}
          {children}
        </main>
      </div>
      <Modal open={search} onClose={() => setSearch(false)} title="搜索会话">
        <SearchBox value={query} onChange={setQuery} placeholder="搜索会话" />
        <div className="search-results">
          {x.sessions
            .filter((s) => s.title.toLowerCase().includes(query.toLowerCase()))
            .map((s) => (
              <button type="button" key={s.id} disabled={s.unavailable} onClick={() => selectSession(s.id)}>
                <span>{s.title}</span>
                <small>{s.project.split('/').filter(Boolean).at(-1)}</small>
              </button>
            ))}
        </div>
      </Modal>
      <Modal open={titleOpen} onClose={() => setTitleOpen(false)} title="完整任务标题">
        <p>{x.session.title}</p>
        <p className="muted">{x.session.project}</p>
      </Modal>
      {host.dialogs}
    </div>
  );
}
