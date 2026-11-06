import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, realpath, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { AgentService } from '../../apps/host/runtime/agent.js';
import { startHost } from '../../apps/host/transport/server.js';
import { NativeReflectionExecutor } from '../../apps/host/reflection/native-executor.js';
const root = await realpath(await mkdtemp(join(tmpdir(), 'post-d5-browser-')));
const out = resolve('release/post-d5-bugfix-2026-10-22/browser');
await mkdir(out, { recursive: true });
let probes = 0;
const native = new NativeReflectionExecutor(
  resolve('release/post-d5-bugfix-2026-10-22/package/Agent-darwin-arm64/Agent.app'),
);
const service = new AgentService(join(root, 'data'), randomBytes(32), {
  reflectionDelayMs: 3600000,
  reflectionExecutor: {
    async available(signal) {
      probes++;
      return native.available(signal);
    },
    execute: (...args) => native.execute(...args),
  },
});
const token = randomBytes(32).toString('hex');
const host = await startHost({
  dataDir: service.dataDir,
  key: randomBytes(32),
  token,
  webDir: resolve('dist/web'),
  service,
});
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(20000);
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
const receipt: Record<string, unknown> = { passed: false, checks: [], performance: {} };
const checks = receipt.checks as string[];
const fake = fauxProvider({
  models: [{ id: 'browser-bugfix', contextWindow: 100000, maxTokens: 1024 }],
  tokensPerSecond: 1000,
});
service.runtime.registerNativeProvider(fake.provider);
const request = async (path: string, method = 'GET', body?: unknown) => {
  const response = await fetch(`${host.origin}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.ok(response.ok, `${path}: ${response.status}`);
  return response.json();
};
const nav = (name: string) => page.locator('aside').getByRole('button', { name, exact: true }).click();
const settle = async () => {
  const end = Date.now() + 20000;
  while ((await service.viewSession(session.id)).busy) {
    assert.ok(Date.now() < end);
    await new Promise((done) => setTimeout(done, 10));
  }
};
const session = await service.create(root, fake.provider.id, 'browser-bugfix');
try {
  await mkdir(join(root, 'space directory'));
  await writeFile(join(root, 'space directory', 'note file.txt'), 'ACTUAL_FILE_REFERENCE_CONTENT');
  const skillRoot = join(root, 'ordinary');
  await mkdir(skillRoot);
  await writeFile(
    join(skillRoot, 'SKILL.md'),
    '---\nname: ordinary\ndescription: Ordinary input capability.\n---\nNATIVE_SKILL_EXPANSION_MARKER',
  );
  const [skill] = await service.skills.import({ source: skillRoot, project: root });
  assert.ok(skill);
  const op = service.skills.publish(skill.id, skill.latest, skill.revision);
  while (['checking', 'waiting'].includes(service.skills.operation(op.id).status))
    await new Promise((done) => setTimeout(done, 10));
  assert.equal(service.skills.operation(op.id).status, 'applied');
  await page.goto(`${host.origin}/#token=${token}`);
  await page.locator('nav button').filter({ hasText: root }).click();
  const input = page.getByLabel('任务', { exact: true });
  await input.fill('/skill:ord');
  await page.getByRole('option').filter({ hasText: '/skill:ordinary' }).waitFor();
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true });
  assert.equal(await input.inputValue(), '/skill:ord');
  assert.equal((await service.viewSession(session.id)).busy, false);
  await input.press('ArrowDown');
  await input.press('Tab');
  assert.equal(await input.inputValue(), '/skill:ordinary ');
  let expanded = false;
  fake.setResponses([
    async (context) => {
      expanded = JSON.stringify(context.messages.at(-1)).includes('NATIVE_SKILL_EXPANSION_MARKER');
      return fauxAssistantMessage('Native Skill expanded.');
    },
  ]);
  await input.press('Control+Enter');
  await settle();
  assert.ok(expanded);
  await input.fill('@space');
  await page.getByRole('option').filter({ hasText: 'space directory/' }).waitFor();
  await input.press('Enter');
  await page.getByRole('option').filter({ hasText: 'note file.txt' }).waitFor();
  await input.press('Enter');
  assert.equal(await input.inputValue(), '@"space directory/note file.txt" ');
  await input.press('Shift+Enter');
  assert.ok((await input.inputValue()).includes('\n'));
  let attached = false;
  fake.setResponses([
    async (context) => {
      attached = JSON.stringify(context.messages.at(-1)).includes('ACTUAL_FILE_REFERENCE_CONTENT');
      return fauxAssistantMessage('Native read attachment received.');
    },
  ]);
  await input.press('Control+Enter');
  await settle();
  assert.ok(attached);
  await input.fill('/skill:ord');
  await page.locator('.input-candidates [role=option]').waitFor();
  await input.press('Escape');
  assert.equal(await page.locator('.input-candidates [role=option]').count(), 0);
  await input.fill('');
  checks.push(
    'keyboard Skill completion expands through Pi; quoted directory/file completion uses native read; Shift+Enter, Control+Enter, Escape',
  );
  await nav('能力管理');
  await page.getByText(/Tool 列表与来源/).click();
  await page.getByText(/普通 Skill · 无执行 Extension，无需代码审查/).waitFor();
  await page
    .locator('summary')
    .filter({ hasText: /^read ·/ })
    .click();
  await page
    .getByText(/个会话可调用/)
    .first()
    .waitFor();
  await page.screenshot({ path: join(out, 'tools.png') });
  checks.push('native Tool runtime status, source, parameters and ordinary Skill review distinction');
  await page.locator('nav button').filter({ hasText: root }).click();
  fake.setResponses([
    fauxAssistantMessage(
      fauxToolCall('memory_save', {
        knowledge: {
          title: 'Browser saved knowledge',
          content: 'Browser memory fact.',
          kind: 'fact',
          scope: 'project',
        },
        reason: 'User requested persistent project fact.',
      }),
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Saved.'),
  ]);
  await service.prompt(session.id, 'Remember the project fact for later tasks.');
  await settle();
  const feedback = page.getByRole('region', { name: '记忆操作结果' });
  // section is named as a region by its accessible label.
  await feedback.getByText(/新增记忆：Browser saved knowledge/).waitFor();
  await feedback.getByText('当前记忆状态', { exact: true }).click();
  await feedback.getByText(/最新修订 #1/).waitFor();
  const ctx = await service.memoryUserContext(root);
  const saved = service.memory.search(ctx, { query: 'Browser saved knowledge' }).items[0];
  assert.ok(saved);
  service.memory.revise(ctx, saved.id, {
    baseRevision: 1,
    content: { title: saved.title, content: 'Corrected current fact', kind: 'fact', scope: 'project' },
    reason: 'Browser current status regression',
  });
  await page.evaluate(() => window.dispatchEvent(new Event('agent-memory-changed')));
  await feedback.getByText(/最新修订 #2.*历史/).waitFor();
  await page.screenshot({ path: join(out, 'memory-feedback.png') });
  await feedback.getByRole('button', { name: '查看来源证据' }).first().click();
  await page.getByRole('tab', { name: '轨迹', exact: true }).waitFor();
  checks.push(
    'successful Memory write feedback, immutable operation revision, fresh current revision and Session/Entry evidence link',
  );
  const db = new DatabaseSync(join(root, 'data', 'product.sqlite'));
  const originals: string[] = [];
  db.exec('BEGIN');
  for (let index = 0; index < 1000; index++) {
    const id = randomUUID();
    const record = {
      id,
      jobId: id,
      sessionId: session.id,
      reflectionSessionId: randomUUID(),
      project: root,
      status: 'succeeded',
      created: index,
      updated: index,
      summary: `Historical ${index}: ${'完整原文'.repeat(500)}`,
      findings: ['Evidence based history '.repeat(1500)],
      uncertainties: [],
      evidence: [],
      changes: [],
    };
    const raw = JSON.stringify(record);
    originals.push(raw);
    db.prepare(
      'INSERT INTO reflection_jobs(id,session_id,project,provider,model,scheduled_at,created,updated,status,last_marker_entry_id,reflection_session_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      id,
      session.id,
      root,
      'test',
      'test',
      index,
      index,
      index,
      'succeeded',
      `marker-${index}`,
      record.reflectionSessionId,
    );
    db.prepare('INSERT INTO reflections VALUES(?,?,?,?)').run(id, session.id, root, raw);
  }
  db.exec('COMMIT');
  const timings = {
    httpSummary: new Array<number>(),
    httpPage: new Array<number>(),
    httpDetail: new Array<number>(),
    browserOpen: new Array<number>(),
    browserPage: new Array<number>(),
    browserDetail: new Array<number>(),
    browserCachedOpen: new Array<number>(),
    browserColdReload: new Array<number>(),
  };
  const bytes: Record<string, number> = {};
  for (let index = 0; index < 25; index++) {
    for (const [name, path] of [
      ['httpSummary', '/reflections?view=summary'],
      ['httpPage', '/reflections?view=summary&offset=20'],
    ] as const) {
      const start = performance.now();
      const value = await request(path);
      timings[name].push(performance.now() - start);
      bytes[name] = Buffer.byteLength(JSON.stringify(value));
    }
  }
  let start = performance.now();
  await nav('反思记录');
  await page.locator('.reflection-item').first().waitFor();
  timings.browserOpen.push(performance.now() - start);
  for (let index = 0; index < 10; index++) {
    const previous = await page.locator('.reflection-item strong').first().textContent();
    start = performance.now();
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await page.getByRole('button', { name: '下一页', exact: true }).isEnabled();
    await page.waitForFunction(
      (last) => document.querySelector('.reflection-item strong')?.textContent !== last,
      previous,
    );
    timings.browserPage.push(performance.now() - start);
    const target = page.locator('.reflection-item').first();
    const title = await target.locator('strong').textContent();
    start = performance.now();
    await target.click();
    await page
      .locator('.reflection-detail h2')
      .filter({ hasText: title ?? '' })
      .waitFor();
    timings.browserDetail.push(performance.now() - start);
    if (!index) {
      await page.locator('.reflection-detail').evaluate((node) => {
        node.scrollTop = 400;
      });
      const position = await page.locator('.reflection-detail').evaluate((node) => node.scrollTop);
      let release = () => {};
      const gate = new Promise<void>((done) => {
        release = done;
      });
      const detailRoute = /\/api\/reflections\/[a-f0-9-]{36}$/;
      await page.route(detailRoute, async (route) => {
        await gate;
        await route.continue();
      });
      const pending = page.waitForRequest(detailRoute);
      await page.evaluate(() => window.dispatchEvent(new Event('agent-reflection-changed')));
      await pending;
      assert.equal(await page.locator('.reflection-detail h2').count(), 1);
      assert.equal(await page.locator('.reflection-detail').evaluate((node) => node.scrollTop), position);
      release();
      await page.waitForFunction(
        () => document.querySelector('.reflection-detail')?.getAttribute('aria-busy') === 'false',
      );
      await page.unroute(detailRoute);
      checks.push(
        'IME composition Enter does not select/send; background Reflection refresh preserves complete detail and reading position',
      );
    }

    start = performance.now();
    await nav('模型设置');
    await nav('反思记录');
    await page.locator('.reflection-item').first().waitFor();
    timings.browserCachedOpen.push(performance.now() - start);
  }
  for (let index = 0; index < 10; index++) {
    start = performance.now();
    await page.reload();
    await page.locator('.reflection-item').first().waitFor();
    timings.browserColdReload.push(performance.now() - start);
  }
  const original = originals[0];
  assert.ok(original);
  const id = JSON.parse(original).id;
  for (let index = 0; index < 25; index++) {
    start = performance.now();
    const value = await request(`/reflections/${id}`);
    timings.httpDetail.push(performance.now() - start);
    bytes.httpDetail = Buffer.byteLength(JSON.stringify(value));
  }
  const digest = (values: string[]) => createHash('sha256').update(values.join('\n')).digest('hex');
  const after = originals.map((raw) =>
    String(db.prepare('SELECT data FROM reflections WHERE id=?').get(JSON.parse(raw).id)?.data),
  );
  assert.equal(digest(after), digest(originals));
  db.close();
  receipt.performance = {
    fixture: '1000 complete synthetic historical records, real HTTP/Chrome, signed environment probe',
    metrics: Object.fromEntries(
      Object.entries(timings).map(([name, values]) => {
        values.sort((a, b) => a - b);
        return [
          name,
          {
            samples: values.length,
            p50Ms: values[Math.floor(values.length * 0.5)],
            p95Ms: values[Math.min(values.length - 1, Math.floor(values.length * 0.95))],
          },
        ];
      }),
    ),
    bytes,
    probes,
    historySha256: digest(originals),
  };
  checks.push(
    '1000 complete Reflection records: HTTP/browser paging, lazy detail, cached reopen and unchanged full history hash',
  );
  await page.screenshot({ path: join(out, 'reflection.png') });
  await nav('模型设置');
  await page.getByLabel('模型提供方').selectOption('openai');
  await page.getByLabel('API Key', { exact: true }).fill('isolated-browser-fixture-key');
  await page.getByRole('button', { name: '保存 Key', exact: true }).click();
  await page.getByRole('button', { name: '退出 Host 授权', exact: true }).waitFor();
  await page.getByRole('button', { name: '退出 Host 授权', exact: true }).click();
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '退出 Host 授权')
        ?.disabled,
  );
  checks.push(
    'isolated fixture API Key saved and removed through model settings; does not claim provider-side validity',
  );
  const piPath = join(homedir(), '.pi/agent/auth.json');
  const piBefore = await readFile(piPath).catch(() => Buffer.from('absent'));
  await page.getByLabel('模型提供方').selectOption('openai-codex');
  await page
    .getByRole('button', { name: /ChatGPT|OAuth/ })
    .first()
    .click();
  await page.getByLabel('登录选项', { exact: true }).waitFor();
  await page.getByLabel('登录选项', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: '继续', exact: true }).click();
  const link = page.getByRole('link', { name: '打开提供方授权页面', exact: true });
  await link.waitFor();
  const href = await link.getAttribute('href');
  assert.ok(href);
  const authPage = await browser.newPage();
  await authPage.goto(href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await authPage.screenshot({ path: join(out, 'oauth-external.png') });
  receipt.oauth = {
    completed: false,
    externalPage: new URL(authPage.url()).origin + new URL(authPage.url()).pathname,
    title: await authPage.title(),
    reason:
      'External authorization verification challenge in isolated Chrome; account sign-in and callback not completed; no imported credentials substituted.',
  };
  await request(`/provider-auth/login/${(await request('/provider-auth/login')).id}`, 'DELETE');
  assert.deepEqual(await readFile(piPath).catch(() => Buffer.from('absent')), piBefore);
  checks.push(
    'native OAuth authorization URL reaches external sign-in; cancellation leaves original Pi credentials unchanged',
  );
  assert.deepEqual(errors, []);
  receipt.passed = true;
} catch (error) {
  receipt.error = error instanceof Error ? error.message : String(error);
  await page.screenshot({ path: join(out, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await writeFile(join(out, 'receipt.json'), JSON.stringify(receipt, null, 2));
  await browser.close();
  await host.close();
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(receipt));
}
