import { useState, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import {
  Command,
  Search,
  Plus,
  MessageSquare,
  BookOpen,
  Layers,
  Settings,
  PanelLeftClose,
  MoreHorizontal,
  ArrowUpRight,
  ChevronDown,
  Radio,
  Lightbulb,
  History,
  Folder,
  RotateCcw,
  ArrowLeft,
  Menu as MenuIcon,
} from 'lucide-react';
import { samples } from '../state/samples';
import { useDemo, type Demo } from '../state/store';
import type { Page, Scenario, Mode, Session, Knowledge, Skill } from '../state/model';
import { Button, IconButton, Modal, Field, SearchBox, Menu, Status } from './ui';
const nav: { id: Page; label: string; icon: typeof BookOpen }[] = [
  { id: 'chat', label: '会话', icon: MessageSquare },
  { id: 'memory', label: '记忆', icon: BookOpen },
  { id: 'reflection', label: '反思', icon: Radio },
  { id: 'evolution', label: '能力改进', icon: ArrowUpRight },
  { id: 'skills', label: '能力库', icon: Layers },
];
export interface ShellController {
  mode: Mode;
  page: Page;
  sid: string;
  session: Pick<Session, 'id' | 'title' | 'project' | 'run'>;
  d: {
    sessions: Array<Pick<Session, 'id' | 'title' | 'project' | 'run' | 'archived'>>;
    connection: boolean;
    memories: Array<Pick<Knowledge, 'id' | 'title' | 'kind' | 'status'>>;
    skills: Array<Pick<Skill, 'id' | 'name' | 'version' | 'enabled'>>;
    phase: string;
  };
  scenario: Scenario;
  history: unknown[];
  go: (page: Page) => void;
  back: () => void;
  setSid: (id: string) => void;
  updateSession: (value: Partial<Session>) => void;
  setObject: (kind: 'memory' | 'skills' | 'reflection' | 'trace' | 'evolution', id: string) => void;
  notify: (value: string) => void;
  createSession: (title?: string, project?: string) => void;
  toast: string;
}
export function Shell({ children }: { children: ReactNode }) {
  const demo = useDemo();
  return (
    <ShellSurface x={demo} demo={demo}>
      {children}
    </ShellSurface>
  );
}
export function ShellSurface({
  children,
  x,
  demo,
  host,
}: {
  children: ReactNode;
  x: ShellController;
  demo?: Demo;
  host?: { create: () => void; retry: () => void; connection: string; dialogs?: ReactNode };
}) {
  const [search, S] = useState(false);
  const [query, Q] = useState('');
  const [create, C] = useState(false);
  const [title, T] = useState('');
  const [project, P] = useState('~/Projects/agent');
  const [mobile, M] = useState(false);
  const [collapsed, CL] = useState(false);
  const [rename, R] = useState(false);
  const [newTitle, NT] = useState('');
  const studio = x.mode === 'studio';
  const chatRoom = !studio && x.page === 'chat';
  const testTools = !host && new URLSearchParams(window.location.search).get('test') === '1';
  const productNav = [
    { id: 'evolution' as Page, label: '改进建议', icon: Lightbulb },
    { id: 'memory' as Page, label: '记忆', icon: BookOpen },
    { id: 'skills' as Page, label: '技能与工具', icon: Layers },
    { id: 'reflection' as Page, label: '反思记录', icon: History },
  ];
  const workspaceNav = [productNav[1], productNav[3], productNav[2], productNav[0]];
  const primary = ['chat', 'trace'].includes(x.page)
    ? '工作'
    : ['memory', 'reflection'].includes(x.page)
      ? '认识'
      : ['skills', 'evolution'].includes(x.page)
        ? '能力'
        : '设置';
  const select = (p: Page) => {
    x.go(p);
    M(false);
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') M(false);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        S((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => {
    if (studio || !mobile || !window.matchMedia('(max-width: 700px)').matches) return;
    const sidebar = document.querySelector<HTMLElement>('.sidebar');
    const previous = document.activeElement as HTMLElement | null;
    sidebar?.querySelector<HTMLButtonElement>('button')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = sidebar?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.removeEventListener('keydown', trap);
      previous?.focus();
    };
  }, [mobile, studio]);
  const scrolls = useRef<Record<string, number>>({});
  useLayoutEffect(() => {
    if (host) return;
    const el = document.querySelector('.workspace');
    if (!el) return;
    el.scrollTop = scrolls.current[x.page] ?? 0;
    return () => {
      scrolls.current[x.page] = el.scrollTop;
    };
  }, [x.page]);
  const sessions = x.d.sessions.filter((s) => !s.archived);
  return (
    <div
      className={`app ${host ? 'host-product' : ''} ${x.mode} ${!studio && ['memory', 'reflection', 'skills', 'evolution'].includes(x.page) ? 'aw-active' : ''} ${x.page === 'settings' ? 'settings-active' : ''} ${chatRoom ? 'chat-active' : ''} ${!studio && !testTools ? 'product-view' : ''}`}
    >
      {(studio || testTools) && (
        <div className="prototype-bar">
          <span>
            <span className="prototype-dot" />
            独立设计 Demo <span className="bar-divider">/</span> {studio ? 'B · 工作册' : 'A · 会话书桌'}
          </span>
          <div>
            {!studio && (
              <Menu
                label="会话样例"
                items={samples.map((s) => ({
                  label: s.title,
                  onSelect: () => {
                    demo?.updateSession({
                      title: s.title,
                      messages: [s.text],
                      transcript: [
                        { role: 'user', text: s.text },
                        { role: 'assistant', text: s.answer },
                      ],
                      run: 'done',
                      refs: [],
                    });
                    demo?.go('chat');
                  },
                }))}
              >
                会话样例
                <ChevronDown size={12} />
              </Menu>
            )}
            <Menu
              label="切换演示场景"
              items={[
                ...(['normal', 'loading', 'empty', 'error', 'long', 'offline'] as Scenario[]).map((s, i) => ({
                  label: ['日常状态', '加载', '空内容', '读取失败', '长内容', '连接中断'][i],
                  onSelect: () => {
                    demo?.setScenario(s);
                    if (s === 'offline') demo?.patch({ connection: false });
                    else demo?.patch({ connection: true });
                  },
                })),
                ...(!studio && demo?.page === 'memory'
                  ? [
                      {
                        label: demo?.memoryConflict ? '取消下次编辑冲突' : '下次编辑发生冲突',
                        onSelect: () => demo?.setMemoryConflict(!demo?.memoryConflict),
                      },
                    ]
                  : []),
              ]}
            >
              <span>场景</span>
              <ChevronDown size={12} />
            </Menu>
            <Menu
              label="开发演示结果"
              items={[
                { label: '检查通过', onSelect: () => demo?.setOutcome('success') },
                { label: '检查失败', onSelect: () => demo?.setOutcome('failure') },
                { label: '无需修改', onSelect: () => demo?.setOutcome('nochange') },
              ]}
            >
              <span>开发结果</span>
              <ChevronDown size={12} />
            </Menu>
            <button type="button" onClick={() => demo?.switchMode(studio ? 'quiet' : 'studio')}>
              比较{studio ? ' A' : ' B'} <ArrowUpRight size={12} />
            </button>
            <IconButton label="重置演示" onClick={demo?.reset}>
              <RotateCcw size={13} />
            </IconButton>
          </div>
        </div>
      )}
      {studio && (
        <div className="workbook-top">
          <div className="wordmark">
            <Command size={21} />
            <span>Agent</span>
            <small>个人工作空间</small>
          </div>
          <nav aria-label="工作空间">
            {['工作', '认识', '能力'].map((n) => (
              <button
                type="button"
                key={n}
                aria-current={primary === n ? 'page' : undefined}
                onClick={() => select(n === '工作' ? 'chat' : n === '认识' ? 'memory' : 'skills')}
              >
                {n}
              </button>
            ))}
          </nav>
          <div className="top-actions">
            <IconButton label="搜索工作空间" onClick={() => S(true)}>
              <Search size={17} />
            </IconButton>
            <IconButton label="模型与连接" onClick={() => select('settings')}>
              <Settings size={17} />
            </IconButton>
          </div>
        </div>
      )}
      <div className="app-body">
        <aside className={`sidebar ${mobile ? 'shown' : ''} ${collapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-brand">
            {!studio ? (
              <>
                <Command size={23} />
                <strong>Agent</strong>
                <IconButton
                  label="收起导航"
                  onClick={() => {
                    M(false);
                    CL(true);
                  }}
                >
                  <PanelLeftClose size={16} />
                </IconButton>
              </>
            ) : (
              <>
                <span className="eyebrow">{primary}目录</span>
                <IconButton
                  label="收起导航"
                  onClick={() => {
                    M(false);
                    CL(true);
                  }}
                >
                  <PanelLeftClose size={16} />
                </IconButton>
              </>
            )}
          </div>
          {!studio && (
            <button type="button" className="sidebar-search" onClick={() => S(true)}>
              <Search size={15} />
              {host ? '搜索会话' : '搜索会话与内容'}
              <kbd>⌘ K</kbd>
            </button>
          )}
          {(!studio || primary === '工作') && (
            <>
              <Button
                className="new-session"
                onClick={() => {
                  if (host) {
                    M(false);
                    host.create();
                  } else C(true);
                }}
              >
                <Plus size={16} />
                新会话
              </Button>
              <div className="nav-label">
                {studio ? '今天' : '最近会话'}
                <span>{sessions.length}</span>
              </div>
              <div className="session-list">
                {sessions.map((s) => (
                  <button
                    type="button"
                    aria-current={x.sid === s.id && ['chat', 'trace'].includes(x.page) ? 'page' : undefined}
                    className={x.sid === s.id && ['chat', 'trace'].includes(x.page) ? 'selected' : ''}
                    key={s.id}
                    data-session={host ? s.id : undefined}
                    onClick={() => {
                      x.setSid(s.id);
                      select('chat');
                    }}
                  >
                    <MessageSquare size={14} />
                    <span>
                      <strong title={host ? s.title : undefined}>
                        {x.scenario === 'long' && s.id === 'compare'
                          ? '比较两版项目说明：跨版本认证迁移、备份恢复及兼容边界的完整分析'
                          : s.title}
                      </strong>
                      {host && <small title={s.project}>{s.project.split('/').filter(Boolean).at(-1)}</small>}
                      {studio && (
                        <small>
                          {s.run === 'done' ? '已结束 · 正文比较完成' : s.run === 'running' ? '正在执行' : '尚未发送'}
                        </small>
                      )}
                    </span>
                    {s.run === 'running' && <i className="live-dot" />}
                  </button>
                ))}
              </div>
              <div className="nav-label">{studio ? '项目目录' : '项目'}</div>
              <div className="project-path">
                {studio ? <span className="folder-icon">▱</span> : <Folder size={15} />}{' '}
                {host && !x.session.project
                  ? x.page === 'memory'
                    ? '全局记忆'
                    : '未选择项目'
                  : chatRoom || host
                    ? x.session.project.split('/').pop()
                    : 'agent'}{' '}
                <small>{chatRoom || host ? x.session.project : '~/Projects/agent'}</small>
              </div>
            </>
          )}
          {!studio ? (
            <>
              <div className="navigation-divider" />
              <div className="nav-label">工作空间</div>
              <nav className="module-nav" aria-label="主要模块">
                {workspaceNav.map(({ id, label, icon: I }) => (
                  <button
                    type="button"
                    key={id}
                    aria-label={label}
                    aria-current={x.page === id ? 'page' : undefined}
                    className={`${id === 'skills' ? 'aw-nav-group-start' : ''} ${x.page === id ? 'selected' : ''} ${!studio && id === 'reflection' ? 'secondary-entry' : ''}`}
                    onClick={() => select(id)}
                  >
                    <I size={16} />
                    {label}
                  </button>
                ))}
              </nav>
            </>
          ) : (
            <nav className="workbook-subnav" aria-label="主要模块">
              {(primary === '工作'
                ? [
                    { id: 'chat' as Page, label: '工作结果', icon: MessageSquare },
                    { id: 'trace' as Page, label: '执行记录', icon: Radio },
                  ]
                : primary === '认识'
                  ? nav.filter((n) => ['memory', 'reflection'].includes(n.id))
                  : primary === '能力'
                    ? nav.filter((n) => ['skills', 'evolution'].includes(n.id))
                    : [{ id: 'settings' as Page, label: '模型与连接', icon: Settings }]
              ).map(({ id, label, icon: I }) => (
                <button
                  type="button"
                  key={id}
                  aria-label={label}
                  aria-current={x.page === id ? 'page' : undefined}
                  className={x.page === id ? 'selected' : ''}
                  onClick={() => select(id)}
                >
                  <I size={16} />
                  {label}
                </button>
              ))}
              {primary === '能力' && (
                <div className="sidebar-note">
                  <span className="eyebrow">
                    {['suggestion', 'discussion'].includes(x.d.phase) ? '待你决定' : '最近的能力活动'}
                  </span>
                  <button type="button" onClick={() => select('evolution')}>
                    让差异报告说明证据缺口 <ChevronDown size={13} />
                  </button>
                </div>
              )}
            </nav>
          )}
          {studio && primary === '认识' && (
            <div className="workspace-object-nav">
              <div className="nav-label">最近的认识</div>
              {x.d.memories
                .filter((m) => m.status === 'current')
                .map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    onClick={() => {
                      x.setObject('memory', m.id);
                      select('memory');
                    }}
                  >
                    <span>{m.kind}</span>
                    {m.title}
                  </button>
                ))}
            </div>
          )}
          {studio && primary === '能力' && (
            <div className="workspace-object-nav">
              <div className="nav-label">已管理的 Skill</div>
              {x.d.skills.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => {
                    x.setObject('skills', s.id);
                    select('skills');
                  }}
                >
                  <span className={`tiny-dot ${s.enabled ? 'enabled' : ''}`} />
                  {s.name}
                  <small>v{s.version}</small>
                </button>
              ))}
            </div>
          )}
          <div className="sidebar-bottom">
            <button type="button" aria-label="模型与连接" onClick={() => select('settings')}>
              <span className={`connection-dot ${x.d.connection ? '' : 'offline'}`} />
              <span>
                {x.d.connection ? (studio ? '本机 Host' : '模型与连接') : '连接中断'}
                <small>
                  {host
                    ? host.connection
                    : studio
                      ? '模拟连接 · 不访问本机数据'
                      : x.d.connection
                        ? '已连接'
                        : '等待重新连接'}
                </small>
              </span>
              <Settings size={15} />
            </button>
          </div>
        </aside>
        {!studio && mobile && !collapsed && (
          <button type="button" className="navigation-scrim" aria-label="关闭导航" onClick={() => M(false)} />
        )}
        <main className={`workspace ${collapsed ? 'expanded' : ''}`}>
          <header className="workspace-head">
            <div className="breadcrumbs">
              {x.history.length > 0 && !chatRoom && (
                <IconButton label="返回上一个位置" onClick={x.back}>
                  <ArrowLeft size={15} />
                </IconButton>
              )}
              <IconButton
                label="打开导航"
                onClick={() => {
                  M(!mobile);
                  CL(false);
                }}
              >
                <MenuIcon size={18} />
              </IconButton>
              <span>
                {studio || ['chat', 'trace'].includes(x.page) ? x.session.project.split('/').pop() : '工作空间'}
              </span>
              <span>/</span>
              {chatRoom ? (
                <div className="session-heading">
                  <span title={x.session.project}>{x.session.project.split('/').pop()}</span>
                  <h1 title={x.session.title}>{x.session.title}</h1>
                </div>
              ) : (
                <strong>
                  {['chat', 'trace'].includes(x.page)
                    ? x.session.title
                    : ((studio ? nav : productNav).find((n) => n.id === x.page)?.label ?? '模型与连接')}
                </strong>
              )}
            </div>
            <div className="head-actions">
              {chatRoom && (
                <>
                  <div id="a-chat-actions" />
                  <nav className="session-view-switch" aria-label="会话视图">
                    <button type="button" aria-current="page">
                      对话
                    </button>
                    <button type="button" onClick={() => select('trace')}>
                      轨迹
                    </button>
                  </nav>
                </>
              )}
              {!chatRoom && (
                <Status tone={x.d.connection ? 'neutral' : 'warn'}>{x.d.connection ? '本机' : '离线'}</Status>
              )}
              {['chat', 'trace'].includes(x.page) && (
                <Menu
                  label="当前会话操作"
                  items={[
                    ...(chatRoom && x.history.length > 0 ? [{ label: '返回上一个位置', onSelect: x.back }] : []),
                    ...(!host
                      ? [
                          {
                            label: '重命名会话',
                            onSelect: () => {
                              NT(x.session.title);
                              R(true);
                            },
                          },
                          { label: '查看历史分支', onSelect: () => select('trace') },
                          {
                            label: '归档当前会话',
                            onSelect: () => {
                              x.updateSession({ archived: true });
                              x.setSid(x.d.sessions.find((s) => s.id !== x.sid && !s.archived)?.id ?? x.sid);
                              x.notify('会话已归档；执行记录保留。');
                            },
                          },
                        ]
                      : [
                          {
                            label: '查看完整任务标题',
                            onSelect: () => {
                              NT(x.session.title);
                              R(true);
                            },
                          },
                          { label: '查看执行记录', onSelect: () => select('trace') },
                        ]),
                  ]}
                >
                  <MoreHorizontal size={18} />
                </Menu>
              )}
            </div>
          </header>
          {!x.d.connection && (
            <div className="connection-banner" role="status">
              连接已中断，主机上的任务可能仍在运行。
              <button
                type="button"
                onClick={() => {
                  if (host) host.retry();
                  else {
                    demo?.patch({ connection: true });
                    demo?.setScenario('normal');
                  }
                }}
              >
                重新连接
              </button>
            </div>
          )}
          {children}
        </main>
      </div>
      <Modal
        open={search}
        onClose={() => S(false)}
        title="搜索工作空间"
        description={host ? undefined : studio ? '查找会话、认识和能力' : '查找会话、记忆和技能'}
      >
        <SearchBox
          value={query}
          onChange={Q}
          placeholder={host ? '搜索会话' : studio ? '搜索会话、认识或 Skill' : '搜索会话、记忆或技能'}
        />
        <div className="search-results">
          {[
            ...x.d.sessions.map((s) => ({
              title: s.title,
              type: '会话',
              action: () => {
                x.setSid(s.id);
                x.go('chat');
              },
            })),
            ...x.d.memories
              .filter((m) => studio || m.status !== 'deleted')
              .map((m) => ({
                title: m.title,
                type: '记忆',
                action: () => {
                  x.setObject('memory', m.id);
                  x.go('memory');
                },
              })),
            ...x.d.skills.map((s) => ({
              title: s.name,
              type: 'Skill',
              action: () => {
                x.setObject('skills', s.id);
                x.go('skills');
              },
            })),
          ]
            .filter((i) => i.title.toLowerCase().includes(query.toLowerCase()))
            .map((i) => (
              <button
                type="button"
                key={`${i.type}:${i.title}`}
                onClick={() => {
                  i.action();
                  if (host) M(false);
                  S(false);
                }}
              >
                <span>{i.title}</span>
                <small>{i.type}</small>
              </button>
            ))}
        </div>
      </Modal>
      <Modal
        open={!host && create}
        onClose={() => C(false)}
        title="开始一段新会话"
        description="任务在 Host 项目目录中执行。"
      >
        <Field label="会话名称">
          <input value={title} onChange={(e) => T(e.target.value)} placeholder="例如：整理发布说明" />
        </Field>
        <Field label="Host 工作目录" hint="只能选择演示项目；不会访问你的文件。">
          <select value={project} onChange={(e) => P(e.target.value)}>
            <option>~/Projects/agent</option>
            <option>~/Projects/notes</option>
          </select>
        </Field>
        <div className="modal-footer">
          <Button onClick={() => C(false)}>取消</Button>
          <Button
            kind="primary"
            onClick={() => {
              x.createSession(title || '新会话', project);
              if (!studio) {
                M(false);
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLTextAreaElement>('.quiet .session-composer textarea')
                    ?.focus({ preventScroll: true }),
                );
              }
              C(false);
              T('');
            }}
          >
            创建会话
          </Button>
        </div>
      </Modal>
      <Modal open={rename} onClose={() => R(false)} title={host ? '完整任务标题' : '重命名会话'}>
        {host ? (
          <p className="host-full-title">{newTitle}</p>
        ) : (
          <>
            <Field label="名称">
              <input value={newTitle} onChange={(e) => NT(e.target.value)} />
            </Field>
            <div className="modal-footer">
              <Button
                kind="primary"
                disabled={!newTitle.trim()}
                onClick={() => {
                  x.updateSession({ title: newTitle });
                  R(false);
                }}
              >
                保存名称
              </Button>
            </div>
          </>
        )}
      </Modal>
      {host?.dialogs}
      {x.toast && (
        <div className="toast" role="status">
          {x.toast}
        </div>
      )}
    </div>
  );
}
