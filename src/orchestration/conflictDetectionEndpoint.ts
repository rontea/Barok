/**
 * Phase 7.1 Task 4: Conflict Detection Integration
 * 
 * Analyzes planned work against current state for:
 * 1. File overlap conflicts (planned edits vs dirty files)
 * 2. Ownership conflicts (multiple agents claiming same file)
 * 3. Dependency conflicts (changes that break dependencies)
 * 
 * Streams results to UI via Server-Sent Events
 */

import type { Response } from 'express';
import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Conflict types detected
 */
export type ConflictType = 'file-overlap' | 'ownership-conflict' | 'dependency-conflict';

/**
 * Severity levels for conflicts
 */
export type ConflictSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Single detected conflict
 */
export interface DetectedConflict {
  id: string;
  type: ConflictType;
  severity: ConflictSeverity;
  description: string;
  affectedFiles: string[];
  conflictingAgents?: string[];
  suggestedResolution: string;
  canAutoResolve: boolean;
}

/**
 * Work plan with affected files and ownership
 */
export interface WorkPlanForConflictCheck {
  userRequest: string;
  affectedFiles: string[];
  ownershipPlan: Array<{
    path: string;
    owner: string;
    layer: string;
    readOnly?: boolean;
  }>;
  taskId?: string;
  workspace?: string;
}

/**
 * Dirty file info from git
 */
export interface DirtyFileInfo {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked';
  hunks?: Array<{ startLine: number; endLine: number }>;
}

/**
 * Conflict analysis result
 */
export interface ConflictAnalysisResult {
  timestamp: number;
  hasConflicts: boolean;
  totalConflicts: number;
  fileOverlapConflicts: DetectedConflict[];
  ownershipConflicts: DetectedConflict[];
  dependencyConflicts: DetectedConflict[];
  criticalConflictCount: number;
  canProceed: boolean;
  recommendedAction: 'proceed' | 'review' | 'revise' | 'abort';
}

/**
 * Stream event for conflict analysis
 */
export interface ConflictStreamEvent {
  type:
    | 'analysis-start'
    | 'checking-file-overlaps'
    | 'checking-ownership'
    | 'checking-dependencies'
    | 'conflicts-found'
    | 'analysis-complete'
    | 'error';
  data: any;
  timestamp?: number;
}

/**
 * Get dirty files from git
 */
