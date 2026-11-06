import type { useHost } from '../../app/use-host';
import { ModelSettings } from './ModelSettings';
import './settings.css';

type Host = ReturnType<typeof useHost>;

const connectionLabel = {
  connecting: '正在连接',
  syncing: '正在同步',
  ready: '已连接',
  offline: '正在恢复连接',
  auth_required: '需要连接',
  forbidden: '访问被拒绝',
} as const;

export function Settings({ host, back }: { host: Host; back: () => void }) {
  const ready = host.connection === 'ready';
  return (
    <section className="d6-settings" aria-labelledby="settings-title">
      <header className="d6-settings-heading">
        <div>
          <h1 id="settings-title" tabIndex={-1}>
            模型与连接
          </h1>
          <p>管理当前 Agent Host 使用的模型授权。</p>
        </div>
        <button type="button" className="d6-quiet-action" onClick={back}>
          返回工作区
        </button>
      </header>

      <div className="d6-settings-content">
        <section className="d6-host-connection" aria-label="Agent Host 连接">
          <div>
            <h2>Agent Host</h2>
            <p className="d6-host-origin">{location.origin}</p>
            <p className="d6-host-summary">模型请求、文件与工具操作由当前连接的 Host 执行。</p>
          </div>
          <div className="d6-connection-control">
            <span className={`d6-connection-status ${ready ? 'is-ready' : ''}`} role="status">
              <i aria-hidden="true" />
              {connectionLabel[host.connection]}
            </span>
            {!ready && (
              <button type="button" onClick={host.retry}>
                重新连接
              </button>
            )}
          </div>
        </section>

        {host.error && (
          <p className="d6-settings-notice" role="alert">
            {host.error}
          </p>
        )}

        <ModelSettings
          embedded
          api={host.api}
          providers={host.providers}
          ready={ready}
          onRefresh={host.refresh}
          onClose={back}
        />
      </div>
    </section>
  );
}
