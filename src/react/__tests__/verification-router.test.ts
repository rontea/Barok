import { DefaultToolRegistry } from '../../di/providers/toolRegistry.js';
import { createVerificationOnlyToolRegistry } from '../tool-router.js';
import { runIndependentVerification } from '../verification-agent.js';

describe('verification-only tool routing', () => {
  it('exposes inspection and verification tools but no mutation tools', () => {
    const registry = createVerificationOnlyToolRegistry(new DefaultToolRegistry());
    expect(registry.getNames()).toEqual(expect.arrayContaining(['Read', 'Glob', 'Grep', 'Command']));
    expect(registry.has('Write')).toBe(false);
    expect(registry.has('Edit')).toBe(false);
    expect(registry.has('Bash')).toBe(false);
    expect(registry.has('PackageInstall')).toBe(false);
  });

  it('cannot register a mutation into the filtered verifier surface', () => {
    const registry = createVerificationOnlyToolRegistry(new DefaultToolRegistry());
    registry.register({ name: 'Write', description: 'mutation', handler: async () => ({ success: true }) });
    expect(registry.has('Write')).toBe(false);
  });

  it('returns a partial verdict for unavailable checks and requires an edge probe for non-trivial work', async () => {
    const registry = new DefaultToolRegistry([
      {
        name: 'Command',
        description: 'verification command',
        inputSchema: { type: 'object' },
        handler: async () => ({ success: true, status: 'skipped', output: 'tool unavailable' }),
      } as any,
    ]);
    const result = await runIndependentVerification({
      originalRequest: 'update the feature',
      changedFiles: ['src/feature.ts'],
      acceptanceCriteria: ['the feature works'],
      checks: [{ command: 'unit tests', operation: 'test' }],
      nonTrivial: true,
      registry,
    });
    expect(result.verdict).toBe('PARTIAL');
    expect(result.context.readOnly).toBe(true);
    expect(result.checks[0]).toMatchObject({ available: false, passed: false });
  });
});
