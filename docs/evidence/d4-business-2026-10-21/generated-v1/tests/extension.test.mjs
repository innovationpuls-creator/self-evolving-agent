import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

test('native Pi loader registers deferred tool; real execute matches output schema', { skip: !process.env.PI_SDK_ROOT }, async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const sdk = process.env.PI_SDK_ROOT;
  const require = createRequire(resolve(sdk, 'package.json'));
  const { Check } = await import(pathToFileURL(require.resolve('typebox/value')));
  const { loadExtensions } = await import(pathToFileURL(resolve(sdk, 'dist/core/extensions/loader.js')));
  const loaded = await loadExtensions([resolve(root, 'extension.ts')], root);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const tools = loaded.extensions[0].tools;
  assert.equal(tools.size, 1);
  const tool = tools.get('text_diff').definition;
  assert.equal(tool.exposure, 'deferred');
  assert.equal(tool.annotations.openWorldHint, false);
  for (const args of [
    { old_text: '', new_text: '' },
    { old_text: '', new_text: '中文\n中文' },
    { old_text: '甲\n乙\n甲', new_text: '甲\n甲\n乙' },
    { old_text: '标题\n旧内容\n结尾', new_text: '标题\n新内容\n结尾' },
  ]) {
    const result = await tool.execute('local-probe', args, undefined, undefined, {});
    const textResult = JSON.parse(result.content[0].text);
    assert.deepEqual(textResult, result.details);
    assert.deepEqual(textResult, result.structuredContent);
    assert.equal(Check(tool.parameters, args), true);
    assert.equal(Check(tool.outputSchema, result.structuredContent), true);
    console.log('actual text_diff probe:', JSON.stringify(args), result.content[0].text);
  }
  await assert.rejects(() => tool.execute('bad', { old_text: 'x'.repeat(100001), new_text: '' }, undefined, undefined, {}), /100000/);
});
