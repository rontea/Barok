/**
 * Full-Stack Task Specification and Classification System
 * Defines complete task contract including user request, surfaces, ownership, and verification
 */

/**
 * Task classification type
 */
export type TaskClassification =
  | 'bug_fix'
  | 'feature'
  | 'refactor'
  | 'test_only'
  | 'docs_only'
  | 'infrastructure'
  | 'generated_app'
  | 'investigation';

/**
 * Development layer touched by the task
 */
export type DevelopmentLayer =
  | 'frontend'
  | 'backend'
  | 'data'
  | 'config'
  | 'tests'
  | 'docs'
  | 'cli'
  | 'vscode_extension';

/**
 * File ownership assignment for parallel execution
 */
export interface FileOwnershipPlan {
  path: string; // File path pattern
  owner: string; // Agent role that owns this file
  readOnly?: boolean; // If true, other agents can only read
  collaborative?: string[]; // Other agents that collaborate on this file
}

/**
 * Task dependency constraint
 */
export interface TaskDependency {
  dependsOn: string; // Task ID that must complete first
  reason: string; // Why this dependency exists
  type: 'hard' | 'soft'; // hard: must complete; soft: recommended
}

/**
 * Acceptance criterion for task completion
 */
export interface AcceptanceCriterion {
  description: string;
  verifiable: boolean;
  required: boolean;
}

/**
 * Verification plan for task
 */
export interface VerificationPlan {
  criteria: AcceptanceCriterion[];
  commands: string[]; // Commands to run for verification (build, test, lint, etc.)
  manualReview: boolean; // Needs manual review beyond automated checks
}

/**
 * Complete full-stack task specification
 */
export interface FullStackTaskSpec {
  // Task identity
  id: string; // Unique task ID
  title: string; // Human-readable title
  description: string; // Detailed description of the work

  // User request
  userRequest: string; // Original user request
  targetSurfaces: string[]; // UI surfaces affected (e.g., 'AppCreator', 'VerificationPanel')

  // Scope definition
  affectedFiles: string[]; // Glob patterns of files that will be edited
  acceptanceCriteria: AcceptanceCriterion[];
  verificationPlan: VerificationPlan;

  // Work classification
  classification: TaskClassification;
  touchedLayers: DevelopmentLayer[];

  // Ownership and parallelization
  ownershipPlan: FileOwnershipPlan[];
  canRunInParallel: boolean; // Can this run alongside other tasks?
  parallelCompatibleWith: string[]; // Task IDs this can run with
  dependencies: TaskDependency[];

  // Implementation coordination
  implementationOrder: string[]; // Agent roles in order of implementation
  verificationTasks: string[]; // Verification task IDs that must follow
  sequentialSteps: Array<{
    step: number;
    agent: string;
    action: string;
    outputs: string[];
  }>; // For sequential tasks, explicit steps

  // Metadata
  estimatedComplexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'expert';
  requiresManualReview: boolean;
  createdAt: number; // Unix timestamp
}

/**
 * Classifies task by keywords and patterns in request
 */
export function classifyTask(description: string): TaskClassification {
  const lower = description.toLowerCase();

  // Check test_only first (before bug_fix, since "test" might contain "issue")
  if (
    lower.includes('test') &&
    !lower.includes('bug') &&
    (lower.includes('add') || lower.includes('write') || lower.includes('improve') || lower.includes('coverage'))
  ) {
    return 'test_only';
  }

  if (
    lower.includes('documentation') ||
    lower.includes('readme') ||
    lower.includes('changelog') ||
    (lower.includes('doc') && !lower.includes('api'))
  ) {
    return 'docs_only';
  }

  // A browser/UI implementation often says "build" or "generate". Those
  // words must not be mistaken for infrastructure work when the request also
  // identifies frontend technologies or a web experience.
  const frontendSignals = /\b(html|css|javascript|vanilla|browser|web\s*app|website|web\s*game|frontend|front[- ]end|ui|dom|canvas|simulation)\b/.test(lower);
  const implementationSignals = /\b(add|build|create|develop|generate|implement|make|write|design)\b/.test(lower);
  const infrastructureSignals = /\b(build\s+configuration|build\s+pipeline|ci\/cd|compiler|toolchain|webpack|vite\s+config|eslint|prettier|typescript\s+config|docker|deployment|deploy)\b/.test(lower);
  if (frontendSignals && implementationSignals && !infrastructureSignals) {
    return /\b(?:browser\s*app|web\s*app|website|web\s*game|simulation|application)\b/.test(lower)
      ? 'generated_app'
      : 'feature';
  }

  if (
    lower.includes('config') ||
    lower.includes('setup') ||
    lower.includes('infrastructure') ||
    lower.includes('ci/cd') ||
    lower.includes('build') ||
    lower.includes('configure')
  ) {
    return 'infrastructure';
  }

  if (
    lower.includes('fix') ||
    lower.includes('bug') ||
    lower.includes('broken')
  ) {
    return 'bug_fix';
  }

  if (
    lower.includes('add') ||
    lower.includes('implement') ||
    lower.includes('create') ||
    lower.includes('new feature')
  ) {
    return 'feature';
  }

  if (
    lower.includes('refactor') ||
    lower.includes('reorganize') ||
    lower.includes('restructure') ||
    lower.includes('optimize')
  ) {
    return 'refactor';
  }

  if (lower.includes('app') && lower.includes('generate')) {
    return 'generated_app';
  }

  return 'investigation';
}

