/**
 * Phase 3 - Full-Stack Work Plan Contract
 * Orchestrates task planning with Phase 2 repo-wide context
 * Integrates module responsibilities, dependency graphs, dirty tree, and overwrite prevention
 */

import type { ModuleResponsibility } from './moduleResponsibilities.js';
import type { DependencySignal } from './dependencyGraph.js';
import type { DirtyTreeState } from './dirtyTreeTracker.js';
import type { OverwriteCheckResult, PlannedChange } from './overwritePreventionPlan.js';
import type { RepoMapData } from '../orchestration/repoMapEndpoint.js';

// Re-export types from Phase 2 for integration
export type { ModuleResponsibility };
export type { DependencySignal };
export type { DirtyTreeState };
export type { OverwriteCheckResult };

/**
 * Execution layer classification
 */
export type ExecutionLayer =
  | 'frontend'
  | 'backend'
  | 'data'
  | 'config'
  | 'tests'
  | 'docs'
  | 'cli'
  | 'vscode-extension';

/**
 * Task classification
 */
export type TaskClassification =
  | 'bug_fix'
  | 'feature'
  | 'new_feature'
  | 'new_instance'
  | 'continuation'
  | 'refactor'
  | 'test_only'
  | 'docs_only'
  | 'infrastructure'
  | 'generated_app'
  | 'investigation';

/**
 * Task complexity estimation
 */
export type TaskComplexity = 'trivial' | 'simple' | 'moderate' | 'complex' | 'expert';

/**
 * Execution strategy for task
 */
export type ExecutionStrategy = 'sequential' | 'parallel' | 'mixed';

/**
 * File ownership entry
 */
export interface FileOwnership {
  file: string;
  owner: string; // Agent role: 'frontend', 'backend', 'data', 'test', 'reviewer', 'documentation'
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

/**
 * Dependency ordering for sequential tasks
 */
export interface TaskDependency {
  task: string;
  dependsOn: string[]; // Task IDs
  reason: string;
}

/**
 * Acceptance criteria for task completion
 */
export interface AcceptanceCriterion {
  id: string;
  description: string;
  verification: 'manual' | 'automated';
  required: boolean; // If false, this is a nice-to-have
  layer?: ExecutionLayer; // Which layer this applies to
}

/**
 * Verification plan for task
 */
export interface VerificationPlan {
  id: string;
  type: 'unit-test' | 'integration-test' | 'e2e-test' | 'manual-review' | 'smoke-test';
  description: string;
  affectedLayers: ExecutionLayer[];
  commands?: string[]; // Commands to run for verification
  expectedOutcome: string;
}

/**
 * Full-stack work plan specification with Phase 2 integration
 */
export interface FullStackWorkPlan {
  // Request metadata
  id: string;
  userRequest: string;
  createdAt: number;
  estimatedComplexity: TaskComplexity;

  // Classification
  classification: TaskClassification;
  touchedLayers: ExecutionLayer[];

  // Target surfaces
  targetSurfaces: string[]; // UI components, API routes, data models, etc.
  affectedFiles: PlannedChange[]; // Files that will be changed
  acceptanceCriteria: AcceptanceCriterion[];

  // Ownership and execution plan
  fileOwnership: FileOwnership[];
  executionStrategy: ExecutionStrategy;
  taskDependencies: TaskDependency[];
  canRunParallel: boolean;
  parallelGroups?: string[][]; // Groups of independent tasks

  // Verification
  verificationPlan: VerificationPlan[];
  verificationTasks: string[]; // Task IDs for verification phase

  // Phase 2 Integration
  moduleContext: ModuleResponsibility[]; // Affected modules
  dependencySignals: DependencySignal[]; // Dependency impact
  dirtyTreeWarnings?: string[]; // Warnings from dirty tree
  overwriteCheckResult?: OverwriteCheckResult; // Overwrite prevention analysis

