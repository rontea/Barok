import { Router } from 'express';
import { sanitizeError, isProviderSettingsMutationAuthorized } from './_shared.js';
import {
  DEFAULT_RUN_EVENT_PAGE_SIZE,
  ServerRunManager,
  type ServerRunKind,
} from '../react/run-manager.js';
import type { ChildRunModelTarget } from '../agents/child-runs.js';
import {
  isColabTargetValue,
  resolveColabModelTarget,
} from '../config/colabTargets.js';
import {
  isLocalAITargetValue,
  resolveLocalAIModelTarget,
} from '../config/localAITargets.js';
import {
  isGeminiTargetModelValue,
  resolveGeminiModelTarget,
  getGeminiModelTargetResolutionIssue,
} from '../config/geminiTargets.js';
import {
  isNvidiaTargetModelValue,
  parseNvidiaRuntimeKeys,
  resolveNvidiaModelTarget,
} from '../config/nvidiaTargets.js';
import { isNvidiaModel } from '../config/nvidiaModels.js';
import { isGeminiModel } from '../validation/stringValidators.js';
import { loadGroqRuntimeConfigSafe } from '../config/groqConfig.js';
import { getOpenRouterModelTarget } from '../config/openRouterTargets.js';
import { resolveModelContextWindow } from '../config/modelConfig.js';
import { getProviderModelCapabilityProfile } from '../config/modelCapabilities.js';
import { normalizeCoderModelSelection } from '../config/providerSelection.js';
import { getConfiguredCoderModelSelection } from '../config/coderModel.js';
import { getDelegationSettingsSnapshot } from '../config/delegationRouting.js';
import {
  getGeminiProfileRegistry,
  selectGeminiProfileId,
} from '../config/geminiProfiles.js';
import {
  CONTINUOUS_RUN_STEP_WINDOW,
  CONTINUOUS_RUN_COST_LIMIT,
} from '../react/continuous-run.js';
import {
  isContinuationHandoff,
  isContinuationReason,
  createContinuationHandoff,
} from '../react/continuation.js';
import { prepareReactResumeState, prepareReactWorkspaceRebaseState } from '../react/checkpoint.js';
import { ReActEngine } from '../react/engine.js';
import { EngineSubtaskDispatcher } from '@barok/engine';
import { createRuntimeTaskRouting } from '../tasks/runtimeTaskRouting.js';
import { resolveToolCapableModel } from '../react/model-router.js';
import { getGeminiSameProviderFallbackModelIds } from '../config/geminiModels.js';
import { getRuntimeEnvValue } from '../config/runtimeEnv.js';
import { getSQLiteAppStore } from '../persistence/sqliteStore.js';
import { di } from '../di/container.js';
import { getProviderRateLimitStatuses, type ProviderRateLimitStatus } from '../di/providers/rateLimitMonitor.js';
import { classifyCoderIntent, createCoderRespondResponse } from '../coder/intent.js';
import {
  enableFileMutationGuard,
  setDirectToolPolicy,
} from '../tools/devTools.js';
import {
  analyzeCoderTask,
  applyCoderTaskWorkspaceGuard,
  extractMentionedFiles,
  responseModeForAnalysis,
  type CoderTaskAnalysis,
} from '../coder/taskAnalysis.js';
import { toCoderTaskAnalysisView } from '@barok/core';
import { buildProjectFileMap } from '../coder/projectFileMap.js';

export interface RunsRouterDependencies {
  runManager: ServerRunManager;
  ensureWorkspaceRoot: (workspace?: string) => Promise<string>;
  getRepositoryCommitHash: (workspaceRoot: string) => Promise<string>;
}

const MAX_RUN_EVENT_PAGE_SIZE = 500;
const DEFAULT_EVIDENCE_PAGE_SIZE = 100;
const MAX_EVIDENCE_PAGE_SIZE = 250;

function preflightRouteUnavailable(status: ProviderRateLimitStatus | undefined, now: number): boolean {
  if (!status) return false;
  if (status.status === 'billing_required') return true;
  if (status.status === 'quota_exhausted' && !status.pausedUntil) return true;
  return Boolean(status.pausedUntil && Date.parse(status.pausedUntil) > now);
}

function findPreflightRouteStatus(target: { provider: string; resolvedModel: string; credentialIndex?: number }): ProviderRateLimitStatus | undefined {
  const routes = getProviderRateLimitStatuses().filter((route) =>
    route.provider.toLowerCase() === target.provider.toLowerCase() &&
    route.model.toLowerCase() === target.resolvedModel.toLowerCase(),
  );
  if (target.credentialIndex !== undefined) {
    return routes.find((route) => route.credentialIndex === target.credentialIndex);
  }
  return routes.length === 1 ? routes[0] : undefined;
}

function hasKnownOrPossibleFallback(
  target: { provider: string; resolvedModel: string; credentialIndex?: number; profileId?: string },
  selectedStatus: ProviderRateLimitStatus,
  now: number,
  runMetadata: Record<string, unknown>,
): boolean {
  const routeStatuses = getProviderRateLimitStatuses();
  const sameModelRoutes = routeStatuses.filter((route) =>
    route.provider.toLowerCase() === target.provider.toLowerCase() &&
    route.model.toLowerCase() === target.resolvedModel.toLowerCase() &&
    route.credentialIndex !== selectedStatus.credentialIndex,
  );
  if (sameModelRoutes.some((route) => !preflightRouteUnavailable(route, now))) return true;

  if (target.provider === 'gemini') {
    const alternatives = getGeminiSameProviderFallbackModelIds(target.resolvedModel);
    if (alternatives.length > 0) return true;
    if (getGeminiProfileRegistry().list().filter((profile) => profile.enabled).length > 1) return true;
  }
  if (target.provider === 'nvidia') {
    const keys = parseNvidiaRuntimeKeys();
    if (keys.some((_, credentialIndex) => {
      if (credentialIndex === target.credentialIndex) return false;
      const route = routeStatuses.find((candidate) =>
        candidate.provider.toLowerCase() === 'nvidia' &&
        candidate.model.toLowerCase() === target.resolvedModel.toLowerCase() &&
        candidate.credentialIndex === credentialIndex,
      );
      // A route absent from the cache is unknown, not unhealthy.
      return !route || !preflightRouteUnavailable(route, now);
    })) return true;
  }
  if (runMetadata.allowCrossProviderFallback === true && runMetadata.fallbackApprovalGranted === true &&
      Array.isArray(runMetadata.approvedFallbackProviders) && runMetadata.approvedFallbackProviders.some((value) => typeof value === 'string')) {
    return true;
  }
  return false;
}

function assertPreflightProviderAvailability(
  target: { requestedTarget: string; provider: string; resolvedModel: string; profileId?: string; credentialIndex?: number },
  runMetadata: Record<string, unknown>,
): void {
  const now = Date.now();
  const routeStatus = findPreflightRouteStatus(target);
  if (!routeStatus || !preflightRouteUnavailable(routeStatus, now)) return;

  const route = {
    provider: target.provider,
    model: target.resolvedModel,
    ...(target.profileId ? { profileId: target.profileId } : {}),
    ...(target.credentialIndex !== undefined ? { credentialIndex: target.credentialIndex } : {}),
  };
  if (hasKnownOrPossibleFallback(target, routeStatus, now, runMetadata)) {
    runMetadata.providerPreflight = {
      checkedAt: now,
      source: 'cached_route_state',
      status: 'primary_unavailable_fallbacks_possible',
      route,
      pausedUntil: routeStatus.pausedUntil,
      note: 'The selected route is in a cached cooldown. The run keeps the selected model and may use configured authorized recovery routes; their live health is not guaranteed.',
    };
    return;
  }

  const error = new Error(`Selected provider route ${target.provider}/${target.resolvedModel} is unavailable in cached route health and has no known usable same-provider target.`) as Error & {
    statusCode?: number;
    preflight?: Record<string, unknown>;
  };
  error.statusCode = 424;
  error.preflight = {
    code: 'PROVIDER_ROUTE_UNAVAILABLE',
    checkedAt: now,
    source: 'cached_route_state',
    route,
    status: routeStatus.status,
    ...(routeStatus.pauseReason ? { reason: routeStatus.pauseReason } : {}),
    ...(routeStatus.pausedUntil ? { pausedUntil: routeStatus.pausedUntil } : {}),
    ...(routeStatus.retryAfterMs !== undefined ? { retryAfterMs: routeStatus.retryAfterMs } : {}),
    message: 'No live provider probe was performed. Wait for the cached cooldown to clear or choose an available same-provider model/account.',
  };
  throw error;
}

