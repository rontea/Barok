import { describe, expect, it } from '@jest/globals';
import {
  getColabTargetValue,
  isColabTargetValue,
  normalizeColabBaseUrl,
  normalizeColabEndpoints,
} from '../colabTargets.js';

describe('Colab model endpoint configuration', () => {
  it('accepts a public tunnel URL and normalizes it to an OpenAI-compatible v1 base', () => {
    expect(normalizeColabBaseUrl('https://example.ngrok-free.dev')).toBe('https://example.ngrok-free.dev/v1');
  });

  it('normalizes multiple Colab routes into stable selectable targets', () => {
    const endpoints = normalizeColabEndpoints([
      { id: 'Colab One', title: 'Colab One', baseUrl: 'https://one.example/v1', modelId: 'model-a' },
      { id: 'Colab Two', title: 'Colab Two', baseUrl: 'https://two.example/v1', modelId: 'model-b', enabled: false },
    ], { strict: true });

    expect(endpoints).toEqual([
      expect.objectContaining({ id: 'colab-one', baseUrl: 'https://one.example/v1', modelId: 'model-a', enabled: true }),
      expect.objectContaining({ id: 'colab-two', baseUrl: 'https://two.example/v1', modelId: 'model-b', enabled: false }),
    ]);
    expect(getColabTargetValue(endpoints[0].id)).toBe('colab-target:colab-one');
    expect(isColabTargetValue('colab-target:colab-one')).toBe(true);
  });
});
