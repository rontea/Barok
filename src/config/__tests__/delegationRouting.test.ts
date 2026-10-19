import {
  assertDelegationRoleAllowed,
  MAX_DELEGATION_ROLE_RULE_LENGTH,
  normalizeDelegationSettings,
  resetDelegationSlotAllocator,
  selectDelegationRoute,
  validateDelegationSettings,
  withDelegationConcurrency,
} from '../delegationRouting.js';

describe('delegation routing settings', () => {
  afterEach(() => resetDelegationSlotAllocator());

  it('normalizes bounded worker slots and ignores legacy main-agent settings', () => {
    const settings = normalizeDelegationSettings({
      enabled: true,
      useForMainAgent: true,
      main: { provider: 'nvidia', model: 'nvidia-target:main' },
      delegates: [
        { slot: 2, route: { provider: 'gemini', model: 'gemini-target:two' } },
        { slot: 2, route: { provider: 'nvidia', model: 'nvidia-target:duplicate' } },
        { slot: 99, route: null },
      ],
      maxConcurrentDelegates: 100,
    });

    expect(settings).not.toHaveProperty('main');
    expect(settings).not.toHaveProperty('useForMainAgent');
    expect(settings.delegates).toEqual([
      { slot: 2, route: { provider: 'gemini', model: 'gemini-target:two' } },
      { slot: 3, route: null },
    ]);
    expect(settings.maxConcurrentDelegates).toBe(1);
  });

  it('assigns omitted slots round-robin and supports explicit slots', () => {
    const settings = normalizeDelegationSettings({
      enabled: false,
      delegates: [
        { slot: 1, route: { provider: 'nvidia', model: 'nvidia-target:one' } },
        { slot: 4, route: { provider: 'gemini', model: 'gemini-target:four' } },
      ],
    });

    expect(selectDelegationRoute(settings)).toEqual({ slot: 1, route: { provider: 'nvidia', model: 'nvidia-target:one' } });
    expect(selectDelegationRoute(settings)).toEqual({ slot: 4, route: { provider: 'gemini', model: 'gemini-target:four' } });
    expect(selectDelegationRoute(settings, 4)).toEqual({ slot: 4, route: { provider: 'gemini', model: 'gemini-target:four' } });
  });

  it('requires routes before enabled delegation can be used', () => {
    const validation = validateDelegationSettings({ enabled: true, delegates: [] });

    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('delegate task route'),
    ]));
  });

  it('enforces the server-owned role allowlist and bounded role rules', () => {
    const settings = normalizeDelegationSettings({
      enabled: true,
      allowedRoles: ['coder', 'reviewer'],
      roleRules: { coder: 'Prefer focused edits and run the relevant tests.' },
      delegates: [{ slot: 1, route: { provider: 'nvidia', model: 'nvidia-target:one' } }],
    });

    expect(() => assertDelegationRoleAllowed(settings, 'researcher')).toThrow(/not allowed/);
    expect(() => assertDelegationRoleAllowed(settings, 'unknown')).toThrow(/Unknown/);
    expect(validateDelegationSettings({
      allowedRoles: ['coder'],
      roleRules: { coder: 'x'.repeat(MAX_DELEGATION_ROLE_RULE_LENGTH + 1) },
    }).errors).toEqual(expect.arrayContaining([expect.stringContaining('character limit')]));
    expect(settings.roleRules.coder).toContain('focused edits');
  });

  it('serializes workers even when an old setting requests concurrency', async () => {
    const settings = normalizeDelegationSettings({ maxConcurrentDelegates: 16 });
    const events: string[] = [];

    const first = withDelegationConcurrency(settings, async () => {
      events.push('worker-1:start');
      await new Promise((resolve) => setTimeout(resolve, 10));
      events.push('worker-1:end');
      return 'one';
    });
    const second = withDelegationConcurrency(settings, async () => {
      events.push('worker-2:start');
      events.push('worker-2:end');
      return 'two';
    });

    await expect(Promise.all([first, second])).resolves.toEqual(['one', 'two']);
    expect(events).toEqual([
      'worker-1:start',
      'worker-1:end',
      'worker-2:start',
      'worker-2:end',
    ]);
  });
});