function parseRunCursor(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseRunPageSize(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function taskAnalysisViewFromMetadata(metadata: unknown) {
  const record = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : undefined;
  return toCoderTaskAnalysisView(record?.taskAnalysis);
}

function eventPageCursor(page: { afterSeq: number; nextSeq: number; lastSeq: number; hasMore: boolean }) {
  return {
    afterSeq: page.afterSeq,
    nextSeq: page.nextSeq,
    lastSeq: page.lastSeq,
    hasMore: page.hasMore,
  };
}



export function createRouter({
  runManager,
  ensureWorkspaceRoot,
  getRepositoryCommitHash,
}: RunsRouterDependencies) {
  const router = Router();

  async function buildCoderProjectFileMap(workspace: string, message: string) {
    return buildProjectFileMap(workspace, extractMentionedFiles(message));
  }

  function resolveConfiguredModelTarget(model: string, requestedGeminiProfileId?: string) {
    if (isColabTargetValue(model)) {
      const target = resolveColabModelTarget(model);
      if (!target) throw new Error(`Colab model target "${sanitizeError(model)}" is missing or disabled.`);
      return {
        requestedTarget: model,
        provider: 'colab',
        resolvedModel: target.modelId,
        targetId: target.id,
        route: 'primary' as const,
      };
    }
    if (isLocalAITargetValue(model)) {
      const target = resolveLocalAIModelTarget(model);
      if (!target) throw new Error(`Local AI target "${sanitizeError(model)}" is missing or disabled.`);
      return {
        requestedTarget: model,
        provider: 'local',
        resolvedModel: target.modelId,
        targetId: target.id,
        ...(target.contextWindow ? { contextWindow: target.contextWindow } : {}),
        route: 'primary' as const,
      };
    }
    if (isGeminiTargetModelValue(model)) {
      // Diagnose before reading the migrated target list: loading it may remove
      // a stale entry, but the user still deserves the original reason.
      const resolutionIssue = getGeminiModelTargetResolutionIssue(model);
      const target = resolveGeminiModelTarget(model);
      if (!target) {
        const issue = resolutionIssue;
        const reason = issue === 'missing_profile'
          ? 'its Gemini account profile is missing or disabled'
          : issue === 'invalid_key_slot'
            ? 'its legacy API-key slot is no longer configured'
            : issue === 'retired_model'
              ? 'its model has been retired'
              : issue === 'unsupported_model'
                ? 'its model is no longer supported'
                : 'it is not configured';
        throw new Error(`Gemini model target "${sanitizeError(model)}" cannot be used because ${reason}.`);
      }
      return {
        requestedTarget: model,
        provider: 'gemini',
        resolvedModel: target.modelId,
        profileId: target.profileId || requestedGeminiProfileId,
        targetId: target.id,
        route: 'primary' as const,
      };
    }
    if (isNvidiaTargetModelValue(model)) {
      const target = resolveNvidiaModelTarget(model);
      if (!target) throw new Error(`NVIDIA model target "${sanitizeError(model)}" is not configured.`);
      return {
        requestedTarget: model,
        provider: 'nvidia',
        resolvedModel: target.modelId,
        credentialIndex: target.apiKeyIndex,
        targetId: target.id,
        route: 'primary' as const,
      };
    }
    return {
      requestedTarget: model,
      provider: isGeminiModel(model) ? 'gemini'
        : isNvidiaModel(model) ? 'nvidia'
          : model.toLowerCase().startsWith('openrouter:') || model.toLowerCase().startsWith('openrouter/') ? 'openrouter'
            : model.toLowerCase().startsWith('groq:') ? 'groq'
              : model.toLowerCase().startsWith('cerebras:') ? 'cerebras'
                : model.toLowerCase().startsWith('sambanova:') ? 'sambanova'
                  : model.toLowerCase().startsWith('kimi:') ? 'kimi'
                    : model.toLowerCase().startsWith('requesty:') ? 'requesty'
                      : model.toLowerCase().startsWith('pollinations:') ? 'pollinations'
                      : 'direct',
      resolvedModel: model,
      profileId: requestedGeminiProfileId,
      route: 'primary' as const,
    };
  }

  function resolveConfiguredTargetContextWindow(target: { provider: string; resolvedModel: string; contextWindow?: number }): number | undefined {
    if (Number.isFinite(target.contextWindow) && (target.contextWindow || 0) > 0) return target.contextWindow;
    if (target.provider === 'groq') {
      const groqContextWindow = loadGroqRuntimeConfigSafe().capabilities[target.resolvedModel]?.contextTokenLimit;
      if (Number.isFinite(groqContextWindow) && (groqContextWindow || 0) > 0) return groqContextWindow;
    }

    if (target.provider === 'openrouter') {
      const openRouterTarget = getOpenRouterModelTarget(target.resolvedModel);
      if (openRouterTarget?.contextLength) return openRouterTarget.contextLength;
    }

    const resolved = resolveModelContextWindow(target.resolvedModel);
    if (resolved) return resolved;

    const profile = getProviderModelCapabilityProfile(
      target.resolvedModel,
      target.provider as Parameters<typeof getProviderModelCapabilityProfile>[1],
    );
    return profile.contextWindow;
  }

  function startReactRunFromBody(
    body: any,
    kind: ServerRunKind = 'react',
    internalPin?: { modelTarget?: ChildRunModelTarget; contextWindow?: number },
    preflightOptions: { skipPreflight?: boolean } = {},
  ) {
    const {
      id,
      task, maxSteps, model, llmRequestTimeoutMs, plannerRequestTimeoutMs,
      executionStepWindow,
      continuousRun,
      pacingProfile, llmRequestIntervalMs, budget, workspace, thinkingDepth, threadId, attemptIndex,
      metadata, resumeState, geminiProfileId, allowCrossProviderFallback,
      capabilityPack, maxToolCalls,
      globalStepLimit, wallClockBudgetMs, maxRecoveryTransitions,
      requestBudgetEnabled,
      replayGuardEnabled,
      approvedFallbackProviders, fallbackApprovalGranted, allowedExternalProviders,
      privateWorkspace, sendPrivateSourceCode, maxProviderCooldownRetries,
      waitForProviderAvailability, enableSubtaskDispatch,
    } = body;
    if (!task || typeof task !== 'string') {
      throw new Error('Task is required');
    }

    const normalizedThreadId = typeof threadId === 'string' && threadId.trim() ? threadId.trim() : undefined;
    const requestedModel = internalPin?.modelTarget?.requestedTarget || (typeof model === 'string' && model.trim()
      ? normalizeCoderModelSelection(model)
      : getConfiguredCoderModelSelection());
    // The run's user-selected model is always the master agent. Delegation
    // settings configure workers only; they must never replace this target.
    const selectedModel = requestedModel;
    if (kind === 'coder' && normalizedThreadId) {
      const activeRun = runManager.listRuns({ kind: 'coder' }).find((run) =>
        run.threadId === normalizedThreadId && (run.status === 'running' || run.status === 'waiting_for_user' || run.status === 'waiting_for_provider')
      );
      if (activeRun) {
        const queued = runManager.queueUserMessage(activeRun.id, { message: task, source: 'active_run_request' });
        if (queued.ok) return { ...queued.run, queued: true, queuedMessage: queued.message };
        const conflict = new Error(`Coder thread already has an active run: ${activeRun.id}`) as Error & {
          statusCode?: number;
          activeRunId?: string;
        };
        conflict.statusCode = queued.reason === 'invalid_message' ? 400 : 409;
        conflict.activeRunId = activeRun.id;
        throw conflict;
      }
    }

    const requestedMetadata = metadata && typeof metadata === 'object'
      ? metadata as Record<string, unknown>
      : {};
    const selectedPacingProfile = pacingProfile === 'conservative' || pacingProfile === 'phased' || pacingProfile === 'fast' || pacingProfile === 'automatic'
      ? pacingProfile
      : requestedMetadata.pacingProfile === 'conservative' || requestedMetadata.pacingProfile === 'phased' || requestedMetadata.pacingProfile === 'fast' || requestedMetadata.pacingProfile === 'automatic'
        ? requestedMetadata.pacingProfile
        : 'automatic';
    const runMetadata: Record<string, unknown> = {
      ...requestedMetadata,
      pacingProfile: selectedPacingProfile,
    };
    runMetadata.enableSubtaskDispatch = enableSubtaskDispatch === true || requestedMetadata.enableSubtaskDispatch === true;
    const continuationDelegationSnapshot = (Boolean(resumeState) || typeof requestedMetadata.parentRunId === 'string') && requestedMetadata.delegationSettingsSnapshot
      ? requestedMetadata.delegationSettingsSnapshot
      : undefined;
    runMetadata.delegationSettingsSnapshot = continuationDelegationSnapshot || getDelegationSettingsSnapshot();
    const requestedAttemptIndex = Number(attemptIndex ?? runMetadata.attemptIndex);
    runMetadata.attemptIndex = Number.isFinite(requestedAttemptIndex) && requestedAttemptIndex > 0
      ? Math.max(1, Math.floor(requestedAttemptIndex))
      : 1;
    // A recovery target is control-plane state on a stopped parent run. It
    // must never be accepted from arbitrary start metadata because that would
    // let a caller silently replace the selected model without the explicit
    // /resume confirmation boundary.
    delete runMetadata.recoveryModel;
    if (typeof capabilityPack === 'string' && capabilityPack.trim()) runMetadata.capabilityPack = capabilityPack.trim();
    if (Number.isFinite(maxToolCalls)) runMetadata.maxToolCalls = Math.max(1, Math.floor(Number(maxToolCalls)));
    if (Number.isFinite(maxProviderCooldownRetries)) {
      runMetadata.maxProviderCooldownRetries = Math.max(0, Math.min(10, Math.floor(Number(maxProviderCooldownRetries))));
    }
    if (Number.isFinite(globalStepLimit)) runMetadata.globalStepLimit = Math.max(1, Math.floor(Number(globalStepLimit)));
    if (Number.isFinite(wallClockBudgetMs)) runMetadata.wallClockBudgetMs = Math.max(1_000, Math.floor(Number(wallClockBudgetMs)));
    if (Number.isFinite(maxRecoveryTransitions)) runMetadata.maxRecoveryTransitions = Math.max(1, Math.floor(Number(maxRecoveryTransitions)));
    // Fast controls request pacing only. It must not disable checkpoint-safe
    // recovery when the selected provider is temporarily throttled.
    const effectiveWaitForProviderAvailability = waitForProviderAvailability;
    if (typeof effectiveWaitForProviderAvailability === 'boolean') {
      runMetadata.waitForProviderAvailability = effectiveWaitForProviderAvailability;
    }
    delete runMetadata.agentDirective;
    if (typeof allowCrossProviderFallback === 'boolean') {
      runMetadata.allowCrossProviderFallback = allowCrossProviderFallback;
    }
    if (Array.isArray(approvedFallbackProviders)) {
      runMetadata.approvedFallbackProviders = approvedFallbackProviders.filter(
        (value): value is string => typeof value === 'string',
      );
    }
    if (typeof fallbackApprovalGranted === 'boolean') {
      runMetadata.fallbackApprovalGranted = fallbackApprovalGranted;
    }
    if (Array.isArray(allowedExternalProviders)) {
      runMetadata.allowedExternalProviders = allowedExternalProviders.filter(
        (value): value is string => typeof value === 'string',
      );
    }
    if (typeof privateWorkspace === 'boolean') runMetadata.privateWorkspace = privateWorkspace;
    if (typeof sendPrivateSourceCode === 'boolean') {
      runMetadata.sendPrivateSourceCode = sendPrivateSourceCode;
    }
    if (typeof requestBudgetEnabled === 'boolean') {
      runMetadata.requestBudgetEnabled = requestBudgetEnabled;
      if (requestBudgetEnabled && !Number.isFinite(Number(runMetadata.maximumRequestsPerTask))) {
        runMetadata.maximumRequestsPerTask = 10;
      }
      if (!requestBudgetEnabled) delete runMetadata.maximumRequestsPerTask;
    }
    if (typeof replayGuardEnabled === 'boolean') {
      runMetadata.replayGuardEnabled = replayGuardEnabled;
    }
    // A terminal run with a successful mutation is a durable checkpoint, not
    // an invitation to start a second writer. Re-submitting the same visible
    // Coder request in the same thread therefore returns the saved run so the
    // client can cross the explicit /resume boundary. `resumeState` and
    // `parentRunId` are the server-owned continuation path and must bypass the
    // guard; otherwise resuming would collide with its own parent.
    const displayTask = typeof runMetadata.displayTask === 'string' ? runMetadata.displayTask.trim() : '';
    const taskAnalysis = runMetadata.taskAnalysis && typeof runMetadata.taskAnalysis === 'object'
      ? runMetadata.taskAnalysis as Record<string, unknown>
      : undefined;
    const explicitlyRequestsNewInstance = taskAnalysis?.instanceMode === 'new_instance' ||
      /\b(start over|new instance|fresh instance|new task)\b/i.test(displayTask);
    const isContinuationLaunch = Boolean(resumeState) || typeof runMetadata.parentRunId === 'string';
    if (kind === 'coder' && normalizedThreadId && displayTask && !explicitlyRequestsNewInstance && !isContinuationLaunch) {
      const equivalentRun = runManager.findEquivalentCoderRun({
        threadId: normalizedThreadId,
        workspace: typeof workspace === 'string' ? workspace : undefined,
        displayTask,
      });
      if (equivalentRun) {
        const equivalentMetadata = equivalentRun.metadata && typeof equivalentRun.metadata === 'object'
          ? equivalentRun.metadata as Record<string, unknown>
          : {};
        const conflict = new Error(
          `This Coder request already produced workspace changes in saved run ${equivalentRun.id}. Resuming that checkpoint instead of starting a new task.`,
        ) as Error & {
          statusCode?: number;
          resumableRunId?: string;
          resumableModel?: string;
          resumableThreadId?: string;
          resumableGeminiProfileId?: string;
        };
        conflict.statusCode = 409;
        conflict.resumableRunId = equivalentRun.id;
        conflict.resumableModel = equivalentRun.model;
        conflict.resumableThreadId = equivalentRun.threadId;
        conflict.resumableGeminiProfileId = typeof equivalentMetadata.providerProfile === 'string'
          ? equivalentMetadata.providerProfile
          : undefined;
        throw conflict;
      }
    }
    const geminiRegistry = getGeminiProfileRegistry();
    const usesGeminiProfile = internalPin?.modelTarget?.provider === 'gemini' || isGeminiTargetModelValue(selectedModel) || isGeminiModel(selectedModel);
    const requestedProfileId = usesGeminiProfile
      ? internalPin?.modelTarget?.profileId || (typeof geminiProfileId === 'string' && geminiProfileId.trim()
        ? geminiProfileId.trim()
        : typeof requestedMetadata.providerProfile === 'string'
          ? requestedMetadata.providerProfile
          : undefined)
      : undefined;
    if (requestedProfileId && !geminiRegistry.has(requestedProfileId)) {
      throw new Error(`Gemini profile "${sanitizeError(requestedProfileId)}" is not configured or enabled.`);
    }
    const selectedGeminiProfileId = usesGeminiProfile
      ? selectGeminiProfileId({
          workspace: typeof workspace === 'string' ? workspace : undefined,
          userId: typeof requestedMetadata.userId === 'string' ? requestedMetadata.userId : undefined,
          taskProfileId: requestedProfileId,
        }, geminiRegistry)
      : undefined;
    if (selectedGeminiProfileId) runMetadata.providerProfile = selectedGeminiProfileId;
    const selectedTarget = internalPin?.modelTarget
      ? { ...internalPin.modelTarget, route: 'primary' as const }
      : resolveConfiguredModelTarget(selectedModel, selectedGeminiProfileId);
    const offlineTarget = selectedTarget.provider === 'local' || selectedTarget.provider === 'colab';
    const continuousExecution = continuousRun === true
      || requestedMetadata.continuousRun === true
      || (continuousRun === undefined && !requestedMetadata.continuousRun && offlineTarget && getRuntimeEnvValue('REACT_ENGINE_CONTINUOUS_RUN', 'true').toLowerCase() !== 'false');
    runMetadata.continuousRun = continuousExecution;
    if (continuousExecution) {
      // Offline runs have no provider quota to protect. Their only normal
      // terminal states should be completion, explicit cancellation, approval,
      // or an unavailable model server that is being retried from checkpoint.
      runMetadata.requestBudgetEnabled = false;
      runMetadata.waitForProviderAvailability = true;
    }
    const selectedContextWindow = internalPin?.contextWindow && internalPin.contextWindow > 0
      ? internalPin.contextWindow
      : resolveConfiguredTargetContextWindow(selectedTarget);
    runMetadata.requestedModel = selectedModel;
    runMetadata.resolvedModel = selectedTarget.resolvedModel;
    runMetadata.modelTarget = selectedTarget;
    if (selectedContextWindow) runMetadata.modelContextWindow = selectedContextWindow;
    if (!preflightOptions.skipPreflight) assertPreflightProviderAvailability(selectedTarget, runMetadata);

    return runManager.startRun(
      {
        id: typeof id === 'string' && id.trim() ? id.trim() : undefined,
        kind,
        task,
        threadId: normalizedThreadId,
        workspace: typeof workspace === 'string' ? workspace : undefined,
        model: selectedModel,
        maxSteps: continuousExecution
          ? CONTINUOUS_RUN_STEP_WINDOW
          : Number.isFinite(Number(maxSteps)) ? Number(maxSteps) : undefined,
        executionStepWindow: continuousExecution
          ? CONTINUOUS_RUN_STEP_WINDOW
          : Number.isFinite(Number(executionStepWindow)) ? Number(executionStepWindow) : undefined,
        globalStepLimit: Number.isFinite(Number(runMetadata.globalStepLimit)) ? Number(runMetadata.globalStepLimit) : undefined,
        wallClockBudgetMs: Number.isFinite(Number(runMetadata.wallClockBudgetMs)) ? Number(runMetadata.wallClockBudgetMs) : undefined,
        maxRecoveryTransitions: Number.isFinite(Number(runMetadata.maxRecoveryTransitions)) ? Number(runMetadata.maxRecoveryTransitions) : undefined,
        metadata: runMetadata,
        maxProviderCooldownRetries: typeof runMetadata.maxProviderCooldownRetries === 'number'
          ? runMetadata.maxProviderCooldownRetries
          : undefined,
        waitForProviderAvailability: continuousExecution
          ? true
          : typeof runMetadata.waitForProviderAvailability === 'boolean'
          ? runMetadata.waitForProviderAvailability
          : undefined,
      },
      async ({ runId, signal, emit, checkpoint, providerRetryAttempt, continuationAttempt, continuationStepBudget, globalStepLimit, runStartedAt, wallClockBudgetMs, maxRecoveryTransitions, requestUserInput }) => {
        const emitModelTargetResolved = (event: {
          requestedTarget: string; provider: string; resolvedModel: string; profileId?: string;
          credentialIndex?: number; targetId?: string; contextWindow?: number; route: 'primary' | 'recovery' | 'fallback'; reason?: string;
        }) => {
          const contextWindow = event.contextWindow || resolveConfiguredTargetContextWindow(event);
          const resolvedEvent = contextWindow && contextWindow > 0
            ? { ...event, contextWindow }
            : event;
          runManager.recordModelTargetTransition(runId, resolvedEvent);
          emit('model_target_resolved', resolvedEvent);
        };
        const persistedMetadata = runManager.getRun(runId)?.metadata;
        const activeFallbackPolicy = persistedMetadata && typeof persistedMetadata === 'object'
          ? persistedMetadata as Record<string, unknown>
          : runMetadata;
        // The request model is authoritative for a newly created run. A
        // staged recoveryModel is consumed only by the /resume route, which
        // validates and confirms the replacement before passing it here.
        let activeModel = selectedModel;
        const workspaceRoot = await ensureWorkspaceRoot(workspace);
        const requestedApprovalPolicy = runMetadata.approvalPolicy === 'full_access'
          ? 'full_access'
          : runMetadata.approvalPolicy === 'auto_approve'
            ? 'auto_approve'
            : runMetadata.approvalPolicy === 'read_only' ? 'read_only' : 'ask';
        const displayTask = typeof runMetadata.displayTask === 'string'
          ? runMetadata.displayTask
          : task;
        let taskAnalysis: CoderTaskAnalysis | undefined = runMetadata.taskAnalysis && typeof runMetadata.taskAnalysis === 'object'
          ? runMetadata.taskAnalysis as CoderTaskAnalysis
          : undefined;
        const needsGeneratedTaskAnalysis = (kind === 'coder' || kind === 'react') && (!taskAnalysis || typeof taskAnalysis !== 'object');
        // Start the workspace scan while repository metadata is being loaded.
        // The run ID is already returned by startRun; this overlaps preparation
        // without letting incomplete analysis reach the engine's safety policy.
        const projectFileMapPromise = needsGeneratedTaskAnalysis
          ? buildCoderProjectFileMap(workspaceRoot, displayTask).catch(() => undefined)
          : undefined;
        const repositoryCommitHash = await getRepositoryCommitHash(workspaceRoot);
        // Legacy React runs can modify the workspace just like Coder runs.
        // Give both paths the same task contract so a final-answer claim
        // cannot substitute for a successful file mutation and verification.
        if (needsGeneratedTaskAnalysis) {
          const projectFileMap = await projectFileMapPromise;
          taskAnalysis = analyzeCoderTask({
            message: displayTask,
            mode: 'agent',
            workspace: workspaceRoot,
            projectFileMap,
            approvalPolicy: requestedApprovalPolicy === 'auto_approve' || requestedApprovalPolicy === 'full_access'
              ? requestedApprovalPolicy
              : 'ask',
          });
          runMetadata.taskAnalysis = taskAnalysis;
        }
        taskAnalysis = applyCoderTaskWorkspaceGuard(taskAnalysis, workspaceRoot);
        if (taskAnalysis) {
          runMetadata.taskAnalysis = taskAnalysis;
          runManager.updateRunMetadata(runId, { taskAnalysis });
          const taskAnalysisView = toCoderTaskAnalysisView(taskAnalysis);
          if (taskAnalysisView) emit('task_analysis_ready', { type: 'task_analysis_ready', taskAnalysis: taskAnalysisView });
        }
        const analysisRecord = taskAnalysis && typeof taskAnalysis === 'object'
          ? taskAnalysis as { affectedFiles?: unknown }
          : undefined;
        const routingFiles = Array.isArray(analysisRecord?.affectedFiles)
          ? analysisRecord.affectedFiles
              .map((file) => {
                if (!file || typeof file !== 'object') return '';
                const path = (file as { path?: unknown }).path;
                return typeof path === 'string' ? path : '';
              })
              .filter((file): file is string => Boolean(file))
          : [];
        const taskRouting = createRuntimeTaskRouting(displayTask, routingFiles);
        runMetadata.taskRouting = taskRouting;
        const requiresMutation = taskAnalysis?.expectedChangeIntent !== 'read_only';
        const modelResolution = requiresMutation && !internalPin?.modelTarget
          ? resolveToolCapableModel(displayTask, activeModel, routingFiles)
          : undefined;
        let modelCapabilityEscalation: Record<string, unknown> | undefined;
        if (modelResolution?.changed) {
          activeModel = modelResolution.model;
          modelCapabilityEscalation = {
            requestedModel: modelResolution.requestedModel,
            selectedModel: modelResolution.model,
            reason: modelResolution.reason,
          };
          runMetadata.modelCapabilityEscalation = modelCapabilityEscalation;
        }
        runManager.updateRunMetadata(runId, {
          taskAnalysis,
          taskRouting,
          ...(modelCapabilityEscalation ? { modelCapabilityEscalation } : {}),
        });
        const activeTarget = internalPin?.modelTarget
          ? { ...internalPin.modelTarget, route: 'primary' as const }
          : resolveConfiguredModelTarget(activeModel, selectedGeminiProfileId);
        const activeContextWindow = internalPin?.contextWindow && internalPin.contextWindow > 0
          ? internalPin.contextWindow
          : resolveConfiguredTargetContextWindow(activeTarget);
        const activeGeminiProfileId = activeTarget.provider === 'gemini'
          ? activeTarget.profileId || selectedGeminiProfileId
          : undefined;
        // Credential rotation and retries stay on the active model. A
        // non-tool-capable model is escalated automatically before an
        // implementation run so it cannot describe a change without making it.
        const sameProviderFallbackModels = activeTarget.provider === 'gemini'
          ? getGeminiSameProviderFallbackModelIds(activeTarget.resolvedModel)
          : [];
        runMetadata.sameProviderFallbackModels = sameProviderFallbackModels;
        if (activeContextWindow) {
          runMetadata.modelContextWindow = activeContextWindow;
          runManager.updateRunMetadata(runId, { modelContextWindow: activeContextWindow });
        }
        emitModelTargetResolved({
          ...activeTarget,
          contextWindow: activeContextWindow,
          route: activeModel === selectedModel ? 'primary' : 'recovery',
          reason: modelResolution?.changed ? 'capability_escalation' : activeModel === selectedModel ? 'selected_model' : 'approved_recovery_model',
        });
        const approvalPolicy = String(taskAnalysis?.approvalPolicy || requestedApprovalPolicy);
        const approvalMode = approvalPolicy === 'full_access'
          ? 'full_workspace'
          : approvalPolicy === 'read_only' || taskAnalysis?.expectedChangeIntent === 'read_only'
            ? 'read_only'
            : approvalPolicy === 'ask'
              ? 'ask'
              : 'scoped_auto_approve';
        const capabilityPackDefinition = activeFallbackPolicy.capabilityPackDefinition && typeof activeFallbackPolicy.capabilityPackDefinition === 'object'
          ? activeFallbackPolicy.capabilityPackDefinition
          : undefined;
        runManager.updateRunMetadata(runId, {
          approvalPolicy: approvalPolicy === 'full_workspace' ? 'full_access' : approvalPolicy === 'scoped_auto_approve' ? 'auto_approve' : approvalPolicy,
          activeModelTarget: activeTarget,
          ...(activeContextWindow ? { modelContextWindow: activeContextWindow } : {}),
          ...(capabilityPackDefinition ? { capabilityPackDefinition } : {}),
          capabilityPack: typeof activeFallbackPolicy.capabilityPack === 'string'
            ? activeFallbackPolicy.capabilityPack
            : capabilityPackDefinition && typeof capabilityPackDefinition === 'object' && typeof (capabilityPackDefinition as Record<string, unknown>).id === 'string'
              ? String((capabilityPackDefinition as Record<string, unknown>).id)
              : 'implementation',
          ...(Array.isArray(activeFallbackPolicy.allowedTools) ? { allowedTools: activeFallbackPolicy.allowedTools } : {}),
          ...(Array.isArray(activeFallbackPolicy.deniedTools) ? { deniedTools: activeFallbackPolicy.deniedTools } : {}),
        });
        const restoreDirectToolPolicy = setDirectToolPolicy(() => ({
          workspace: workspaceRoot,
          mode: approvalMode,
          taskId: typeof taskAnalysis?.id === 'string' ? taskAnalysis.id : undefined,
          approvalGrants: runManager.getApprovalGrants(runId),
        }));
        const childRunMetadata = runMetadata.childRun && typeof runMetadata.childRun === 'object'
          ? runMetadata.childRun as Record<string, unknown>
          : undefined;
        const isBoundedSubtask = Boolean(childRunMetadata?.contract);
        const guardEnabled = ((kind === 'coder' && taskAnalysis && typeof taskAnalysis === 'object' && taskAnalysis.approvalPolicy !== 'full_access') || isBoundedSubtask) &&
          taskAnalysis &&
          typeof taskAnalysis === 'object';
        let disableFileMutationGuard: (() => void) | undefined;
        if (guardEnabled && taskAnalysis) {
          const affectedFiles = Array.isArray(taskAnalysis.affectedFiles) ? taskAnalysis.affectedFiles : [];
          disableFileMutationGuard = enableFileMutationGuard({
            relatedTaskId: typeof taskAnalysis.id === 'string' ? taskAnalysis.id : `coder-run-${Date.now()}`,
            intents: affectedFiles
              .filter((file: any) => typeof file?.path === 'string' && file.intent !== 'read_only')
              .map((file: any) => ({
                path: file.path,
                operation: file.intent === 'create' ? 'create' : 'modify',
                allowCreate: file.intent === 'create',
                allowOverwrite: file.intent === 'modify',
                reason: typeof file.reason === 'string' ? file.reason : 'Coder task analysis affected file.',
                relatedTaskId: typeof taskAnalysis.id === 'string' ? taskAnalysis.id : `coder-run-${Date.now()}`,
              })),
          });
        }
        const requestBudgetEnabled = activeFallbackPolicy.requestBudgetEnabled !== false;
        const replayGuardEnabled = activeFallbackPolicy.replayGuardEnabled !== false;
        const parentRunId = typeof runMetadata.parentRunId === 'string' ? runMetadata.parentRunId : undefined;
        const baseAuditAttemptIndex = Number(runMetadata.attemptIndex) > 0
          ? Math.floor(Number(runMetadata.attemptIndex))
          : 1;
        const auditAttemptIndex = baseAuditAttemptIndex + continuationAttempt + providerRetryAttempt;
        const auditRunId = auditAttemptIndex === baseAuditAttemptIndex
          ? runId
          : `${runId}:attempt-${auditAttemptIndex}`;
        const parentAuditRunId = auditAttemptIndex > baseAuditAttemptIndex
          ? auditAttemptIndex === baseAuditAttemptIndex + 1
            ? runId
            : `${runId}:attempt-${auditAttemptIndex - 1}`
          : parentRunId;
        const isFreshChildRun = Boolean(runMetadata.childRun && typeof runMetadata.childRun === 'object');
        const hydratedContextSnapshot = runManager.getContextSnapshot(runId) ||
          (parentRunId && !isFreshChildRun ? runManager.getContextSnapshot(parentRunId) : null) || undefined;
        const engine = new ReActEngine({
          runId,
          auditRunId,
          threadId: normalizedThreadId,
          parentRunId: parentAuditRunId,
          attemptIndex: auditAttemptIndex,
          threadTitle: typeof runMetadata.threadTitle === 'string' && runMetadata.threadTitle.trim()
            ? runMetadata.threadTitle
            : displayTask,
          continuousRun: continuousExecution,
          maxSteps: continuationStepBudget || (continuousExecution ? CONTINUOUS_RUN_STEP_WINDOW : (maxSteps || 10)),
          globalStepLimit,
          runStartedAt,
          wallClockBudgetMs,
          maxRecoveryTransitions,
          model: activeModel,
          contextWindow: activeContextWindow,
          modelTargetPinned: Boolean(internalPin?.modelTarget),
          // The selected target is authoritative for both planning and work.
          // A different model can enter this path only through an explicit
          // confirmed /resume request.
          plannerModel: activeModel,
          llmRequestTimeoutMs: Number.isFinite(llmRequestTimeoutMs) ? Number(llmRequestTimeoutMs) : undefined,
          plannerRequestTimeoutMs: Number.isFinite(plannerRequestTimeoutMs) ? Number(plannerRequestTimeoutMs) : undefined,
          pacingProfile: selectedPacingProfile,
          allowProviderRouteProbe: selectedPacingProfile === 'fast',
          llmRequestIntervalMs: Number.isFinite(llmRequestIntervalMs) ? Number(llmRequestIntervalMs) : undefined,
          thinkingDepth,
          budget: continuousExecution ? CONTINUOUS_RUN_COST_LIMIT : (budget || 100),
          workspace: workspaceRoot,
          repositoryCommitHash,
          geminiProfileId: activeGeminiProfileId,
          userId: typeof runMetadata.userId === 'string' ? runMetadata.userId : undefined,
          maxLlmRequestsPerTask: continuousExecution
            ? Number.POSITIVE_INFINITY
            : requestBudgetEnabled
            ? Number(runMetadata.maximumRequestsPerTask) || 10
            : Number.POSITIVE_INFINITY,
          maxToolCalls: Number.isFinite(Number(runMetadata.maxToolCalls))
            ? Math.max(1, Number(runMetadata.maxToolCalls))
            : undefined,
          replayGuardEnabled,
          allowCrossProviderFallback: false,
          approvedFallbackProviders: [],
          sameProviderFallbackModels: internalPin?.modelTarget ? [] : sameProviderFallbackModels,
          allowNvidiaModelFallback: internalPin?.modelTarget ? false : undefined,
          allowPollinationsFallback: false,
          fallbackApprovalGranted: false,
          allowedExternalProviders: Array.isArray(activeFallbackPolicy.allowedExternalProviders)
            ? activeFallbackPolicy.allowedExternalProviders.filter((value): value is string => typeof value === 'string')
            : undefined,
          privateWorkspace: activeFallbackPolicy.privateWorkspace === true,
          sendPrivateSourceCode: activeFallbackPolicy.sendPrivateSourceCode === true,
          taskAnalysis,
          taskRouting,
          continuationHandoff: isContinuationHandoff(runMetadata.continuationHandoff)
            ? runMetadata.continuationHandoff
            : undefined,
          approvalGrantProvider: () => runManager.getApprovalGrants(runId),
          consumeQueuedMessages: () => runManager.consumeQueuedMessages(runId),
          acknowledgeQueuedMessages: (messageIds) => runManager.acknowledgeQueuedMessages(runId, messageIds),
          requestUserInput,
          verbose: true,
          signal,
          contextSnapshot: hydratedContextSnapshot,
          onPlannerContextSnapshot: (stepSeq, snapshot) => runManager.recordPlannerContextSnapshot(runId, stepSeq, snapshot),
          capabilityPack: activeFallbackPolicy.capabilityPackDefinition && typeof activeFallbackPolicy.capabilityPackDefinition === 'object'
            ? activeFallbackPolicy.capabilityPackDefinition as any
            : typeof activeFallbackPolicy.capabilityPack === 'string'
              ? activeFallbackPolicy.capabilityPack as any
              : undefined,
          onSubtaskDispatch: runMetadata.enableSubtaskDispatch === true && !internalPin?.modelTarget
            ? async (state, trigger) => {
                const dispatcher = new EngineSubtaskDispatcher({
                  contextWindow: activeContextWindow || state.modelContextWindow || 0,
                  model: activeTarget.resolvedModel,
                  signal,
                  onEvent: (type, data) => emit(type, data),
                  launch: async ({ contract, task: childTask }) => {
                    const prepared = runManager.prepareChildRun(runId, {
                      task: childTask,
                      role: 'bounded-subtask',
                      provider: 'fresh',
                      budget: contract.budget,
                      contract,
                      capabilities: {
                        ...(typeof capabilityPackDefinition === 'object' && capabilityPackDefinition && typeof (capabilityPackDefinition as Record<string, unknown>).id === 'string'
                          ? { pack: String((capabilityPackDefinition as Record<string, unknown>).id) }
                          : {}),
                        approvalMode,
                      },
                    });
                    if (!prepared.ok) throw new Error(prepared.message);
                    const parentAnalysis = taskAnalysis;
                    const scopedFiles = new Set(contract.fileScope.map((file) => file.replace(/\\/g, '/').toLowerCase()));
                    const childAnalysis: CoderTaskAnalysis | undefined = parentAnalysis
                      ? {
                          id: `${parentAnalysis.id}-${contract.id}`,
                          userRequest: childTask,
                          taskKind: parentAnalysis.taskKind,
                          instanceMode: 'continuation',
                          targetLayer: parentAnalysis.targetLayer,
                          behaviorScope: parentAnalysis.behaviorScope,
                          refactorRisk: parentAnalysis.refactorRisk,
                          confidence: parentAnalysis.confidence,
                          rationale: 'Fresh child context scoped from the parent task contract and unfinished plan item.',
                          workspace: parentAnalysis.workspace,
                          mentionedFiles: contract.fileScope,
                          inferredFiles: [],
                          sourceFiles: parentAnalysis.sourceFiles?.filter((file) => scopedFiles.has(file.replace(/\\/g, '/').toLowerCase())),
                          expectedChangeIntent: parentAnalysis.expectedChangeIntent,
                          affectedFiles: parentAnalysis.affectedFiles.filter((file) => scopedFiles.has(file.path.replace(/\\/g, '/').toLowerCase())),
                          riskLevel: parentAnalysis.riskLevel,
                          riskFactors: parentAnalysis.riskFactors.slice(0, 4),
                          requiresApproval: parentAnalysis.requiresApproval,
                          approvalPolicy: parentAnalysis.approvalPolicy,
                          requiredInspections: ['Inspect the scoped files before changing them.'],
                          verificationPlan: contract.acceptanceChecks,
                          validationRequirements: contract.acceptanceChecks,
                          projectFileMap: undefined,
                          contract: parentAnalysis.contract
                            ? {
                                ...parentAnalysis.contract,
                                id: `${parentAnalysis.contract.id}-${contract.id}`,
                                originalRequest: contract.objective,
                                resolvedRequest: contract.objective,
                                requestedOutcome: contract.objective,
                                candidateFiles: contract.fileScope,
                                acceptanceCriteria: contract.acceptanceChecks.map((description, index) => ({
                                  id: `subtask-check-${index + 1}`,
                                  description,
                                  required: true,
                                  source: 'analysis' as const,
                                })),
                                historicalClaims: [],
                                verificationRequirements: contract.acceptanceChecks,
                                completionEvidenceRequirements: {
                                  ...parentAnalysis.contract.completionEvidenceRequirements,
                                  requiredChecks: contract.acceptanceChecks,
                                },
                              }
                            : undefined,
                        }
                      : undefined;
                    const child = startReactRunFromBody({
                      id: prepared.record.childId,
                      kind: 'agent',
                      task: childTask,
                      model: prepared.record.model,
                      workspace: prepared.record.workspace,
                      maxSteps: prepared.record.budget.maxSteps,
                      maxToolCalls: prepared.record.budget.maxToolCalls,
                      budget: prepared.record.budget.maxCost,
                      capabilityPack: prepared.record.capabilities.pack,
                      metadata: {
                        ...prepared.metadata,
                        ...(childAnalysis ? { taskAnalysis: childAnalysis } : {}),
                        displayTask: childTask,
                        enableSubtaskDispatch: false,
                      },
                      requestBudgetEnabled: true,
                      replayGuardEnabled: true,
                    }, 'agent', {
                      ...(prepared.record.modelTarget ? { modelTarget: prepared.record.modelTarget } : {}),
                      ...(prepared.record.modelContextWindow ? { contextWindow: prepared.record.modelContextWindow } : {}),
                    });
                    const registered = runManager.registerChildRun(runId, child.id);
                    if (!registered) throw new Error(`Could not register child run ${child.id} with parent ${runId}.`);
                    const report = await runManager.waitForChildReport(runId, child.id);
                    if (!report) throw new Error(`Child run ${child.id} finished without a report.`);
                    return report;
                  },
                });
                return dispatcher.dispatch(state, trigger);
              }
            : undefined,
          onEvent: (event) => {
            if (event.type === 'model_target_resolved') emitModelTargetResolved(event);
            else emit(event.type, event);
          },
          onProgress: (message) => emit('progress', message),
          onStateUpdate: (state) => emit('state', state),
          onCheckpoint: (nextCheckpoint) => emit('checkpoint', nextCheckpoint),
        });

        try {
          // Provider retries are internal to the same run: they must continue
          // from its durable checkpoint rather than from the original request.
          // Explicit user continuations still arrive through resumeState and
          // deliberately receive their fresh continuation allowance.
          const initialState = providerRetryAttempt > 0
            ? structuredClone(checkpoint!.state)
            : continuationAttempt > 0
              ? prepareReactResumeState(
                checkpoint!.state,
                continuationStepBudget,
                Date.now(),
                { resetRequestBudget: false },
              )
              : resumeState && typeof resumeState === 'object'
                ? structuredClone(resumeState)
                : {};
          return await engine.run(task, initialState);
        } finally {
          disableFileMutationGuard?.();
          restoreDirectToolPolicy();
        }
      }
    );
  }

  router.post('/api/coder/respond', async (req, res) => {
    try {
      const message = typeof req.body?.message === 'string' ? req.body.message : '';
      const images = Array.isArray(req.body?.images) ? req.body.images : undefined;
      const thread = Array.isArray(req.body?.thread) ? req.body.thread : [];
      const workspace = typeof req.body?.workspace === 'string' ? req.body.workspace : undefined;
      const model = typeof req.body?.model === 'string' ? req.body.model : undefined;
      const geminiProfileId = typeof req.body?.geminiProfileId === 'string' ? req.body.geminiProfileId : undefined;
      const mode = req.body?.mode === 'chat' || req.body?.mode === 'agent' || req.body?.mode === 'auto'
        ? req.body.mode
        : 'auto';
      const approvalPolicy = req.body?.approvalPolicy === 'auto_approve' || req.body?.approvalPolicy === 'full_access'
        ? req.body.approvalPolicy
        : 'ask';

      let llm;
      try {
        llm = di.llm();
      } catch {
        llm = undefined;
      }

      const workspaceRoot = await ensureWorkspaceRoot(workspace);
      const intent = mode === 'agent' ? { mode: 'execute' } : classifyCoderIntent(message);
      const projectFileMap = intent.mode === 'execute'
        ? await buildCoderProjectFileMap(workspaceRoot, message).catch(() => undefined)
        : undefined;
      const response = await createCoderRespondResponse({
        message,
        images,
        thread,
        workspace: workspaceRoot,
        model,
        geminiProfileId,
        mode,
        approvalPolicy,
        projectFileMap,
      }, llm);
      res.json(response);
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.post('/api/coder/analyze', async (req, res) => {
    try {
      const message = typeof req.body?.message === 'string' ? req.body.message : '';
      const workspace = typeof req.body?.workspace === 'string' ? req.body.workspace : undefined;
      const threadId = typeof req.body?.threadId === 'string' ? req.body.threadId : undefined;
      const mode = req.body?.mode === 'chat' || req.body?.mode === 'agent' || req.body?.mode === 'auto'
        ? req.body.mode
        : 'auto';
      const approvalPolicy = req.body?.approvalPolicy === 'auto_approve' || req.body?.approvalPolicy === 'full_access'
        ? req.body.approvalPolicy
        : 'ask';
      const thread = Array.isArray(req.body?.thread) ? req.body.thread : [];

      if (!message.trim()) {
        res.status(400).json({ error: 'Message is required for coder task analysis.' });
        return;
      }

      const workspaceRoot = await ensureWorkspaceRoot(workspace);
      const projectFileMap = await buildCoderProjectFileMap(workspaceRoot, message).catch(() => undefined);

      const analysis = analyzeCoderTask({
        message,
        mode,
        workspace: workspaceRoot,
        threadId,
        thread,
        projectFileMap,
        approvalPolicy,
      });

      res.json({
        responseMode: responseModeForAnalysis(analysis, mode),
        analysis,
      });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.post('/api/runs', async (req, res) => {
    try {
       const kind = req.body?.kind === 'coder' || req.body?.kind === 'app' || req.body?.kind === 'agent' ? req.body.kind : 'react';
       const run = startReactRunFromBody(req.body, kind, undefined, { skipPreflight: req.query.skipPreflight === 'true' });
       res.status((run as any).queued ? 202 : 200).json({ runId: run.id, run, ...( (run as any).queued ? { queued: true, queuedMessage: (run as any).queuedMessage } : {}) });
    } catch (error: any) {
      const requestedStatus = Number(error?.statusCode);
      const status = requestedStatus === 409 || requestedStatus === 424 ? requestedStatus : 400;
      res.status(status).json({
        error: sanitizeError(error.message || String(error)),
        ...(status === 424 && error?.preflight && typeof error.preflight === 'object' ? { preflight: error.preflight } : {}),
        ...(status === 409 && error?.activeRunId ? { activeRunId: error.activeRunId, reused: true } : {}),
        ...(status === 409 && error?.resumableRunId ? {
          resumableRunId: error.resumableRunId,
          resumableModel: error.resumableModel,
          resumableThreadId: error.resumableThreadId,
          resumableGeminiProfileId: error.resumableGeminiProfileId,
          resumeRequired: true,
          reused: true,
        } : {}),
      });
    }
  });

  router.get('/api/runs', async (req, res) => {
    try {
      const kind = req.query.kind === 'coder' || req.query.kind === 'react' || req.query.kind === 'app' || req.query.kind === 'agent'
        ? req.query.kind
        : undefined;
      const runs = runManager.listRuns({
        kind,
        resumable: req.query.resumable === 'true',
      });
      res.json({ runs: runs.map((run) => ({ ...run, ...runManager.getRunLiveness(run.id) })) });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.get('/api/runs/:runId', async (req, res) => {
    try {
      const run = runManager.getRun(req.params.runId);
      if (!run) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      const afterSeq = parseRunCursor(req.query.afterSeq);
      const limit = parseRunPageSize(req.query.limit, DEFAULT_RUN_EVENT_PAGE_SIZE, MAX_RUN_EVENT_PAGE_SIZE);
      const incremental = afterSeq > 0;
      const pageProjection = incremental
        ? runManager.projectEventPage(req.params.runId, afterSeq, limit, {
            includeTimeline: true,
            includeRawEvidence: false,
          })
        : undefined;
      const page = pageProjection || runManager.listEventPage(req.params.runId, afterSeq, limit);
      const taskAnalysisView = taskAnalysisViewFromMetadata(run.metadata);
      const projection = incremental
        ? undefined
        : (() => {
          const projected = runManager.projectEvents(req.params.runId, 0, {
            // The detail view is a summary. Timeline pages and raw evidence
            // have dedicated bounded endpoints below.
            includeTimeline: false,
            includeRawEvidence: false,
          });
          return projected.taskAnalysis || !taskAnalysisView
            ? projected
            : { ...projected, taskAnalysis: taskAnalysisView };
        })();
      const liveness = runManager.getRunLiveness(req.params.runId);
      res.json({
        run: { ...run, ...liveness },
        ...(taskAnalysisView ? { taskAnalysis: taskAnalysisView } : {}),
        inbox: runManager.listInbox(req.params.runId),
        children: runManager.listChildRuns(req.params.runId),
        events: page.events,
        eventCursor: eventPageCursor(page),
        ...(projection ? {
          projection,
          projectionMode: 'summary',
          todo: projection.todo,
          contextSnapshot: runManager.getContextSnapshot(req.params.runId),
        } : {
          projectionDelta: pageProjection?.projection,
          projectionMode: 'delta',
          projectionCursor: eventPageCursor(page),
          todoDelta: pageProjection?.projection.todo,
        }),
      });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.get('/api/runs/:runId/context-snapshot', (req, res) => {
    const apiTokenConfigured = Boolean(process.env.SERVER_API_TOKEN?.trim());
    if (process.env.NODE_ENV === 'production' || !apiTokenConfigured) {
      return res.status(404).json({ error: 'Context snapshots are available only in token-configured development mode.' });
    }
    const runId = req.params.runId;
    if (!runManager.getRun(runId)) return res.status(404).json({ error: 'Run not found.' });
    const rawSeq = Array.isArray(req.query.seq) ? req.query.seq[0] : req.query.seq;
    if (typeof rawSeq !== 'string' || !/^\d{1,6}$/.test(rawSeq)) {
      return res.status(400).json({ error: 'seq must be a positive step number.' });
    }
    const stepSeq = Number(rawSeq);
    if (stepSeq < 1 || stepSeq > 100_000) return res.status(400).json({ error: 'seq must be a positive step number.' });
    const snapshot = runManager.getPlannerContextSnapshot(runId, stepSeq);
    if (!snapshot) return res.status(404).json({ error: 'No in-memory planner snapshot is available for that run step.' });
    res.set('Cache-Control', 'no-store, max-age=0');
    return res.json({ runId, ...snapshot });
  });

  router.get('/api/runs/:runId/events', async (req, res) => {
    try {
      if (!runManager.getRun(req.params.runId)) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      const afterSeq = parseRunCursor(req.query.afterSeq);
      const limit = parseRunPageSize(req.query.limit, DEFAULT_RUN_EVENT_PAGE_SIZE, MAX_RUN_EVENT_PAGE_SIZE);
      const page = runManager.listEventPage(req.params.runId, afterSeq, limit);
      res.json({ runId: req.params.runId, events: page.events, cursor: eventPageCursor(page) });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.get('/api/runs/:runId/projection', async (req, res) => {
    try {
      const run = runManager.getRun(req.params.runId);
      if (!run) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      const afterSeq = parseRunCursor(req.query.afterSeq);
      const limit = parseRunPageSize(req.query.limit, DEFAULT_RUN_EVENT_PAGE_SIZE, MAX_RUN_EVENT_PAGE_SIZE);
      const page = runManager.projectEventPage(req.params.runId, afterSeq, limit, {
        includeTimeline: true,
        includeRawEvidence: false,
      });
      const taskAnalysis = taskAnalysisViewFromMetadata(run.metadata);
      const projection = page.projection.taskAnalysis || !taskAnalysis
        ? page.projection
        : { ...page.projection, taskAnalysis };
      res.json({
        runId: req.params.runId,
        projection,
        projectionMode: afterSeq > 0 ? 'delta' : 'page',
        cursor: eventPageCursor(page),
      });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.get('/api/runs/:runId/evidence', async (req, res) => {
    try {
      if (!runManager.getRun(req.params.runId)) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      const afterSeq = parseRunCursor(req.query.afterSeq);
      const limit = parseRunPageSize(req.query.limit, DEFAULT_EVIDENCE_PAGE_SIZE, MAX_EVIDENCE_PAGE_SIZE);
      const page = runManager.projectEventPage(req.params.runId, afterSeq, limit, {
        includeTimeline: false,
        includeRawEvidence: true,
      });
      res.json({
        runId: req.params.runId,
        rawEvidence: page.projection.rawEvidence,
        cursor: eventPageCursor(page),
      });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.post('/api/runs/:runId/seen', async (req, res) => {
    try {
      runManager.markSeen(req.params.runId);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.post('/api/runs/:runId/stop', async (req, res) => {
    try {
      const stopped = runManager.stopRun(req.params.runId, String(req.body?.reason || 'Run stopped by user.'));
      if (!stopped) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.post('/api/runs/:runId/interrupt', async (req, res) => {
    try {
      const interrupted = runManager.interruptRun(req.params.runId, String(req.body?.reason || 'Run interrupted by user.'));
      if (!interrupted) return res.status(404).json({ error: 'Run not found' });
      return res.json({ ok: true, status: 'interrupted' });
    } catch (error: any) {
      return res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.get('/api/runs/:runId/children', (req, res) => {
    const parent = runManager.getRun(req.params.runId);
    if (!parent) return res.status(404).json({ error: 'Parent run not found' });
    return res.json({ parentRunId: parent.id, children: runManager.listChildRuns(parent.id) });
  });

  router.post('/api/runs/:runId/children', async (req, res) => {
    try {
      const capabilities = req.body?.capabilities && typeof req.body.capabilities === 'object' && !Array.isArray(req.body.capabilities)
        ? req.body.capabilities
        : undefined;
      const budget = req.body?.budget && typeof req.body.budget === 'object' && !Array.isArray(req.body.budget)
        ? req.body.budget
        : undefined;
      const prepared = runManager.prepareChildRun(req.params.runId, {
        task: typeof req.body?.task === 'string' ? req.body.task : '',
        role: typeof req.body?.role === 'string' ? req.body.role : 'specialist',
        provider: typeof req.body?.provider === 'string' ? req.body.provider : undefined,
        model: typeof req.body?.model === 'string' ? req.body.model : undefined,
        workspace: typeof req.body?.workspace === 'string' ? req.body.workspace : undefined,
        capabilities,
        budget,
        depth: req.body?.depth,
      });
      if (!prepared.ok) {
        const status = prepared.reason === 'not_found' ? 404 : prepared.reason === 'terminal' || prepared.reason === 'duplicate' ? 409 : prepared.reason === 'unsupported_provider' ? 501 : 400;
        return res.status(status).json({ error: prepared.message, reason: prepared.reason });
      }
      const record = prepared.record;
      if (record.provider === 'external' || record.provider === 'acp') {
        return res.status(501).json({ error: `No ${record.provider} child provider is registered in this server instance.`, reason: 'provider_not_registered' });
      }
      const child = startReactRunFromBody({
        id: record.childId,
        kind: 'agent',
        task: typeof req.body?.task === 'string' ? req.body.task : '',
        model: record.model,
        workspace: record.workspace,
        maxSteps: record.budget.maxSteps,
        maxToolCalls: record.budget.maxToolCalls,
        budget: record.budget.maxCost,
        capabilityPack: record.capabilities.pack,
        metadata: prepared.metadata,
        requestBudgetEnabled: true,
        replayGuardEnabled: true,
      }, 'agent', {
        ...(record.modelTarget ? { modelTarget: record.modelTarget } : {}),
        ...(record.modelContextWindow ? { contextWindow: record.modelContextWindow } : {}),
      });
      const registered = runManager.registerChildRun(req.params.runId, child.id);
      if (!registered) return res.status(500).json({ error: 'Child run was created but could not be registered with its parent.' });
      return res.status(202).json({ parentRunId: req.params.runId, childId: child.id, run: runManager.getRun(child.id), child: registered });
    } catch (error: any) {
      return res.status(400).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.get('/api/runs/:runId/children/:childId/report', (req, res) => {
    const child = runManager.getChildRun(req.params.childId);
    if (!child || child.parentRunId !== req.params.runId) return res.status(404).json({ error: 'Child run not found' });
    return res.json({ child, report: runManager.getChildReport(req.params.childId) });
  });

  router.post('/api/runs/:runId/children/:childId/follow-up', (req, res) => {
    const result = runManager.sendChildFollowUp(req.params.runId, req.params.childId, {
      message: typeof req.body?.message === 'string' ? req.body.message : '',
      messageId: typeof req.body?.messageId === 'string' ? req.body.messageId : undefined,
    });
    if (!result.ok) return res.status(result.reason === 'not_child' ? 404 : result.reason === 'terminal' ? 409 : 400).json({ error: result.reason });
    return res.status(202).json(result);
  });

  router.post('/api/runs/:runId/children/:childId/interrupt', (req, res) => {
    const interrupted = runManager.interruptChildRun(
      req.params.runId,
      req.params.childId,
      typeof req.body?.reason === 'string' ? req.body.reason : 'Child interrupted by parent.',
    );
    if (!interrupted) return res.status(404).json({ error: 'Child run not found or already terminal.' });
    return res.json({ ok: true, childId: req.params.childId, status: 'interrupted' });
  });

  router.post('/api/runs/:runId/kill', async (req, res) => {
    try {
      const killed = runManager.killRun(req.params.runId, String(req.body?.reason || 'Run killed by user.'));
      if (!killed) return res.status(404).json({ error: 'Run not found' });
      return res.json({ ok: true, status: 'killed' });
    } catch (error: any) {
      return res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.post('/api/runs/:runId/messages', (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message : '';
    const result = runManager.queueUserMessage(req.params.runId, {
      message,
      source: typeof req.body?.source === 'string' ? req.body.source : 'api',
    });
    if (!result.ok) {
      const status = result.reason === 'not_found' ? 404 : result.reason === 'invalid_message' ? 400 : 409;
      return res.status(status).json({ error: `Message was not queued: ${result.reason}.` });
    }
    return res.status(202).json({ ok: true, runId: req.params.runId, message: result.message, status: result.run.status });
  });

  router.get('/api/runs/:runId/inbox', (req, res) => {
    const run = runManager.getRun(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    const status = req.query.status === 'pending' || req.query.status === 'claimed' || req.query.status === 'cancelled' || req.query.status === 'processed'
      ? req.query.status
      : undefined;
    const target = req.query.target === 'next-turn' || req.query.target === 'next-step'
      ? req.query.target
      : undefined;
    return res.json({ runId: run.id, inbox: runManager.listInbox(run.id, { status, target }) });
  });

  router.post('/api/runs/:runId/inbox', (req, res) => {
    const target = req.body?.target === 'next-turn' || req.body?.target === 'next-step' ? req.body.target : undefined;
    if (req.body?.target !== undefined && !target) {
      return res.status(400).json({ error: 'target must be next-turn or next-step.' });
    }
    const result = runManager.enqueueInboxMessage(req.params.runId, {
      message: typeof req.body?.message === 'string' ? req.body.message : '',
      messageId: typeof req.body?.messageId === 'string' ? req.body.messageId : undefined,
      source: typeof req.body?.source === 'string' ? req.body.source : 'follow_up',
      target,
    });
    if (!result.ok) {
      const status = result.reason === 'not_found' ? 404 : result.reason === 'invalid_message' ? 400 : 409;
      return res.status(status).json({ error: `Inbox message was not queued: ${result.reason}.` });
    }
    return res.status(202).json({ ok: true, runId: req.params.runId, entry: result.entry, message: result.message, status: result.run.status });
  });

  router.patch('/api/runs/:runId/inbox/:messageId', (req, res) => {
    const target = req.body?.target === 'next-turn' || req.body?.target === 'next-step' ? req.body.target : undefined;
    if (req.body?.target !== undefined && !target) {
      return res.status(400).json({ error: 'target must be next-turn or next-step.' });
    }
    const entry = runManager.replaceInboxMessage(req.params.runId, req.params.messageId, {
      message: typeof req.body?.message === 'string' ? req.body.message : '',
      source: typeof req.body?.source === 'string' ? req.body.source : undefined,
      target,
    });
    if (!entry) return res.status(409).json({ error: 'Inbox message was not found or is no longer pending.' });
    return res.json({ ok: true, entry });
  });

  router.delete('/api/runs/:runId/inbox/:messageId', (req, res) => {
    const entry = runManager.cancelInboxMessage(req.params.runId, req.params.messageId);
    if (!entry) return res.status(404).json({ error: 'Inbox message was not found or was already processed.' });
    return res.json({ ok: true, entry });
  });

  router.post('/api/runs/:runId/inbox/clear', (req, res) => {
    const target = req.body?.target === 'next-turn' || req.body?.target === 'next-step' ? req.body.target : undefined;
    if (req.body?.target !== undefined && !target) {
      return res.status(400).json({ error: 'target must be next-turn or next-step.' });
    }
    if (!runManager.getRun(req.params.runId)) return res.status(404).json({ error: 'Run not found' });
    return res.json({ ok: true, runId: req.params.runId, entries: runManager.clearInbox(req.params.runId, target) });
  });

  router.get('/api/runs/:runId/user-input', (req, res) => {
    const run = runManager.getRun(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    return res.json({
      runId: run.id,
      status: run.status,
      request: runManager.getPendingUserInput(run.id),
    });
  });

  router.post('/api/runs/:runId/user-input', (req, res) => {
    const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
    if (!requestId) return res.status(400).json({ error: 'requestId is required.' });
    const result = runManager.respondToUserInput(req.params.runId, requestId, {
      answer: typeof req.body?.answer === 'string' ? req.body.answer : undefined,
      selectedOption: typeof req.body?.selectedOption === 'string' ? req.body.selectedOption : undefined,
      cancelled: req.body?.cancelled === true,
    });
    if (!result.ok) {
      const status = result.reason === 'not_found'
        ? 404
        : result.reason === 'invalid_option' || result.reason === 'invalid_response'
          ? 400
          : 409;
      return res.status(status).json({ error: `User input response was not accepted: ${result.reason}.` });
    }
    return res.json({ ok: true, runId: req.params.runId, response: result.response });
  });

  router.get('/api/runs/:runId/approvals', (req, res) => {
    const run = runManager.getRun(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    return res.json({ runId: run.id, approvals: runManager.getApprovalGrants(run.id) });
  });

  router.post('/api/runs/:runId/approvals', (req, res) => {
    const scope = typeof req.body?.scope === 'string' ? req.body.scope.trim() : '';
    const decision = req.body?.decision === 'deny' ? 'deny' : req.body?.decision === 'allow' ? 'allow' : undefined;
    const expiresAt = Number(req.body?.expiresAt);
    if (!scope || !decision) return res.status(400).json({ error: 'scope and decision (allow or deny) are required.' });
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return res.status(400).json({ error: 'expiresAt must be in the future.' });
    const approvals = runManager.decideApprovalScope(req.params.runId, {
      scope,
      decision,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
      reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : undefined,
    });
    if (!approvals) return res.status(404).json({ error: 'Run not found' });
    return res.json({ runId: req.params.runId, approvals });
  });

  router.post('/api/runs/:runId/plan-approval', (req, res) => {
    const decision = req.body?.decision === 'approve' || req.body?.decision === 'reject' || req.body?.decision === 'edit' || req.body?.decision === 'cancel'
      ? req.body.decision
      : undefined;
    if (!decision) return res.status(400).json({ error: 'decision (approve, reject, edit, or cancel) is required.' });
    if (decision === 'edit' && !Array.isArray(req.body?.plan)) {
      return res.status(400).json({ error: 'An edited plan array is required for the edit decision.' });
    }
    const result = runManager.decidePlanApproval(req.params.runId, {
      decision,
      plan: req.body?.plan,
      reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : undefined,
    });
    if (!result.ok) {
      const status = result.reason === 'not_found' ? 404 : result.reason === 'not_pending' ? 409 : 404;
      return res.status(status).json({ error: `Plan approval was not accepted: ${result.reason}.` });
    }
    return res.json({ runId: req.params.runId, approval: result.approval, checkpoint: result.checkpoint });
  });

  router.post('/api/runs/:runId/fallback-policy', (req, res) => {
    const run = runManager.getRun(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    const metadata = run.metadata && typeof run.metadata === 'object' ? run.metadata as Record<string, unknown> : {};
    const approvedProviderNames = new Set(['gemini', 'nvidia', 'groq', 'openrouter', 'requesty', 'kimi', 'cerebras', 'sambanova', 'local', 'colab']);
    const requestedProviders = Array.isArray(req.body?.approvedFallbackProviders)
      ? req.body.approvedFallbackProviders.filter((value: unknown): value is string =>
        typeof value === 'string' && approvedProviderNames.has(value)
      )
      : [];
    const hasFallbackChange = typeof req.body?.allowCrossProviderFallback === 'boolean';
    const enable = hasFallbackChange ? req.body.allowCrossProviderFallback === true : metadata.allowCrossProviderFallback === true;
    const requestedModel = typeof req.body?.model === 'string' && req.body.model.trim()
      ? normalizeCoderModelSelection(req.body.model.trim())
      : undefined;
    const currentModel = typeof metadata.recoveryModel === 'string' && metadata.recoveryModel.trim()
      ? normalizeCoderModelSelection(metadata.recoveryModel)
      : normalizeCoderModelSelection(run.model);
    if (requestedModel && requestedModel !== currentModel && req.body?.confirmModelChange !== true) {
      return res.status(409).json({
        error: 'Changing the active model requires explicit confirmation.',
        modelChangeConfirmationRequired: true,
        currentModel,
        requestedModel,
      });
    }
    if (requestedModel) {
      try {
        resolveConfiguredModelTarget(requestedModel, typeof metadata.providerProfile === 'string' ? metadata.providerProfile : undefined);
      } catch (error: any) {
        return res.status(400).json({ error: sanitizeError(error.message || String(error)) });
      }
    }
    if (hasFallbackChange && enable && requestedProviders.length === 0) {
      return res.status(400).json({ error: 'Select at least one configured fallback provider.' });
    }
    if (hasFallbackChange && enable && metadata.privateWorkspace === true && metadata.sendPrivateSourceCode !== true) {
      return res.status(409).json({ error: 'Private workspace source is not approved for external fallback providers.' });
    }
    const priorAudit = Array.isArray(metadata.fallbackPolicyAudit) ? metadata.fallbackPolicyAudit : [];
    const policy = {
      ...(hasFallbackChange ? {
        allowCrossProviderFallback: enable,
        fallbackApprovalGranted: enable,
        approvedFallbackProviders: enable ? [...new Set(requestedProviders)] : [],
      } : {}),
      ...(requestedModel ? { recoveryModel: requestedModel } : {}),
      ...(Array.isArray(req.body?.allowedExternalProviders)
        ? { allowedExternalProviders: req.body.allowedExternalProviders.filter((value: unknown): value is string => typeof value === 'string' && approvedProviderNames.has(value)) }
        : {}),
      fallbackPolicyAudit: [...priorAudit, {
        at: Date.now(),
        action: requestedModel ? 'model_selected' : enable ? 'approved' : 'revoked',
        providers: hasFallbackChange && enable ? [...new Set(requestedProviders)] : [],
        ...(requestedModel ? { model: requestedModel } : {}),
        source: 'user',
      }].slice(-20),
    };
    const updated = runManager.updateRunMetadata(run.id, policy);
    return res.json({ runId: run.id, policy, metadata: updated?.metadata });
  });

  router.post('/api/runs/:runId/resume', async (req, res) => {
    try {
      const resume = runManager.getResumeContext(req.params.runId);
      if (!resume.ok && (resume.reason === 'not_found' || resume.reason === 'missing_checkpoint')) {
        res.status(404).json({ error: 'Run or checkpoint not found.' });
        return;
      }
      const workspaceRebased = !resume.ok && resume.reason === 'stale_workspace';
      if (workspaceRebased && req.body?.rebaseWorkspace !== true) {
        res.status(409).json({
          error: 'Workspace changed since the checkpoint. Continue again with workspace rebase enabled to refresh file evidence safely.',
          staleWorkspace: true,
          rebaseAvailable: true,
        });
        return;
      }
      const prior = resume.ok ? resume.prior : runManager.getRun(req.params.runId);
      const checkpoint = resume.ok ? resume.checkpoint : runManager.getCheckpoint(req.params.runId);
      if (!prior || !checkpoint) {
        res.status(404).json({ error: 'Run or checkpoint not found.' });
        return;
      }
      if (checkpoint.state.planApproval?.status === 'pending') {
        res.status(409).json({
          error: 'Plan approval is still pending. Approve, edit, reject, or cancel the plan before resuming.',
          planApprovalRequired: true,
          planApproval: checkpoint.state.planApproval,
        });
        return;
      }
      const metadata = prior.metadata && typeof prior.metadata === 'object' ? prior.metadata as Record<string, unknown> : undefined;
      const priorAudit = getSQLiteAppStore().getRun<{ attemptIndex?: number }>(prior.id);
      const priorAttemptIndex = Number(priorAudit?.attemptIndex ?? metadata?.attemptIndex ?? 1);
      const continuationAttemptIndex = Number.isFinite(priorAttemptIndex) && priorAttemptIndex > 0
        ? Math.floor(priorAttemptIndex) + 1
        : 2;
      const targetThreadId = typeof req.body?.threadId === 'string' && req.body.threadId.trim()
        ? req.body.threadId.trim()
        : prior.threadId;
      const continuationReason = isContinuationReason(req.body?.reason) ? req.body.reason : 'saved_run';
      const hasRequestedModel = typeof req.body?.model === 'string' && req.body.model.trim();
      // An explicit resume target is a new user choice. Compare it with the
      // model recorded on the parent run even if the fallback-policy endpoint
      // already staged the same target in recoveryModel. Otherwise the staged
      // target masquerades as the old active model and the child loses the
      // model-change audit/confirmation boundary.
      const stagedRecoveryModel = typeof metadata?.recoveryModel === 'string' && metadata.recoveryModel.trim()
        ? normalizeCoderModelSelection(metadata.recoveryModel)
        : undefined;
      const priorActiveModel = hasRequestedModel
        ? normalizeCoderModelSelection(prior.model)
        : stagedRecoveryModel || normalizeCoderModelSelection(prior.model);
      const requestedModel = hasRequestedModel
        ? normalizeCoderModelSelection(req.body.model)
        : priorActiveModel;
      const requestedGeminiProfileId = typeof req.body?.geminiProfileId === 'string' && req.body.geminiProfileId.trim()
        ? req.body.geminiProfileId.trim()
        : typeof metadata?.providerProfile === 'string'
          ? metadata.providerProfile
          : undefined;
      // Validate the proposed target before asking for confirmation so a
      // deleted or malformed target remains a 400 configuration error.
      resolveConfiguredModelTarget(requestedModel, requestedGeminiProfileId);
      if (requestedModel !== priorActiveModel && req.body?.confirmModelChange !== true) {
        res.status(409).json({
          error: 'Changing the active model while resuming requires explicit confirmation.',
          modelChangeConfirmationRequired: true,
          currentModel: priorActiveModel,
          requestedModel,
        });
        return;
      }
      const requestedBudgetEnabled = typeof req.body?.requestBudgetEnabled === 'boolean'
        ? req.body.requestBudgetEnabled
        : metadata?.requestBudgetEnabled !== false;
      const requestedReplayGuardEnabled = typeof req.body?.replayGuardEnabled === 'boolean'
        ? req.body.replayGuardEnabled
        : metadata?.replayGuardEnabled !== false;
      const requestedWaitForProviderAvailability = typeof req.body?.waitForProviderAvailability === 'boolean'
        ? req.body.waitForProviderAvailability
        : metadata?.waitForProviderAvailability !== false;
      if (!requestedModel) {
        res.status(400).json({ error: 'A model target is required to resume this run.' });
        return;
      }
      const requestedFreshSteps = Number.parseInt(String(req.body?.maxSteps || ''), 10);
      const freshStepBudget = Number.isFinite(requestedFreshSteps)
        ? Math.max(1, Math.min(1000, requestedFreshSteps))
        : 40;
      const requestedContinuationTask = typeof req.body?.continuationTask === 'string'
        ? req.body.continuationTask.trim()
        : '';
      if (requestedContinuationTask.length > 64_000) {
        res.status(400).json({ error: 'Continuation task is too large.' });
        return;
      }
      const requestedContinuationDisplayTask = typeof req.body?.continuationDisplayTask === 'string'
        ? req.body.continuationDisplayTask.trim()
        : '';
      if (requestedContinuationDisplayTask.length > 8_000) {
        res.status(400).json({ error: 'Continuation display task is too large.' });
        return;
      }
      const continuationTask = requestedContinuationTask || checkpoint.state.task;
      const continuationTaskChanged = continuationTask !== checkpoint.state.task;
      const resumedState = workspaceRebased
        ? prepareReactWorkspaceRebaseState(checkpoint.state, freshStepBudget)
        : prepareReactResumeState(checkpoint.state, freshStepBudget);
      resumedState.task = continuationTask;
      const continuationHandoff = createContinuationHandoff({
        parentRunId: prior.id,
        reason: continuationReason,
        state: { ...checkpoint.state, task: continuationTask },
        includesParentSteps: !workspaceRebased,
        workspaceRebased,
      });
      const resumedPacingProfile = req.body?.pacingProfile ||
        metadata?.pacingProfile ||
        checkpoint.state.pacingProfile;
      // Preserve provider recovery across continuations regardless of request
      // pacing profile. Fast mode is still allowed to opt out explicitly.
      const effectiveWaitForProviderAvailability = requestedWaitForProviderAvailability;
      const resumeFallbackPolicy = {
        ...(typeof req.body?.allowCrossProviderFallback === 'boolean'
          ? { allowCrossProviderFallback: req.body.allowCrossProviderFallback }
          : {}),
        ...(typeof req.body?.fallbackApprovalGranted === 'boolean'
          ? { fallbackApprovalGranted: req.body.fallbackApprovalGranted }
          : {}),
        ...(Array.isArray(req.body?.approvedFallbackProviders)
          ? { approvedFallbackProviders: req.body.approvedFallbackProviders.filter((value: unknown): value is string => typeof value === 'string') }
          : {}),
        ...(Array.isArray(req.body?.allowedExternalProviders)
          ? { allowedExternalProviders: req.body.allowedExternalProviders.filter((value: unknown): value is string => typeof value === 'string') }
          : {}),
      };
      resumedState.continuationHandoff = continuationHandoff;
      const run = startReactRunFromBody({
        kind: prior.kind,
        task: resumedState.task,
        workspace: resumedState.workspace,
        model: requestedModel,
        geminiProfileId: requestedGeminiProfileId,
        requestBudgetEnabled: requestedBudgetEnabled,
        replayGuardEnabled: requestedReplayGuardEnabled,
        waitForProviderAvailability: effectiveWaitForProviderAvailability,
        pacingProfile: resumedPacingProfile,
        threadId: targetThreadId,
        attemptIndex: continuationAttemptIndex,
        metadata: {
          ...metadata,
          ...(workspaceRebased || continuationTaskChanged ? { taskAnalysis: undefined } : {}),
          ...(continuationTaskChanged ? { displayTask: requestedContinuationDisplayTask || continuationTask } : {}),
          ...resumeFallbackPolicy,
          // The resumed run's model is authoritative. Do not let a stale
          // recoveryModel silently override it in startReactRunFromBody.
          recoveryModel: undefined,
          pacingProfile: resumedPacingProfile,
          parentRunId: prior.id,
          attemptIndex: continuationAttemptIndex,
          parentModel: prior.model,
          parentGeminiProfileId: typeof metadata?.providerProfile === 'string' ? metadata.providerProfile : undefined,
          requestedModel,
          requestedGeminiProfileId,
          requestBudgetEnabled: requestedBudgetEnabled,
          replayGuardEnabled: requestedReplayGuardEnabled,
          waitForProviderAvailability: effectiveWaitForProviderAvailability,
          modelChangedOnResume: requestedModel !== priorActiveModel,
          geminiProfileChangedOnResume: requestedGeminiProfileId !== metadata?.providerProfile,
          continuationReason,
          continuationHandoff,
          workspaceRebased,
        },
        maxSteps: resumedState.max_steps,
        executionStepWindow: freshStepBudget,
        budget: resumedState.budget,
        resumeState: resumedState,
        ...resumeFallbackPolicy,
      }, prior.kind as ServerRunKind);
      if (runManager.getChildRun(prior.id)) {
        runManager.inheritChildLineage(prior.id, run.id);
      }
      res.json({ runId: run.id, run, resumedFrom: prior.id, continuationHandoff, workspaceRebased });
    } catch (error: any) {
      const message = sanitizeError(error.message || String(error));
      const invalidSelection = /Gemini model target .* (?:is not configured|cannot be used)|Gemini profile .* is not configured or enabled/i.test(message);
      res.status(invalidSelection ? 400 : 500).json({ error: message });
    }
  });

  router.get('/api/runs/:runId/stream', async (req, res) => {
    try {
      const afterSeq = Number.parseInt(String(req.query.afterSeq || '0'), 10) || 0;
      const subscribed = runManager.subscribe(req.params.runId, res, afterSeq);
      if (!subscribed && !res.headersSent) {
        res.status(404).json({ error: 'Run not found' });
      }
    } catch (error: any) {
      if (!res.headersSent) res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  // Deprecated blocking compatibility route. New clients should use
  // POST /api/runs and its event stream, or the streaming /api/react/stream route.
  router.post('/api/react', async (req, res) => {
    res.setHeader('X-Deprecated', 'true');
    try {
      const {
        task, maxSteps, model, budget, workspace, thinkingDepth, geminiProfileId,
        allowedExternalProviders, privateWorkspace, sendPrivateSourceCode,
      } = req.body;
      const workspaceRoot = await ensureWorkspaceRoot(workspace);
      const repositoryCommitHash = await getRepositoryCommitHash(workspaceRoot);
      const taskMessage = typeof task === 'string' ? task : '';
      // The legacy non-streaming route must use the same workspace evidence as
      // managed/streaming runs. Without the file map, a requested new file
      // (for example TODO.md) is incorrectly classified as a modification and
      // the guarded Write action can never create it.
      const projectFileMap = await buildCoderProjectFileMap(workspaceRoot, taskMessage).catch(() => undefined);
      const taskAnalysis = analyzeCoderTask({
        message: taskMessage,
        mode: 'agent',
        workspace: workspaceRoot,
        projectFileMap,
        approvalPolicy: 'ask',
      });
      const taskRouting = createRuntimeTaskRouting(
        taskMessage,
        taskAnalysis.affectedFiles.map((file) => file.path),
      );
      const selectedGeminiProfileId = selectGeminiProfileId({
        workspace: workspaceRoot,
        taskProfileId: typeof geminiProfileId === 'string' ? geminiProfileId : undefined,
      });
      const requestedModel = typeof model === 'string' && model.trim()
        ? normalizeCoderModelSelection(model)
        : getConfiguredCoderModelSelection();
      const selectedModel = taskAnalysis.expectedChangeIntent === 'read_only'
        ? requestedModel
        : resolveToolCapableModel(
            taskMessage,
            requestedModel,
            taskAnalysis.affectedFiles.map((file) => file.path),
          ).model;
      const sameProviderFallbackModels = selectedModel.startsWith('gemini')
        ? getGeminiSameProviderFallbackModelIds(selectedModel)
        : [];
      const engine = new ReActEngine({
        maxSteps: maxSteps || 10,
        model: selectedModel,
        plannerModel: selectedModel,
        thinkingDepth,
        budget: budget || 100,
        workspace: workspaceRoot,
        repositoryCommitHash,
        geminiProfileId: selectedGeminiProfileId,
        allowCrossProviderFallback: false,
        approvedFallbackProviders: [],
        sameProviderFallbackModels,
        fallbackApprovalGranted: false,
        allowedExternalProviders: Array.isArray(allowedExternalProviders)
          ? allowedExternalProviders.filter((value): value is string => typeof value === 'string')
          : undefined,
        privateWorkspace: privateWorkspace === true,
        sendPrivateSourceCode: sendPrivateSourceCode === true,
        taskAnalysis,
        taskRouting,
        verbose: true
      });
      const result = await engine.run(task);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message) });
    }
  });

  router.post('/api/react/stream', async (req, res) => {
    try {
      const kind = req.body?.kind === 'coder' || req.body?.kind === 'app' ? req.body.kind : 'react';
      const run = startReactRunFromBody(req.body, kind);
      runManager.subscribe(run.id, res, 0);
    } catch (error: any) {
      if (!res.headersSent) {
        const status = Number(error?.statusCode) === 409 ? 409 : 500;
        res.status(status).json({
          error: sanitizeError(error.message || String(error)),
          ...(status === 409 && error?.activeRunId ? { activeRunId: error.activeRunId, reused: true } : {}),
        });
      }
    }
  });

  // Lightweight, canonical JSON view for the legacy ReAct run audit panel.
  router.get('/api/run-audits', async (req, res) => {
    try {
      const { getRecentThreadHeaders } = await import('../react/logger.js');
      const requestedLimit = Number.parseInt(String(req.query.limit || '50'), 10);
      const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(500, requestedLimit)) : 50;
      const threads = await getRecentThreadHeaders(limit);
      const headers = threads.map((thread) => {
        const latest = thread.runs[thread.runs.length - 1];
        if (!latest) return { ...thread, runs: [] };
        const performanceSummary = thread.performanceSummary || thread.runs.reduce((summary, run) => {
          const trace = run.performanceTrace && typeof run.performanceTrace === 'object'
            ? run.performanceTrace as { durationMs?: unknown; counters?: Record<string, unknown> }
            : undefined;
          const counters = trace?.counters || {};
          const inputTokens = Number(counters.llm_input_tokens) || 0;
          const outputTokens = Number(counters.llm_output_tokens) || 0;
          const totalTokens = Number(counters.llm_total_tokens) || inputTokens + outputTokens;
          const durationMs = Number(trace?.durationMs) || 0;
          return {
            durationMs: summary.durationMs + (Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0),
            tokens: summary.tokens + (Number.isFinite(totalTokens) && totalTokens > 0 ? totalTokens : 0),
          };
        }, { durationMs: 0, tokens: 0 });
        const { steps: _steps, finalAnswer: _finalAnswer, error: _error, ...latestSummary } = latest;
        return {
          ...thread,
          threadTitle: String(thread.threadTitle || latest.threadTitle || latest.task).slice(0, 200),
          filesChanged: thread.filesChanged.slice(0, 100),
          performanceSummary,
          runs: [{
            ...latestSummary,
            task: latest.task.slice(0, 500),
            threadTitle: String(latestSummary.threadTitle || '').slice(0, 200),
            steps: [],
          }],
        };
      });
      res.json({ threads: headers, pagination: { limit, returned: headers.length } });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  // Preserve the legacy path while keeping one implementation of the JSON list.
  router.get('/api/react/threads', (req, res) => {
    const query = typeof req.url === 'string' && req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(307, `/api/run-audits${query}`);
  });

  router.get('/api/react/threads/:threadId/runs/:runId/steps', async (req, res) => {
    try {
      const { getRunAuditSteps } = await import('../react/logger.js');
      const offset = parseRunCursor(req.query.offset);
      const limit = parseRunPageSize(req.query.limit, 100, 200);
      const page = await getRunAuditSteps(req.params.threadId, req.params.runId, limit, offset);
      if (!page) {
        res.status(404).json({ error: 'Audit run not found.' });
        return;
      }
      res.json(page);
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.get('/api/react/threads/:threadId', async (req, res) => {
    try {
      const { getThreadAuditPage } = await import('../react/logger.js');
      const offset = parseRunCursor(req.query.offset);
      const limit = parseRunPageSize(req.query.limit, 20, 50);
      const stepLimit = parseRunPageSize(req.query.stepLimit, 100, 200);
      const page = await getThreadAuditPage(req.params.threadId, limit, offset);
      if (!page) {
        res.status(404).json({ error: 'Thread audit not found.' });
        return;
      }
      const runs = page.thread.runs.map((run) => {
        const stepCount = run.steps.length;
        const stepEnd = stepCount;
        const stepStart = Math.max(0, stepEnd - stepLimit);
        return {
          ...run,
          steps: run.steps.slice(stepStart, stepEnd),
          stepsPagination: {
            offset: 0,
            limit: stepLimit,
            total: stepCount,
            hasMore: stepStart > 0,
            nextOffset: stepEnd - stepStart,
          },
        };
      });
      res.json({
        thread: { ...page.thread, runs },
        pagination: page.pagination,
      });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  // API Route to fetch past logged audit runs (legacy flat view)
  router.get('/api/react/logs', async (req, res) => {
    try {
      const { getPastRuns } = await import('../react/logger.js');
      const runs = await getPastRuns();
      res.json({ runs });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  // API Route to fetch raw text log
  router.get('/api/react/logs/raw', async (req, res) => {
    try {
      const { getRawLogFile } = await import('../react/logger.js');
      const content = await getRawLogFile();
      res.type('text/plain').send(content);
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  // API Route to clear all runs/logs
  router.post('/api/react/logs/clear', async (req, res) => {
    try {
      const { clearAllLogs } = await import('../react/logger.js');
      await clearAllLogs();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error?.message || String(error)) });
    }
  });

  return router;
}
