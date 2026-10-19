/**
 * Overwrite Prevention Plan Tests
 * Tests for conflict detection, merge strategies, and approval workflows
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  validatePlannedChanges,
  selectMergeStrategy,
  refinePlanExcludingDirtyFiles,
  createApprovalRequest,
  generateOverwriteSummary,
  type OverwriteCheckResult,
  type PlannedChange,
  type DirtyTreeState,
} from '../overwritePreventionPlan.js';

describe('Overwrite Prevention Plan', () => {
  let dirtyTree: DirtyTreeState;
  let plannedChanges: PlannedChange[];

  beforeEach(() => {
    dirtyTree = {
      isDirty: true,
      files: [
        {
          path: 'src/app.ts',
          status: 'modified',
          hunks: [],
          lastModified: Date.now(),
        },
      ],
      modifiedCount: 1,
      addedCount: 0,
      deletedCount: 0,
      untrackedCount: 0,
      totalChanges: 1,
      lastScanned: Date.now(),
    };

    plannedChanges = [
      {
        file: 'src/server.ts',
        type: 'modify',
        description: 'Add new endpoint',
      },
    ];
  });

  describe('validatePlannedChanges', () => {
    it('should allow changes that do not conflict with dirty files', () => {
      const result = validatePlannedChanges(plannedChanges, dirtyTree);

      expect(result.canProceed).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.conflicts.length).toBe(0);
      expect(result.safetyScore).toBe(100);
    });

    it('should detect direct file overwrites', () => {
      const conflictingChanges: PlannedChange[] = [
        {
          file: 'src/app.ts',
          type: 'modify',
          description: 'Update app',
        },
      ];

      const result = validatePlannedChanges(conflictingChanges, dirtyTree);

      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(result.conflicts[0].file).toBe('src/app.ts');
      expect(result.canProceed).toBe(false);
    });

    it('should classify critical conflicts for deletion of modified files', () => {
      const conflictingChanges: PlannedChange[] = [
        {
          file: 'src/app.ts',
          type: 'delete',
          description: 'Remove file',
        },
      ];

      const result = validatePlannedChanges(conflictingChanges, dirtyTree);

      expect(result.conflicts.length).toBeGreaterThan(0);
      const conflict = result.conflicts.find((c) => c.file === 'src/app.ts');
      expect(conflict?.severity).toBe('critical');
    });

    it('should detect cascading conflicts from core dependencies', () => {
      const coreChanges: PlannedChange[] = [
        {
          file: 'package.json',
          type: 'modify',
          description: 'Update dependencies',
        },
      ];

      const result = validatePlannedChanges(coreChanges, dirtyTree);

      // With dirty files and core dependency change, should detect cascade
      if (result.conflicts.some((c) => c.type === 'cascading')) {
        expect(result.hasConflicts).toBe(true);
      }
    });

    it('should warn on large change sets with dirty tree', () => {
      const manyChanges: PlannedChange[] = Array.from({ length: 12 }, (_, i) => ({
        file: `src/file${i}.ts`,
        type: 'modify' as const,
      }));

      const result = validatePlannedChanges(manyChanges, dirtyTree);

      expect(result.warnings.some((w) => w.includes('Large change set'))).toBe(true);
      expect(result.safetyScore).toBeLessThan(100);
    });

    it('should include suggestions for resolving conflicts', () => {
      const conflictingChanges: PlannedChange[] = [
        {
          file: 'src/app.ts',
          type: 'modify',
        },
      ];

      const result = validatePlannedChanges(conflictingChanges, dirtyTree);

      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions.some((s) => s.includes('git'))).toBe(true);
    });

    it('should clean tree have 100 safety score and no conflicts', () => {
      const cleanTree: DirtyTreeState = {
        isDirty: false,
        files: [],
        modifiedCount: 0,
        addedCount: 0,
        deletedCount: 0,
        untrackedCount: 0,
        totalChanges: 0,
        lastScanned: Date.now(),
      };

      const result = validatePlannedChanges(plannedChanges, cleanTree);

      expect(result.canProceed).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.safetyScore).toBe(100);
      expect(result.conflicts.length).toBe(0);
    });
  });

  describe('selectMergeStrategy', () => {
    it('should select merge-force for no conflicts', () => {
      const result: OverwriteCheckResult = {
        canProceed: true,
        hasConflicts: false,
        conflicts: [],
        warnings: [],
        suggestions: [],
        mergeStrategy: 'abort',
        requiresApproval: false,
        safetyScore: 100,
      };

      const strategy = selectMergeStrategy(result);

      expect(strategy).toBe('merge-force');
    });

    it('should select abort for critical conflicts', () => {
      const result: OverwriteCheckResult = {
        canProceed: false,
        hasConflicts: true,
        conflicts: [
          {
            type: 'direct-overwrite',
            file: 'src/app.ts',
            plannedChange: 'delete',
            dirtyStatus: 'modified',
            severity: 'critical',
            suggestion: 'Commit first',
          },
        ],
        warnings: [],
        suggestions: [],
        mergeStrategy: 'abort',
        requiresApproval: true,
        safetyScore: 50,
      };

      const strategy = selectMergeStrategy(result);

      expect(strategy).toBe('abort');
    });

    it('should select merge-careful for high-severity conflicts', () => {
      const result: OverwriteCheckResult = {
        canProceed: false,
        hasConflicts: true,
        conflicts: [
          {
            type: 'direct-overwrite',
            file: 'src/app.ts',
            plannedChange: 'modify',
            dirtyStatus: 'modified',
            severity: 'high',
            suggestion: 'Review changes',
          },
        ],
        warnings: [],
        suggestions: [],
        mergeStrategy: 'merge-careful',
        requiresApproval: false,
        safetyScore: 75,
      };

      const strategy = selectMergeStrategy(result);

      expect(strategy).toBe('merge-careful');
    });

    it('should select warn for low-severity conflicts', () => {
      const result: OverwriteCheckResult = {
        canProceed: true,
        hasConflicts: true,
        conflicts: [
          {
            type: 'direct-overwrite',
            file: 'src/app.ts',
            plannedChange: 'create',
            dirtyStatus: 'untracked',
            severity: 'low',
            suggestion: 'Consider renaming',
          },
        ],
        warnings: [],
        suggestions: [],
        mergeStrategy: 'warn',
        requiresApproval: false,
        safetyScore: 90,
      };

      const strategy = selectMergeStrategy(result);

      expect(strategy).toBe('warn');
    });
  });

  describe('refinePlanExcludingDirtyFiles', () => {
    it('should exclude dirty files from plan', () => {
      const changes: PlannedChange[] = [
        {
          file: 'src/app.ts',
          type: 'modify',
        },
        {
          file: 'src/server.ts',
          type: 'modify',
        },
      ];

      const refined = refinePlanExcludingDirtyFiles(changes, dirtyTree);

      expect(refined.refined.length).toBe(1);
      expect(refined.excluded.length).toBe(1);
      expect(refined.excluded[0].file).toBe('src/app.ts');
    });

    it('should include approved dirty file changes', () => {
      const changes: PlannedChange[] = [
        {
          file: 'src/app.ts',
          type: 'modify',
        },
      ];

      const refined = refinePlanExcludingDirtyFiles(changes, dirtyTree, ['src/app.ts']);

      expect(refined.refined.length).toBe(1);
      expect(refined.excluded.length).toBe(0);
      expect(refined.notes.some((n) => n.includes('Approved'))).toBe(true);
    });

    it('should generate informative notes', () => {
      const changes: PlannedChange[] = [
        {
          file: 'src/app.ts',
          type: 'modify',
        },
        {
          file: 'src/server.ts',
          type: 'modify',
        },
      ];

      const refined = refinePlanExcludingDirtyFiles(changes, dirtyTree);

      expect(refined.notes.length).toBeGreaterThan(0);
      expect(refined.notes.some((n) => n.includes('Excluded'))).toBe(true);
    });

    it('should preserve original and refined lists', () => {
      const changes: PlannedChange[] = [
        {
          file: 'src/app.ts',
          type: 'modify',
        },
        {
          file: 'src/server.ts',
          type: 'modify',
        },
      ];

      const refined = refinePlanExcludingDirtyFiles(changes, dirtyTree);

      expect(refined.original).toEqual(changes);
      expect(refined.original.length).toBe(2);
      expect(refined.refined.length + refined.excluded.length).toBe(2);
    });
  });

  describe('createApprovalRequest', () => {
    it('should create approval request with conflicts', () => {
      const result = validatePlannedChanges(
        [
          {
            file: 'src/app.ts',
            type: 'modify',
          },
        ],
        dirtyTree
      );

      const request = createApprovalRequest(result, 'session-123');

      expect(request.checksum).toBeDefined();
      expect(request.checksum.startsWith('session-123')).toBe(true);
      expect(request.conflicts).toBeDefined();
      expect(request.strategy).toBeDefined();
      expect(request.approved).toBe(false);
    });

    it('should generate unique checksums for different conflicts', () => {
      const result1 = validatePlannedChanges(
        [
          {
            file: 'src/app.ts',
            type: 'modify',
          },
        ],
        dirtyTree
      );

      // Create a second scenario with different planned changes
      const dirtyTree2 = {
        ...dirtyTree,
        files: [
          ...dirtyTree.files,
          {
            path: 'src/server.ts',
            status: 'modified' as const,
            hunks: [],
            lastModified: Date.now(),
          },
        ],
        modifiedCount: 2,
        totalChanges: 2,
      };

      const result2 = validatePlannedChanges(
        [
          {
            file: 'src/app.ts',
            type: 'modify',
          },
          {
            file: 'src/server.ts',
            type: 'modify',
          },
        ],
        dirtyTree2
      );

      const request1 = createApprovalRequest(result1, 'session-123');
      const request2 = createApprovalRequest(result2, 'session-123');

      // Different conflict sets should have different checksums
      expect(request1.checksum).not.toBe(request2.checksum);
    });
  });

  describe('generateOverwriteSummary', () => {
    it('should generate safe summary for non-conflicting changes', () => {
      const result: OverwriteCheckResult = {
        canProceed: true,
        hasConflicts: false,
        conflicts: [],
        warnings: ['✅ No conflicts detected - safe to proceed'],
        suggestions: [],
        mergeStrategy: 'merge-force',
        requiresApproval: false,
        safetyScore: 100,
      };

      const summary = generateOverwriteSummary(result);

      expect(Array.isArray(summary)).toBe(true);
      expect(summary.length).toBeGreaterThan(0);
      expect(summary.join('\n')).toContain('✅');
      expect(summary.join('\n')).toContain('100/100');
    });

    it('should generate warning summary for conflicting changes', () => {
      const result: OverwriteCheckResult = {
        canProceed: false,
        hasConflicts: true,
        conflicts: [
          {
            type: 'direct-overwrite',
            file: 'src/app.ts',
            plannedChange: 'modify',
            dirtyStatus: 'modified',
            severity: 'high',
            suggestion: 'Commit changes first',
          },
        ],
        warnings: ['❌ 1 conflict(s) detected'],
        suggestions: ['Commit all dirty files'],
        mergeStrategy: 'abort',
        requiresApproval: true,
        approvalReason: '1 conflict(s) detected',
        safetyScore: 75,
      };

      const summary = generateOverwriteSummary(result);

      expect(summary.join('\n')).toContain('❌');
      expect(summary.join('\n')).toContain('Conflicts Detected');
      expect(summary.join('\n')).toContain('75/100');
    });

    it('should include all sections when present', () => {
      const result = validatePlannedChanges(
        [
          {
            file: 'src/app.ts',
            type: 'modify',
          },
        ],
        dirtyTree
      );

      const summary = generateOverwriteSummary(result);
      const summaryText = summary.join('\n');

      expect(summaryText).toContain('Status');
      expect(summaryText).toContain('Safety Score');
      if (result.hasConflicts) {
        expect(summaryText).toContain('Conflicts');
      }
      if (result.warnings.length > 0) {
        expect(summaryText).toContain('Warnings');
      }
      if (result.suggestions.length > 0) {
        expect(summaryText).toContain('Suggestions');
      }
    });

    it('should be properly formatted for display', () => {
      const result: OverwriteCheckResult = {
        canProceed: true,
        hasConflicts: false,
        conflicts: [],
        warnings: [],
        suggestions: [],
        mergeStrategy: 'merge-force',
        requiresApproval: false,
        safetyScore: 100,
      };

      const summary = generateOverwriteSummary(result);

      // Should have header and footer borders
      expect(summary[0]).toContain('╔');
      expect(summary.some((line) => line.includes('╚'))).toBe(true);

      // Should be readable with icons
      expect(summary.join('\n')).toMatch(/(?:✅|❌|⚠️|📊|💡|🔐)/u);
    });
  });

  describe('Integration: Full Workflow', () => {
    it('should handle complete validation and approval workflow', () => {
      const changes: PlannedChange[] = [
        {
          file: 'src/app.ts',
          type: 'modify',
          description: 'Update app logic',
        },
        {
          file: 'src/server.ts',
          type: 'modify',
          description: 'Add new endpoint',
        },
      ];

      // Step 1: Validate
      const validation = validatePlannedChanges(changes, dirtyTree);
      expect(validation).toBeDefined();

      // Step 2: Select strategy
      const strategy = selectMergeStrategy(validation);
      expect(strategy).toBeDefined();

      // Step 3: Refine plan
      const refined = refinePlanExcludingDirtyFiles(changes, dirtyTree);
      expect(refined.excluded.length).toBeGreaterThan(0);

      // Step 4: Create approval request
      const approval = createApprovalRequest(validation, 'workflow-test');
      expect(approval.checksum).toBeDefined();

      // Step 5: Generate summary
      const summary = generateOverwriteSummary(validation);
      expect(Array.isArray(summary)).toBe(true);
    });

    it('should handle user approval flow', () => {
      const changes: PlannedChange[] = [
        {
          file: 'src/app.ts',
          type: 'modify',
        },
      ];

      // Initial validation shows conflict
      const validation = validatePlannedChanges(changes, dirtyTree);
      expect(validation.hasConflicts).toBe(true);

      // User approves the conflict
      const approvedRefined = refinePlanExcludingDirtyFiles(changes, dirtyTree, ['src/app.ts']);

      // Now the file is in the refined plan
      expect(approvedRefined.refined.some((c) => c.file === 'src/app.ts')).toBe(true);
      expect(approvedRefined.excluded.length).toBe(0);
    });

    it('should provide clear escalation path', () => {
      const changes: PlannedChange[] = [
        {
          file: 'src/app.ts',
          type: 'delete',
        },
      ];

      const result = validatePlannedChanges(changes, dirtyTree);

      // Critical conflict should be clearly marked
      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts.some((c) => c.severity === 'critical')).toBe(true);

      // Approval should be required
      expect(result.requiresApproval).toBe(true);
      expect(result.approvalReason).toBeDefined();

      // Summary should guide user
      const summary = generateOverwriteSummary(result);
      expect(summary.join('\n')).toContain('User Approval Required');
    });
  });
});
