import { Router } from 'express';
import { sanitizeError } from './_shared.js';
import { getToolCatalog } from '../react/tool-router.js';
import { CAPABILITY_PACKS } from '../react/capability-scope.js';
import {
  getOpenRouterModelTarget,
  getSavedOpenRouterModelTargets,
} from '../config/openRouterTargets.js';
import {
  getAllModelCapabilityProfiles,
  getModelCapabilityProfile,
  getProviderModelCapabilityProfile,
} from '../config/modelCapabilities.js';
import { loadGroqRuntimeConfigSafe } from '../config/groqConfig.js';
import {
  getRuntimeOpenRouterBaseUrl,
  getRuntimeKimiBaseUrl,
  getRuntimeRequestyBaseUrl,
  getRuntimeCerebrasModel,
  getRuntimeCerebrasBaseUrl,
  getRuntimeSambaNovaBaseUrl,
} from '../config/runtimeEnv.js';
import {
  getConfiguredKimiModel,
  getConfiguredRequestyModel,
  getConfiguredSambaNovaModel,
} from '../config/providerRouteSettings.js';
import {
  getSavedPollinationsModelCatalog,
  isPollinationsTextChatModel,
} from '../config/pollinationsModels.js';
import { getLocalAIModelTargets } from '../config/localAITargets.js';
import { getColabModelTargets } from '../config/colabTargets.js';
import { getSavedGeminiModelTargets } from '../config/geminiTargets.js';
import { getSavedNvidiaModelTargets } from '../config/nvidiaTargets.js';
import { getSQLiteAppStore, type StoredServerStart } from '../persistence/sqliteStore.js';
import type { SQLiteAppStore } from '../persistence/sqliteStore.js';

export interface SystemRouterDependencies {
  ensureWorkspaceRoot: (workspace?: string) => Promise<string>;
  healthStartedAt: number;
  store?: SQLiteAppStore;
}

