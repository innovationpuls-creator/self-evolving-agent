import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { SkillVersion } from './skills.js';

export interface IsolatedExecutionContract {
  kind: 'd4-vm-v1';
  permissionProfile: 'd4-data-only-v1';
  runtimeDigest: string;
}
export interface IsolatedSkillRuntime {
  name: string;
  factory: ExtensionFactory;
  revoke(): Promise<void>;
  close(): Promise<void>;
}
export const isolatedFactoryName = (version: string) => `d4-vm:${version}`;
export const isolatedSourcePath = (version: string) => `<inline:${isolatedFactoryName(version)}>`;
/** Application-owned adapter; never provided by a Skill package or HTTP input. */
export interface IsolatedSkillAdapter {
  supports(contract: IsolatedExecutionContract): boolean;
  open(version: SkillVersion, packagePath: string): Promise<IsolatedSkillRuntime>;
}
