import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launch, context, url, record, shot, check, save } from './common.mjs';
const m = JSON.parse(await fs.readFile(new URL('../.runtime/manifest.json', import.meta.url), 'utf8'));
const b = await launch();
for (const w of [1440, 850, 390]) {
  const c = await context(b, w),
    p = await c.newPage();
  record(p, w);
  p.setDefaultTimeout(10000);
  const nav = async (name) => {
    if (!(await p.locator('.sidebar').isVisible()))
      await p.getByRole('button', { name: '打开导航', exact: true }).click();
    await p
      .getByRole('navigation', { name: '主要模块', exact: true })
      .getByRole('button', { name, exact: true })
      .click();
  };
  await check('Skill and Knowledge drafts retain separate file context across navigation', w, async () => {
    await p.goto(url({ page: 'skills', project: m.sourceProject }));
    await p.locator(`[data-skill="${m.skillId}"]`).click();
    await p.getByRole('button', { name: 'tool.js', exact: true }).click();
    await p.getByRole('button', { name: '编辑', exact: true }).click();
    const ed = p.getByRole('textbox', { name: 'Skill 内容' });
    const draft = `${await ed.inputValue()}\n// navigation draft ${w}`;
    await ed.fill(draft);
    await shot(p, 'editor', w);
    await nav('记忆');
    await nav('技能与工具');
    await p.locator(`[data-skill="${m.skillId}"]`).click();
    assert.equal(await ed.inputValue(), draft);
    await p.getByRole('tab', { name: '知识', exact: true }).click();
    await p.getByText('修订知识正文', { exact: true }).click();
    await p.getByRole('combobox', { name: '知识文件' }).selectOption(m.knowledgeFile);
    await p.getByRole('button', { name: '读取当前知识', exact: true }).click();
    const kd = p.getByRole('textbox', { name: '知识正文' });
    await kd.fill(`独立知识草稿 ${w}`);
    await p.getByRole('tab', { name: '内容', exact: true }).click();
    assert.equal(await ed.inputValue(), draft);
    assert.equal(await p.locator('.asm-section-title > strong').innerText(), 'tool.js');
    await nav('记忆');
    await nav('技能与工具');
    await p.locator(`[data-skill="${m.skillId}"]`).click();
    await p.getByRole('tab', { name: '知识', exact: true }).click();
    await p.getByText('修订知识正文', { exact: true }).click();
    assert.equal(await kd.inputValue(), `独立知识草稿 ${w}`);
    return { file: 'tool.js', fileDraftRetained: true, knowledgeDraftRetained: true };
  });
  await check('long file reading, historical knowledge diff, keyboard controls and no overflow', w, async () => {
    await p.getByRole('tab', { name: '内容', exact: true }).click();
    const long = p.locator('.asm-files button').filter({ hasText: 'reference/evidence-and-version' });
    await long.click();
    await p.waitForFunction(() =>
      document.querySelector('.asm-section-title > strong')?.textContent.startsWith('reference/'),
    );
    assert.equal(
      (await p.locator('.asm-file-work').innerText()).split(
        'Preserve exact provenance; do not infer successful operations from text.',
      ).length - 1,
      70,
    );
    await shot(p, 'long-file', w);
    await p.getByRole('tab', { name: '知识', exact: true }).click();
    await p.getByText('与上一知识版本比较', { exact: true }).click();
    await p.locator('.diff-view').waitFor();
    await shot(p, 'knowledge-diff', w);
    await p.getByRole('tab', { name: '知识', exact: true }).focus();
    await p.keyboard.press('ArrowLeft');
    assert.equal(await p.getByRole('tab', { name: '版本', exact: true }).getAttribute('aria-selected'), 'true');
    const size = await p.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(size.scroll <= size.width);
    return size;
  });
  await c.close();
}
await save('continuity');
await b.close();
