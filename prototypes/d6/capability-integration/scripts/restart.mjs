import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { api, check, save } from './common.mjs';
const root = new URL('../.runtime/', import.meta.url),
  before = JSON.parse(await fs.readFile(new URL('restart-before.json', root), 'utf8')),
  m = JSON.parse(await fs.readFile(new URL('manifest.json', root), 'utf8'));
await check(
  'actual isolated Host restart retains published relationship and does not requeue old controlled Tool sequence',
  1440,
  async () => {
    const a = (await api(`/activities/${before.chain.activity}`)).data,
      s = (await api(`/skills/${before.chain.release.skillId}`)).data;
    assert.equal(a.status, 'completed');
    assert.deepEqual(a.releases, before.activity.releases);
    assert.equal(s.skill.current, before.skill.skill.current);
    const operation = (await api(`/skills/operations/${before.chain.release.operationId}`)).data;
    assert.equal(operation.status, 'applied');
    const session = (
      await api('/sessions', 'POST', { cwd: m.sourceProject, provider: 'faux', model: 'capability-controlled' })
    ).data;
    assert.equal(
      (
        await api(`/sessions/${session.id}/prompt`, 'POST', {
          text: '重启后的隔离读取检查。只回复讨论，不调用工具、不写文件。',
        })
      ).status,
      202,
    );
    let result;
    for (let i = 0; i < 100; i++) {
      result = (await api(`/sessions/${session.id}`)).data;
      if (!result.busy) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(result.busy, false);
    assert.ok(result.messages.some((m) => m.role === 'assistant'));
    assert.equal(
      result.messages.some((m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'toolCall')),
      false,
    );
    assert.deepEqual((await api(`/activities/${a.id}`)).data.releases, a.releases);
    return {
      activity: a.id,
      status: a.status,
      release: before.chain.release,
      operation: operation.status,
      current: s.skill.current,
      newSession: session.id,
      toolCalls: 0,
      mode: 'actual formal Host process restarted; controlled default provider, not autonomous model',
    };
  },
);
await save('restart');
