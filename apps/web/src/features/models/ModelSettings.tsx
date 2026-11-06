import { useEffect, useRef, useState } from 'react';
import type { ProviderAuthFlow, ProviderAuthStatus } from '../../../../host/runtime/provider-auth';
import type { ReflectionApi } from '../reflection/reflection-state';
import { groupProviders, providerName } from './provider-names';

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
  const catalogName = (id: string) => catalog.find((item) => item.id === id)?.name;
  const nameOf = (id: string) => providerName(id, catalogName(id));
  const groups = groupProviders(providers, catalogName);
  const connected = catalog.filter((item) => item.stored || item.configured);
  const hasOAuth = !!selected?.methods.some((method) => method.type === 'oauth');

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
          if (next.status === 'succeeded') setNotice('登录完成，可以开始使用。');
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

  const logout = async (id: string) => {
    if (locked) return;
    setBusy(true);
    setError('');
    setNotice('');
    setKey('');
    try {
      const result = await api<ProviderAuthStatus>('/provider-auth/logout', 'POST', { provider: id });
      setNotice(
        result.configured
          ? '已退出登录，只移除了这里保存的凭据；该提供方仍会使用环境变量或配置文件中的授权。'
          : '已退出登录，只移除了这里保存的凭据，提供方账号和本机其他授权不受影响。',
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
      setNotice(importExisting ? '已导入本机已有登录，可以开始会话。' : 'API Key 已保存，可以开始会话。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '模型设置未完成');
    } finally {
      setBusy(false);
    }
  };
  const keyEntry = (
    <>
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
        <button className={hasOAuth ? undefined : 'primary'} type="submit" disabled={!key.trim()}>
          保存 Key
        </button>
        {selected?.methods
          .filter((method) => method.type !== 'oauth')
          .map((method) => (
            <button type="button" key={method.type} onClick={() => void login(method.type)}>
              配置 {method.label}
            </button>
          ))}
        {!hasOAuth && !selected?.stored && (
          <button type="button" onClick={() => void save(true)}>
            从本机导入已有登录
          </button>
        )}
      </div>
    </>
  );
  return (
    <section className={`model-panel${embedded ? ' model-panel-embedded' : ''}`}>
      {!embedded && (
        <header>
          <div>
            <h1>模型设置</h1>
          </div>
          <button type="button" onClick={onClose} disabled={busy || loggingIn}>
            返回工作区
          </button>
        </header>
      )}
      <div className="settings-body">
        {connected.length > 0 && (
          <ul className="model-connected" aria-label="已连接的提供方">
            {connected.map((item) => (
              <li key={item.id} title={item.stored ? undefined : '环境变量或配置文件'}>
                <span>{nameOf(item.id)}</span>
                {item.stored && (
                  <button
                    type="button"
                    aria-label={`退出登录 ${nameOf(item.id)}`}
                    disabled={locked}
                    onClick={() => void logout(item.id)}
                  >
                    退出登录
                  </button>
                )}
              </li>
            ))}
          </ul>
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
                {groups.common.length > 0 && (
                  <optgroup label="常用">
                    {groups.common.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {groups.other.length > 0 && (
                  <optgroup label="其他">
                    {groups.other.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            {hasOAuth && (
              <div className="settings-actions">
                {selected?.methods
                  .filter((method) => method.type === 'oauth')
                  .map((method) => (
                    <button className="primary" type="button" key={method.type} onClick={() => void login(method.type)}>
                      登录 {method.label}
                    </button>
                  ))}
                {!selected?.stored && (
                  <button type="button" onClick={() => void save(true)}>
                    从本机导入已有登录
                  </button>
                )}
              </div>
            )}
            {hasOAuth ? (
              <details className="model-key-entry">
                <summary>使用 API Key</summary>
                {keyEntry}
              </details>
            ) : (
              keyEntry
            )}
          </fieldset>
        </form>
        {loggingIn && (
          <section aria-label="提供方登录" aria-live="polite">
            <h3>登录 {nameOf(flow.provider)}</h3>
            <p>在浏览器中完成授权；页面没有自动返回时，按提示粘贴最终地址或授权码。</p>
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
      </div>
    </section>
  );
}
