import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import type { FauxProviderHandle } from '@earendil-works/pi-ai/providers/faux';
import type { AgentService } from '../../../../apps/host/runtime/agent';

export interface Manifest {
  mode: string;
  sourceProject: string;
  otherProject: string;
  sourceSession: string;
  secondSession: string;
  foreignSession: string;
  skillId: string;
  skillFile: string;
  extensionFile: string;
  knowledgeFile: string;
  initialVersion: string;
  skillIds: string[];
  suggestionIds: string[];
  agentSuggestionId: string;
  userSuggestionId: string;
}

export const wait = async (check: () => boolean | Promise<boolean>) => {
  const deadline = Date.now() + 40000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Capability seed timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

export async function seed(service: AgentService, fake: FauxProviderHandle, root: string) {
  const saved = join(root, 'manifest.json');
  try {
    const manifest = JSON.parse(await readFile(saved, 'utf8')) as Manifest;
    // Restore only actual encrypted Sessions, so Tool metadata is based on real runtime instances.
    for (const id of [manifest.sourceSession, manifest.secondSession, manifest.foreignSession])
      await service.viewSession(id);
    return manifest;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const sourceProject = join(root, 'projects', 'alpha'),
    otherProject = join(root, 'projects', 'beta');
  await mkdir(sourceProject, { recursive: true });
  await mkdir(otherProject, { recursive: true });
  const source = join(root, 'packages', 'd6-safe-echo');
  await mkdir(join(source, 'reference'), { recursive: true });
  await writeFile(
    join(source, 'SKILL.md'),
    '---\nname: d6-safe-echo\ndescription: Return a supplied text value for isolated capability verification.\n---\n# Text echo\n\nFind `capability_echo` through tool_search, then return the supplied text without interpreting it.\n\nRead notes.md for descriptive knowledge.\n',
  );
  await writeFile(
    join(source, 'notes.md'),
    '# Practice notes\n\nKeep caller text unchanged. This is descriptive knowledge, not executable policy.\n',
  );
  await writeFile(
    join(source, 'package.json'),
    JSON.stringify({
      name: 'd6-safe-echo',
      version: '1.0.0',
      private: true,
      pi: { skills: ['SKILL.md'], extensions: ['tool.js'] },
    }),
  );
  await writeFile(
    join(source, 'package-lock.json'),
    JSON.stringify({
      name: 'd6-safe-echo',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: { '': { name: 'd6-safe-echo', version: '1.0.0' } },
    }),
  );
  await writeFile(
    join(source, 'tool.js'),
    `import {Type} from 'typebox';
export default function(pi) {
  pi.registerTool({name:'capability_echo',label:'Echo text',description:'Isolated text echo: return the supplied text unchanged.',exposure:'deferred',parameters:Type.Object({text:Type.String()}),async execute(_id,args){return {content:[{type:'text',text:args.text}],details:{text:args.text}};}});
}
`,
  );
  await writeFile(
    join(
      source,
      'reference',
      'evidence-and-version-comparison-for-long-running-personal-agent-maintenance-with-explicit-uncertainty.md',
    ),
    '# Source reference\n\n' +
      'A long descriptive reference. Preserve exact provenance; do not infer successful operations from text.\n\n'.repeat(
        70,
      ),
  );
  const echo = (
    await service.skills.import({
      source,
      project: sourceProject,
      bindings: [{ skill: 'SKILL.md', extensions: ['tool.js'], knowledgeFiles: ['notes.md'] }],
    })
  )[0];
  if (!echo) throw new Error('Echo import did not create a Skill');
  const version = service.skills.version(echo.latest);
  await service.skills.review(
    echo.id,
    version.id,
    version.digest,
    'Controlled mechanism fixture reviewed in full: pure text echo, hosted TypeBox alias only, no network, file, process or dependency side effects.',
  );
  const operation = service.skills.publish(echo.id, version.id, echo.revision);
  await wait(() => !['checking', 'waiting'].includes(service.skills.operation(operation.id).status));
  if (service.skills.operation(operation.id).status !== 'applied')
    throw new Error(service.skills.operation(operation.id).message);
  const skillIds = [echo.id];
  for (let index = 1; index <= 32; index++) {
    const name = `reference-${String(index).padStart(2, '0')}`,
      directory = join(root, 'packages', name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'SKILL.md'),
      `---\nname: ${name}\ndescription: Preserve source references for maintenance task ${index}; this Skill is a reading guide.\n---\n# Reference ${index}\n\nRead the supplied material and retain missing-source limitations.\n`,
    );
    const record = (
      await service.skills.import({ source: directory, ...(index % 9 === 0 ? {} : { project: sourceProject }) })
    )[0];
    if (record) skillIds.push(record.id);
  }
  const foreignSource = join(root, 'packages', 'beta-only');
  await mkdir(foreignSource, { recursive: true });
  await writeFile(
    join(foreignSource, 'SKILL.md'),
    '---\nname: beta-only\ndescription: Reading guide belonging to the isolated beta project.\n---\nKeep project contexts distinct.\n',
  );
  const foreign = (await service.skills.import({ source: foreignSource, project: otherProject }))[0];
  if (foreign) skillIds.push(foreign.id);
  const sourceSession = (await service.create(sourceProject, fake.provider.id, 'capability-controlled')).id;
  const secondSession = (await service.create(sourceProject, fake.provider.id, 'capability-controlled')).id;
  const foreignSession = (await service.create(otherProject, fake.provider.id, 'capability-controlled')).id;
  fake.setResponses([
    fauxAssistantMessage(fauxToolCall('tool_search', { query: 'capability_echo', limit: 5 }), {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage(
      fauxToolCall('capability_echo', { text: 'Evidence retained for the isolated capability check.' }),
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('已从当前项目发现并调用文本回声工具；这段记录用于受控机制验证。'),
  ]);
  await service.prompt(sourceSession, '核对当前项目的文本回声能力，保留实际工具返回。');
  await wait(async () => !(await service.viewSession(sourceSession)).busy);
  const idea = {
    title: '保留能力变更的精确来源',
    goal: '让能力维护时能够追溯实际版本与原始依据',
    reason: '版本操作后需要区分当前内容、历史修订与执行记录。',
    value: '减少在多份相似材料中重复核对的成本。',
    uncertainty: '仍需讨论使用频率，以及是否已有足够的现成功能。',
    action: '先讨论任务和证据，再决定是否需要授权开发。',
    evidence: [],
    priority: 'normal' as const,
  };
  fake.setResponses([
    fauxAssistantMessage(fauxToolCall('suggestion_submit', idea), { stopReason: 'toolUse' }),
    fauxAssistantMessage('建议已按来源保存。这是受控模型的正式工具操作，不代表真实模型自主发现。'),
  ]);
  await service.prompt(sourceSession, '记录关于能力维护来源追溯的讨论建议。');
  await wait(async () => !(await service.viewSession(sourceSession)).busy);
  const agentSuggestion = service.evolution.list({ actor: 'user' }, { sessionId: sourceSession }).items[0];
  if (!agentSuggestion) throw new Error('Native suggestion_submit did not persist provenance');
  const suggestionIds = [agentSuggestion.id];
  let userSuggestionId = '';
  for (let index = 1; index <= 26; index++) {
    const suggestion = service.evolution.create(
      { actor: 'user' },
      {
        ...idea,
        title: `${index === 26 ? '长期维护中的能力边界与来源组织' : '维护建议'} · ${String(index).padStart(2, '0')}`,
        reason: index === 25 ? idea.reason.repeat(40) : idea.reason,
      },
    );
    suggestionIds.push(suggestion.id);
    if (index === 26) userSuggestionId = suggestion.id;
  }
  const manifest: Manifest = {
    mode: 'controlled native Pi provider, formal Host routes/services and encrypted persistence; no autonomous real-model claim',
    sourceProject,
    otherProject,
    sourceSession,
    secondSession,
    foreignSession,
    skillId: echo.id,
    skillFile: 'SKILL.md',
    extensionFile: 'tool.js',
    knowledgeFile: 'notes.md',
    initialVersion: version.id,
    skillIds,
    suggestionIds,
    agentSuggestionId: agentSuggestion.id,
    userSuggestionId,
  };
  await writeFile(saved, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  return manifest;
}
