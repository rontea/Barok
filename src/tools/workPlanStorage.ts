/**
 * Phase 7.1 Task 6: Work Plan Storage & Persistence
 * Store, retrieve, and manage work plan history with resume/replay capability
 */

import type { FullStackWorkPlan } from '../repo/workPlanOrchestrator.js';

/**
 * Status of a work plan execution
 */
export type WorkPlanStatus = 'draft' | 'approved' | 'executing' | 'completed' | 'failed' | 'paused';

/**
 * Stored work plan with metadata and execution history
 */
export interface StoredWorkPlan {
  id: string;
  userRequest: string;
  plan: FullStackWorkPlan;
  status: WorkPlanStatus;
  createdAt: Date;
  completedAt?: Date;
  result?: {
    success: boolean;
    filesChanged: string[];
    commandsRan: string[];
    errors?: string[];
    warnings?: string[];
    confidence: number;
  };
  executionHistory: ExecutionEntry[];
  actualChanges?: {
    filesModified: string[];
    filesCreated: string[];
    filesDeleted: string[];
  };
  notes?: string;
  tags?: string[];
}

/**
 * Single execution entry in work plan history
 */
export interface ExecutionEntry {
  timestamp: Date;
  action: string;
  status: 'started' | 'completed' | 'failed' | 'paused';
  details: Record<string, unknown>;
}

/**
 * Work plan history summary
 */
export interface WorkPlanHistory {
  totalPlans: number;
  completedCount: number;
  failedCount: number;
  executingCount: number;
  avgExecutionTime: number;
  plans: StoredWorkPlan[];
}

/**
 * Comparison between planned and actual changes
 */
export interface WorkPlanComparison {
  workPlanId: string;
  planned: {
    files: string[];
    layers: string[];
    estimatedTime: number;
    complexity: string;
  };
  actual: {
    filesModified: string[];
    filesCreated: string[];
    filesDeleted: string[];
    actualTime: number;
  };
  differences: {
    extraFilesModified: string[];
    missingFiles: string[];
    unexpectedLayers: string[];
    expectedButMissing: string[];
    timeVariance: number;
    completenessPercent: number;
  };
}

/**
 * In-memory work plan store (in real implementation, would use database)
 */
let workPlanStore: Map<string, StoredWorkPlan> = new Map();
let workPlanHistory: StoredWorkPlan[] = [];

/**
 * Generate unique work plan ID
 */
function generateWorkPlanId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `plan-${timestamp}-${random}`;
}

/**
 * Store a new work plan
 */
export function storeWorkPlan(userRequest: string, plan: FullStackWorkPlan): StoredWorkPlan {
  const id = generateWorkPlanId();
  const stored: StoredWorkPlan = {
    id,
    userRequest,
    plan,
    status: 'draft',
    createdAt: new Date(),
    executionHistory: [
      {
        timestamp: new Date(),
        action: 'created',
        status: 'completed',
        details: { layers: plan.touchedLayers, classification: plan.classification },
      },
    ],
  };

  workPlanStore.set(id, stored);
  workPlanHistory.push(stored);
  return stored;
}

/**
 * Get work plan by ID
 */
export function getWorkPlan(id: string): StoredWorkPlan | undefined {
  return workPlanStore.get(id);
}

/**
 * Get all stored work plans
 */
export function getAllWorkPlans(): StoredWorkPlan[] {
  return workPlanHistory.slice().reverse(); // Return newest first
}

/**
 * Get work plan history summary
 */
export function getWorkPlanHistorySummary(): WorkPlanHistory {
  const completedCount = workPlanHistory.filter((wp) => wp.status === 'completed').length;
  const failedCount = workPlanHistory.filter((wp) => wp.status === 'failed').length;
  const executingCount = workPlanHistory.filter((wp) => wp.status === 'executing').length;

  const executionTimes = workPlanHistory
    .filter((wp) => wp.completedAt)
    .map((wp) => wp.completedAt!.getTime() - wp.createdAt.getTime());

  const avgExecutionTime = executionTimes.length > 0 ? executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length : 0;

  return {
    totalPlans: workPlanHistory.length,
    completedCount,
    failedCount,
    executingCount,
    avgExecutionTime,
    plans: workPlanHistory.slice(-10), // Return last 10
  };
}

/**
 * Update work plan status
 */
export function updateWorkPlanStatus(id: string, status: WorkPlanStatus, details?: Record<string, unknown>): boolean {
  const plan = workPlanStore.get(id);
  if (!plan) return false;

  plan.status = status;

  plan.executionHistory.push({
    timestamp: new Date(),
    action: `status-${status}`,
    status: status === 'failed' ? 'failed' : 'completed',
    details: details || {},
  });

  if (status === 'completed' || status === 'failed') {
    plan.completedAt = new Date();
  }

  return true;
}

/**
 * Mark work plan with actual changes and results
 */
export function markWorkPlanComplete(
  id: string,
  success: boolean,
  actualChanges: { filesModified: string[]; filesCreated: string[]; filesDeleted: string[] },
  result: { filesChanged: string[]; commandsRan: string[]; errors?: string[]; warnings?: string[]; confidence: number }
): boolean {
  const plan = workPlanStore.get(id);
  if (!plan) return false;

  plan.actualChanges = actualChanges;
  plan.result = { success, ...result };
  plan.status = success ? 'completed' : 'failed';
  plan.completedAt = new Date();

  plan.executionHistory.push({
    timestamp: new Date(),
    action: success ? 'completed' : 'failed',
    status: success ? 'completed' : 'failed',
    details: {
      filesChanged: result.filesChanged.length,
      commandsRan: result.commandsRan.length,
      confidence: result.confidence,
    },
  });

  return true;
}

