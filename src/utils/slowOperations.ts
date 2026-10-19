import { performance } from 'perf_hooks';

export interface SlowOperationRecord {
  operation: string;
  durationMs: number;
  timestamp: number;
}

const MAX_RECORDS = 100;

const thresholdFromEnv = Number(process.env.REACT_ENGINE_SLOW_OPERATION_THRESHOLD_MS);
export const SLOW_OPERATION_THRESHOLD_MS =
  Number.isFinite(thresholdFromEnv) && thresholdFromEnv >= 0
    ? thresholdFromEnv
    : process.env.NODE_ENV === 'test'
      ? 0
    : process.env.NODE_ENV === 'development'
      ? 50
      : Infinity;

const records: SlowOperationRecord[] = [];

function describeValue(value: unknown): string {
  if (Array.isArray(value)) return `Array[${value.length}]`;
  if (value && typeof value === 'object') return `Object{${Object.keys(value).length} keys}`;
  if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 80)}...` : value;
  return String(value);
}

export function recordSlowOperation(operation: string, durationMs: number): void {
  if (durationMs <= SLOW_OPERATION_THRESHOLD_MS) return;

  records.push({
    operation,
    durationMs,
    timestamp: Date.now(),
  });

  if (records.length > MAX_RECORDS) {
    records.splice(0, records.length - MAX_RECORDS);
  }

  if (process.env.REACT_ENGINE_DEBUG_PERF === '1') {
    console.warn(`[slow-operation] ${operation} took ${durationMs.toFixed(1)}ms`);
  }
}

export function getSlowOperations(): SlowOperationRecord[] {
  return [...records];
}

export function clearSlowOperations(): void {
  records.length = 0;
}

export function measureSlowOperation<T>(operation: string, fn: () => T): T {
  const startedAt = performance.now();
  try {
    return fn();
  } finally {
    recordSlowOperation(operation, performance.now() - startedAt);
  }
}

export async function measureSlowOperationAsync<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    recordSlowOperation(operation, performance.now() - startedAt);
  }
}

export function jsonStringify(
  value: unknown,
  replacer?: Parameters<typeof JSON.stringify>[1],
  space?: string | number
): string {
  return measureSlowOperation(`JSON.stringify(${describeValue(value)})`, () =>
    JSON.stringify(value, replacer, space)
  );
}

export function jsonParse<T = unknown>(
  text: string,
  reviver?: Parameters<typeof JSON.parse>[1]
): T {
  return measureSlowOperation(`JSON.parse(${describeValue(text)})`, () =>
    typeof reviver === 'undefined' ? JSON.parse(text) : JSON.parse(text, reviver)
  ) as T;
}

export function clone<T>(value: T): T {
  return measureSlowOperation(`structuredClone(${describeValue(value)})`, () =>
    structuredClone(value)
  );
}
