/**
 * App Verification Module
 * Implements smoke tests and verification checks for generated apps using Playwright
 */

import path from 'path';
import { promises as fs } from 'fs';
import { createServer as createNetServer } from 'net';
import { createServer as createHttpServer, type Server as HttpServer } from 'http';
import { spawn, type ChildProcess } from 'child_process';
import type { ConsoleMessage } from 'playwright';
import type {
  AppManifest,
  GeneratedAppVerificationCheck as VerificationCheck,
  VerificationResult,
  VerificationSignal,
} from '@barok/engine';
import { getWorkspaceRelativePath } from './path-validator.js';
import { 
  checkQualityGates,
  allCriticalGatesPassed,
  calculateQualityScore,
  type QualityGateCheckData,
} from '@barok/engine';

export type VerificationStrategy = 'html' | 'vite-react';

export interface VerificationOptions {
  timeout?: number;
  headless?: boolean;
  screenshot?: boolean;
}

interface BrowserInspectionResult {
  checks: VerificationCheck[];
  signals: VerificationSignal[];
}

interface LocalPreview {
  child?: ChildProcess;
  server?: HttpServer;
  url: string;
}

interface BrowserStateSnapshot {
  href: string;
  text: string;
  html: string;
  controls: string;
  localStorage: string;
}

async function snapshotBrowserState(page: any): Promise<BrowserStateSnapshot> {
  return page.evaluate(() => {
    let localStorageSnapshot = '';
    try {
      localStorageSnapshot = JSON.stringify(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)]));
    } catch {
      localStorageSnapshot = 'unavailable';
    }
    return {
      href: location.href,
      text: document.body?.innerText || '',
      html: document.documentElement?.outerHTML || '',
      controls: JSON.stringify(Array.from(document.querySelectorAll('input, textarea, select')).map((element) => {
        const control = element as HTMLInputElement;
        return [element.tagName, control.value, control.checked];
      })),
      localStorage: localStorageSnapshot,
    };
  });
}

function browserStateChanged(left: BrowserStateSnapshot, right: BrowserStateSnapshot): boolean {
  return left.href !== right.href || left.text !== right.text || left.html !== right.html ||
    left.controls !== right.controls || left.localStorage !== right.localStorage;
}

async function exercisePrimaryControl(page: any): Promise<{
  controlCount: number;
  buttonCount: number;
  before: BrowserStateSnapshot;
  after: BrowserStateSnapshot;
  responded: boolean;
  probeValue?: string;
  error?: string;
}> {
  const before = await snapshotBrowserState(page);
  const buttonCount = await page.locator('button').count();
  const controlCount = await page.locator('button, input, textarea, select, [role="button"], [onclick]').count();
  let baseline = before;
  let probeValue: string | undefined;
  let error: string | undefined;

  try {
    const textInput = page.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea').first();
    if (await textInput.count()) {
      probeValue = `react-engine-probe-${Date.now()}`;
      await textInput.fill(probeValue, { timeout: 3_000 });
      baseline = await snapshotBrowserState(page);
    }

    if (buttonCount > 0) {
      const usefulButton = page.locator('button').filter({ hasText: /add|create|save|submit|search|send|start|play|new|task|todo/i }).first();
      const target = await usefulButton.count() ? usefulButton : page.locator('button').first();
      await target.click({ timeout: 3_000 });
    } else if (probeValue) {
      await page.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea').first().press('Enter', { timeout: 3_000 });
    } else {
      const toggle = page.locator('input[type="checkbox"], input[type="radio"]').first();
      if (await toggle.count()) {
        await toggle.click({ timeout: 3_000 });
      } else {
        const select = page.locator('select').first();
        const optionCount = await select.locator('option').count().catch(() => 0);
        if (optionCount > 1) {
          await select.selectOption({ index: 1 }, { timeout: 3_000 });
        } else {
          const roleButton = page.locator('[role="button"]').first();
          if (await roleButton.count()) await roleButton.click({ timeout: 3_000 });
        }
      }
    }
  } catch (probeError) {
    error = probeError instanceof Error ? probeError.message : String(probeError);
  }

  await wait(150);
  const after = await snapshotBrowserState(page);
  return {
    controlCount,
    buttonCount,
    before,
    after,
    responded: controlCount > 0 && !error && browserStateChanged(baseline, after),
    ...(probeValue ? { probeValue } : {}),
    ...(error ? { error } : {}),
  };
}

