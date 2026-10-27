export const repository: string;
export const runs: string;
export function requireIsolation(url: string): void;
export function verifySourceBoundary(url: string): Promise<void>;
export function inventory(root?: string): Promise<Record<string, { bytes?: number; sha256?: string; link?: string }>>;
export function difference(before: Record<string, unknown>, after: Record<string, unknown>): unknown[];
export function prepare(label?: string): Promise<{ directory: string; workspace: string; before: Awaited<ReturnType<typeof inventory>> }>;
