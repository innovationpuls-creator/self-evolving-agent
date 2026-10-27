import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthEvent, AuthPrompt, AuthType } from '@earendil-works/pi-ai';
import { CredentialSynchronizationError, type ModelRuntime } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import type { SensitiveData } from '../storage/storage.js';
import { body, json } from '../transport/http.js';

export interface ProviderAuthCallbacks {
  acquireMutation(): () => void;
  onChanged?(): Promise<void>;
}

export interface ProviderAuthStatus {
  id: string;
  name: string;
  methods: Array<{ type: AuthType; label: string }>;
  stored?: AuthType;
  configured: boolean;
  source?: string;
}

type PublicPrompt<Prompt> = Prompt extends unknown ? Omit<Prompt, 'signal'> : never;
export type ProviderAuthPrompt = PublicPrompt<AuthPrompt> & { id: string };
export interface ProviderAuthFlow {
  id: string;
  provider: string;
  type: AuthType;
  status: 'running' | 'succeeded' | 'cancelled' | 'failed';
  events: AuthEvent[];
  prompt?: ProviderAuthPrompt;
  error?: string;
  credentialChanged?: boolean;
}

export class ProviderAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

interface LoginFlow {
  view: ProviderAuthFlow;
  controller: AbortController;
  done: Promise<void>;
  rejectPrompt?: () => void;
  answer?: (value: string) => void;
}

export class ProviderAuthService {
  private flow?: LoginFlow;
  private mutation = false;
  private closing = false;
  private settled: Promise<void> = Promise.resolve();

  constructor(
    private runtime: ModelRuntime,
    private callbacks: ProviderAuthCallbacks,
    private sensitive: SensitiveData,
  ) {}

  async list(): Promise<ProviderAuthStatus[]> {
    const stored = new Map((await this.runtime.listCredentials()).map((item) => [item.providerId, item.type]));
    return this.runtime.getProviders().map((provider) => {
      const methods: ProviderAuthStatus['methods'] = [];
      if (provider.auth.oauth)
        methods.push({ type: 'oauth', label: provider.auth.oauth.loginLabel ?? provider.auth.oauth.name });
      if (provider.auth.apiKey?.login) methods.push({ type: 'api_key', label: provider.auth.apiKey.name });
      const status = this.runtime.getProviderAuthStatus(provider.id);
      return {
        id: provider.id,
        name: this.sensitive.text(provider.name),
        methods: methods.map((method) => ({ ...method, label: this.sensitive.text(method.label) })),
        stored: stored.get(provider.id),
        configured: status.configured,
        source: status.source,
      };
    });
  }

  private acquire() {
    if (this.closing) throw new ProviderAuthError('AUTH_CLOSING', 'Host 正在退出', 503);
    if (this.mutation) throw new ProviderAuthError('AUTH_BUSY', '另一个模型授权操作尚未结束');
    const release = this.callbacks.acquireMutation();
    this.mutation = true;
    return () => {
      this.mutation = false;
      release();
    };
  }

