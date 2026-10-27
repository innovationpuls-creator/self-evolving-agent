import { createCodingTools, createReadOnlyTools, type AgentSession } from '@earendil-works/pi-coding-agent';
import { resolve } from 'node:path';
import type { SkillResourceLoader } from './skill-loader.js';
import type { SkillService } from './skills.js';

export interface ToolCatalogEntry {
  name: string;
  description: string;
  parameters: unknown;
  source: string;
  skillId?: string;
  skillName?: string;
  exposure: string;
  status: 'provided' | 'available' | 'disabled';
  sessions: string[];
  activeSessions: string[];
  callableSessions: string[];
}

export function toolCatalog(
  skills: SkillService,
  sessions: Iterable<{ record: { id: string; cwd: string }; session: AgentSession; loader: SkillResourceLoader }>,
  project?: string,
) {
  const loadout = skills.loadout();
  const entries = new Map<string, ToolCatalogEntry>();
  for (const tool of [
    ...createCodingTools(project ?? process.cwd()),
    ...createReadOnlyTools(project ?? process.cwd()),
  ]) {
    entries.set(`pi:${tool.name}`, {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      source: 'Pi 原生基础 Tool',
      exposure: 'native',
      status: 'provided',
      sessions: [],
      activeSessions: [],
      callableSessions: [],
    });
  }
  for (const item of sessions) {
    if (project && resolve(item.record.cwd) !== resolve(project)) continue;
    const callable = new Set(item.session.getCallableToolNames());
    const active = new Set(item.session.getActiveToolNames());
    for (const tool of item.session.getAllTools()) {
      const resource = item.loader
        .getResourceSources()
        .find((source) => source.extensionPaths.some((path) => resolve(path) === resolve(tool.sourceInfo.path)));
      const skill = loadout.records.find((record) => record.id === resource?.skillId);
      const native = tool.sourceInfo.path.startsWith('builtin:') && entries.has(`pi:${tool.name}`);
      const source = native ? 'Pi 原生基础 Tool' : skill ? tool.sourceInfo.path : tool.sourceInfo.source;
      const key = native ? `pi:${tool.name}` : `${source}:${tool.name}`;
      const prior = entries.get(key);
      entries.set(key, {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        source,
        skillId: skill?.id,
        skillName: skill?.name,
        exposure: tool.exposure,
        status: callable.has(tool.name) || prior?.status === 'available' ? 'available' : 'disabled',
        sessions: [...(prior?.sessions ?? []), item.record.id],
        activeSessions: [...(prior?.activeSessions ?? []), ...(active.has(tool.name) ? [item.record.id] : [])],
        callableSessions: [...(prior?.callableSessions ?? []), ...(callable.has(tool.name) ? [item.record.id] : [])],
      });
    }
  }
  return {
    tools: [...entries.values()],
    sources: loadout.records
      .filter((record) => !record.project || !project || record.project === project)
      .map((record) => {
        const version = skills.version(record.current ?? record.latest);
        return {
          skillId: record.id,
          name: record.name,
          extensions: version.extensions,
          status: !record.enabled ? 'disabled' : !record.current ? 'unloaded' : 'enabled',
          review: !version.extensions.length
            ? 'not_required'
            : version.review?.digest === version.digest
              ? 'approved'
              : version.evolution?.digest === version.digest
                ? 'evolution'
                : 'unreviewed',
          loaded: [...entries.values()].some((entry) => entry.skillId === record.id),
        };
      }),
  };
}
