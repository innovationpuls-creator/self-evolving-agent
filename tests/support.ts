import assert from 'node:assert/strict';

/** Fails the test when a value the scenario requires is missing; otherwise returns it narrowed. */
export function present<T>(value: T, message = 'expected value is missing'): NonNullable<T> {
  assert.ok(value !== undefined && value !== null, message);
  return value;
}
