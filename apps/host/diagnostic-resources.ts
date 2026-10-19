import { resolve } from 'node:path';
import type { SkillResourceSource } from './skills.js';
import type { DiagnosticResources } from './diagnostics.js';

/** Match prepared identities against resources Pi actually loaded. */
export function diagnosticResources(
  sources: readonly SkillResourceSource[],
  skills: readonly { filePath: string }[],
  nativeTools: readonly { name: string; sourceInfo: { path: string } }[],
): DiagnosticResources {
  const loaded: DiagnosticResources['loaded'] = [];
  const tools: DiagnosticResources['tools'] = new Map();
  for (const source of sources) {
    const { skillId, version, digest, knowledgeRevision } = source;
    const ref = { skillId, version, digest, ...(knowledgeRevision ? { knowledgeRevision } : {}) };
    if (skills.some((skill) => resolve(skill.filePath) === resolve(source.skillPath))) {
      for (const path of [source.skillPath, ...source.knowledgePaths]) loaded.push({ ...ref, path: resolve(path) });
    }
    const paths = new Set(source.extensionPaths.map((path) => resolve(path)));
    for (const tool of nativeTools) if (paths.has(resolve(tool.sourceInfo.path))) tools.set(tool.name, ref);
  }
  for (const skill of skills)
    if (!loaded.some((ref) => ref.path === resolve(skill.filePath))) loaded.push({ path: resolve(skill.filePath) });
  return { loaded, tools };
}
