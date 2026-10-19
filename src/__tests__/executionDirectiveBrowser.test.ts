import { spawn, type ChildProcess } from 'child_process';
import { createServer } from 'net';
import path from 'path';
import { chromium, type Browser } from 'playwright';
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

async function waitForPage(baseUrl: string, process: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Vite exited with code ${process.exitCode}.`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for Vite.');
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

describe('autonomous agent browser interactions', () => {
  let viteProcess: ChildProcess;
  let browser: Browser;
  let baseUrl: string;

  beforeAll(async () => {
    const port = await reservePort();
    baseUrl = `http://127.0.0.1:${port}`;
    viteProcess = spawn(
      process.execPath,
      [path.join('node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] }
    );
    await waitForPage(baseUrl, viteProcess);
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
    if (!viteProcess || viteProcess.exitCode !== null) return;
    viteProcess.kill('SIGTERM');
    await waitForExit(viteProcess);
    if (viteProcess.exitCode === null) viteProcess.kill('SIGKILL');
  });

  it('does not expose execution-directive controls or prepared-plan execution', async () => {
    const page = await browser.newPage();
    await page.route('**/api/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith('/model-targets')) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            targets: pathname === '/api/nvidia/model-targets'
              ? [{ value: 'nvidia-target:0:z-ai%2Fglm-5.2', title: 'NVIDIA API key 1', modelId: 'z-ai/glm-5.2', apiKeyIndex: 0 }]
              : [],
          }),
        });
        return;
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runs: [], threads: [], roots: [] }) });
    });

    await page.goto(baseUrl);
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();

    expect(await page.getByText('Agent Directive', { exact: true }).count()).toBe(0);
    expect(await page.getByText('Agent-led', { exact: true }).count()).toBe(0);
    expect(await page.getByText('Structured', { exact: true }).count()).toBe(0);
    expect(await page.getByText('Execute Task', { exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => window.localStorage.getItem('react-engine-coder-agent-directive'))).toBeNull();
    await page.close();
  });

  it('continues a max-step run with lineage and starts New Task with clean state', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    let resumeBody: Record<string, unknown> | undefined;
    let freshRunBody: Record<string, unknown> | undefined;
    const maxStepsResult = {
      success: false,
      error: 'Max steps exceeded',
      errorCode: 'MAX_STEPS_EXCEEDED',
      recoverable: true,
      plan: [{ step: 'Finish remaining work', status: 'in_progress' }],
      steps: [],
      stepCount: 60,
      pollenCost: 0,
    };
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith('/model-targets')) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            targets: pathname === '/api/nvidia/model-targets'
              ? [{ value: 'nvidia-target:0:z-ai%2Fglm-5.2', title: 'NVIDIA API key 1', modelId: 'z-ai/glm-5.2', apiKeyIndex: 0 }]
              : [],
          }),
        });
        return;
      }
      if (pathname === '/api/runs' && request.method() === 'POST') {
        freshRunBody = request.postDataJSON();
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: 'parent-run', run: { id: 'parent-run' } }) });
        return;
      }
      if (pathname === '/api/runs' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            runs: [{
              id: 'saved-run',
              kind: 'coder',
              status: 'interrupted',
              task: 'Finish saved work.',
              createdAt: 1,
              updatedAt: 1,
              lastEventSeq: 1,
              metadata: {
                displayTask: 'Finish saved work.',
                continuationPreview: {
                  currentGoal: 'Finish saved work.',
                  remainingPlanItem: 'Implement lineage',
                  latestVerifiedCheck: 'unit-tests: npm.cmd test',
                  blocker: 'Approval is required',
                },
              },
            }],
          }),
        });
        return;
      }
      if (pathname === '/api/runs/parent-run/resume') {
        resumeBody = request.postDataJSON();
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: 'child-run', resumedFrom: 'parent-run' }) });
        return;
      }
      if (pathname === '/api/runs/parent-run/stream' || pathname === '/api/runs/child-run/stream') {
        const modelResponse = {
          type: 'model_response',
          message: 'I’m checking the saved work before continuing the implementation.',
          provider: 'gemini',
          model: 'gemini-3.5-flash',
          step: 1,
          phase: 'planning',
        };
        await route.fulfill({
          contentType: 'text/event-stream',
          body: `event: model_response\ndata: ${JSON.stringify(modelResponse)}\nid: 1\n\nevent: done\ndata: ${JSON.stringify(maxStepsResult)}\nid: 2\n\n`,
        });
        return;
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runs: [], threads: [], roots: [] }) });
    });

    await page.goto(baseUrl);
    await page.getByRole('button', { name: 'agent', exact: true }).first().click();
    const composer = page.getByPlaceholder('Ask the agent to change code, explain a file, run tests, or plan a refactor...');
    await composer.fill('Finish the continuation work.');
    await page.getByTitle('Send message').click();

    expect(freshRunBody).toEqual(expect.objectContaining({
      model: 'nvidia-target:0:z-ai%2Fglm-5.2',
      requestBudgetEnabled: false,
      replayGuardEnabled: true,
      metadata: expect.objectContaining({
        requestBudgetEnabled: false,
        replayGuardEnabled: true,
      }),
    }));

    await page.getByRole('heading', { name: 'Agent Continuing' }).waitFor({ state: 'visible' });
    const agentResponses = page.getByTestId('session-thread-scroll').first();
    await agentResponses.getByText('I’m checking the saved work before continuing the implementation.', { exact: true }).first().waitFor({ state: 'visible' });
    await agentResponses.getByText('No final answer provided', { exact: true }).first().waitFor({ state: 'visible' });
    await agentResponses.getByTitle('gemini / gemini-3.5-flash').first().waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const thread = document.querySelector<HTMLElement>('[data-testid="session-thread-scroll"]');
      return Boolean(thread && thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 2);
    });
    await page.getByRole('alert').getByText('Checkpoint saved', { exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('alert').getByText('Turn limit reached. Progress was saved and is ready to continue from the checkpoint.', { exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Continue', exact: true }).first().click();
    await page.getByRole('heading', { name: 'Agent Continuing' }).waitFor({ state: 'visible' });
    expect(resumeBody).toEqual({
      maxSteps: 40,
      continuousRun: false,
      reason: 'max_steps',
      pacingProfile: 'automatic',
      model: 'nvidia-target:0:z-ai%2Fglm-5.2',
      requestBudgetEnabled: false,
      replayGuardEnabled: true,
      rebaseWorkspace: true,
      continuationTask: expect.stringContaining('Current request:\nFinish the continuation work.'),
      continuationDisplayTask: 'Finish the continuation work.',
      threadId: expect.any(String),
      waitForProviderAvailability: true,
    });

    await page.getByRole('button', { name: 'New Task', exact: true }).first().click();
    await page.getByRole('heading', { name: 'Agent Continuing' }).waitFor({ state: 'detached' });
    expect(await composer.inputValue()).toBe('');
    expect(await page.getByText('Max steps exceeded', { exact: true }).count()).toBe(0);
    await page.close();
  });

  it('pauses model fallback until the user selects a target or opts out', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    let runNumber = 0;
    let resumeCalls = 0;
    let fallbackPolicyBody: Record<string, unknown> | undefined;
    let resumeBody: Record<string, unknown> | undefined;
    const fallbackResult = {
      success: false,
      error: 'The selected model is unavailable. Select a target model to continue.',
      errorCode: 'MODEL_FALLBACK_CONFIRMATION_REQUIRED',
      recoverable: true,
      steps: [],
      stepCount: 0,
      pollenCost: 0,
    };

    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith('/model-targets')) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            targets: pathname === '/api/nvidia/model-targets'
              ? [
                  { value: 'nvidia-target:0:z-ai%2Fglm-5.2', title: 'NVIDIA API key 1', modelId: 'z-ai/glm-5.2', apiKeyIndex: 0 },
                  { value: 'nvidia-target:0:minimaxai%2Fminimax-m3', title: 'NVIDIA API key 1', modelId: 'minimaxai/minimax-m3', apiKeyIndex: 0 },
                ]
              : [],
          }),
        });
        return;
      }
      if (pathname === '/api/runs' && request.method() === 'POST') {
        runNumber += 1;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ runId: `fallback-run-${runNumber}`, run: { id: `fallback-run-${runNumber}` } }),
        });
        return;
      }
      if (/\/api\/runs\/fallback-run-\d+\/fallback-policy$/.test(pathname)) {
        fallbackPolicyBody = request.postDataJSON();
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: `fallback-run-${runNumber}` }) });
        return;
      }
      if (/\/api\/runs\/fallback-run-\d+\/resume$/.test(pathname)) {
        resumeCalls += 1;
        resumeBody = request.postDataJSON();
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: 'fallback-child' }) });
        return;
      }
      if (pathname === '/api/runs/fallback-child/stream') {
        await route.fulfill({
          contentType: 'text/event-stream',
          body: `event: done\ndata: ${JSON.stringify({ success: true, finalAnswer: 'Continued on selected target.', steps: [], stepCount: 0, pollenCost: 0 })}\nid: 1\n\n`,
        });
        return;
      }
      if (/\/api\/runs\/fallback-run-\d+\/stream$/.test(pathname)) {
        await route.fulfill({
          contentType: 'text/event-stream',
          body: `event: done\ndata: ${JSON.stringify(fallbackResult)}\nid: 1\n\n`,
        });
        return;
      }
      if (pathname === '/api/runs' && request.method() === 'GET') {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runs: [] }) });
        return;
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({}) });
    });

    await page.goto(baseUrl);
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await page.getByRole('button', { name: 'agent', exact: true }).first().click();
    const composer = page.getByPlaceholder('Ask the agent to change code, explain a file, run tests, or plan a refactor...');

    await composer.fill('Try the selected model.');
    await page.getByTitle('Send message').click();
    await page.getByRole('heading', { name: 'Choose Provider / Model' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Leave stopped', exact: true }).click();
    await page.getByRole('heading', { name: 'Choose Provider / Model' }).waitFor({ state: 'hidden' });
    expect(resumeCalls).toBe(0);

    await composer.fill('Try again and select a fallback target.');
    await page.getByTitle('Send message').click();
    await page.getByRole('heading', { name: 'Choose Provider / Model' }).waitFor({ state: 'visible' });
    await page.getByRole('combobox').first().selectOption('nvidia-target:0:minimaxai%2Fminimax-m3');
    await page.getByRole('button', { name: 'Continue with selected model' }).click();
    for (let attempt = 0; attempt < 50 && resumeCalls === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(resumeCalls).toBe(1);
    expect(fallbackPolicyBody).toEqual({
      model: 'nvidia-target:0:minimaxai%2Fminimax-m3',
      confirmModelChange: true,
    });
    expect(resumeBody).toEqual(expect.objectContaining({
      model: 'nvidia-target:0:minimaxai%2Fminimax-m3',
      confirmModelChange: true,
    }));
    await page.close();
  });

  it('asks for a blocked action decision and resumes after explicit approval', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    let approvalBody: Record<string, unknown> | undefined;
    let resumeCalls = 0;
    const scope = 'destructive:powershell -Command "Remove-Item index.js"';
    const approvalRequest = {
      category: 'destructive',
      risk: 'critical',
      scope,
      summary: 'Delete the obsolete root index.js',
      reason: 'This high-risk action requires explicit user approval.',
    };

    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const pathname = url.pathname;
      if (pathname.endsWith('/model-targets')) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            targets: pathname === '/api/nvidia/model-targets'
              ? [{ value: 'nvidia-target:0:z-ai%2Fglm-5.2', title: 'NVIDIA API key 1', modelId: 'z-ai/glm-5.2', apiKeyIndex: 0 }]
              : [],
          }),
        });
        return;
      }
      if (pathname === '/api/runs' && request.method() === 'POST') {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: 'approval-parent', run: { id: 'approval-parent' } }) });
        return;
      }
      if (pathname === '/api/runs' && request.method() === 'GET') {
        const runs = url.searchParams.get('resumable') === 'true'
          ? [{
              id: 'approval-parent',
              kind: 'coder',
              status: 'failed',
              task: 'Remove the obsolete duplicate.',
              model: 'nvidia-target:0:z-ai%2Fglm-5.2',
              createdAt: 1,
              updatedAt: 2,
              lastEventSeq: 3,
              metadata: { displayTask: 'Remove the obsolete duplicate.' },
            }]
          : [];
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runs }) });
        return;
      }
      if (pathname === '/api/runs/approval-parent/approvals') {
        approvalBody = request.postDataJSON();
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ approvals: [{ ...approvalBody, createdAt: Date.now() }] }) });
        return;
      }
      if (pathname === '/api/runs/approval-parent/resume') {
        resumeCalls += 1;
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: 'approval-child' }) });
        return;
      }
      if (pathname === '/api/runs/approval-child/stream') {
        await route.fulfill({
          contentType: 'text/event-stream',
          body: `event: done\ndata: ${JSON.stringify({ success: true, finalAnswer: 'Approved action completed.', steps: [], stepCount: 0, pollenCost: 0 })}\nid: 1\n\n`,
        });
        return;
      }
      if (pathname === '/api/runs/approval-parent/stream') {
        const policyEvent = {
          type: 'policy_decision',
          decision: { allowed: false, requiresApproval: true, ...approvalRequest, timestamp: Date.now() },
        };
        const done = {
          success: false,
          error: `Approval required before continuing: ${approvalRequest.summary}`,
          errorCode: 'APPROVAL_REQUIRED',
          recoverable: true,
          approvalRequest,
          steps: [],
          stepCount: 1,
          pollenCost: 0,
        };
        await route.fulfill({
          contentType: 'text/event-stream',
          body: `event: policy_decision\ndata: ${JSON.stringify(policyEvent)}\nid: 1\n\nevent: done\ndata: ${JSON.stringify(done)}\nid: 2\n\n`,
        });
        return;
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({}) });
    });

    await page.goto(baseUrl);
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await page.getByRole('button', { name: 'agent', exact: true }).first().click();
    await page.getByPlaceholder('Ask the agent to change code, explain a file, run tests, or plan a refactor...').fill('Remove the obsolete duplicate.');
    await page.getByTitle('Send message').click();
    await page.getByRole('heading', { name: 'Approval Required' }).waitFor({ state: 'visible' });
    await page.getByText(approvalRequest.summary, { exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Approve and resume' }).click();
    for (let attempt = 0; attempt < 50 && resumeCalls === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(approvalBody).toEqual({ scope, decision: 'allow' });
    expect(resumeCalls).toBe(1);
    await page.close();
  });

  it('answers an agent question on the same run without creating a continuation', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    let answerBody: Record<string, unknown> | undefined;
    let resumeCalls = 0;

    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith('/model-targets')) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            targets: pathname === '/api/nvidia/model-targets'
              ? [{ value: 'nvidia-target:0:z-ai%2Fglm-5.2', title: 'NVIDIA API key 1', modelId: 'z-ai/glm-5.2', apiKeyIndex: 0 }]
              : [],
          }),
        });
        return;
      }
      if (pathname === '/api/runs' && request.method() === 'POST') {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: 'question-run' }) });
        return;
      }
      if (pathname === '/api/runs/question-run/stream') {
        const event = {
          type: 'user_input_required',
          requestId: 'question-1',
          question: 'Which browser target should be prioritized?',
          options: [],
          allowFreeform: true,
          context: 'The answer changes the interaction layout.',
          createdAt: Date.now(),
        };
        await route.fulfill({
          contentType: 'text/event-stream',
          body: `event: user_input_required\ndata: ${JSON.stringify(event)}\nid: 1\n\n`,
        });
        return;
      }
      if (pathname === '/api/runs/question-run/user-input') {
        if (request.method() === 'GET') {
          await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ request: { requestId: 'question-1' } }),
          });
          return;
        }
        answerBody = request.postDataJSON();
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        return;
      }
      if (pathname.endsWith('/resume')) {
        resumeCalls += 1;
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runs: [], threads: [], roots: [] }) });
    });

    await page.goto(baseUrl);
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await page.getByRole('button', { name: 'agent', exact: true }).first().click();
    await page.getByPlaceholder('Ask the agent to change code, explain a file, run tests, or plan a refactor...').fill('Make the game playable in a browser.');
    await page.getByTitle('Send message').click();

    await page.getByRole('heading', { name: 'Agent Needs Your Input' }).waitFor({ state: 'visible' });
    await page.getByPlaceholder('Tell the agent how you want it to proceed.').fill('Prioritize touch controls.');
    await page.getByRole('button', { name: 'Answer and continue' }).click();

    expect(answerBody).toEqual({
      requestId: 'question-1',
      answer: 'Prioritize touch controls.',
      cancelled: false,
    });
    expect(resumeCalls).toBe(0);
    await page.getByRole('heading', { name: 'Agent Needs Your Input' }).waitFor({ state: 'hidden' });
    await page.close();
  });

  it('persists the request-cap and ReplayGuard toggles beside Alerts', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    await page.route('**/api/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith('/model-targets')) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            targets: pathname === '/api/nvidia/model-targets'
              ? [{ value: 'nvidia-target:0:z-ai%2Fglm-5.2', title: 'NVIDIA API key 1', modelId: 'z-ai/glm-5.2', apiKeyIndex: 0 }]
              : [],
          }),
        });
        return;
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runs: [], threads: [], roots: [] }) });
    });

    await page.goto(baseUrl);
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();

    const enableButton = page.getByRole('button', { name: 'Enable request safety guard' });
    await enableButton.waitFor({ state: 'visible' });
    await enableButton.click();
    expect(await page.evaluate(() => window.localStorage.getItem('react-engine-coder-request-budget-enabled'))).toBe('enabled');
    const disableButton = page.getByRole('button', { name: 'Disable request safety guard' });
    await disableButton.waitFor({ state: 'visible' });
    await disableButton.click();
    await page.getByRole('button', { name: 'Enable request safety guard' }).waitFor({ state: 'visible' });
    expect(await page.evaluate(() => window.localStorage.getItem('react-engine-coder-request-budget-enabled'))).toBe('disabled');

    await page.reload();
    await page.getByRole('button', { name: 'Enable request safety guard' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Enable request safety guard' }).click();
    expect(await page.evaluate(() => window.localStorage.getItem('react-engine-coder-request-budget-enabled'))).toBe('enabled');
    const disableReplayGuard = page.getByRole('button', { name: 'Disable ReplayGuard' });
    await disableReplayGuard.waitFor({ state: 'visible' });
    await disableReplayGuard.click();
    await page.getByRole('button', { name: 'Enable ReplayGuard' }).waitFor({ state: 'visible' });
    expect(await page.evaluate(() => window.localStorage.getItem('react-engine-coder-replay-guard-enabled'))).toBe('disabled');
    await page.reload();
    await page.getByRole('button', { name: 'Enable ReplayGuard' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Enable ReplayGuard' }).click();
    expect(await page.evaluate(() => window.localStorage.getItem('react-engine-coder-replay-guard-enabled'))).toBe('enabled');
    await page.close();
  });

  it('rebases a saved session, omits an irrelevant Gemini profile, and reports the recovery', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    let resumeBody: Record<string, unknown> | undefined;
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith('/model-targets')) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            targets: pathname === '/api/nvidia/model-targets'
              ? [{
                  value: 'nvidia-target:key-2-google-gemma-4-31b-it',
                  title: 'NVIDIA key 2',
                  modelId: 'google/gemma-4-31b-it',
                  apiKeyIndex: 1,
                }]
              : [],
          }),
        });
        return;
      }
      if (pathname === '/api/gemini/profiles') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ profiles: [{ id: 'legacy-api-2', label: 'Gemini API 2', purpose: 'general' }] }),
        });
        return;
      }
      if (pathname === '/api/coder/threads' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            threads: [{
              id: 'saved-thread',
              title: 'Saved task',
              createdAt: 1,
              updatedAt: 2,
              messageCount: 1,
            }],
            page: { limit: 50, hasMore: false, nextCursor: null },
          }),
        });
        return;
      }
      if (pathname === '/api/coder/threads/saved-thread' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            thread: {
              id: 'saved-thread',
              title: 'Saved task',
              createdAt: 1,
              updatedAt: 2,
              messages: [{
                role: 'user',
                content: 'Finish saved work.',
                createdAt: 1,
                runId: 'saved-run',
              }],
            },
            page: { limit: 50, totalMessages: 1, hasMore: false, nextCursor: null },
          }),
        });
        return;
      }
      if (pathname === '/api/runs' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            runs: [{
              id: 'saved-run',
              kind: 'coder',
              status: 'failed',
              threadId: 'saved-thread',
              task: 'Finish saved work.',
              model: 'nvidia-target:key-1-google-gemma-4-31b-it',
              createdAt: 1,
              updatedAt: 2,
              lastEventSeq: 2,
              metadata: { providerProfile: 'legacy-api-2', continuationAvailable: true },
            }],
          }),
        });
        return;
      }
      if (pathname === '/api/runs/saved-run/resume') {
        resumeBody = request.postDataJSON();
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ runId: 'rebased-run', resumedFrom: 'saved-run', workspaceRebased: true }),
        });
        return;
      }
      if (pathname === '/api/runs/rebased-run/stream') {
        const result = {
          success: true,
          finalAnswer: 'Remaining work completed.',
          steps: [],
          stepCount: 0,
          pollenCost: 0,
        };
        await route.fulfill({
          contentType: 'text/event-stream',
          body: `event: done\ndata: ${JSON.stringify(result)}\nid: 1\n\n`,
        });
        return;
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runs: [], threads: [], roots: [] }) });
    });

    await page.goto(baseUrl);
    await page.evaluate(() => {
      window.localStorage.clear();
      window.localStorage.setItem('react-engine-coder-model-target', 'nvidia-target:key-2-google-gemma-4-31b-it');
      window.localStorage.setItem('react-engine-coder-chat-threads', JSON.stringify({
        activeThreadId: null,
        threads: [],
      }));
    });
    await page.reload();
    await page.getByRole('button', { name: /Continue session/i }).click();

    await page.getByText(/workspace changed after the saved checkpoint/i).waitFor({ state: 'visible' });
    expect(resumeBody).toBeDefined();
    expect(resumeBody).toEqual(expect.objectContaining({
      maxSteps: 40,
      reason: 'saved_run',
      threadId: 'saved-thread',
      model: 'nvidia-target:key-2-google-gemma-4-31b-it',
      confirmModelChange: true,
      rebaseWorkspace: true,
      replayGuardEnabled: true,
    }));
    expect(resumeBody).not.toHaveProperty('geminiProfileId');
    await page.close();
  });
});