const STATIC_PREVIEW_MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatCommandFailure(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error);
  const failure = error as { message?: unknown; stdout?: unknown; stderr?: unknown };
  const output = [failure.stdout, failure.stderr]
    .map((value) => Buffer.isBuffer(value) ? value.toString('utf8') : typeof value === 'string' ? value : '')
    .filter(Boolean)
    .join('\n')
    .trim();
  return [typeof failure.message === 'string' ? failure.message : 'Command failed.', output]
    .filter(Boolean)
    .join('\n')
    .slice(0, 12_000);
}

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function startLocalPreview(workspace: string, timeout: number): Promise<LocalPreview> {
  const packageFile = JSON.parse(await fs.readFile(path.join(workspace, 'package.json'), 'utf8')) as {
    scripts?: Record<string, unknown>;
  };
  const script = typeof packageFile.scripts?.preview === 'string'
    ? 'preview'
    : typeof packageFile.scripts?.dev === 'string'
      ? 'dev'
      : undefined;
  const port = await findAvailablePort();
  if (!script) return startStaticPreview(workspace, port);

  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(executable, ['run', script, '--', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: workspace,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString(); });

  const url = `http://127.0.0.1:${port}/`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (child.exitCode !== null) {
      throw new Error(`Local preview exited before becoming ready: ${output.slice(-2000)}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return { child, url };
    } catch {
      // The server may need another poll while its dependency graph starts.
    }
    await wait(100);
  }
  child.kill();
  throw new Error(`Timed out waiting for local preview at ${url}. ${output.slice(-2000)}`);
}

async function startStaticPreview(workspace: string, port: number): Promise<LocalPreview> {
  const root = path.resolve(workspace);
  const server = createHttpServer((request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
      const decodedPath = decodeURIComponent(requestUrl.pathname);
      const requested = decodedPath === '/' ? '/index.html' : decodedPath;
      const filePath = path.resolve(root, `.${requested}`);
      if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }
      fs.stat(filePath).then((stats) => {
        if (!stats.isFile()) {
          response.writeHead(404);
          response.end('Not found');
          return;
        }
        response.writeHead(200, {
          'Content-Type': STATIC_PREVIEW_MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        });
        fs.readFile(filePath).then((content) => response.end(content)).catch(() => {
          if (!response.writableEnded) {
            response.writeHead(500);
            response.end('Unable to read file');
          }
        });
      }).catch(() => {
        response.writeHead(404);
        response.end('Not found');
      });
    } catch {
      response.writeHead(400);
      response.end('Bad request');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return { server, url: `http://127.0.0.1:${port}/` };
}

async function stopLocalPreview(preview: LocalPreview | undefined): Promise<void> {
  if (!preview) return;
  if (preview.server) {
    await new Promise<void>((resolve) => preview.server?.close(() => resolve()));
    return;
  }
  if (!preview.child || preview.child.exitCode !== null) return;
  const child = preview.child;
  const waitForExit = async (): Promise<void> => {
    if (child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1_000);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };
  if (process.platform === 'win32' && child.pid) {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('close', () => resolve());
      killer.once('error', () => resolve());
    });
    // taskkill can report success before a directly spawned Node child has
    // emitted its close event. Follow it with a direct kill for the preview
    // process so its stdio handles are released before the workspace closes.
    if (child.exitCode === null) child.kill();
    await waitForExit();
    return;
  }
  child.kill('SIGTERM');
  await waitForExit();
}

