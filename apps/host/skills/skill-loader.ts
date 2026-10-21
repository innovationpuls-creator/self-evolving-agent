import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { discoverSkillText } from './skill-discovery.js';
import {
  DefaultResourceLoader,
  loadSkills,
  createToolSearchExtension,
  type ResourceLoader,
  type SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { SkillService, type SkillLoadout, type SkillResourceSource, SkillError } from './skills.js';

// Only the native loader's approved, materialized local paths may import code.
export class SkillResourceLoader implements ResourceLoader {
  private base!: DefaultResourceLoader;
  private selected?: SkillLoadout;
  private skillPaths: string[] = [];
  private sources: readonly SkillResourceSource[] = [];
  constructor(
    private service: SkillService,
    private cwd: string,
    private agentDir: string,
    private settings: SettingsManager,
    private discussion = false,
  ) {}
  setLoadout(loadout?: SkillLoadout) {
    this.selected = loadout;
  }
  getResourceSources(): readonly SkillResourceSource[] {
    return this.sources;
  }
  async reload() {
    const loadout = this.selected ?? this.service.loadout();
    const paths = await this.service.resourcePaths(this.cwd, loadout);
    const native = await discoverSkillText(this.cwd);
    const base = new DefaultResourceLoader({
      cwd: this.cwd,
      agentDir: this.agentDir,
      settingsManager: this.settings,
      noExtensions: true,
      noSkills: true,
      additionalExtensionPaths: this.discussion ? [] : paths.extensionPaths,
      additionalSkillPaths: paths.skillPaths,
      extensionFactories: [createToolSearchExtension()],
      skillsOverride: (base) => {
        const text = this.service.filterNative(native.skills, this.cwd, loadout);
        const combined = loadSkills({
          cwd: this.cwd,
          agentDir: this.agentDir,
          skillPaths: [
            ...this.skillPaths,
            ...text.map((s) => s.filePath),
            ...(existsSync(join(this.agentDir, 'evolution', 'SKILL.md'))
              ? [join(this.agentDir, 'evolution', 'SKILL.md')]
              : []),
          ],
          includeDefaults: false,
        });
        return {
          skills: combined.skills.map((s) => ({
            ...s,
            sourceInfo: text.find((t) => t.filePath === s.filePath)?.sourceInfo ?? s.sourceInfo,
          })),
          diagnostics: [...base.diagnostics, ...native.diagnostics, ...combined.diagnostics],
        };
      },
    });
    const previousPaths = this.skillPaths;
    this.skillPaths = paths.skillPaths;
    try {
      await base.reload();
      if (base.getExtensions().errors.length) throw new SkillError('Extension 加载失败，正式版本未改变');
      this.base = base;
      this.sources = paths.sources;
    } catch (error) {
      this.skillPaths = previousPaths;
      throw error;
    }
  }
  async refreshSkills() {
    const paths = await this.service.resourcePaths(this.cwd, this.selected);
    const previousPaths = this.skillPaths;
    this.skillPaths = paths.skillPaths;
    try {
      this.base.extendResources({
        skillPaths: paths.skillPaths.map((path) => ({
          path,
          metadata: { source: 'local', scope: 'user', origin: 'top-level' },
        })),
      });
      this.sources = paths.sources;
    } catch (error) {
      this.skillPaths = previousPaths;
      throw error;
    }
  }
  getExtensions: ResourceLoader['getExtensions'] = () => this.base.getExtensions();
  getSkills: ResourceLoader['getSkills'] = () => this.base.getSkills();
  getPrompts: ResourceLoader['getPrompts'] = () => this.base.getPrompts();
  getThemes: ResourceLoader['getThemes'] = () => this.base.getThemes();
  getAgentsFiles: ResourceLoader['getAgentsFiles'] = () => this.base.getAgentsFiles();
  getSystemPrompt: ResourceLoader['getSystemPrompt'] = () => this.base.getSystemPrompt();
  getSystemPromptSource: ResourceLoader['getSystemPromptSource'] = () => this.base.getSystemPromptSource();
  getAppendSystemPrompt: ResourceLoader['getAppendSystemPrompt'] = () => this.base.getAppendSystemPrompt();
  getAppendSystemPromptSources: ResourceLoader['getAppendSystemPromptSources'] = () =>
    this.base.getAppendSystemPromptSources();
  extendResources: ResourceLoader['extendResources'] = (paths) => this.base.extendResources(paths);
}
