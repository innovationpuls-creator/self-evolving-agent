import type { SkillOperation, SkillVersion } from '../../../../host/skills/skills';
export type SkillDraft = {
  id: string;
  path: string;
  baseRevision: number;
  version: string;
  before: string;
  content: string | null;
};
// Page-memory drafts survive navigation; never silently move an edit onto a newer base.
export class SkillDrafts {
  readonly knowledge = new Map<string, { file: string; text: string; baseRevision: number }>();
  readonly files = new Map<string, SkillDraft>();
  readonly operations = new Map<string, { id: string; version?: string; enabled?: boolean }>();
  get(id: string, path: string) {
    return this.files.get(`${id}:${path}`);
  }
  set(value: SkillDraft) {
    this.files.set(`${value.id}:${value.path}`, value);
  }
  all(id?: string) {
    return [...this.files.values()].filter((d) => !id || d.id === id);
  }
  clear(id: string) {
    for (const [key, d] of this.files) if (d.id === id) this.files.delete(key);
  }
}
export function reviewed(version: SkillVersion) {
  return (
    !version.extensions.length ||
    version.review?.digest === version.digest ||
    version.evolution?.digest === version.digest
  );
}
export function operationApplied(
  operation: SkillOperation,
  record: { current?: string; enabled: boolean },
  target: { version?: string; enabled?: boolean },
) {
  return (
    operation.status === 'applied' &&
    (!target.version || target.version === record.current) &&
    (target.enabled === undefined || target.enabled === record.enabled)
  );
}
