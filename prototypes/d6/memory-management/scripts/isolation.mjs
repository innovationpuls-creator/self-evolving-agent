import { verifySourceBoundary } from '../../acceptance/scripts/isolation.mjs';
await verifySourceBoundary(import.meta.url);
