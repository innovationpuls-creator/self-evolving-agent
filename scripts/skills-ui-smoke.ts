import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { _electron, chromium, type ElectronApplication, type Page } from 'playwright-core';
interface Skill {
  name: string;
  id: string;
  latest: string;
  revision: number;
  current?: string;
  enabled: boolean;
}
interface Op {
  id: string;
  status: string;
  message: string;
}
interface State {
  provider: string;
  model: string;
  thinkingLevel: string;
  id: string;
  busy: boolean;
  error?: string;
  messages: Array<{ role: string; toolName?: string; content: unknown }>;
}
const root = await mkdtemp(join(tmpdir(), 'd2-skill-ui-'));
const executable = process.env.AGENT_APP_PATH ?? resolve('release/Agent-darwin-arm64/Agent.app/Contents/MacOS/Agent');
const evidenceDir = resolve(process.env.AGENT_SKILL_EVIDENCE_DIR ?? 'release/d2-evidence');
let desktop: ElectronApplication | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const call = <T>(page: Page, path: string, method = 'GET', body?: unknown) =>
  page.evaluate(
    async ({ path, method, body }) => {
      const res = await fetch(`/api${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem('agent-connection-token')}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const value = await res.json();
      if (!res.ok) throw new Error(value.error);
      return value;
    },
    { path, method, body },
  ) as Promise<T>;
async function waitOp(page: Page, op: Op) {
  const end = Date.now() + 120000;
  while (['checking', 'waiting'].includes(op.status)) {
    assert.ok(Date.now() < end, 'operation timed out');
    await new Promise((ok) => setTimeout(ok, 200));
    op = await call(page, `/skills/operations/${op.id}`);
  }
  return op;
}
async function idle(page: Page, id: string) {
  const end = Date.now() + 180000;
  let state: State;
  do {
    await new Promise((ok) => setTimeout(ok, 300));
    state = await call(page, `/sessions/${id}`);
  } while (state.busy && Date.now() < end);
  assert.equal(state.busy, false);
  assert.equal(state.error, undefined, state.error ?? 'Unexpected model error');
  return state;
}
async function submit(page: Page, value: string) {
  await page.getByLabel('发送给 Agent', { exact: true }).fill(value);
  await page.getByLabel('发送任务', { exact: true }).click();
  await page.getByLabel('停止当前执行', { exact: true }).waitFor();
}
const detailOf = (page: Page) => page.getByRole('region', { name: '技能详情' });
async function openSkill(page: Page, name: string) {
  await page.getByLabel('技能与工具', { exact: true }).click();
  await page.getByRole('heading', { name: '技能与工具' }).waitFor();
  await page
    .getByRole('complementary', { name: '能力目录' })
    .getByRole('button')
    .filter({ has: page.getByText(name, { exact: true }) })
    .click();
  await detailOf(page).getByRole('heading', { name, exact: true }).waitFor();
}
async function setEnabled(page: Page, enabled: boolean) {
  const detail = detailOf(page);
  await detail.getByRole('button', { name: enabled ? '启用' : '禁用', exact: true }).click();
  await page
    .getByRole('dialog', { name: enabled ? '启用技能' : '禁用技能' })
    .getByRole('button', { name: enabled ? '确认启用' : '确认禁用', exact: true })
    .click();
  await detail.getByRole('button', { name: enabled ? '禁用' : '启用', exact: true }).waitFor();
}
async function openSession(page: Page, id: string) {
  await page.locator(`.session-list [data-session="${id}"]`).click();
  await page.getByLabel('发送给 Agent', { exact: true }).waitFor();
}
try {
  desktop = await _electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${join(root, 'profile')}`],
    env: { ...process.env, AGENT_DESKTOP_DATA_DIR: join(root, 'data') },
    timeout: 30000,
  });
  const page = await desktop.firstWindow();
  await page.locator('.app.host-product').waitFor({ timeout: 30000 });
  await page.getByLabel('模型与连接', { exact: true }).click();
  await page.getByLabel('模型提供方').selectOption('openai-codex');
  await page.getByRole('button', { name: '从本机导入已有登录' }).click();
  await page.getByRole('status').filter({ hasText: '已导入本机已有登录' }).waitFor();
  await page.getByRole('button', { name: '返回上一个位置', exact: true }).click();
  await page.getByRole('button', { name: '新会话', exact: true }).click();
  const create = page.getByRole('dialog', { name: '开始一段新会话' });
  await create
    .getByLabel('模型')
    .locator('option[value="openai-codex:gpt-6-luna"]')
    .waitFor({ state: 'attached', timeout: 30000 });
  const source = join(root, '.agents/skills/d2-plain');
  await mkdir(source, { recursive: true });
  const phrase = randomUUID();
  await writeFile(join(root, 'phrase-input.txt'), phrase);
  await writeFile(
    join(source, 'SKILL.md'),
    '---\nname: d2-plain\ndescription: Use this Skill when asked for the D2 plain phrase.\n---\nRead phrase-input.txt with the native read tool. Reply D2_PLAIN:<the exact file content>. Do not use bash, write, or edit.',
  );
  await create.getByLabel('项目文件夹').fill(root);
  await create.getByLabel('模型').selectOption('openai-codex:gpt-6-luna');
  await create.getByRole('button', { name: '创建会话', exact: true }).click();
  await page.getByLabel('发送给 Agent', { exact: true }).waitFor();
  const [created] = await call<State[]>(page, '/sessions');
  assert.ok(created);
  const id = created.id;
  await page.getByLabel('技能与工具', { exact: true }).click();
  await page.getByRole('button', { name: '导入技能', exact: true }).click();
  const importDialog = page.getByRole('dialog', { name: '导入技能' });
  await importDialog.getByLabel('Skill 来源', { exact: true }).fill(source);
  // The former UI imported with global scope by default; keep that scope explicitly.
  await importDialog.getByLabel('范围').selectOption('global');
  await importDialog.getByRole('button', { name: '保存候选', exact: true }).click();
  await openSkill(page, 'd2-plain');
  await detailOf(page).getByRole('tab', { name: '审查与发布' }).click();
  await detailOf(page).getByRole('button', { name: '检查并发布', exact: true }).click();
  await page.getByRole('dialog', { name: '发布候选' }).getByRole('button', { name: '确认发布', exact: true }).click();
  await detailOf(page)
    .locator('[role="status"][data-operation-status="applied"]')
    .filter({ hasText: '已生效' })
    .waitFor();
  await openSession(page, id);
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const web = await browser.newPage({ viewport: { width: 1240, height: 850 } });
  const token = await page.evaluate(() => sessionStorage.getItem('agent-connection-token'));
  await web.goto(`${new URL(page.url()).origin}/#token=${token}`);
  await web.locator('.app.host-product').waitFor();
  await openSession(web, id);
  await submit(web, 'Use the enabled Skill for the D2 plain phrase. Follow its instructions.');
  const plainState = await idle(page, id);
  assert.ok(JSON.stringify(plainState.messages).includes(`D2_PLAIN:${phrase}`));
  assert.ok(
    plainState.messages.some(
      (m) =>
        m.role === 'toolResult' && m.toolName === 'read' && JSON.stringify(m.content).includes('Read phrase-input.txt'),
    ),
  );
  await openSkill(web, 'd2-plain');
  await setEnabled(web, false);
  await openSkill(page, 'd2-plain');
  await setEnabled(page, true);
  await openSession(page, id);
  const before = await idle(page, id);
  assert.equal(before.id, id);
  assert.equal(before.messages.length, plainState.messages.length);
  const sourceSpecial = resolve('tests/fixtures/reviewed-skill');
  const imported = await waitOp(
    page,
    await call(page, '/skills', 'POST', {
      source: sourceSpecial,
      bindings: [{ skill: 'skills/receipt/SKILL.md', extensions: ['extensions/receipt.js'] }],
    }),
  );
  assert.equal(imported.status, 'applied', imported.message);
  const catalog = await call<{ skills: Skill[] }>(page, '/skills');
  const special = catalog.skills.find((s) => s.name === 'd2-receipt');
  assert.ok(special);
  const detail = await call<{ versions: Array<{ id: string; digest: string }> }>(page, `/skills/${special.id}`);
  const version = detail.versions.find((v) => v.id === special.latest);
  assert.ok(version);
  const denied = await waitOp(
    page,
    await call(page, `/skills/${special.id}/publish`, 'POST', { version: version.id, baseRevision: special.revision }),
  );
  assert.equal(denied.status, 'failed');
  let specialRealModel = false,
    humanReview: undefined | { digest: string; notes: string; at: number };
  if (process.env.AGENT_REVIEWED_SKILL_DIGEST) {
    assert.equal(
      process.env.AGENT_REVIEWED_SKILL_DIGEST,
      version.digest,
      'Human approval does not match candidate bytes/runtime',
    );
    assert.ok((process.env.AGENT_SKILL_REVIEW_NOTES ?? '').length >= 10, 'Supply the actual human review conclusion');
    const reviewed = await call<{ review: { digest: string; notes: string; at: number } }>(
      page,
      `/skills/${special.id}/review`,
      'POST',
      {
        version: version.id,
        digest: version.digest,
        notes: process.env.AGENT_SKILL_REVIEW_NOTES,
        reviewedCode: true,
        reviewedDependencies: true,
        reviewedPermissions: true,
      },
    );
    humanReview = reviewed.review;
    assert.equal(humanReview.digest, version.digest);
    const published = await waitOp(
      page,
      await call(page, `/skills/${special.id}/publish`, 'POST', {
        version: version.id,
        baseRevision: special.revision,
      }),
    );
    assert.equal(published.status, 'applied', published.message);
    const config = await idle(page, id);
    await submit(page, 'Use the enabled d2-receipt Skill to produce a receipt for exact value mac-desktop.');
    const result = await idle(page, id);
    assert.ok(
      result.messages.some(
        (m) =>
          m.role === 'toolResult' &&
          m.toolName === 'd2_receipt' &&
          JSON.stringify(m.content).includes('D2_RECEIPT:mac-desktop'),
      ),
    );
    assert.equal(result.id, id);
    const plain = (await call<{ skills: Skill[] }>(page, '/skills')).skills.find((s) => s.name === 'd2-plain');
    assert.ok(plain);
    const plainFile = await call<{ content: string }>(
      page,
      `/skills/${plain.id}/files?version=${plain.latest}&path=SKILL.md`,
    );
    const edited = await call<{ skill: Skill }>(page, `/skills/${plain.id}/edit`, 'POST', {
      baseRevision: plain.revision,
      files: [{ path: 'SKILL.md', content: plainFile.content.replace('D2_PLAIN:', 'D2_PLAIN_V2:') }],
    });
    assert.equal(
      (
        await waitOp(
          page,
          await call(page, `/skills/${plain.id}/publish`, 'POST', {
            version: edited.skill.latest,
            baseRevision: edited.skill.revision,
          }),
        )
      ).status,
      'applied',
    );
    await submit(page, '/skill:d2-plain');
    const v2 = await idle(page, id);
    assert.ok(JSON.stringify(v2.messages.slice(result.messages.length)).includes(`D2_PLAIN_V2:${phrase}`));
    let live = (await call<{ skills: Skill[] }>(page, '/skills')).skills.find((s) => s.id === plain.id);
    assert.ok(live);
    assert.equal(
      (
        await waitOp(
          page,
          await call(page, `/skills/${plain.id}/rollback`, 'POST', {
            version: plain.latest,
            baseRevision: live.revision,
          }),
        )
      ).status,
      'applied',
    );
    live = (await call<{ skills: Skill[] }>(page, '/skills')).skills.find((s) => s.id === special.id);
    assert.ok(live);
    assert.equal(
      (
        await waitOp(
          page,
          await call(page, `/skills/${special.id}/enabled`, 'POST', { enabled: false, baseRevision: live.revision }),
        )
      ).status,
      'applied',
    );
    await submit(
      page,
      'Call tool_search for d2_receipt to check whether it is available. Do not use other tools or invent a receipt.',
    );
    const disabled = await idle(page, id);
    const turn = disabled.messages.slice(v2.messages.length);
    assert.ok(turn.some((m) => m.role === 'toolResult' && m.toolName === 'tool_search'));
    assert.ok(!turn.some((m) => m.role === 'toolResult' && m.toolName === 'd2_receipt'));
    live = (await call<{ skills: Skill[] }>(page, '/skills')).skills.find((s) => s.id === special.id);
    assert.ok(live);
    assert.equal(
      (
        await waitOp(
          page,
          await call(page, `/skills/${special.id}/enabled`, 'POST', { enabled: true, baseRevision: live.revision }),
        )
      ).status,
      'applied',
    );
    await openSession(web, id);
    await submit(web, 'Use the enabled d2-receipt Skill to produce a receipt for exact value mac-web-after-reenable.');
    const resumed = await idle(page, id);
    assert.ok(
      resumed.messages
        .slice(disabled.messages.length)
        .some(
          (m) =>
            m.role === 'toolResult' &&
            m.toolName === 'd2_receipt' &&
            JSON.stringify(m.content).includes('D2_RECEIPT:mac-web-after-reenable'),
        ),
    );
    assert.equal(resumed.id, id);
    assert.equal(resumed.provider, config.provider);
    assert.equal(resumed.model, config.model);
    assert.equal(resumed.thinkingLevel, config.thinkingLevel);
    specialRealModel = true;
  }
  await web.reload();
  await web.locator('.app.host-product').waitFor();
  await openSession(web, id);
  const same = await call<State>(web, `/sessions/${id}`);
  assert.equal(same.id, id);
  await openSkill(web, 'd2-receipt');
  await mkdir(evidenceDir, { recursive: true });
  await web.screenshot({ path: join(evidenceDir, 'skills-macos.png'), fullPage: true });
  const receipt = {
    testedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    humanReview,
    result: specialRealModel ? 'passed' : 'ordinary-passed-special-awaits-human-review',
    packagedDesktop: true,
    webBrowser: 'Chrome',
    model: 'openai-codex/gpt-6-luna',
    ordinaryNativeDiscoveryAndRead: true,
    dualClientEnableDisable: true,
    originalSession: true,
    reconnect: true,
    unreviewedRejected: true,
    specialRealModel,
    ordinaryVersionSwitchAndRollback: specialRealModel,
    specialDisableSearchAndReenable: specialRealModel,
    modelAndThinkingPreserved: specialRealModel,
    reviewDigest: version.digest,
  };
  await writeFile(join(evidenceDir, 'skills-real.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
} finally {
  await browser?.close();
  await desktop?.close();
  await rm(root, { recursive: true, force: true });
}