function resolveWorkspaceRoot(workspace?: string): string {
  return path.resolve(workspace || process.cwd());
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function getDirtyFiles(workspace?: string): Promise<DirtyFileInfo[]> {
  try {
    const workspaceRoot = resolveWorkspaceRoot(workspace);
    if (!(await isDirectory(workspaceRoot))) {
      return [];
    }

    // Get modified and added files
    const statusOutput = execSync('git status --porcelain', {
      cwd: workspaceRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    const dirtyFiles: DirtyFileInfo[] = [];

    for (const line of statusOutput.split('\n')) {
      if (!line.trim()) continue;

      const status = line.substring(0, 2).trim();
      const filePath = line.substring(3).trim();

      let fileStatus: 'modified' | 'added' | 'deleted' | 'untracked' = 'untracked';
      if (status === 'M') fileStatus = 'modified';
      else if (status === 'A') fileStatus = 'added';
      else if (status === 'D') fileStatus = 'deleted';
      else if (status === '??') fileStatus = 'untracked';

      dirtyFiles.push({
        path: filePath,
        status: fileStatus,
      });
    }

    return dirtyFiles;
  } catch {
    // If git command fails, return empty
    return [];
  }
}

/**
 * Detect file overlap conflicts
 */
export function detectFileOverlapConflicts(
  plannedFiles: string[],
  dirtyFiles: DirtyFileInfo[]
): DetectedConflict[] {
  const conflicts: DetectedConflict[] = [];
  const dirtyFilePaths = new Set(dirtyFiles.map((f) => f.path));

  for (const planned of plannedFiles) {
    if (dirtyFilePaths.has(planned)) {
      const dirtyFile = dirtyFiles.find((f) => f.path === planned)!;
      conflicts.push({
        id: `overlap-${planned}`,
        type: 'file-overlap',
        severity: dirtyFile.status === 'modified' ? 'critical' : 'high',
        description: `Planned changes to ${planned} conflict with ${dirtyFile.status} local changes`,
        affectedFiles: [planned],
        suggestedResolution:
          dirtyFile.status === 'modified'
            ? `Commit or stash local changes to ${planned}, then retry`
            : `Review or discard ${dirtyFile.status} file ${planned} first`,
        canAutoResolve: false,
      });
    }
  }

  return conflicts;
}

/**
 * Detect ownership conflicts
 */
export function detectOwnershipConflicts(
  ownershipPlan: Array<{ path: string; owner: string; layer: string; readOnly?: boolean }>
): DetectedConflict[] {
  const conflicts: DetectedConflict[] = [];
  const fileOwners = new Map<string, Set<string>>();

  // Build map of files to owners
  for (const ownership of ownershipPlan) {
    if (ownership.readOnly) continue; // Skip read-only files

    if (!fileOwners.has(ownership.path)) {
      fileOwners.set(ownership.path, new Set());
    }
    fileOwners.get(ownership.path)!.add(ownership.owner);
  }

  // Find files with multiple owners
  for (const [filePath, owners] of fileOwners.entries()) {
    if (owners.size > 1) {
      conflicts.push({
        id: `ownership-${filePath}`,
        type: 'ownership-conflict',
        severity: 'critical',
        description: `File ${filePath} is claimed by multiple agents: ${Array.from(owners).join(', ')}`,
        affectedFiles: [filePath],
        conflictingAgents: Array.from(owners),
        suggestedResolution: `Reassign file ownership or merge agent responsibilities`,
        canAutoResolve: false,
      });
    }
  }

  return conflicts;
}

/**
 * Detect dependency conflicts (simplified)
 */
export function detectDependencyConflicts(
  plannedFiles: string[],
  affectedLayers: string[]
): DetectedConflict[] {
  const conflicts: DetectedConflict[] = [];

  // Check for potentially risky cross-layer changes
  const hasBackendChanges = plannedFiles.some((f) => f.startsWith('src/') || f === 'server.ts');
  const hasFrontendChanges = plannedFiles.some((f) => f.startsWith('ui/'));
  const hasTestChanges = plannedFiles.some((f) => f.startsWith('tests/'));
  const hasConfigChanges = plannedFiles.some((f) => f.includes('.json') || f.includes('.ts') && f.length < 20);

  // API schema changes breaking frontend
  if (hasBackendChanges && hasFrontendChanges && plannedFiles.some((f) => f.includes('api'))) {
    conflicts.push({
      id: 'dep-api-contract',
      type: 'dependency-conflict',
      severity: 'high',
      description: 'API changes detected alongside frontend changes - verify contract compatibility',
      affectedFiles: plannedFiles.filter((f) => f.includes('api') || f.startsWith('ui/')),
      suggestedResolution: 'Ensure API changes are backward compatible or update frontend together',
      canAutoResolve: false,
    });
  }

  // Type definition changes without test updates
  if (hasBackendChanges && !hasTestChanges && plannedFiles.some((f) => f.includes('types') || f.includes('interface'))) {
    conflicts.push({
      id: 'dep-types-coverage',
      type: 'dependency-conflict',
      severity: 'medium',
      description: 'Type/interface changes without corresponding test updates',
      affectedFiles: plannedFiles.filter((f) => f.includes('types') || f.includes('interface')),
      suggestedResolution: 'Add tests for type changes to maintain type safety',
      canAutoResolve: false,
    });
  }

  return conflicts;
}

/**
 * Analyze all conflicts
 */
export async function analyzeConflicts(workPlan: WorkPlanForConflictCheck): Promise<ConflictAnalysisResult> {
  const timestamp = Date.now();
  const dirtyFiles = await getDirtyFiles(workPlan.workspace);

  // Detect each type of conflict
  const fileOverlapConflicts = detectFileOverlapConflicts(workPlan.affectedFiles, dirtyFiles);
  const ownershipConflicts = detectOwnershipConflicts(workPlan.ownershipPlan);
  const dependencyConflicts = detectDependencyConflicts(
    workPlan.affectedFiles,
    workPlan.ownershipPlan.map((o) => o.layer)
  );

  const allConflicts = [...fileOverlapConflicts, ...ownershipConflicts, ...dependencyConflicts];
  const criticalCount = allConflicts.filter((c) => c.severity === 'critical').length;

  // Determine recommended action
  let recommendedAction: 'proceed' | 'review' | 'revise' | 'abort' = 'proceed';
  if (criticalCount > 0) {
    recommendedAction = 'abort';
  } else if (allConflicts.some((c) => c.severity === 'high')) {
    recommendedAction = 'revise';
  } else if (allConflicts.length > 0) {
    recommendedAction = 'review';
  }

  return {
    timestamp,
    hasConflicts: allConflicts.length > 0,
    totalConflicts: allConflicts.length,
    fileOverlapConflicts,
    ownershipConflicts,
    dependencyConflicts,
    criticalConflictCount: criticalCount,
    canProceed: recommendedAction !== 'abort',
    recommendedAction,
  };
}

/**
 * Handle conflict detection HTTP request with streaming
 */
export async function handleConflictDetectionRequest(
  req: {
    body: {
      workPlan: WorkPlanForConflictCheck;
      workspace?: string;
    };
  },
  res: Response
): Promise<void> {
  const { workPlan, workspace } = req.body;

  // Validate request
  if (!workPlan || !workPlan.affectedFiles || !workPlan.ownershipPlan) {
    res.status(400).json({
      error: 'Invalid request: workPlan with affectedFiles and ownershipPlan required',
    });
    return;
  }

  // Set up SSE response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event: ConflictStreamEvent) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
  };

  try {
    // Analysis started
    const workspaceRoot = resolveWorkspaceRoot(workspace || workPlan.workspace);
    workPlan.workspace = workspaceRoot;

    sendEvent({
      type: 'analysis-start',
      data: { timestamp: Date.now(), taskId: workPlan.taskId },
    });

    // Check file overlaps
    sendEvent({
      type: 'checking-file-overlaps',
      data: { filesChecked: workPlan.affectedFiles.length },
    });

    // Check ownership
    sendEvent({
      type: 'checking-ownership',
      data: { ownersChecked: new Set(workPlan.ownershipPlan.map((o) => o.owner)).size },
    });

    // Check dependencies
    sendEvent({
      type: 'checking-dependencies',
      data: { layersAffected: new Set(workPlan.ownershipPlan.map((o) => o.layer)).size },
    });

    // Perform analysis
    const analysis = await analyzeConflicts(workPlan);

    // Send results
    sendEvent({
      type: 'conflicts-found',
      data: {
        summary: {
          hasConflicts: analysis.hasConflicts,
          totalConflicts: analysis.totalConflicts,
          criticalConflicts: analysis.criticalConflictCount,
          canProceed: analysis.canProceed,
        },
        conflicts: {
          fileOverlap: analysis.fileOverlapConflicts,
          ownership: analysis.ownershipConflicts,
          dependency: analysis.dependencyConflicts,
        },
      },
    });

    // Analysis complete
    sendEvent({
      type: 'analysis-complete',
      data: {
        timestamp: Date.now(),
        recommendedAction: analysis.recommendedAction,
        summary: {
          fileOverlapCount: analysis.fileOverlapConflicts.length,
          ownershipConflictCount: analysis.ownershipConflicts.length,
          dependencyConflictCount: analysis.dependencyConflicts.length,
        },
      },
    });

    res.end();
  } catch (error: any) {
    sendEvent({
      type: 'error',
      data: {
        error: error.message || 'Unknown error during conflict detection',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
    });
    res.end();
  }
}
