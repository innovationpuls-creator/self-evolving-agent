import assert from 'node:assert/strict';
export function required<T>(value: T | undefined): T {
  assert.notEqual(value, undefined);
  return value as T;
}
