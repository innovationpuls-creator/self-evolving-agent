import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  fauxAssistantMessage,
  type AuthType,
  type Credential,
  type CredentialStore,
  type ProviderAuthInteraction,
} from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { CredentialSynchronizationError } from '@earendil-works/pi-coding-agent';
import { AgentService } from '../apps/host/runtime/agent.js';
import {
  ProviderAuthError,
  ProviderAuthService,
  providerAuthRoutes,
  type ProviderAuthFlow,
} from '../apps/host/runtime/provider-auth.js';
import { EncryptedStore } from '../apps/host/storage/storage.js';

const access = 'mock-oauth-access-token-853729';
const refresh = 'mock-oauth-refresh-token-984537';
const oauth: Credential = { type: 'oauth', access, refresh, expires: Date.now() + 3600000 };

async function fixture(login: (interaction: ProviderAuthInteraction) => Promise<Credential>, type: AuthType = 'oauth') {
  const dir = await mkdtemp(join(tmpdir(), 'provider-auth-'));
  const key = randomBytes(32);
  const owner = new AgentService(join(dir, 'host'), key);
  await owner.init();
  const fake = fauxProvider({ models: [{ id: 'auth-test-model' }] });
  const id = fake.provider.id;
  let calls = 0;
  const authenticate = async (interaction: ProviderAuthInteraction) => {
    calls++;
    return login(interaction);
  };
  owner.runtime.registerNativeProvider({
    ...fake.provider,
    auth: {
      apiKey: {
        name: 'Test API key',
        login:
          type === 'api_key'
            ? async (interaction) => {
                const credential = await authenticate(interaction);
                assert.equal(credential.type, 'api_key');
                return credential as Extract<Credential, { type: 'api_key' }>;
              }
            : undefined,
        resolve: async ({ credential }) => (credential?.key ? { auth: { apiKey: credential.key } } : undefined),
      },
      oauth:
        type === 'oauth'
          ? {
              name: 'Test subscription',
              loginLabel: 'Browser or device login',
              login: async (interaction) => {
                const credential = await authenticate(interaction);
                assert.equal(credential.type, 'oauth');
                return credential as Extract<Credential, { type: 'oauth' }>;
              },
              refresh: async (credential) => credential,
              toAuth: async (credential) => ({ apiKey: credential.access }),
            }
          : undefined,
    },
  });
  let lifecycle: 'session' | 'reflection' | 'activity' | undefined;
  let held = false;
  let changes = 0;
  const service = new ProviderAuthService(
    owner.runtime,
    {
      acquireMutation() {
        if (lifecycle || held) throw new ProviderAuthError('AUTH_BUSY', '会话或任务正在运行');
        held = true;
        return () => {
          held = false;
        };
      },
      async onChanged() {
        changes++;
      },
    },
    owner.sensitive,
  );
  return {
    dir,
    key,
    owner,
    service,
    id,
    fake,
    get calls() {
      return calls;
    },
    get held() {
      return held;
    },
    get changes() {
      return changes;
    },
    setLifecycle(value: typeof lifecycle) {
      lifecycle = value;
    },
    async close() {
      await service.dispose();
      await owner.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function waitFor(service: ProviderAuthService, id: string, predicate: (flow: ProviderAuthFlow) => boolean) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const flow = service.get(id);
    if (predicate(flow)) return flow;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Login flow did not reach expected state');
}

test('native OAuth browser/select/device/redirect flow persists only encrypted Host credentials', async () => {
  const f = await fixture(async (interaction) => {
    const method = await interaction.prompt({
      type: 'select',
      message: 'Choose login method',
      options: [
        { id: 'browser', label: 'Browser' },
        { id: 'device', label: 'Device code' },
      ],
    });
    assert.equal(method, 'browser');
    interaction.notify({
      type: 'auth_url',
      url: 'https://auth.example.test/authorize?state=PUBLIC_STATE',
      instructions: 'Authorize in browser',
    });
    interaction.notify({
      type: 'device_code',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://auth.example.test/device',
      expiresInSeconds: 120,
    });
    interaction.notify({
      type: 'info',
      message: 'Continue',
      links: [{ url: 'https://auth.example.test/help', label: 'Help' }],
    });
    const redirect = await interaction.prompt({ type: 'manual_code', message: 'Paste final redirect URL' });
    assert.equal(redirect, 'http://localhost/callback?code=mock-authorization-code');
    return oauth;
  });
  try {
    const before = (await f.service.list()).find((provider) => provider.id === f.id)!;
    assert.deepEqual(before.methods, [{ type: 'oauth', label: 'Browser or device login' }]);
    assert.equal(before.stored, undefined);
    const flow = f.service.start(f.id, 'oauth');
    const select = await waitFor(f.service, flow.id, (state) => state.prompt?.type === 'select');
    assert.throws(() => f.service.submit(flow.id, select.prompt!.id, 'unsupported'), /支持的选项/);
    f.service.submit(flow.id, select.prompt!.id, 'browser');
    const manual = await waitFor(f.service, flow.id, (state) => state.prompt?.type === 'manual_code');
    assert.ok(manual.events.some((event) => event.type === 'auth_url'));
    assert.ok(manual.events.some((event) => event.type === 'device_code' && event.userCode === 'ABCD-EFGH'));
    assert.equal('signal' in manual.prompt!, false);
    assert.throws(() => f.service.submit(flow.id, select.prompt!.id, 'browser'), /已结束/);
    f.service.submit(flow.id, manual.prompt!.id, 'http://localhost/callback?code=mock-authorization-code');
    const result = await waitFor(f.service, flow.id, (state) => state.status !== 'running');
    assert.equal(result.status, 'succeeded');
    assert.equal(f.held, false);
    assert.equal(f.changes, 1);
    assert.deepEqual(result.events, []);
    assert.equal(result.prompt, undefined);
    const status = (await f.service.list()).find((provider) => provider.id === f.id)!;
    assert.equal(status.stored, 'oauth');
    assert.equal(status.configured, true);
    assert.ok(!JSON.stringify([status, result]).includes(access));
    assert.ok(!JSON.stringify([status, result]).includes(refresh));
    const bytes = await readFile(join(f.dir, 'host/credentials.enc'), 'utf8');
    assert.ok(!bytes.includes(access));
    assert.ok(!bytes.includes(refresh));
    const saved = await new EncryptedStore(join(f.dir, 'host'), f.key).read<Record<string, Credential>>(
      'credentials.enc',
    );
    assert.equal(saved?.[f.id]?.type, 'oauth');
    assert.equal(f.owner.sensitive.text(access), '[已保护]');
    await f.service.logout(f.id);
    const removed = await new EncryptedStore(join(f.dir, 'host'), f.key).read<Record<string, Credential>>(
      'credentials.enc',
    );
    assert.equal(removed?.[f.id], undefined);
  } finally {
    await f.close();
  }
});

test('native API key login forwards text and secret inputs without echoing values', async () => {
  const f = await fixture(async (interaction) => {
    const tenant = await interaction.prompt({ type: 'text', message: 'Tenant' });
    const key = await interaction.prompt({ type: 'secret', message: 'API key' });
    return { type: 'api_key', key, env: { TENANT: tenant } };
  }, 'api_key');
  try {
    const flow = f.service.start(f.id, 'api_key');
    const text = await waitFor(f.service, flow.id, (state) => state.prompt?.type === 'text');
    f.service.submit(flow.id, text.prompt!.id, 'mock-tenant-1234');
    const secret = await waitFor(f.service, flow.id, (state) => state.prompt?.type === 'secret');
    f.service.submit(flow.id, secret.prompt!.id, access);
    const done = await waitFor(f.service, flow.id, (state) => state.status !== 'running');
    assert.equal(done.status, 'succeeded');
    assert.ok(!JSON.stringify(done).includes(access));
    assert.equal((await f.service.list()).find((provider) => provider.id === f.id)?.stored, 'api_key');
  } finally {
    await f.close();
  }
});

test('Vault honors native no-op, serializes providers and retains durable deletion across restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'provider-vault-'));
  const key = randomBytes(32);
  let owner = new AgentService(join(dir, 'host'), key);
  try {
    await owner.init();
    const vault: CredentialStore = Reflect.get(owner, 'vault');
    const apiKey: Credential = { type: 'api_key', key: access };
    await vault.modify('test-api', async () => apiKey);
    assert.deepEqual(await vault.modify('test-api', async () => undefined), apiKey);
    await Promise.all([
      vault.modify('test-oauth', async () => oauth),
      vault.delete('test-api'),
      vault.modify('test-retained', async () => apiKey),
    ]);
    assert.equal(await vault.read('test-api'), undefined);
    const saved = await owner.store.read<Record<string, Credential>>('credentials.enc');
    assert.equal(saved?.['test-api'], undefined);
    assert.deepEqual(saved?.['test-oauth'], oauth);
    assert.deepEqual(saved?.['test-retained'], apiKey);
    await owner.close();
    owner = new AgentService(join(dir, 'host'), key);
    await owner.init();
    const restored: CredentialStore = Reflect.get(owner, 'vault');
    assert.equal(await restored.read('test-api'), undefined);
    assert.deepEqual(await restored.read('test-oauth'), oauth);
    await restored.delete('test-oauth');
    await restored.delete('test-retained');
    assert.deepEqual(await restored.list(), []);
  } finally {
    await owner.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('Vault cancellation and failed writes cannot split durable and in-memory credentials', async () => {
  const f = await fixture(async () => oauth);
  const vault: CredentialStore = Reflect.get(f.owner, 'vault');
  const write = f.owner.store.write.bind(f.owner.store);
  try {
    await vault.modify(f.id, async () => oauth);
    const controller = new AbortController();
    await assert.rejects(
      vault.modify(
        f.id,
        async () => {
          controller.abort();
          return { type: 'api_key', key: access };
        },
        { signal: controller.signal },
      ),
      { name: 'AbortError' },
    );
    assert.deepEqual(await vault.read(f.id), oauth);
    f.owner.store.write = async () => {
      throw new Error('test disk failure');
    };
    await assert.rejects(vault.delete(f.id), /disk failure/);
    await assert.rejects(
      vault.modify(f.id, async () => ({ type: 'api_key', key: access })),
      /disk failure/,
    );
    assert.deepEqual(await vault.read(f.id), oauth);
    assert.deepEqual((await f.owner.store.read<Record<string, Credential>>('credentials.enc'))?.[f.id], oauth);
    const committed = new AbortController();
    f.owner.store.write = async (name, value) => {
      await write(name, value);
      committed.abort();
    };
    await vault.delete(f.id, { signal: committed.signal });
    assert.equal(await vault.read(f.id), undefined);
    assert.equal((await f.owner.store.read<Record<string, Credential>>('credentials.enc'))?.[f.id], undefined);
  } finally {
    f.owner.store.write = write;
    await f.close();
  }
});

test('actual Host blocks credential changes during a model run and blocks execution during native login', async () => {
  const f = await fixture(async (interaction) => {
    await interaction.prompt({ type: 'text', message: 'Continue' });
    return oauth;
  });
  let release: (() => void) | undefined;
  try {
    await f.owner.credentials(f.id, access);
    const session = await f.owner.create(f.dir, f.id, 'auth-test-model');
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.fake.setResponses([
      async () => {
        await gate;
        return fauxAssistantMessage('Completed.');
      },
    ]);
    await f.owner.prompt(session.id, 'Wait for a controlled test response.');
    assert.throws(() => f.owner.providerAuth.start(f.id, 'oauth'), /仍有会话或后台任务/);
    await assert.rejects(f.owner.providerAuth.logout(f.id), /仍有会话或后台任务/);
    await assert.rejects(f.owner.credentials(f.id, access), /仍有会话或后台任务/);
    assert.ok(release);
    release();
    const deadline = Date.now() + 5000;
    while ((await f.owner.viewSession(session.id)).busy) {
      assert.ok(Date.now() < deadline);
      await new Promise((done) => setTimeout(done, 5));
    }
    const login = f.owner.providerAuth.start(f.id, 'oauth');
    await waitFor(f.owner.providerAuth, login.id, (flow) => !!flow.prompt);
    await assert.rejects(f.owner.prompt(session.id, 'Must not execute during login.'), /模型授权操作进行中/);
    await assert.rejects(f.owner.create(f.dir, f.id, 'auth-test-model'), /模型授权操作进行中/);
    await f.owner.providerAuth.cancel(login.id);
    assert.equal((await f.owner.viewSession(session.id)).error, undefined);
  } finally {
    release?.();
    await f.close();
  }
});

test('callback winning the redirect race removes the obsolete manual prompt', async () => {
  const f = await fixture(async (interaction) => {
    const controller = new AbortController();
    const pending = interaction.prompt({ type: 'manual_code', message: 'Paste redirect', signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, /cancelled/);
    return oauth;
  });
  try {
    const flow = f.service.start(f.id, 'oauth');
    const done = await waitFor(f.service, flow.id, (state) => state.status !== 'running');
    assert.equal(done.status, 'succeeded');
    assert.equal(done.prompt, undefined);
    assert.throws(() => f.service.submit(flow.id, 'old-prompt', access), /已结束/);
  } finally {
    await f.close();
  }
});

test('cancel and Host shutdown abort native login, clear prompts, and release the lifecycle lock', async () => {
  const f = await fixture(async (interaction) => {
    await interaction.prompt({ type: 'secret', message: 'Waiting for user' });
    return oauth;
  });
  try {
    const first = f.service.start(f.id, 'oauth');
    await waitFor(f.service, first.id, (state) => !!state.prompt);
    assert.equal(f.held, true);
    const result = await f.service.cancel(first.id);
    assert.equal(result.status, 'cancelled');
    assert.equal(result.prompt, undefined);
    assert.equal(f.held, false);
    assert.equal((await f.service.list()).find((provider) => provider.id === f.id)?.stored, undefined);
    const second = f.service.start(f.id, 'oauth');
    await waitFor(f.service, second.id, (state) => !!state.prompt);
    await f.service.dispose();
    assert.equal(f.service.get(second.id).status, 'cancelled');
    assert.equal(f.held, false);
    assert.throws(() => f.service.start(f.id, 'oauth'), /正在退出/);
  } finally {
    await f.close();
  }
});

test('lifecycle guard rejects session/Reflection/Activity conflicts before native login or logout', async () => {
  const f = await fixture(async () => oauth);
  try {
    for (const activity of ['session', 'reflection', 'activity'] as const) {
      f.setLifecycle(activity);
      assert.throws(() => f.service.start(f.id, 'oauth'), /正在运行/);
      await assert.rejects(f.service.logout(f.id), /正在运行/);
      assert.equal(f.calls, 0);
      assert.equal(f.held, false);
    }
    f.setLifecycle(undefined);
    const flow = f.service.start(f.id, 'oauth');
    assert.equal(f.held, true);
    await waitFor(f.service, flow.id, (state) => state.status !== 'running');
  } finally {
    await f.close();
  }
});

test('concurrent login/logout are refused throughout a native interactive login', async () => {
  const f = await fixture(async (interaction) => {
    await interaction.prompt({ type: 'text', message: 'Continue' });
    return oauth;
  });
  try {
    const flow = f.service.start(f.id, 'oauth');
    assert.throws(() => f.service.start(f.id, 'oauth'), /尚未结束/);
    await assert.rejects(f.service.logout(f.id), /尚未结束/);
    assert.equal(f.held, true);
    await f.service.cancel(flow.id);
    assert.equal(f.held, false);
  } finally {
    await f.close();
  }
});

test('provider failures and progress cannot expose registered tokens or arbitrary error causes', async () => {
  const f = await fixture(async (interaction) => {
    interaction.notify({ type: 'progress', message: `Working with ${access}` });
    await interaction.prompt({ type: 'text', message: 'Continue' });
    throw new Error(`upstream token ${refresh}`);
  });
  try {
    f.owner.sensitive.add(access);
    const flow = f.service.start(f.id, 'oauth');
    const pending = await waitFor(f.service, flow.id, (state) => !!state.prompt);
    assert.ok(!JSON.stringify(pending).includes(access));
    f.service.submit(flow.id, pending.prompt!.id, 'continue');
    const done = await waitFor(f.service, flow.id, (state) => state.status !== 'running');
    assert.equal(done.status, 'failed');
    assert.ok(!JSON.stringify(done).includes(refresh));
    assert.equal(f.held, false);
  } finally {
    await f.close();
  }
});

test('logout persistence failure reports failure and retains stored authorization', async () => {
  const f = await fixture(async () => oauth);
  const write = f.owner.store.write.bind(f.owner.store);
  try {
    const flow = f.service.start(f.id, 'oauth');
    await waitFor(f.service, flow.id, (state) => state.status !== 'running');
    f.owner.store.write = async (name, value) => {
      if (name === 'credentials.enc') throw new Error(`disk failure ${access}`);
      await write(name, value);
    };
    await assert.rejects(f.service.logout(f.id), (error: unknown) => {
      assert.ok(error instanceof ProviderAuthError);
      assert.equal(error.code, 'AUTH_LOGOUT_FAILED');
      assert.ok(!error.message.includes(access));
      return true;
    });
    assert.equal((await f.service.list()).find((provider) => provider.id === f.id)?.stored, 'oauth');
    assert.equal(f.held, false);
  } finally {
    f.owner.store.write = write;
    await f.close();
  }
});

test('logout preserves and truthfully reports an ambient provider authorization', async () => {
  const f = await fixture(async () => oauth);
  try {
    const original = f.owner.runtime.getProvider(f.id)!;
    f.owner.runtime.registerNativeProvider({
      ...original,
      auth: {
        ...original.auth,
        apiKey: {
          name: 'Ambient test auth',
          resolve: async () => ({ auth: { apiKey: 'mock-ambient-key-1234' }, source: 'TEST_ENV' }),
        },
      },
    });
    const flow = f.service.start(f.id, 'oauth');
    await waitFor(f.service, flow.id, (state) => state.status !== 'running');
    const status = await f.service.logout(f.id);
    assert.equal(status.stored, undefined);
    assert.equal(status.configured, true);
    assert.equal(f.changes, 2);
  } finally {
    await f.close();
  }
});

test('credential synchronization failure is not reported as login or logout success', async () => {
  const f = await fixture(async () => oauth);
  const login = f.owner.runtime.login.bind(f.owner.runtime);
  const logout = f.owner.runtime.logout.bind(f.owner.runtime);
  try {
    f.owner.runtime.login = async () => {
      throw new CredentialSynchronizationError(f.id, 'login', oauth, { cause: new Error(access) });
    };
    const flow = f.service.start(f.id, 'oauth');
    const failed = await waitFor(f.service, flow.id, (state) => state.status !== 'running');
    assert.equal(failed.status, 'failed');
    assert.equal(failed.credentialChanged, true);
    assert.ok(!JSON.stringify(failed).includes(access));
    assert.equal(f.owner.sensitive.text(refresh), '[已保护]');
    f.owner.runtime.logout = async () => {
      throw new CredentialSynchronizationError(f.id, 'logout', undefined, { cause: new Error(refresh) });
    };
    await assert.rejects(
      f.service.logout(f.id),
      (error: unknown) => error instanceof ProviderAuthError && error.code === 'AUTH_SYNC_FAILED',
    );
    assert.equal(f.held, false);
  } finally {
    f.owner.runtime.login = login;
    f.owner.runtime.logout = logout;
    await f.close();
  }
});

test('authorization links reject executable URLs and token-bearing query parameters', async () => {
  let url = 'javascript:alert(1)';
  const f = await fixture(async (interaction) => {
    interaction.notify({ type: 'auth_url', url });
    return oauth;
  });
  try {
    for (const unsafe of [
      'javascript:alert(1)',
      'https://example.test/?access_token=secret',
      'https://user:pass@example.test/',
    ]) {
      url = unsafe;
      const flow = f.service.start(f.id, 'oauth');
      const done = await waitFor(f.service, flow.id, (state) => state.status !== 'running');
      assert.equal(done.status, 'failed');
      assert.equal(JSON.stringify(done).includes(unsafe), false);
    }
  } finally {
    await f.close();
  }
});

test('route helper validates inputs and projects only safe status and interaction data', async () => {
  const f = await fixture(async (interaction) => {
    await interaction.prompt({ type: 'secret', message: 'Key' });
    return oauth;
  });
  const request = async (path: string, method = 'GET', value?: unknown) => {
    const req = Readable.from(value === undefined ? [] : [Buffer.from(JSON.stringify(value))]) as IncomingMessage;
    req.method = method;
    let status = 0;
    let content = '';
    const res = {
      writeHead(code: number) {
        status = code;
      },
      end(bytes: string) {
        content = bytes;
      },
    } as unknown as ServerResponse;
    const handled = await providerAuthRoutes(f.service, req, res, new URL(path, 'http://localhost'));
    return {
      status: handled ? status : 404,
      json: async () => JSON.parse(content),
      text: async () => content,
    };
  };
  try {
    assert.equal((await request('/other')).status, 404);
    assert.equal((await request('/api/provider-auth')).status, 200);
    assert.equal((await request('/api/provider-auth/login', 'POST', { provider: f.id, type: 'password' })).status, 400);
    assert.equal(
      (await request('/api/provider-auth/login', 'POST', { provider: f.id, type: 'oauth', token: access })).status,
      400,
    );
    const started = await request('/api/provider-auth/login', 'POST', { provider: f.id, type: 'oauth' });
    assert.equal(started.status, 202);
    const flow = (await started.json()) as ProviderAuthFlow;
    const pending = await waitFor(f.service, flow.id, (state) => !!state.prompt);
    const answer = await request(`/api/provider-auth/login/${flow.id}/input`, 'POST', {
      promptId: pending.prompt!.id,
      value: access,
    });
    assert.equal(answer.status, 200);
    assert.ok(!(await answer.text()).includes(access));
    await waitFor(f.service, flow.id, (state) => state.status !== 'running');
    const status = await request(`/api/provider-auth/login/${flow.id}`);
    assert.ok(!(await status.text()).includes(refresh));
    assert.equal((await request('/api/provider-auth/logout', 'POST', { provider: f.id })).status, 200);
    assert.equal((await request('/api/provider-auth/unknown')).status, 404);
  } finally {
    await f.close();
  }
});
