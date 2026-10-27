import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
// Current full browser acceptance entry point. First-round scripts are archived in round1/.
await import('./review.mjs');
await import('./states.mjs');
await import('./details.mjs');
await import('./contracts.mjs');
await import('./diff.mjs');