  // Safety and risk
  riskFactors: string[];
  safetyScore: number; // 0-100
  requiresApproval: boolean;
  approvalReason?: string;
}

/**
 * Task planning context combining Phase 2 data
 */
export interface PlanningContext {
  modules: ModuleResponsibility[];
  signals: DependencySignal[];
  dirtyTree: DirtyTreeState;
  repoMap?: RepoMapData;
}

/**
 * Classifies a task based on user request
 */
export function classifyTask(userRequest: string): TaskClassification {
  const request = userRequest.toLowerCase();

  // Docs-only patterns (check before 'add' to avoid conflicts)
  if (
    request.includes('documentation') ||
    request.includes('readme') ||
    request.includes('docs') ||
    request.includes('comment')
  ) {
    return 'docs_only';
  }

  // Test-only patterns (check before 'add' to avoid conflicts)
  if (
    request.includes('test') &&
    !request.includes('integration') &&
    !request.includes('e2e')
  ) {
    return 'test_only';
  }

  // Bug fix patterns
  if (
    request.includes('fix') ||
    request.includes('bug') ||
    request.includes('error') ||
    request.includes('broken')
  ) {
    return 'bug_fix';
  }

  if (
    request.includes('continue') ||
    request.includes('resume') ||
    request.includes('same issue') ||
    request.includes('again') ||
    request.includes('that broke')
  ) {
    return 'continuation';
  }

  if (
    request.includes('new instance') ||
    request.includes('new agent instance') ||
    request.includes('start over') ||
    request.includes('fresh instance')
  ) {
    return 'new_instance';
  }

  // Feature patterns
  if (
    request.includes('add') ||
    request.includes('feature') ||
    request.includes('implement') ||
    request.includes('create')
  ) {
    return 'new_feature';
  }

  // Refactor patterns
  if (
    request.includes('refactor') ||
    request.includes('restructure') ||
    request.includes('reorganize') ||
    request.includes('cleanup')
  ) {
    return 'refactor';
  }

  // Infrastructure patterns (check before 'update' to avoid conflicts)
  if (
    request.includes('ci') ||
    request.includes('deploy') ||
    request.includes('config') ||
    request.includes('pipeline') ||
    request.includes('migrate') ||
    request.includes('oauth') ||
    request.includes('auth provider')
  ) {
    return 'infrastructure';
  }

  // Generated app patterns
  if (request.includes('generate') && request.includes('app')) {
    return 'generated_app';
  }

  // Investigation/analysis
  if (
    request.includes('investigate') ||
    request.includes('analyze') ||
    request.includes('explore') ||
    request.includes('research') ||
    request.includes('review') ||
    request.includes('audit') ||
    request.includes('look into') ||
    request.includes('inspect')
  ) {
    return 'investigation';
  }

  return 'new_feature'; // Default
}

/**
 * Detects touched layers based on affected files and classification
 */
export function detectTouchedLayers(
  affectedFiles: string[],
  classification: TaskClassification
): ExecutionLayer[] {
  const layers = new Set<ExecutionLayer>();

  // Check file patterns
  for (const file of affectedFiles) {
    if (file.startsWith('ui/') || file.includes('component') || file.includes('tsx')) {
      layers.add('frontend');
    }
    if (file.startsWith('src/') && !file.startsWith('src/data')) {
      layers.add('backend');
    }
    if (file.startsWith('src/data/')) {
      layers.add('data');
    }
    if (file.includes('test') || file.includes('spec')) {
      layers.add('tests');
    }
    if (file.startsWith('docs/')) {
      layers.add('docs');
    }
    if (file.includes('config') || file.endsWith('.json')) {
      layers.add('config');
    }
    if (file.startsWith('cli/') || file.includes('command')) {
      layers.add('cli');
    }
    if (file.startsWith('vscode-extension/')) {
      layers.add('vscode-extension');
    }
  }

  // Add layers based on classification
  if (classification === 'test_only') {
    layers.add('tests');
  }
  if (classification === 'docs_only') {
    layers.add('docs');
  }
  if (classification === 'infrastructure') {
    layers.add('config');
  }

  return Array.from(layers);
}

/**
 * Assigns file ownership based on file paths and agent roles
 */
export function assignFileOwnership(
  files: string[],
  modules: ModuleResponsibility[]
): FileOwnership[] {
  const ownership: FileOwnership[] = [];
  const layerToAgent: Record<ExecutionLayer, string> = {
    frontend: 'frontend',
    backend: 'backend',
    data: 'data',
    tests: 'test',
    docs: 'documentation',
    config: 'reviewer',
    cli: 'backend',
    'vscode-extension': 'backend',
  };

  for (const file of files) {
    // Find module containing this file
    const module = modules.find((m) => file.startsWith(m.path));
    if (module) {
      const layer = module.layer as ExecutionLayer;
      const owner = layerToAgent[layer] || 'reviewer';

      ownership.push({
        file,
        owner,
        confidence: 'high',
        reason: `File in ${module.name} module (${layer} layer)`,
      });
    } else {
      // Default based on path patterns
      let owner = 'reviewer';
      let confidence: 'high' | 'medium' | 'low' = 'medium';

      if (file.startsWith('ui/')) {
        owner = 'frontend';
      } else if (file.startsWith('src/')) {
        owner = 'backend';
      } else if (file.startsWith('tests/')) {
        owner = 'test';
      } else if (file.startsWith('docs/')) {
        owner = 'documentation';
      } else if (file.includes('config') || file.endsWith('json')) {
        confidence = 'low';
      }

      ownership.push({
        file,
        owner,
        confidence,
        reason: `Inferred from file path: ${file}`,
      });
    }
  }

  return ownership;
}

/**
 * Detects if tasks can run in parallel based on file ownership
 */
export function canTasksRunParallel(ownership: FileOwnership[]): boolean {
  if (ownership.length === 0) {
    return false;
  }

  const files = new Set<string>();
  for (const item of ownership) {
    if (files.has(item.file)) {
      return false;
    }
    files.add(item.file);
  }

  const owners = new Set(ownership.map((o) => o.owner));
  return owners.size > 1;
}

function hasDuplicateFiles(files: string[]): boolean {
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file)) return true;
    seen.add(file);
  }
  return false;
}

