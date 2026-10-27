import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { AgentService } from '../../../../apps/host/runtime/agent';

test('Reflection Worker evidence authorizer rejects foreign project and missing Entry; authenticated user semantics remain distinct', async () => {
  const base = fileURLToPath(new URL('..', import.meta.url));
  await mkdir(join(base, '.runtime'), { recursive: true });
  const root = await mkdtemp(join(base, '.runtime/scope-'));
  await mkdir(root, { recursive: true });
  const alpha = join(root, 'alpha'),
    beta = join(root, 'beta');
  await mkdir(alpha);
  await mkdir(beta);
  const host = new AgentService(join(root, 'data'), randomBytes(32), {
    reflectionExecutor: {
      async available() {
        return { available: false };
      },
      async execute() {
        throw Error('not executed');
      },
    },
  });
  try {
    await host.init();
    const fake = fauxProvider({ models: [{ id: 'scope' }] });
    host.runtime.registerNativeProvider(fake.provider);
    const session = await host.create(beta, fake.provider.id, 'scope');
    await assert.rejects(host.reflection.authorizeEvidence(alpha, [{ sessionId: session.id }]), {
      status: 404,
      code: 'REFLECTION_EVIDENCE',
    });
    await assert.rejects(host.reflection.authorizeEvidence(beta, [{ sessionId: session.id, entryId: 'missing' }]), {
      status: 404,
    });
    await host.reflection.authorizeEvidence(alpha, [{ sessionId: session.id }], 'user');
    await writeFile(
      join(base, 'evidence/worker-scope.json'),
      JSON.stringify(
        {
          mode: 'controlled actual formal Host authorizer',
          foreignAgentEvidence: 404,
          missingEntry: 404,
          authenticatedUserMayRead: true,
          roleModelAdded: false,
          passed: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await host.close();
  }
});
