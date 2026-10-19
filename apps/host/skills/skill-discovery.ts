import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  DefaultPackageManager,
  SettingsManager,
  loadSkills,
  type Skill,
  type ResourceDiagnostic,
} from '@earendil-works/pi-coding-agent';

export async function discoverSkillText(cwd: string) {
  // Trust here permits *path collection only*. No Extension loader or package
  // settings from disk are used. The executable Session stays projectTrusted:false.
  const agentDir = join(homedir(), '.pi', 'agent');
  const original = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
  // Preserve native skill path patterns, including exclusions. Discard packages,
  // executable paths and command settings before resolving any resource.
  const settings = SettingsManager.fromStorage(
    {
      withLock(scope, fn) {
        const values = scope === 'global' ? original.getGlobalSettings() : original.getProjectSettings();
        fn(JSON.stringify({ skills: values.skills ?? [], packages: [] }));
      },
    },
    { projectTrusted: true },
  );
  const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager: settings });
  const resources = await manager.resolve(async () => 'error');
  const skills: Skill[] = [],
    diagnostics: ResourceDiagnostic[] = [];
  for (const r of resources.skills.filter((r) => r.enabled)) {
    const result = loadSkills({ cwd, agentDir, skillPaths: [r.path], includeDefaults: false });
    for (const skill of result.skills) skills.push({ ...skill, sourceInfo: { path: skill.filePath, ...r.metadata } });
    diagnostics.push(...result.diagnostics);
  }
  return { skills, diagnostics };
}