function hasUnclearRisk(
  classification: TaskClassification,
  affectedFiles: string[],
  ownership: FileOwnership[],
  context: PlanningContext,
  overwriteCheck?: OverwriteCheckResult
): boolean {
  if (classification === 'continuation' || classification === 'new_instance') return true;
  if (classification === 'investigation') return true;
  if (affectedFiles.length === 0) return true;
  if (hasDuplicateFiles(affectedFiles)) return true;
  if (ownership.some((item) => item.confidence === 'low')) return true;
  if (context.dirtyTree.isDirty) return true;
  if (overwriteCheck?.hasConflicts) return true;
  if (overwriteCheck?.requiresApproval) return true;
  return false;
}

function createSequentialDependencies(ownership: FileOwnership[], reason: string): TaskDependency[] {
  return ownership.slice(1).map((item, index) => ({
    task: item.file,
    dependsOn: [ownership[index].file],
    reason,
  }));
}

/**
 * Groups independent tasks for parallel execution
 */
export function groupTasksForParallel(ownership: FileOwnership[]): string[][] {
  const groups: Map<string, string[]> = new Map();

  for (const o of ownership) {
    if (!groups.has(o.owner)) {
      groups.set(o.owner, []);
    }
    groups.get(o.owner)!.push(o.file);
  }

  return Array.from(groups.values());
}

/**
 * Estimates task complexity
 */
export function estimateComplexity(
  affectedFiles: string[],
  touchedLayers: ExecutionLayer[],
  classification: TaskClassification
): TaskComplexity {
  let score = 0;

  // File count impact
  if (affectedFiles.length === 0) score += 1;
  else if (affectedFiles.length === 1) score += 1;
  else if (affectedFiles.length <= 3) score += 2;
  else if (affectedFiles.length <= 5) score += 3;
  else score += 4;

  // Layer count impact (but not for trivial tasks)
  if (affectedFiles.length > 1) {
    score += touchedLayers.length;
  }

  // Classification impact
  const classComplexity: Record<TaskClassification, number> = {
    bug_fix: 2,
    feature: 4,
    new_feature: 4,
    new_instance: 3,
    continuation: 2,
    refactor: 3,
    test_only: 0,
    docs_only: 0,
    infrastructure: 3,
    generated_app: 4,
    investigation: 2,
  };
  score += classComplexity[classification] || 2;

  // Map score to complexity
  if (score <= 1) return 'trivial';
  if (score <= 3) return 'simple';
  if (score <= 6) return 'moderate';
  if (score <= 9) return 'complex';
  return 'expert';
}

/**
 * Creates a full-stack work plan from user request
 */
