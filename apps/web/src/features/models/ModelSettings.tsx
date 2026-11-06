import { useEffect, useRef, useState } from 'react';
import type { ProviderAuthFlow, ProviderAuthStatus } from '../../../../host/runtime/provider-auth';
import type { ReflectionApi } from '../reflection/reflection-state';

export function ModelSettings({
  api,
  providers,
  ready,
  onRefresh,
  onClose,
  embedded = false,
}: {
  api: ReflectionApi;
  providers: Array<{ id: string }>;
  ready: boolean;
  onRefresh: () => Promise<void>;
  onClose: () => void;
  embedded?: boolean;
}) {
  const [provider, setProvider] = useState('openai-codex'),
    [key, setKey] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [catalog, setCatalog] = useState<ProviderAuthStatus[]>([]);
  const [flow, setFlow] = useState<ProviderAuthFlow>();
  const [answer, setAnswer] = useState('');
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const selected = catalog.find((item) => item.id === provider);
  const loggingIn = flow?.status === 'running';
  const locked = busy || loggingIn || !ready;

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    void Promise.all([
      api<ProviderAuthStatus[]>('/provider-auth', 'GET', undefined, controller.signal),
      api<ProviderAuthFlow | null>('/provider-auth/login', 'GET', undefined, controller.signal),
    ])
      .then(([items, active]) => {
        if (controller.signal.aborted) return;
        setCatalog(items);
        if (active) setFlow(active);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法读取授权状态');
      });
    return () => controller.abort();
  }, [api, ready]);

  useEffect(() => {
    if (!providers.some((item) => item.id === provider) && providers[0]) setProvider(providers[0].id);
  }, [providers, provider]);

  useEffect(() => {
    if (!ready || !flow || flow.status !== 'running') return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<ProviderAuthFlow>(
          `/provider-auth/login/${flow.id}`,
          'GET',
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (next.status === 'running') {
          setFlow(next);
          timer = setTimeout(() => void poll(), 750);
        } else {
          setAnswer('');
          if (next.status === 'failed') setError(next.error ?? '登录未完成');
          if (next.status === 'cancelled') setNotice('登录已取消。');
          if (next.status === 'succeeded') setNotice('登录完成，授权已保存在当前 Host。');
          try {
            setCatalog(await api<ProviderAuthStatus[]>('/provider-auth', 'GET', undefined, controller.signal));
            await refreshRef.current();
          } finally {
            if (!controller.signal.aborted) setFlow(next);
          }
        }
      } catch (reason) {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : '无法读取登录状态');
        timer = setTimeout(() => void poll(), 2000);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [api, ready, flow?.id, flow?.status]);

  useEffect(() => {
    setAnswer('');
  }, [flow?.prompt?.id]);

  useEffect(
    () => () => {
      const current = flowRef.current;
      if (current?.status === 'running') void api(`/provider-auth/login/${current.id}`, 'DELETE').catch(() => {});
    },
    [api],
  );

  const reload = async () => {
    setCatalog(await api<ProviderAuthStatus[]>('/provider-auth'));
    await onRefresh();
  };

  const login = async (type: 'oauth' | 'api_key') => {
    if (locked) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setFlow(await api<ProviderAuthFlow>('/provider-auth/login', 'POST', { provider, type }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法开始登录');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!flow || busy || !ready) return;
    setBusy(true);
    setError('');
    try {
      const next = await api<ProviderAuthFlow>(`/provider-auth/login/${flow.id}`, 'DELETE');
      setFlow(next);
      setAnswer('');
      setNotice(
        next.status === 'succeeded'
          ? '登录已完成，授权已保存。'
          : next.status === 'cancelled'
            ? '登录已取消。'
            : '请检查授权状态。',
      );
      if (next.error) setError(next.error);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '取消登录未完成');
    } finally {
      setBusy(false);
    }
  };

  const submitAnswer = async () => {
    if (!flow?.prompt || busy || !ready) return;
    setBusy(true);
    setError('');
    const value = answer;
    setAnswer('');
    try {
      setFlow(
        await api<ProviderAuthFlow>(`/provider-auth/login/${flow.id}/input`, 'POST', {
          promptId: flow.prompt.id,
          value,
        }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法提交授权输入');
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    if (locked) return;
    setBusy(true);
    setError('');
    setNotice('');
    setKey('');
    try {
      const result = await api<ProviderAuthStatus>('/provider-auth/logout', 'POST', { provider });
      setNotice(
        result.configured
          ? 'Host 保存的凭据已移除；该提供方仍可使用环境或配置中的授权。'
          : '已移除当前 Host 保存的凭据。',
      );
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '退出未完成');
    } finally {
      setBusy(false);
    }
  };
  const save = async (importExisting: boolean) => {
    if (locked) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/credentials', 'POST', importExisting ? { provider, importExisting: true } : { provider, key });
      setKey('');
      await reload();
      setNotice(importExisting ? '已导入 Pi 授权，可返回创建或继续会话。' : '模型凭据已保存，可返回选择模型。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '模型设置未完成');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`model-panel${embedded ? ' model-panel-embedded' : ''}`}>
      {!embedded && (
        <header>
          <div>
            <h1>模型设置</h1>
            <p>管理 Host 使用的模型授权</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy || loggingIn}>
            返回工作区
          </button>
        </header>
      )}
      <div className="settings-body">
        <span className="section-kicker">连接模型</span>
        <h2>为工作选择模型</h2>
        <p>凭据加密保存在 Host。本机 Pi 已有的授权可以导入为独立副本。</p>
        {selected && (
          <p role="status">
            {selected.stored
              ? `Host 已保存 ${selected.stored === 'oauth' ? 'OAuth' : 'API Key'} 凭据`
              : selected.configured
                ? '正在使用环境或配置中的授权'
                : 'Host 尚未配置授权'}
          </p>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save(false);
          }}
        >
          <fieldset disabled={locked}>
            <label>
              模型提供方
              <select
                aria-label="模型提供方"
                value={provider}
                onChange={(event) => {
                  setProvider(event.target.value);
                  setKey('');
                  setError('');
                  setNotice('');
                }}
              >
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
            <div className="settings-actions">
              {selected?.methods.map((method) => (
                <button type="button" key={method.type} onClick={() => void login(method.type)}>
                  {method.type === 'oauth' ? method.label : `配置 ${method.label}`}
                </button>
              ))}
              <button type="button" disabled={!selected?.stored} onClick={() => void logout()}>
                退出 Host 授权
              </button>
            </div>
          </fieldset>
        </form>
        {loggingIn && (
          <section aria-label="提供方登录" aria-live="polite">
            <h3>登录 {flow.provider}</h3>
            <p>在浏览器完成授权；若使用远程 Host，可按提示粘贴最终重定向地址或授权码。</p>
            {flow.events.map((event, index) => (
              <div key={`${event.type}-${index}`}>
                {event.type === 'auth_url' && (
                  <>
                    <a href={event.url} target="_blank" rel="noopener noreferrer">
                      打开提供方授权页面
                    </a>
                    {event.instructions && <p>{event.instructions}</p>}
                  </>
                )}
                {event.type === 'device_code' && (
                  <>
                    <a href={event.verificationUri} target="_blank" rel="noopener noreferrer">
                      打开设备授权页面
                    </a>
                    <p>
                      设备码：<code>{event.userCode}</code>
                    </p>
                    {event.expiresInSeconds !== undefined && <p>有效期 {event.expiresInSeconds} 秒</p>}
                  </>
                )}
                {(event.type === 'info' || event.type === 'progress') && <p>{event.message}</p>}
                {event.type === 'info' &&
                  event.links?.map((link) => (
                    <p key={link.url}>
                      <a href={link.url} target="_blank" rel="noopener noreferrer">
                        {link.label ?? '打开说明页面'}
                      </a>
                    </p>
                  ))}
              </div>
            ))}
            {flow.prompt && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitAnswer();
                }}
              >
                <fieldset disabled={busy || !ready}>
                  <label htmlFor={`auth-prompt-${flow.prompt.id}`}>
                    {flow.prompt.message}
                    {flow.prompt.type === 'select' ? (
                      <select
                        id={`auth-prompt-${flow.prompt.id}`}
                        aria-label="登录选项"
                        value={answer}
                        onChange={(event) => setAnswer(event.target.value)}
                      >
                        <option value="" disabled>
                          请选择
                        </option>
                        {flow.prompt.options.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                            {option.description ? ` — ${option.description}` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`auth-prompt-${flow.prompt.id}`}
                        aria-label="授权输入"
                        type={flow.prompt.type === 'text' ? 'text' : 'password'}
                        autoComplete="off"
                        spellCheck={false}
                        value={answer}
                        placeholder={flow.prompt.placeholder}
                        onChange={(event) => setAnswer(event.target.value)}
                        maxLength={16384}
                      />
                    )}
                  </label>
                  <button type="submit" disabled={flow.prompt.type === 'select' && !answer}>
                    继续
                  </button>
                </fieldset>
              </form>
            )}
            <button type="button" disabled={busy || !ready} onClick={() => void cancel()}>
              取消登录
            </button>
          </section>
        )}
        {busy && <p role="status">正在更新模型授权…</p>}
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
          <p>退出仅移除当前 Host 的独立凭据，不会删除 Pi 的原始授权、清除环境变量或在提供方撤销账号授权。</p>
          {!embedded && (
            <>
              <h3>工作在哪台设备上运行？</h3>
              <p>模型请求、文件和工具操作都由当前连接的 Host 执行。浏览器负责输入和查看结果。</p>
              <code>{location.origin}</code>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
