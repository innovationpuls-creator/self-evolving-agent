import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { startHost } from '../apps/host/transport/server.js';

const root = await mkdtemp(join(tmpdir(), 'agent-d6-client-'));
const token = randomBytes(32).toString('hex');
const host = await startHost({
  dataDir: join(root, 'data'),
  key: randomBytes(32),
  token,
  webDir: resolve('dist/web'),
});
const fake = fauxProvider({ models: [{ id: 'd6-browser', contextWindow: 100000, maxTokens: 512 }] });
host.service.runtime.registerNativeProvider(fake.provider);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const wait = async (check: () => boolean | Promise<boolean>) => {
  const until = Date.now() + 15000;
  while (!(await check())) {
    assert.ok(Date.now() < until, 'timed out while waiting for Host state');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};
try {
  const project = join(root, 'project');
  await mkdir(join(project, 'notes'), { recursive: true });
  await mkdir(join(project, 'src'), { recursive: true });
  await writeFile(join(project, 'notes', 'alpha.txt'), 'D6_FILE_REFERENCE_BYTES');
  await writeFile(join(project, 'src', 'index.ts'), 'export const d6 = true;');
  const skillSource = join(root, 'controlled-skill');
  await mkdir(skillSource, { recursive: true });
  await writeFile(
    join(skillSource, 'SKILL.md'),
    '---\nname: d6-controlled-skill\ndescription: Controlled D6 browser verification skill.\n---\nUse the scoped D6 knowledge when asked.\n',
  );
  await writeFile(join(skillSource, 'knowledge.md'), '# D6 受控知识\n\n用于验证知识版本的受控内容。\n');
  const first = await host.service.create(project, fake.provider.id, 'd6-browser');
  const second = await host.service.create(project, fake.provider.id, 'd6-browser');
  let promptContext = '';
  fake.setResponses([
    (context) => {
      promptContext = JSON.stringify(context);
      return fauxAssistantMessage('受控回复：文件引用已进入当前会话。');
    },
    () => fauxAssistantMessage('受控活动讨论已记录。'),
  ]);
  const page = await browser.newPage({ viewport: { width: 1440, height: 850 } });
  page.setDefaultTimeout(15000);
  await page.goto(`${host.origin}/#token=${token}`);
  await page.locator('.app.host-product').waitFor();
  await page.locator(`.session-list [data-session="${first.id}"]`).click();
  await page.getByLabel('发送给 Agent').waitFor();
  await page.getByLabel('发送给 Agent').fill('读取 @"notes/alpha.txt" 并确认内容');
  await page.locator(`.session-list [data-session="${second.id}"]`).click();
  await page.locator('.host-retained-session:not([hidden])').getByLabel('发送给 Agent').waitFor();
  await page.locator(`.session-list [data-session="${first.id}"]`).click();
  const activeInput = page.locator('.host-retained-session:not([hidden])').getByLabel('发送给 Agent');
  await activeInput.waitFor();
  assert.equal(await activeInput.inputValue(), '读取 @"notes/alpha.txt" 并确认内容');
  await activeInput.press('Meta+Enter');
  await wait(async () => !(await host.service.viewSession(first.id)).busy);
  assert.ok(promptContext.includes('D6_FILE_REFERENCE_BYTES'), 'textual @ reference did not reach native read context');
  await page.getByLabel('引用项目文件').click();
  await page.getByRole('dialog', { name: '引用项目文件' }).waitFor();
  await page.getByRole('button', { name: /notes/ }).click();
  const query = page.getByPlaceholder('搜索当前目录');
  await query.fill('alpha');
  await page.getByRole('button', { name: /alpha.txt/ }).waitFor();
  await page.getByLabel('返回上级目录').click();
  await page.getByRole('button', { name: /src/ }).waitFor();
  assert.equal(await query.inputValue(), '', 'directory navigation must clear the file keyword');
  await page.getByRole('button', { name: '关闭' }).click();
  await page.getByLabel('会话历史与分支').click();
  await page.getByRole('dialog', { name: '会话历史与分支' }).waitFor();
  const entries = page.getByRole('radio');
  assert.ok((await entries.count()) >= 2, 'history does not expose native session entries');
  await entries.nth(0).check();
  await page.getByRole('button', { name: '只读查看' }).click();
  await page.getByRole('button', { name: /返回/ }).first().waitFor();
  await page.getByRole('button', { name: /返回/ }).first().click();
  await page.getByLabel('发送给 Agent').waitFor();
  await page.getByRole('button', { name: '轨迹' }).click();
  await page.locator('[aria-label="会话轨迹"]').waitFor();
  await page.getByRole('button', { name: '记忆' }).click();
  await page.getByRole('heading', { name: '已保存的记忆' }).waitFor();
  await page.getByRole('button', { name: '新建记忆' }).click();
  await page.getByLabel('记忆标题').fill('D6 受控记忆');
  await page.getByLabel('知识内容').fill('初始可检索正文。');
  await page.getByLabel('修改依据').fill('隔离验收创建。');
  await page.getByRole('button', { name: '保存记忆' }).click();
  await page.waitForTimeout(800);
  const memoryFailure = page.getByRole('alert');
  if (await memoryFailure.count())
    throw new Error(`memory create UI failed: ${await memoryFailure.last().innerText()}`);
  // The formal editor immediately projects a confirmed write to the read-only record.
  await page.getByRole('heading', { name: 'D6 受控记忆' }).waitFor();
  await page.getByRole('button', { name: '编辑记忆' }).click();
  await page.getByLabel('知识内容').fill('修订后的可检索正文。');
  await page.getByLabel('修改依据').fill('隔离验收修订。');
  await page.getByRole('button', { name: '保存修订' }).click();
  await page.getByRole('heading', { name: 'D6 受控记忆' }).waitFor();
  await page.getByRole('button', { name: /修订历史/ }).click();
  await page.getByLabel('查看修订').selectOption('1');
  await page.getByText('初始可检索正文。').waitFor();
  await page.locator('.sidebar').getByRole('button', { name: '记忆', exact: true }).click();
  await page.getByRole('heading', { name: '已保存的记忆' }).waitFor();
  const memorySearch = page.getByPlaceholder('搜索记忆内容');
  await memorySearch.fill('D6');
  await page.waitForFunction(() => {
    const durable = JSON.stringify(history.state ?? '');
    return (
      !location.href.includes('D6') &&
      !durable.includes('D6') &&
      !sessionStorage.getItem('agent-product-navigation')?.includes('D6')
    );
  });
  await page.getByRole('button', { name: /D6 受控记忆/ }).click();
  await page.getByRole('heading', { name: 'D6 受控记忆' }).waitFor();
  await page.getByRole('button', { name: '返回上一页' }).click();
  await memorySearch.waitFor();
  assert.equal(await memorySearch.inputValue(), 'D6', '同页返回必须保留仅内存中的记忆查询');
  await page.reload();
  await page.getByRole('heading', { name: '已保存的记忆' }).waitFor();
  assert.equal(await page.getByPlaceholder('搜索记忆内容').inputValue(), '', '重新载入不能恢复短暂记忆查询');
  await page.getByRole('button', { name: '技能与工具' }).click();
  await page.getByRole('heading', { name: '技能与工具' }).waitFor();
  await page.getByRole('button', { name: '导入技能' }).click();
  const skillDialog = page.getByRole('dialog', { name: '导入技能' });
  await skillDialog.getByLabel('Skill 来源').fill(skillSource);
  await skillDialog.getByText('Extension 与知识文件归属').click();
  await skillDialog
    .getByLabel('Skill 绑定')
    .fill('[{"skill":"SKILL.md","extensions":[],"knowledgeFiles":["knowledge.md"]}]');
  await skillDialog.getByRole('button', { name: '保存候选' }).click();
  await page.getByRole('button', { name: /d6-controlled-skill/ }).waitFor();
  await page.getByRole('button', { name: /d6-controlled-skill/ }).click();
  await page.getByRole('heading', { name: 'd6-controlled-skill' }).waitFor();
  await page.getByRole('tab', { name: '审查与发布' }).click();
  await page.getByRole('button', { name: '检查并发布' }).click();
  await page.getByRole('dialog', { name: '发布候选' }).getByRole('button', { name: '确认发布' }).click();
  await page.locator('[data-operation-status="applied"]').first().waitFor();
  await page.locator('.asm-status-row').getByRole('button', { name: '刷新' }).click();
  await page.locator('.asm-status-row').getByText('已启用').waitFor();
  await page.getByRole('tab', { name: '知识' }).click();
  await page.getByText('修订知识正文').click();
  await page.getByLabel('知识文件').selectOption('knowledge.md');
  await page.getByRole('button', { name: '读取当前知识' }).click();
  await page.getByLabel('知识正文').fill('# D6 受控知识\n\n用于验证知识版本的受控内容。');
  await page.getByRole('button', { name: '保存知识修订' }).click();
  const controlledSkill = host.service.skills.records().find((skill) => skill.name === 'd6-controlled-skill');
  assert.ok(controlledSkill, '发布后的 Skill 不存在');
  await wait(async () => (await host.service.skills.detail(controlledSkill.id)).knowledge.length === 1);
  await page.getByText('D6 受控知识').waitFor();
  await page.locator(`.session-list [data-session="${first.id}"]`).click();
  const skillInput = page.locator('.host-retained-session:not([hidden])').getByLabel('发送给 Agent');
  await skillInput.fill('保留这段任务描述');
  await page.getByLabel('引用 Skill').click();
  const skillPicker = page.getByRole('dialog', { name: '引用 Skill' });
  await skillPicker.getByRole('button', { name: /d6-controlled-skill/ }).click();
  assert.equal(
    await skillInput.inputValue(),
    '/skill:d6-controlled-skill 保留这段任务描述',
    'Skill 工具栏必须把原生命令放在草稿开头并保留已有任务文本',
  );
  await skillInput.fill('失败后仍需保留的草稿');
  let releasePrompt!: () => void;
  let promptStarted!: () => void;
  const promptGate = new Promise<void>((resolve) => {
    releasePrompt = resolve;
  });
  const promptRequest = new Promise<void>((resolve) => {
    promptStarted = resolve;
  });
  await page.route(`**/api/sessions/${first.id}/prompt`, async (route) => {
    promptStarted();
    await promptGate;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: '受控提交失败' }),
    });
  });
  await skillInput.press('Meta+Enter');
  await promptRequest;
  await page.locator(`.session-list [data-session="${second.id}"]`).click();
  releasePrompt();
  await page.locator(`.session-list [data-session="${first.id}"]`).click();
  const restoredInput = page.locator('.host-retained-session:not([hidden])').getByLabel('发送给 Agent');
  await restoredInput.waitFor();
  assert.equal(await restoredInput.inputValue(), '失败后仍需保留的草稿');
  await page.getByRole('alert').filter({ hasText: '受控提交失败' }).waitFor();
  await page.unrouteAll({ behavior: 'wait' });
  await page.locator('.sidebar').getByRole('button', { name: '反思记录', exact: true }).click();
  await page.getByRole('heading', { name: '反思记录' }).waitFor();
  assert.ok(host.service.reflection.jobs.list().length >= 1, '会话完成后没有登记真实 Reflection 工作');
  assert.equal(host.service.reflection.list().length, 0, '受控 Host 未配置 native Reflection，不应伪造反思记录');
  await page.getByRole('button', { name: '改进建议' }).click();
  await page.getByRole('heading', { name: '改进建议' }).waitFor();
  await page.getByRole('button', { name: '提出建议' }).click();
  await page.getByLabel('建议名称').fill('D6 受控建议');
  await page.getByLabel('希望改变什么').fill('保持现有能力的可读入口。');
  await page.getByLabel('为什么需要改变').fill('隔离验收验证讨论链。');
  await page.getByLabel('预期作用').fill('用户可判断是否继续。');
  await page.getByLabel('尚不确定的部分').fill('不创建不存在的执行证据。');
  await page.getByLabel('建议怎样开始').fill('先建立独立讨论。');
  await page.getByRole('button', { name: '保存建议' }).click();
  await page.getByRole('heading', { name: 'D6 受控建议' }).waitFor();
  await page.getByRole('button', { name: '采纳并讨论' }).click();
  await page.locator('.host-retained-session:not([hidden])').getByLabel('发送给 Agent').waitFor();
  const activityPanel = page.getByLabel('能力目标与开发活动');
  await activityPanel.waitFor();
  await activityPanel.getByText('讨论中').waitFor();
  await activityPanel.getByRole('button', { name: '审阅开发授权' }).click();
  const grant = page.getByRole('dialog', { name: '授权能力开发' });
  await grant.getByLabel('允许新建的技能名称').fill('d6-activity-test');
  await grant.getByRole('button', { name: '授权并开始开发' }).click();
  await wait(() => host.service.activities.list().some((activity) => activity.grant?.actor === 'user'));
  await wait(() =>
    host.service.activities.list().some((value) => value.grant?.actor === 'user' && value.status !== 'preparing'),
  );
  const activity = host.service.activities.list().find((value) => value.grant?.actor === 'user');
  assert.ok(activity, 'Host 没有保存用户授权的 Activity');
  assert.ok(
    ['running', 'checking', 'completed', 'failed'].includes(activity.status),
    `unexpected activity state: ${activity.status}`,
  );
  const assertNoHorizontalOverflow = async (width: number) => {
    const metrics = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    assert.equal(metrics.scroll, metrics.client, `horizontal overflow at ${width}px`);
  };
  await page.setViewportSize({ width: 850, height: 850 });
  await page.locator(`.session-list [data-session="${first.id}"]`).click();
  await page.locator('.host-retained-session:not([hidden])').getByLabel('发送给 Agent').waitFor();
  const fileTrigger = page.getByLabel('引用项目文件');
  await fileTrigger.click();
  const fileDialog = page.getByRole('dialog', { name: '引用项目文件' });
  await fileDialog.getByPlaceholder('搜索当前目录').waitFor();
  await fileDialog.getByRole('button', { name: /notes/ }).click();
  await fileDialog.getByPlaceholder('搜索当前目录').fill('alpha');
  await fileDialog.getByRole('button', { name: /alpha.txt/ }).waitFor();
  await assertNoHorizontalOverflow(850);
  await fileDialog.getByRole('button', { name: '关闭' }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '引用项目文件', undefined, {
    timeout: 1500,
  });
  await page.setViewportSize({ width: 390, height: 850 });
  await page.getByLabel('打开导航').click();
  await page.locator('.sidebar.shown').locator(`[data-session="${first.id}"]`).click();
  await page.locator('.host-retained-session:not([hidden])').getByLabel('发送给 Agent').waitFor();
  await page.getByLabel('引用项目文件').click();
  await page.getByRole('dialog', { name: '引用项目文件' }).getByPlaceholder('搜索当前目录').waitFor();
  await assertNoHorizontalOverflow(390);
  await page.getByRole('dialog', { name: '引用项目文件' }).getByRole('button', { name: '关闭' }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '引用项目文件', undefined, {
    timeout: 1500,
  });
  console.log(
    JSON.stringify({
      d6ClientSmoke: 'passed',
      session: true,
      textualFileReference: true,
      sessionDraftRetention: true,
      fileBrowserLocationAndSearch: true,
      historyReadOnlyAndTrajectory: true,
      memoryCreateRevisionAndHistoricalRead: true,
      memoryQueryPrivacy: true,
      skillCandidateReviewPublishAndKnowledge: true,
      skillCommand: true,
      delayedSessionError: true,
      evolutionProposalAndDiscussion: true,
      evolutionAuthorization: true,
      workspaceEntries: ['memory', 'skills', 'reflection', 'evolution', 'settings'],
      responsive: [1440, 850, 390],
    }),
  );
} finally {
  await browser.close();
  await host.close();
  await rm(root, { recursive: true, force: true });
}