  start(provider: string, type: AuthType): ProviderAuthFlow {
    const selected = this.runtime.getProvider(provider);
    if (!selected) throw new ProviderAuthError('AUTH_PROVIDER_UNKNOWN', '未知模型提供方', 404);
    if (!(type === 'oauth' ? selected.auth.oauth?.login : selected.auth.apiKey?.login))
      throw new ProviderAuthError('AUTH_METHOD_UNSUPPORTED', '该提供方不支持此登录方式', 400);
    const release = this.acquire();
    const flow: LoginFlow = {
      view: { id: randomUUID(), provider, type, status: 'running', events: [] },
      controller: new AbortController(),
      done: Promise.resolve(),
    };
    this.flow = flow;
    const timer = setTimeout(() => flow.controller.abort(), 10 * 60 * 1000);
    timer.unref();
    flow.done = Promise.resolve()
      .then(async () => {
        const credential = await this.runtime.login(provider, type, {
          signal: flow.controller.signal,
          notify: (event) => {
            if (flow.controller.signal.aborted || flow.view.status !== 'running') return;
            flow.view.events = [...flow.view.events.slice(-19), this.projectEvent(event)];
          },
          prompt: (prompt) => this.prompt(flow, prompt),
        });
        this.sensitive.add(credential);
        flow.view.credentialChanged = true;
        await this.callbacks.onChanged?.();
        flow.view.status = 'succeeded';
      })
      .catch((error: unknown) => {
        if (error instanceof CredentialSynchronizationError) {
          this.sensitive.add(error.credential);
          flow.view.credentialChanged = true;
        }
        flow.view.status = flow.view.credentialChanged
          ? 'failed'
          : flow.controller.signal.aborted
            ? 'cancelled'
            : 'failed';
        if (flow.view.status === 'failed')
          flow.view.error = flow.view.credentialChanged
            ? '凭据已保存，但模型状态更新失败；请刷新后检查授权状态。'
            : '登录未完成，请检查提供方设置或重新发起授权。';
      })
      .finally(() => {
        clearTimeout(timer);
        flow.rejectPrompt?.();
        flow.view.events = [];
        delete flow.view.prompt;
        release();
      });
    this.settled = flow.done;
    return this.get(flow.view.id);
  }

  get(id: string): ProviderAuthFlow {
    if (this.flow?.view.id !== id) throw new ProviderAuthError('AUTH_FLOW_UNKNOWN', '登录流程不存在', 404);
    return structuredClone(this.flow.view);
  }

  current(): ProviderAuthFlow | null {
    return this.flow?.view.status === 'running' ? this.get(this.flow.view.id) : null;
  }

  submit(id: string, promptId: string, value: string): ProviderAuthFlow {
    const view = this.get(id);
    const prompt = view.prompt;
    if (view.status !== 'running' || prompt?.id !== promptId || !this.flow?.answer)
      throw new ProviderAuthError('AUTH_PROMPT_STALE', '此输入步骤已结束，请刷新登录状态');
    if (value.length > 16384) throw new ProviderAuthError('AUTH_INPUT_INVALID', '授权输入过长', 400);
    if (prompt.type === 'select' && !prompt.options.some((option) => option.id === value))
      throw new ProviderAuthError('AUTH_INPUT_INVALID', '请选择提供方支持的选项', 400);
    this.sensitive.add(value);
    this.flow.answer(value);
    return this.get(id);
  }

  async cancel(id: string): Promise<ProviderAuthFlow> {
    const flow = this.flow;
    if (flow?.view.id !== id) throw new ProviderAuthError('AUTH_FLOW_UNKNOWN', '登录流程不存在', 404);
    if (flow.view.status === 'running') flow.controller.abort();
    await flow.done;
    return this.get(id);
  }

  async logout(provider: string): Promise<ProviderAuthStatus> {
    if (!this.runtime.getProvider(provider))
      throw new ProviderAuthError('AUTH_PROVIDER_UNKNOWN', '未知模型提供方', 404);
    const release = this.acquire();
    const operation = (async () => {
      let removed = false;
      try {
        await this.runtime.logout(provider);
        if ((await this.runtime.listCredentials()).some((item) => item.providerId === provider))
          throw new Error('Credential deletion was not persisted');
        removed = true;
        await this.callbacks.onChanged?.();
        const status = (await this.list()).find((item) => item.id === provider);
        if (!status) throw new Error('Provider was removed during logout');
        return status;
      } catch (error) {
        if (removed || error instanceof CredentialSynchronizationError)
          throw new ProviderAuthError('AUTH_SYNC_FAILED', 'Host 凭据已移除，但模型状态更新失败；请刷新后检查。');
        throw new ProviderAuthError('AUTH_LOGOUT_FAILED', '退出未完成，请刷新授权状态后重试。');
      } finally {
        release();
      }
    })();
    this.settled = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }

  async dispose(): Promise<void> {
    this.closing = true;
    this.flow?.controller.abort();
    await this.settled;
  }

