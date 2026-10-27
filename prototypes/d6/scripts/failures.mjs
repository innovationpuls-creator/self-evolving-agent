import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
// Failure, empty, loading, long content, offline and focus states.
await import('./states.mjs');
