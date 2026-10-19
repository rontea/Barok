import { describe, expect, it, beforeEach } from '@jest/globals';
import {
  clearSlowOperations,
  getSlowOperations,
  jsonParse,
  jsonStringify,
  measureSlowOperation,
  recordSlowOperation,
} from '../slowOperations';

describe('slowOperations', () => {
  beforeEach(() => {
    clearSlowOperations();
  });

  it('wraps JSON stringify and parse', () => {
    const json = jsonStringify({ ok: true });
    const parsed = jsonParse<{ ok: boolean }>(json);

    expect(parsed.ok).toBe(true);
  });

  it('records operations above the threshold helper', () => {
    recordSlowOperation('test operation', Number.MAX_SAFE_INTEGER);

    expect(getSlowOperations()).toEqual([
      expect.objectContaining({ operation: 'test operation' }),
    ]);
  });

  it('returns measured function results', () => {
    const result = measureSlowOperation('cheap operation', () => 42);

    expect(result).toBe(42);
  });
});