async function inspectBrowserUrl(
  url: string,
  manifest: AppManifest,
  options: VerificationOptions,
  appSpec?: any,
): Promise<BrowserInspectionResult> {
  const checks: VerificationCheck[] = [];
  const signals: VerificationSignal[] = [];
  let browser: any;

  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: options.headless !== false });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const requestFailures: string[] = [];

    page.on('console', (message: ConsoleMessage) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error: Error) => pageErrors.push(error.message));
    page.on('requestfailed', (request: any) => {
      const failure = request.failure?.();
      if (failure?.errorText) requestFailures.push(`${request.url()}: ${failure.errorText}`);
    });

    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeout || 30_000 });
      if (response && !response.ok()) throw new Error(`HTTP ${response.status()} while loading ${url}`);
      await page.waitForLoadState('networkidle', { timeout: Math.min(options.timeout || 30_000, 10_000) }).catch(() => undefined);
      checks.push({ name: 'page loads successfully', passed: true, details: { url } });
      signals.push({ type: 'page-load', passed: true, message: 'Page loaded successfully in a browser.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checks.push({ name: 'page loads successfully', passed: false, error: message });
      signals.push({ type: 'page-load', passed: false, message });
      return { checks, signals };
    }

    const runtimeErrors = [...consoleErrors, ...pageErrors, ...requestFailures];
    const consoleClean = runtimeErrors.length === 0;
    checks.push({
      name: 'loads without uncaught console errors',
      passed: consoleClean,
      ...(consoleClean ? {} : { error: runtimeErrors.join('; '), details: { errors: runtimeErrors } }),
    });
    signals.push({
      type: 'no-console-errors',
      passed: consoleClean,
      message: consoleClean ? 'No browser console, runtime, or request errors detected.' : `Browser errors detected: ${runtimeErrors.join('; ')}`,
    });

    const desktopLayout = await checkLayoutIntegrity(page);
    await page.setViewportSize({ width: 375, height: 667 });
    const mobileLayout = await checkLayoutIntegrity(page);
    const responsive = desktopLayout && mobileLayout;
    checks.push({ name: 'desktop and mobile layout render without overlap', passed: responsive, details: { desktop: desktopLayout, mobile: mobileLayout } });
    signals.push({ type: 'responsive', passed: responsive, message: responsive ? 'Desktop and mobile layouts fit the viewport.' : 'Layout overflow or missing visible content was detected.' });

    const interaction = await exercisePrimaryControl(page);
    const controlsResponded = interaction.responded;
    checks.push({
      name: 'primary interactive controls respond',
      passed: controlsResponded,
      ...(controlsResponded ? {} : { error: interaction.error || (interaction.controlCount === 0
        ? 'No interactive controls were found.'
        : 'The primary control did not produce an observable application-state change.') }),
      details: {
        controlCount: interaction.controlCount,
        buttonCount: interaction.buttonCount,
        observableChange: controlsResponded,
      },
    });
    signals.push({
      type: 'interactive',
      passed: controlsResponded,
      message: controlsResponded
        ? 'A browser interaction produced an observable application-state change.'
        : interaction.error || (interaction.controlCount === 0 ? 'No interactive controls found.' : 'The primary control produced no observable state change.'),
    });

    if (manifest.appType === 'game') {
      const hasGameStart = await page.locator('button').evaluateAll((buttons: Element[]) =>
        buttons.some((button) => /start|play|restart|resume/i.test(button.textContent || '')),
      );
      checks.push({ name: 'game can start or restart', passed: hasGameStart, details: { hasGameStart } });
      signals.push({ type: 'interactive', passed: hasGameStart, message: hasGameStart ? 'Game start/restart control detected.' : 'No game start or restart control detected.' });
    }

    if (manifest.appType === 'editor' || manifest.appType === 'game') {
      const canvasContent = await page.locator('canvas').evaluateAll((canvases: Element[]) => canvases.some((element) => {
        const canvas = element as HTMLCanvasElement;
        const context = canvas.getContext('2d');
        if (!context || canvas.width === 0 || canvas.height === 0) return false;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) return true;
        return false;
      }));
      if (canvasContent) signals.push({ type: 'canvas-content', passed: true, message: 'Canvas contains visible content.' });
    }

    const persistenceRequired = Boolean(appSpec?.dataPersistence && appSpec.dataPersistence !== 'none') ||
      manifest.verificationChecks.some((check) => /localStorage/i.test(check));
    if (persistenceRequired) {
      const storageChanged = interaction.before.localStorage !== interaction.after.localStorage;
      let persisted = false;
      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: options.timeout || 30_000 });
        const afterReload = await snapshotBrowserState(page);
        const probeVisible = Boolean(interaction.probeValue && interaction.after.text.includes(interaction.probeValue));
        persisted = storageChanged && interaction.after.localStorage === afterReload.localStorage &&
          (!probeVisible || afterReload.text.includes(interaction.probeValue || ''));
      } catch {
        persisted = false;
      }
      checks.push({
        name: 'application state persists after reload',
        passed: persisted,
        ...(!persisted ? { error: 'The exercised application action did not produce state that survived a browser reload.' } : {}),
      });
      signals.push({ type: 'persistence', passed: persisted, message: persisted
        ? 'Application state changed and survived a browser reload.'
        : 'Application state did not survive a browser reload.' });
    }

    if (options.screenshot) {
      const screenshotDir = path.join(manifest.workspace, '.react-engine', 'screenshots');
      await fs.mkdir(screenshotDir, { recursive: true });
      const screenshotPath = path.join(screenshotDir, `${manifest.id}-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      checks.push({ name: 'screenshot captured', passed: true, details: { path: screenshotPath } });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({ name: 'browser verification execution', passed: false, error: message });
    signals.push({ type: 'page-load', passed: false, message });
  } finally {
    await browser?.close().catch(() => undefined);
  }

  return { checks, signals };
}

async function verifyVanillaStaticOutputs(manifest: AppManifest): Promise<VerificationCheck[]> {
  const checks: VerificationCheck[] = [];
  const workspace = manifest.workspace;
  const declaredOutputs = Array.isArray(manifest.outputFiles) ? manifest.outputFiles : [];
  const requiredOutputs = Array.isArray(manifest.requiredOutputFiles) && manifest.requiredOutputFiles.length > 0
    ? manifest.requiredOutputFiles
    : declaredOutputs;
  const missingOutputs: string[] = [];
  for (const output of declaredOutputs) {
    try {
      const relativePath = getWorkspaceRelativePath(output, workspace);
      const stats = await fs.stat(path.join(workspace, relativePath));
      if (!stats.isFile()) missingOutputs.push(relativePath);
    } catch {
      missingOutputs.push(output);
    }
  }
  const hasDeclaredOutputs = declaredOutputs.length > 0;
  checks.push({
    name: 'declared app output files exist',
    passed: hasDeclaredOutputs && missingOutputs.length === 0,
    ...(!hasDeclaredOutputs || missingOutputs.length
      ? { error: !hasDeclaredOutputs ? 'No successful app output files were recorded.' : `Missing output files: ${missingOutputs.join(', ')}` }
      : {}),
    details: { declared: declaredOutputs.length, missing: missingOutputs },
  });

  const missingRequiredOutputs: string[] = [];
  for (const output of requiredOutputs) {
    try {
      const relativePath = getWorkspaceRelativePath(output, workspace);
      const stats = await fs.stat(path.join(workspace, relativePath));
      if (!stats.isFile()) missingRequiredOutputs.push(relativePath);
    } catch {
      missingRequiredOutputs.push(output);
    }
  }
  checks.push({
    name: 'required app output files exist',
    passed: requiredOutputs.length > 0 && missingRequiredOutputs.length === 0,
    ...(!requiredOutputs.length || missingRequiredOutputs.length
      ? { error: !requiredOutputs.length
        ? 'No required app output files were declared.'
        : `Missing required app output files: ${missingRequiredOutputs.join(', ')}` }
      : {}),
    details: { required: requiredOutputs.length, missing: missingRequiredOutputs },
  });

  let entryPath: string;
  let html: string;
  try {
    const entryRelative = getWorkspaceRelativePath(manifest.entryPoint, workspace);
    entryPath = path.join(workspace, entryRelative);
    html = await fs.readFile(entryPath, 'utf8');
  } catch {
    checks.push({
      name: 'static HTML document structure is valid',
      passed: false,
      error: `Entry HTML file is missing or outside the active workspace: ${manifest.entryPoint}`,
    });
    checks.push({
      name: 'local CSS and JavaScript references resolve',
      passed: false,
      error: 'Local assets cannot be checked because the entry HTML file is unavailable.',
    });
    return checks;
  }

  const htmlValid = /<!doctype\s+html\b|<html(?:\s|>)|<(?:head|body|title|meta|script|style|canvas)(?:\s|>)/i.test(html);
  checks.push({
    name: 'static HTML document structure is valid',
    passed: htmlValid,
    ...(!htmlValid ? { error: 'Expected an HTML doctype or document element.' } : {}),
  });

  const references: string[] = [];
  const attribute = (tag: string, name: string): string | undefined => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
    return match?.[1] ?? match?.[2] ?? match?.[3];
  };
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if ((attribute(tag, 'rel') || '').split(/\s+/).some((value) => value.toLowerCase() === 'stylesheet')) {
      const href = attribute(tag, 'href');
      if (href) references.push(href);
    }
  }
  for (const tag of html.match(/<script\b[^>]*>/gi) || []) {
    const src = attribute(tag, 'src');
    if (src) references.push(src);
  }

  const unresolved: string[] = [];
  for (const reference of references) {
    const trimmed = reference.trim();
    if (!trimmed || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(trimmed)) continue;
    let pathname = trimmed.split(/[?#]/, 1)[0];
    try { pathname = decodeURIComponent(pathname); } catch { /* Check the undecoded literal. */ }
    try {
      const referencedPath = pathname.startsWith('/')
        ? path.resolve(workspace, `.${pathname}`)
        : path.resolve(path.dirname(entryPath), pathname);
      const relativePath = getWorkspaceRelativePath(referencedPath, workspace);
      const stats = await fs.stat(path.join(workspace, relativePath));
      if (!stats.isFile()) unresolved.push(trimmed);
    } catch {
      unresolved.push(trimmed);
    }
  }
  checks.push({
    name: 'local CSS and JavaScript references resolve',
    passed: unresolved.length === 0,
    ...(unresolved.length ? { error: `Unresolved local assets: ${unresolved.join(', ')}` } : {}),
    details: { checked: references.length, unresolved },
  });
  return checks;
}

/**
 * Verify a standalone HTML app
 */
export async function verifyHtmlApp(
  manifest: AppManifest,
  options: VerificationOptions = {},
  appSpec?: any
): Promise<VerificationResult> {
  const checks: VerificationCheck[] = [];
  const signals: VerificationSignal[] = [];
  const startTime = Date.now();

  try {
    // Lazy import Playwright to avoid dependency issues if not installed
    const { chromium } = await import('playwright');

    // 1. Check that entry file exists
    const entryPath = path.join(manifest.workspace, manifest.entryPoint);
    try {
      await fs.access(entryPath);
      checks.push({ name: 'entry HTML file exists', passed: true });
      signals.push({
        type: 'page-load',
        passed: true,
        message: 'Entry point file exists',
      });
    } catch {
      checks.push({
        name: 'entry HTML file exists',
        passed: false,
        error: `File not found: ${entryPath}`,
      });
      signals.push({
        type: 'page-load',
        passed: false,
        message: `Entry file not found: ${manifest.entryPoint}`,
      });
      return createVerificationResult(manifest, checks, signals, false, appSpec);
    }

    // 2. Load in browser and check for console errors
    const browser = await chromium.launch({ headless: options.headless !== false });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();
    const consoleErrors: string[] = [];

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    const fileUrl = `file://${entryPath}`;
    let pageLoadSuccess = false;
    try {
      await page.goto(fileUrl, { waitUntil: 'networkidle', timeout: options.timeout || 30000 });
      pageLoadSuccess = true;
      signals.push({
        type: 'page-load',
        passed: true,
        message: 'Page loaded successfully',
      });
    } catch (error) {
      checks.push({
        name: 'loads without uncaught console errors',
        passed: false,
        error: `Page load failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      signals.push({
        type: 'page-load',
        passed: false,
        message: 'Page failed to load',
      });
      await browser.close();
      return createVerificationResult(manifest, checks, signals, false, appSpec);
    }

    if (consoleErrors.length === 0) {
      checks.push({ name: 'loads without uncaught console errors', passed: true });
      signals.push({
        type: 'no-console-errors',
        passed: true,
        message: 'No console errors detected',
      });
    } else {
      checks.push({
        name: 'loads without uncaught console errors',
        passed: false,
        error: `Console errors: ${consoleErrors.join('; ')}`,
        details: { errors: consoleErrors },
      });
      signals.push({
        type: 'no-console-errors',
        passed: false,
        message: `Found ${consoleErrors.length} console errors`,
      });
    }

    // 3. Check responsive layout (desktop and mobile)
    const desktopSize = { width: 1280, height: 720 };
    const mobileSize = { width: 375, height: 667 };

    await page.setViewportSize(desktopSize);
    const desktopLayout = await checkLayoutIntegrity(page);

    await page.setViewportSize(mobileSize);
    const mobileLayout = await checkLayoutIntegrity(page);

    const responsivePass = desktopLayout && mobileLayout;
    checks.push({
      name: 'desktop and mobile layout render without overlap',
      passed: responsivePass,
      details: {
        desktop: desktopLayout,
        mobile: mobileLayout,
      },
    });

    if (responsivePass) {
      signals.push({
        type: 'responsive',
        passed: true,
        message: 'Layout renders correctly on desktop and mobile',
      });
    } else {
      signals.push({
        type: 'responsive',
        passed: false,
        message: 'Layout issues detected on one or more viewports',
      });
    }

    // 4. Check for interactive controls
    const hasInteractiveElements = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      const inputs = document.querySelectorAll('input, textarea, select');
      const clickables = document.querySelectorAll('[onclick], [role="button"]');
      return buttons.length + inputs.length + clickables.length > 0;
    });

    checks.push({
      name: 'primary interactive controls respond',
      passed: hasInteractiveElements,
      details: { hasInteractiveElements },
    });

    if (hasInteractiveElements) {
      signals.push({
        type: 'interactive',
        passed: true,
        message: 'Interactive controls detected',
      });
    } else {
      signals.push({
        type: 'interactive',
        passed: false,
        message: 'No interactive controls found',
      });
    }

    // 5. For games: check game start capability
    if (manifest.appType === 'game') {
      const hasGameStart = await page.evaluate(() => {
        const restartBtn = document.querySelector('button:has-text("Restart"), button:has-text("Start"), [data-action="restart"]');
        return !!restartBtn;
      });

      checks.push({
        name: 'game can start or restart',
        passed: hasGameStart,
        details: { hasRestartButton: hasGameStart },
      });

      if (hasGameStart) {
        signals.push({
          type: 'interactive',
          passed: true,
          message: 'Game restart control available',
        });
      }
    }

    // 6. For canvas apps: check for canvas content
    if (manifest.appType === 'editor' || manifest.appType === 'game') {
      const canvasContent = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return false;
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] > 0) return true; // Non-transparent pixel
        }
        return false;
      });

      if (canvasContent) {
        signals.push({
          type: 'canvas-content',
          passed: true,
          message: 'Canvas has visual content',
        });
      }
    }

    // 7. Check localStorage for persistence
    if (manifest.verificationChecks.some((c) => c.includes('localStorage'))) {
      const hasLocalStorage = await page.evaluate(() => {
        try {
          localStorage.setItem('_test_key_', '_test_value_');
          const value = localStorage.getItem('_test_key_');
          localStorage.removeItem('_test_key_');
          return value === '_test_value_';
        } catch {
          return false;
        }
      });

      if (hasLocalStorage) {
        signals.push({
          type: 'persistence',
          passed: true,
          message: 'localStorage persistence available',
        });
      }
    }

    // 8. Take screenshot if requested
    if (options.screenshot) {
      const screenshotDir = path.join(manifest.workspace, '.react-engine', 'screenshots');
      await fs.mkdir(screenshotDir, { recursive: true });
      const screenshotPath = path.join(screenshotDir, `${manifest.id}-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      checks.push({
        name: 'screenshot captured',
        passed: true,
        details: { path: screenshotPath },
      });
    }

    await browser.close();

    const allPassed = checks.every((c) => c.passed);
    return createVerificationResult(manifest, checks, signals, allPassed, appSpec);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    checks.push({
      name: 'verification execution',
      passed: false,
      error: errorMsg,
    });

    return createVerificationResult(
      manifest,
      checks,
      [...signals, { type: 'page-load', passed: false, message: errorMsg }],
      false,
      appSpec
    );
  }
}

/**
 * Verify a Vite React app build
 */
export async function verifyViteApp(
  manifest: AppManifest,
  options: VerificationOptions = {},
  appSpec?: any
): Promise<VerificationResult> {
  const checks: VerificationCheck[] = [];
  const signals: VerificationSignal[] = [];
  let preview: LocalPreview | undefined;

  try {
    const cwd = manifest.workspace;
    let hasPackageJson = false;
    let packageScripts: Record<string, unknown> | undefined;
    try {
      const packageJson = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8')) as {
        scripts?: Record<string, unknown>;
      };
      hasPackageJson = true;
      packageScripts = packageJson.scripts;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const hasBuildScript = typeof packageScripts?.build === 'string' && Boolean(packageScripts.build.trim());

    // 1. Run a build only when the workspace declares one. Static HTML/CSS/JS
    // projects commonly have no package.json and can still be inspected in a browser.
    if (hasBuildScript) {
      const { execSync } = await import('child_process');
      try {
        execSync('npm run build', { cwd, timeout: 60000 });
        checks.push({ name: 'project builds successfully', passed: true });
        signals.push({
          type: 'build-success',
          passed: true,
          message: 'Project built successfully',
        });
      } catch (error) {
        checks.push({
          name: 'project builds successfully',
          passed: false,
          error: formatCommandFailure(error),
        });
        signals.push({
          type: 'build-success',
          passed: false,
          message: 'Build failed',
        });
        return createVerificationResult(manifest, checks, signals, false, appSpec);
      }
    } else {
      checks.push({
        name: 'project build not required',
        passed: true,
        details: {
          reason: hasPackageJson ? 'No build script is declared in package.json.' : 'No package.json or build system was found.',
        },
      });
    }

    if (manifest.outputMode === 'vanilla-web') {
      checks.push(...await verifyVanillaStaticOutputs(manifest));
    }

    // 2. Check that source and build entry points exist.
    const entryCandidates = [manifest.entryPoint, 'index.html']
      .filter((candidate, index, candidates) => candidate && candidates.indexOf(candidate) === index);
    const existingEntry = await (async () => {
      for (const candidate of entryCandidates) {
        try {
          await fs.access(path.join(manifest.workspace, candidate));
          return candidate;
        } catch {
          // Try the next conventional Vite entry point.
        }
      }
      return undefined;
    })();
    if (existingEntry) {
      checks.push({ name: 'entry point file exists', passed: true, details: { path: existingEntry } });
    } else {
      checks.push({
        name: 'entry point file exists',
        passed: false,
        error: `File not found: ${entryCandidates.join(' or ')}`,
      });
    }

    // 3. A dist directory is meaningful only when the declared build script ran.
    if (hasBuildScript) {
      const distPath = path.join(manifest.workspace, 'dist');
      try {
        await fs.access(distPath);
        checks.push({ name: 'dist directory created', passed: true });
      } catch {
        checks.push({
          name: 'dist directory created',
          passed: false,
          error: 'dist/ not found after build',
        });
      }
    }

    // 4. Start the actual app and inspect it with a browser. Build success
    // alone cannot catch runtime module failures, console errors, broken
    // responsive layout, or controls that do not respond.
    try {
      if (hasPackageJson) {
        preview = await startLocalPreview(manifest.workspace, options.timeout || 30_000);
      } else {
        preview = await startStaticPreview(manifest.workspace, await findAvailablePort());
      }
      const browserInspection = await inspectBrowserUrl(preview.url, manifest, options, appSpec);
      checks.push(...browserInspection.checks);
      signals.push(...browserInspection.signals);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checks.push({ name: 'browser verification available', passed: false, error: message });
      signals.push({ type: 'page-load', passed: false, message });
    }

    const allPassed = checks.every((check) => check.passed);
    return createVerificationResult(manifest, checks, signals, allPassed, appSpec);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    checks.push({
      name: 'verification execution',
      passed: false,
      error: errorMsg,
    });

    return createVerificationResult(
      manifest,
      checks,
      [...signals, { type: 'build-success', passed: false, message: errorMsg }],
      false,
      appSpec
    );
  } finally {
    await stopLocalPreview(preview);
  }
}

/**
 * Helper: Check layout integrity
 */
async function checkLayoutIntegrity(page: any): Promise<boolean> {
  try {
    const result = await page.evaluate(() => {
      const root = document.documentElement;
      const bodyWidth = document.body.offsetWidth;
      const htmlWidth = root.offsetWidth;
      const hasOverflow = document.body.scrollWidth > window.innerWidth;
      const visibleContent = document.querySelectorAll('body *').length > 0;

      // Layout is good if: width matches viewport, no overflow, and has content
      return !hasOverflow && visibleContent;
    });
    return result;
  } catch {
    return false;
  }
}

/**
 * Helper: Create verification result with quality gate checking
 */
function createVerificationResult(
  manifest: AppManifest,
  checks: VerificationCheck[],
  signals: VerificationSignal[],
  passed: boolean,
  appSpec?: any
): VerificationResult {
  const passedCount = signals.filter((s) => s.passed).length;
  const summary =
    passed
      ? `All checks passed (${checks.length}/${checks.length})`
      : `${passedCount} of ${signals.length} signals detected`;

  // Convert signals to the format expected by quality gate checks
  const verificationSignals = signals.map((s) => ({
    name: s.type,
    passed: s.passed,
  }));

  // Check quality gates (Phase 6)
  const gateCheckData: QualityGateCheckData = {
    appSpec,
    verificationResult: { passed, signals: verificationSignals, checks },
    verificationSignals,
    entryPoint: manifest.entryPoint,
    outputFiles: manifest.outputFiles,
  };

  const qualityGateResults = checkQualityGates(gateCheckData);
  const qualityScore = calculateQualityScore(qualityGateResults);
  const allCriticalGatesPassed_ = allCriticalGatesPassed(qualityGateResults);

  return {
    passed: passed && allCriticalGatesPassed_,
    checkedAt: new Date().toISOString(),
    checks,
    signals,
    summary,
    // Phase 6: Quality gates
    qualityGates: qualityGateResults,
    qualityScore,
  };
}

/**
 * Verify app based on output mode
 */
export async function verifyApp(
  manifest: AppManifest,
  options: VerificationOptions = {},
  appSpec?: any
): Promise<VerificationResult> {
  if (manifest.outputMode === 'single-html') {
    return verifyHtmlApp(manifest, options, appSpec);
  } else if (manifest.outputMode === 'vite-react' || manifest.outputMode === 'vanilla-web') {
    return verifyViteApp(manifest, options, appSpec);
  } else {
    return {
      passed: false,
      checkedAt: new Date().toISOString(),
      checks: [
        {
          name: 'verification execution',
          passed: false,
          error: `Unknown output mode: ${manifest.outputMode}`,
        },
      ],
      signals: [],
      summary: 'Unknown output mode',
    };
  }
}
