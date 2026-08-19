/**
 * Implements the public Storage.compareAndSet equality contract.
 *
 * Storage values are JSON data, so adapters compare the exact serialized value
 * rather than object identity. Keep this centralized so every platform uses the
 * same semantics.
 */
export const storageValuesEqual = (currentValue: unknown, expectedValue: unknown): boolean =>
  JSON.stringify(currentValue) === JSON.stringify(expectedValue)
