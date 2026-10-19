import { describe, expect, it, jest } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import path from 'path';
import type { ToolRegistry } from '../../di/types.js';
import type { CoderTaskAnalysis } from '../../coder/taskAnalysis.js';
import { executeAction, validateActionAgainstTaskAnalysis, type ToolAction } from '../executor.js';
import { ToolEvidenceLedger, ToolExecutionState } from '../tool-contract.js';
import { createRunScopedWorkspace, disposeRunScopedWorkspace } from '../run-scoped-workspace.js';
import type { AgentStreamEvent } from '../state-manager.js';

function createAnalysis(overrides: Partial<CoderTaskAnalysis> = {}): CoderTaskAnalysis {
  return {
    id: 'analysis-test',
    userRequest: 'fix the coder panel',
    taskKind: 'bug_fix',
    instanceMode: 'unknown',
    targetLayer: 'ui',
    behaviorScope: 'existing_behavior_fix',
    refactorRisk: 'safe_change',
    confidence: 0.9,
    workspace: process.cwd(),
    mentionedFiles: [],
    inferredFiles: [],
    expectedChangeIntent: 'modify',
    affectedFiles: [
      {
        path: 'ui/src/components/CoderChatPanel.tsx',
        intent: 'modify',
        reason: 'Test affected file.',
        mustReadBeforeEdit: true,
      },
    ],
    riskLevel: 'medium',
    riskFactors: [],
    requiresApproval: true,
    requiredInspections: ['Read ui/src/components/CoderChatPanel.tsx'],
    verificationPlan: ['npm run test:unit'],
    validationRequirements: ['Read each existing target file before editing it.'],
    rationale: 'Test analysis.',
    ...overrides,
  };
}

function createRegistry(handler: jest.Mock): ToolRegistry {
  const tool = {
    name: 'Edit',
    description: 'Edit file',
    inputSchema: {},
    handler,
  };

  return {
    getAll: () => [tool] as any,
    get: (name: string) => (name === 'Edit' || name === 'Write' ? { ...tool, name } as any : undefined),
    getEnabled: () => [tool] as any,
    has: (name: string) => name === 'Edit' || name === 'Write',
    register: () => undefined,
    setEnabled: () => undefined,
    getNames: () => ['Edit', 'Write'],
    size: () => 2,
  };
}

function createMultiToolRegistry(handlers: Record<string, jest.Mock>): ToolRegistry {
  const makeTool = (name: string) => ({
    name,
    description: `${name} tool`,
    inputSchema: {},
    handler: handlers[name],
  });

  return {
    getAll: () => Object.keys(handlers).map(makeTool) as any,
    get: (name: string) => (handlers[name] ? makeTool(name) as any : undefined),
    getEnabled: () => Object.keys(handlers).map(makeTool) as any,
    has: (name: string) => Boolean(handlers[name]),
    register: () => undefined,
    setEnabled: () => undefined,
    getNames: () => Object.keys(handlers),
    size: () => Object.keys(handlers).length,
  };
}

