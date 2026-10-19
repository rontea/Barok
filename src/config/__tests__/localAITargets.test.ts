import { describe, expect, it } from '@jest/globals';
import {
  getLocalAITargetValue,
  isLocalAITargetValue,
  normalizeLocalAIBaseUrl,
  normalizeLocalAIEndpoints,
} from '../localAITargets.js';

describe('local AI endpoint configuration', () => {
  it('normalizes a root localhost URL to the OpenAI-compatible v1 base', () => {
    expect(normalizeLocalAIBaseUrl('http://localhost:8080')).toBe('http://localhost:8080/v1');
    expect(normalizeLocalAIBaseUrl('127.0.0.1:11434/v1/')).toBe('http://127.0.0.1:11434/v1');
  });

  it('allows private-network endpoints and rejects arbitrary public hosts', () => {
    expect(normalizeLocalAIBaseUrl('http://192.168.1.20:8080')).toBe('http://192.168.1.20:8080/v1');
    expect(() => normalizeLocalAIBaseUrl('https://example.com/v1')).toThrow(/localhost|private-network/i);
  });

  it('normalizes multiple future endpoints into stable selectable targets', () => {
    const endpoints = normalizeLocalAIEndpoints([
      { id: 'Desktop LLM', title: 'Desktop LLM', baseUrl: 'localhost:8080', modelId: 'model-a', contextWindow: 32768, runtimeContextWindow: 24576, inputTokenLimit: 65536 },
      { id: 'Lab LLM', title: 'Lab LLM', baseUrl: '10.0.0.12:9000/v1', modelId: 'model-b', enabled: false },
    ], { strict: true });

    expect(endpoints).toEqual([
      expect.objectContaining({ id: 'desktop-llm', baseUrl: 'http://localhost:8080/v1', modelId: 'model-a', contextWindow: 32768, runtimeContextWindow: 24576, inputTokenLimit: 65536, enabled: true }),
      expect.objectContaining({ id: 'lab-llm', baseUrl: 'http://10.0.0.12:9000/v1', modelId: 'model-b', enabled: false }),
    ]);
    expect(getLocalAITargetValue(endpoints[0].id)).toBe('local-target:desktop-llm');
    expect(isLocalAITargetValue('local-target:desktop-llm')).toBe(true);
  });

  it('validates the per-route prompt input budget', () => {
    expect(() => normalizeLocalAIEndpoints([
      { title: 'Too small', baseUrl: 'localhost:8080', modelId: 'model-a', inputTokenLimit: 511 },
    ], { strict: true })).toThrow(/prompt input budget/i);
    expect(normalizeLocalAIEndpoints([
      { title: 'Large context', baseUrl: 'localhost:8080', modelId: 'model-a', inputTokenLimit: 262144 },
    ], { strict: true })[0].inputTokenLimit).toBe(262144);
  });
});
