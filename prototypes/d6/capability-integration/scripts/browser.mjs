import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { api, launch, context, url, out, record, shot, check, save } from './common.mjs';
const m = JSON.parse(await fs.readFile(new URL('../.runtime/manifest.json', import.meta.url), 'utf8'));
const browser = await launch();
async function poll(fn) {
  const end = Date.now() + 20000;
  let value;
  while (Date.now() < end) {
    value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error('authoritative state deadline');
}
for (const width of [1440, 850, 390]) {
  const ctx = await context(browser, width, width === 1440);
  const page = await ctx.newPage();
  record(page, width);
  await ctx.tracing.start({ screenshots: true, snapshots: true });
  await check('edit → exact diff → digest review → 202 operation → applied', width, async () => {
    await page.goto(url({ page: 'skills', project: m.sourceProject }));
    await page.locator(`[data-skill="${m.skillId}"]`).click();
    await page.getByRole('heading', { name: 'd6-safe-echo' }).waitFor();
    const before = (await api(`/skills/${m.skillId}`)).data;
    const text = (
      await api(
        `/skills/${m.skillId}/files?${new URLSearchParams({ version: before.skill.latest, path: m.skillFile, snapshot: 'true' })}`,
      )
    ).data.content;
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Skill 内容' });
    await editor.fill(`${text}\n\nLocal capability review ${width} / ${Date.now()}.`);
    const edited = await editor.inputValue();
    await page.getByRole('button', { name: '改动', exact: true }).click();
    assert.ok((await page.locator('.asm-file-work').innerText()).includes(`Local capability review ${width}`));
    await shot(page, 'skill-diff', width);
    await page.getByRole('button', { name: '保存候选', exact: true }).click();
    const candidate = await poll(async () => {
      const d = (await api(`/skills/${m.skillId}`)).data;
      return d.skill.latest !== before.skill.latest && d;
    });
    assert.equal(candidate.skill.current, before.skill.current);
    assert.equal(candidate.versions.find((v) => v.id === candidate.skill.latest).review, undefined);
    await page.getByRole('tab', { name: '审查与发布', exact: true }).click();
    await page.getByRole('button', { name: '记录精确内容审查', exact: true }).click();
    const dialog = page.getByRole('dialog');
    for (const c of await dialog.getByRole('checkbox').all()) await c.check();
    await dialog
      .getByRole('textbox', { name: '审查结论' })
      .fill('受控隔离 Skill：已逐项核对完整代码、锁定依赖和本机执行权限；仅纯文本回声。');
    await shot(page, 'skill-review', width);
    await dialog.getByRole('button', { name: '记录审查', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const reviewed = (await api(`/skills/${m.skillId}`)).data.versions.find((v) => v.id === candidate.skill.latest);
    assert.equal(reviewed.review.digest, reviewed.digest);
    await page.getByRole('button', { name: '检查并发布', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '确认发布', exact: true }).click();
    const applied = await poll(async () => {
      const d = (await api(`/skills/${m.skillId}`)).data;
      return (
        d.skill.current === candidate.skill.latest &&
        d.operations.find((o) => o.status === 'applied' && o.id !== before.operations[0]?.id) &&
        d
      );
    });
    await page.locator('.asm-detail > [data-operation-status="applied"]').waitFor();
    await shot(page, 'skill-applied', width);
    await page.waitForTimeout(width === 1440 ? 1100 : 100);
    assert.equal(edited.includes(`Local capability review ${width}`), true);
    return {
      old: before.skill.current,
      candidate: candidate.skill.latest,
      current: applied.skill.current,
      reviewDigest: reviewed.digest,
    };
  });
  await check('version history and independent knowledge revision', width, async () => {
    await page.getByRole('tab', { name: '版本', exact: true }).click();
    await page.getByRole('button', { name: '与当前正式比较', exact: true }).last().click();
    await page.locator('.diff-view').first().waitFor();
    await shot(page, 'skill-history', width);
    await page.getByRole('tab', { name: '知识', exact: true }).click();
    await page.getByText('修订知识正文', { exact: true }).click();
    await page.getByRole('combobox', { name: '知识文件' }).selectOption(m.knowledgeFile);
    await page.getByRole('button', { name: '读取当前知识', exact: true }).click();
    const field = page.getByRole('textbox', { name: '知识正文' });
    await field.waitFor();
    await field.fill(`隔离测试知识修订 ${width}。此修改不改变执行代码。`);
    const before = (await api(`/skills/${m.skillId}`)).data;
    await page.getByRole('button', { name: '保存知识修订', exact: true }).click();
    const after = await poll(async () => {
      const d = (await api(`/skills/${m.skillId}`)).data;
      return d.knowledge.length > before.knowledge.length && d;
    });
    assert.equal(after.skill.current, before.skill.current);
    assert.equal(after.knowledge.at(-1).content, `隔离测试知识修订 ${width}。此修改不改变执行代码。`);
    await shot(page, 'knowledge', width);
    return { version: after.skill.current, knowledge: after.knowledge.at(-1).id };
  });
  await check('suggestion pagination → adopt → live discussion without authorization', width, async () => {
    await page.goto(url({ page: 'evolution', status: '', offset: 0 }));
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await page.waitForURL((u) => JSON.parse(u.searchParams.get('r')).offset === 20);
    await page.locator('.host-suggestion-row').first().waitFor();
    await shot(page, 'suggestions-page2', width);
    const data = (await api('/suggestions?limit=20&offset=20')).data;
    const selected = data.items.find((s) => s.status === 'pending');
    assert.ok(selected);
    await page.locator(`[data-suggestion="${selected.id}"]`).click();
    await page.getByRole('button', { name: '采纳并讨论', exact: true }).click();
    await page.getByRole('textbox', { name: '发送给 Agent' }).waitFor();
    const adopted = (await api(`/suggestions/${selected.id}`)).data;
    assert.equal(adopted.status, 'adopted');
    const activities = (await api('/activities')).data;
    const activity = activities.find((a) => a.sessionId === adopted.discussionSessionId);
    assert.equal(activity.status, 'discussion');
    assert.equal(activity.grant, undefined);
    const composer = page.getByRole('textbox', { name: '发送给 Agent' });
    await composer.fill(`讨论草稿 ${width}`);
    await page.getByRole('button', { name: '审阅开发授权', exact: true }).click();
    await shot(page, 'activity-grant', width);
    await page.getByRole('dialog').getByRole('button', { name: '返回讨论', exact: true }).click();
    assert.equal(await composer.inputValue(), `讨论草稿 ${width}`);
    await page.getByRole('button', { name: '返回原建议', exact: true }).click();
    await page.getByRole('heading', { name: selected.title, exact: true }).waitFor();
    await page.getByRole('button', { name: '继续讨论', exact: true }).click();
    assert.equal(await composer.inputValue(), `讨论草稿 ${width}`);
    await shot(page, 'discussion', width);
    return {
      suggestion: adopted.id,
      discussion: adopted.discussionSessionId,
      activity: activity.id,
      grant: activity.grant ?? null,
    };
  });
  await check('responsive secondary screens without horizontal overflow', width, async () => {
    const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: innerWidth }));
    assert.ok(size.scroll <= size.client, JSON.stringify(size));
    return size;
  });
  await ctx.tracing.stop({ path: new URL(`trace-${width}.zip`, out).pathname });
  const video = page.video();
  await ctx.close();
  if (width === 1440 && video) await video.saveAs(new URL('videos/capability-chain-1440.webm', out).pathname);
}
await save('browser');
await browser.close();
