import { useState } from 'react';
import type { ReflectionApi } from '../reflection/reflection-state';

export function ModelSettings({
  api,
  providers,
  ready,
  onRefresh,
  onClose,
}: {
  api: ReflectionApi;
  providers: Array<{ id: string }>;
  ready: boolean;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [provider, setProvider] = useState('openai-codex'),
    [key, setKey] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const save = async (importExisting: boolean) => {
    if (busy || !ready) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/credentials', 'POST', importExisting ? { provider, importExisting: true } : { provider, key });
      setKey('');
      await onRefresh();
      setNotice(importExisting ? '已导入 Pi 授权，可返回创建或继续会话。' : '模型凭据已保存，可返回选择模型。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '模型设置未完成');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="model-panel">
      <header>
        <div>
          <h1>模型设置</h1>
          <p>管理 Host 使用的模型授权</p>
        </div>
        <button type="button" onClick={onClose}>
          返回工作区
        </button>
      </header>
      <div className="settings-body">
        <span className="section-kicker">连接模型</span>
        <h2>为工作选择模型</h2>
        <p>凭据加密保存在 Host。本机 Pi 已有的授权可以导入为独立副本。</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save(false);
          }}
        >
          <fieldset disabled={busy || !ready}>
            <label>
              模型提供方
              <select aria-label="模型提供方" value={provider} onChange={(event) => setProvider(event.target.value)}>
                {providers.map((item) => (
                  <option key={item.id}>{item.id}</option>
                ))}
              </select>
            </label>
            <label>
              API Key
              <input
                aria-label="API Key"
                type="password"
                autoComplete="off"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder="输入该提供方的 API Key"
              />
            </label>
            <div className="settings-actions">
              <button className="primary" type="submit" disabled={!key.trim()}>
                保存 Key
              </button>
              <button type="button" onClick={() => void save(true)}>
                导入 Pi 授权
              </button>
            </div>
          </fieldset>
        </form>
        {busy && <p role="status">正在保存并更新模型列表…</p>}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <div className="settings-note">
          <h3>工作在哪台设备上运行？</h3>
          <p>模型请求、文件和工具操作都由当前连接的 Host 执行。浏览器负责输入和查看结果。</p>
          <code>{location.origin}</code>
        </div>
      </div>
    </section>
  );
}
