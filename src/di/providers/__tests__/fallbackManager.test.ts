/**
 * Tests for ProviderFallbackManager
 * Validates consolidated LLM fallback and retry behavior
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ProviderFallbackManager } from '../fallbackManager.js';
import type { LLMProvider } from '../../types.js';

describe('ProviderFallbackManager', () => {
  let manager: ProviderFallbackManager;
  let mockProviders: Map<string, LLMProvider>;

  beforeEach(() => {
    manager = new ProviderFallbackManager({
      maxAttempts: 3,
      delayMs: 10, // Short delay for tests
      backoffMultiplier: 1.5,
      fallbackProviders: ['gemini', 'pollinations', 'claude'],
    });

    // Create mock providers
    mockProviders = new Map();
    mockProviders.set('gemini', {
      createChatCompletion: jest.fn(),
      estimateStepCost: jest.fn(() => 0.001),
      getProviderName: jest.fn(() => 'gemini'),
      isAvailable: jest.fn(() => true),
    });

    mockProviders.set('pollinations', {
      createChatCompletion: jest.fn(),
      estimateStepCost: jest.fn(() => 0.0001),
      getProviderName: jest.fn(() => 'pollinations'),
      isAvailable: jest.fn(() => true),
    });

    mockProviders.set('claude', {
      createChatCompletion: jest.fn(),
      estimateStepCost: jest.fn(() => 0.002),
      getProviderName: jest.fn(() => 'claude'),
      isAvailable: jest.fn(() => true),
    });

    // Register all mock providers
    mockProviders.forEach((provider, name) => {
      manager.registerProvider(name, provider);
    });
  });

  describe('Provider Registration', () => {
    it('should register a provider', () => {
      const newProvider: LLMProvider = {
        createChatCompletion: jest.fn(),
        estimateStepCost: jest.fn(() => 0.001),
        getProviderName: jest.fn(() => 'test'),
        isAvailable: jest.fn(() => true),
      };

      manager.registerProvider('test', newProvider);
      expect(manager.getProvider('test')).toBe(newProvider);
    });

    it('should return undefined for unregistered provider', () => {
      expect(manager.getProvider('nonexistent')).toBeUndefined();
    });

    it('should overwrite provider with same name', () => {
      const newProvider: LLMProvider = {
        createChatCompletion: jest.fn(),
        estimateStepCost: jest.fn(() => 0.005),
        getProviderName: jest.fn(() => 'gemini'),
        isAvailable: jest.fn(() => true),
      };

      manager.registerProvider('gemini', newProvider);
      expect(manager.getProvider('gemini')).toBe(newProvider);
    });
  });

  describe('Provider Fallback', () => {
    it('should use primary provider on success', async () => {
      const geminiProvider = mockProviders.get('gemini')!;
      (geminiProvider.createChatCompletion as any).mockResolvedValue('response');

      const result = await manager.retryWithFallback(
        async (provider) => {
          return provider.createChatCompletion([], 'gemini');
        },
        'gemini'
      );

      expect(result.success).toBe(true);
      expect(result.data).toBe('response');
      expect(result.attemptedProviders).toContain('gemini');
      expect(geminiProvider.createChatCompletion).toHaveBeenCalledTimes(1);
    });

    it('should retry with fallback provider on failure', async () => {
      const geminiProvider = mockProviders.get('gemini')!;
      const pollinationsProvider = mockProviders.get('pollinations')!;

      (geminiProvider.createChatCompletion as any).mockRejectedValue(
        new Error('Gemini timeout')
      );
      (pollinationsProvider.createChatCompletion as any).mockResolvedValue('fallback response');

      const result = await manager.retryWithFallback(
        async (provider) => {
          return provider.createChatCompletion([], 'model');
        },
        'gemini'
      );

      expect(result.success).toBe(true);
      expect(result.data).toBe('fallback response');
      expect(result.attemptedProviders).toContain('gemini');
      expect(result.attemptedProviders).toContain('pollinations');
    });

    it('should return failure when all providers fail', async () => {
      const geminiProvider = mockProviders.get('gemini')!;
      const pollinationsProvider = mockProviders.get('pollinations')!;
      const claudeProvider = mockProviders.get('claude')!;

      (geminiProvider.createChatCompletion as any).mockRejectedValue(
        new Error('Gemini error')
      );
      (pollinationsProvider.createChatCompletion as any).mockRejectedValue(
        new Error('Pollinations error')
      );
      (claudeProvider.createChatCompletion as any).mockRejectedValue(
        new Error('Claude error')
      );

      const result = await manager.retryWithFallback(
        async (provider) => {
          return provider.createChatCompletion([], 'model');
        },
        'gemini'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.attemptedProviders.length).toBeGreaterThan(0);
    });

    it('should stop on non-retryable errors', async () => {
      const geminiProvider = mockProviders.get('gemini')!;
      const pollinationsProvider = mockProviders.get('pollinations')!;

      const authError = new Error('401 Unauthorized');
      (authError as any).status = 401;
      (geminiProvider.createChatCompletion as any).mockRejectedValue(authError);
      (pollinationsProvider.createChatCompletion as any).mockResolvedValue('response');

      const result = await manager.retryWithFallback(
        async (provider) => {
          return provider.createChatCompletion([], 'model');
        },
        'gemini'
      );

      expect(result.success).toBe(false);
      expect(result.attemptedProviders).toContain('gemini');
      expect(result.attemptedProviders).not.toContain('pollinations');
    });
  });

  describe('Model Fallback', () => {
    it('should use primary model on success', async () => {
      const geminiProvider = mockProviders.get('gemini')!;
      (geminiProvider.createChatCompletion as any).mockResolvedValue('response');

      const result = await manager.retryWithModelFallback(
        async (provider, model) => {
          return provider.createChatCompletion([], model);
        },
        geminiProvider,
        'gemini-3.5-flash'
      );

      expect(result.success).toBe(true);
      expect(result.data).toBe('response');
      expect(result.attemptedModels).toContain('gemini-3.5-flash');
    });

    it('should retry with fallback model on failure', async () => {
      const geminiProvider = mockProviders.get('gemini')!;

      const callOrder: string[] = [];
      (geminiProvider.createChatCompletion as any).mockImplementation((msgs, model) => {
        callOrder.push(model);
        if (model === 'gemini-3.5-flash') {
          throw new Error('Model overloaded');
        }
        return Promise.resolve('fallback response');
      });

      const result = await manager.retryWithModelFallback(
        async (provider, model) => {
          return provider.createChatCompletion([], model);
        },
        geminiProvider,
        'gemini-3.5-flash',
        ['gemini-2.0-flash']
      );

      expect(result.success).toBe(true);
      expect(result.data).toBe('fallback response');
      expect(result.attemptedModels).toContain('gemini-3.5-flash');
      expect(result.attemptedModels).toContain('gemini-2.0-flash');
    });

    it('should return failure when all models fail', async () => {
      const geminiProvider = mockProviders.get('gemini')!;

      (geminiProvider.createChatCompletion as any).mockRejectedValue(
        new Error('Model quota exceeded')
      );

      const result = await manager.retryWithModelFallback(
        async (provider, model) => {
          return provider.createChatCompletion([], model);
        },
        geminiProvider,
        'gemini-3.5-flash',
        ['gemini-2.0-flash']
      );

      expect(result.success).toBe(false);
      expect(result.attemptedModels).toContain('gemini-3.5-flash');
      expect(result.attemptedModels).toContain('gemini-2.0-flash');
    });
  });

  describe('Fallback Order', () => {
    it('should return correct fallback order starting with primary', () => {
      const order = manager.getProviderFallbackOrder('gemini');

      expect(order[0]).toBe('gemini');
      expect(order).toContain('pollinations');
      expect(order).toContain('claude');
    });

    it('should not duplicate primary provider in fallback order', () => {
      const order = manager.getProviderFallbackOrder('gemini');

      const geminiCount = order.filter((p) => p === 'gemini').length;
      expect(geminiCount).toBe(1);
    });

    it('should handle different primary provider', () => {
      const order = manager.getProviderFallbackOrder('pollinations');

      expect(order[0]).toBe('pollinations');
      expect(order).toContain('gemini');
    });
  });

  describe('Error Handling', () => {
    it('should handle retryable errors', async () => {
      const geminiProvider = mockProviders.get('gemini')!;
      const pollinationsProvider = mockProviders.get('pollinations')!;

      const timeoutError = new Error('Connection timeout');
      (geminiProvider.createChatCompletion as any).mockRejectedValueOnce(timeoutError);
      (pollinationsProvider.createChatCompletion as any).mockResolvedValueOnce(
        'recovered'
      );

      const result = await manager.retryWithFallback(
        async (provider) => {
          return provider.createChatCompletion([], 'model');
        },
        'gemini'
      );

      expect(result.success).toBe(true);
      expect(result.data).toBe('recovered');
    });

    it('should handle rate limit errors', async () => {
      const geminiProvider = mockProviders.get('gemini')!;
      const pollinationsProvider = mockProviders.get('pollinations')!;

      const rateLimitError = new Error('Rate limit exceeded');
      (rateLimitError as any).status = 429;
      (geminiProvider.createChatCompletion as any).mockRejectedValueOnce(rateLimitError);
      (pollinationsProvider.createChatCompletion as any).mockResolvedValueOnce(
        'ok'
      );

      const result = await manager.retryWithFallback(
        async (provider) => {
          return provider.createChatCompletion([], 'model');
        },
        'gemini'
      );

      expect(result.success).toBe(true);
    });
  });

  describe('DI Container Integration', () => {
    it('should be available via DI container', async () => {
      const { getDIContainer } = await import('../../container.js');
      const diContainer = getDIContainer();

      expect(diContainer.getFallbackManager).toBeDefined();
      const fallbackManager = diContainer.getFallbackManager();
      expect(fallbackManager).toBeInstanceOf(ProviderFallbackManager);
    });
  });
});
