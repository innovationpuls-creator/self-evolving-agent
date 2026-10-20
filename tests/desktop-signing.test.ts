import assert from 'node:assert/strict';
import test from 'node:test';
import { signingConfiguration } from '../scripts/sign-desktop.js';

test('development signing stays explicit and does not pretend ad-hoc is a stable identity', () => {
  assert.deepEqual(signingConfiguration({}), {
    identity: '-',
    mode: 'development',
    keychain: undefined,
    timestamp: 'none',
  });
  assert.equal(signingConfiguration({ AGENT_CODESIGN_IDENTITY: 'Local Code Signing' }).timestamp, 'none');
  assert.equal(
    signingConfiguration({ AGENT_CODESIGN_IDENTITY: 'Developer ID Application: Example' }).mode,
    'distribution',
  );
  assert.throws(() => signingConfiguration({ AGENT_CODESIGN_MODE: 'distribution' }));
  assert.throws(() => signingConfiguration({ AGENT_CODESIGN_MODE: 'invalid' }));
});
