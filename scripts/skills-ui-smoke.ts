import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
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
  await page.getByLabel('任务', { exact: true }).fill(value);
  await page.getByRole('button', { name: '发送 ↑' }).click();
  await page.getByRole('button', { name: '停止', exact: true }).waitFor();
}
try {
  desktop = await _electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${join(root, 'profile')}`],
    env: { ...process.env, AGENT_DESKTOP_DATA_DIR: join(root, 'data') },
    timeout: 30000,
  });
  const page = await desktop.firstWindow();
  await page.locator('.shell').waitFor();
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.getByLabel('模型提供方').selectOption('openai-codex');
  await page.getByRole('button', { name: '导入 Pi 授权' }).click();
  await page
    .locator('.start select option[value="openai-codex/gpt-6-luna"]')
    .waitFor({ state: 'attached', timeout: 30000 });
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  const source = join(root, '.agents/skills/d2-plain');
  await mkdir(source, { recursive: true });
  const phrase = randomUUID();
  await writeFile(join(root, 'phrase-input.txt'), phrase);
  await writeFile(
    join(source, 'SKILL.md'),
    '---\nname: d2-plain\ndescription: Use this Skill when asked for the D2 plain phrase.\n---\nRead phrase-input.txt with the native read tool. Reply D2_PLAIN:<the exact file content>. Do not use bash, write, or edit.',
  );
  await page.getByPlaceholder('工作目录的绝对路径').fill(root);
  await page.locator('.start select').selectOption('openai-codex/gpt-6-luna');
  await page.getByRole('button', { name: '创建会话 →' }).click();
  await page.getByLabel('任务', { exact: true }).waitFor();
  const [created] = await call<State[]>(page, '/sessions');
  assert.ok(created);
  const id = created.id;
  await page.getByRole('button', { name: '能力管理', exact: true }).click();
  await page.getByText('添加 Skill', { exact: true }).click();
  await page.getByLabel('Skill 来源', { exact: true }).fill(source);
  await page.getByRole('button', { name: '保存候选', exact: true }).click();
  await page.locator('.skill-item').filter({ hasText: 'd2-plain' }).waitFor();
  await page.locator('.skill-item').filter({ hasText: 'd2-plain' }).click();
  await page.getByRole('button', { name: '检查并生效', exact: true }).click();
  await page.locator('[data-operation-status="applied"]').filter({ hasText: '已生效' }).waitFor();
  await page.getByRole('button', { name: '返回对话', exact: true }).click();
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const web = await browser.newPage({ viewport: { width: 1240, height: 850 } });
  const token = await page.evaluate(() => sessionStorage.getItem('agent-connection-token'));
  await web.goto(`${new URL(page.url()).origin}/#token=${token}`);
  await web.locator('nav button').first().click();
  await submit(web, 'Use the enabled Skill for the D2 plain phrase. Follow its instructions.');
  const plainState = await idle(page, id);
  assert.ok(JSON.stringify(plainState.messages).includes(`D2_PLAIN:${phrase}`));
  assert.ok(
    plainState.messages.some(
      (m) =>
        m.role === 'toolResult' && m.toolName === 'read' && JSON.stringify(m.content).includes('Read phrase-input.txt'),
    ),
  );
  await web.getByRole('button', { name: '能力管理', exact: true }).click();
  await web.locator('.skill-item').filter({ hasText: 'd2-plain' }).click();
  await web.getByRole('button', { name: '禁用', exact: true }).click();
  await web.getByRole('button', { name: '启用', exact: true }).waitFor();
  await page.getByRole('button', { name: '能力管理', exact: true }).click();
  await page.locator('.skill-item').filter({ hasText: 'd2-plain' }).click();
  await page.getByRole('button', { name: '启用', exact: true }).waitFor();
  await page.getByRole('button', { name: '启用', exact: true }).click();
  await page.getByRole('button', { name: '禁用', exact: true }).waitFor();
  await page.getByRole('button', { name: '返回对话', exact: true }).click();
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
  const version = detail.versions.find((v) => v.id === special.latest)!;
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
    const plain = (await call<{ skills: Skill[] }>(page, '/skills')).skills.find((s) => s.name === 'd2-plain')!;
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
    let live = (await call<{ skills: Skill[] }>(page, '/skills')).skills.find((s) => s.id === plain.id)!;
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
    live = (await call<{ skills: Skill[] }>(page, '/skills')).skills.find((s) => s.id === special.id)!;
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
    live = (await call<{ skills: Skill[] }>(page, '/skills')).skills.find((s) => s.id === special.id)!;
    assert.equal(
      (
        await waitOp(
          page,
          await call(page, `/skills/${special.id}/enabled`, 'POST', { enabled: true, baseRevision: live.revision }),
        )
      ).status,
      'applied',
    );
    await web.getByRole('button', { name: '返回对话', exact: true }).click();
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
  await web.locator('nav button').first().click();
  const same = await call<State>(web, `/sessions/${id}`);
  assert.equal(same.id, id);
  await web.getByRole('button', { name: '能力管理', exact: true }).click();
  await web.locator('.skill-item').filter({ hasText: 'd2-receipt' }).click();
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
  await writeFile(join(evidenceDir, 'skills-real.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} finally {
  await browser?.close();
  await desktop?.close();
  await rm(root, { recursive: true, force: true });
}