describe('ReAct executor task-analysis guard', () => {
  it('routes legacy Read requests for binary documents through DocumentRead', async () => {
    const readHandler = jest.fn(async () => ({ success: false, error: 'Read should not handle DOCX.' }));
    const documentReadHandler = jest.fn(async () => ({ success: true, output: 'extracted resume text' }));
    const observation = await executeAction(
      { action: 'Read', action_input: { file_path: 'resume.docx' } },
      createMultiToolRegistry({ Read: readHandler, DocumentRead: documentReadHandler }),
    );

    expect(JSON.parse(observation)).toMatchObject({
      success: true,
      toolId: 'DocumentRead',
      output: 'extracted resume text',
    });
    expect(readHandler).not.toHaveBeenCalled();
    expect(documentReadHandler).toHaveBeenCalledWith({ file_path: 'resume.docx' }, undefined);
  });

  it('rejects Write and Edit actions targeting source documents before dispatch', async () => {
    const handler = jest.fn(async () => ({ success: true, output: 'should not run' }));
    const observation = await executeAction(
      {
        action: 'Write',
        action_input: { file_path: 'resume.docx', content: 'replacement content' },
      },
      createRegistry(handler),
    );

    expect(JSON.parse(observation)).toMatchObject({
      success: false,
      status: 'invalid',
      error: expect.stringContaining('read-only source document'),
      nextAction: 'use_document_read_then_mutate_a_non_document_source_file',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses a corrupt transactional write before creating the target file', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-corrupt-write-'));
    const relativePath = 'index.html';
    const observation = await executeAction(
      {
        action: 'Write',
        action_input: {
          file_path: relativePath,
          content: '<!DOCType html x-head="invalid html>\n<html class="\u0008�">',
        },
      },
      createRegistry(jest.fn()),
      undefined,
      {
        workspace,
        useTransactionalEdits: true,
        taskAnalysis: createAnalysis({
          workspace,
          taskKind: 'new_feature',
          expectedChangeIntent: 'create',
          affectedFiles: [],
        }),
        priorSteps: [],
      },
    );

    expect(JSON.parse(observation)).toMatchObject({
      success: false,
      error: expect.stringContaining('Unicode replacement character'),
    });
    expect(existsSync(path.join(workspace, relativePath))).toBe(false);
  });

  it('routes an engine-owned edit through a guarded transactional operation', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-transaction-'));
    const relativePath = 'src/target.ts';
    const absolutePath = path.join(workspace, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, 'export const value = 1;\n', 'utf-8');
    const hash = createHash('sha256').update(readFileSync(absolutePath, 'utf-8'), 'utf-8').digest('hex');
    const legacyHandler = jest.fn(async () => ({ success: true, output: 'legacy handler should not run' }));

    const observation = await executeAction(
      { action: 'Edit', action_input: { file_path: relativePath, old_string: '1', new_string: '2' } },
      createRegistry(legacyHandler),
      undefined,
      {
        workspace,
        useTransactionalEdits: true,
        taskAnalysis: createAnalysis({ workspace, affectedFiles: [{ path: relativePath, intent: 'modify', reason: 'test', mustReadBeforeEdit: true }] }),
        priorSteps: [{ thought: 'Inspect target', action: 'Read', action_input: { file_path: relativePath }, observation: `source\n[guarded-read-hash: ${hash}]` }],
      }
    );

    expect(JSON.parse(observation)).toMatchObject({ success: true, changedFiles: [relativePath], transaction: { atomic: true, executorOwned: true } });
    expect(readFileSync(absolutePath, 'utf-8')).toBe('export const value = 2;\n');
    expect(legacyHandler).not.toHaveBeenCalled();
  });

  it('rebases a stale transactional Edit only when its old string is unique in the current file', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-stale-edit-unique-'));
    const relativePath = 'src/target.ts';
    const absolutePath = path.join(workspace, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    const originallyRead = 'const value = 1;\n';
    const currentContent = 'const value = 1;\n// concurrent update\n';
    writeFileSync(absolutePath, currentContent, 'utf-8');
    const staleHash = createHash('sha256').update(originallyRead, 'utf-8').digest('hex');

    const observation = await executeAction(
      {
        action: 'Edit',
        action_input: {
          file_path: relativePath,
          old_string: 'const value = 1;',
          new_string: 'const value = 2;',
          expectedHash: staleHash,
        },
      },
      createRegistry(jest.fn()),
      undefined,
      {
        workspace,
        useTransactionalEdits: true,
        taskAnalysis: createAnalysis({ workspace, affectedFiles: [{ path: relativePath, intent: 'modify', reason: 'test', mustReadBeforeEdit: true }] }),
        priorSteps: [{
          thought: 'Read target',
          action: 'Read',
          action_input: { file_path: relativePath },
          observation: `const value = 1;\n[guarded-read-hash: ${staleHash}]`,
        }],
      },
    );

    expect(JSON.parse(observation)).toMatchObject({ success: true, staleHashRecovery: 'unique_edit_rebased_to_current_hash' });
    expect(readFileSync(absolutePath, 'utf-8')).toBe('const value = 2;\n// concurrent update\n');
  });

  it('does not rebase a stale Edit when expectedHash is not the latest guarded read hash', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-stale-edit-untrusted-hash-'));
    const relativePath = 'src/target.ts';
    const absolutePath = path.join(workspace, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    const originallyRead = 'const value = 1;\n';
    const currentContent = 'const value = 1;\n// concurrent update\n';
    writeFileSync(absolutePath, currentContent, 'utf-8');
    const guardedHash = createHash('sha256').update(originallyRead, 'utf-8').digest('hex');
    const unrelatedHash = createHash('sha256').update('unrelated state\n', 'utf-8').digest('hex');

    const observation = await executeAction(
      {
        action: 'Edit',
        action_input: {
          file_path: relativePath,
          old_string: 'const value = 1;',
          new_string: 'const value = 2;',
          expectedHash: unrelatedHash,
        },
      },
      createRegistry(jest.fn()),
      undefined,
      {
        workspace,
        useTransactionalEdits: true,
        taskAnalysis: createAnalysis({ workspace, affectedFiles: [{ path: relativePath, intent: 'modify', reason: 'test', mustReadBeforeEdit: true }] }),
        priorSteps: [{
          thought: 'Read target',
          action: 'Read',
          action_input: { file_path: relativePath },
          observation: `const value = 1;\n[guarded-read-hash: ${guardedHash}]`,
        }],
      },
    );

    expect(JSON.parse(observation)).toMatchObject({ success: false, currentHash: createHash('sha256').update(currentContent, 'utf-8').digest('hex') });
    expect(readFileSync(absolutePath, 'utf-8')).toBe(currentContent);
  });

  it('returns a bounded current preimage and leaves the file untouched when a stale Edit is ambiguous', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-stale-edit-ambiguous-'));
    const relativePath = 'src/target.ts';
    const absolutePath = path.join(workspace, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    const currentContent = `${'header\n'.repeat(240)}const value = 1;\nconst value = 1;\nAPI_KEY=topsecret123\n`;
    writeFileSync(absolutePath, currentContent, 'utf-8');
    const staleHash = createHash('sha256').update('const value = 0;\n', 'utf-8').digest('hex');

    const observation = await executeAction(
      {
        action: 'Edit',
        action_input: { file_path: relativePath, old_string: 'const value = 1;', new_string: 'const value = 2;', expectedHash: staleHash },
      },
      createRegistry(jest.fn()),
      undefined,
      {
        workspace,
        useTransactionalEdits: true,
        taskAnalysis: createAnalysis({ workspace, affectedFiles: [{ path: relativePath, intent: 'modify', reason: 'test', mustReadBeforeEdit: true }] }),
        priorSteps: [{
          thought: 'Read target',
          action: 'Read',
          action_input: { file_path: relativePath },
          observation: `[guarded-read-hash: ${staleHash}]`,
        }],
      },
    );
    const result = JSON.parse(observation);

    expect(result).toMatchObject({
      success: false,
      currentHash: createHash('sha256').update(currentContent, 'utf-8').digest('hex'),
      currentMatchStatus: 'ambiguous',
      currentPreimage: { startLine: expect.any(Number), endLine: expect.any(Number), truncatedBefore: true, text: expect.stringContaining('const value = 1;') },
    });
    expect(result.currentPreimage.text.length).toBeLessThanOrEqual(1_200);
    expect(result.currentPreimage.text).toContain('API_KEY=[REDACTED]');
    expect(result.currentPreimage.text).not.toContain('topsecret123');
    expect(readFileSync(absolutePath, 'utf-8')).toBe(currentContent);
  });

  it('returns current evidence instead of automatically reconciling a stale full-file Write', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-stale-write-'));
    const relativePath = 'src/target.ts';
    const absolutePath = path.join(workspace, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    const currentContent = 'const value = 2;\n';
    writeFileSync(absolutePath, currentContent, 'utf-8');
    const staleHash = createHash('sha256').update('const value = 1;\n', 'utf-8').digest('hex');

    const observation = await executeAction(
      { action: 'Write', action_input: { file_path: relativePath, content: 'replace everything', expectedHash: staleHash } },
      createRegistry(jest.fn()),
      undefined,
      {
        workspace,
        useTransactionalEdits: true,
        taskAnalysis: createAnalysis({ workspace, affectedFiles: [{ path: relativePath, intent: 'modify', reason: 'test', mustReadBeforeEdit: true }] }),
        priorSteps: [{
          thought: 'Read target',
          action: 'Read',
          action_input: { file_path: relativePath },
          observation: `[guarded-read-hash: ${staleHash}]`,
        }],
      },
    );
    const result = JSON.parse(observation);

    expect(result).toMatchObject({ success: false, currentHash: createHash('sha256').update(currentContent, 'utf-8').digest('hex') });
    expect(result.error).toContain('Full-file writes are never automatically reconciled');
    expect(result.currentPreimage.text).toContain(currentContent.trim());
    expect(readFileSync(absolutePath, 'utf-8')).toBe(currentContent);
  });

  it('reuses the executor-owned hash when editing a file created earlier in the run', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-created-edit-'));
    const relativePath = 'index.html';
    const legacyHandler = jest.fn(async () => ({ success: true, output: 'legacy handler should not run' }));
    const taskAnalysis = createAnalysis({
      workspace,
      taskKind: 'new_feature',
      expectedChangeIntent: 'create',
      affectedFiles: [],
    });

    const writeAction = {
      action: 'Write',
      action_input: { file_path: relativePath, content: '<html><head></head><body></body></html>' },
    } as ToolAction;
    const writeObservation = await executeAction(
      writeAction,
      createRegistry(legacyHandler),
      undefined,
      { workspace, useTransactionalEdits: true, taskAnalysis, priorSteps: [] },
    );

    const editObservation = await executeAction(
      {
        action: 'Edit',
        action_input: {
          file_path: relativePath,
          old_string: '<head></head>',
          new_string: '<head><link rel="stylesheet" href="style.css"></head>',
        },
      },
      createRegistry(legacyHandler),
      undefined,
      {
        workspace,
        useTransactionalEdits: true,
        taskAnalysis,
        dirtyTree: { isDirty: true, files: [{ path: relativePath, status: 'untracked' as const, hunks: [], lastModified: Date.now() }], modifiedCount: 0, addedCount: 0, deletedCount: 0, untrackedCount: 1, totalChanges: 1, lastScanned: Date.now() },
        dirtyTreeBaseline: { isDirty: false, files: [], modifiedCount: 0, addedCount: 0, deletedCount: 0, untrackedCount: 0, totalChanges: 0, lastScanned: Date.now() },
        priorSteps: [{
          thought: 'Create the page',
          ...writeAction,
          observation: writeObservation,
        }],
      },
    );

    expect(JSON.parse(writeObservation)).toEqual(expect.objectContaining({
      success: true,
      afterHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(JSON.parse(editObservation)).toEqual(expect.objectContaining({
      success: true,
      changedFiles: [relativePath],
    }));
    expect(readFileSync(path.join(workspace, relativePath), 'utf-8')).toContain('href="style.css"');
    expect(legacyHandler).not.toHaveBeenCalled();
  });

  it('rejects a transactional edit that overlaps a user dirty-tree change', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-overlap-'));
    const relativePath = 'src/target.ts';
    const absolutePath = path.join(workspace, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, 'export const value = 1;\n', 'utf-8');
    const hash = createHash('sha256').update(readFileSync(absolutePath, 'utf-8'), 'utf-8').digest('hex');
    const handler = jest.fn(async () => ({ success: true }));
    const dirtyTree = { isDirty: true, files: [{ path: relativePath, status: 'modified' as const, hunks: [], lastModified: Date.now() }], modifiedCount: 1, addedCount: 0, deletedCount: 0, untrackedCount: 0, totalChanges: 1, lastScanned: Date.now() };

    const observation = await executeAction(
      { action: 'Edit', action_input: { file_path: relativePath, old_string: '1', new_string: '2' } },
      createRegistry(handler),
      undefined,
      {
        workspace,
        useTransactionalEdits: true,
        dirtyTree,
        dirtyTreeBaseline: dirtyTree,
        taskAnalysis: createAnalysis({ workspace, taskKind: 'refactor', behaviorScope: 'maintenance', affectedFiles: [{ path: 'src/requested.ts', intent: 'modify', reason: 'test', mustReadBeforeEdit: true }] }),
        priorSteps: [{ thought: 'Inspect target', action: 'Read', action_input: { file_path: relativePath }, observation: `[guarded-read-hash: ${hash}]` }],
      }
    );

    expect(JSON.parse(observation)).toMatchObject({ success: false, error: expect.stringContaining('overlaps uncommitted user changes') });
    expect(readFileSync(absolutePath, 'utf-8')).toBe('export const value = 1;\n');
    expect(handler).not.toHaveBeenCalled();
  });

  it('allows a bug fix to edit a pre-existing dirty file in the requested scope', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-dirty-fix-'));
    const relativePath = 'src/target.ts';
    const absolutePath = path.join(workspace, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, 'export const value = 1;\n', 'utf-8');
    const hash = createHash('sha256').update(readFileSync(absolutePath, 'utf-8'), 'utf-8').digest('hex');
    const handler = jest.fn(async () => ({ success: true }));
    const dirtyTree = { isDirty: true, files: [{ path: relativePath, status: 'modified' as const, hunks: [], lastModified: Date.now() }], modifiedCount: 1, addedCount: 0, deletedCount: 0, untrackedCount: 0, totalChanges: 1, lastScanned: Date.now() };

    const observation = await executeAction(
      { action: 'Edit', action_input: { file_path: relativePath, old_string: '1', new_string: '2' } },
      createRegistry(handler),
      undefined,
      {
        workspace,
        useTransactionalEdits: true,
        dirtyTree,
        dirtyTreeBaseline: dirtyTree,
        taskAnalysis: createAnalysis({
          workspace,
          taskKind: 'bug_fix',
          behaviorScope: 'existing_behavior_fix',
          affectedFiles: [{ path: relativePath, intent: 'modify', reason: 'The bug is in the current dirty change.', mustReadBeforeEdit: true }],
        }),
        priorSteps: [{ thought: 'Inspect target', action: 'Read', action_input: { file_path: relativePath }, observation: `[guarded-read-hash: ${hash}]` }],
      }
    );

    expect(JSON.parse(observation)).toMatchObject({ success: true, changedFiles: [relativePath] });
    expect(readFileSync(absolutePath, 'utf-8')).toBe('export const value = 2;\n');
    expect(handler).not.toHaveBeenCalled();
  });

  it('protects a pre-existing dirty file outside the requested repair scope', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-unrelated-dirty-'));
    const relativePath = 'src/unrelated.ts';
    const absolutePath = path.join(workspace, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, 'export const value = 1;\n', 'utf-8');
    const hash = createHash('sha256').update(readFileSync(absolutePath, 'utf-8'), 'utf-8').digest('hex');
    const handler = jest.fn(async () => ({ success: true }));
    const dirtyTree = { isDirty: true, files: [{ path: relativePath, status: 'modified' as const, hunks: [], lastModified: Date.now() }], modifiedCount: 1, addedCount: 0, deletedCount: 0, untrackedCount: 0, totalChanges: 1, lastScanned: Date.now() };

    const observation = await executeAction(
      { action: 'Edit', action_input: { file_path: relativePath, old_string: '1', new_string: '2' } },
      createRegistry(handler),
      undefined,
      {
        workspace,
        useTransactionalEdits: true,
        dirtyTree,
        dirtyTreeBaseline: dirtyTree,
        taskAnalysis: createAnalysis({
          workspace,
          taskKind: 'refactor',
          behaviorScope: 'maintenance',
          affectedFiles: [{ path: 'src/requested.ts', intent: 'modify', reason: 'Requested target.', mustReadBeforeEdit: true }],
        }),
        priorSteps: [{ thought: 'Inspect unrelated file', action: 'Read', action_input: { file_path: relativePath }, observation: `[guarded-read-hash: ${hash}]` }],
      }
    );

    expect(JSON.parse(observation)).toMatchObject({ success: false, error: expect.stringContaining('overlaps uncommitted user changes') });
    expect(readFileSync(absolutePath, 'utf-8')).toBe('export const value = 1;\n');
    expect(handler).not.toHaveBeenCalled();
  });

  it('records the authoritative policy decision before dispatch', async () => {
    const handler = jest.fn().mockResolvedValue({ success: true, output: 'ok' });
    const policyAudit: any[] = [];

    await executeAction(
      { action: 'Write', action_input: { file_path: 'TODO.md', content: '- [x] item' } },
      createRegistry(handler),
      undefined,
      { workspace: process.cwd(), policy: { mode: 'ask' }, policyAudit }
    );

    expect(handler).not.toHaveBeenCalled();
    expect(policyAudit[0]).toMatchObject({ allowed: false, requiresApproval: true, category: 'write', scope: 'write:TODO.md' });
  });

  it('dispatches an npm install after its persisted scope is approved', async () => {
    const handler = jest.fn().mockResolvedValue({ success: true, output: 'installed' });
    const policyAudit: any[] = [];
    const command = 'npm install --save-dev @eslint/js';

    const observation = await executeAction(
      { action: 'Bash', action_input: { command } },
      createMultiToolRegistry({ Bash: handler }),
      undefined,
      {
        workspace: process.cwd(),
        policy: {
          mode: 'full_workspace',
          approvalGrants: [{ scope: 'install:npm:dev:@eslint/js:cwd=.', decision: 'allow', createdAt: Date.now() }],
        },
        policyAudit,
      },
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(JSON.parse(observation)).toEqual(expect.objectContaining({ success: true }));
    expect(policyAudit[0]).toMatchObject({
      allowed: true,
      requiresApproval: false,
      category: 'install',
      scope: 'install:npm:dev:@eslint/js:cwd=.',
      reason: 'Allowed by reusable approval scope.',
    });
  });

  it('dispatches the structured package install only after authorization', async () => {
    const handler = jest.fn().mockResolvedValue({
      success: true,
      packageInstall: { manager: 'npm', requestedPackages: ['@eslint/js'], verifiedPackages: ['@eslint/js'], missingPackages: [], verified: true },
    });
    const authorized = jest.fn();
    const action = { action: 'PackageInstall', action_input: { manager: 'npm', packages: ['@eslint/js'], dev: true } };

    const blocked = await executeAction(action, createMultiToolRegistry({ PackageInstall: handler }), undefined, {
      workspace: process.cwd(),
      policy: { mode: 'full_workspace' },
      onAuthorized: authorized,
    });
    expect(JSON.parse(blocked)).toEqual(expect.objectContaining({ success: false, policy: expect.objectContaining({ requiresApproval: true }) }));
    expect(handler).not.toHaveBeenCalled();
    expect(authorized).not.toHaveBeenCalled();

    const allowed = await executeAction(action, createMultiToolRegistry({ PackageInstall: handler }), undefined, {
      workspace: process.cwd(),
      policy: {
        mode: 'full_workspace',
        approvalGrants: [{ scope: 'install:npm:dev:@eslint/js:cwd=.', decision: 'allow', createdAt: Date.now() }],
      },
      onAuthorized: authorized,
    });
    expect(JSON.parse(allowed)).toEqual(expect.objectContaining({ success: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(authorized).toHaveBeenCalledWith(action);
  });

  it('rejects mutation for read-only task analysis', () => {
    const action: ToolAction = {
      action: 'Edit',
      action_input: { file_path: 'ui/src/App.tsx', old_string: 'a', new_string: 'b' },
    };

    const error = validateActionAgainstTaskAnalysis(action, {
      taskAnalysis: createAnalysis({
        taskKind: 'investigation',
        expectedChangeIntent: 'read_only',
        affectedFiles: [],
        requiresApproval: false,
      }),
    });

    expect(error).toContain('read-only');
  });

  it('rejects mutation outside affected files unless the file was read during the run', () => {
    const action: ToolAction = {
      action: 'Edit',
      action_input: { file_path: 'src/other.ts', old_string: 'a', new_string: 'b' },
    };

    const error = validateActionAgainstTaskAnalysis(action, {
      taskAnalysis: createAnalysis(),
      priorSteps: [],
    });

    expect(error).toContain('not in affected files');
  });

  it('does not let reading an unscoped verification helper expand task outputs', () => {
    const error = validateActionAgainstTaskAnalysis(
      {
        action: 'Write',
        action_input: { file_path: 'verify.js', content: 'console.log("verify")', allowCreate: true },
      },
      {
        taskAnalysis: createAnalysis(),
        priorSteps: [{
          thought: 'inspect helper',
          action: 'Read',
          action_input: { file_path: 'verify.js' },
          observation: JSON.stringify({ success: true, output: 'missing file' }),
        }],
      }
    );

    expect(error).toContain('verify.js is not a declared task output');
    expect(error).toContain('Do not create or inspect an unrequested verification helper');
    expect(error).toContain('Command operation "verify"');
  });

  it('does not let full access bypass required inspection evidence', () => {
    const action: ToolAction = {
      action: 'Edit',
      action_input: { file_path: 'src/other.ts', old_string: 'a', new_string: 'b' },
    };

    const error = validateActionAgainstTaskAnalysis(action, {
      taskAnalysis: createAnalysis({ approvalPolicy: 'full_access' }),
      priorSteps: [],
    });

    expect(error).toContain('not in affected files');
  });

  it('lets a full-access task create a newly discovered in-workspace file', () => {
    const error = validateActionAgainstTaskAnalysis(
      {
        action: 'Write',
        action_input: {
          file_path: 'about.html',
          content: '<!doctype html>',
          allowCreate: true,
        },
      },
      {
        taskAnalysis: createAnalysis({
          approvalPolicy: 'full_access',
          expectedChangeIntent: 'modify',
          affectedFiles: [],
        }),
        priorSteps: [],
      }
    );

    expect(error).toBeNull();
  });

  it('allows an inspected existing file to be modified with Edit when task analysis has delete intent', () => {
    const error = validateActionAgainstTaskAnalysis(
      {
        action: 'Edit',
        action_input: {
          file_path: 'C:/MPC Project Test/pacman 2/index.html',
          old_string: '<div id="sound"></div>',
          new_string: '',
        },
      },
      {
        workspace: 'C:/MPC Project Test/pacman 2',
        taskAnalysis: createAnalysis({
          taskKind: 'bug_fix',
          expectedChangeIntent: 'delete',
          affectedFiles: [{
            path: 'index.html',
            intent: 'delete',
            reason: 'Explicitly mentioned',
            mustReadBeforeEdit: true,
          }],
        }),
        priorSteps: [{
          thought: 'Inspect index.html before editing',
          action: 'Read',
          action_input: { file_path: 'C:/MPC Project Test/pacman 2/index.html' },
          observation: JSON.stringify({ success: true, output: '<html><div id="sound"></div></html>' }),
        }],
      }
    );

    expect(error).toBeNull();
  });

  it('allows a scoped modify target to be created when the file is missing', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-missing-modify-target-'));
    try {
      const error = validateActionAgainstTaskAnalysis(
        {
          action: 'Write',
          action_input: { file_path: 'README.md', content: '# New README', allowCreate: true },
        },
        {
          taskAnalysis: createAnalysis({
            workspace,
            affectedFiles: [{
              path: 'README.md',
              intent: 'modify',
              reason: 'Scoped documentation target.',
              mustReadBeforeEdit: true,
            }],
          }),
          priorSteps: [],
          workspace,
        },
      );

      expect(error).toBeNull();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('requires a successful read of an affected existing file before mutation', () => {
    const error = validateActionAgainstTaskAnalysis(
      { action: 'Edit', action_input: { file_path: 'ui/src/components/CoderChatPanel.tsx', old_string: 'a', new_string: 'b' } },
      { taskAnalysis: createAnalysis(), priorSteps: [] }
    );
    expect(error).toContain('must be successfully read');
  });

  it('accepts a successful read even when the file contents contain error text', () => {
    const error = validateActionAgainstTaskAnalysis(
      { action: 'Edit', action_input: { file_path: 'src/other.ts', old_string: 'before', new_string: 'after' } },
      {
        taskAnalysis: createAnalysis(),
        priorSteps: [{
          thought: 'Inspect source',
          action: 'Read',
          action_input: { file_path: 'src/other.ts' },
          observation: JSON.stringify({ success: true, output: 'console.error("expected diagnostic");' }),
        }],
      }
    );

    expect(error).toBeNull();
  });

  it('allows a create-classified feature to modify an existing file after reading it', () => {
    const error = validateActionAgainstTaskAnalysis(
      {
        action: 'Write',
        action_input: { file_path: 'index.html', content: '<html></html>', allowCreate: true, allowOverwrite: true },
      },
      {
        taskAnalysis: createAnalysis({ taskKind: 'new_feature', expectedChangeIntent: 'create', affectedFiles: [] }),
        priorSteps: [{
          thought: 'Inspect entry page',
          action: 'Read',
          action_input: { file_path: 'index.html' },
          observation: JSON.stringify({ success: true, output: '<html>old</html>' }),
        }],
      }
    );

    expect(error).toBeNull();
  });

  it('rejects verification before required source mutation evidence exists', async () => {
    const handler = jest.fn(async () => ({ success: true, output: 'tests passed' }));
    const registry = createMultiToolRegistry({ Bash: handler });
    const toolEvidenceLedger = new ToolEvidenceLedger();
    const events: AgentStreamEvent[] = [];
    const observation = await executeAction(
      { action: 'Bash', action_input: { command: 'npm.cmd test' } },
      registry,
      undefined,
      {
        taskAnalysis: createAnalysis(),
        priorSteps: [],
        toolEvidenceLedger,
        toolCallId: 'verification-before-mutation',
        stepSeq: 7,
        onEvent: (event) => events.push(event),
      }
    );
    expect(handler).not.toHaveBeenCalled();
    expect(observation.length).toBeLessThan(500);
    expect(JSON.parse(observation)).toMatchObject({
      success: false,
      status: 'error',
      error: expect.stringContaining('source mutation evidence'),
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'harness_intervention',
      gateName: 'requires_source_mutation',
      targetAction: 'Bash',
      stepSeq: 7,
      toolCallId: 'verification-before-mutation',
      requiredEvidence: [expect.stringContaining('successful source mutation')],
    });
    const [evidence] = toolEvidenceLedger.list();
    expect(evidence).toMatchObject({
      status: 'error',
      harnessIntervention: {
        gateName: 'requires_source_mutation',
        targetAction: 'Bash',
        stepSeq: 7,
      },
      summary: expect.stringContaining('[Harness intervention: requires_source_mutation]'),
    });
  });

  it('allows baseline verification after every existing source target was inspected', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-baseline-verify-'));
    try {
      mkdirSync(path.join(workspace, 'src'), { recursive: true });
      writeFileSync(path.join(workspace, 'src', 'app.ts'), 'export const ready = true;');
      const handler = jest.fn(async () => ({ success: true, output: 'tests passed' }));
      const observation = await executeAction(
        { action: 'Bash', action_input: { command: 'npm.cmd test' } },
        createMultiToolRegistry({ Bash: handler }),
        undefined,
        {
          workspace,
          taskAnalysis: createAnalysis({
            workspace,
            affectedFiles: [{ path: 'src/app.ts', intent: 'modify', reason: 'Existing target.', mustReadBeforeEdit: true }],
          }),
          priorSteps: [{
            thought: 'Inspect existing target',
            action: 'Read',
            action_input: { file_path: 'src/app.ts' },
            observation: JSON.stringify({ success: true, output: 'export const ready = true;' }),
          }],
        }
      );

      expect(handler).toHaveBeenCalledTimes(1);
      expect(JSON.parse(observation)).toMatchObject({ success: true, output: 'tests passed' });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('allows verification when a continuation handoff records the matching source mutation', async () => {
    const handler = jest.fn(async () => ({ success: true, output: 'tests passed' }));
    const observation = await executeAction(
      { action: 'Bash', action_input: { command: 'npm.cmd test' } },
      createMultiToolRegistry({ Bash: handler }),
      undefined,
      {
        taskAnalysis: createAnalysis({
          affectedFiles: [{ path: 'ui/src/components/CoderChatPanel.tsx', intent: 'modify', reason: 'Existing target.', mustReadBeforeEdit: true }],
        }),
        priorSteps: [],
        continuationHandoff: { updatedFiles: ['ui/src/components/CoderChatPanel.tsx'] } as any,
      }
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(JSON.parse(observation)).toMatchObject({ success: true, output: 'tests passed' });
  });

  it('allows mutation outside affected files after a successful read justifies it', () => {
    const action: ToolAction = {
      action: 'Edit',
      action_input: { file_path: 'src/other.ts', old_string: 'a', new_string: 'b' },
    };

    const error = validateActionAgainstTaskAnalysis(action, {
      taskAnalysis: createAnalysis(),
      priorSteps: [
        {
          thought: 'inspect related file',
          action: 'Read',
          action_input: { file_path: 'src/other.ts' },
          observation: JSON.stringify({ success: true, output: 'const a = 1;' }),
        },
      ],
    });

    expect(error).toBeNull();
  });

  it('matches an absolute action path to a workspace-relative affected file', () => {
    const workspace = path.resolve('C:/MPC Project Test/test 3');
    const error = validateActionAgainstTaskAnalysis(
      {
        action: 'Write',
        action_input: {
          file_path: path.join(workspace, 'TODO.md'),
          content: '# TODO\n',
          allowCreate: true,
        },
      },
      {
        workspace,
        taskAnalysis: createAnalysis({
          workspace,
          expectedChangeIntent: 'modify',
          affectedFiles: [
            {
              path: 'TODO.md',
              intent: 'create',
              reason: 'Requested new tracker.',
              mustReadBeforeEdit: false,
            },
          ],
        }),
        priorSteps: [],
      }
    );

    expect(error).toBeNull();
  });

  it('rejects operations that do not match file-level intent', () => {
    const action: ToolAction = {
      action: 'Edit',
      action_input: { file_path: 'ui/src/components/NewPanel.tsx', old_string: 'a', new_string: 'b' },
    };

    const error = validateActionAgainstTaskAnalysis(action, {
      taskAnalysis: createAnalysis({
        taskKind: 'new_feature',
        expectedChangeIntent: 'create',
        affectedFiles: [
          {
            path: 'ui/src/components/NewPanel.tsx',
            intent: 'create',
            reason: 'New component.',
            mustReadBeforeEdit: false,
          },
        ],
      }),
    });

    expect(error).toContain('expects create');
  });

  it('emits an intent_mismatch intervention when a mutation conflicts with task-analysis intent', async () => {
    const handler = jest.fn(async () => ({ success: true, output: 'edited' }));
    const events: AgentStreamEvent[] = [];
    const target = 'ui/src/components/NewPanel.tsx';
    const observation = await executeAction(
      { action: 'Edit', action_input: { file_path: target, old_string: 'a', new_string: 'b' } },
      createRegistry(handler),
      undefined,
      {
        taskAnalysis: createAnalysis({
          taskKind: 'new_feature',
          expectedChangeIntent: 'create',
          affectedFiles: [{ path: target, intent: 'create', reason: 'New component.', mustReadBeforeEdit: false }],
        }),
        priorSteps: [{
          thought: 'Inspect target',
          action: 'Read',
          action_input: { file_path: target },
          observation: JSON.stringify({ success: true, output: 'a' }),
        }],
        stepSeq: 3,
        onEvent: (event) => events.push(event),
      }
    );

    expect(handler).not.toHaveBeenCalled();
    expect(JSON.parse(observation).error).toContain('expects create');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'harness_intervention', gateName: 'intent_mismatch', stepSeq: 3 });
  });

  it('returns failed tool observation without dispatching rejected mutations', async () => {
    const handler = jest.fn(async () => ({ success: true, output: 'edited' }));
    const observation = await executeAction(
      {
        action: 'Edit',
        action_input: { file_path: 'src/other.ts', old_string: 'a', new_string: 'b' },
      },
      createRegistry(handler),
      undefined,
      { taskAnalysis: createAnalysis(), priorSteps: [] }
    );

    expect(handler).not.toHaveBeenCalled();
    expect(JSON.parse(observation)).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('not in affected files'),
      })
    );
  });

  it('normalizes a unique relative path correction before normal policy and task checks', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-scoped-path-correction-'));
    const handler = jest.fn(async (params: any) => ({ success: true, output: `created ${params.file_path}` }));
    const onActionNormalized = jest.fn();
    const target = 'index.html';
    const analysis = createAnalysis({
      workspace,
      taskKind: 'new_feature',
      expectedChangeIntent: 'create',
      approvalPolicy: 'full_access',
      affectedFiles: [{ path: target, intent: 'create', reason: 'Declared app output.', mustReadBeforeEdit: false }],
    });

    const observation = await executeAction(
      { action: 'Write', action_input: { file_path: '../index.html', content: '<!doctype html>' } },
      createRegistry(handler),
      undefined,
      { workspace, taskAnalysis: analysis, policy: { mode: 'full_workspace' }, onActionNormalized },
    );

    expect(JSON.parse(observation).success).toBe(true);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ file_path: target }), undefined);
    expect(onActionNormalized).toHaveBeenCalledWith(expect.objectContaining({
      action: 'Write',
      action_input: expect.objectContaining({ file_path: target }),
    }));
  });

  it('rejects ambiguous and external paths with an intervention and omits them from the next action', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-rejected-path-'));
    const handler = jest.fn(async () => ({ success: true, output: 'must not run' }));
    const events: AgentStreamEvent[] = [];
    const onActionNormalized = jest.fn();
    const analysis = createAnalysis({
      workspace,
      taskKind: 'new_feature',
      expectedChangeIntent: 'create',
      approvalPolicy: 'full_access',
      affectedFiles: [
        { path: 'one/index.html', intent: 'create', reason: 'Declared app output.', mustReadBeforeEdit: false },
        { path: 'two/index.html', intent: 'create', reason: 'Declared app output.', mustReadBeforeEdit: false },
      ],
    });
    const toolExecutionState = new ToolExecutionState();

    const ambiguous = await executeAction(
      { action: 'Write', action_input: { file_path: '../index.html', content: 'ambiguous' } },
      createRegistry(handler),
      undefined,
      { workspace, taskAnalysis: analysis, policy: { mode: 'full_workspace' }, onEvent: (event) => events.push(event), onActionNormalized, toolExecutionState, stepSeq: 4 },
    );
    const externalPath = path.join(tmpdir(), 'react-engine', 'workspaces', 'task-not-created', 'index.html');
    const external = await executeAction(
      { action: 'Write', action_input: { file_path: externalPath, content: 'outside' } },
      createRegistry(handler),
      undefined,
      { workspace, taskAnalysis: analysis, policy: { mode: 'full_workspace' }, onEvent: (event) => events.push(event), onActionNormalized, toolExecutionState, stepSeq: 5 },
    );
    const repeated = await executeAction(
      { action: 'Write', action_input: { file_path: externalPath, content: 'outside' } },
      createRegistry(handler),
      undefined,
      { workspace, taskAnalysis: analysis, policy: { mode: 'full_workspace' }, toolExecutionState },
    );
    const unresolvedTemp = await executeAction(
      { action: 'Write', action_input: { file_path: '%TEMP%\\react-engine\\workspaces\\task-not-created\\index.html', content: 'unresolved temp' } },
      createRegistry(handler),
      undefined,
      { workspace, taskAnalysis: analysis, policy: { mode: 'full_workspace' }, onEvent: (event) => events.push(event), stepSeq: 6 },
    );
    const unresolvedTmpDir = await executeAction(
      { action: 'Write', action_input: { file_path: '$TMPDIR/react-engine/workspaces/task-not-created/index.html', content: 'unresolved temp' } },
      createRegistry(handler),
      undefined,
      { workspace, taskAnalysis: analysis, policy: { mode: 'full_workspace' }, onEvent: (event) => events.push(event), stepSeq: 7 },
    );

    expect(JSON.parse(ambiguous)).toMatchObject({ success: false, status: 'denied' });
    expect(JSON.parse(external)).toMatchObject({ success: false, status: 'denied' });
    expect(JSON.parse(repeated).status).toBe('denied_retry');
    expect(JSON.parse(unresolvedTemp)).toMatchObject({ success: false, status: 'denied' });
    expect(JSON.parse(unresolvedTmpDir)).toMatchObject({ success: false, status: 'denied' });
    expect(handler).not.toHaveBeenCalled();
    expect(existsSync(externalPath)).toBe(false);
    expect(events.filter((event) => event.type === 'harness_intervention')).toHaveLength(4);
    expect(onActionNormalized.mock.calls.some(([action]) => action.action_input.file_path === externalPath)).toBe(false);
  });

  it('allows only an existing harness-created temp workspace bound to the same run and task', async () => {
    const capability = await createRunScopedWorkspace({ runId: 'temp-scoped-run', taskScoped: true });
    try {
      const handler = jest.fn(async (params: any) => ({ success: true, output: `created ${params.file_path}` }));
      const analysis = createAnalysis({
        workspace: capability.root,
        taskKind: 'new_feature',
        expectedChangeIntent: 'create',
        approvalPolicy: 'full_access',
        affectedFiles: [{ path: 'index.html', intent: 'create', reason: 'Declared app output.', mustReadBeforeEdit: false }],
      });
      const allowed = await executeAction(
        { action: 'Write', action_input: { file_path: 'index.html', content: '<!doctype html>' } },
        createRegistry(handler),
        undefined,
        {
          workspace: capability.root,
          taskAnalysis: analysis,
          runId: 'temp-scoped-run',
          runScopedWorkspaceCapability: capability,
          policy: { mode: 'full_workspace' },
        },
      );
      const otherRun = await executeAction(
        { action: 'Write', action_input: { file_path: 'index.html', content: 'wrong run' } },
        createRegistry(handler),
        undefined,
        {
          workspace: capability.root,
          taskAnalysis: analysis,
          runId: 'different-run',
          runScopedWorkspaceCapability: capability,
          policy: { mode: 'full_workspace' },
        },
      );

      expect(JSON.parse(allowed).success).toBe(true);
      expect(JSON.parse(otherRun)).toMatchObject({ success: false, status: 'denied' });
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      await disposeRunScopedWorkspace(capability);
    }
  });

  it('allows broad project creation writes when no affected files were inferred', async () => {
    const handler = jest.fn(async (params: any) => ({ success: true, output: `created ${params.file_path}` }));
    const observation = await executeAction(
      {
        action: 'Write',
        action_input: { file_path: 'index.html', content: '<!doctype html>' },
      },
      createRegistry(handler),
      undefined,
      {
        taskAnalysis: createAnalysis({
          taskKind: 'new_feature',
          expectedChangeIntent: 'create',
          affectedFiles: [],
        }),
        priorSteps: [],
      }
    );

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        file_path: 'index.html',
        allowCreate: true,
      }),
      undefined
    );
    expect(JSON.parse(observation)).toEqual(
      expect.objectContaining({
        success: true,
      })
    );
  });

  it('adds expectedHash from a prior guarded read before dispatching an edit', async () => {
    const handler = jest.fn(async () => ({ success: true, output: 'edited' }));
    const hash = 'a'.repeat(64);

    await executeAction(
      {
        action: 'Edit',
        action_input: {
          file_path: 'TODO.md',
          old_string: '- [ ] item',
          new_string: '- [x] item',
        },
      },
      createRegistry(handler),
      undefined,
      {
        priorSteps: [
          {
            thought: 'Read TODO',
            action: 'Read',
            action_input: { file_path: 'TODO.md' },
            observation: JSON.stringify({
              success: true,
              output: `- [ ] item\n\n[guarded-read-hash: ${hash}]`,
            }),
          },
        ],
      }
    );

    expect(handler).toHaveBeenCalledWith(
      {
        file_path: 'TODO.md',
        old_string: '- [ ] item',
        new_string: '- [x] item',
        expectedHash: hash,
      },
      undefined
    );
  });

  it('adds expectedHash and allowOverwrite from a prior guarded read before dispatching a write rewrite', async () => {
    const handler = jest.fn(async () => ({ success: true, output: 'written' }));
    const hash = 'b'.repeat(64);

    await executeAction(
      {
        action: 'Write',
        action_input: {
          file_path: 'TODO.md',
          content: '- [x] item',
        },
      },
      createRegistry(handler),
      undefined,
      {
        priorSteps: [
          {
            thought: 'Read TODO',
            action: 'Read',
            action_input: { file_path: 'TODO.md' },
            observation: JSON.stringify({
              success: true,
              output: `- [ ] item\n\n[guarded-read-hash: ${hash}]`,
            }),
          },
        ],
      }
    );

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        file_path: 'TODO.md',
        content: '- [x] item',
        expectedHash: hash,
        allowOverwrite: true,
      }),
      undefined
    );
  });

  it('normalizes a missing scoped modify Write into an allowed create', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-normalize-missing-write-'));
    try {
      const handler = jest.fn(async () => ({ success: true, output: 'created README' }));
      const analysis = createAnalysis({
        workspace,
        affectedFiles: [{
          path: 'README.md',
          intent: 'modify',
          reason: 'Scoped documentation target.',
          mustReadBeforeEdit: true,
        }],
      });

      const observation = await executeAction(
        { action: 'Write', action_input: { file_path: 'README.md', content: '# New README' } },
        createRegistry(handler),
        undefined,
        { taskAnalysis: analysis, workspace },
      );

      expect(JSON.parse(observation)).toMatchObject({ success: true });
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ file_path: 'README.md', allowCreate: true, allowOverwrite: false }),
        undefined,
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('uses the structured read hash for full-access transactional overwrites', async () => {
    const handler = jest.fn(async () => ({ success: true, output: 'written' }));
    const hash = 'c'.repeat(64);

    await executeAction(
      { action: 'Write', action_input: { file_path: 'index.html', content: '<html></html>' } },
      createRegistry(handler),
      undefined,
      {
        priorSteps: [{
          thought: 'Read current HTML',
          action: 'Read',
          action_input: { file_path: 'index.html' },
          observation: JSON.stringify({ success: true, output: '<html>', hash }),
        }],
      },
    );

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ expectedHash: hash, allowOverwrite: true }),
      undefined,
    );
  });

  it('requires a fresh guarded read before rewriting an existing repair target', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-guarded-repair-'));
    try {
      const filePath = path.join(workspace, 'script.js');
      writeFileSync(filePath, 'window.ready = false;');
      const analysis = createAnalysis({
        workspace,
        affectedFiles: [{
          path: 'script.js',
          intent: 'modify',
          reason: 'Referenced by verification repair.',
          mustReadBeforeEdit: true,
        }],
        requiredInspections: ['Read script.js'],
      });

      const blocked = await executeAction(
        { action: 'Write', action_input: { file_path: 'script.js', content: 'window.ready = true;' } },
        createRegistry(jest.fn()),
        undefined,
        { workspace, useTransactionalEdits: true, taskAnalysis: analysis, priorSteps: [] },
      );
      expect(JSON.parse(blocked).error).toContain('must be successfully read');

      const hash = createHash('sha256').update(readFileSync(filePath)).digest('hex');
      const repaired = await executeAction(
        { action: 'Write', action_input: { file_path: 'script.js', content: 'window.ready = true;' } },
        createRegistry(jest.fn()),
        undefined,
        {
          workspace,
          useTransactionalEdits: true,
          taskAnalysis: analysis,
          priorSteps: [{
            thought: 'Read script.js',
            action: 'Read',
            action_input: { file_path: 'script.js' },
            observation: JSON.stringify({ success: true, output: 'window.ready = false;', hash }),
          }],
        },
      );
      expect(JSON.parse(repaired)).toEqual(expect.objectContaining({ success: true }));
      expect(readFileSync(filePath, 'utf8')).toBe('window.ready = true;');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('rejects an empty Edit action before dispatch', async () => {
    const handler = jest.fn(async () => ({ success: true, output: 'edited' }));
    const observation = await executeAction(
      {
        action: 'Edit',
        action_input: {},
      },
      createRegistry(handler)
    );

    expect(handler).not.toHaveBeenCalled();
    expect(JSON.parse(observation)).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('file_path is required'),
      })
    );
  });

  it('normalizes old_str and new_str aliases before dispatching an edit', async () => {
    const handler = jest.fn(async () => ({ success: true, output: 'edited' }));
    await executeAction(
      {
        action: 'Edit',
        action_input: { file_path: 'TODO.md', old_str: '- [ ] item', new_str: '- [x] item' },
      },
      createRegistry(handler)
    );

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        old_string: '- [ ] item',
        new_string: '- [x] item',
      }),
      undefined
    );
  });

  it('normalizes search and replace aliases before dispatching an edit', async () => {
    const handler = jest.fn(async () => ({ success: true, output: 'edited' }));
    await executeAction(
      {
        action: 'Edit',
        action_input: { filename: 'TODO.md', search: '- [ ] item', replace: '- [x] item' },
      },
      createRegistry(handler)
    );

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        file_path: 'TODO.md',
        old_string: '- [ ] item',
        new_string: '- [x] item',
      }),
      undefined
    );
  });

  it('normalizes filename aliases before dispatching a write', async () => {
    const handler = jest.fn(async () => ({ success: true, output: 'written' }));
    await executeAction(
      {
        action: 'Write',
        action_input: { filename: 'TODO.md', content: '- [ ] item' },
      },
      createRegistry(handler)
    );

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        file_path: 'TODO.md',
        content: '- [ ] item',
      }),
      undefined
    );
  });

  it('skips known-unavailable npm verification when package.json is missing', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-no-package-'));
    const handler = jest.fn(async () => ({ success: false, error: 'should not run' }));
    const observation = await executeAction(
      {
        action: 'Bash',
        action_input: { command: 'npm run test:unit', cwd: workspace },
      },
      createMultiToolRegistry({ Bash: handler }),
      undefined,
      { workspace }
    );

    expect(handler).not.toHaveBeenCalled();
    expect(JSON.parse(observation)).toEqual(
      expect.objectContaining({
        success: true,
        skipped: true,
        verificationUnavailable: true,
      })
    );
  });

  it('skips Git confirmation prompts when approval policy pre-approves execution', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-no-git-'));
    const handler = jest.fn(async () => ({ success: false, error: 'should not run' }));
    const observation = await executeAction(
      {
        action: 'Bash',
        action_input: { command: 'git status', cwd: workspace },
      },
      createMultiToolRegistry({ Bash: handler }),
      undefined,
      {
        workspace,
        taskAnalysis: createAnalysis({ approvalPolicy: 'auto_approve' }),
      }
    );

    expect(handler).not.toHaveBeenCalled();
    expect(JSON.parse(observation)).toEqual(
      expect.objectContaining({
        success: true,
        skipped: true,
        approvalPolicy: 'auto_approve',
      })
    );
  });

  it('persists oversized tool observations and returns a compact preview', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-large-output-'));
    const largeOutput = 'x'.repeat(25_000);
    const handler = jest.fn(async () => ({ success: true, output: largeOutput }));

    const observation = await executeAction(
      {
        action: 'Bash',
        action_input: { command: 'echo lots' },
      },
      createMultiToolRegistry({ Bash: handler }),
      undefined,
      { workspace }
    );

    const parsed = JSON.parse(observation);
    expect(parsed.success).toBe(true);
    expect(parsed.output.length).toBeLessThan(largeOutput.length);
    expect(parsed.fullOutput).toEqual(
      expect.objectContaining({
        persisted: true,
        originalLength: largeOutput.length,
      })
    );
    expect(existsSync(parsed.fullOutput.path)).toBe(true);
    expect(readFileSync(parsed.fullOutput.path, 'utf-8')).toContain(largeOutput);
  });

  it('preserves guarded read hash when oversized read observations are compacted', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-engine-large-read-'));
    const hash = 'c'.repeat(64);
    const largeOutput = `${'x'.repeat(25_000)}\n\n[guarded-read-hash: ${hash}]`;
    const readHandler = jest.fn(async () => ({ success: true, output: largeOutput }));
    const editHandler = jest.fn(async () => ({ success: true, output: 'edited' }));

    const readObservation = await executeAction(
      {
        action: 'Read',
        action_input: { file_path: 'large.ts' },
      },
      createMultiToolRegistry({ Read: readHandler }),
      undefined,
      { workspace }
    );

    expect(readObservation).toContain(`[guarded-read-hash: ${hash}]`);

    await executeAction(
      {
        action: 'Edit',
        action_input: { file_path: 'large.ts', old_string: 'x', new_string: 'y' },
      },
      createMultiToolRegistry({ Edit: editHandler }),
      undefined,
      {
        workspace,
        priorSteps: [
          {
            thought: 'Read large file',
            action: 'Read',
            action_input: { file_path: 'large.ts' },
            observation: readObservation,
          },
        ],
      }
    );

    expect(editHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedHash: hash,
      }),
      undefined
    );
  });

  it('rejects an action whose normalized tool is not in the registry before dispatch', async () => {
    const handler = jest.fn(async () => ({ success: true, output: 'should not run' }));
    const observation = await executeAction(
      { action: 'NotRegistered', action_input: {} },
      createMultiToolRegistry({ Read: handler })
    );

    expect(JSON.parse(observation)).toEqual({
      success: false,
      error: 'Invalid normalized action: Unknown tool: NotRegistered',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not apply the generic timeout while AskUserQuestion waits for a response', async () => {
    jest.useFakeTimers();
    try {
      let resolveQuestion!: (result: unknown) => void;
      const handler = jest.fn(() => new Promise((resolve) => {
        resolveQuestion = resolve;
      }));
      const controller = new AbortController();
      const actionPromise = executeAction(
        {
          action: 'AskUserQuestion',
          action_input: { question: 'Which option should I use?', options: ['A', 'B'] },
        },
        createMultiToolRegistry({ AskUserQuestion: handler }),
        controller.signal,
      );

      await jest.advanceTimersByTimeAsync(30_001);
      expect(handler).toHaveBeenCalledTimes(1);

      let settled = false;
      void actionPromise.then(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);

      resolveQuestion({ success: true, output: 'B' });
      await expect(actionPromise).resolves.toContain('B');
    } finally {
      jest.useRealTimers();
    }
  });
});