export function createRouter({ ensureWorkspaceRoot, healthStartedAt, store = getSQLiteAppStore() }: SystemRouterDependencies) {
  const router = Router();

  router.get('/api/health', (req, res) => {
    let serverStart: StoredServerStart | null = null;
    try {
      const port = req.socket.localPort;
      if (typeof port === 'number') serverStart = getSQLiteAppStore().getServerStart(process.pid, port);
    } catch {
      // Liveness should still be available when startup history cannot be read.
    }
    res.json({
      ok: true,
      status: 'ok',
      uptime: Math.max(0, Math.floor(process.uptime())),
      pid: process.pid,
      port: req.socket.localPort ?? null,
      startedAt: new Date(healthStartedAt).toISOString(),
      serverStart,
    });
  });

  router.get('/api/health/ready', (_req, res) => {
    try {
      store.checkHealth();
      return res.json({ ok: true, status: 'ready', checks: { sqlite: 'ok' } });
    } catch {
      return res.status(503).json({ ok: false, status: 'not_ready', checks: { sqlite: 'unavailable' } });
    }
  });

  router.get('/api/model-capabilities', (req, res) => {
    const selectedModel = typeof req.query.model === 'string' ? req.query.model.trim() : '';
    const selectedOpenRouterTarget = selectedModel.toLowerCase().startsWith('openrouter')
      ? getOpenRouterModelTarget(selectedModel)
      : undefined;
    const selected = selectedModel && selectedOpenRouterTarget
      ? getProviderModelCapabilityProfile(selectedModel, 'openrouter', {
        capabilities: {
          ...getProviderModelCapabilityProfile(selectedModel, 'openrouter').capabilities,
          ...(selectedOpenRouterTarget.supportsVision === undefined ? {} : {
            vision: selectedOpenRouterTarget.supportsVision ? 'yes' as const : 'no' as const,
          }),
        },
        ...(selectedOpenRouterTarget.inputModalities ? { inputModalities: selectedOpenRouterTarget.inputModalities } : {}),
        ...(selectedOpenRouterTarget.outputModalities ? { outputModalities: selectedOpenRouterTarget.outputModalities } : {}),
      })
      : selectedModel ? getModelCapabilityProfile(selectedModel) : undefined;
    res.json({
      profiles: getAllModelCapabilityProfiles(),
      selected,
      usage: {
        reasoning: 'The ReAct planner uses the selected thinking depth, current observations, and verification gates.',
        toolCalling: 'Routes advertising tool support receive native tools; other routes use the structured text action protocol.',
        architecture: 'MoE/Dense is selected internally by the model and cannot be toggled by the application.',
        vision: 'Vision is used only when the task/request includes supported visual input.',
        streaming: 'Streaming is used by the streaming run path when the selected provider supports it.',
      },
    });
  });

  router.get('/api/tools/catalog', (_req, res) => {
    res.json({
      catalog: getToolCatalog(),
      capabilityPacks: Object.values(CAPABILITY_PACKS),
    });
  });

  router.get('/api/model-properties', async (_req, res) => {
    try {
      const geminiTargets = getSavedGeminiModelTargets();
      const nvidiaTargets = getSavedNvidiaModelTargets();
      const groqConfig = loadGroqRuntimeConfigSafe();

      const routeProfile = (
        provider: Parameters<typeof getProviderModelCapabilityProfile>[1],
        modelId: string,
        overrides: Parameters<typeof getProviderModelCapabilityProfile>[2] = {},
      ) => getProviderModelCapabilityProfile(modelId, provider, overrides);

      const genericRoute = (
        provider: Parameters<typeof getProviderModelCapabilityProfile>[1],
        modelId: string,
        overrides: Parameters<typeof getProviderModelCapabilityProfile>[2] = {},
      ) => routeProfile(provider, modelId, {
        apiFamily: 'chat-completions',
        endpoint: '/chat/completions',
        source: 'configured-route',
        ...overrides,
      });

      const geminiRoutes = geminiTargets.map((target) => routeProfile('gemini', target.modelId, {
        label: target.title,
        routeId: target.id,
        credentialIndex: target.apiKeyIndex,
        baseApi: 'https://generativelanguage.googleapis.com/v1beta',
        configuredParams: {
          temperature: target.temperature,
          maxTokens: target.maxTokens,
          topP: target.topP,
        },
      }));

      const nvidiaRoutes = nvidiaTargets.map((target) => {
        const base = routeProfile('nvidia', target.modelId, {
          label: target.title,
          routeId: target.id,
          credentialIndex: target.apiKeyIndex,
          baseApi: 'https://integrate.api.nvidia.com/v1',
          configuredParams: {
            temperature: target.temperature,
            maxTokens: target.maxTokens,
            topP: target.topP,
            stream: target.stream,
          },
        });
        if (target.supportsTools === undefined) return base;
        return {
          ...base,
          capabilities: {
            ...base.capabilities,
            toolCalling: target.supportsTools ? 'yes' as const : 'no' as const,
          },
        };
      });

      const groqModel = groqConfig.defaultModel.trim();
      const groqModelCapabilities = groqModel ? groqConfig.capabilities[groqModel] : undefined;
      const groqRoutes = groqModel ? [genericRoute('groq', groqModel, {
        label: `Groq ${groqModel}`,
        routeId: 'default',
        baseApi: groqConfig.baseUrl,
        contextWindow: groqModelCapabilities?.contextTokenLimit,
        maxOutputTokens: groqModelCapabilities?.outputTokenLimit,
        capabilities: {
          ...getProviderModelCapabilityProfile(groqModel, 'groq').capabilities,
          ...(groqModelCapabilities ? {
            streaming: groqModelCapabilities.streaming ? 'yes' as const : 'no' as const,
            toolCalling: groqModelCapabilities.toolCalling ? 'yes' as const : 'no' as const,
            structuredOutput: groqModelCapabilities.structuredOutput ? 'yes' as const : 'no' as const,
            vision: groqModelCapabilities.vision ? 'yes' as const : 'no' as const,
          } : {}),
        },
      })] : [];

      const kimiModel = getConfiguredKimiModel().trim();
      const requestyModel = getConfiguredRequestyModel().trim();
      const cerebrasModel = getRuntimeCerebrasModel().trim();
      const sambaNovaModel = getConfiguredSambaNovaModel().trim();
      const openRouterTargets = getSavedOpenRouterModelTargets();
      const openRouterRoutes = openRouterTargets.map((target) => genericRoute('openrouter', target.modelId, {
        label: target.title,
        routeId: target.id,
        baseApi: getRuntimeOpenRouterBaseUrl(),
        contextWindow: target.contextLength,
        maxOutputTokens: target.maxTokens,
        configuredParams: {
          maxTokens: target.maxTokens,
        },
        capabilities: {
          ...getProviderModelCapabilityProfile(target.modelId, 'openrouter').capabilities,
          ...(target.supportsTools === undefined ? {} : {
            toolCalling: target.supportsTools ? 'yes' as const : 'no' as const,
            structuredOutput: target.supportsTools ? 'yes' as const : 'no' as const,
          }),
          ...(target.supportsVision === undefined ? {} : {
            vision: target.supportsVision ? 'yes' as const : 'no' as const,
          }),
        },
        ...(target.inputModalities ? { inputModalities: target.inputModalities } : {}),
        ...(target.outputModalities ? { outputModalities: target.outputModalities } : {}),
      }));
      const kimiRoutes = kimiModel ? [genericRoute('kimi', kimiModel, {
        label: `Kimi ${kimiModel}`,
        routeId: 'configured-route',
        baseApi: getRuntimeKimiBaseUrl(),
      })] : [];
      const requestyRoutes = requestyModel ? [genericRoute('requesty', requestyModel, {
        label: `Requesty ${requestyModel}`,
        routeId: 'configured-route',
        baseApi: getRuntimeRequestyBaseUrl(),
      })] : [];
      const cerebrasRoutes = cerebrasModel ? [genericRoute('cerebras', cerebrasModel, {
        label: `Cerebras ${cerebrasModel}`,
        routeId: 'configured-route',
        baseApi: getRuntimeCerebrasBaseUrl(),
      })] : [];
      const sambaNovaRoutes = sambaNovaModel ? [genericRoute('sambanova', sambaNovaModel, {
        label: `SambaNova ${sambaNovaModel}`,
        routeId: 'configured-route',
        baseApi: getRuntimeSambaNovaBaseUrl(),
      })] : [];

      const pollinationsCatalog = getSavedPollinationsModelCatalog();
      const pollinationsRoutes = pollinationsCatalog.models
        .filter(isPollinationsTextChatModel)
        .map((model) => genericRoute('pollinations', model.id, {
          label: `Pollinations · ${model.label}`,
          routeId: model.id,
          baseApi: 'https://gen.pollinations.ai',
          ...(model.contextLength !== undefined ? { contextWindow: model.contextLength } : {}),
          ...(model.maxOutputTokens !== undefined ? { maxOutputTokens: model.maxOutputTokens } : {}),
          ...(model.inputModalities.length > 0 ? { inputModalities: model.inputModalities } : {}),
          ...(model.outputModalities.length > 0 ? { outputModalities: model.outputModalities } : {}),
          capabilities: {
            ...getProviderModelCapabilityProfile(model.id, 'pollinations').capabilities,
            toolCalling: model.supportsTools ? 'yes' as const : 'no' as const,
            reasoning: model.supportsReasoning ? 'yes' as const : 'no' as const,
            vision: model.inputModalities.includes('image') ? 'yes' as const : 'no' as const,
          },
        }));

      const localRoutes = getLocalAIModelTargets().map((target) => genericRoute('local', target.modelId, {
        label: target.title,
        routeId: target.id,
        baseApi: target.baseUrl,
        contextWindow: target.contextWindow,
      }));
      const colabRoutes = getColabModelTargets().map((target) => genericRoute('colab', target.modelId, {
        label: target.title,
        routeId: target.id,
        baseApi: target.baseUrl,
      }));

      return res.json({
        generatedAt: new Date().toISOString(),
        apis: [
          {
            provider: 'gemini',
            label: 'Gemini API',
            baseApi: 'https://generativelanguage.googleapis.com/v1beta',
            routes: geminiRoutes,
            note: 'Context and native capabilities come from the Gemini model registry. Account/profile assignment is shown per target.',
          },
          {
            provider: 'nvidia',
            label: 'NVIDIA API',
            baseApi: 'https://integrate.api.nvidia.com/v1',
            routes: nvidiaRoutes,
            note: 'Context and API-family details come from the NVIDIA model registry. Key assignment is shown per target.',
          },
          {
            provider: 'openrouter',
            label: 'OpenRouter API',
            baseApi: getRuntimeOpenRouterBaseUrl(),
            routes: openRouterRoutes,
            note: 'OpenRouter route limits come from the selected model catalog entry when available; dynamic aliases can still have provider-dependent limits.',
          },
          {
            provider: 'groq',
            label: 'Groq API',
            baseApi: groqConfig.baseUrl,
            routes: groqRoutes,
            note: 'Groq context and output limits are shown when they are configured in the Groq capability map.',
          },
          {
            provider: 'kimi',
            label: 'Kimi API',
            baseApi: getRuntimeKimiBaseUrl(),
            routes: kimiRoutes,
            note: 'The Kimi route is OpenAI-compatible. Limits remain unknown unless the provider catalog or local configuration advertises them.',
          },
          {
            provider: 'requesty',
            label: 'Requesty API',
            baseApi: getRuntimeRequestyBaseUrl(),
            routes: requestyRoutes,
            note: 'Requesty may proxy different upstream models, so properties are unknown unless the selected model is present in a known registry.',
          },
          {
            provider: 'cerebras',
            label: 'Cerebras API',
            baseApi: getRuntimeCerebrasBaseUrl(),
            routes: cerebrasRoutes,
            note: 'Cerebras is a direct OpenAI-compatible route. Agent requests keep the selected model pinned and do not silently switch providers.',
          },
          {
            provider: 'sambanova',
            label: 'SambaNova API',
            baseApi: getRuntimeSambaNovaBaseUrl(),
            routes: sambaNovaRoutes,
            note: 'SambaNova Cloud is a direct OpenAI-compatible route with function-calling support on supported models; agent requests stay pinned.',
            plan: {
              free: { creditsUsd: 5, creditCardRequired: false, expiresInDays: 30 },
              developer: { billing: 'pay-as-you-go', rateLimits: 'standard' },
            },
          },
          {
            provider: 'local',
            label: 'Local AI API',
            routes: localRoutes,
            note: 'Local OpenAI-compatible servers do not have a shared context limit. Configure provider metadata at the server if you want exact limits here.',
          },
          {
            provider: 'colab',
            label: 'Colab model API',
            routes: colabRoutes,
            note: 'Colab tunnels are OpenAI-compatible and model-managed; limits are unknown unless the notebook advertises them.',
          },
          {
            provider: 'pollinations',
            label: 'Pollinations API',
            routes: pollinationsRoutes,
            note: pollinationsCatalog.syncedAt
              ? `Saved Pollinations registry loaded from SQLite (${pollinationsRoutes.length} text route(s)); sync it from Settings when you need fresh models.`
              : 'Pollinations models are loaded from the saved SQLite registry. Sync the registry from Settings to add model routes.',
          },
        ],
      });
    } catch (error: any) {
      return res.status(500).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  router.post('/api/apps/verify', async (req, res) => {
    try {
      const { appSpec, workspace, outputFiles = [] } = req.body;
      if (!appSpec?.entryPoint || !appSpec?.appName || !appSpec?.outputMode) {
        return res.status(400).json({ error: 'appSpec with appName, outputMode, and entryPoint is required' });
      }

      const workspaceRoot = await ensureWorkspaceRoot(workspace);
      const { createManifest } = await import('../react/app-manifest.js');
      const { verifyApp } = await import('@barok/adapter-node');
      const manifest = createManifest(
        appSpec.appName,
        appSpec.appType || 'tool',
        appSpec.outputMode,
        workspaceRoot,
        appSpec.entryPoint,
        Array.isArray(outputFiles) ? outputFiles : [],
        Array.isArray(appSpec.verificationChecks) ? appSpec.verificationChecks : []
      );

      const verificationResult = await verifyApp(manifest, { screenshot: false }, appSpec);
      res.json({ verificationResult });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.get('/api/mcp-status', async (_req, res) => {
    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);

      const isWin = process.platform === 'win32';
      let isRunning = false;
      if (isWin) {
        const script = [
          "$processes = Get-CimInstance Win32_Process | Where-Object {",
          "  $_.CommandLine -and",
          "  $_.CommandLine -match '(raw-react-mcp|cli\\.js)' -and",
          "  $_.CommandLine -match '(^|\\s)mcp(\\s|$)'",
          "};",
          "if ($processes) { 'true' } else { 'false' }",
        ].join(' ');
        const { stdout } = await execFileAsync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          { maxBuffer: 1024 * 1024, windowsHide: true }
        );
        isRunning = String(stdout).trim() === 'true';
      } else {
        const { stdout } = await execFileAsync('ps', ['-eo', 'args='], { maxBuffer: 4 * 1024 * 1024 });
        isRunning = String(stdout).split('\n').some((line) =>
          line.includes('mcp') && (line.includes('raw-react-mcp') || line.includes('cli.js'))
        );
      }

      res.json({ connected: isRunning });
    } catch (error: any) {
      res.json({ connected: false, error: sanitizeError(error?.message || String(error)) });
    }
  });

  return router;
}
