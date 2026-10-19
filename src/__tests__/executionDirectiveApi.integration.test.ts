import { spawn, type ChildProcess } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { createServer } from 'net';
import { tmpdir } from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

jest.setTimeout(30_000);

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(baseUrl: string, process: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Test server exited with code ${process.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/api/workspace/default`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the test server.');
}

async function waitForExit(process: ChildProcess, timeoutMs = 3_000): Promise<void> {
  if (process.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    process.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe('autonomous agent API integration', () => {
  let serverProcess: ChildProcess;
  let baseUrl: string;
  const root = mkdtempSync(path.join(tmpdir(), 'react-engine-directive-api-'));

  beforeAll(async () => {
    const port = await reservePort();
    baseUrl = `http://127.0.0.1:${port}`;
    serverProcess = spawn(
      process.execPath,
      ['--import', 'tsx', 'server.ts', '--port', String(port)],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'production',
          REACT_ENGINE_DB_PATH: path.join(root, 'runs.sqlite'),
          REACT_TARGET_FOLDER: path.join(root, 'workspace'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    await waitForServer(baseUrl, serverProcess);
  });

  it('returns a sanitized liveness response', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    const health = await response.json() as any;
    expect(response.status).toBe(200);
    expect(health).toEqual(expect.objectContaining({ ok: true, status: 'ok' }));
    expect(typeof health.uptime).toBe('number');
    expect(typeof health.pid).toBe('number');
    expect(typeof health.port).toBe('number');
    expect(health).not.toHaveProperty('apiKey');
  });

  afterAll(async () => {
    if (!serverProcess || serverProcess.exitCode !== null) return;
    serverProcess.kill('SIGTERM');
    await waitForExit(serverProcess);
    if (serverProcess.exitCode === null) serverProcess.kill('SIGKILL');
  });

  it('persists a workspace project guide for UI editing and agent wiki lookup', async () => {
    const workspace = path.join(root, 'workspace');
    const content = '# Game specification\n\n- Ship movement is horizontal.\n';
    const saveResponse = await fetch(`${baseUrl}/api/workspace-guide`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace, content, enabled: true }),
    });
    const saved = await saveResponse.json() as any;

    expect(saveResponse.status).toBe(200);
    expect(saved.guide).toMatchObject({
      reference: 'wiki:project-specification',
      projectPath: 'wiki/project-specification.md',
      content,
      exists: true,
      enabled: true,
    });
    expect(saved.settings.wikiLookupEnabled).toBe(true);

    const loadResponse = await fetch(
      `${baseUrl}/api/workspace-guide?workspace=${encodeURIComponent(workspace)}`
    );
    const loaded = await loadResponse.json() as any;
    expect(loadResponse.status).toBe(200);
    expect(loaded.guide.content).toBe(content);
  });

  it('guards workspace editor writes with a file hash and rejects traversal', async () => {
    const workspace = path.join(root, 'workspace');
    const filePath = path.join(workspace, 'README.md');
    writeFileSync(filePath, 'one\n', 'utf8');

    const readResponse = await fetch(
      `${baseUrl}/api/workspace/file?workspace=${encodeURIComponent(workspace)}&path=README.md`,
    );
    const readData = await readResponse.json() as any;
    expect(readResponse.status).toBe(200);
    expect(readData).toMatchObject({ content: 'one\n' });
    expect(readData.hash).toMatch(/^[a-f0-9]{64}$/);

    const saveResponse = await fetch(`${baseUrl}/api/workspace/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace,
        path: 'README.md',
        content: 'two\n',
        expectedHash: readData.hash,
      }),
    });
    expect(saveResponse.status).toBe(200);
    expect(((await saveResponse.json()) as any).saved).toBe(true);

    const staleResponse = await fetch(`${baseUrl}/api/workspace/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace, path: 'README.md', content: 'three\n', expectedHash: readData.hash }),
    });
    const staleData = await staleResponse.json() as any;
    expect(staleResponse.status).toBe(409);
    expect(staleData).toMatchObject({ conflict: true, content: 'two\n' });

    const traversalResponse = await fetch(
      `${baseUrl}/api/workspace/file?workspace=${encodeURIComponent(workspace)}&path=${encodeURIComponent('../outside.txt')}`,
    );
    expect(traversalResponse.status).toBe(403);

    const missingReadResponse = await fetch(
      `${baseUrl}/api/workspace/file?workspace=${encodeURIComponent(workspace)}&path=missing.txt`,
    );
    expect(missingReadResponse.status).toBe(404);

    const missingHashResponse = await fetch(`${baseUrl}/api/workspace/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace, path: 'README.md', content: 'four\n' }),
    });
    expect(missingHashResponse.status).toBe(400);
  });

  it('exposes bounded recoverable workspace restore-point routes', async () => {
    const workspace = path.join(root, 'workspace');
    const filePath = 'restore-contract.txt';
    const fileUrl = `${baseUrl}/api/workspace/file?workspace=${encodeURIComponent(workspace)}&path=${encodeURIComponent(filePath)}`;
    const initialContent = `initial-${Date.now()}\n`;
    const changedContent = `changed-${Date.now()}\n`;
    writeFileSync(path.join(workspace, filePath), initialContent, 'utf8');
    const initialRead = await fetch(fileUrl);
    const initialRevision = await initialRead.json() as any;
    expect(initialRead.status).toBe(200);

    const createResponse = await fetch(`${baseUrl}/api/workspace/restore-points`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace, label: 'API contract snapshot' }),
    });
    const created = await createResponse.json() as any;
    expect(createResponse.status).toBe(201);
    expect(created.restorePoint).toEqual(expect.objectContaining({ label: 'API contract snapshot', source: 'manual' }));

    const changedWrite = await fetch(`${baseUrl}/api/workspace/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace, path: filePath, content: changedContent, expectedHash: initialRevision.hash }),
    });
    expect(changedWrite.status).toBe(200);

    const listResponse = await fetch(`${baseUrl}/api/workspace/restore-points?workspace=${encodeURIComponent(workspace)}`);
    const listed = await listResponse.json() as any;
    expect(listResponse.status).toBe(200);
    expect(listed.restorePoints.map((point: { id: string }) => point.id)).toContain(created.restorePoint.id);

    const restoreResponse = await fetch(`${baseUrl}/api/workspace/restore-points/${encodeURIComponent(created.restorePoint.id)}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace }),
    });
    const restored = await restoreResponse.json() as any;
    expect(restoreResponse.status).toBe(200);
    expect(restored.rollback.source).toBe('pre-restore');
    expect((await (await fetch(fileUrl)).json()).content).toBe(initialContent);

    const deleteResponse = await fetch(`${baseUrl}/api/workspace/restore-points/${encodeURIComponent(created.restorePoint.id)}`, { method: 'DELETE' });
    expect(deleteResponse.status).toBe(200);
  });

  it('persists the web-search toggle for the selected workspace', async () => {
    const workspace = path.join(root, 'workspace');
    const saveResponse = await fetch(`${baseUrl}/api/knowledge-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace,
        settings: { webSearchEnabled: false },
      }),
    });
    const saved = await saveResponse.json() as any;
    expect(saveResponse.status).toBe(200);
    expect(saved.settings.webSearchEnabled).toBe(false);

    const loadResponse = await fetch(
      `${baseUrl}/api/knowledge-settings?workspace=${encodeURIComponent(workspace)}`
    );
    const loaded = await loadResponse.json() as any;
    expect(loadResponse.status).toBe(200);
    expect(loaded.settings.webSearchEnabled).toBe(false);
  });

  it('retains safety analysis without persisting an execution mode', async () => {
    const taskAnalysis = {
      id: 'directive-api-analysis',
      userRequest: 'Inspect the isolated workspace.',
      approvalPolicy: 'full_access',
      expectedChangeIntent: 'read_only',
      affectedFiles: [],
      requiredInspections: [],
      verificationPlan: [],
      validationRequirements: [],
    };
    const startResponse = await fetch(`${baseUrl}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'coder',
        task: 'Autonomous API task',
        model: 'google/gemma-4-31b-it',
        maxSteps: 1,
        workspace: path.join(root, 'workspace'),
        pacingProfile: 'phased',
        metadata: {
          agentDirective: 'structured',
          taskAnalysis,
          approvalPolicy: 'full_access',
          // A caller must not be able to smuggle a recovery target into a new
          // run. Only the explicit fallback-policy + resume flow may change it.
          recoveryModel: 'gemini-3.6-flash',
        },
      }),
    });
    expect(startResponse.status).toBe(200);
    const autonomous = await startResponse.json() as any;

    expect(autonomous.run.metadata).toEqual(expect.objectContaining({
      taskAnalysis,
      pacingProfile: 'phased',
    }));
    expect(autonomous.run.metadata.delegationSettingsSnapshot.enabled).toBe(false);
    expect(Array.isArray(autonomous.run.metadata.delegationSettingsSnapshot.delegates)).toBe(true);
    expect(autonomous.run.metadata.delegationSettingsSnapshot.maxConcurrentDelegates).toBe(1);
    expect(autonomous.run.metadata).not.toHaveProperty('recoveryModel');
    expect(autonomous.run.metadata).not.toHaveProperty('agentDirective');

    const runs = await fetch(`${baseUrl}/api/runs?agentDirective=structured`).then((response) => response.json()) as any;
    expect(runs.runs.map((run: { id: string }) => run.id)).toContain(autonomous.runId);

    let parentDetail: any;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      parentDetail = await fetch(`${baseUrl}/api/runs/${autonomous.runId}`).then((response) => response.json());
      const events = Array.isArray(parentDetail.events) ? parentDetail.events : [];
      const hasTaskAnalysisEvent = events.some((entry: any) => entry.event?.type === 'task_analysis_ready');
      const hasModelTurn = events.some((entry: any) => entry.event?.type === 'llm_request_started');
      if (parentDetail.run?.metadata?.checkpoint && hasTaskAnalysisEvent && hasModelTurn) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(parentDetail.run?.metadata?.checkpoint).toBeDefined();
    expect(parentDetail.taskAnalysis).toMatchObject({
      id: 'directive-api-analysis',
      taskKind: 'investigation',
      expectedChangeIntent: 'read_only',
    });
    expect(parentDetail.taskAnalysis).not.toHaveProperty('userRequest');
    expect(parentDetail.taskAnalysis).not.toHaveProperty('workspace');
    expect(parentDetail.taskAnalysis).not.toHaveProperty('projectFileMap');
    expect(parentDetail.projection.taskAnalysis).toEqual(parentDetail.taskAnalysis);
    const taskAnalysisEvent = parentDetail.events.find((entry: any) => entry.event?.type === 'task_analysis_ready');
    const firstModelTurnEvent = parentDetail.events.find((entry: any) => entry.event?.type === 'llm_request_started');
    expect(taskAnalysisEvent).toBeDefined();
    expect(firstModelTurnEvent).toBeDefined();
    expect(taskAnalysisEvent.event.data.taskAnalysis).toEqual(parentDetail.taskAnalysis);
    expect(taskAnalysisEvent.event.seq).toBeLessThan(firstModelTurnEvent.event.seq);
    expect(parentDetail.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'model_target_resolved',
          data: expect.objectContaining({
            requestedTarget: 'google/gemma-4-31b-it',
            resolvedModel: 'google/gemma-4-31b-it',
          }),
        }),
      }),
    ]));
    await fetch(`${baseUrl}/api/runs/${autonomous.runId}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Integration test complete.' }),
    });
    const installApprovalScope = 'install:npm:dev:@eslint/js:cwd=.';
    const approvalResponse = await fetch(`${baseUrl}/api/runs/${autonomous.runId}/approvals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: installApprovalScope, decision: 'allow' }),
    });
    expect(approvalResponse.status).toBe(200);
    const unconfirmedModelChangeResponse = await fetch(`${baseUrl}/api/runs/${autonomous.runId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maxSteps: 1,
        reason: 'max_steps',
        threadId: 'continued-session-thread',
        model: 'gemini-3.6-flash',
      }),
    });
    expect(unconfirmedModelChangeResponse.status).toBe(409);
    expect(await unconfirmedModelChangeResponse.json()).toEqual(expect.objectContaining({
      modelChangeConfirmationRequired: true,
      currentModel: autonomous.run.model,
      requestedModel: 'gemini-3.6-flash',
    }));
    const resumedResponse = await fetch(`${baseUrl}/api/runs/${autonomous.runId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maxSteps: 1,
        reason: 'max_steps',
        threadId: 'continued-session-thread',
        model: 'gemini-3.6-flash',
        confirmModelChange: true,
        continuationTask: 'Updated chat request: finish the API-backed dashboard.',
        continuationDisplayTask: 'Finish the API-backed dashboard.',
      }),
    });
    expect(resumedResponse.status).toBe(200);
    const resumed = await resumedResponse.json() as any;
    expect(resumed.run.metadata).toEqual(expect.objectContaining({
      parentRunId: autonomous.runId,
      continuationReason: 'max_steps',
      parentModel: autonomous.run.model,
      requestedModel: 'gemini-3.6-flash',
      resolvedModel: 'gemini-3.6-flash',
      modelChangedOnResume: true,
      continuationHandoff: expect.objectContaining({
        version: 1,
        parentRunId: autonomous.runId,
        reason: 'max_steps',
      }),
      approvalGrants: expect.arrayContaining([
        expect.objectContaining({ scope: installApprovalScope, decision: 'allow' }),
      ]),
      delegationSettingsSnapshot: autonomous.run.metadata.delegationSettingsSnapshot,
    }));
    expect(autonomous.run.model).toBe('google/gemma-4-31b-it');
    expect(resumed.run.model).toBe('gemini-3.6-flash');
    expect(resumed.run.threadId).toBe('continued-session-thread');
    expect(resumed.run.task).toBe('Updated chat request: finish the API-backed dashboard.');
    expect(resumed.run.metadata.continuationHandoff.currentGoal).toBe('Updated chat request: finish the API-backed dashboard.');
    expect(resumed.run.metadata.taskAnalysis).toBeUndefined();
    expect(resumed.run.metadata.displayTask).toBe('Finish the API-backed dashboard.');

    const backwardCompatibleResumeResponse = await fetch(`${baseUrl}/api/runs/${autonomous.runId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxSteps: 1, reason: 'saved_run' }),
    });
    expect(backwardCompatibleResumeResponse.status).toBe(200);
    const backwardCompatibleResume = await backwardCompatibleResumeResponse.json() as any;
    expect(backwardCompatibleResume.run.model).toBe(autonomous.run.model);
    expect(backwardCompatibleResume.run.metadata).toEqual(expect.objectContaining({
      parentModel: autonomous.run.model,
      requestedModel: autonomous.run.model,
      modelChangedOnResume: false,
    }));

    // The UI stages a selected recovery target before posting /resume. The
    // explicit resume target must still be compared with the parent model so
    // the child records a genuine model takeover instead of inheriting a
    // staged recoveryModel as if it were the parent.
    const stagedFallbackPolicyResponse = await fetch(`${baseUrl}/api/runs/${autonomous.runId}/fallback-policy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-3.6-flash', confirmModelChange: true }),
    });
    expect(stagedFallbackPolicyResponse.status).toBe(200);
    const stagedResumeResponse = await fetch(`${baseUrl}/api/runs/${autonomous.runId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maxSteps: 1,
        reason: 'max_steps',
        model: 'gemini-3.6-flash',
        confirmModelChange: true,
      }),
    });
    expect(stagedResumeResponse.status).toBe(200);
    const stagedResume = await stagedResumeResponse.json() as any;
    expect(stagedResume.run.model).toBe('gemini-3.6-flash');
    expect(stagedResume.run.metadata).toEqual(expect.objectContaining({
      parentModel: autonomous.run.model,
      requestedModel: 'gemini-3.6-flash',
      modelChangedOnResume: true,
    }));

    const invalidResumeResponse = await fetch(`${baseUrl}/api/runs/${autonomous.runId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxSteps: 1, model: 'gemini-target:deleted-target' }),
    });
    expect(invalidResumeResponse.status).toBe(400);
    await expect(invalidResumeResponse.json()).resolves.toEqual(expect.objectContaining({
      error: expect.stringMatching(/Gemini model target .* cannot be used/i),
    }));

    await fetch(`${baseUrl}/api/runs/${resumed.runId}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Integration test complete.' }),
    });
    await fetch(`${baseUrl}/api/runs/${backwardCompatibleResume.runId}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Integration test complete.' }),
    });
    await fetch(`${baseUrl}/api/runs/${stagedResume.runId}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Integration test complete.' }),
    });
  });

  it('rejects a resume target that is no longer configured', async () => {
    const response = await fetch(`${baseUrl}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'coder',
        task: 'Reject stale target',
        model: 'gemini-target:removed-account-gemini-3-6-flash',
        workspace: path.join(root, 'workspace'),
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json() as { error?: string };
    expect(body.error).toMatch(/Gemini model target .* cannot be used/i);
  });
});
