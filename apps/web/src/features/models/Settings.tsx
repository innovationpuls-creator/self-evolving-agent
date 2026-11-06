import type { useHost } from '../../app/use-host';
import { ModelSettings } from './ModelSettings';
import './settings.css';

type Host = ReturnType<typeof useHost>;

const connectionLabel = {
  connecting: '正在连接本机服务',
  syncing: '正在同步',
  ready: '已连接本机服务',
  offline: '本机服务已断开，正在重连',
  auth_required: '需要重新连接本机服务',
  forbidden: '本机服务拒绝了访问',
} as const;

export function Settings({ host, back }: { host: Host; back: () => void }) {
  const ready = host.connection === 'ready';
  return (
    <section className="d6-settings" aria-labelledby="settings-title">
      <header className="aw-heading">
        <h1 id="settings-title" tabIndex={-1}>
          模型与连接
        </h1>
        {!ready && (
          <div className="d6-connection-control">
            <span className="d6-connection-status" role="status" title={location.origin}>
              <i aria-hidden="true" />
              {connectionLabel[host.connection]}
            </span>
            <button type="button" onClick={host.retry}>
              重新连接
            </button>
          </div>
        )}
      </header>

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
    </section>
  );
}
