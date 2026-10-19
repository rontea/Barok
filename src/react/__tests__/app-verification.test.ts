import { describe, expect, it } from '@jest/globals';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createManifest,
  extractSuccessfulWorkspaceOutputs,
  generateManifestId,
  type AppManifest,
  type VerificationResult,
} from '../app-manifest';
import {
  analyzeFailures,
  shouldRepair,
  createRepairTask,
  discoverVerificationRepairFiles,
} from '../app-repair';
import { verifyApp, verifyViteApp } from '../app-verifier';
import {
  analyzeFailures as analyzeEngineFailures,
  extractSuccessfulWorkspaceOutputs as extractEngineWorkspaceOutputs,
} from '@barok/engine';

describe('App Manifest', () => {
  it('projects generated outputs through the host-supplied workspace path resolver', () => {
    const resolverCalls: Array<[string, string]> = [];
    const files = extractEngineWorkspaceOutputs([
      { action: 'Write', action_input: { file_path: 'src/app.ts' }, observation: JSON.stringify({ success: true }) },
      { action: 'Edit', action_input: { file_path: 'src/ignored.ts' }, observation: JSON.stringify({ success: false }) },
    ], '/workspace', (target, root) => {
      resolverCalls.push([target, root]);
      return target.replace(/^src\//, 'canonical/');
    });

    expect(files).toEqual(['canonical/app.ts']);
    expect(resolverCalls).toEqual([['src/app.ts', '/workspace']]);
  });

  it('records only successful canonical outputs inside the active workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'react-engine-app-outputs-'));
    try {
      await writeFile(join(workspace, 'index.html'), '<!doctype html><html><body></body></html>');
      const files = extractSuccessfulWorkspaceOutputs([
        { action: 'Write', action_input: { file_path: join(workspace, 'index.html') }, observation: JSON.stringify({ success: true }) },
        { action: 'Write', action_input: { file_path: 'styles.css' }, observation: JSON.stringify({ success: false, error: 'write rejected' }) },
        { action: 'Edit', action_input: { file_path: join(tmpdir(), 'unrelated-workspace', 'script.js') }, observation: JSON.stringify({ success: true }) },
      ], workspace);

      expect(files).toEqual(['index.html']);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('generates unique manifest IDs', () => {
    const id1 = generateManifestId();
    const id2 = generateManifestId();

    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toEqual(id2);
    expect(id1.length).toBeGreaterThan(5);
  });

  it('creates a manifest with proper structure', () => {
    const manifest = createManifest(
      'Test App',
      'game',
      'single-html',
      '/workspace',
      'index.html',
      ['index.html', 'style.css'],
      ['page load', 'responsive']
    );

    expect(manifest.appName).toBe('Test App');
    expect(manifest.appType).toBe('game');
    expect(manifest.outputMode).toBe('single-html');
    expect(manifest.entryPoint).toBe('index.html');
    expect(manifest.outputFiles).toHaveLength(2);
    expect(manifest.verificationChecks).toHaveLength(2);
    expect(manifest.timestamp).toBeDefined();
    expect(manifest.id).toBeDefined();
  });

  it('uses the built-in static preview when no dev or preview script exists', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'react-engine-static-preview-'));
    try {
      await mkdir(join(workspace, 'dist'));
      await writeFile(join(workspace, 'package.json'), JSON.stringify({
        scripts: { build: 'node build.js' },
      }));
      await writeFile(join(workspace, 'build.js'), "require('fs').mkdirSync('dist', { recursive: true });\n");
      await writeFile(join(workspace, 'index.html'), `<!doctype html>
        <html><body>
          <main>Static preview</main>
          <button onclick="document.body.dataset.clicked = 'yes'">Toggle</button>
        </body></html>`);

      const manifest = createManifest(
        'Static Site',
        'landing',
        'vite-react',
        workspace,
        'index.html',
        ['index.html'],
        ['project builds successfully', 'browser preview']
      );
      const result = await verifyViteApp(manifest, { timeout: 5_000 }, {
        appName: 'Static Site',
        appType: 'landing',
        requiredFeatures: ['static page'],
        dataPersistence: 'none',
      });

      expect(result.checks.find((check) => check.name === 'page loads successfully')?.passed).toBe(true);
      expect(result.signals.some((signal) => signal.type === 'page-load' && signal.passed)).toBe(true);
      expect(result.passed).toBe(true);
    } finally {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          await rm(workspace, { recursive: true, force: true });
          break;
        } catch (error) {
          if (attempt === 9) throw error;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }
  });

  it('verifies a vanilla multi-file app without package.json using static browser preview', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'react-engine-vanilla-preview-'));
    try {
      await writeFile(join(workspace, 'index.html'), `<!doctype html>
        <html><head><link rel="stylesheet" href="./style.css"></head><body>
          <main>Vanilla static app</main>
          <button onclick="document.body.dataset.clicked = 'yes'">Toggle</button>
          <script src="./script.js"></script>
        </body></html>`);
      await writeFile(join(workspace, 'style.css'), 'main { color: seagreen; }');
      await writeFile(join(workspace, 'script.js'), 'window.vanillaAppReady = true;');

      const manifest = createManifest(
        'Vanilla Static App',
        'tool',
        'vanilla-web',
        workspace,
        'index.html',
        ['index.html', 'style.css', 'script.js'],
        ['entry HTML file exists', 'browser preview']
      );
      const result = await verifyApp(manifest, { timeout: 5_000 }, {
        appName: 'Vanilla Static App',
        appType: 'tool',
        requiredFeatures: ['primary control'],
        dataPersistence: false,
      });

      expect(result.checks.find((check) => check.name === 'project build not required')?.passed).toBe(true);
      expect(result.checks.some((check) => check.name === 'project builds successfully')).toBe(false);
      expect(result.checks.some((check) => check.name === 'dist directory created')).toBe(false);
      expect(result.checks.find((check) => check.name === 'page loads successfully')?.passed).toBe(true);
      expect(result.signals.some((signal) => signal.type === 'no-console-errors' && signal.passed)).toBe(true);
      expect(result.passed).toBe(true);
    } finally {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          await rm(workspace, { recursive: true, force: true });
          break;
        } catch (error) {
          if (attempt === 9) throw error;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }
  });

  it('fails vanilla verification when required outputs or local CSS and JavaScript assets are missing', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'react-engine-vanilla-missing-assets-'));
    try {
      await writeFile(join(workspace, 'index.html'), `<!doctype html>
        <html><head><link rel="stylesheet" href="./style.css"></head><body>
          <main>Missing asset check</main><button>Continue</button><script src="./script.js"></script>
        </body></html>`);
      await writeFile(join(workspace, 'style.css'), 'main { color: seagreen; }');
      const result = await verifyViteApp(createManifest(
        'Missing Asset App',
        'tool',
        'vanilla-web',
        workspace,
        'index.html',
        ['index.html'],
        ['entry HTML file exists'],
        ['index.html', 'style.css', 'script.js'],
      ), { timeout: 5_000 }, {
        appName: 'Missing Asset App',
        appType: 'tool',
        requiredFeatures: ['continue action'],
        dataPersistence: false,
      });

      expect(result.checks.find((check) => check.name === 'static HTML document structure is valid')?.passed).toBe(true);
      expect(result.checks.find((check) => check.name === 'declared app output files exist')?.passed).toBe(true);
      expect(result.checks.find((check) => check.name === 'required app output files exist')?.passed).toBe(false);
      expect(result.checks.find((check) => check.name === 'local CSS and JavaScript references resolve')?.passed).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('does not let valid static HTML satisfy an inert browser interaction check', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'react-engine-vanilla-inert-control-'));
    try {
      await writeFile(join(workspace, 'index.html'), '<!doctype html><html><body><main>Board</main><input aria-label="Task"><button>Add task</button></body></html>');
      const result = await verifyViteApp(createManifest(
        'Inert App', 'dashboard', 'vanilla-web', workspace, 'index.html', ['index.html'], ['entry HTML file exists'],
      ), { timeout: 5_000 }, {
        appName: 'Inert App',
        appType: 'dashboard',
        requiredFeatures: ['create tasks'],
        dataPersistence: false,
      });

      expect(result.checks.find((check) => check.name === 'static HTML document structure is valid')?.passed).toBe(true);
      expect(result.checks.find((check) => check.name === 'primary interactive controls respond')?.passed).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe('App Repair', () => {
  it('exports repair classification from the Engine package entry', () => {
    expect(analyzeEngineFailures({
      passed: false,
      checkedAt: '2026-10-12T00:00:00.000Z',
      checks: [{ name: 'entry HTML file exists', passed: false }],
      summary: 'Entry is missing.',
      signals: [],
    })).toMatchObject({
      canRepair: true,
      suggestions: [expect.objectContaining({ check: 'entry HTML file exists', priority: 'critical' })],
    });
  });

  it('analyzes failed checks and generates repair suggestions', () => {
    const result: VerificationResult = {
      passed: false,
      checkedAt: new Date().toISOString(),
      checks: [
        {
          name: 'entry HTML file exists',
          passed: false,
          error: 'File not found: index.html',
        },
        {
          name: 'loads without uncaught console errors',
          passed: true,
        },
      ],
      signals: [
        { type: 'page-load', passed: false, message: 'No entry file' },
        { type: 'no-console-errors', passed: true, message: 'No errors' },
      ],
      summary: 'Failed',
    };

    const plan = analyzeFailures(result);

    expect(plan.suggestions).toHaveLength(1);
    expect(plan.suggestions[0].check).toBe('entry HTML file exists');
    expect(plan.suggestions[0].priority).toBe('critical');
    expect(plan.suggestions[0].suggestedActions).toHaveLength(3);
  });

  it('determines when repair should be attempted', () => {
    const failedResult: VerificationResult = {
      passed: false,
      checkedAt: new Date().toISOString(),
      checks: [{ name: 'test', passed: false }],
      signals: [
        { type: 'page-load', passed: true, message: 'Loaded' },
        { type: 'interactive', passed: false, message: 'No controls' },
      ],
      summary: 'Partial failure',
    };

    expect(shouldRepair(failedResult, 2)).toBe(true);

    const passedResult: VerificationResult = {
      passed: true,
      checkedAt: new Date().toISOString(),
      checks: [{ name: 'test', passed: true }],
      signals: [{ type: 'page-load', passed: true, message: 'Success' }],
      summary: 'Success',
    };

    expect(shouldRepair(passedResult, 2)).toBe(false);
  });

  it('creates a descriptive repair task prompt', () => {
    const manifest: AppManifest = {
      id: 'test-123',
      timestamp: new Date().toISOString(),
      appName: 'Test Game',
      appType: 'game',
      outputMode: 'single-html',
      workspace: '/test',
      entryPoint: 'game.html',
      outputFiles: ['game.html'],
      verificationChecks: ['page load', 'responsive'],
    };

    const result: VerificationResult = {
      passed: false,
      checkedAt: new Date().toISOString(),
      checks: [
        {
          name: 'desktop and mobile layout render without overlap',
          passed: false,
          error: 'Layout overflow on mobile',
        },
      ],
      signals: [{ type: 'responsive', passed: false, message: 'Overflow' }],
      summary: 'Layout issue',
    };

    const appSpec = {
      appType: 'game',
      requiredFeatures: ['playable game loop', 'score display'],
    };

    const task = createRepairTask(manifest, result, appSpec);

    expect(task).toContain('Repair Task');
    expect(task).toContain('Test Game');
    expect(task).toContain('game');
    expect(task).toContain('Critical Issues to Fix');
    expect(task).toContain('incremental repair pass');
    expect(task).toContain('Do not regenerate or rewrite an existing file wholesale');
  });

  it('discovers existing scripts and styles referenced by the verified HTML', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'react-engine-repair-scope-'));
    try {
      await writeFile(join(workspace, 'index.html'), `<!doctype html>
        <link rel="stylesheet" href="./style.css">
        <script src="./script.js"></script>`);
      await writeFile(join(workspace, 'style.css'), 'body { color: red; }');
      await writeFile(join(workspace, 'script.js'), 'window.ready = true;');

      const files = await discoverVerificationRepairFiles({
        workspace,
        entryPoint: 'index.html',
        outputFiles: ['index.html'],
      });

      expect(files).toEqual(expect.arrayContaining(['index.html', 'style.css', 'script.js']));
      expect(createRepairTask(
        { appName: 'Scoped App' },
        {
          passed: false,
          checkedAt: new Date().toISOString(),
          checks: [{ name: 'primary interactive controls respond', passed: false, error: 'No controls' }],
          signals: [{ type: 'interactive', passed: false, message: 'No controls' }],
          summary: 'Needs repair',
        },
        { appType: 'landing', requiredFeatures: ['interactivity'] },
        files,
      )).toContain('- script.js');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('keeps missing required output names in an incremental repair prompt', () => {
    const task = createRepairTask({
      appName: 'Missing Files App',
      requiredOutputFiles: ['index.html', 'styles.css', 'script.js'],
    }, {
      passed: false,
      checkedAt: new Date().toISOString(),
      checks: [{ name: 'required app output files exist', passed: false, error: 'Missing required app output files: script.js' }],
      signals: [],
      summary: 'Missing deliverable',
    }, { appType: 'dashboard', requiredFeatures: ['task creation'] });

    expect(task).toContain('Required app deliverables');
    expect(task).toContain('- script.js');
  });
});
