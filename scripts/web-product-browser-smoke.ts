import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, realpath, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { startHost } from '../apps/host/transport/server.js';
import { skillPackage, bindings } from '../tests/fixtures/skills-package.js';
const root = await realpath(await mkdtemp(join(tmpdir(), 'web-product-browser-')));
const token = randomBytes(32).toString('hex'),
  key = randomBytes(32);
const options = { dataDir: join(root, 'data'), key, token, webDir: resolve('dist/web') };
let host = await startHost(options);
const fake = fauxProvider({
  models: [{ id: 'browser-model', contextWindow: 100000, maxTokens: 2048 }],
  tokensPerSecond: 35,
});
host.service.runtime.registerNativeProvider(fake.provider);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const receipt = {
  time: new Date().toISOString(),
  result: 'running',
  provider: 'Faux only for deterministic browser mechanism tests',
  checks: [] as string[],
  screenshots: [] as string[],
};
const out = resolve('release/web-product-browser');
await mkdir(out, { recursive: true });
const errors: string[] = [];
async function ready(page: Page) {
  await page.waitForFunction(() => document.querySelector('.connection')?.textContent?.includes('已连接'), undefined, {
    timeout: 20000,
  });
}
async function nav(page: Page, name: string | RegExp) {
  if (await page.getByRole('button', { name: '打开导航' }).isVisible())
    await page.getByRole('button', { name: '打开导航' }).click();
  await page
    .locator('aside')
    .getByRole('button', { name, exact: typeof name === 'string' })
    .click();
}
async function shot(page: Page, name: string) {
  await page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
  receipt.screenshots.push(`${name}.png`);
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    `${name}: horizontal viewport overflow`,
  );
}
try {
  const a = await host.service.create(root, fake.provider.id, 'browser-model');
  const other = join(root, 'other');
  await mkdir(other);
  const b = await host.service.create(other, fake.provider.id, 'browser-model');
  const pkg = await skillPackage(join(root, 'pkg'));
  const [skill] = await host.service.skills.import({ source: pkg, bindings });
  assert.ok(skill);
  const ctx = await host.service.memoryUserContext(root);
  const memory = host.service.memory.create(
    ctx,
    {
      title: '项目说明',
      content: '# 最初的认识\n\n这个版本应可从历史来源准确打开。\n\n| 类型 | 内容 |\n| - | - |\n| 来源 | 实际记录 |',
      kind: 'decision',
      scope: 'project',
    },
    '原始依据',
  );
  host.service.memory.revise(ctx, memory.id, {
    baseRevision: 1,
    content: { title: '项目说明', content: '当前修订正文', kind: 'decision', scope: 'project' },
    reason: '新的依据',
  });
  const suggestion = host.service.evolution.create(
    { actor: 'user', project: root },
    {
      title: '整理项目认识',
      goal: '减少重复查阅',
      reason: '已有历史认识可供参考',
      value: '保留来源与修订',
      uncertainty: '需要进一步讨论',
      action: '先讨论再决定',
      evidence: [{ memoryId: memory.id, revision: 1 }],
      priority: 'high',
      attentionReason: '需要人工判断',
    },
  );
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  let disconnect = () => {};
  await page.routeWebSocket('**/events', (route) => {
    route.connectToServer();
    disconnect = () => route.close({ code: 1001, reason: 'controlled reconnect' });
  });
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(host.origin);
  await page.getByRole('heading', { name: '连接 Agent', exact: true }).waitFor();
  await shot(page, 'connect-1440');
  await page.getByLabel('连接令牌', { exact: true }).fill(token);
  await page.getByRole('button', { name: '连接 Agent', exact: true }).click();
  await ready(page);
  const select = async (id: string) => {
    if (await page.getByRole('button', { name: '打开导航' }).isVisible())
      await page.getByRole('button', { name: '打开导航' }).click();
    await page
      .locator('nav button')
      .filter({
        has: page.locator(`small`, { hasText: id === a.id ? new RegExp(root + '$') : new RegExp(other + '$') }),
      })
      .click();
    await page.getByLabel('任务', { exact: true }).waitFor();
  };
  await select(a.id);
  await page.getByLabel('任务', { exact: true }).fill('A draft');
  await select(b.id);
  await page.getByLabel('任务', { exact: true }).fill('B draft');
  await select(a.id);
  assert.equal(await page.getByLabel('任务', { exact: true }).inputValue(), 'A draft');
  let entered = () => {},
    release = () => {};
  const held = new Promise<void>((ok) => {
    release = ok;
  });
  const started = new Promise<void>((ok) => {
    entered = ok;
  });
  let submits = 0;
  await page.route(`**/api/sessions/${a.id}/prompt`, async (route) => {
    submits++;
    entered();
    await held;
    await route.fulfill({ status: 503, json: { error: '受控提交失败' } });
  });
  await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
  await started;
  await select(b.id);
  await page.getByLabel('任务', { exact: true }).fill('B new draft');
  release();
  await page.getByRole('alert').filter({ hasText: '受控提交失败' }).waitFor();
  assert.equal(await page.getByLabel('任务', { exact: true }).inputValue(), 'B new draft');
  assert.equal(submits, 1);
  await page.unrouteAll({ behavior: 'wait' });
  await select(a.id);
  assert.equal(await page.getByLabel('任务', { exact: true }).inputValue(), 'A draft');
  receipt.checks.push(
    'manual token connection; session-local drafts; asynchronous failure preserves other session and input',
  );
  const second = await browser.newPage();
  second.setDefaultTimeout(15000);
  await second.goto(`${host.origin}/#token=${token}`);
  await ready(second);
  const thirdDir = join(root, 'third');
  await mkdir(thirdDir);
  await host.service.create(thirdDir, fake.provider.id, 'browser-model');
  await second.locator('nav button').filter({ hasText: thirdDir }).waitFor();
  receipt.checks.push('empty Session immediately broadcasts to another client');
  const recovery = await browser.newPage();
  recovery.setDefaultTimeout(15000);
  await recovery.addInitScript(
    ({ token, id }) => {
      sessionStorage.setItem('agent-connection-token', token);
      sessionStorage.setItem('agent-navigation', JSON.stringify({ kind: 'chat', sessionId: id }));
    },
    { token, id: a.id },
  );
  let recoveryArrived = () => {},
    releaseRecovery = () => {};
  const recoveryPending = new Promise<void>((ok) => {
    recoveryArrived = ok;
  });
  const recoveryGate = new Promise<void>((ok) => {
    releaseRecovery = ok;
  });
  await recovery.route(`**/api/sessions/${a.id}`, async (route) => {
    recoveryArrived();
    await recoveryGate;
    await route.fulfill({ status: 404, json: { error: '会话已不可访问' } });
  });
  await recovery.goto(host.origin);
  await recoveryPending;
  await recovery.locator('nav button').filter({ hasText: other }).click();
  await recovery.locator('header p').filter({ hasText: other }).waitFor();
  releaseRecovery();
  await ready(recovery);
  assert.equal(await recovery.locator('main header p').innerText(), other);
  await recovery.close();
  receipt.checks.push('late 404 from reconnecting Session A cannot clear newly selected Session B');

  fake.setResponses([fauxAssistantMessage('## 持续输出\n\n' + 'reconnect streaming words '.repeat(45))]);
  await page.getByLabel('任务', { exact: true }).fill('stream');
  await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
  await page.locator('.transcript .assistant').waitFor();
  await page.context().setOffline(true);
  disconnect();
  await page.locator('.connection-banner').waitFor();
  await page.context().setOffline(false);
  await ready(page);
  await page.getByRole('button', { name: '停止', exact: true }).waitFor();
  assert.equal(await page.locator('.transcript .assistant').count(), 1);
  await page.getByRole('button', { name: '发送 ↑', exact: true }).waitFor({ timeout: 30000 });
  assert.equal(await page.locator('.transcript .assistant').count(), 1);
  receipt.checks.push('generation reconnect restores accumulated assistant without duplication');
  fake.setResponses([
    fauxAssistantMessage(fauxToolCall('bash', { command: "sleep 5; printf 'exactly-once' > reconnect-tool.txt" }), {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage('Tool finished'),
  ]);
  await page.getByLabel('任务', { exact: true }).fill('tool reconnect');
  await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
  await page.locator('.working').filter({ hasText: '正在执行工具 · bash' }).waitFor();
  disconnect();
  await page.locator('.connection-banner').waitFor();
  await ready(page);
  await page.locator('.working').filter({ hasText: '正在执行工具 · bash' }).waitFor();
  await page.getByRole('button', { name: '发送 ↑', exact: true }).waitFor({ timeout: 20000 });
  assert.equal(await readFile(join(root, 'reconnect-tool.txt'), 'utf8'), 'exactly-once');
  assert.equal((await host.service.viewSession(a.id)).messages.filter((m) => m.role === 'toolResult').length, 1);
  receipt.checks.push('native Tool execution reconnect retains stage and produces one ToolResult and file');

  await nav(page, /^进化建议/);
  await page
    .locator('.evolution-catalog')
    .getByRole('button', { name: /整理项目认识/ })
    .click();
  await page.locator('.evolution-detail summary').filter({ hasText: '依据与来源' }).click();
  await page.getByRole('button', { name: '查看记忆修订' }).click();
  await page.locator('.memory-detail .markdown').filter({ hasText: '最初的认识' }).first().waitFor();
  assert.equal(await page.getByRole('button', { name: '编辑与调整作用域', exact: true }).count(), 0);
  await page.reload();
  await ready(page);
  await page.locator('.memory-detail .markdown').filter({ hasText: '最初的认识' }).first().waitFor();
  receipt.checks.push('suggestion source opens exact read-only Memory revision; refresh restores object and revision');
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await shot(page, `memory-${width}`);
    await nav(page, '能力管理');
    if (width !== 390) await page.locator('.skill-item').first().click();
    await page.locator('.skill-detail h2').waitFor();
    await page.getByRole('button', { name: '查看说明', exact: true }).first().click();
    await page.locator('.skill-detail .markdown').waitFor();
    await shot(page, `skills-${width}`);
    await nav(page, '历史日志');
    if (width !== 390) await page.locator('.diagnostics-item').first().click();
    await page.locator('.diagnostics-detail h2').waitFor();
    await shot(page, `diagnostics-${width}`);
    await nav(page, '反思记录');
    await page.locator('.reflection-availability').waitFor();
    await shot(page, `reflection-${width}`);
    await nav(page, /^进化建议/);
    if (width !== 390)
      await page
        .locator('.evolution-catalog')
        .getByRole('button', { name: /整理项目认识/ })
        .click();
    await page.getByRole('heading', { name: '整理项目认识', exact: true }).waitFor();
    await shot(page, `suggestions-${width}`);
    await nav(page, '模型设置');
    await page.locator('.model-panel').waitFor();
    await shot(page, `settings-${width}`);
    await select(a.id);
    await shot(page, `chat-${width}`);
    await nav(page, '记忆管理');
    await page.locator('.memory-detail .markdown').first().waitFor();
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await nav(page, /^进化建议/);
  await page.getByRole('combobox', { name: '建议范围', exact: true }).selectOption('project');
  await page
    .locator('.evolution-catalog')
    .getByRole('button', { name: /整理项目认识/ })
    .click();
  await page.getByRole('button', { name: '忽略', exact: true }).click();
  await page.getByRole('combobox', { name: '状态', exact: true }).selectOption('ignored');
  await page
    .locator('.evolution-catalog')
    .getByRole('button', { name: /整理项目认识/ })
    .click();
  await page.getByRole('button', { name: '归档', exact: true }).click();
  assert.equal(host.service.evolution.get({ actor: 'user' }, suggestion.id).status, 'archived');
  receipt.checks.push('project filter; ignore and archive preserve authority');
  const states = [
    { name: 'skills', label: '能力管理', path: 'skills', empty: { skills: [], discovered: [], operations: [] } },
    { name: 'memory', label: '记忆管理', path: 'memory', empty: { items: [], total: 0, unavailable: 0 } },
    { name: 'diagnostics', label: '历史日志', path: 'diagnostics', empty: { items: [], total: 0 } },
    {
      name: 'reflection',
      label: '反思记录',
      path: 'reflections',
      empty: {
        records: [],
        jobs: [],
        availability: { available: false, reason: '环境不可用，请检查 Host 的原生组件。' },
      },
    },
    {
      name: 'suggestions',
      label: /^进化建议/,
      path: 'suggestions',
      empty: { items: [], total: 0, highPriorityPending: 0 },
    },
  ];
  for (const state of states) {
    await nav(page, state.label);
    await page.evaluate((name) => {
      sessionStorage.removeItem(`agent-position-${name}`);
      const saved = JSON.parse(sessionStorage.getItem('agent-navigation') ?? '{}');
      delete saved.id;
      delete saved.revision;
      delete saved.knowledgeRevision;
      delete saved.evidence;
      sessionStorage.setItem('agent-navigation', JSON.stringify(saved));
    }, state.name);
    let arrive = () => {},
      releaseState = () => {};
    const arrived = new Promise<void>((ok) => {
      arrive = ok;
    });
    const gate = new Promise<void>((ok) => {
      releaseState = ok;
    });
    await page.route(new RegExp(`/api/${state.path}(?:\\?.*)?$`), async (route) => {
      arrive();
      await gate;
      await route.fulfill({ status: 503, json: { error: '暂时无法读取，请稍后重试。' } });
    });
    await page.reload();
    await ready(page);
    await arrived;
    await page.waitForTimeout(200);
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 960 });
      await shot(page, `${state.name}-loading-${width}`);
    }
    releaseState();
    await page.getByRole('alert').filter({ hasText: '暂时无法读取' }).first().waitFor();
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 960 });
      await shot(page, `${state.name}-error-${width}`);
    }
    await page.unrouteAll({ behavior: 'wait' });
    await page.route(new RegExp(`/api/${state.path}(?:\\?.*)?$`), (route) => route.fulfill({ json: state.empty }));
    await page.reload();
    await ready(page);
    await page.waitForTimeout(250);
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 960 });
      await shot(page, `${state.name}-empty-${width}`);
    }
    await page.unrouteAll({ behavior: 'wait' });
    await page.setViewportSize({ width: 1440, height: 960 });
  }
  receipt.checks.push('all management modules loading, failure and empty views at four viewport widths');
  await nav(page, '模型设置');
  await page.route('**/api/credentials', (route) =>
    route.fulfill({ status: 503, json: { error: '模型授权暂时无法保存，请重试。' } }),
  );
  await page.getByLabel('API Key', { exact: true }).fill('dummy-browser-regression-key');
  await page.getByRole('button', { name: '保存 Key', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '模型授权暂时无法保存' }).waitFor();
  assert.equal(await page.locator('.model-panel').isVisible(), true);
  await page.unrouteAll({ behavior: 'wait' });
  receipt.checks.push('model save failure remains visible in independent settings view');

  const port = Number(new URL(host.origin).port);
  await host.close();
  host = await startHost({ ...options, port });
  host.service.runtime.registerNativeProvider(fake.provider);
  await ready(page);
  assert.equal(host.service.evolution.get({ actor: 'user' }, suggestion.id).status, 'archived');
  receipt.checks.push('Host cold restart reestablishes version baseline and persistent state');
  assert.deepEqual(errors, []);
  receipt.result = 'passed';
} catch (error) {
  receipt.result = 'failed';
  console.error('Browser errors:', errors);
  await browser
    .contexts()[0]
    ?.pages()[0]
    ?.screenshot({ path: join(out, 'failure.png') })
    .catch(() => {});
  throw error;
} finally {
  await mkdir('docs/evidence', { recursive: true });
  await writeFile(
    process.env.AGENT_ACCEPTANCE_EVIDENCE ?? 'docs/evidence/web-product-browser.json',
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  await Promise.race([browser.close(), new Promise<void>((ok) => setTimeout(ok, 5000).unref())]);
  await host.close();
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(receipt));
}
