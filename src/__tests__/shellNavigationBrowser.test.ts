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

const workspaceTabs = [
  ['Coder Chat', 'coder-workspace'],
  ['Test Suite', 'test-suite-tab'],
  ['Structure', 'structure-workspace'],
  ['Run Audits', 'audits-workspace'],
] as const;

describe('workspace shell navigation visual smoke', () => {
  let viteProcess: ChildProcess;
  let browser: Browser;
  let baseUrl: string;

  beforeAll(async () => {
    const port = await reservePort();
    baseUrl = `http://127.0.0.1:${port}`;
    viteProcess = spawn(
      process.execPath,
      [path.join('node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
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

  it('keeps every workspace reachable on desktop and narrow layouts', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;

      if (pathname === '/api/gemini/profiles') {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ profiles: [], selectedProfileId: '' }) });
        return;
      }
      if (pathname === '/api/workspace/default') {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ workspace: '' }) });
        return;
      }
      if (pathname === '/api/delegation/settings') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ settings: { enabled: false, delegates: [{ slot: 1, route: null }], maxConcurrentDelegates: 1 }, routes: [], errors: [] }),
        });
        return;
      }
      if (pathname === '/api/workspace/tree') {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify([]) });
        return;
      }
      if (pathname.includes('/model-targets')) {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ targets: [] }) });
        return;
      }
      if (pathname === '/api/runs' || pathname === '/api/react/threads') {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runs: [], threads: [], roots: [] }) });
        return;
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({}) });
    });

    try {
      await page.goto(baseUrl);
      const tabs = page.getByTestId('workspace-tabs');
      await tabs.waitFor({ state: 'visible' });
      for (const label of ['Studio / Gen', 'API Pool', 'Agents']) {
        expect(await tabs.getByRole('tab', { name: label, exact: true }).count()).toBe(0);
      }

      for (const [label, testId] of workspaceTabs) {
        const tab = tabs.getByRole('tab', { name: label, exact: true });
        await tab.click();
        expect(await tab.getAttribute('aria-selected')).toBe('true');
        await page.getByTestId(testId).waitFor({ state: 'visible' });
      }

      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await tabs.waitFor({ state: 'visible' });
      const narrowMetrics = await tabs.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(narrowMetrics.clientWidth).toBeLessThanOrEqual(390);
      expect(narrowMetrics.scrollWidth).toBeGreaterThan(narrowMetrics.clientWidth);

      for (const [label, testId] of workspaceTabs) {
        const tab = tabs.getByRole('tab', { name: label, exact: true });
        await tab.click();
        expect(await tab.getAttribute('aria-selected')).toBe('true');
        await page.getByTestId(testId).waitFor({ state: 'visible' });
      }

      await page.getByTestId('workspace-footer').getByText('BUILD_STATUS:', { exact: false }).waitFor({ state: 'visible' });
    } finally {
      await page.close();
    }
  });

  it('covers the persisted coder run, settings, and responsive navigation', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      window.localStorage.setItem('coder_chat_message_format', 'streamlined');
      window.localStorage.setItem('coder_chat_density', 'compact');
    });
    const appSpec = {
      appType: 'utility',
      outputMode: 'single-html',
      appName: 'Studio Smoke App',
      entryPoint: 'index.html',
      requiredFeatures: ['A visible generated-app preview'],
      designDirection: 'Dark utility interface',
      dataPersistence: 'localStorage',
      verificationChecks: ['page-load', 'no-console-errors'],
    };
    const failedVerification = {
      passed: false,
      checkedAt: '2026-09-12T00:00:00.000Z',
      checks: [{ name: 'no-console-errors', passed: false, reason: 'The preview reported one console error.' }],
      signals: [{ name: 'page-load', passed: true, details: 'The generated document loaded.' }],
    };
    const completedResult = (finalAnswer: string, verificationResult?: typeof failedVerification) => ({
      success: true,
      executionCompleted: true,
      verificationStatus: verificationResult?.passed === false ? 'failed' : 'passed',
      finalAnswer,
      steps: [],
      stepCount: 1,
      appSpec,
      outputFiles: ['index.html'],
      ...(verificationResult ? { verificationResult } : {}),
    });
    let generated = false;
    let treeRequestCount = 0;
    let runStartCount = 0;
    let runBodies: Array<Record<string, unknown>> = [];
    let undoRequestBody: Record<string, unknown> | null = null;
    let verificationBody: Record<string, unknown> | null = null;
    let generateEndpointRequestCount = 0;

    const streamBody = (runId: string, result: Record<string, unknown>) => [
      `event: run_started\ndata: ${JSON.stringify({ type: 'run_started', runId })}`,
      `event: file_changed\ndata: ${JSON.stringify({ type: 'file_changed', path: 'index.html', summary: 'Generated app entry point', diff: '--- before\n+++ after\n-old\n+new' })}`,
      `event: command_output\ndata: ${JSON.stringify({ type: 'command_output', command: 'npm run build', output: 'build passed', exitCode: 0 })}`,
      `event: done\ndata: ${JSON.stringify(result)}`,
      '',
    ].join('\n\n');

    await page.route('**/workspace-file**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><main>Studio preview</main></body></html>',
      });
    });
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;

      if (pathname === '/api/gemini/profiles') {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ profiles: [], selectedProfileId: '' }) });
        return;
      }
      if (pathname === '/api/workspace/default') {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ workspace: '' }) });
        return;
      }
      if (pathname === '/api/delegation/settings') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ settings: { enabled: false, delegates: [{ slot: 1, route: null }], maxConcurrentDelegates: 1 }, routes: [], errors: [] }),
        });
        return;
      }
      if (pathname === '/api/workspace/tree') {
        treeRequestCount += 1;
        const tree = generated ? [{ name: 'index.html', path: 'index.html', type: 'file' }] : [];
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(tree) });
        return;
      }
      if (pathname === '/api/openrouter/model-targets') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            targets: [{
              value: 'openrouter:dots-studio/dots-3-note-preview:free',
              title: 'Studio smoke target',
              modelId: 'dots-studio/dots-3-note-preview:free',
            }],
          }),
        });
        return;
      }
      if (pathname.endsWith('/model-targets')) {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ targets: [] }) });
        return;
      }
      if (pathname === '/api/pollinations/model-catalog') {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ targets: [] }) });
        return;
      }
      if (pathname === '/api/coder/respond') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ mode: 'execute', reason: 'Routing the generated-app request to the destination run.', executionTask: 'Create the Studio smoke app.' }),
        });
        return;
      }
      if (pathname === '/api/coder/analyze') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            analysis: {
              id: 'studio-repair-analysis',
              userRequest: 'Repair the generated Studio smoke app.',
              taskKind: 'bug_fix',
              instanceMode: 'continuation',
              confidence: 0.99,
              workspace: '',
              mentionedFiles: ['index.html'],
              inferredFiles: ['index.html'],
              expectedChangeIntent: 'modify',
              affectedFiles: [{ path: 'index.html', intent: 'modify', reason: 'Repair the failed preview check.', mustReadBeforeEdit: true }],
              riskLevel: 'low',
              requiresApproval: false,
              requiredInspections: ['index.html'],
              verificationPlan: ['Reload the preview without console errors.'],
              rationale: 'Target the failed generated-app verification check.',
            },
          }),
        });
        return;
      }
      if (pathname === '/api/runs' && request.method() === 'POST') {
        runStartCount += 1;
        const body = JSON.parse(request.postData() || '{}') as Record<string, unknown>;
        runBodies = [...runBodies, body];
        if (runStartCount === 3) undoRequestBody = body;
        const runId = `studio-run-${runStartCount}`;
        generated = true;
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId, run: { id: runId } }) });
        return;
      }
      if (pathname === '/api/runs/studio-run-1/stream') {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'Cache-Control': 'no-cache' },
          body: streamBody('studio-run-1', completedResult('Generated app persisted in Studio.')),
        });
        return;
      }
      if (pathname === '/api/runs/studio-run-2/stream') {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'Cache-Control': 'no-cache' },
          body: streamBody('studio-run-2', completedResult('Repair completed through the normal coder run.')),
        });
        return;
      }
      if (pathname === '/api/runs/studio-run-3/stream') {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'Cache-Control': 'no-cache' },
          body: streamBody('studio-run-3', completedResult('Undo completed through the normal coder run.')),
        });
        return;
      }
      if (pathname === '/api/apps/verify' && request.method() === 'POST') {
        verificationBody = JSON.parse(request.postData() || '{}') as Record<string, unknown>;
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ verificationResult: failedVerification }) });
        return;
      }
      if (pathname === '/api/generate') {
        generateEndpointRequestCount += 1;
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runs: [], threads: [], roots: [] }) });
    });

    try {
      await page.goto(baseUrl);
      const composer = page.getByPlaceholder('Ask the agent to change code, explain a file, run tests, or plan a refactor...');
      await composer.waitFor({ state: 'visible' });
      const sendButton = page.getByTitle('Send message');
      await sendButton.waitFor({ state: 'visible' });
      await composer.fill('Create the Studio smoke app.');
      await page.waitForFunction(() => {
        const button = document.querySelector<HTMLButtonElement>('button[title="Send message"]');
        return Boolean(button && !button.disabled);
      });

      await sendButton.click();
      await page.getByText('Generated app persisted in Studio.', { exact: false }).waitFor({ state: 'visible' });
      const streamlined = page.getByTestId('streamlined-chat-view');
      await streamlined.waitFor({ state: 'visible' });
      expect(await streamlined.getAttribute('class')).toContain('p-2');
      await page.getByTestId('streamlined-file-row').waitFor({ state: 'visible' });
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: async () => undefined },
        });
      });
      const copyOutput = page.getByTestId('streamlined-copy-output').first();
      await copyOutput.click();
      await copyOutput.getByText('Copied', { exact: true }).waitFor({ state: 'visible' });
      await page.getByTestId('streamlined-review-file').first().click();
      await page.getByTitle('Insert selected file path').waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Explorer', exact: true }).click();

      await page.getByTitle('Split View (Chat + Console Run)').click({ timeout: 5_000 });
      const consoleStream = page.getByTestId('console-run-stream');
      await consoleStream.waitFor({ state: 'visible', timeout: 5_000 });
      const consoleFileEvent = consoleStream.locator('[data-event-id$="-file_changed"]').first();
      await consoleFileEvent.waitFor({ state: 'visible', timeout: 5_000 });
      await consoleFileEvent.click();
      const chatFileEvent = page.getByTestId('streamlined-file-row').first();
      expect(await chatFileEvent.getAttribute('class')).toContain('ring-2');
      expect(await consoleFileEvent.getAttribute('aria-current')).toBe('true');
      await chatFileEvent.locator('button').first().click();
      expect(await consoleFileEvent.getAttribute('aria-current')).toBe('true');
      await page.getByTitle('Conversational Chat View').click();

      const explorationToggle = page.getByTestId('streamlined-exploration-toggle');
      expect(await explorationToggle.getAttribute('aria-expanded')).toBe('true');
      await explorationToggle.click();
      expect(await explorationToggle.getAttribute('aria-expanded')).toBe('false');
      expect(await page.getByTestId('streamlined-action-history-card').count()).toBe(0);
      await explorationToggle.click();
      await page.getByTestId('streamlined-action-history-card').waitFor({ state: 'visible' });
      expect(await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

      const settingsButton = page.getByRole('button', { name: 'SETTINGS', exact: true });
      await settingsButton.click();
      const settingsDialog = page.getByRole('dialog', { name: 'Settings' });
      await settingsDialog.waitFor({ state: 'visible' });
      await settingsDialog.getByRole('button', { name: 'Interface & Display', exact: true }).click();
      await settingsDialog.getByTestId('interface-display-format-rotating').waitFor({ state: 'visible' });
      await settingsDialog.getByTestId('interface-display-format-rotating').click();
      await settingsDialog.getByTestId('interface-display-density-detailed').click();
      await settingsDialog.getByLabel('Close settings').click();
      await page.getByTestId('rotating-chat-section').first().waitFor({ state: 'visible' });
      expect(await page.getByTestId('chat-format-rotating').count()).toBe(0);
      expect(await page.getByTestId('chat-density-detailed').count()).toBe(0);

      await settingsButton.click();
      const reopenedSettings = page.getByRole('dialog', { name: 'Settings' });
      await reopenedSettings.getByRole('button', { name: 'Interface & Display', exact: true }).click();
      await reopenedSettings.getByTestId('interface-display-format-streamlined').click();
      await reopenedSettings.getByTestId('interface-display-density-compact').click();
      await reopenedSettings.getByLabel('Close settings').click();
      await page.getByTestId('streamlined-chat-view').first().waitFor({ state: 'visible' });
      expect(await page.getByTestId('chat-format-streamlined').count()).toBe(0);
      expect(await page.getByTestId('chat-density-compact').count()).toBe(0);

      await settingsButton.click();
      const persistedSettings = page.getByRole('dialog', { name: 'Settings' });
      await persistedSettings.getByRole('button', { name: 'Interface & Display', exact: true }).click();
      await persistedSettings.getByTestId('interface-display-format-streamlined').waitFor({ state: 'visible' });
      expect(await persistedSettings.getByTestId('interface-display-format-streamlined').getAttribute('aria-pressed')).toBe('true');
      expect(await persistedSettings.getByTestId('interface-display-density-compact').getAttribute('aria-pressed')).toBe('true');
      await persistedSettings.getByLabel('Close settings').click();

      const treeRequestsBeforeStructure = treeRequestCount;
      await page.getByTestId('workspace-tabs').getByRole('tab', { name: 'Structure', exact: true }).click();
      await page.getByTestId('structure-workspace').getByText('index.html', { exact: true }).first().waitFor({ state: 'visible' });
      expect(treeRequestCount).toBeGreaterThan(treeRequestsBeforeStructure);
      await page.getByTestId('workspace-tabs').getByRole('tab', { name: 'Coder Chat', exact: true }).click();

      await page.setViewportSize({ width: 390, height: 844 });
      const narrowStreamlined = page.getByTestId('streamlined-chat-view').first();
      await narrowStreamlined.waitFor({ state: 'visible' });
      const narrowMetrics = await narrowStreamlined.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(narrowMetrics.scrollWidth).toBeLessThanOrEqual(narrowMetrics.clientWidth);
      const pageMetrics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(pageMetrics.scrollWidth).toBeLessThanOrEqual(pageMetrics.clientWidth);
    } finally {
      await page.close();
    }
  });

  it('covers Structure file selection, refresh, read failure, and guarded stale-save recovery', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    let treeRequestCount = 0;
    let putRequestCount = 0;
    let returnSaveSuccess = false;
    let restorePointCreateCount = 0;
    let restorePointRestoreCount = 0;
    const restorePointId = '123e4567-e89b-12d3-a456-426614174000';

    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;

      if (pathname === '/api/gemini/profiles') {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ profiles: [], selectedProfileId: '' }) });
        return;
      }
      if (pathname === '/api/workspace/default') {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ workspace: '' }) });
        return;
      }
      if (pathname === '/api/delegation/settings') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ settings: { enabled: false, delegates: [{ slot: 1, route: null }], maxConcurrentDelegates: 1 }, routes: [], errors: [] }),
        });
        return;
      }
      if (pathname === '/api/workspace/tree') {
        treeRequestCount += 1;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify([
            { name: 'app.ts', path: 'app.ts', type: 'file' },
            { name: 'missing.ts', path: 'missing.ts', type: 'file' },
          ]),
        });
        return;
      }
      if (pathname === '/api/workspace/restore-points' && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            restorePoints: [{
              id: restorePointId,
              label: 'Before edit',
              source: 'manual',
              createdAt: 1710000000000,
              workspace: 'target',
              fileCount: 1,
              totalBytes: 25,
            }],
          }),
        });
        return;
      }
      if (pathname === '/api/workspace/restore-points' && request.method() === 'POST') {
        restorePointCreateCount += 1;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            restorePoint: {
              id: restorePointId,
              label: 'Manual workspace restore point',
              source: 'manual',
              createdAt: 1710000001000,
              workspace: 'target',
              fileCount: 2,
              totalBytes: 50,
            },
          }),
        });
        return;
      }
      if (pathname === `/api/workspace/restore-points/${restorePointId}/restore` && request.method() === 'POST') {
        restorePointRestoreCount += 1;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            restored: { id: restorePointId, label: 'Before edit', source: 'manual', fileCount: 1, totalBytes: 25 },
            rollback: { id: '223e4567-e89b-12d3-a456-426614174000' },
            deletedFiles: 0,
          }),
        });
        return;
      }
      if (pathname === '/api/workspace/file' && request.method() === 'GET') {
        const path = new URL(request.url()).searchParams.get('path');
        if (path === 'missing.ts') {
          await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'File not found.' }) });
          return;
        }
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ content: 'const value = "remote";\n', hash: 'hash-2', modifiedAt: 1710000000000, size: 25 }),
        });
        return;
      }
      if (pathname === '/api/workspace/file' && request.method() === 'PUT') {
        putRequestCount += 1;
        if (!returnSaveSuccess) {
          await route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({
              conflict: true,
              error: 'The file changed on disk. Review the remote version before saving.',
              content: 'const value = "changed remotely";\n',
              hash: 'hash-3',
              modifiedAt: 1710000001000,
              size: 34,
            }),
          });
          return;
        }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ hash: 'hash-4', modifiedAt: 1710000002000, size: 25 }) });
        return;
      }
      if (pathname.includes('/model-targets')) {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ targets: [] }) });
        return;
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runs: [], threads: [], roots: [] }) });
    });

    try {
      await page.goto(baseUrl);
      const coderFileButton = page.getByTitle('Open app.ts');
      await coderFileButton.waitFor({ state: 'visible' });
      await coderFileButton.click();
      const openInStructure = page.getByTestId('open-file-in-structure');
      await openInStructure.waitFor({ state: 'visible' });
      await openInStructure.click();

      const structure = page.getByTestId('structure-workspace');
      await structure.getByText('app.ts', { exact: true }).first().waitFor({ state: 'visible' });
      const crossViewEditor = page.getByTestId('structure-file-editor');
      await crossViewEditor.waitFor({ state: 'visible' });
      expect(await crossViewEditor.inputValue()).toBe('const value = "remote";\n');

      await page.getByTestId('workspace-tabs').getByRole('tab', { name: 'Structure', exact: true }).click();
      await structure.getByText('app.ts', { exact: true }).first().waitFor({ state: 'visible' });

      const initialTreeRequests = treeRequestCount;
      await structure.getByText('app.ts', { exact: true }).first().click();
      const editor = page.getByTestId('structure-file-editor');
      await editor.waitFor({ state: 'visible' });
      expect(await editor.inputValue()).toBe('const value = "remote";\n');

      await editor.fill('const value = "local draft";\n');
      await structure.getByRole('button', { name: 'Save file' }).click();
      await structure.getByRole('alert').getByText('File changed on disk', { exact: true }).waitFor({ state: 'visible' });
      expect(putRequestCount).toBe(1);

      await structure.getByRole('button', { name: 'Reload remote' }).click();
      expect(await editor.inputValue()).toBe('const value = "changed remotely";\n');

      await editor.fill('const value = "saved draft";\n');
      returnSaveSuccess = true;
      await structure.getByRole('button', { name: 'Save file' }).click();
      await structure.getByRole('status').getByText('Saved app.ts', { exact: true }).waitFor({ state: 'visible' });
      expect(putRequestCount).toBe(2);

      const refreshResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/workspace/tree' && response.ok(),
      );
      await structure.getByTitle('Refresh workspace').click();
      await refreshResponse;
      expect(treeRequestCount).toBeGreaterThan(initialTreeRequests);

      await structure.getByText('missing.ts', { exact: true }).click();
      await structure.getByRole('alert').getByText('File not found.', { exact: true }).waitFor({ state: 'visible' });

      await structure.getByTestId('create-restore-point').click();
      await structure.getByRole('status').getByText('Restore point created with 2 files', { exact: false }).waitFor({ state: 'visible' });
      expect(restorePointCreateCount).toBe(1);
      page.once('dialog', (dialog) => void dialog.accept());
      await structure.getByTestId(`restore-point-${restorePointId}`).click();
      await structure.getByRole('status').getByText('Restored Before edit.', { exact: false }).waitFor({ state: 'visible' });
      expect(restorePointRestoreCount).toBe(1);
    } finally {
      await page.close();
    }
  });
});
