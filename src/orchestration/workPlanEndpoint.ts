/**
 * Phase 7.1 - Work Plan Generation Endpoint
 * Handles /api/workplan/generate requests with streaming SSE responses
 * Integrates Phase 2 context (modules, dependencies, dirty tree) with work plan orchestration
 */

import type { Response } from 'express';
import type { PlanningContext, FullStackWorkPlan } from '../repo/workPlanOrchestrator.js';
import type { DependencySignal } from '../repo/dependencyGraph.js';
import { createWorkPlan, validateWorkPlan } from '../repo/workPlanOrchestrator.js';
import { analyzeAllModules } from '../repo/moduleResponsibilities.js';
import {
  extractApiRoutes,
  extractScriptDependencies,
  extractTestAssociations,
  extractUiComponents,
} from '../repo/dependencyGraph.js';
import { getDirtyTreeState } from '@barok/adapter-node';
import { generateRepoMap } from './repoMapEndpoint.js';
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Event type for streaming work plan generation
 */
export interface WorkPlanStreamEvent {
  type: 'planning-start' | 'context-loading' | 'context-loaded' | 'plan-created' | 'plan-validated' | 'done' | 'error';
  data: any;
  timestamp?: number;
}

/**
 * Request payload for work plan generation
 */
export interface WorkPlanRequest {
  userRequest: string;
  affectedFiles?: string[];
  workspace?: string;
}

function resolveWorkspaceRoot(workspace?: string): string {
  return path.resolve(workspace || process.cwd());
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads Phase 2 context from the repository
 * This would integrate with existing Phase 2 modules to gather:
 * - Module responsibilities
 * - Dependency signals
 * - Dirty tree state
 */
export async function loadPhase2Context(workspace?: string): Promise<PlanningContext> {
  const workspaceRoot = resolveWorkspaceRoot(workspace);
  const repoMap = await generateRepoMap(workspaceRoot);
  const modules = analyzeAllModules(workspaceRoot);
  const signals: DependencySignal[] = [];

  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  signals.push(...extractScriptDependencies(packageJsonPath));

  const serverPath = path.join(workspaceRoot, 'server.ts');
  signals.push(...extractApiRoutes(serverPath).map((signal) => ({
    ...signal,
    source: path.relative(workspaceRoot, signal.source).replace(/\\/g, '/'),
  })));

  signals.push(...extractTestAssociations(workspaceRoot));

  for (const file of [
    ...(repoMap.frontend.components || []),
    ...(repoMap.frontend.pages || []),
    ...(repoMap.frontend.utilities || []),
  ]) {
    const absoluteFile = path.join(workspaceRoot, file);
    if (await fileExists(absoluteFile)) {
      signals.push(...extractUiComponents(absoluteFile).map((signal) => ({
        ...signal,
        source: file,
        details: { ...(signal.details || {}), file },
      })));
    }
  }

  const dirtyTree = getDirtyTreeState(workspaceRoot);

  return {
    modules,
    signals,
    dirtyTree,
    repoMap
  };
}

/**
 * Sends an SSE event to the client
 */
export function sendSSEEvent(res: Response, event: WorkPlanStreamEvent): void {
  const data = {
    ...event,
    timestamp: Date.now()
  };
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`);
  (res as any).flush?.();
}

/**
 * Generates a work plan with streaming progress updates
 * Sends multiple SSE events showing the planning process
 */
export async function streamWorkPlanGeneration(
  req: any,
  res: Response
): Promise<void> {
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  res.flushHeaders?.();

  const sendEvent = (type: string, data: any) => {
    sendSSEEvent(res, { type: type as any, data });
  };

  try {
    const request: WorkPlanRequest = req.body;

    // Validate request
    if (!request.userRequest) {
      sendEvent('error', { error: 'Missing userRequest in request body' });
      res.end();
      return;
    }

    // Default to current files if not specified
    const affectedFiles = request.affectedFiles || [];

    // Send planning start event
    sendEvent('planning-start', {
      userRequest: request.userRequest,
      fileCount: affectedFiles.length
    });

    // Load Phase 2 context
    sendEvent('context-loading', { message: 'Loading repository context...' });
    const context = await loadPhase2Context(request.workspace);
    
    sendEvent('context-loaded', {
      moduleCount: context.modules.length,
      dependencySignalCount: context.signals.length,
      dirtyFileCount: context.dirtyTree.totalChanges,
      workspace: request.workspace || process.cwd()
    });

    // Create work plan
    const workPlan: FullStackWorkPlan = createWorkPlan(
      request.userRequest,
      affectedFiles,
      context
    );

    sendEvent('plan-created', {
      planId: workPlan.id,
      classification: workPlan.classification,
      complexity: workPlan.estimatedComplexity,
      touchedLayers: workPlan.touchedLayers,
      fileCount: workPlan.affectedFiles.length,
      requiresApproval: workPlan.requiresApproval,
      safetyScore: workPlan.safetyScore
    });

    // Validate work plan
    const validation = validateWorkPlan(workPlan);
    
    if (!validation.valid) {
      sendEvent('error', {
        error: 'Work plan validation failed',
        errors: validation.errors
      });
      res.end();
      return;
    }

    sendEvent('plan-validated', {
      message: 'Work plan validated successfully'
    });

    // Send complete work plan
    sendEvent('done', {
      success: true,
      plan: workPlan,
      message: 'Work plan generation complete'
    });

  } catch (error: any) {
    console.error('Work plan generation error:', error);
    sendEvent('error', {
      error: error.message || 'Unknown error during work plan generation',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    res.end();
  }
}

/**
 * Express endpoint handler for POST /api/workplan/generate
 * Usage: POST /api/workplan/generate
 * Body: { userRequest: string, affectedFiles?: string[], workspace?: string }
 * Response: Server-Sent Events stream
 */
export async function handleWorkPlanRequest(req: any, res: Response): Promise<void> {
  await streamWorkPlanGeneration(req, res);
}
