import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  type EvaluationRunRecord,
  type EvaluationRunStatus,
  createEvidenceId,
  deriveEvaluationOperatingMetrics,
  parseEvaluationRunRecord,
  serializeEvaluationRunRecord,
} from './evaluationSchema.js';
import {
  type EvaluationProjectFixture,
  type EvaluationTaskFixture,
  parseProjectFixture,
  parseTaskFixture,
} from './fixtureSchema.js';

export interface MaterializedEvaluationWorkspace {
  path: string;
  fingerprint: string;
  gitInitialized: boolean;
  cleanup: () => Promise<void>;
}

export interface MaterializeFixtureOptions {
  root?: string;
  initializeGit?: boolean;
}

export interface EvaluationAssessment {
  passed: boolean;
  problems: string[];
}

export interface EvaluationRunOutcome {
  record: EvaluationRunRecord;
  assessment: EvaluationAssessment;
  resultPath?: string;
}

export interface RunEvaluationOptions {
  outputDirectory?: string;
  preserveWorkspace?: boolean;
  initializeGit?: boolean;
  runtimeVersion?: string;
  providerAdapter?: string;
  randomSeed?: number;
  startedAt?: number;
}

export interface EvaluationSummary {
  schemaVersion: 1;
  generatedAt: number;
  totalRuns: number;
  passedRuns: number;
  failedRuns: number;
  falseCompletions: number;
  averageValidToolCallRate?: number;
  averageVerificationCoverage?: number;
  averageFirstUsefulActionLatencyMs?: number;
  averageChildCompletionRate?: number;
  totalDuplicateActionCount: number;
  totalUnknownOutcomeCount: number;
  totalRecoveryCount: number;
  totalCost: number;
  totalDurationMs: number;
  runs: Array<{
    runId: string;
    fixtureId: string;
    status: EvaluationRunStatus;
    passed: boolean;
    problems: string[];
  }>;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function normalizeFixturePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function resolveFixturePath(workspace: string, relativePath: string): string {
  const normalized = normalizeFixturePath(relativePath);
  const resolvedWorkspace = path.resolve(workspace);
  const resolved = path.resolve(resolvedWorkspace, normalized);
  const prefix = `${resolvedWorkspace}${path.sep}`;
  if (resolved !== resolvedWorkspace && !resolved.startsWith(prefix)) {
    throw new Error(`Fixture path escapes disposable workspace: ${relativePath}`);
  }
  return resolved;
}

function fingerprintProject(fixture: EvaluationProjectFixture): string {
  return createHash('sha256').update(stableJson({
    schemaVersion: fixture.schemaVersion,
    id: fixture.id,
    files: fixture.files,
    dirtyChange: fixture.dirtyChange,
  })).digest('hex');
}

async function writeWorkspaceFile(workspace: string, relativePath: string, content: string): Promise<void> {
  const target = resolveFixturePath(workspace, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

function initializeGitRepository(workspace: string, fixture: EvaluationProjectFixture): boolean {
  if (fixture.gitMode === 'none') return false;
  const version = spawnSync('git', ['--version'], { cwd: workspace, encoding: 'utf8' });
  if (version.status !== 0) throw new Error('Git fixture requested, but Git is unavailable.');
  const commands = [
    ['init', '--quiet'],
    ['config', 'user.email', 'evals@example.invalid'],
    ['config', 'user.name', 'Evaluation Runner'],
    ['add', '.'],
    ['commit', '--quiet', '-m', 'fixture baseline'],
  ];
  for (const args of commands) {
    const result = spawnSync('git', args, { cwd: workspace, encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`Git fixture setup failed: git ${args.join(' ')}\n${result.stderr || result.stdout}`);
    }
  }
  return true;
}

export async function materializeProjectFixture(
  projectFixture: EvaluationProjectFixture,
  options: MaterializeFixtureOptions = {}
): Promise<MaterializedEvaluationWorkspace> {
  const fixture = parseProjectFixture(projectFixture);
  const root = path.resolve(options.root || tmpdir());
  await mkdir(root, { recursive: true });
  const workspace = await mkdtemp(path.join(root, `react-engine-eval-${fixture.id}-`));
  let cleaned = false;

  try {
    for (const [relativePath, content] of Object.entries(fixture.files)) {
      await writeWorkspaceFile(workspace, relativePath, content);
    }
    const gitInitialized = options.initializeGit === true
      ? initializeGitRepository(workspace, fixture)
      : false;
    if (fixture.dirtyChange) {
      await writeWorkspaceFile(workspace, fixture.dirtyChange.path, fixture.dirtyChange.content);
    }
    return {
      path: workspace,
      fingerprint: fingerprintProject(fixture),
      gitInitialized,
      cleanup: async () => {
        if (cleaned) return;
        const resolved = path.resolve(workspace);
        const expectedPrefix = `${root}${path.sep}react-engine-eval-`;
        if (!resolved.startsWith(expectedPrefix)) {
          throw new Error(`Refusing to remove workspace outside evaluation root: ${resolved}`);
        }
        await rm(resolved, { recursive: true, force: true });
        cleaned = true;
      },
    };
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}

function actionId(runId: string, index: number): string {
  return createEvidenceId(runId, 'action', index);
}

function evidenceIdFromReference(runId: string, reference: string): string {
  const [kind, index] = reference.split(':');
  return createEvidenceId(runId, kind, index);
}

export function createScriptedEvaluationRecord(input: {
  project: EvaluationProjectFixture;
  task: EvaluationTaskFixture;
  workspace: string;
  workspaceFingerprint: string;
  runtimeVersion: string;
  providerAdapter: string;
  randomSeed?: number;
  startedAt: number;
}): EvaluationRunRecord {
  const project = parseProjectFixture(input.project);
  const task = parseTaskFixture(input.task);
  const script = task.scriptedRun;
  const runId = `${task.id}-${input.randomSeed ?? 0}`;
  const successfulEvidenceByRequirement = new Map<string, string[]>();
  const addRequirementEvidence = (requirementIds: string[], id: string, successful: boolean) => {
    if (!successful) return;
    for (const requirementId of requirementIds) {
      const current = successfulEvidenceByRequirement.get(requirementId) || [];
      current.push(id);
      successfulEvidenceByRequirement.set(requirementId, current);
    }
  };

  const actions = script.actions.map((item, index) => ({
    id: actionId(runId, index),
    sequence: index,
    tool: item.tool,
    input: item.input,
    status: item.status,
    expectedEvidence: [],
    startedAt: input.startedAt + item.atMs,
    finishedAt: item.finishedAtMs === undefined ? undefined : input.startedAt + item.finishedAtMs,
  }));
  const observations = script.observations.map((item, index) => ({
    id: createEvidenceId(runId, 'observation', index),
    sequence: script.actions.length + index,
    actionId: item.actionIndex === undefined ? undefined : actionId(runId, item.actionIndex),
    kind: item.kind,
    success: item.success,
    data: item.data,
    timestamp: input.startedAt + item.atMs,
  }));
  const mutations = script.mutations.map((item, index) => {
    const id = createEvidenceId(runId, 'mutation', index);
    addRequirementEvidence(item.requirementIds, id, item.success);
    return {
      id,
      actionId: item.actionIndex === undefined ? undefined : actionId(runId, item.actionIndex),
      requirementIds: item.requirementIds,
      path: normalizeFixturePath(item.path),
      operation: item.operation,
      success: item.success,
      overlapsUserChange: item.overlapsUserChange,
      timestamp: input.startedAt + item.atMs,
    };
  });
  const verificationChecks = script.verificationChecks.map((item, index) => {
    const id = createEvidenceId(runId, 'verification', index);
    addRequirementEvidence(item.requirementIds, id, item.outcome === 'passed');
    return {
      id,
      requirementIds: item.requirementIds,
      actionId: item.actionIndex === undefined ? undefined : actionId(runId, item.actionIndex),
      name: item.name,
      outcome: item.outcome,
      summary: item.summary,
      timestamp: input.startedAt + item.atMs,
    };
  });
  const requirements = task.requirements.map((item) => {
    const evidenceIds = successfulEvidenceByRequirement.get(item.id) || [];
    const status = evidenceIds.length > 0
      ? 'satisfied' as const
      : script.status === 'running'
        ? 'pending' as const
        : script.status === 'blocked'
          ? 'blocked' as const
          : 'unsatisfied' as const;
    return { ...item, source: `fixture:${task.id}`, status, evidenceIds };
  });
  const finalClaims = script.finalClaims.map((item, index) => ({
    id: createEvidenceId(runId, 'claim', index),
    text: item.text,
    requirementIds: item.requirementIds,
    evidenceIds: item.evidenceRefs.map((reference) => evidenceIdFromReference(runId, reference)),
    support: item.support,
  }));
  const finishedAt = script.status === 'running' ? undefined : input.startedAt + script.durationMs;

  return parseEvaluationRunRecord({
    schemaVersion: 1,
    runId,
    fixture: {
      id: task.id,
      version: String(task.schemaVersion),
      workspaceFingerprint: input.workspaceFingerprint,
      runtimeVersion: input.runtimeVersion,
      providerAdapter: input.providerAdapter,
      randomSeed: input.randomSeed,
      projectFixtureId: project.id,
    },
    task: {
      id: createEvidenceId(runId, 'task', 0),
      request: task.request,
      kind: task.kind,
      workspace: input.workspace,
    },
    provider: { name: 'offline', model: input.providerAdapter },
    status: script.status,
    startedAt: input.startedAt,
    finishedAt,
    requirements,
    actions,
    observations,
    mutations,
    verificationChecks,
    finalClaims,
    metrics: {
      cost: script.cost,
      totalDurationMs: script.durationMs,
    },
    source: {
      kind: 'evaluation',
      lastEventSequence: actions.length + observations.length,
    },
  });
}

function countRepeatedActions(record: EvaluationRunRecord): number {
  const seen = new Set<string>();
  let repeated = 0;
  for (const action of record.actions) {
    const signature = `${action.tool}:${stableJson(action.input)}`;
    if (seen.has(signature)) repeated += 1;
    else seen.add(signature);
  }
  return repeated;
}

export function calculateEvaluationMetrics(
  record: EvaluationRunRecord,
  task: EvaluationTaskFixture
): EvaluationRunRecord['metrics'] {
  const successfulMutations = record.mutations.filter((item) => item.success);
  const unsatisfiedRequirements = record.requirements.filter((item) => item.status !== 'satisfied');
  const unsupportedClaims = record.finalClaims.filter((item) => item.support !== 'supported');
  const falseCompletion = record.status === 'completed' && (
    (task.expectations.requiresMutation && successfulMutations.length === 0) ||
    unsatisfiedRequirements.length > 0 ||
    unsupportedClaims.length > 0
  );
  const validActions = record.actions.filter((item) => item.status !== 'rejected').length;
  const passedRequirementIds = new Set(
    record.verificationChecks
      .filter((item) => item.outcome === 'passed')
      .flatMap((item) => item.requirementIds)
  );
  const verificationCoverage = record.requirements.length === 0
    ? 1
    : passedRequirementIds.size / record.requirements.length;
  const firstMutation = successfulMutations
    .map((item) => item.timestamp)
    .sort((left, right) => left - right)[0];
  const repeatedActions = countRepeatedActions(record);
  const taskSuccess = record.status === 'completed' &&
    !falseCompletion &&
    verificationCoverage >= task.expectations.minimumVerificationCoverage &&
    repeatedActions <= task.expectations.maximumRepeatedActions;

  return {
    ...record.metrics,
    taskSuccess,
    falseCompletion,
    validToolCallRate: record.actions.length === 0 ? 1 : validActions / record.actions.length,
    repeatedActions,
    ...deriveEvaluationOperatingMetrics(record),
    firstMutationLatencyMs: firstMutation === undefined ? undefined : firstMutation - record.startedAt,
    verificationCoverage,
  };
}

export function assessEvaluation(record: EvaluationRunRecord, task: EvaluationTaskFixture): EvaluationAssessment {
  const problems: string[] = [];
  if (record.status !== task.expectations.expectedStatus) {
    problems.push(`Expected status ${task.expectations.expectedStatus}, received ${record.status}.`);
  }
  if (record.metrics.falseCompletion !== task.expectations.expectedFalseCompletion) {
    problems.push(`Expected falseCompletion=${task.expectations.expectedFalseCompletion}, received ${record.metrics.falseCompletion}.`);
  }
  if ((record.metrics.verificationCoverage ?? 0) < task.expectations.minimumVerificationCoverage) {
    problems.push(`Verification coverage ${record.metrics.verificationCoverage ?? 0} is below ${task.expectations.minimumVerificationCoverage}.`);
  }
  if ((record.metrics.repeatedActions ?? 0) > task.expectations.maximumRepeatedActions) {
    problems.push(`Repeated actions ${record.metrics.repeatedActions} exceed ${task.expectations.maximumRepeatedActions}.`);
  }
  const changedFiles = new Set(record.mutations.filter((item) => item.success).map((item) => item.path));
  for (const expectedFile of task.expectations.expectedChangedFiles.map(normalizeFixturePath)) {
    if (!changedFiles.has(expectedFile)) problems.push(`Expected changed file is missing: ${expectedFile}.`);
  }
  if (task.expectations.requiresMalformedActionRecovery) {
    const rejected = record.actions.some((item) => item.status === 'rejected');
    const recovered = record.actions.some((item) => item.status === 'recovery');
    if (!rejected || !recovered) problems.push('Malformed-action recovery evidence is incomplete.');
  }
  return { passed: problems.length === 0, problems };
}

export async function runScriptedEvaluation(
  projectFixture: EvaluationProjectFixture,
  taskFixture: EvaluationTaskFixture,
  options: RunEvaluationOptions = {}
): Promise<EvaluationRunOutcome> {
  const project = parseProjectFixture(projectFixture);
  const task = parseTaskFixture(taskFixture);
  if (task.projectFixtureId !== project.id) {
    throw new Error(`Task ${task.id} requires project ${task.projectFixtureId}, received ${project.id}.`);
  }
  const workspace = await materializeProjectFixture(project, { initializeGit: options.initializeGit });
  try {
    const baseRecord = createScriptedEvaluationRecord({
      project,
      task,
      workspace: workspace.path,
      workspaceFingerprint: workspace.fingerprint,
      runtimeVersion: options.runtimeVersion || 'development',
      providerAdapter: options.providerAdapter || 'scripted-offline-v1',
      randomSeed: options.randomSeed,
      startedAt: options.startedAt ?? Date.now(),
    });
    const record = parseEvaluationRunRecord({
      ...baseRecord,
      metrics: calculateEvaluationMetrics(baseRecord, task),
    });
    const assessment = assessEvaluation(record, task);
    let resultPath: string | undefined;
    if (options.outputDirectory) {
      const outputDirectory = path.resolve(options.outputDirectory);
      await mkdir(outputDirectory, { recursive: true });
      resultPath = path.join(outputDirectory, `${task.id}-${record.runId}.json`);
      await writeFile(resultPath, `${serializeEvaluationRunRecord(record)}\n`, 'utf8');
    }
    return { record, assessment, resultPath };
  } finally {
    if (!options.preserveWorkspace) await workspace.cleanup();
  }
}

export function createEvaluationSummary(outcomes: EvaluationRunOutcome[], generatedAt = Date.now()): EvaluationSummary {
  const average = (values: number[]): number | undefined => values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : undefined;
  return {
    schemaVersion: 1,
    generatedAt,
    totalRuns: outcomes.length,
    passedRuns: outcomes.filter((item) => item.assessment.passed).length,
    failedRuns: outcomes.filter((item) => !item.assessment.passed).length,
    falseCompletions: outcomes.filter((item) => item.record.metrics.falseCompletion).length,
    averageValidToolCallRate: average(outcomes.flatMap((item) => item.record.metrics.validToolCallRate === undefined ? [] : [item.record.metrics.validToolCallRate])),
    averageVerificationCoverage: average(outcomes.flatMap((item) => item.record.metrics.verificationCoverage === undefined ? [] : [item.record.metrics.verificationCoverage])),
    averageFirstUsefulActionLatencyMs: average(outcomes.flatMap((item) => item.record.metrics.firstUsefulActionLatencyMs === undefined ? [] : [item.record.metrics.firstUsefulActionLatencyMs])),
    averageChildCompletionRate: average(outcomes.flatMap((item) => item.record.metrics.childCompletionRate === undefined ? [] : [item.record.metrics.childCompletionRate])),
    totalDuplicateActionCount: outcomes.reduce((sum, item) => sum + (item.record.metrics.duplicateActionCount || 0), 0),
    totalUnknownOutcomeCount: outcomes.reduce((sum, item) => sum + (item.record.metrics.unknownOutcomeCount || 0), 0),
    totalRecoveryCount: outcomes.reduce((sum, item) => sum + (item.record.metrics.recoveryCount || 0), 0),
    totalCost: outcomes.reduce((sum, item) => sum + (item.record.metrics.cost || 0), 0),
    totalDurationMs: outcomes.reduce((sum, item) => sum + item.record.metrics.totalDurationMs, 0),
    runs: outcomes.map((item) => ({
      runId: item.record.runId,
      fixtureId: item.record.fixture.id,
      status: item.record.status,
      passed: item.assessment.passed,
      problems: item.assessment.problems,
    })),
  };
}

export async function writeEvaluationSummary(
  outcomes: EvaluationRunOutcome[],
  outputDirectory: string,
  generatedAt = Date.now()
): Promise<string> {
  const directory = path.resolve(outputDirectory);
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, 'summary.json');
  await writeFile(target, `${JSON.stringify(createEvaluationSummary(outcomes, generatedAt), null, 2)}\n`, 'utf8');
  return target;
}

export async function loadProjectFixture(filePath: string): Promise<EvaluationProjectFixture> {
  return parseProjectFixture(JSON.parse(await readFile(filePath, 'utf8')));
}

export async function loadTaskFixture(filePath: string): Promise<EvaluationTaskFixture> {
  return parseTaskFixture(JSON.parse(await readFile(filePath, 'utf8')));
}
