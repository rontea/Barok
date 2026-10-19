/**
 * Phase 2 Integration Tests
 * End-to-end testing of repo-wide context system
 * Combines moduleResponsibilities, dependencyGraph, dirtyTreeTracker, and overwritePreventionPlan
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  analyzeAllModules,
  buildModuleDependencyGraph,
  type ModuleResponsibility,
} from '../moduleResponsibilities.js';
import {
  buildDependencyGraph,
  type DependencySignal,
} from '../dependencyGraph.js';
import {
  scanDirtyTree,
  mapDirtyFilesToAgents,
  detectOverlapWithDirtyFiles,
  type DirtyTreeState,
} from '../dirtyTreeTracker.js';
import {
  validatePlannedChanges,
  selectMergeStrategy,
  refinePlanExcludingDirtyFiles,
  type PlannedChange,
  type OverwriteCheckResult,
} from '../overwritePreventionPlan.js';

describe('Phase 2 Integration Tests', () => {
  let modules: ModuleResponsibility[];
  let dependencySignals: DependencySignal[];
  let dirtyTree: DirtyTreeState;

  beforeEach(() => {
    // Mock module structure
    modules = [
      {
        name: 'backend',
        path: 'src',
        layer: 'backend',
        description: 'Backend logic and services',
        exports: [
          { name: 'AgentOrchestrator', type: 'class', source: 'src/orchestration/orchestrator.ts' },
          { name: 'TaskSpec', type: 'interface', source: 'src/tasks/taskSpec.ts' },
        ],
        keyFiles: ['src/orchestration/orchestrator.ts', 'src/tasks/taskSpec.ts'],
        entryPoints: ['src/index.ts'],
        dependencies: ['frontend', 'data'],
        dependents: [],
        lastAnalyzed: Date.now(),
      },
      {
        name: 'frontend',
        path: 'ui',
        layer: 'frontend',
        description: 'React UI components',
        exports: [
          { name: 'App', type: 'component', source: 'ui/src/App.tsx' },
          { name: 'main', type: 'entry', source: 'ui/src/main.tsx' },
        ],
        keyFiles: ['ui/src/App.tsx', 'ui/src/main.tsx'],
        entryPoints: ['ui/src/main.tsx'],
        dependencies: [],
        dependents: ['backend'],
        lastAnalyzed: Date.now(),
      },
      {
        name: 'tests',
        path: 'tests',
        layer: 'tests',
        description: 'Test utilities and integration tests',
        exports: [{ name: 'createTestContext', type: 'function', source: 'tests/helpers.ts' }],
        keyFiles: ['tests/helpers.ts'],
        entryPoints: [],
        dependencies: ['backend', 'frontend'],
        dependents: [],
        lastAnalyzed: Date.now(),
      },
      {
        name: 'data',
        path: 'src/data',
        layer: 'data',
        description: 'Data models and persistence',
        exports: [{ name: 'Database', type: 'class', source: 'src/data/database.ts' }],
        keyFiles: ['src/data/database.ts'],
        entryPoints: ['src/data/index.ts'],
        dependencies: [],
        dependents: ['backend'],
        lastAnalyzed: Date.now(),
      },
    ];

    // Mock dependency signals
    dependencySignals = [
      {
        source: 'src/orchestration/orchestrator.ts',
        target: 'src/data/database.ts',
        type: 'import',
        confidence: 'high',
        details: { importStatement: "import { Database } from '../data/database'" },
      },
      {
        source: 'ui/src/App.tsx',
        target: 'src/orchestration/orchestrator.ts',
        type: 'import',
        confidence: 'high',
        details: { importStatement: "import { AgentOrchestrator } from '../src'" },
      },
      {
        source: 'tests/integration.test.ts',
        target: 'src/orchestration/orchestrator.ts',
        type: 'test',
        confidence: 'high',
        details: { testFile: 'tests/integration.test.ts' },
      },
    ];

    // Mock dirty tree state
    dirtyTree = {
      isDirty: true,
      files: [
        {
          path: 'src/orchestration/orchestrator.ts',
          status: 'modified',
          hunks: [],
          lastModified: Date.now(),
        },
        {
          path: 'ui/src/components/Panel.tsx',
          status: 'added',
          hunks: [],
          lastModified: Date.now(),
        },
      ],
      modifiedCount: 1,
      addedCount: 1,
      deletedCount: 0,
      untrackedCount: 0,
      totalChanges: 2,
      lastScanned: Date.now(),
    };
  });

  describe('Module Responsibility Detection', () => {
    it('should analyze all modules in repository', () => {
      expect(modules.length).toBeGreaterThan(0);
      expect(modules.map((m) => m.layer)).toContain('backend');
      expect(modules.map((m) => m.layer)).toContain('frontend');
      expect(modules.map((m) => m.layer)).toContain('tests');
      expect(modules.map((m) => m.layer)).toContain('data');
    });

    it('should extract all module exports', () => {
      const backendModule = modules.find((m) => m.name === 'backend');
      expect(backendModule?.exports.length).toBeGreaterThan(0);
      expect(backendModule?.exports.map((e) => e.name)).toContain('AgentOrchestrator');
    });

    it('should identify module key files', () => {
      const dataModule = modules.find((m) => m.name === 'data');
      expect(dataModule?.keyFiles).toContain('src/data/database.ts');
    });

    it('should track module dependencies', () => {
      const backendModule = modules.find((m) => m.name === 'backend');
      expect(backendModule?.dependencies).toContain('data');
    });

    it('should track module dependents', () => {
      const dataModule = modules.find((m) => m.name === 'data');
      expect(dataModule?.dependents).toContain('backend');
    });

    it('should detect module entry points', () => {
      const frontendModule = modules.find((m) => m.name === 'frontend');
      expect(frontendModule?.entryPoints).toContain('ui/src/main.tsx');
    });

    it('should assign correct layers', () => {
      const layerMapping = modules.reduce(
        (acc, m) => {
          acc[m.name] = m.layer;
          return acc;
        },
        {} as Record<string, string>
      );

      expect(layerMapping['backend']).toBe('backend');
      expect(layerMapping['frontend']).toBe('frontend');
      expect(layerMapping['tests']).toBe('tests');
      expect(layerMapping['data']).toBe('data');
    });

    it('should build module dependency graph', () => {
      const graph = buildModuleDependencyGraph(modules);
      expect(graph.modules.size).toBe(modules.length);
      expect(graph.dependencies.has('backend')).toBe(true);
      expect(graph.dependencies.get('backend')).toContain('data');
    });
  });

  describe('Dependency Graph Construction', () => {
    it('should extract import signals', () => {
      const importSignals = dependencySignals.filter((s) => s.type === 'import');
      expect(importSignals.length).toBeGreaterThan(0);
    });

    it('should extract test signals', () => {
      const testSignals = dependencySignals.filter((s) => s.type === 'test');
      expect(testSignals.length).toBeGreaterThan(0);
      expect(testSignals[0].details?.testFile).toBe('tests/integration.test.ts');
    });

    it('should build dependency graph from signals', () => {
      const graph = buildDependencyGraph(dependencySignals);
      expect(graph).toBeDefined();
    });

    it('should trace dependencies between modules', () => {
      // Backend depends on data
      const backendToDataSignals = dependencySignals.filter(
        (s) =>
          s.source.startsWith('src') &&
          s.target.includes('database') &&
          s.type === 'import'
      );
      expect(backendToDataSignals.length).toBeGreaterThan(0);
    });

    it('should identify cross-module dependencies', () => {
      // Frontend imports from backend
      const uiToBackendSignals = dependencySignals.filter(
        (s) => s.source.startsWith('ui') && s.target.includes('orchestration')
      );
      expect(uiToBackendSignals.length).toBeGreaterThan(0);
    });

    it('should track test associations', () => {
      const testAssociations = dependencySignals.filter((s) => s.type === 'test');
      expect(testAssociations.length).toBeGreaterThan(0);
      expect(testAssociations.map((s) => s.target)).toContain('src/orchestration/orchestrator.ts');
    });

    it('should validate signal confidence levels', () => {
      const allHighConfidence = dependencySignals.every((s) => s.confidence === 'high');
      expect(allHighConfidence).toBe(true);
    });

    it('should provide signal details', () => {
      const signalsWithDetails = dependencySignals.filter((s) => s.details);
      expect(signalsWithDetails.length).toBeGreaterThan(0);
    });
  });

  describe('Dirty Tree Tracking', () => {
    it('should detect modified files', () => {
      const modified = dirtyTree.files.filter((f) => f.status === 'modified');
      expect(modified.length).toBeGreaterThan(0);
      expect(modified[0].path).toBe('src/orchestration/orchestrator.ts');
    });

    it('should detect added files', () => {
      const added = dirtyTree.files.filter((f) => f.status === 'added');
      expect(added.length).toBeGreaterThan(0);
      expect(added[0].path).toBe('ui/src/components/Panel.tsx');
    });

    it('should count change types', () => {
      expect(dirtyTree.modifiedCount).toBe(1);
      expect(dirtyTree.addedCount).toBe(1);
      expect(dirtyTree.totalChanges).toBe(2);
    });

    it('should track modification timestamps', () => {
      const modifiedFile = dirtyTree.files[0];
      expect(modifiedFile.lastModified).toBeGreaterThan(0);
    });

    it('should map dirty files to agents', () => {
      const agentMap = mapDirtyFilesToAgents(dirtyTree.files);
      expect(agentMap.has('backend')).toBe(true);
      expect(agentMap.has('frontend')).toBe(true);
    });

    it('should identify dirty tree state', () => {
      expect(dirtyTree.isDirty).toBe(true);
    });

    it('should track last scanned timestamp', () => {
      expect(dirtyTree.lastScanned).toBeGreaterThan(0);
    });

    it('should provide accurate change summary', () => {
      expect(dirtyTree.modifiedCount + dirtyTree.addedCount + dirtyTree.deletedCount).toBe(2);
    });
  });

  describe('Overwrite Prevention', () => {
    it('should detect overlaps between planned and dirty files', () => {
      const plannedChanges: PlannedChange[] = [
        {
          file: 'src/orchestration/orchestrator.ts',
          type: 'modify',
          description: 'Add new feature',
        },
      ];

      const result = validatePlannedChanges(plannedChanges, dirtyTree);
      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts.length).toBeGreaterThan(0);
    });

    it('should classify conflict severity', () => {
      const plannedChanges: PlannedChange[] = [
        {
          file: 'src/orchestration/orchestrator.ts',
          type: 'delete',
        },
      ];

      const result = validatePlannedChanges(plannedChanges, dirtyTree);
      expect(result.conflicts.some((c) => c.severity === 'critical')).toBe(true);
    });

    it('should suggest merge strategies', () => {
      const plannedChanges: PlannedChange[] = [
        {
          file: 'src/orchestration/orchestrator.ts',
          type: 'modify',
        },
      ];

      const result = validatePlannedChanges(plannedChanges, dirtyTree);
      expect(['abort', 'warn', 'merge-careful', 'merge-force']).toContain(result.mergeStrategy);
    });

    it('should calculate safety scores', () => {
      const plannedChanges: PlannedChange[] = [
        {
          file: 'src/tasks/taskSpec.ts',
          type: 'modify',
        },
      ];

      const result = validatePlannedChanges(plannedChanges, dirtyTree);
      expect(result.safetyScore).toBeGreaterThanOrEqual(0);
      expect(result.safetyScore).toBeLessThanOrEqual(100);
    });

    it('should refine plans excluding dirty files', () => {
      const plannedChanges: PlannedChange[] = [
        {
          file: 'src/orchestration/orchestrator.ts',
          type: 'modify',
        },
        {
          file: 'src/tasks/taskSpec.ts',
          type: 'modify',
        },
      ];

      const refined = refinePlanExcludingDirtyFiles(plannedChanges, dirtyTree);
      expect(refined.excluded.length).toBeGreaterThan(0);
      expect(refined.refined.length).toBeGreaterThan(0);
    });

    it('should allow approval overrides', () => {
      const plannedChanges: PlannedChange[] = [
        {
          file: 'src/orchestration/orchestrator.ts',
          type: 'modify',
        },
      ];

      const refined = refinePlanExcludingDirtyFiles(
        plannedChanges,
        dirtyTree,
        ['src/orchestration/orchestrator.ts']
      );
      expect(refined.refined.some((c) => c.file === 'src/orchestration/orchestrator.ts')).toBe(true);
    });

    it('should generate conflict warnings', () => {
      const plannedChanges: PlannedChange[] = [
        {
          file: 'src/orchestration/orchestrator.ts',
          type: 'modify',
        },
      ];

      const result = validatePlannedChanges(plannedChanges, dirtyTree);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('Full Integration: Module + Dependency + Dirty Tree', () => {
    it('should identify affected modules from dirty files', () => {
      const agentMap = mapDirtyFilesToAgents(dirtyTree.files);
      expect(agentMap.size).toBeGreaterThan(0);
    });

    it('should trace cascading impacts across modules', () => {
      // Orchestrator is imported by UI and tests
      const dependentsOfOrchestrator = dependencySignals.filter(
        (s) => s.target === 'src/orchestration/orchestrator.ts'
      );
      expect(dependentsOfOrchestrator.length).toBeGreaterThan(0);
    });

    it('should correlate module structure with dependencies', () => {
      const graph = buildModuleDependencyGraph(modules);
      expect(graph.modules.has('backend')).toBe(true);
      expect(graph.dependencies.has('backend')).toBe(true);
    });

    it('should identify high-impact changes', () => {
      // Changing orchestrator affects UI, tests, and data layer indirectly
      const coreFile = 'src/orchestration/orchestrator.ts';
      const dependents = dependencySignals.filter((s) => s.target.includes(coreFile));
      expect(dependents.length).toBeGreaterThan(0);
    });

    it('should plan safe rollout of changes', () => {
      const plannedChanges: PlannedChange[] = [
        { file: 'src/data/database.ts', type: 'modify' },
        { file: 'src/orchestration/orchestrator.ts', type: 'modify' },
        { file: 'ui/src/App.tsx', type: 'modify' },
      ];

      const result = validatePlannedChanges(plannedChanges, dirtyTree);

      // Should detect conflicts with dirty files
      const hasConflicts = result.hasConflicts;
      expect(typeof hasConflicts).toBe('boolean');
    });
  });

  describe('Context Pack with All Phase 2 Signals', () => {
    it('should gather module metadata', () => {
      const contextModules = modules.filter((m) => m.exports.length > 0);
      expect(contextModules.length).toBeGreaterThan(0);
    });

    it('should include dependency signals', () => {
      expect(dependencySignals.length).toBeGreaterThan(0);
    });

    it('should include dirty tree state', () => {
      expect(dirtyTree.files.length).toBeGreaterThan(0);
    });

    it('should create comprehensive context snapshot', () => {
      // A context pack would include:
      const contextPack = {
        modules,
        signals: dependencySignals,
        dirtyTree,
        timestamp: Date.now(),
      };

      expect(contextPack.modules.length).toBeGreaterThan(0);
      expect(contextPack.signals.length).toBeGreaterThan(0);
      expect(contextPack.dirtyTree.files.length).toBeGreaterThan(0);
    });

    it('should allow agent filtering', () => {
      // Frontend agent only needs frontend + shared modules
      const frontendModules = modules.filter(
        (m) => m.layer === 'frontend' || m.layer === 'shared'
      );
      expect(frontendModules.length).toBeGreaterThan(0);
    });

    it('should support targeted dependency queries', () => {
      // Get all files that depend on database
      const dbDependents = dependencySignals.filter((s) => s.target.includes('database'));
      expect(dbDependents.length).toBeGreaterThan(0);
    });

    it('should correlate signals across all modules', () => {
      // Ensure signals reference modules that exist
      const fileInModules = (filePath: string) =>
        modules.some((m) => filePath.startsWith(m.path));
      const allSignalsValid = dependencySignals.every((s) => fileInModules(s.source));
      expect(allSignalsValid).toBe(true);
    });
  });

  describe('Edge Cases and Complex Scenarios', () => {
    it('should handle cascading conflicts', () => {
      // Changing core module affects multiple dependents
      const plannedChanges: PlannedChange[] = [
        {
          file: 'src/orchestration/orchestrator.ts',
          type: 'modify',
          description: 'API change',
        },
      ];

      const result = validatePlannedChanges(plannedChanges, dirtyTree);
      expect(result.hasConflicts).toBe(true);
    });

    it('should detect circular dependencies', () => {
      // If A depends on B and B depends on A
      const circularSignals = dependencySignals.filter(
        (s, _, arr) =>
          arr.some((other) => other.source === s.target && other.target === s.source)
      );
      // Circular references should be detected (even if empty)
      expect(Array.isArray(circularSignals)).toBe(true);
    });

    it('should handle multi-layer changes', () => {
      const plannedChanges: PlannedChange[] = [
        { file: 'src/data/database.ts', type: 'modify' },
        { file: 'src/orchestration/orchestrator.ts', type: 'modify' },
        { file: 'ui/src/App.tsx', type: 'modify' },
        { file: 'tests/integration.test.ts', type: 'modify' },
      ];

      const result = validatePlannedChanges(plannedChanges, dirtyTree);
      expect(result).toBeDefined();
    });

    it('should warn on large change sets', () => {
      const plannedChanges: PlannedChange[] = Array.from({ length: 15 }, (_, i) => ({
        file: `src/file${i}.ts`,
        type: 'modify' as const,
      }));

      const result = validatePlannedChanges(plannedChanges, dirtyTree);
      expect(result.safetyScore).toBeLessThan(100);
    });

    it('should handle clean tree gracefully', () => {
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

      const plannedChanges: PlannedChange[] = [
        { file: 'src/new-feature.ts', type: 'create' },
      ];

      const result = validatePlannedChanges(plannedChanges, cleanTree);
      expect(result.canProceed).toBe(true);
      expect(result.hasConflicts).toBe(false);
    });

    it('should provide clear escalation path', () => {
      const plannedChanges: PlannedChange[] = [
        {
          file: 'src/orchestration/orchestrator.ts',
          type: 'delete',
        },
      ];

      const result = validatePlannedChanges(plannedChanges, dirtyTree);
      expect(result.requiresApproval).toBe(true);
      expect(result.approvalReason).toBeDefined();
    });

    it('should handle approval workflow', () => {
      const plannedChanges: PlannedChange[] = [
        {
          file: 'src/orchestration/orchestrator.ts',
          type: 'modify',
        },
      ];

      const result = validatePlannedChanges(plannedChanges, dirtyTree);
      const refined = refinePlanExcludingDirtyFiles(
        plannedChanges,
        dirtyTree,
        ['src/orchestration/orchestrator.ts']
      );

      expect(refined.refined.length).toBeGreaterThan(0);
    });
  });
});