export function createWorkPlan(
  userRequest: string,
  affectedFiles: string[],
  context: PlanningContext,
  overwriteCheck?: OverwriteCheckResult
): FullStackWorkPlan {
  const classification = classifyTask(userRequest);
  const touchedLayers = detectTouchedLayers(affectedFiles, classification);
  const fileOwnership = assignFileOwnership(affectedFiles, context.modules);
  const complexity = estimateComplexity(affectedFiles, touchedLayers, classification);
  const unclearRisk = hasUnclearRisk(classification, affectedFiles, fileOwnership, context, overwriteCheck);
  const canParallel = !unclearRisk && canTasksRunParallel(fileOwnership);
  const parallelGroups = canParallel ? groupTasksForParallel(fileOwnership) : undefined;

  // Filter relevant modules
  const relevantModules = context.modules.filter((m) =>
    affectedFiles.some((f) => f.startsWith(m.path))
  );

  // Filter relevant signals
  const relevantSignals = context.signals.filter(
    (s) =>
      affectedFiles.some((f) => s.source.includes(f) || s.target.includes(f))
  );

  // Create planned changes
  const plannedChanges: PlannedChange[] = affectedFiles.map((f) => ({
    file: f,
    type: classification === 'docs_only' ? 'modify' : 'modify', // Simplified
    description: `${classification}: ${userRequest.substring(0, 50)}`,
  }));

  // Create acceptance criteria
  const acceptanceCriteria: AcceptanceCriterion[] = [
    {
      id: 'request-satisfaction',
      description: `User request satisfied: "${userRequest}"`,
      verification: 'manual',
      required: true,
    },
    {
      id: 'no-regressions',
      description: 'No new test failures introduced',
      verification: 'automated',
      required: true,
    },
    {
      id: 'layer-specific',
      description: 'All touched layers validated',
      verification: 'automated',
      required: true,
      layer: touchedLayers[0],
    },
  ];

  // Create verification plan
  const verificationPlan: VerificationPlan[] = [];

  if (touchedLayers.includes('frontend')) {
    verificationPlan.push({
      id: 'frontend-build',
      type: 'smoke-test',
      description: 'Frontend builds without errors',
      affectedLayers: ['frontend'],
      commands: ['npm run build'],
      expectedOutcome: 'Build succeeds',
    });
  }

  if (touchedLayers.includes('backend')) {
    verificationPlan.push({
      id: 'backend-types',
      type: 'smoke-test',
      description: 'Backend TypeScript compiles',
      affectedLayers: ['backend'],
      commands: ['npm run build'],
      expectedOutcome: 'No type errors',
    });
  }

  verificationPlan.push({
    id: 'tests',
    type: 'unit-test',
    description: 'All tests passing',
    affectedLayers: touchedLayers,
    commands: ['npm run test:unit'],
    expectedOutcome: '100% tests passing',
  });

  // Assess risks
  const riskFactors: string[] = [];
  if (overwriteCheck?.hasConflicts) {
    riskFactors.push('Conflicts with dirty files');
  }
  if (unclearRisk) {
    riskFactors.push('Unclear risk requires sequential execution');
  }
  if (hasDuplicateFiles(affectedFiles)) {
    riskFactors.push('Multiple planned tasks touch the same file');
  }
  if (fileOwnership.some((item) => item.confidence === 'low')) {
    riskFactors.push('Low-confidence file ownership');
  }
  if (affectedFiles.length > 10) {
    riskFactors.push('Large number of files affected');
  }
  if (touchedLayers.length > 3) {
    riskFactors.push('Multiple layers affected');
  }

  // Calculate safety score
  let safetyScore = 100;
  if (overwriteCheck?.hasConflicts) safetyScore -= overwriteCheck.conflicts.length * 10;
  if (unclearRisk) safetyScore -= 10;
  if (hasDuplicateFiles(affectedFiles)) safetyScore -= 15;
  if (fileOwnership.some((item) => item.confidence === 'low')) safetyScore -= 10;
  if (affectedFiles.length > 10) safetyScore -= 15;
  if (touchedLayers.length > 3) safetyScore -= 10;
  safetyScore = Math.max(0, Math.min(100, safetyScore));

  const sequentialDependencies = !canParallel && fileOwnership.length > 1
    ? createSequentialDependencies(
        fileOwnership,
        unclearRisk
          ? 'Sequential execution required because task risk or ownership is unclear'
          : 'Sequential execution required because work is not independently parallelizable'
      )
    : [];

  return {
    id: `plan-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    userRequest,
    createdAt: Date.now(),
    estimatedComplexity: complexity,

    classification,
    touchedLayers,

    targetSurfaces: affectedFiles.slice(0, 5).map((f) => f.split('/').pop() || f),
    affectedFiles: plannedChanges,
    acceptanceCriteria,

    fileOwnership,
    executionStrategy: canParallel ? 'parallel' : 'sequential',
    taskDependencies: sequentialDependencies,
    canRunParallel: canParallel,
    parallelGroups,

    verificationPlan,
    verificationTasks: [`verify-${Date.now()}`],

    moduleContext: relevantModules,
    dependencySignals: relevantSignals,
    dirtyTreeWarnings: context.dirtyTree.isDirty
      ? [
          `⚠️  Working tree has ${context.dirtyTree.totalChanges} uncommitted changes`,
          `  Modified: ${context.dirtyTree.modifiedCount}`,
          `  Added: ${context.dirtyTree.addedCount}`,
        ]
      : undefined,
    overwriteCheckResult: overwriteCheck,

    riskFactors,
    safetyScore,
    requiresApproval: safetyScore < 80 || (overwriteCheck?.requiresApproval ?? false),
    approvalReason:
      safetyScore < 80
        ? `Safety score below 80% (current: ${safetyScore}%)`
        : overwriteCheck?.approvalReason,
  };
}

/**
 * Validates work plan for completeness
 */
export function validateWorkPlan(plan: FullStackWorkPlan): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!plan.userRequest || plan.userRequest.trim().length === 0) {
    errors.push('User request is required');
  }

  if (plan.affectedFiles.length === 0) {
    if (plan.classification !== 'investigation') {
      errors.push('No affected files specified');
    }
  }

  if (plan.acceptanceCriteria.length === 0) {
    errors.push('No acceptance criteria defined');
  }

  if (plan.verificationPlan.length === 0) {
    errors.push('No verification plan defined');
  }

  if (plan.touchedLayers.length === 0) {
    if (plan.classification !== 'investigation') {
      errors.push('No touched layers identified');
    }
  }

  if (plan.fileOwnership.length === 0) {
    if (plan.classification !== 'investigation') {
      errors.push('No file ownership assigned');
    }
  }

  // Ensure all affected files have ownership
  const unownedFiles = plan.affectedFiles
    .map((f) => f.file)
    .filter((f) => !plan.fileOwnership.some((o) => o.file === f));

  if (unownedFiles.length > 0) {
    errors.push(`Files without ownership: ${unownedFiles.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Generates a summary of the work plan for display
 */
export function summarizeWorkPlan(plan: FullStackWorkPlan): string[] {
  const lines: string[] = [];

  lines.push('╔════════════════════════════════════════════════════════════╗');
  lines.push('║              FULL-STACK WORK PLAN SUMMARY                  ║');
  lines.push('╚════════════════════════════════════════════════════════════╝');
  lines.push('');

  // Request
  lines.push(`📋 Request: ${plan.userRequest}`);
  lines.push('');

  // Classification
  lines.push(`📊 Classification: ${plan.classification}`);
  lines.push(`   Complexity: ${plan.estimatedComplexity}`);
  lines.push('');

  // Scope
  lines.push(`📁 Scope:`);
  lines.push(`   Files: ${plan.affectedFiles.length}`);
  lines.push(`   Layers: ${plan.touchedLayers.join(', ')}`);
  lines.push(`   Modules: ${plan.moduleContext.length}`);
  lines.push('');

  // Execution
  lines.push(`⚙️  Execution:`);
  lines.push(`   Strategy: ${plan.executionStrategy}`);
  lines.push(`   Parallel: ${plan.canRunParallel ? 'Yes' : 'No'}`);
  if (plan.parallelGroups) {
    lines.push(`   Groups: ${plan.parallelGroups.length}`);
  }
  lines.push('');

  // Verification
  lines.push(`✅ Verification: ${plan.verificationPlan.length} checks`);
  for (const v of plan.verificationPlan) {
    lines.push(`   • ${v.type}: ${v.description}`);
  }
  lines.push('');

  // Safety
  lines.push(`🔐 Safety:`);
  lines.push(`   Score: ${plan.safetyScore}/100`);
  if (plan.dirtyTreeWarnings && plan.dirtyTreeWarnings.length > 0) {
    lines.push(`   ⚠️  Warnings:`);
    for (const w of plan.dirtyTreeWarnings) {
      lines.push(`      ${w}`);
    }
  }
  if (plan.riskFactors.length > 0) {
    lines.push(`   ⚠️  Risks:`);
    for (const r of plan.riskFactors) {
      lines.push(`      • ${r}`);
    }
  }
  lines.push('');

  // Approval
  if (plan.requiresApproval) {
    lines.push(`🔐 Approval Required: ${plan.approvalReason}`);
  } else {
    lines.push(`✅ Ready to Execute`);
  }
  lines.push('');

  return lines;
}
