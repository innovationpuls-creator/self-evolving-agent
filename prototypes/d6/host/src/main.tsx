import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as Dialog from '@radix-ui/react-dialog';
import { Command, History, MessageSquare, Menu, X } from 'lucide-react';
import { useHost } from '../../../../apps/web/src/app/use-host';
import { Button, Notice } from './ui';
import { useNavigation } from './navigation';
import { Catalog, ReflectionDetail, projectName } from './Reflection';
import { SessionPage } from './Session';
import { Result } from './Result';
import { Source } from './Source';
import '../../src/styles.css';
import '../../src/workspace/workspace.css';
import './style.css';
function App() {
  const nav = useNavigation();
  const host = useHost(nav.route.page === 'session' ? nav.route.sessionId : undefined);
  const [token, setToken] = useState(''),
    [mobile, setMobile] = useState(false);
  useEffect(() => {
    setMobile(false);
  }, [nav.key]);
  const route = nav.route;
  const locked = ['auth_required', 'forbidden'].includes(host.connection);
  const ready = host.connection === 'ready';
  const sidebar = (
    <>
      <div className="sidebar-brand">
        <Command size={23} />
        <strong>Agent</strong>
      </div>
      <div className="nav-label">最近会话</div>
      <nav className="session-list" aria-label="真实会话">
        {host.sessions.map((session) => (
          <button
            type="button"
            data-session={session.id}
            aria-current={route.page === 'session' && route.sessionId === session.id ? 'page' : undefined}
            key={session.id}
            onClick={() => nav.go({ page: 'session', sessionId: session.id })}
          >
            <MessageSquare size={15} />
            <span>
              <strong>{session.title || '未命名会话'}</strong>
              <small title={session.cwd}>{projectName(session.cwd)}</small>
            </span>
            {session.busy && <i className="live-dot" />}
          </button>
        ))}
      </nav>
      <div className="navigation-divider" />
      <nav className="module-nav" aria-label="工作空间">
        <button type="button" onClick={() => nav.go({ page: 'session' })}>
          <MessageSquare size={16} />
          所有会话
        </button>
        <button
          type="button"
          aria-current={route.page === 'reflections' && !route.sessionId ? 'page' : undefined}
          onClick={() => nav.go({ page: 'reflections', offset: 0 })}
        >
          <History size={16} />
          反思记录
        </button>
      </nav>
      <div className="sidebar-bottom">
        <span className={`connection-dot ${ready ? '' : 'offline'}`} />
        <span>
          {ready ? '本机 Host' : '连接未就绪'}
          <small>{location.origin}</small>
        </span>
      </div>
    </>
  );
  return (
    <div className="app quiet product-view aw-active live-host">
      <div className="app-body">
        {!locked && <aside className="sidebar live-desktop-sidebar">{sidebar}</aside>}
        <main className="workspace" key={locked ? 'locked' : 'readable'}>
          <header className="workspace-head">
            <div className="breadcrumbs">
              {!locked && (
                <Dialog.Root open={mobile} onOpenChange={setMobile}>
                  <Dialog.Trigger asChild>
                    <button type="button" className="icon-btn live-menu" aria-label="打开导航">
                      <Menu size={18} />
                    </button>
                  </Dialog.Trigger>
                  <Dialog.Portal>
                    <Dialog.Overlay className="live-mobile-overlay" />
                    <Dialog.Content className="sidebar shown live-mobile-sidebar">
                      <Dialog.Title className="sr-only">工作空间导航</Dialog.Title>
                      <Dialog.Description className="sr-only">选择真实 Host 会话或反思记录</Dialog.Description>
                      <Dialog.Close asChild>
                        <button type="button" className="icon-btn live-close" aria-label="关闭导航">
                          <X size={18} />
                        </button>
                      </Dialog.Close>
                      {sidebar}
                    </Dialog.Content>
                  </Dialog.Portal>
                </Dialog.Root>
              )}
              <span>工作空间</span>
              <span>/</span>
              <strong>
                {route.page === 'session'
                  ? '会话'
                  : route.page === 'result'
                    ? '关联成果'
                    : route.page === 'source'
                      ? '来源'
                      : '反思记录'}
              </strong>
            </div>
          </header>
          <div className="aw live-page">
            {locked ? (
              <form
                className="live-connect"
                onSubmit={(e) => {
                  e.preventDefault();
                  void host
                    .connect(token)
                    .then(() => setToken(''))
                    .catch(() => {});
                }}
              >
                <h1>连接 Agent Host</h1>
                <p>使用当前 Host 的连接令牌。</p>
                {host.error && <p role="alert">{host.error}</p>}
                <label htmlFor="connection-token">连接令牌</label>
                <input
                  id="connection-token"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                <Button type="submit" disabled={!token} kind="primary">
                  连接
                </Button>
              </form>
            ) : (
              <>
                {!ready && (
                  <Notice title={host.connection === 'offline' ? '连接中断' : '正在同步 Host'} tone="warn">
                    <p>{host.error || '恢复连接后读取最新状态。'}</p>
                    <Button onClick={host.retry}>重新连接</Button>
                  </Notice>
                )}
                {host.error && ready && (
                  <Notice title="Host 提示" tone="warn">
                    {host.error}
                  </Notice>
                )}
                {ready && (
                  <div key={nav.key}>
                    {route.page === 'session' ? (
                      <SessionPage host={host} route={route} go={nav.go} />
                    ) : route.page === 'reflections' ? (
                      <Catalog api={host.api} sessions={host.sessions} route={route} go={nav.go} />
                    ) : route.page === 'reflection' ? (
                      <ReflectionDetail
                        api={host.api}
                        sessions={host.sessions}
                        route={route}
                        go={nav.go}
                        back={nav.back}
                      />
                    ) : route.page === 'result' ? (
                      <Result api={host.api} route={route} go={nav.go} back={nav.back} />
                    ) : (
                      <Source api={host.api} route={route} go={nav.go} back={nav.back} />
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
