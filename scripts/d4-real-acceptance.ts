import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { startHost } from '../apps/host/transport/server.js';
import type { EvolutionActivity } from '../apps/host/evolution/activities.js';

const root = await mkdtemp(join(tmpdir(), 'd4-real-')),
  output = resolve(`docs/evidence/d4-business-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`);
await mkdir(output, { recursive: true });
const token = randomBytes(32).toString('hex'),
  key = randomBytes(32);
const receipt: Record<string, unknown> = {
  time: new Date().toISOString(),
  platform: process.platform,
  execution: 'real Pi SDK 1.3.0, native Tool Calling and actual Provider',
  sourceAtStartSha256: createHash('sha256')
    .update(await readFile('apps/host/runtime/agent.ts'))
    .digest('hex'),
  result: 'running',
};
const host = await startHost({ dataDir: join(root, 'data'), token, key, webDir: resolve('dist/web') });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(20000);
const request = async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
  const response = await fetch(`${host.origin}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  assert.ok(response.ok, `HTTP ${response.status} ${path}: ${JSON.stringify(value)}`);
  return value;
};
const idle = async (id: string) => {
  const deadline = Date.now() + 480000;
  for (;;) {
    const s = await host.service.viewSession(id);
    if (!s.busy) return s;
    assert.ok(Date.now() < deadline, 'real session timeout');
    await new Promise((r) => setTimeout(r, 500));
  }
};
const finish = async (id: string) => {
  const deadline = Date.now() + 480000;
  for (;;) {
    const a = host.service.activities.get(id);
    if (!['preparing', 'running', 'checking'].includes(a.status)) return a;
    assert.ok(Date.now() < deadline, `activity timeout: ${a.status}`);
    await new Promise((r) => setTimeout(r, 500));
  }
};
const goal =
  '创建可复用的文本差异能力：给出两段文本，返回行级新增、删除与保持内容，用于核对文档修改。特殊 Skill 名称 text-diff，实际 Tool 必须可在后续普通会话发现与调用；在候选中自主管理需要的依赖，覆盖空文本、中文和重复行。';
try {
  await request('/credentials', 'POST', { provider: 'openai-codex', importExisting: true });
  const catalog = await host.service.models();
  const model =
    catalog.models.find((m) => m.id === (process.env.AGENT_SMOKE_MODEL ?? 'gpt-6.1-sol')) ?? catalog.models[0];
  assert.ok(model, 'real Provider required');
  receipt.model = model;
  const initial = await host.service.create(root, model.provider, model.id);
  await page.goto(`${host.origin}/#token=${token}`);
  await page.locator('.sidebar-bottom').getByText('已连接', { exact: true }).waitFor();
  const shown = page.locator('.host-retained-session:not([hidden])');
  await page.locator(`.session-list [data-session="${initial.id}"]`).click();
  // The capability entry belongs to a session with a finished turn, so the user first works in it.
  await shown
    .getByLabel('发送给 Agent', { exact: true })
    .fill('我经常需要核对文档两版之间的行级修改。这一轮不要使用任何工具，只简短回复收到。');
  await shown.getByLabel('发送任务', { exact: true }).click();
  const worked = await idle(initial.id);
  assert.equal(worked.error, undefined);
  const activityPanel = shown.getByLabel('能力目标与改进进度', { exact: true });
  await activityPanel.getByText('让 Agent 改进这类任务', { exact: true }).click();
  await activityPanel.getByLabel('希望获得的能力', { exact: true }).fill(goal);
  await activityPanel.getByRole('button', { name: '进入独立讨论', exact: true }).click();
  await activityPanel.locator('[data-activity-status="discussion"]').getByText('讨论中', { exact: true }).waitFor();
  const [a] = await request<EvolutionActivity[]>('/activities');
  assert.ok(a, 'activity required');
  await page.locator(`.session-list [data-session="${a.sessionId}"][aria-current="page"]`).waitFor();
  receipt.activityId = a.id;
  receipt.discussionSessionId = a.sessionId;
  await shown
    .getByLabel('发送给 Agent', { exact: true })
    .fill('先讨论这个目标的实际用途、输入输出与边界。先不要开发，等我在授权表单确认。');
  await shown.getByLabel('发送任务', { exact: true }).click();
  const discussed = await idle(a.sessionId);
  assert.equal(discussed.error, undefined);
  assert.equal(host.service.activities.get(a.id).status, 'discussion');
  assert.ok(discussed.messages.some((m) => m.role === 'assistant'));
  receipt.discussion = { nativeSessionId: discussed.id, messages: discussed.messages.length, unauthorized: false };
  await activityPanel.getByRole('button', { name: '审阅开发授权', exact: true }).click();
  const grant = page.getByRole('dialog', { name: '授权能力开发' });
  await grant
    .getByLabel('授权目标与限制', { exact: true })
    .fill(
      goal +
        ' 授权仅限新建 text-diff，不修改任何其他能力；使用纯本地计算，不访问外部数据服务。自主完成实现和实际测试后提交。',
    );
  await grant.getByLabel('允许新建的技能名称', { exact: true }).fill('text-diff');
  await page.screenshot({ path: join(output, 'web-grant.png') });
  await grant.getByRole('button', { name: '授权并开始开发', exact: true }).click();
  console.log('Real user UI authorization submitted; autonomous development running.');
  let completed = await finish(a.id);
  receipt.activity = completed;
  assert.equal(completed.status, 'completed', completed.error ?? 'activity not completed');
  assert.equal(completed.releases.length, 1, 'real code result required');
  const [release] = completed.releases;
  assert.ok(release);
  const skill = host.service.skills.record(release.skillId),
    v1 = host.service.skills.version(release.version);
  assert.equal(v1.review, undefined, 'D2 human review must remain absent');
  assert.ok(v1.evolution);
  const dev = await idle(a.sessionId);
  const devTools = dev.messages.filter((m) => m.role === 'toolResult').map((m) => m.toolName);
  assert.ok(devTools.includes('write') || devTools.includes('bash'), 'actual generated code required');
  assert.ok(devTools.includes('bash'), 'real tests or dependency work through native Shell required');
  receipt.nativeDevelopmentTools = devTools;
  receipt.releaseOperation = host.service.skills.operation(release.operationId);
  await cp(host.service.skills.packagePath(v1), join(output, 'generated-v1'), {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: (p) => !p.split('/').includes('node_modules'),
  });
  receipt.v1Digest = v1.digest;
  const normal = await host.service.create(root, model.provider, model.id);
  await host.service.prompt(
    normal.id,
    '比较下面两版内容，列出新增和删除的行。旧版：春天\n夏天\n秋天；新版：春天\n盛夏\n秋天\n冬天。请使用适合比较文本的能力完成。',
  );
  const used = await idle(normal.id);
  assert.equal(used.error, undefined);
  const calls = used.messages.filter((m) => m.role === 'toolResult');
  assert.ok(
    calls.some((m) => m.toolName === 'tool_search'),
    'ordinary agent must discover the generated Tool',
  );
  const toolNames = host.service.skills.operation(release.operationId).checks?.map((c) => c.tool) ?? [];
  assert.ok(
    calls.some((m) => toolNames.includes(m.toolName) && !m.isError),
    'ordinary agent must really call the generated Tool',
  );
  receipt.normalUse = {
    sessionId: normal.id,
    tools: calls.map((m) => m.toolName),
    results: host.service.sensitive.copy(calls),
  };
  console.log('New capability autonomously discovered and called in an ordinary session.');
  // A second real authorized improvement yields a distinct version, making rollback observable.
  const b = await host.service.createActivity(
    initial.id,
    '改进 text-diff 的输出说明：保留原有 Tool 行为与参数，补充清楚的输入输出及边界示例。',
  );
  await host.service.prompt(b.sessionId, '讨论这个文档改进目标；保持执行代码不变。');
  await idle(b.sessionId);
  await host.service.authorizeActivity(b.id, {
    baseRevision: host.service.activities.get(b.id).revision,
    goal: '仅改进 text-diff 的 SKILL.md 示例与局限说明，不修改 Tool 执行行为。保留已有 Tool probes，测试原有接口后提交新版本。',
    existingSkills: [skill.id],
    newSkills: [],
  });
  completed = await finish(b.id);
  receipt.improvement = completed;
  assert.equal(completed.status, 'completed', completed.error ?? 'improvement did not complete');
  const v2 = host.service.skills.record(skill.id).current;
  assert.ok(v2 && v2 !== v1.id);
  // User uses the existing rollback UI, starting from the release shown in the development session.
  await page.locator(`.session-list [data-session="${a.sessionId}"]`).click();
  const releaseRow = activityPanel.locator('.host-activity-release[data-release-status="applied"]');
  await releaseRow.getByText('此活动已发布的历史版本', { exact: true }).waitFor();
  await releaseRow.getByRole('button', { name: '查看精确版本', exact: true }).click();
  await page.getByRole('tab', { name: '版本', exact: true }).click();
  const version = page.locator('.asm-version-list section').filter({ hasText: v1.id.slice(0, 8) });
  await version.getByRole('button', { name: '恢复此版本', exact: true }).click();
  await page
    .getByRole('dialog', { name: '恢复正式版本' })
    .getByRole('button', { name: '确认恢复', exact: true })
    .click();
  const deadline = Date.now() + 30000;
  while (host.service.skills.record(skill.id).current !== v1.id) {
    assert.ok(Date.now() < deadline, 'UI rollback timeout');
    await new Promise((r) => setTimeout(r, 100));
  }
  receipt.rollback = { from: v2, to: v1.id, current: host.service.skills.record(skill.id).current };
  await version.getByText('当前正式', { exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'web-version-rollback.png') });
  const after = await host.service.create(root, model.provider, model.id);
  await host.service.prompt(
    after.id,
    '比较两段文字的行差异：旧文本 alpha\nbeta；新文本 alpha\ngamma。使用可用的文本差异能力。',
  );
  const rolled = await idle(after.id);
  assert.equal(rolled.error, undefined);
  assert.ok(rolled.messages.some((m) => m.role === 'toolResult' && toolNames.includes(m.toolName) && !m.isError));
  receipt.rollbackUse = {
    sessionId: after.id,
    tools: rolled.messages.filter((m) => m.role === 'toolResult').map((m) => m.toolName),
  };
  receipt.result = 'passed';
  console.log(JSON.stringify({ result: 'passed', activityId: a.id, toolNames, rollback: receipt.rollback }));
} catch (e) {
  receipt.result = 'failed';
  receipt.error = e instanceof Error ? e.message : String(e);
  console.error(receipt.error);
  throw e;
} finally {
  receipt.sourceAtReceiptSha256 = createHash('sha256')
    .update(await readFile('apps/host/runtime/agent.ts'))
    .digest('hex');
  await writeFile(join(output, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  await browser.close();
  await host.close();
  await rm(root, { recursive: true, force: true });
}
