import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compareText, diffResult } from '../diff.mjs';

const summary = (a, b) => compareText(a, b).summary;
test('empty input, insertion, deletion and empty line', () => {
  assert.deepEqual(summary('', ''), { added: 0, deleted: 0, unchanged: 0 });
  assert.equal(compareText('', '').changed, false);
  assert.deepEqual(summary('', '中文'), { added: 1, deleted: 0, unchanged: 0 });
  assert.deepEqual(summary('中文', ''), { added: 0, deleted: 1, unchanged: 0 });
  assert.deepEqual(compareText('', '\n').lines, [{ type: 'added', text: '', old_line: null, new_line: 1 }]);
});
test('Chinese replacement with retained content and numbering', () => {
  assert.deepEqual(compareText('标题\n旧内容\n结尾', '标题\n新内容\n结尾').lines, [
    { type: 'unchanged', text: '标题', old_line: 1, new_line: 1 },
    { type: 'deleted', text: '旧内容', old_line: 2, new_line: null },
    { type: 'added', text: '新内容', old_line: null, new_line: 2 },
    { type: 'unchanged', text: '结尾', old_line: 3, new_line: 3 },
  ]);
});
test('repeat alignment is stable and deletion-first', () => {
  const r = compareText('甲\n乙\n甲', '甲\n甲\n乙');
  assert.deepEqual(r.lines.map(x => x.type), ['unchanged', 'deleted', 'unchanged', 'added']);
  assert.deepEqual(r, compareText('甲\n乙\n甲', '甲\n甲\n乙'));
});
test('newline policy and literal whitespace / Unicode', () => {
  assert.equal(compareText('甲\r\n乙\r\n', '甲\n乙\n').changed, false);
  const r = compareText('甲', '甲\n');
  assert.deepEqual(r.summary, { added: 0, deleted: 0, unchanged: 1 });
  assert.equal(r.changed, true); assert.equal(r.trailing_newline_changed, true);
  for (const [a, b] of [['甲 ', '甲'], ['a\rb', 'a\nb'], ['é', 'e\u0301'], ['A', 'a']]) {
    assert.equal(compareText(a, b).changed, true);
  }
  assert.equal(compareText('\n\n', '\n').summary.deleted, 1);
});
test('bounded inputs, output size, type validation, cancellation', () => {
  assert.throws(() => compareText(null, ''), /must be strings/);
  assert.throws(() => compareText('x'.repeat(12001), ''), /12000/);
  assert.throws(() => compareText('\n'.repeat(401), ''), /400/);
  assert.equal(compareText('x'.repeat(12000), '').summary.deleted, 1);
  assert.equal(compareText('\n'.repeat(400), '').summary.deleted, 400);
  assert.throws(() => diffResult('\u0000'.repeat(12000), ''), /45000/);
  assert.throws(() => compareText('', '', AbortSignal.abort()), /cancelled/);
});

function normalize(s) { return s.replace(/\r\n/g, '\n'); }
function reconstruct(r, side) {
  return r.lines.filter(x => x[side + '_line'] !== null).map(x => x.text).join('\n') + (r[side + '_trailing_newline'] ? '\n' : '');
}
function editCost(a, b) {
  // Independent prefix insert/delete distance oracle.
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = a[i - 1] === b[j - 1] ? diagonal : Math.min(row[j - 1], above) + 1;
      diagonal = above;
    }
  }
  return row[b.length];
}
test('1000 seeded cases: reconstruction, line numbers, counts and optimality', () => {
  let seed = 71;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  function text() {
    const tokens = ['甲', '乙', '', '甲', '😀', ' x ', '\r'];
    return Array.from({ length: random(9) }, () => tokens[random(tokens.length)]).join('\n') + (random(2) ? '\n' : '');
  }
  for (let k = 0; k < 1000; k++) {
    const a = text(), b = text(), r = compareText(a, b);
    assert.equal(reconstruct(r, 'old'), normalize(a));
    assert.equal(reconstruct(r, 'new'), normalize(b));
    for (const side of ['old', 'new']) {
      const records = r.lines.filter(x => x[side + '_line'] !== null);
      assert.deepEqual(records.map(x => x[side + '_line']), records.map((_, i) => i + 1));
    }
    const aa = r.lines.filter(x => x.old_line !== null).map(x => x.text);
    const bb = r.lines.filter(x => x.new_line !== null).map(x => x.text);
    assert.equal(r.summary.added + r.summary.deleted, editCost(aa, bb));
    assert.equal(r.lines.length, Object.values(r.summary).reduce((x, y) => x + y, 0));
    assert.deepEqual(r, compareText(a, b));
  }
});
test('serialized Tool result is complete and structured', () => {
  const r = diffResult('旧', '新');
  assert.deepEqual(JSON.parse(r.content[0].text), r.details);
  assert.deepEqual(r.structuredContent, r.details);
});
test('host native loader registers deferred Tool and actual execute works', { skip: !process.env.PI_SDK_ROOT }, async () => {
  const sdk = process.env.PI_SDK_ROOT;
  const { loadExtensions } = await import(pathToFileURL(sdk + '/dist/core/extensions/loader.js').href);
  const extensionPath = fileURLToPath(new URL('../extension.ts', import.meta.url));
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const loaded = await loadExtensions([extensionPath], cwd);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const entry = loaded.extensions[0].tools.get('text_diff');
  const tool = entry.definition;
  assert.equal(tool.exposure, 'deferred');
  assert.equal(tool.annotations.openWorldHint, false);
  for (const [old_text, new_text] of [['', ''], ['', '中文'], ['甲\n乙\n甲', '甲\n甲\n乙'], ['甲', '甲\n']]) {
    const r = await tool.execute('test', { old_text, new_text }, undefined);
    assert.deepEqual(JSON.parse(r.content[0].text), compareText(old_text, new_text));
  }
});
