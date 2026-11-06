import type { EvolutionEvidence } from '../../../host/evolution/evolution';
import type { ResultTarget } from './data';
export type Route =
  | { page: 'session'; sessionId?: string; entryId?: string }
  | { page: 'reflections'; sessionId?: string; offset: number }
  | { page: 'reflection'; jobId: string; recordId?: string; originSession?: string }
  | { page: 'source'; reference: EvolutionEvidence; project: string; originSession?: string }
  | { page: 'result'; target: ResultTarget; originSession?: string };