/**
 * Detects touched layers from file paths
 */
export function detectTouchedLayers(affectedFiles: string[]): DevelopmentLayer[] {
  const layers = new Set<DevelopmentLayer>();

  for (const file of affectedFiles) {
    if (file.includes('ui/') || file.includes('components/')) {
      layers.add('frontend');
    }
    if (file.includes('src/') && !file.includes('ui/')) {
      layers.add('backend');
    }
    if (
      file.includes('src/data/') ||
      file.includes('src/types/') ||
      file.includes('migrations/') ||
      file.includes('seeds/')
    ) {
      layers.add('data');
    }
    if (
      file.includes('config') ||
      file.includes('tsconfig') ||
      file.includes('.json')
    ) {
      layers.add('config');
    }
    if (
      file.includes('.test.') ||
      file.includes('.spec.') ||
      file.includes('__tests__')
    ) {
      layers.add('tests');
    }
    if (file.includes('docs/') || file.includes('README') || file.includes('CHANGELOG')) {
      layers.add('docs');
    }
    if (file.includes('src/cli/')) {
      layers.add('cli');
    }
    if (file.includes('vscode-extension/')) {
      layers.add('vscode_extension');
    }
  }

  return Array.from(layers);
}

/**
 * Detects if files can run in parallel (no ownership conflicts)
 */
export function canRunInParallel(ownershipPlans: FileOwnershipPlan[][]): boolean {
  // If any file is owned by multiple agents, cannot run in parallel
  const allPaths = ownershipPlans.flat();
  const pathOwners = new Map<string, Set<string>>();

  for (const plan of allPaths) {
    const owners = pathOwners.get(plan.path) || new Set();
    owners.add(plan.owner);
    pathOwners.set(plan.path, owners);
  }

  // Check for conflicts
  for (const owners of pathOwners.values()) {
    if (owners.size > 1) {
      return false;
    }
  }

  return true;
}

/**
 * Detects parallel compatibility between tasks
 */
export function detectParallelCompatibility(
  taskA: FullStackTaskSpec,
  taskB: FullStackTaskSpec
): boolean {
  // Same owner pattern - cannot run together
  const ownerA = new Set(taskA.ownershipPlan.map((o) => o.owner));
  const ownerB = new Set(taskB.ownershipPlan.map((o) => o.owner));

  for (const owner of ownerA) {
    if (ownerB.has(owner)) {
      return false;
    }
  }

  // Check if they touch the same files
  const filesA = new Set(taskA.affectedFiles);
  for (const file of taskB.affectedFiles) {
    if (filesA.has(file)) {
      return false;
    }
  }

  return true;
}

/**
 * Orders tasks by implementation sequence
 */
export function orderTasksByDependency(tasks: FullStackTaskSpec[]): FullStackTaskSpec[] {
  const sorted: FullStackTaskSpec[] = [];
  const visited = new Set<string>();

  function visit(task: FullStackTaskSpec): void {
    if (visited.has(task.id)) return;
    visited.add(task.id);

    // Visit dependencies first
    for (const dep of task.dependencies) {
      const depTask = tasks.find((t) => t.id === dep.dependsOn);
      if (depTask) {
        visit(depTask);
      }
    }

    sorted.push(task);
  }

  for (const task of tasks) {
    visit(task);
  }

  return sorted;
}

/**
 * Estimates task complexity from classification and affected files
 */
export function estimateComplexity(
  classification: TaskClassification,
  affectedFiles: string[],
  layers: DevelopmentLayer[]
): 'trivial' | 'simple' | 'moderate' | 'complex' | 'expert' {
  let complexity = 0;

  // Classification base complexity
  const classificationComplexity: Record<TaskClassification, number> = {
    investigation: 1,
    docs_only: 1,
    bug_fix: 2,
    test_only: 2,
    refactor: 3,
    feature: 3,
    infrastructure: 4,
    generated_app: 5,
  };
  complexity += classificationComplexity[classification];

  // File count
  complexity += Math.min(affectedFiles.length, 5);

  // Layer count
  complexity += layers.length;

  if (complexity <= 2) return 'trivial';
  if (complexity <= 4) return 'simple';
  if (complexity <= 7) return 'moderate';
  if (complexity <= 10) return 'complex';
  return 'expert';
}

/**
 * Creates a basic full-stack task spec from user request
 */
export function createTaskSpec(
  title: string,
  userRequest: string,
  affectedFiles: string[]
): FullStackTaskSpec {
  const classification = classifyTask(userRequest);
  const layers = detectTouchedLayers(affectedFiles);
  const complexity = estimateComplexity(
    classification,
    affectedFiles,
    layers
  );

  return {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    title,
    description: userRequest,
    userRequest,
    targetSurfaces: [],
    affectedFiles,
    acceptanceCriteria: [
      {
        description: 'Implementation is complete',
        verifiable: true,
        required: true,
      },
    ],
    verificationPlan: {
      criteria: [],
      commands: ['npm run build', 'npm run test:unit'],
      manualReview: complexity === 'expert',
    },
    classification,
    touchedLayers: layers,
    ownershipPlan: [],
    canRunInParallel: true,
    parallelCompatibleWith: [],
    dependencies: [],
    implementationOrder: [],
    verificationTasks: [],
    sequentialSteps: [],
    estimatedComplexity: complexity,
    requiresManualReview: complexity === 'expert' || classification === 'bug_fix',
    createdAt: Date.now(),
  };
}
