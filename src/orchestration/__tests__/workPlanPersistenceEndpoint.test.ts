/**
 * Phase 7.1 Task 6: Work Plan Persistence Tests
 * Comprehensive test coverage for work plan storage, replay, comparison, and export
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
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
} from '../../tools/workPlanStorage.js';
import type { FullStackWorkPlan } from '../../repo/workPlanOrchestrator.js';

// Mock work plan
const mockWorkPlan: FullStackWorkPlan = {
  id: 'plan-001',
  user_request: 'Add authentication to backend',
  layers: ['backend', 'tests'],
  classification: 'feature',
  complexity_assessment: 'moderate',
  estimated_time_minutes: 45,
  ownership_plan: [
    { agent: 'BackendAgent', targetFile: 'src/api/auth.ts', responsibility: 'Auth routes' },
    { agent: 'TestAgent', targetFile: 'src/api/__tests__/auth.test.ts', responsibility: 'Auth tests' },
  ],
  dependencies: [],
  acceptance_criteria: ['Auth endpoints working', 'Tests passing'],
  verification_plan: {
    checks: [],
    criticalGates: [],
  },
};

describe('Work Plan Persistence (Task 6)', () => {
  beforeEach(() => {
    clearWorkPlanHistory();
  });

  // Test Group 1: Storage & Persistence
  describe('Storage & Persistence', () => {
    it('should store a work plan and return stored data', () => {
      const stored = storeWorkPlan('Add authentication', mockWorkPlan);

      expect(stored).toBeDefined();
      expect(stored.id).toBeTruthy();
      expect(stored.userRequest).toBe('Add authentication');
      expect(stored.status).toBe('draft');
      expect(stored.createdAt).toBeInstanceOf(Date);
    });

    it('should retrieve a stored work plan by ID', () => {
      const stored = storeWorkPlan('Add authentication', mockWorkPlan);
      const retrieved = getWorkPlan(stored.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(stored.id);
      expect(retrieved?.userRequest).toBe('Add authentication');
      expect(retrieved?.plan).toEqual(mockWorkPlan);
    });

    it('should return undefined for non-existent work plan', () => {
      const retrieved = getWorkPlan('non-existent-id');
      expect(retrieved).toBeUndefined();
    });

    it('should list all stored work plans', () => {
      const plan1 = storeWorkPlan('Request 1', mockWorkPlan);
      const plan2 = storeWorkPlan('Request 2', mockWorkPlan);

      const all = getAllWorkPlans();
      expect(all.length).toBe(2);
      expect(all.map((p) => p.id)).toContain(plan1.id);
      expect(all.map((p) => p.id)).toContain(plan2.id);
    });
  });

  // Test Group 2: Status Management
  describe('Status Management', () => {
    it('should update work plan status', () => {
      const stored = storeWorkPlan('Add authentication', mockWorkPlan);
      const updated = updateWorkPlanStatus(stored.id, 'approved');

      expect(updated).toBe(true);
      const retrieved = getWorkPlan(stored.id);
      expect(retrieved?.status).toBe('approved');
    });

    it('should track execution history when updating status', () => {
      const stored = storeWorkPlan('Add authentication', mockWorkPlan);
      updateWorkPlanStatus(stored.id, 'executing');

      const retrieved = getWorkPlan(stored.id);
      expect(retrieved?.executionHistory.length).toBeGreaterThan(1);
      const lastEntry = retrieved?.executionHistory[retrieved.executionHistory.length - 1];
      expect(lastEntry?.action).toBe('status-executing');
    });

    it('should return false for non-existent work plan on status update', () => {
      const updated = updateWorkPlanStatus('non-existent-id', 'approved');
      expect(updated).toBe(false);
    });
  });

  // Test Group 3: Completion & Results
  describe('Completion & Results Tracking', () => {
    it('should mark work plan as complete with actual changes', () => {
      const stored = storeWorkPlan('Add authentication', mockWorkPlan);

      const marked = markWorkPlanComplete(
        stored.id,
        true,
        {
          filesModified: ['src/api/auth.ts'],
          filesCreated: [],
          filesDeleted: [],
        },
        {
          filesChanged: ['src/api/auth.ts'],
          commandsRan: ['npm run test'],
          confidence: 0.95,
        }
      );

      expect(marked).toBe(true);
      const retrieved = getWorkPlan(stored.id);
      expect(retrieved?.status).toBe('completed');
      expect(retrieved?.completedAt).toBeInstanceOf(Date);
      expect(retrieved?.result?.confidence).toBe(0.95);
    });

    it('should handle failed completion', () => {
      const stored = storeWorkPlan('Add authentication', mockWorkPlan);

      markWorkPlanComplete(
        stored.id,
        false,
        {
          filesModified: ['src/api/auth.ts'],
          filesCreated: [],
          filesDeleted: [],
        },
        {
          filesChanged: ['src/api/auth.ts'],
          commandsRan: [],
          errors: ['Type error in auth.ts'],
          confidence: 0.3,
        }
      );

      const retrieved = getWorkPlan(stored.id);
      expect(retrieved?.status).toBe('failed');
      expect(retrieved?.result?.errors).toContain('Type error in auth.ts');
    });

    it('should return false for non-existent work plan on completion', () => {
      const marked = markWorkPlanComplete('non-existent-id', true, { filesModified: [], filesCreated: [], filesDeleted: [] }, { filesChanged: [], commandsRan: [], confidence: 0 });
      expect(marked).toBe(false);
    });
  });

  // Test Group 4: Comparison (Planned vs Actual)
  describe('Planned vs Actual Comparison', () => {
    it('should compare planned and actual changes', () => {
      const stored = storeWorkPlan('Add authentication', mockWorkPlan);

      markWorkPlanComplete(
        stored.id,
        true,
        {
          filesModified: ['src/api/auth.ts'],
          filesCreated: [],
          filesDeleted: [],
        },
        {
          filesChanged: ['src/api/auth.ts'],
          commandsRan: ['npm run test'],
          confidence: 0.9,
        }
      );

      const comparison = compareWorkPlan(stored.id);

      expect(comparison).toBeDefined();
      expect(comparison?.workPlanId).toBe(stored.id);
      expect(comparison?.planned.files).toContain('src/api/auth.ts');
      expect(comparison?.actual.filesModified).toContain('src/api/auth.ts');
      expect(comparison?.differences.completenessPercent).toBeGreaterThan(0);
    });

    it('should detect extra files modified beyond plan', () => {
      const stored = storeWorkPlan('Add authentication', mockWorkPlan);

      markWorkPlanComplete(
        stored.id,
        true,
        {
          filesModified: ['src/api/auth.ts', 'src/middleware/auth-middleware.ts'],
          filesCreated: [],
          filesDeleted: [],
        },
        {
          filesChanged: ['src/api/auth.ts', 'src/middleware/auth-middleware.ts'],
          commandsRan: [],
          confidence: 0.85,
        }
      );

      const comparison = compareWorkPlan(stored.id);
      expect(comparison?.differences.extraFilesModified).toContain('src/middleware/auth-middleware.ts');
    });

    it('should return null for incomplete work plan comparison', () => {
      const stored = storeWorkPlan('Add authentication', mockWorkPlan);
      const comparison = compareWorkPlan(stored.id);

      expect(comparison).toBeNull();
    });
  });

  // Test Group 5: Export & Import
  describe('Export & Import', () => {
    it('should export work plan as JSON', () => {
      const stored = storeWorkPlan('Add authentication', mockWorkPlan);
      const exported = exportWorkPlan(stored.id);

      expect(exported).toBeTruthy();
      expect(typeof exported).toBe('string');

      const parsed = JSON.parse(exported!);
      expect(parsed.id).toBe(stored.id);
      expect(parsed.userRequest).toBe('Add authentication');
      expect(parsed.plan).toEqual(mockWorkPlan);
    });

    it('should import work plan from JSON', () => {
      const stored = storeWorkPlan('Add authentication', mockWorkPlan);
      const exported = exportWorkPlan(stored.id);

      clearWorkPlanHistory();

      const imported = importWorkPlan(exported!);

      expect(imported).toBeDefined();
      expect(imported?.userRequest).toBe('Add authentication');
      expect(imported?.status).toBe('draft');
      expect(imported?.executionHistory[0].action).toBe('imported');
    });

    it('should return null for invalid JSON import', () => {
      const imported = importWorkPlan('not valid json');
      expect(imported).toBeNull();
    });

    it('should return null for non-existent work plan export', () => {
      const exported = exportWorkPlan('non-existent-id');
      expect(exported).toBeNull();
    });
  });

  // Test Group 6: Replay
  describe('Replay Functionality', () => {
    it('should replay a work plan with new ID', () => {
      const stored = storeWorkPlan('Add authentication', mockWorkPlan);

      markWorkPlanComplete(
        stored.id,
        true,
        { filesModified: ['src/api/auth.ts'], filesCreated: [], filesDeleted: [] },
        { filesChanged: ['src/api/auth.ts'], commandsRan: [], confidence: 0.9 }
      );

      const replayed = replayWorkPlan(stored.id);

      expect(replayed).toBeDefined();
      expect(replayed?.id).not.toBe(stored.id);
      expect(replayed?.userRequest).toBe(stored.userRequest);
      expect(replayed?.status).toBe('draft');
      expect(replayed?.executionHistory[0].action).toBe('replayed-from');
    });

    it('should return null for non-existent work plan replay', () => {
      const replayed = replayWorkPlan('non-existent-id');
      expect(replayed).toBeNull();
    });
  });

  // Test Group 7: History Summary
  describe('History Summary', () => {
    it('should generate accurate history summary', () => {
      const plan1 = storeWorkPlan('Request 1', mockWorkPlan);
      const plan2 = storeWorkPlan('Request 2', mockWorkPlan);

      markWorkPlanComplete(
        plan1.id,
        true,
        { filesModified: [], filesCreated: [], filesDeleted: [] },
        { filesChanged: [], commandsRan: [], confidence: 0.9 }
      );

      markWorkPlanComplete(
        plan2.id,
        false,
        { filesModified: [], filesCreated: [], filesDeleted: [] },
        { filesChanged: [], commandsRan: [], errors: ['Failed'], confidence: 0.2 }
      );

      const summary = getWorkPlanHistorySummary();

      expect(summary.totalPlans).toBe(2);
      expect(summary.completedCount).toBe(1);
      expect(summary.failedCount).toBe(1);
      expect(summary.plans.length).toBeGreaterThan(0);
    });

    it('should calculate average execution time correctly', () => {
      const plan1 = storeWorkPlan('Request 1', mockWorkPlan);

      markWorkPlanComplete(
        plan1.id,
        true,
        { filesModified: [], filesCreated: [], filesDeleted: [] },
        { filesChanged: [], commandsRan: [], confidence: 0.9 }
      );

      const summary = getWorkPlanHistorySummary();
      expect(summary.avgExecutionTime).toBeGreaterThanOrEqual(0);
    });
  });

  // Test Group 8: Tagging & Filtering
  describe('Tagging & Filtering', () => {
    it('should add tag to work plan', () => {
      const stored = storeWorkPlan('Add authentication', mockWorkPlan);
      const added = addTagToWorkPlan(stored.id, 'priority-high');

      expect(added).toBe(true);
      const retrieved = getWorkPlan(stored.id);
      expect(retrieved?.tags).toContain('priority-high');
    });

    it('should not add duplicate tags', () => {
      const stored = storeWorkPlan('Add authentication', mockWorkPlan);
      addTagToWorkPlan(stored.id, 'priority-high');
      addTagToWorkPlan(stored.id, 'priority-high');

      const retrieved = getWorkPlan(stored.id);
      const count = retrieved?.tags?.filter((t) => t === 'priority-high').length || 0;
      expect(count).toBe(1);
    });

    it('should retrieve work plans by tag', () => {
      const plan1 = storeWorkPlan('Request 1', mockWorkPlan);
      const plan2 = storeWorkPlan('Request 2', mockWorkPlan);

      addTagToWorkPlan(plan1.id, 'backend');
      addTagToWorkPlan(plan2.id, 'frontend');
      addTagToWorkPlan(plan1.id, 'critical');

      const backendPlans = getWorkPlansByTag('backend');
      expect(backendPlans.length).toBe(1);
      expect(backendPlans[0].id).toBe(plan1.id);

      const criticalPlans = getWorkPlansByTag('critical');
      expect(criticalPlans.length).toBe(1);
    });

    it('should return empty array for non-existent tag', () => {
      const plans = getWorkPlansByTag('non-existent-tag');
      expect(plans).toEqual([]);
    });
  });

  // Test Group 9: Deletion & Cleanup
  describe('Deletion & Cleanup', () => {
    it('should delete a work plan', () => {
      const stored = storeWorkPlan('Add authentication', mockWorkPlan);
      const deleted = deleteWorkPlan(stored.id);

      expect(deleted).toBe(true);
      const retrieved = getWorkPlan(stored.id);
      expect(retrieved).toBeUndefined();
    });

    it('should return false when deleting non-existent work plan', () => {
      const deleted = deleteWorkPlan('non-existent-id');
      expect(deleted).toBe(false);
    });

    it('should clear all work plan history', () => {
      storeWorkPlan('Request 1', mockWorkPlan);
      storeWorkPlan('Request 2', mockWorkPlan);

      let all = getAllWorkPlans();
      expect(all.length).toBe(2);

      clearWorkPlanHistory();

      all = getAllWorkPlans();
      expect(all.length).toBe(0);
    });
  });

  // Test Group 10: Edge Cases
  describe('Edge Cases & Data Integrity', () => {
    it('should handle work plans with minimal data', () => {
      const minimal: FullStackWorkPlan = {
        id: 'minimal',
        user_request: 'Minimal request',
        layers: [],
        classification: 'bug_fix',
        complexity_assessment: 'trivial',
        estimated_time_minutes: 5,
        ownership_plan: [],
        dependencies: [],
        acceptance_criteria: [],
        verification_plan: { checks: [], criticalGates: [] },
      };

      const stored = storeWorkPlan('Minimal', minimal);
      expect(stored).toBeDefined();
      expect(stored.id).toBeTruthy();
    });

    it('should maintain data consistency across operations', () => {
      const plan1 = storeWorkPlan('Request 1', mockWorkPlan);
      const plan2 = storeWorkPlan('Request 2', mockWorkPlan);

      updateWorkPlanStatus(plan1.id, 'approved');
      markWorkPlanComplete(
        plan1.id,
        true,
        { filesModified: [], filesCreated: [], filesDeleted: [] },
        { filesChanged: [], commandsRan: [], confidence: 0.9 }
      );

      const retrieved1 = getWorkPlan(plan1.id);
      const retrieved2 = getWorkPlan(plan2.id);

      expect(retrieved1?.status).toBe('completed');
      expect(retrieved2?.status).toBe('draft');
    });

    it('should generate unique IDs for each work plan', () => {
      const plan1 = storeWorkPlan('Request 1', mockWorkPlan);
      const plan2 = storeWorkPlan('Request 2', mockWorkPlan);
      const plan3 = storeWorkPlan('Request 3', mockWorkPlan);

      const ids = new Set([plan1.id, plan2.id, plan3.id]);
      expect(ids.size).toBe(3);
    });
  });
});
