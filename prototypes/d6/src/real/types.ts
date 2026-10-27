import type { useHost } from '../../../../apps/web/src/app/use-host';
export type Host = ReturnType<typeof useHost>;
export type { Api, Detail, MemoryDetail, SkillDetail } from '../../host/src/data';
export { useRead, detailPath, resultPath } from '../../host/src/data';
export type { Route } from './navigation';