/**
 * Compare planned vs actual changes
 */
export function compareWorkPlan(id: string): WorkPlanComparison | null {
  const plan = workPlanStore.get(id);
  if (!plan || !plan.actualChanges || !plan.result) return null;

  // Historical callers persisted the pre-contract snake_case work-plan shape.
  // Keep comparison reads compatible while new plans use the canonical fields.
  const legacyPlan = plan.plan as unknown as {
    layers?: string[];
    ownership_plan?: Array<{ targetFile?: string }>;
    estimated_time_minutes?: number;
    complexity_assessment?: string;
  };
  const plannedFiles = Array.isArray(plan.plan.affectedFiles)
    ? plan.plan.affectedFiles.map((change) => change.file)
    : (legacyPlan.ownership_plan || [])
      .map((change) => change.targetFile)
      .filter((file): file is string => typeof file === 'string');
  const plannedLayers = plan.plan.touchedLayers || legacyPlan.layers || [];
  const estimatedTime = typeof legacyPlan.estimated_time_minutes === 'number'
    ? legacyPlan.estimated_time_minutes
    : 0;

  const planned = {
    files: plannedFiles,
    layers: plannedLayers,
    estimatedTime,
    complexity: plan.plan.estimatedComplexity || legacyPlan.complexity_assessment || 'unknown',
  };

  const actual = plan.actualChanges;

  // Find differences
  const allPlannedFiles = new Set(planned.files);
  const allActualFiles = new Set([...actual.filesModified, ...actual.filesCreated]);

  const extraFilesModified = actual.filesModified.filter((f) => !allPlannedFiles.has(f));
  const missingFiles = planned.files.filter((f) => !allActualFiles.has(f));

  const completenessPercent = planned.files.length > 0 ? (allActualFiles.size / planned.files.length) * 100 : 100;

  return {
    workPlanId: id,
    planned,
    actual: {
      ...actual,
      actualTime: plan.completedAt ? plan.completedAt.getTime() - plan.createdAt.getTime() : 0,
    },
    differences: {
      extraFilesModified,
      missingFiles,
      unexpectedLayers: [],
      expectedButMissing: [],
      timeVariance: plan.completedAt ? plan.completedAt.getTime() - plan.createdAt.getTime() - estimatedTime * 60000 : 0,
      completenessPercent,
    },
  };
}

/**
 * Export work plan for sharing/archiving
 */
export function exportWorkPlan(id: string): string | null {
  const plan = workPlanStore.get(id);
  if (!plan) return null;

  const exported = {
    id: plan.id,
    userRequest: plan.userRequest,
    plan: plan.plan,
    status: plan.status,
    createdAt: plan.createdAt,
    completedAt: plan.completedAt,
    result: plan.result,
    actualChanges: plan.actualChanges,
    exportedAt: new Date(),
  };

  return JSON.stringify(exported, null, 2);
}

/**
 * Import work plan from exported JSON
 */
export function importWorkPlan(jsonString: string): StoredWorkPlan | null {
  try {
    const data = JSON.parse(jsonString);

    const imported: StoredWorkPlan = {
      id: data.id || generateWorkPlanId(),
      userRequest: data.userRequest,
      plan: data.plan,
      status: 'draft', // Reset to draft for imported plans
      createdAt: new Date(data.createdAt),
      completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
      result: data.result,
      actualChanges: data.actualChanges,
      executionHistory: [
        {
          timestamp: new Date(),
          action: 'imported',
          status: 'completed',
          details: { originalId: data.id },
        },
      ],
    };

    workPlanStore.set(imported.id, imported);
    workPlanHistory.push(imported);

    return imported;
  } catch (error) {
    console.error('Failed to import work plan:', error);
    return null;
  }
}

/**
 * Replay a work plan (create a new execution based on existing plan)
 */
export function replayWorkPlan(id: string): StoredWorkPlan | null {
  const original = workPlanStore.get(id);
  if (!original) return null;

  // Create new plan with same structure but reset status
  const replayed: StoredWorkPlan = {
    id: generateWorkPlanId(),
    userRequest: original.userRequest,
    plan: original.plan,
    status: 'draft',
    createdAt: new Date(),
    executionHistory: [
      {
        timestamp: new Date(),
        action: 'replayed-from',
        status: 'completed',
        details: { originalPlanId: id },
      },
    ],
  };

  workPlanStore.set(replayed.id, replayed);
  workPlanHistory.push(replayed);

  return replayed;
}

/**
 * Delete work plan by ID
 */
export function deleteWorkPlan(id: string): boolean {
  if (!workPlanStore.has(id)) return false;

  workPlanStore.delete(id);
  const index = workPlanHistory.findIndex((wp) => wp.id === id);
  if (index > -1) {
    workPlanHistory.splice(index, 1);
  }

  return true;
}

/**
 * Clear all work plan history
 */
export function clearWorkPlanHistory(): void {
  workPlanStore.clear();
  workPlanHistory = [];
}

/**
 * Get work plans by tag
 */
export function getWorkPlansByTag(tag: string): StoredWorkPlan[] {
  return workPlanHistory.filter((wp) => wp.tags?.includes(tag));
}

/**
 * Add tag to work plan
 */
export function addTagToWorkPlan(id: string, tag: string): boolean {
  const plan = workPlanStore.get(id);
  if (!plan) return false;

  if (!plan.tags) {
    plan.tags = [];
  }

  if (!plan.tags.includes(tag)) {
    plan.tags.push(tag);
  }

  return true;
}
