import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { api, launch, context, url, record, shot, check, save } from './common.mjs';
const root = new URL('../.runtime/', import.meta.url).pathname,
  name = `ui-import-${Date.now().toString(36)}`,
  source = join(root, 'packages', name);
await fs.mkdir(source, { recursive: true });
await fs.writeFile(
  join(source, 'SKILL.md'),
  `---\nname: ${name}\ndescription: Isolated UI import and local draft verification.\n---\n# Local instructions\n\nPreserve exact caller text.\n`,
);
const b = await launch(),
  c = await context(b, 390),
  p = await c.newPage();
record(p, 390);
await check(
  'global import 202 is candidate only; external draft import creates a new immutable version',
  390,
  async () => {
    await p.goto(url({ page: 'skills', project: '' }));
    await p.getByRole('button', { name: '导入技能', exact: true }).click();
    const dialog = p.getByRole('dialog');
    assert.equal(await dialog.locator('select').first().inputValue(), 'global');
    await dialog.getByRole('textbox', { name: 'Skill 来源', exact: true }).fill(source);
    const response = p.waitForResponse((r) => r.url().endsWith('/api/skills') && r.request().method() === 'POST');
    await dialog.getByRole('button', { name: '保存候选', exact: true }).click();
    const receipt = await response;
    assert.equal(receipt.status(), 202);
    const op = await receipt.json();
    let current;
    for (let i = 0; i < 100; i++) {
      const d = (await api(`/skills/operations/${op.id}`)).data;
      if (d.status === 'applied') {
        current = d;
        break;
      }
      assert.ok(!['failed', 'interrupted'].includes(d.status));
      await p.waitForTimeout(100);
    }
    assert.equal(current.status, 'applied');
    const importedCatalog = (await api('/skills')).data;
    const entry = importedCatalog.skills.find((s) => s.name === name);
    assert.ok(entry);
    const d = (await api(`/skills/${entry.id}`)).data;
    assert.equal(d.skill.current, undefined);
    assert.equal(d.skill.project, '');
    await p.locator(`[data-skill="${d.skill.id}"]`).click();
    await p.getByRole('heading', { name, exact: true }).waitFor();
    await p.getByText('本地候选目录', { exact: true }).click();
    const prepared = p.waitForResponse((r) => r.url().endsWith('/draft') && r.request().method() === 'POST');
    await p.getByRole('button', { name: '准备目录', exact: true }).click();
    const prep = await prepared;
    assert.equal(prep.status(), 201);
    const dir = (await prep.json()).directory;
    const text = await fs.readFile(join(dir, 'SKILL.md'), 'utf8');
    await fs.writeFile(join(dir, 'SKILL.md'), `${text}\nExternal edit retains exact provenance.\n`);
    const imported = p.waitForResponse((r) => r.url().endsWith('/import-draft') && r.request().method() === 'POST');
    await p.getByRole('button', { name: '导入目录修改', exact: true }).click();
    assert.equal((await imported).status(), 201);
    const after = (await api(`/skills/${d.skill.id}`)).data;
    assert.notEqual(after.skill.latest, d.skill.latest);
    assert.equal(after.skill.current, undefined);
    const file = (
      await api(
        `/skills/${d.skill.id}/files?${new URLSearchParams({ version: after.skill.latest, path: 'SKILL.md', snapshot: 'true' })}`,
      )
    ).data;
    assert.ok(file.content.includes('External edit retains exact provenance.'));
    await shot(p, 'global-import', 390);
    return {
      importStatus: 202,
      importOperation: op.id,
      scope: after.skill.project,
      current: null,
      initial: d.skill.latest,
      candidate: after.skill.latest,
    };
  },
);
await save('import-draft');
await c.close();
await b.close();