  private link(value: string): string {
    const url = new URL(value);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      [...url.searchParams.keys()].some((key) => /^(access_token|refresh_token|id_token|token)$/i.test(key)) ||
      this.sensitive.text(value) !== value
    )
      throw new Error('Unsafe authorization link');
    return value;
  }

  private projectEvent(event: AuthEvent): AuthEvent {
    switch (event.type) {
      case 'auth_url':
        return {
          type: event.type,
          url: this.link(event.url),
          instructions: event.instructions && this.sensitive.text(event.instructions),
        };
      case 'device_code':
        return {
          type: event.type,
          userCode: this.sensitive.text(event.userCode),
          verificationUri: this.link(event.verificationUri),
          intervalSeconds: event.intervalSeconds,
          expiresInSeconds: event.expiresInSeconds,
        };
      case 'info':
        return {
          type: event.type,
          message: this.sensitive.text(event.message),
          links: event.links?.map((link) => ({
            url: this.link(link.url),
            label: link.label && this.sensitive.text(link.label),
          })),
        };
      case 'progress':
        return { type: event.type, message: this.sensitive.text(event.message) };
    }
  }

  private prompt(flow: LoginFlow, prompt: AuthPrompt): Promise<string> {
    flow.rejectPrompt?.();
    return new Promise((resolve, reject) => {
      const abort = () => finish(undefined);
      const finish = (value: string | undefined) => {
        flow.controller.signal.removeEventListener('abort', abort);
        prompt.signal?.removeEventListener('abort', abort);
        delete flow.view.prompt;
        delete flow.answer;
        delete flow.rejectPrompt;
        if (value === undefined) reject(new Error('Authorization input cancelled'));
        else resolve(value);
      };
      flow.answer = (value) => finish(value);
      flow.rejectPrompt = abort;
      const { signal: _signal, ...publicPrompt } = prompt;
      flow.view.prompt = { ...this.sensitive.copy(publicPrompt), id: randomUUID() };
      flow.controller.signal.addEventListener('abort', abort, { once: true });
      prompt.signal?.addEventListener('abort', abort, { once: true });
      if (flow.controller.signal.aborted || prompt.signal?.aborted) abort();
    });
  }
}

const providerInput = z.object({ provider: z.string().min(1).max(256) }).strict();
const loginInput = providerInput.extend({ type: z.enum(['oauth', 'api_key']) });
const answerInput = z.object({ promptId: z.uuid(), value: z.string().max(16384) }).strict();

export async function providerAuthRoutes(
  service: ProviderAuthService,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;
  if (path !== '/api/provider-auth' && !path.startsWith('/api/provider-auth/')) return false;
  try {
    if (path === '/api/provider-auth' && req.method === 'GET') {
      json(res, 200, await service.list());
      return true;
    }
    if (path === '/api/provider-auth/login' && req.method === 'POST') {
      const input = loginInput.parse(await body(req));
      json(res, 202, service.start(input.provider, input.type));
      return true;
    }
    if (path === '/api/provider-auth/login' && req.method === 'GET') {
      json(res, 200, service.current());
      return true;
    }
    if (path === '/api/provider-auth/logout' && req.method === 'POST') {
      const input = providerInput.parse(await body(req));
      json(res, 200, await service.logout(input.provider));
      return true;
    }
    const match = /^\/api\/provider-auth\/login\/([a-f0-9-]{36})(\/input)?$/.exec(path);
    const id = match?.[1];
    if (id && !match?.[2] && req.method === 'GET') json(res, 200, service.get(id));
    else if (id && !match?.[2] && req.method === 'DELETE') json(res, 200, await service.cancel(id));
    else if (id && match?.[2] && req.method === 'POST') {
      const input = answerInput.parse(await body(req));
      json(res, 200, service.submit(id, input.promptId, input.value));
    } else json(res, 404, { error: '授权接口不存在' });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      json(res, 400, { error: '请求字段无效', code: 'AUTH_INPUT_INVALID' });
    else if (error instanceof ProviderAuthError) json(res, error.status, { error: error.message, code: error.code });
    else json(res, 409, { error: '授权操作未完成，请检查 Host 状态', code: 'AUTH_OPERATION_FAILED' });
  }
  return true;
}
