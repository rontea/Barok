import {
  assessVerification,
  createCoordinatedVerificationPlan,
  decideRepair,
  reviewVerification,
  type VerificationObservation,
} from '../verificationCoordinator';
import type { CodingTaskContract } from '../../tasks/codingTaskContract';

const contract: CodingTaskContract = {
  contractVersion: 1, id: 'task-1', originalRequest: 'Fix login', resolvedRequest: 'Fix login', requestedOutcome: 'Login works',
  behaviorIntent: 'fix_existing_behavior', taskKind: 'bug_fix', workspace: '/workspace', candidateFiles: ['src/auth/login.ts'],
  requirementSources: [], acceptanceCriteria: [{ id: 'login', description: 'Login behavior passes tests', required: true, source: 'user_request' }],
  permissions: { workspace: '/workspace', canInspect: true, canMutate: true, canRunCommands: true, approvalPolicy: 'ask' },
  nonGoals: [], verificationRequirements: ['unit-tests'],
  completionEvidenceRequirements: { requireRelevantInspectionBeforeMutation: true, requireSourceMutationForFeatureCompletion: false, requireVerificationForCompletion: true, requireRequirementMapping: true, requiredChecks: ['unit-tests'] },
  todoAction: 'none', historicalClaims: [],
};

describe('verificationCoordinator', () => {
  it.each([
    ['react-vite', ['ui/src/App.tsx'], 'build'],
    ['node-typescript', ['src/index.ts'], 'typescript'],
    ['vanilla-js', ['src/index.js'], 'validation'],
    ['python', ['src/calculator.py', 'tests/test_calculator.py'], 'unit-tests'],
    ['dirty-git', ['src/config.js'], 'validation'],
    ['no-git', ['src/value.js'], 'validation'],
    ['missing-package-manager', ['src/index.js'], 'validation'],
    ['windows-paths', ['src\\index.js'], 'validation'],
  ])('selects verification for the %s fixture project', (_name, files, expectedCheck) => {
    const plan = createCoordinatedVerificationPlan(contract, files as string[]);
    expect(plan.plan.plannedChecks).toContain(expectedCheck);
  });

  it('selects checks from changed files and maps criteria to checks', () => {
    const plan = createCoordinatedVerificationPlan(contract, ['src/auth/login.ts', 'src/__tests__/login.test.ts']);
    expect(plan.plan.plannedChecks).toContain('unit-tests');
    expect(plan.requirementChecks.login.length).toBeGreaterThan(0);
  });

  it('blocks completion when a required check is unavailable', () => {
    const plan = createCoordinatedVerificationPlan(contract, ['src/__tests__/login.test.ts']);
    const decision = assessVerification(plan, [{ id: 'v1', check: 'unit-tests', status: 'unavailable', changedFiles: [] }]);
    expect(decision.status).toBe('blocked');
    expect(decision.requirements[0].status).toBe('blocked');
  });

  it('requires passed evidence for every acceptance criterion', () => {
    const plan = createCoordinatedVerificationPlan(contract, ['src/__tests__/login.test.ts']);
    const decision = assessVerification(plan, [{ id: 'v1', check: 'unit-tests', status: 'passed', changedFiles: ['src/auth/login.ts'] }]);
    expect(decision.status).toBe('passed');
    expect(reviewVerification(decision, ['src/auth/login.ts'], contract.candidateFiles).approved).toBe(true);
  });

  it('uses a passing unit-test command as evidence for generic Command verify requirements', () => {
    const genericContract: CodingTaskContract = {
      ...contract,
      verificationRequirements: ['Command verify'],
      completionEvidenceRequirements: {
        ...contract.completionEvidenceRequirements,
        requiredChecks: ['Command verify'],
      },
    };
    const plan = createCoordinatedVerificationPlan(genericContract, ['src/auth/login.ts']);
    const decision = assessVerification(plan, [{
      id: 'v1',
      check: 'unit-tests',
      status: 'passed',
      changedFiles: ['src/auth/login.ts'],
      output: 'Tests: 1 passed',
    }]);

    expect(plan.plan.plannedChecks).toContain('project-verification');
    expect(decision.status).toBe('passed');
    expect(decision.requirements[0]).toMatchObject({ status: 'passed', observationIds: ['v1'] });
  });

  it('does not bypass an explicit unavailable project verification with passing unit tests', () => {
    const genericContract: CodingTaskContract = {
      ...contract,
      verificationRequirements: ['Command verify'],
      completionEvidenceRequirements: {
        ...contract.completionEvidenceRequirements,
        requiredChecks: ['Command verify'],
      },
    };
    const plan = createCoordinatedVerificationPlan(genericContract, ['src/auth/login.ts']);
    const decision = assessVerification(plan, [
      { id: 'v1', check: 'project-verification', status: 'unavailable', changedFiles: [] },
      { id: 'v2', check: 'unit-tests', status: 'passed', changedFiles: [], output: 'Tests: 1 passed' },
    ]);

    expect(decision.status).toBe('blocked');
    expect(decision.requirements[0].status).toBe('blocked');
  });

  it('allows a later passing retry to replace an earlier failed observation', () => {
    const plan = createCoordinatedVerificationPlan(contract, ['src/__tests__/login.test.ts']);
    const decision = assessVerification(plan, [
      { id: 'v1', check: 'unit-tests', status: 'timed_out', changedFiles: [] },
      { id: 'v2', check: 'unit-tests', status: 'passed', changedFiles: [] },
    ]);

    expect(decision.status).toBe('passed');
    expect(decision.failures).toEqual([]);
    expect(decision.requirements[0]).toMatchObject({ status: 'passed', observationIds: ['v2'] });
  });

  it('accepts an absolute Windows mutation path inside the workspace candidate scope', () => {
    const decision = {
      status: 'passed',
      requirements: [{ requirementId: 'login', observationIds: ['v1'], status: 'passed' }],
      failures: [],
      unavailable: [],
    } as const;
    const review = reviewVerification(
      decision,
      ['C:\\MPC Project Test\\game 1\\index.js'],
      ['index.js'],
      'C:\\MPC Project Test\\game 1',
    );

    expect(review.approved).toBe(true);
  });

  it('accepts a discovered file that the runtime authorized after inspection', () => {
    const decision = {
      status: 'passed',
      requirements: [{ requirementId: 'login', observationIds: ['v1'], status: 'passed' }],
      failures: [],
      unavailable: [],
    } as const;
    const review = reviewVerification(
      decision,
      ['C:\\MPC Project Test\\game 1\\src\\types.ts'],
      ['src/gameLoop.ts'],
      'C:\\MPC Project Test\\game 1',
      ['src/types.ts'],
    );

    expect(review.approved).toBe(true);
  });

  it('stops repeated identical repair failures', () => {
    const observation: VerificationObservation = { id: 'v1', check: 'unit-tests', status: 'failed', changedFiles: ['src/auth/login.ts'], output: 'Expected true, received false' };
    const first = decideRepair(observation, []);
    const second = decideRepair(observation, [first.signature]);
    const third = decideRepair(observation, [first.signature, first.signature]);
    expect(second.strategy).toBe('inspect');
    expect(third.allowed).toBe(false);
  });

  it('records reviewer disagreement for an out-of-scope diff', () => {
    const plan = createCoordinatedVerificationPlan(contract, ['src/__tests__/login.test.ts']);
    const decision = assessVerification(plan, [{ id: 'v1', check: 'unit-tests', status: 'passed', changedFiles: ['src/auth/login.ts'] }]);
    const review = reviewVerification(decision, ['src/auth/login.ts', 'src/billing.ts'], contract.candidateFiles);
    expect(review.approved).toBe(false);
    expect(review.findings.join(' ')).toContain('src/billing.ts');
  });

  it('records reviewer disagreement when requirement evidence is incomplete', () => {
    const plan = createCoordinatedVerificationPlan(contract, ['src/__tests__/login.test.ts']);
    const decision = assessVerification(plan, []);
    const review = reviewVerification(decision, ['src/auth/login.ts'], contract.candidateFiles);
    expect(review.approved).toBe(false);
    expect(review.findings).toContain('One or more acceptance criteria lack passed evidence.');
  });

  it('allows a passing project-verification observation to satisfy planned build requirements', () => {
    const buildContract: CodingTaskContract = {
      ...contract,
      acceptanceCriteria: [{ id: 'build-check', description: 'Run a build when available', required: true, source: 'analysis' }],
      verificationRequirements: ['Command verify'],
      completionEvidenceRequirements: {
        ...contract.completionEvidenceRequirements,
        requiredChecks: ['Command verify'],
      },
    };
    const plan = createCoordinatedVerificationPlan(buildContract, ['ui/src/App.tsx']);
    expect(plan.requirementChecks['build-check']).toContain('build');
    const decision = assessVerification(plan, [{
      id: 'v1',
      check: 'project-verification',
      status: 'passed',
      changedFiles: ['ui/src/App.tsx'],
      output: 'Static HTML verification passed: index.html',
    }]);

    expect(decision.status).toBe('passed');
    expect(decision.requirements[0].status).toBe('passed');
    expect(decision.requirements[0].observationIds).toEqual(['v1']);
  });

  it('allows passing typescript or build checks to satisfy generic Command verify requirements', () => {
    const genericContract: CodingTaskContract = {
      ...contract,
      verificationRequirements: ['Command verify'],
      completionEvidenceRequirements: {
        ...contract.completionEvidenceRequirements,
        requiredChecks: ['Command verify'],
      },
    };
    const plan = createCoordinatedVerificationPlan(genericContract, ['src/index.ts']);
    const decision = assessVerification(plan, [{
      id: 'v1',
      check: 'typescript',
      status: 'passed',
      changedFiles: ['src/index.ts'],
      output: 'tsc exited with 0',
    }]);

    expect(decision.status).toBe('passed');
    expect(decision.requirements[0].status).toBe('passed');
    expect(decision.requirements[0].observationIds).toEqual(['v1']);
  });

  it('maps criteria with non-executable keywords like validation to observable checks', () => {
    const validationContract: CodingTaskContract = {
      ...contract,
      acceptanceCriteria: [{ id: 'validation-check', description: 'Run targeted UI validation when available', required: true, source: 'analysis' }],
    };
    const plan = createCoordinatedVerificationPlan(validationContract, ['src/index.js']);
    // 'validation' is not in OBSERVABLE_CHECKS, so it must not be selected as an impossible requirement
    expect(plan.requirementChecks['validation-check']).not.toContain('validation');
    expect(plan.requirementChecks['validation-check'].every((c) => ['project-verification', 'unit-tests', 'typescript', 'lint', 'build'].includes(c))).toBe(true);
  });
});
