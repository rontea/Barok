import {
  evaluateCompletion,
  getToolCapabilities,
  isPassingVerification,
  calculateModelQualityMetrics,
  createVerificationContext,
  resolveRoleModel,
  resolveModelTarget,
  transitionRun,
} from '../shared-control.js';

describe('shared engine control contracts', () => {
  it('requires objective gates before completion', () => {
    expect(evaluateCompletion(
      { requiresMutation: true, requiresVerification: true },
      { successfulMutations: 1, successfulVerifications: 0 },
    )).toMatchObject({ allowed: false, reasons: ['missing_verification_evidence'] });

    expect(evaluateCompletion(
      { requiresMutation: true, requiresVerification: true },
      { successfulMutations: 1, successfulVerifications: 1 },
    ).allowed).toBe(true);
  });

  it('records evidence on terminal transitions and rejects invalid transitions', () => {
    expect(transitionRun('verifying', 'completed', 'verification_passed', [{ source: 'test:unit' }]).to).toBe('completed');
    expect(transitionRun('implementing', 'awaiting_approval', 'policy_requires_user_approval', [{ source: 'test:policy' }]).to).toBe('awaiting_approval');
    expect(transitionRun('failed', 'repairing', 'recovery_budget_checkpoint_resumed', [{ source: 'test:recovery' }]).to).toBe('repairing');
    expect(() => transitionRun('planning', 'completed', 'claimed_done')).toThrow(/Invalid shared run transition/);
    expect(() => transitionRun('verifying', 'failed', 'checks_failed')).toThrow(/supporting evidence/);
  });

  it('routes tool-required roles away from an incompatible model', () => {
    expect(resolveModelTarget('implementation', 'fast-read-model', [
      { id: 'fast-read-model', toolCapable: false },
      { id: 'coding-model', toolCapable: true },
    ])).toMatchObject({ resolved: 'coding-model', fallback: 'coding-model' });
  });

  it('uses a faster model only for non-high-risk exploration', () => {
    expect(resolveRoleModel('exploration', 'accurate', [
      { id: 'accurate', toolCapable: false, latencyRank: 20 },
      { id: 'fast', toolCapable: false, latencyRank: 1 },
    ], 'low')).toMatchObject({ resolved: 'fast', reason: 'read_only_exploration_latency_route' });
    expect(resolveRoleModel('exploration', 'accurate', [
      { id: 'accurate', toolCapable: false, latencyRank: 20 },
      { id: 'fast', toolCapable: false, latencyRank: 1 },
    ], 'high').resolved).toBe('accurate');
  });

  it('builds a read-only verifier context and quality metrics', () => {
    expect(createVerificationContext(' request ', ['a.ts', 'a.ts'], [' passes ', 'passes'])).toEqual({
      originalRequest: 'request', changedFiles: ['a.ts'], acceptanceCriteria: ['passes'], readOnly: true,
    });
    expect(calculateModelQualityMetrics({ successfulMutation: true, verificationPassed: 2, verificationTotal: 3, recoveryCount: 2 })).toMatchObject({
      successfulMutation: true, verificationPassRate: 2 / 3, recoveryCount: 2,
    });
  });

  it('marks reads as parallel-safe and mutations as serialized', () => {
    expect(getToolCapabilities('Read')).toMatchObject({ readOnly: true, parallelSafe: true, mutating: false });
    expect(getToolCapabilities('Write')).toMatchObject({ mutating: true, parallelSafe: false });
  });

  it('only accepts a complete passing verification verdict', () => {
    expect(isPassingVerification({ verdict: 'PASS', checks: [{ command: 'npm test', passed: true, output: 'ok', available: true }] })).toBe(true);
    expect(isPassingVerification({ verdict: 'PASS', checks: [{ command: 'npm test', passed: true, output: '', available: false }] })).toBe(false);
    expect(isPassingVerification({ verdict: 'PASS', checks: [{ command: 'npm test', passed: true, output: '', available: true }] })).toBe(false);
    expect(isPassingVerification({
      verdict: 'PASS', nonTrivial: true,
      checks: [{ command: 'npm test', passed: true, output: 'ok', available: true }],
    })).toBe(false);
    expect(isPassingVerification({
      verdict: 'PASS', nonTrivial: true,
      checks: [{ command: 'npm test', passed: true, output: 'ok', available: true }],
      adversarialProbe: { command: 'edge case', passed: true, output: 'edge ok', available: true },
    })).toBe(true);
  });
});
