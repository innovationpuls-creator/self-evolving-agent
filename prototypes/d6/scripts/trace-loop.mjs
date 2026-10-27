import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
// Current trace acceptance; the previous narrative prototype is archived with its evidence.
await import('./trace-ledger.mjs');
