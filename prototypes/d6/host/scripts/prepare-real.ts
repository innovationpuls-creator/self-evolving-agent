import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { request, root, settled, reflected, saveTranscript } from './client';
import type { Session } from '../../../../apps/web/src/features/chat/session-state';
const receipt: Record<string, unknown> = {
  time: new Date().toISOString(),
  mode: 'real Host / real provider / signed native Reflection',
  initialMemory: 'controlled user-created stale project knowledge',
  passed: false,
};
try {
  let existing: { source: string; memory: string; project: string } | undefined;
  try {
    existing = JSON.parse(await readFile(join(root, '.runtime/scenario.json'), 'utf8'));
  } catch (reason) {
    if (!(reason instanceof Error && 'code' in reason && reason.code === 'ENOENT')) throw reason;
  }
  if (existing && !process.argv.includes('--new')) {
    const source = await request<Session>(`/sessions/${existing.source}`);
    const catalog = await request<
      import('../../../../apps/web/src/features/reflection/reflection-state').ReflectionCatalog
    >(`/reflections?view=summary&sessionId=${existing.source}`);
    const memory = await request<import('../src/data').MemoryDetail>(
      `/memory/${existing.memory}?${new URLSearchParams({ project: existing.project, includeHistory: 'true' })}`,
    );
    receipt.reused = true;
    receipt.source = existing.source;
    receipt.catalog = catalog;
    receipt.savedOperations = source.messages
      ?.filter((message) => message.details?.memory)
      .map((message) => message.details?.memory);
    receipt.actualMemory = memory;
    receipt.passed =
      !!source.messages?.some((message) => message.details?.memory?.revision === 2) &&
      catalog.jobs.some((job) => job.status === 'succeeded') &&
      memory.history.length >= 2;
  } else {
    await request('/credentials', 'POST', { provider: 'openai-codex', importExisting: true });
    const models = await request<{ models: Array<{ provider: string; id: string }> }>('/models');
    const model = models.models.find(
      (m: { provider: string; id: string }) => m.provider === 'openai-codex' && m.id === 'gpt-6-luna',
    );
    if (!model)
      throw new Error('Existing configured gpt-6-luna unavailable; no replacement credentials or mock model used');
    const project = join(root, '.runtime/projects/retry-policy');
    const otherProject = join(root, '.runtime/projects/other-project');
    await mkdir(project, { recursive: true });
    await mkdir(otherProject, { recursive: true });
    await writeFile(
      join(project, 'POLICY.md'),
      '# 当前重试策略\n\n经本项目确认，重试上限是 3 次。旧文档中的 7 次已失效。\n',
    );
    const memory = await request<import('../../../../apps/host/memory/memory').MemoryView>(
      `/memory?${new URLSearchParams({ project })}`,
      'POST',
      {
        knowledge: { title: '请求重试上限', content: '项目请求的重试上限是 7 次。', kind: 'fact', scope: 'project' },
        reason: '专用体验验证项目的初始旧记忆；随后以项目文件核对。',
      },
    );
    const source = await request<Session>('/sessions', 'POST', {
      cwd: project,
      provider: model.provider,
      model: model.id,
    });
    const empty = await request<Session>('/sessions', 'POST', {
      cwd: otherProject,
      provider: model.provider,
      model: model.id,
    });
    const sibling = await request<Session>('/sessions', 'POST', {
      cwd: project,
      provider: model.provider,
      model: model.id,
    });
    await writeFile(
      join(root, '.runtime/scenario.json'),
      JSON.stringify({
        source: source.id,
        empty: empty.id,
        sibling: sibling.id,
        project,
        otherProject,
        memory: memory.id,
      }),
    );
    receipt.sessions = { source: source.id, empty: empty.id, sibling: sibling.id };
    await request(`/sessions/${source.id}/prompt`, 'POST', {
      text: '请读取 POLICY.md，对照已有的项目记忆说明当前重试策略和证据不一致的地方。本次只核对事实，无需开发技能或更改项目文件。',
    });
    const final = await settled(source.id);
    receipt.sessionError = final.error;
    if (final.error) throw new Error(`Real task failed: ${final.error}`);
    receipt.initialReflection = await reflected(source.id);
    await request(`/sessions/${source.id}/prompt`, 'POST', {
      text: `请把项目记忆 ${memory.id} 更新为 POLICY.md 已确认的重试上限，并说明这次实际保存的变化。`,
    });
    const changedSession = await settled(source.id);
    if (changedSession.error) throw new Error(changedSession.error);
    receipt.sourceSavedOperations = changedSession.messages
      ?.filter((message) => message.details?.memory)
      .map((message) => message.details?.memory);
    const reflection = await reflected(source.id);
    receipt.reflection = reflection;
    const actual = await request<import('../src/data').MemoryDetail>(
      `/memory/${memory.id}?${new URLSearchParams({ project, includeHistory: 'true' })}`,
    );
    receipt.actualMemory = actual;
    receipt.passed = reflection.detail.job.status === 'succeeded' && actual.current.revision > 1;
    receipt.reflectionSavedChanges = reflection.detail.record?.changes;
    if (!receipt.passed)
      throw new Error(
        'Real source task did not produce a saved memory revision; result retained without synthesizing success',
      );
  }
} catch (reason) {
  receipt.error = reason instanceof Error ? reason.message : String(reason);
  process.exitCode = 1;
} finally {
  await saveTranscript('real-host-requests');
  await writeFile(
    join(root, 'evidence/real-preparation.json'),
    JSON.stringify(receipt, null, 2).replaceAll(root, '<D6_HOST>'),
  );
  console.log(JSON.stringify({ passed: receipt.passed, error: receipt.error, sessions: receipt.sessions }));
}
