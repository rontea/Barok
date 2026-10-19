import express from 'express';
import dotenv from 'dotenv';
import { join, resolve } from 'path';
import path from 'path';
import { createServer as createHttpServer } from 'http';
import type { Server } from 'http';
import { getServerRunManager } from './src/react/run-manager.js';
import process from 'process';
import {
  getLegacyOpenRouterConfigurationWarning,
  getLegacyGroqConfigurationWarning,
} from './src/config/runtimeEnv.js';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import {
  setExecutionProfilePresets,
} from './src/config/executionProfiles.js';
import { initializeRuntimeSettings } from './src/config/runtimeSettings.js';
import {
  sanitizeError,
  ensureWorkspaceRoot,
  createWorkspacePolicyMiddleware,
  getRepositoryCommitHash,
} from './src/routes/_shared.js';
import { createRouter as createSettingsRouter } from './src/routes/settings.js';
import { createRouter as createWorkplansRouter } from './src/routes/workplans.js';
import { createRouter as createCoderRouter, migrateLegacyCoderThreads } from './src/routes/coder.js';
import { createRouter as createWorkspaceRouter } from './src/routes/workspace.js';
import { createRouter as createRunsRouter } from './src/routes/runs.js';
import { createRouter as createProvidersRouter } from './src/routes/providers.js';
import { createRouter as createSystemRouter } from './src/routes/system.js';
import { getSQLiteAppStore } from './src/persistence/sqliteStore.js';
import {
  createApiAccessMiddleware,
  createConfiguredCorsMiddleware,
  getNetworkSecurityConfig,
  isLanBinding,
} from './src/security/networkSecurity.js';
import { createApiRateLimitMiddleware } from './src/security/apiRateLimit.js';
import { httpErrorLoggingMiddleware } from './src/logging/httpErrorMiddleware.js';
import { pruneStaleServerInstances } from './src/serverInstanceRegistry.js';

dotenv.config();

const SERVER_INSTANCE_DIRECTORY = resolve(process.cwd(), 'storage');
const RESTORE_POINT_DIRECTORY = resolve(SERVER_INSTANCE_DIRECTORY, 'restore-points');
const LEGACY_SERVER_INSTANCE_FILE = resolve(SERVER_INSTANCE_DIRECTORY, 'server-instance.json');

interface ServerInstanceState {
  pid: number;
  port: number;
  workspace: string;
  startedAt: string;
}

function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  return !isProcessRunning(pid);
}

async function replacePreviousServer(port: number): Promise<void> {
  const instanceFile = resolve(SERVER_INSTANCE_DIRECTORY, `server-instance-${port}.json`);

  let previous: ServerInstanceState | undefined;
  for (const candidate of [instanceFile, LEGACY_SERVER_INSTANCE_FILE]) {
    try {
      const state = JSON.parse(await readFile(candidate, 'utf8')) as ServerInstanceState;
      if (state.port === port) {
        previous = state;
        break;
      }
    } catch {
      // Missing or stale state is safe to skip.
    }
  }

  if (previous?.workspace === process.cwd() && previous.port === port && isProcessRunning(previous.pid)) {
    console.log(`Restarting server: stopping previous instance ${previous.pid} on port ${previous.port}...`);
    process.kill(previous.pid, 'SIGTERM');
    if (!await waitForProcessExit(previous.pid)) {
      process.kill(previous.pid, 'SIGKILL');
      await waitForProcessExit(previous.pid, 1000);
    }
  }

  await mkdir(SERVER_INSTANCE_DIRECTORY, { recursive: true });
  await writeFile(instanceFile, JSON.stringify({
    pid: process.pid,
    port,
    workspace: process.cwd(),
    startedAt: new Date().toISOString(),
  }, null, 2));

  // Remove the former single-instance record after migrating it to the
  // per-port registry. A server on another explicit port must remain tracked
  // independently.
  try {
    const legacy = JSON.parse(await readFile(LEGACY_SERVER_INSTANCE_FILE, 'utf8')) as ServerInstanceState;
    if (legacy.port === port) await unlink(LEGACY_SERVER_INSTANCE_FILE);
  } catch {
    // Missing or stale legacy state does not affect startup.
  }
}

async function clearServerInstance(port: number): Promise<void> {
  const instanceFile = resolve(SERVER_INSTANCE_DIRECTORY, `server-instance-${port}.json`);
  try {
    const current = JSON.parse(await readFile(instanceFile, 'utf8')) as ServerInstanceState;
    if (current.pid === process.pid) await unlink(instanceFile);
  } catch {
    // The instance file may already be absent or replaced by a newer server.
  }
}

async function getServerVersion(): Promise<string> {
  try {
    const packageJson = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8')) as { version?: unknown };
    return typeof packageJson.version === 'string' && packageJson.version.trim()
      ? packageJson.version.trim()
      : 'unknown';
  } catch {
    return process.env.npm_package_version || 'unknown';
  }
}

