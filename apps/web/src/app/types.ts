import type { useHost } from './use-host';
export type Host = ReturnType<typeof useHost>;
export type { Api, Detail, MemoryDetail, SkillDetail } from './data';
export { useRead, detailPath, resultPath } from './data';
export type { Route } from './navigation';
