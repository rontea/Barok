import type { CodingTaskContract, CodingTaskCriterion } from '@barok/core';
import { createVerificationPlan, type CheckType, type VerificationPlan } from './verification-planner.js';

export type VerificationCommandStatus = 'passed' | 'failed' | 'unavailable' | 'skipped' | 'cancelled' | 'timed_out';

export interface VerificationObservation {
  id: string;
  check: string;
  status: VerificationCommandStatus;
  changedFiles: string[];
  output?: string;
  artifactPath?: string;
}

export interface RequirementEvidence {
  requirementId: string;
  observationIds: string[];
  status: 'passed' | 'missing' | 'blocked';
}

export interface CoordinatedVerificationPlan {
  contractId: string;
  changedFiles: string[];
  plan: VerificationPlan;
  requirementChecks: Record<string, string[]>;
}

export interface VerificationDecision {
  status: 'passed' | 'failed' | 'blocked' | 'incomplete';
  requirements: RequirementEvidence[];
  failures: VerificationObservation[];
  unavailable: VerificationObservation[];
}

export interface RepairDecision {
  allowed: boolean;
  signature: string;
  reason: string;
  strategy: 'inspect' | 'repair' | 'blocked';
}

function inferLayers(files: string[]): string[] {
  const layers = new Set<string>();
  for (const file of files) {
    const normalized = file.replace(/\\/g, '/').toLowerCase();
    if (/^(ui\/|.*\.(tsx|jsx|css)$)/.test(normalized)) layers.add('frontend');
    if (/^(src\/|server\.|.*\.(ts|js)$)/.test(normalized)) layers.add('backend');
    if (/(^|\/)(tests?|__tests__)\//.test(normalized) || /(^|\/)(test_|[^/]*\.(test|spec)\.)/.test(normalized)) layers.add('tests');
    if (/(migration|schema|seed|sqlite|database)/.test(normalized)) layers.add('data');
    if (/\.(md|mdx)$/.test(normalized) || normalized.startsWith('docs/')) layers.add('docs');
  }
  return layers.size ? [...layers] : ['tests'];
}

const OBSERVABLE_CHECKS = new Set<string>([
  'project-verification',
  'unit-tests',
  'typescript',
  'lint',
  'build',
]);

function checksForCriterion(criterion: CodingTaskCriterion, plan: VerificationPlan): string[] {
  const text = criterion.description.toLowerCase();
  const selected = plan.plannedChecks.filter(
    (check) => OBSERVABLE_CHECKS.has(check) && text.includes(check.replace('-', ' '))
  );
  if (selected.length) return selected;
  if (plan.plannedChecks.includes('project-verification')) return ['project-verification'];
  const observableCritical = plan.criticalChecks.filter((check) => OBSERVABLE_CHECKS.has(check));
  if (observableCritical.length) return observableCritical;
  const observablePlanned = plan.plannedChecks.filter((check) => OBSERVABLE_CHECKS.has(check));
  if (observablePlanned.length) return observablePlanned.slice(0, 1);
  return ['project-verification'];
}

/** Selects narrow checks from a versioned task contract and the actual changed-file inventory. */
export function createCoordinatedVerificationPlan(contract: CodingTaskContract, changedFiles: string[]): CoordinatedVerificationPlan {
  const layers = inferLayers(changedFiles);
  const plan = createVerificationPlan(layers, changedFiles);
  const requiredChecks = contract.completionEvidenceRequirements.requiredChecks;
  for (const required of requiredChecks) {
    const normalized = required.toLowerCase();
    if (normalized.includes('command verify')) {
      if (!plan.plannedChecks.includes('project-verification')) plan.plannedChecks.push('project-verification');
      if (!plan.criticalChecks.includes('project-verification')) plan.criticalChecks.push('project-verification');
      continue;
    }
    const check = plan.plannedChecks.find((candidate) => normalized.includes(candidate) || candidate.includes(normalized)) as CheckType | undefined;
    if (check && !plan.criticalChecks.includes(check)) plan.criticalChecks.push(check);
  }
  const requirementChecks = Object.fromEntries(contract.acceptanceCriteria.map((criterion) => [criterion.id, checksForCriterion(criterion, plan)]));
  return { contractId: contract.id, changedFiles: [...new Set(changedFiles)], plan, requirementChecks };
}

/** A required unavailable check blocks completion; it is never reclassified as a pass. */
export function assessVerification(plan: CoordinatedVerificationPlan, observations: VerificationObservation[]): VerificationDecision {
  // Verification commands may be retried in the same run. The most recent
  // observation for a check is authoritative; otherwise a repaired timeout
  // would keep the whole contract failed forever.
  const latestByCheck = new Map<string, VerificationObservation>();
  for (const observation of observations) latestByCheck.set(observation.check, observation);
  const currentObservations = [...latestByCheck.values()];
  const failures = currentObservations.filter((item) => item.status === 'failed' || item.status === 'timed_out' || item.status === 'cancelled');
  const unavailable = currentObservations.filter((item) => item.status === 'unavailable' || item.status === 'skipped');
  const requirements = Object.entries(plan.requirementChecks).map(([requirementId, checks]) => {
    const matching = currentObservations.filter((item) => checks.includes(item.check));
    if (matching.some((item) => item.status === 'unavailable' || item.status === 'skipped')) {
      return { requirementId, observationIds: matching.map((item) => item.id), status: 'blocked' as const };
    }
    const passed = matching.filter((item) => item.status === 'passed');

    // Generic verification fallback:
    // 1. When a requirement includes `project-verification` and no explicit `project-verification`
    //    observation exists, any successful verification observation (unit-tests, build, typescript, lint)
    //    can satisfy it, as long as project-verification was not explicitly unavailable or failed.
    // 2. When a requirement specifies a narrower check (e.g. build, typescript, unit-tests) and
    //    that specific check was not run, a passing `project-verification` (which verifies project health)
    //    satisfies it, provided the check itself did not explicitly fail.
    if (passed.length === 0) {
      const explicitFailureOrUnavailable = currentObservations.some(
        (item) => (checks.includes(item.check) || item.check === 'project-verification') &&
          (item.status === 'failed' || item.status === 'unavailable' || item.status === 'skipped')
      );
      if (!explicitFailureOrUnavailable) {
        if (checks.includes('project-verification')) {
          const fallback = currentObservations.find((item) => item.status === 'passed');
          if (fallback) passed.push(fallback);
        } else {
          const fallback = currentObservations.find((item) => item.check === 'project-verification' && item.status === 'passed');
          if (fallback) passed.push(fallback);
        }
      }
    }

    return { requirementId, observationIds: passed.map((item) => item.id), status: passed.length ? 'passed' as const : 'missing' as const };
  });
  if (requirements.some((item) => item.status === 'blocked')) return { status: 'blocked', requirements, failures, unavailable };
  if (failures.length) return { status: 'failed', requirements, failures, unavailable };
  if (requirements.some((item) => item.status === 'missing')) return { status: 'incomplete', requirements, failures, unavailable };
  return { status: 'passed', requirements, failures, unavailable };
}

/** Stops repeated repair loops unless the failure signature or strategy changes. */
export function decideVerificationRepair(
  observation: VerificationObservation,
  priorSignatures: string[],
  hashSerializedValue: (serialized: string) => string,
  maxAttempts = 2,
): RepairDecision {
  const signature = hashSerializedValue(`${observation.check}\n${observation.status}\n${(observation.output || '').slice(0, 4000)}`);
  const repeats = priorSignatures.filter((item) => item === signature).length;
  if (repeats >= maxAttempts) return { allowed: false, signature, strategy: 'blocked', reason: `Repeated ${observation.check} failure reached the ${maxAttempts}-attempt limit.` };
  return { allowed: true, signature, strategy: repeats ? 'inspect' : 'repair', reason: repeats ? 'Same failure recurred; inspect changed files before another repair.' : 'New failure signature; create a scoped repair plan.' };
}

/** Read-only reviewer predicate: final claims require complete requirement evidence and no out-of-scope files. */
export function reviewVerification(
  decision: VerificationDecision,
  changedFiles: string[],
  candidateFiles: string[],
  workspace?: string,
  runtimeCandidateFiles: string[] = [],
): { approved: boolean; findings: string[] } {
  const findings: string[] = [];
  if (decision.status !== 'passed') findings.push(`Verification is ${decision.status}, not passed.`);
  const normalize = (file: string): string => file
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '')
    .toLowerCase();
  const normalizedWorkspace = workspace ? normalize(workspace) : undefined;
  const relativeToWorkspace = (file: string): string => {
    const normalized = normalize(file);
    if (!normalizedWorkspace) return normalized;
    if (normalized === normalizedWorkspace) return '';
    const prefix = normalizedWorkspace + '/';
    return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
  };
  const allowed = new Set([...candidateFiles, ...runtimeCandidateFiles].map((file) => relativeToWorkspace(file)));
  const outOfScope = changedFiles.filter((file) => {
    if (!allowed.size) return false;
    const normalized = relativeToWorkspace(file);
    return !allowed.has(normalized);
  });
  if (outOfScope.length) findings.push(`Changed files outside candidate scope: ${outOfScope.join(', ')}`);
  if (decision.requirements.some((item) => item.status !== 'passed')) findings.push('One or more acceptance criteria lack passed evidence.');
  return { approved: findings.length === 0, findings };
}