function getPort(): number {
  const portArgIndex = process.argv.indexOf('--port');
  const explicitPort =
    portArgIndex >= 0
      ? process.argv[portArgIndex + 1]
      : process.argv.find((arg) => arg.startsWith('--port='))?.split('=')[1];

  const rawPort = explicitPort || process.env.PORT || '3000';
  const port = Number.parseInt(rawPort, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port "${rawPort}". Use a number between 1 and 65535.`);
  }

  return port;
}

function listenOnPort(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen(port);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function listenWithPortFallback(server: Server, requestedPort: number, host: string): Promise<number> {
  try {
    return await listenOnPort(server, requestedPort, host);
  } catch (error: any) {
    if (error?.code !== 'EADDRINUSE') throw error;
    throw new Error(
      `Port ${requestedPort} is already used by an untracked process. Stop that process once, then rerun; future reruns replace the previous server automatically.`
    );
  }
}

async function purgeThreadHistory(
  runManager: ReturnType<typeof getServerRunManager>,
  threadId?: string,
) {
  const store = getSQLiteAppStore();
  const runIds = threadId
    ? store.listAgentRunIdsForThread(threadId)
    : store.listAllThreadAgentRunIds();
  const activeStatuses = new Set(['running', 'waiting_for_user', 'waiting_for_provider']);
  for (const runId of runIds) {
    const run = runManager.getRun(runId);
    if (run && activeStatuses.has(run.status)) {
      runManager.killRun(runId, threadId ? `Thread ${threadId} was deleted.` : 'All Coder threads were deleted.');
    }
  }
  await Promise.allSettled(runIds.map((runId) => runManager.waitForRun(runId)));
  // Let child-run finalization callbacks finish before their parent rows are
  // removed from the durable store.
  await Promise.resolve();
  const result = threadId
    ? store.deleteThreadHistory(threadId)
    : store.clearThreadHistory();
  store.vacuum();
  return result;
}

async function createServer() {
  const port = getPort();
  const serverVersion = await getServerVersion();
  const networkSecurity = getNetworkSecurityConfig();
  // Restore the last saved pacing values before any run can be created.
  const savedEngineSettings = getSQLiteAppStore().getSetting<Record<string, any>>('engine_settings');
  initializeRuntimeSettings(savedEngineSettings);
  if (savedEngineSettings?.pacingProfiles) {
    setExecutionProfilePresets(savedEngineSettings.pacingProfiles);
  }
  const legacyGroqWarning = getLegacyGroqConfigurationWarning();
  if (legacyGroqWarning) console.warn(`[Groq configuration] ${sanitizeError(legacyGroqWarning)}`);
  const legacyOpenRouterWarning = getLegacyOpenRouterConfigurationWarning();
  if (legacyOpenRouterWarning) console.warn(`[OpenRouter configuration] ${sanitizeError(legacyOpenRouterWarning)}`);
  const app = express();
  app.use(httpErrorLoggingMiddleware);
  const httpServer = createHttpServer(app);
  const healthStartedAt = Date.now();
  const runManager = getServerRunManager();
  runManager.recoverActiveRuns();
  app.use(createConfiguredCorsMiddleware(networkSecurity.corsOrigins));
  app.use('/api', createApiAccessMiddleware({
    apiToken: networkSecurity.apiToken,
    requireTokenForAllNonHealth: isLanBinding(networkSecurity.host),
  }));
  app.use(createApiRateLimitMiddleware());
  // This legacy file-preview endpoint is outside the /api namespace but reads
  // arbitrary workspace files, so it must share the API boundary as well.
  app.use('/workspace-file', createApiAccessMiddleware({
    apiToken: networkSecurity.apiToken,
    requireTokenForAllNonHealth: isLanBinding(networkSecurity.host),
  }));
  // Keep the parser bounded while allowing legacy image requests to finish.
  // Coder timeline events are archived under the project .react-engine folder
  // and are intentionally excluded from conversational request payloads.
  // New image intake is compressed in the browser and stays well below this
  // ceiling; the larger bound prevents older open tabs from failing while
  // still avoiding an unbounded JSON body allocation.
  app.use(express.json({ limit: '25mb' }));
  app.use('/api', createWorkspacePolicyMiddleware());
  app.use(createSettingsRouter({ ensureWorkspaceRoot }));
  app.use(createCoderRouter({ runManager, purgeThreadHistory: (threadId) => purgeThreadHistory(runManager, threadId) }));
  app.use(createWorkspaceRouter({
    restorePointDirectory: RESTORE_POINT_DIRECTORY,
  }));
  app.use(createSystemRouter({ ensureWorkspaceRoot, healthStartedAt }));
  app.use(createProvidersRouter({ ensureWorkspaceRoot }));
  app.use(createRunsRouter({ runManager, ensureWorkspaceRoot, getRepositoryCommitHash }));
  app.use(createWorkplansRouter());

  // LAN mode requires the API token for every non-health API request. Give the
  // bundled same-origin UI an HttpOnly cookie so its browser requests remain
  // authenticated without exposing the token to page JavaScript.
  if (isLanBinding(networkSecurity.host) && networkSecurity.apiToken) {
    const apiCookie = `server_api_token=${encodeURIComponent(networkSecurity.apiToken)}; HttpOnly; SameSite=Strict; Path=/`;
    app.use((req, res, next) => {
      if (req.path === '/api' || req.path.startsWith('/api/')) return next();
      res.append('Set-Cookie', apiCookie);
      return next();
    });
  }

  // Serve static UI in production, or use Vite dev server
  const isProduction = process.env.NODE_ENV === 'production' || process.argv.includes('--mcp');
  let viteDevServer: { close: () => Promise<void> } | undefined;

  app.get('/docs/core/RUNNING_AGENT_GUIDE.md', (_req, res, next) => {
    res.sendFile(resolve(process.cwd(), 'docs/core/RUNNING_AGENT_GUIDE.md'), next);
  });
  app.get('/docs/core/USER_GUIDE.md', (_req, res, next) => {
    res.sendFile(resolve(process.cwd(), 'docs/core/USER_GUIDE.md'), next);
  });

  if (!isProduction) {
    // In dev, use Vite middleware
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: {
            server: httpServer,
          },
        },
        appType: 'spa'
      });
      viteDevServer = vite;
      app.use(vite.middlewares);
    } catch (e) {
      console.error('Failed to start Vite middleware:', sanitizeError(e instanceof Error ? e.message : String(e)));
    }
  } else {
    // In production, serve the built UI files from dist/ui
    // `__dirname` is the project root in dev, but points at `dist/` after the
    // server bundle is built. Resolve from the process root so `npm start`
    // serves the same freshly-built UI in both cases.
    const uiDistDirectory = resolve(process.cwd(), 'dist/ui');
    app.use(express.static(uiDistDirectory));
    app.get('/{*splat}', (req, res) => {
      res.sendFile(join(uiDistDirectory, 'index.html'));
    });
  }

  // Keep oversized legacy/client requests readable instead of returning the
  // raw body-parser stack trace. The browser now compresses image attachments
  // before sending them, but this also gives older open tabs a useful response.
  app.use((error: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error?.type === 'entity.too.large' || Number(error?.status) === 413 || Number(error?.statusCode) === 413) {
      return res.status(413).json({
        error: 'Request is too large. Images are compressed before upload; remove an attachment or choose a smaller image and retry.',
      });
    }
    return next(error);
  });
  app.use((error: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(error);
    const requestedStatus = Number(error?.statusCode ?? error?.status);
    const status = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus < 600
      ? requestedStatus
      : 500;
    return res.status(status).json({
      error: sanitizeError(error?.message || String(error)),
    });
  });

  const prunedInstances = await pruneStaleServerInstances(SERVER_INSTANCE_DIRECTORY);
  if (prunedInstances > 0) console.info(`Removed ${prunedInstances} stale server instance record(s).`);
  await replacePreviousServer(port);
  const activePort = await listenWithPortFallback(httpServer, port, networkSecurity.host);
  try {
    getSQLiteAppStore().recordServerStart({
      pid: process.pid,
      port: activePort,
      startedAt: new Date(healthStartedAt).toISOString(),
      version: serverVersion,
    });
  } catch (error) {
    console.error(`Failed to record server startup: ${sanitizeError(error instanceof Error ? error.message : String(error))}`);
  }
  void migrateLegacyCoderThreads(runManager, getSQLiteAppStore())
    .then(({ threadsUpdated }) => {
      if (threadsUpdated > 0) console.info(`Migrated ${threadsUpdated} legacy coder thread(s).`);
    })
    .catch((error) => {
      console.error(`Failed to migrate legacy coder threads: ${sanitizeError(error instanceof Error ? error.message : String(error))}`);
    });
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    const forcedExit = setTimeout(() => process.exit(0), 3_000);
    forcedExit.unref();
    await clearServerInstance(activePort);

    try {
      await viteDevServer?.close();
    } catch (error) {
      console.error(`Failed to close Vite cleanly: ${sanitizeError(error instanceof Error ? error.message : String(error))}`);
    }

    await new Promise<void>((resolveClose) => {
      const fallback = setTimeout(resolveClose, 1_500);
      fallback.unref();
      httpServer.close(() => {
        clearTimeout(fallback);
        resolveClose();
      });
      httpServer.closeIdleConnections?.();
      httpServer.closeAllConnections?.();
    });

    clearTimeout(forcedExit);
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('exit', () => {
    void clearServerInstance(activePort);
  });
  const displayHost = networkSecurity.host === '0.0.0.0' || networkSecurity.host === '::'
    ? 'localhost'
    : networkSecurity.host;
  console.log(`Server ready at http://${displayHost}:${activePort} (PID ${process.pid}).`);
  console.log('Rerun the same command anytime to replace this instance cleanly.');
}

// Do not start full server if running as standalone MCP command
if (!process.argv.includes('mcp')) {
  createServer().catch(async (error) => {
    await clearServerInstance(getPort());
    console.error(`Server could not start: ${sanitizeError(error instanceof Error ? error.message : String(error))}`);
    process.exitCode = 1;
  });
}
