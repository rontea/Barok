/**
 * Phase 7.1 Task 6: Work Plan Persistence Endpoints
 * REST API endpoints for managing work plan history, replay, and export
 */

import type { Request, Response } from 'express';
import {
  storeWorkPlan,
  getWorkPlan,
  getAllWorkPlans,
  getWorkPlanHistorySummary,
  updateWorkPlanStatus,
  markWorkPlanComplete,
  compareWorkPlan,
  exportWorkPlan,
  importWorkPlan,
  replayWorkPlan,
  deleteWorkPlan,
  clearWorkPlanHistory,
  getWorkPlansByTag,
  addTagToWorkPlan,
} from '../tools/workPlanStorage.js';
import type { FullStackWorkPlan } from '../repo/workPlanOrchestrator.js';

function routeParam(req: Request, name: string): string | undefined {
  const value = req.params[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Save a work plan
 * POST /api/workplans
 */
export async function handleSaveWorkPlan(req: Request, res: Response): Promise<void> {
  try {
    const { userRequest, plan } = req.body as { userRequest: string; plan: FullStackWorkPlan };

    if (!userRequest || !plan) {
      res.status(400).json({ error: 'Missing userRequest or plan' });
      return;
    }

    const stored = storeWorkPlan(userRequest, plan);

    res.json({
      success: true,
      workPlanId: stored.id,
      status: stored.status,
      createdAt: stored.createdAt,
    });
  } catch (error) {
    console.error('Error saving work plan:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

/**
 * Get all work plans
 * GET /api/workplans
 */
export async function handleGetWorkPlans(req: Request, res: Response): Promise<void> {
  try {
    const plans = getAllWorkPlans();

    res.json({
      success: true,
      count: plans.length,
      plans: plans.map((wp) => ({
        id: wp.id,
        userRequest: wp.userRequest,
        status: wp.status,
        createdAt: wp.createdAt,
        completedAt: wp.completedAt,
        tags: wp.tags,
        resultSummary: wp.result
          ? {
              success: wp.result.success,
              filesChanged: wp.result.filesChanged.length,
              confidence: wp.result.confidence,
            }
          : null,
      })),
    });
  } catch (error) {
    console.error('Error fetching work plans:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

/**
 * Get work plan history summary
 * GET /api/workplans/summary
 */
export async function handleGetHistorySummary(req: Request, res: Response): Promise<void> {
  try {
    const summary = getWorkPlanHistorySummary();

    res.json({
      success: true,
      ...summary,
    });
  } catch (error) {
    console.error('Error fetching history summary:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

/**
 * Get specific work plan
 * GET /api/workplans/:id
 */
export async function handleGetWorkPlan(req: Request, res: Response): Promise<void> {
  try {
    const id = routeParam(req, 'id');

    if (!id) {
      res.status(400).json({ error: 'Missing work plan ID' });
      return;
    }

    const plan = getWorkPlan(id);

    if (!plan) {
      res.status(404).json({ error: 'Work plan not found' });
      return;
    }

    res.json({
      success: true,
      workPlan: plan,
    });
  } catch (error) {
    console.error('Error fetching work plan:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

/**
 * Update work plan status
 * PATCH /api/workplans/:id/status
 */
export async function handleUpdateStatus(req: Request, res: Response): Promise<void> {
  try {
    const id = routeParam(req, 'id');
    const { status, details } = req.body;

    if (!id || !status) {
      res.status(400).json({ error: 'Missing work plan ID or status' });
      return;
    }

    const success = updateWorkPlanStatus(id, status, details);

    if (!success) {
      res.status(404).json({ error: 'Work plan not found' });
      return;
    }

    res.json({ success: true, status });
  } catch (error) {
    console.error('Error updating work plan status:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

/**
 * Mark work plan as complete with actual results
 * PATCH /api/workplans/:id/complete
 */
export async function handleCompleteWorkPlan(req: Request, res: Response): Promise<void> {
  try {
    const id = routeParam(req, 'id');
    const { success, actualChanges, result } = req.body;

    if (!id || actualChanges === undefined || result === undefined) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const updated = markWorkPlanComplete(id, success, actualChanges, result);

    if (!updated) {
      res.status(404).json({ error: 'Work plan not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error completing work plan:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

/**
 * Compare planned vs actual changes
 * GET /api/workplans/:id/compare
 */
export async function handleCompareWorkPlan(req: Request, res: Response): Promise<void> {
  try {
    const id = routeParam(req, 'id');

    if (!id) {
      res.status(400).json({ error: 'Missing work plan ID' });
      return;
    }

    const comparison = compareWorkPlan(id);

    if (!comparison) {
      res.status(404).json({ error: 'Work plan not found or execution incomplete' });
      return;
    }

    res.json({
      success: true,
      comparison,
    });
  } catch (error) {
    console.error('Error comparing work plan:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

/**
 * Export work plan as JSON
 * GET /api/workplans/:id/export
 */
export async function handleExportWorkPlan(req: Request, res: Response): Promise<void> {
  try {
    const id = routeParam(req, 'id');

    if (!id) {
      res.status(400).json({ error: 'Missing work plan ID' });
      return;
    }

    const exported = exportWorkPlan(id);

    if (!exported) {
      res.status(404).json({ error: 'Work plan not found' });
      return;
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="workplan-${id}.json"`);
    res.send(exported);
  } catch (error) {
    console.error('Error exporting work plan:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

/**
 * Import work plan from JSON
 * POST /api/workplans/import
 */
export async function handleImportWorkPlan(req: Request, res: Response): Promise<void> {
  try {
    const { jsonData } = req.body;

    if (!jsonData) {
      res.status(400).json({ error: 'Missing JSON data' });
      return;
    }

    const imported = importWorkPlan(jsonData);

    if (!imported) {
      res.status(400).json({ error: 'Failed to import work plan' });
      return;
    }

    res.json({
      success: true,
      workPlanId: imported.id,
      status: imported.status,
    });
  } catch (error) {
    console.error('Error importing work plan:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

/**
 * Replay a work plan
 * POST /api/workplans/:id/replay
 */
export async function handleReplayWorkPlan(req: Request, res: Response): Promise<void> {
  try {
    const id = routeParam(req, 'id');

    if (!id) {
      res.status(400).json({ error: 'Missing work plan ID' });
      return;
    }

    const replayed = replayWorkPlan(id);

    if (!replayed) {
      res.status(404).json({ error: 'Work plan not found' });
      return;
    }

    res.json({
      success: true,
      newWorkPlanId: replayed.id,
      originalId: id,
      status: replayed.status,
      createdAt: replayed.createdAt,
    });
  } catch (error) {
    console.error('Error replaying work plan:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

/**
 * Delete work plan
 * DELETE /api/workplans/:id
 */
export async function handleDeleteWorkPlan(req: Request, res: Response): Promise<void> {
  try {
    const id = routeParam(req, 'id');

    if (!id) {
      res.status(400).json({ error: 'Missing work plan ID' });
      return;
    }

    const deleted = deleteWorkPlan(id);

    if (!deleted) {
      res.status(404).json({ error: 'Work plan not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting work plan:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

/**
 * Clear all work plan history
 * DELETE /api/workplans
 */
export async function handleClearHistory(req: Request, res: Response): Promise<void> {
  try {
    clearWorkPlanHistory();
    res.json({ success: true, message: 'Work plan history cleared' });
  } catch (error) {
    console.error('Error clearing history:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

/**
 * Add tag to work plan
 * POST /api/workplans/:id/tags
 */
export async function handleAddTag(req: Request, res: Response): Promise<void> {
  try {
    const id = routeParam(req, 'id');
    const { tag } = req.body;

    if (!id || !tag) {
      res.status(400).json({ error: 'Missing work plan ID or tag' });
      return;
    }

    const success = addTagToWorkPlan(id, tag);

    if (!success) {
      res.status(404).json({ error: 'Work plan not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error adding tag:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

/**
 * Get work plans by tag
 * GET /api/workplans/tags/:tag
 */
export async function handleGetByTag(req: Request, res: Response): Promise<void> {
  try {
    const tag = routeParam(req, 'tag');

    if (!tag) {
      res.status(400).json({ error: 'Missing tag' });
      return;
    }

    const plans = getWorkPlansByTag(tag);

    res.json({
      success: true,
      count: plans.length,
      plans: plans.map((wp) => ({
        id: wp.id,
        userRequest: wp.userRequest,
        status: wp.status,
        createdAt: wp.createdAt,
      })),
    });
  } catch (error) {
    console.error('Error fetching plans by tag:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}
