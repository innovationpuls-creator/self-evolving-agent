import { discoverSkillText } from './skill-discovery.js';
import type { IsolatedSkillRuntime } from './isolated-execution.js';
import {
  DefaultResourceLoader,
  loadSkills,
  createToolSearchExtension,
  createCodemodeExtension,
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
  private isolated: IsolatedSkillRuntime[] = [];
  async revoke() {
    await Promise.all(this.isolated.map((runtime) => runtime.revoke()));
  }
  async close() {
    const current = this.isolated;
    await Promise.all(current.map((runtime) => runtime.close()));
    this.isolated = [];
  }
  constructor(
    private service: SkillService,
    private cwd: string,
    private agentDir: string,
    private settings: SettingsManager,
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
    const isolated: IsolatedSkillRuntime[] = [];
    try {
      for (const version of paths.isolatedVersions) isolated.push(await this.service.isolatedRuntime(version));
    } catch (error) {
      await Promise.allSettled(isolated.map((runtime) => runtime.close()));
      throw error;
    }
    const base = new DefaultResourceLoader({
      cwd: this.cwd,
      agentDir: this.agentDir,
      settingsManager: this.settings,
      noExtensions: true,
      noSkills: true,
      additionalExtensionPaths: paths.extensionPaths,
      additionalSkillPaths: paths.skillPaths,
      extensionFactories: [
        createToolSearchExtension(),
        ...(isolated.length ? [createCodemodeExtension({ mode: 'on' })] : []),
        ...isolated.map((runtime) => ({ name: runtime.name, factory: runtime.factory })),
      ],
      skillsOverride: (base) => {
        const text = this.service.filterNative(native.skills, this.cwd, loadout);
        const combined = loadSkills({
          cwd: this.cwd,
          agentDir: this.agentDir,
          skillPaths: [...this.skillPaths, ...text.map((s) => s.filePath)],
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
      await this.close();
      this.isolated = isolated;
      this.base = base;
      this.sources = paths.sources;
    } catch (error) {
      await Promise.allSettled(isolated.map((runtime) => runtime.close()));
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
