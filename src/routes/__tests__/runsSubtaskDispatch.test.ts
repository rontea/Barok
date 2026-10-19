import express from 'express';
import { createServer, type Server } from 'http';
import { jest, afterEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { SQLiteAppStore } from '../../persistence/sqliteStore.js';
import { ServerRunManager } from '../../react/run-manager.js';

const fakeEngineConfigs: Array<Record<string, any>> = [];
const fakeEngineCalls: Array<{ config: Record<string, any>; task: string; initialState: Record<string, any> }> = [];

jest.unstable_mockModule('../../react/engine.js', () => ({
  ReActEngine: class {
    private readonly config: Record<string, any>;

    constructor(config: Record<string, any>) {
      this.config = config;
      fakeEngineConfigs.push(config);
    }

    async run(task: string, initialState: Record<string, any> = {}) {
      fakeEngineCalls.push({ config: this.config, task, initialState });
      if (this.config.onSubtaskDispatch) {
        const analysis = initialState.taskAnalysis;
        await this.config.onSubtaskDispatch({
          ...initialState,
          task,
          workspace: this.config.workspace,
          modelContextWindow: this.config.contextWindow || initialState.modelContextWindow,
          taskAnalysis: analysis,
          plan: [
            { step: 'Inspect src/alpha.ts', status: 'pending' },
            { step: 'Inspect src/beta.ts', status: 'pending' },
          ],
          steps: [],
          current_step: 0,
        }, 'context_pressure');
      }
      return { success: true, steps: [], stepCount: 0, pollenCost: 0, changedFiles: [] };
    }
  },
}));

const { createRouter } = await import('../runs.js');

const servers: Server[] = [];
const stores: SQLiteAppStore[] = [];
const temporaryRoots: string[] = [];

describe('run subtask dispatch integration', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    for (const store of stores.splice(0)) store.close();
    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
    fakeEngineConfigs.length = 0;
    fakeEngineCalls.length = 0;
  });

  it('starts fresh sequential child runs pinned to the parent model, context, and restricted policy', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'runs-subtask-dispatch-'));
    temporaryRoots.push(root);
    const store = new SQLiteAppStore(path.join(root, 'runs.sqlite'));
    stores.push(store);
    const manager = new ServerRunManager(store);
    const app = express();
    app.use(express.json());
    app.use(createRouter({
      runManager: manager,
      ensureWorkspaceRoot: async (workspace) => workspace || root,
      getRepositoryCommitHash: async () => 'test-commit',
    }));
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP address.');

    const parentModel = 'test-model';
    const parentContextWindow = 16_384;
    const taskAnalysis = {
      id: 'read-only-parent-task',
      userRequest: 'Inspect two source files and report findings.',
      taskKind: 'investigation',
      instanceMode: 'continuation',
      targetLayer: 'backend',
      behaviorScope: 'read_only',
      refactorRisk: 'safe_change',
      confidence: 0.9,
      workspace: root,
      mentionedFiles: ['src/alpha.ts', 'src/beta.ts'],
      inferredFiles: [],
      sourceFiles: ['src/alpha.ts', 'src/beta.ts'],
      expectedChangeIntent: 'read_only',
      affectedFiles: ['src/alpha.ts', 'src/beta.ts'].map((file) => ({
        path: file,
        intent: 'read_only',
        reason: 'Inspect the scoped file for the requested report.',
        mustReadBeforeEdit: false,
      })),
      riskLevel: 'low',
      riskFactors: [],
      requiresApproval: false,
      approvalPolicy: 'ask',
      requiredInspections: [],
      verificationPlan: ['Report observations for the scoped file.'],
      validationRequirements: [],
      rationale: 'The request is read-only.',
    };
    const response = await fetch(`http://127.0.0.1:${address.port}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'react',
        task: taskAnalysis.userRequest,
        model: parentModel,
        workspace: root,
        enableSubtaskDispatch: true,
        metadata: {
          taskAnalysis,
          modelContextWindow: parentContextWindow,
          capabilityPack: 'read-only-inspection',
          capabilityPackDefinition: {
            id: 'read-only-inspection',
            allowedTools: ['Read'],
            deniedTools: ['Write', 'Edit'],
            approvalScopes: ['src/alpha.ts', 'src/beta.ts'],
            policyMode: 'read_only',
          },
        },
        resumeState: {
          taskAnalysis,
          modelContextWindow: parentContextWindow,
          plan: [],
          steps: [],
          current_step: 0,
        },
      }),
    });

    expect(response.status).toBe(200);
    const { runId } = await response.json() as { runId: string };
    await manager.waitForRun(runId);

    const children = manager.listChildRuns(runId);
    expect(children).toHaveLength(2);
    expect(children.map((child) => child.contract?.id).sort()).toEqual(['subtask-01', 'subtask-02']);
    for (const child of children) {
      expect(child.status).toBe('completed');
      expect(child.provider).toBe('fresh');
      expect(child.model).toBe(parentModel);
      expect(child.modelTarget).toMatchObject({ requestedTarget: parentModel, resolvedModel: parentModel });
      expect(child.modelContextWindow).toBe(parentContextWindow);
      expect(child.capabilities).toMatchObject({
        pack: 'read-only-inspection',
        allowedTools: ['Read'],
        deniedTools: expect.arrayContaining(['Write', 'Edit']),
        approvalMode: 'read_only',
        approvalScopes: ['src/alpha.ts', 'src/beta.ts'],
      });
    }
    const childEngineConfigs = fakeEngineConfigs.filter((config) => config.parentRunId === runId);
    expect(childEngineConfigs).toHaveLength(2);
    expect(childEngineConfigs.every((config) => config.contextWindow === parentContextWindow)).toBe(true);
    expect(childEngineConfigs.every((config) => config.onSubtaskDispatch === undefined)).toBe(true);
    const childEngineCalls = fakeEngineCalls.filter((call) => call.config.parentRunId === runId);
    expect(childEngineCalls).toHaveLength(2);
    expect(childEngineCalls.every((call) => Object.keys(call.initialState).length === 0)).toBe(true);
    expect(childEngineCalls.every((call) => call.task.includes('BOUNDED SUBTASK CONTRACT'))).toBe(true);
  });
});
