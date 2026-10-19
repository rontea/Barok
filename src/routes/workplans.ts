import { Router } from 'express';
import { handleWorkPlanRequest } from '../orchestration/workPlanEndpoint.js';
import { handleAgentExecutionRequest } from '../orchestration/agentExecutionEndpoint.js';
import { handleRepoMapRequest } from '../orchestration/repoMapEndpoint.js';
import { handleConflictDetectionRequest } from '../orchestration/conflictDetectionEndpoint.js';
import { handleVerificationResultsRequest } from '../orchestration/verificationResultsEndpoint.js';
import {
  handleSaveWorkPlan,
  handleGetWorkPlans,
  handleGetHistorySummary,
  handleGetWorkPlan,
  handleUpdateStatus,
  handleCompleteWorkPlan,
  handleCompareWorkPlan,
  handleExportWorkPlan,
  handleImportWorkPlan,
  handleReplayWorkPlan,
  handleDeleteWorkPlan,
  handleAddTag,
  handleGetByTag,
} from '../orchestration/workPlanPersistenceEndpoint.js';

export function createRouter() {
  const router = Router();

  router.post('/api/workplan/generate', handleWorkPlanRequest);
  router.post('/api/agents/stream', handleAgentExecutionRequest);
  router.post('/api/repo/map', handleRepoMapRequest);
  router.post('/api/conflicts/analyze', handleConflictDetectionRequest);
  router.post('/api/verification/stream', handleVerificationResultsRequest);

  router.post('/api/workplans', handleSaveWorkPlan);
  router.get('/api/workplans', handleGetWorkPlans);
  router.get('/api/workplans/summary', handleGetHistorySummary);
  router.get('/api/workplans/:id', handleGetWorkPlan);
  router.patch('/api/workplans/:id/status', handleUpdateStatus);
  router.patch('/api/workplans/:id/complete', handleCompleteWorkPlan);
  router.get('/api/workplans/:id/compare', handleCompareWorkPlan);
  router.get('/api/workplans/:id/export', handleExportWorkPlan);
  router.post('/api/workplans/import', handleImportWorkPlan);
  router.post('/api/workplans/:id/replay', handleReplayWorkPlan);
  router.delete('/api/workplans/:id', handleDeleteWorkPlan);
  router.post('/api/workplans/:id/tags', handleAddTag);
  router.get('/api/workplans/tags/:tag', handleGetByTag);

  return router;
}
