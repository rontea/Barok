import { describe, expect, it } from '@jest/globals';
import { parseOpenRouterAccountStatus } from '../openRouterAccount.js';

describe('OpenRouter account status normalization', () => {
  it('keeps advisory fields and drops sensitive upstream metadata', () => {
    expect(parseOpenRouterAccountStatus({
      data: {
        is_free_tier: true,
        usage: 12.5,
        limit: 50,
        limit_remaining: 37.5,
        limit_reset: 'daily',
        expires_at: '2027-12-31T23:59:59Z',
        hash: 'secret-hash',
        creator_user_id: 'private-user-id',
      },
    })).toEqual({
      isFreeTier: true,
      usage: 12.5,
      limit: 50,
      limitRemaining: 37.5,
      limitReset: 'daily',
      expiresAt: '2027-12-31T23:59:59Z',
    });
  });

  it('returns an empty safe status for malformed payloads', () => {
    expect(parseOpenRouterAccountStatus({ error: { message: 'not safe to expose' } })).toEqual({});
    expect(parseOpenRouterAccountStatus(null)).toEqual({});
  });
});
