import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { AgentTimeline } from '../../ui/src/components/AgentTimeline';
import { OrchestrationCenter } from '../../ui/src/components/OrchestrationCenter';
import { CoderChatPanel, CooldownCountdownBadge, deriveRunTokenMetrics, estimateActivePromptTokens, getAgentEventOutcome, getCoderChangeSummary, getRunFileChangeReviews, isRenderableAgentEvent, type CoderThreadMessage } from '../../ui/src/components/CoderChatPanel';
import { getRunTokenUsage, getRunTokensPerSecond } from '../../ui/src/components/RunAuditsPanel';
import { ConsoleRunPanel } from '../../ui/src/components/ConsoleRunPanel';
import { HarnessCodingChatSection, deriveHarnessStages } from '../../ui/src/components/HarnessCodingChatSection';
import { auditStepFailed } from '../../ui/src/utils/runOutcomes';
import { RepoMapPanel } from '../../ui/src/components/RepoMapPanel';
import { buildCoderThreadMemoryPrompt, buildLatestCoderContinuationPrompt } from '../../ui/src/utils/coderThreadMemory';
import { ContinuationRunPreview } from '../../ui/src/components/ContinuationRunPreview';
import { selectSessionContinuationRun } from '../../ui/src/utils/sessionContinuation';
import { eventBody, eventTitle, formatAgentError } from '../../ui/src/utils/agentEventMessages';

describe('migrated UI panels', () => {
  it('keeps Explorer navigation focused on the four canonical workspaces', () => {
    const source = readFileSync(join(process.cwd(), 'ui', 'src', 'App.tsx'), 'utf8');
    const styleSource = readFileSync(join(process.cwd(), 'ui', 'src', 'index.css'), 'utf8');
    const settingsSource = readFileSync(join(process.cwd(), 'ui', 'src', 'components', 'SettingsModal.tsx'), 'utf8');
    expect(source).toContain('{ id: "coder", label: "Coder Chat"');
    expect(source).toContain('{ id: "tests", label: "Test Suite"');
    expect(source).toContain('{ id: "structure", label: "Structure"');
    expect(source).toContain('{ id: "audits", label: "Run Audits"');
    expect(source).not.toContain('activeTab === "studio"');
    expect(source).not.toContain('activeTab === "api"');
    expect(source).not.toContain('activeTab === "agents"');
    expect(source).toContain('data-testid="workspace-tabs"');
    expect(source).toContain('role="tablist"');
    expect(source).toContain('aria-selected={activeTab === tab.id}');
    expect(source).toContain('data-testid="workspace-footer"');
    expect(styleSource).toContain('--font-sans: "Inter"');
    expect(styleSource).toContain('--font-display: "Space Grotesk"');
    expect(styleSource).toContain('--font-mono: "JetBrains Mono"');
    expect(styleSource).toContain('--color-bg-main: #0a0a0b');
    expect(styleSource).toContain('--color-bg-panel: #0f0f10');
    expect(source).toContain('<OrchestrationCenter');
    expect(settingsSource).toContain('ModelCapabilitiesPanel');
    expect(settingsSource).toContain('label: "Interface & Display"');
    expect(settingsSource.indexOf('label: "Interface & Display"')).toBeLessThan(settingsSource.indexOf('label: "Engine & Runtime"'));
    expect(source).toContain('handleWorkspaceSelection');
    expect(source).not.toContain('/api/generate');
    expect(source).not.toContain('/api/verification/stream');
    expect(source).toContain('execution.outputs.verificationResults');
  });

  it('keeps Structure on guarded canonical workspace file routes', () => {
    const structureSource = readFileSync(join(process.cwd(), 'ui', 'src', 'StructureExplorer.tsx'), 'utf8');
    const serverSource = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');
    const workspaceRouteSource = readFileSync(join(process.cwd(), 'src', 'routes', 'workspace.ts'), 'utf8');

    expect(structureSource).toContain('/api/workspace/tree');
    expect(structureSource).toContain('/api/workspace/file');
    expect(structureSource).toContain('onDirtyChange');
    expect(structureSource).toContain("method: 'PUT'");
    expect(structureSource).toContain('expectedHash');
    expect(structureSource).toContain('structure-file-editor');
    expect(structureSource).toContain('File changed on disk');
    expect(structureSource).not.toContain('/api/structure');
    expect(structureSource).not.toContain('/api/file/read');
    expect(structureSource).not.toContain('/api/file/write');
    expect(serverSource).toContain('createWorkspaceRouter');
    expect(workspaceRouteSource).toContain("router.put('/api/workspace/file'");
    expect(workspaceRouteSource).toContain('status(409)');
    expect(workspaceRouteSource).toContain('createHash');
  });

  it('keeps API Pool and delegation settings on server-authoritative contracts', () => {
    const apiPoolSource = readFileSync(join(process.cwd(), 'ui', 'src', 'components', 'APICheckerComponent.tsx'), 'utf8');
    const delegationSource = readFileSync(join(process.cwd(), 'ui', 'src', 'components', 'DelegationSettingsPanel.tsx'), 'utf8');

    expect(apiPoolSource).toContain('/api/gemini/pool-status');
    expect(apiPoolSource).toContain('/api/gemini/validate');
    expect(apiPoolSource).toContain('/api/gemini/model-targets');
    expect(apiPoolSource).toContain('/api/nvidia/model-targets');
    expect(apiPoolSource).toContain('/api/openrouter/model-targets');
    expect(apiPoolSource).toContain('/api/providers/rate-limits');
    expect(apiPoolSource).toContain('Last 5 characters of the API key');
    expect(apiPoolSource).toContain('Test ${targetId}');
    expect(delegationSource).toContain('/api/delegation/settings');
    expect(delegationSource).toContain('Save delegation chart');
    expect(delegationSource).not.toContain('localStorage');
  });

  it('exposes a sanitized health contract for shell and smoke checks', () => {
    const serverSource = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');
    const systemRouteSource = readFileSync(join(process.cwd(), 'src', 'routes', 'system.ts'), 'utf8');
    expect(serverSource).toContain('createSystemRouter');
    expect(systemRouteSource).toContain("router.get('/api/health'");
    expect(systemRouteSource).toContain('ok: true');
    expect(systemRouteSource).toContain('status: \'ok\'');
    expect(systemRouteSource).toContain('process.uptime()');
    expect(systemRouteSource).toContain('process.pid');
  });

  it('derives per-run token use and context availability from live and completed telemetry', () => {
    expect(deriveRunTokenMetrics({
      liveState: {
        runTokenUsage: {
          inputTokens: 1200,
          outputTokens: 300,
          totalTokens: 1500,
          estimatedContextTokens: 4000,
          contextWindow: 10000,
          contextRemainingTokens: 6000,
          contextUsedPercent: 40,
        },
      },
      fallbackContextTokens: 10,
      fallbackContextWindow: 20,
    })).toMatchObject({
      totalTokens: 1500,
      contextRemainingTokens: 6000,
      contextUsedPercent: 40,
      hasContextWindow: true,
      hasRunUsage: true,
    });

    expect(deriveRunTokenMetrics({
      result: {
        performanceTrace: {
          counters: {
            llm_input_tokens: 800,
            llm_output_tokens: 200,
            estimated_context_tokens: 2500,
            model_context_window_tokens: 8000,
          },
        },
      },
      fallbackContextTokens: 10,
      fallbackContextWindow: 20,
    })).toMatchObject({
      totalTokens: 1000,
      contextRemainingTokens: 5500,
      contextUsedPercent: 31.25,
      hasContextWindow: true,
      hasRunUsage: true,
    });

    expect(deriveRunTokenMetrics({
      liveState: { runTokenUsage: { estimatedContextTokens: 1200 } },
      fallbackContextTokens: 10,
      fallbackContextWindow: 0,
    })).toMatchObject({
      contextWindow: 0,
      contextRemainingTokens: 0,
      hasContextWindow: false,
    });

    expect(deriveHarnessStages(
      'Implement the feature.',
      [{ type: 'verification_result', success: false, output: 'test failed' }],
      false,
      { success: false, executionCompleted: true, verificationStatus: 'failed' },
    )[4]).toMatchObject({ status: 'complete', detail: 'Final result recorded' });
  });

  it('calculates audit throughput only when persisted tokens and duration are available', () => {
    const run = {
      id: 'audit-throughput-run',
      performanceTrace: {
        name: 'audit-throughput',
        durationMs: 2000,
        counters: { llm_input_tokens: 600, llm_output_tokens: 400 },
      },
    } as Parameters<typeof getRunTokenUsage>[0];

    expect(getRunTokenUsage(run)).toBe(1000);
    expect(getRunTokensPerSecond(run)).toBe(500);
    expect(getRunTokensPerSecond({
      ...run,
      performanceTrace: { ...run.performanceTrace, durationMs: 0 },
    })).toBeUndefined();
    expect(getRunTokensPerSecond({
      ...run,
      performanceTrace: undefined,
    })).toBeUndefined();
  });

  it('keeps composer collapse as a state-preserving docked affordance', () => {
    const coderSource = readFileSync(join(process.cwd(), 'ui', 'src', 'components', 'CoderChatPanel.tsx'), 'utf8');
    expect(coderSource).toContain('isComposerCollapsed');
    expect(coderSource).toContain('data-testid="coder-composer-collapse-toggle"');
    expect(coderSource).toContain('aria-expanded={!isComposerCollapsed}');
    expect(coderSource).toContain("isComposerCollapsed ? ' hidden' : ''");
    expect(coderSource).toContain('coder-composer-collapsed');
  });

  it('keeps audit cost semantics separate from token and throughput summaries', () => {
    const auditsSource = readFileSync(join(process.cwd(), 'ui', 'src', 'components', 'RunAuditsPanel.tsx'), 'utf8');
    expect(auditsSource).toContain('label="Pollen expenditure"');
    expect(auditsSource).toContain('detail="pollen"');
    expect(auditsSource).toContain('label="Total token usage"');
    expect(auditsSource).toContain('formatTokensPerSecond');
    expect(auditsSource).toContain('["tokens", "Token usage"]');
    expect(auditsSource).toContain('["cost", "Pollen cost"]');
  });

  it('provides a workspace project-guide editor backed by the agent wiki reference', () => {
    const source = readFileSync(
      join(process.cwd(), 'ui', 'src', 'components', 'KnowledgeSettingsPanel.tsx'),
      'utf8'
    );

    expect(source).toContain('Project guide');
    expect(source).toContain('Project guide Markdown');
    expect(source).toContain("fetch('/api/workspace-guide'");
    expect(source).toContain("setGuideMode('preview')");
    expect(source).toContain('Enable web search');
    expect(source).toContain('webSearchEnabled');
  });
  it('classifies timeline events independently instead of inheriting the run status', () => {
    expect(getAgentEventOutcome({ type: 'file_read', path: 'src/index.ts' })).toBe('completed');
    expect(getAgentEventOutcome({ type: 'model_response', message: 'I am inspecting the file.', provider: 'gemini', model: 'gemini-3.5-flash', phase: 'planning' })).toBe('completed');
    expect(getAgentEventOutcome({ type: 'reasoning_start', id: 'r1', provider: 'gemini', model: 'gemini-3.5-flash', phase: 'planning', visibility: 'collapsed', source: 'model' })).toBe('started');
    expect(getAgentEventOutcome({ type: 'reasoning_delta', id: 'r1', provider: 'gemini', model: 'gemini-3.5-flash', phase: 'planning', source: 'provider', delta: 'Inspecting the target.' })).toBe('completed');
    expect(getAgentEventOutcome({ type: 'decision_record', record: { id: 'd1', step: 1, provider: 'gemini', model: 'gemini-3.5-flash', action: { action: 'Read', action_input: {} }, reasoningVisibility: 'collapsed', reasoningSource: 'model', status: 'succeeded' } })).toBe('completed');
    expect(getAgentEventOutcome({ type: 'tool_started', tool: 'Read' })).toBe('started');
    expect(getAgentEventOutcome({ type: 'verification_result', success: false, output: 'test failed' })).toBe('failed');
    expect(getAgentEventOutcome({ type: 'error', message: 'All providers failed' })).toBe('failed');
    expect(getAgentEventOutcome({ type: 'provider_attempt_failed', message: 'Provider timed out', recoverable: true })).toBe('info');
    expect(getAgentEventOutcome({ type: 'retrying', attempt: 1, message: 'Retrying from checkpoint step 3.' })).toBe('info');
    expect(getAgentEventOutcome({ type: 'package_install_started', manager: 'npm', packages: ['@eslint/js'], dev: true, command: 'npm install --save-dev @eslint/js' })).toBe('started');
    expect(getAgentEventOutcome({ type: 'package_install_result', success: true, manager: 'npm', requestedPackages: ['@eslint/js'], verifiedPackages: ['@eslint/js'], missingPackages: [], exitCode: 0 })).toBe('completed');
    expect(getAgentEventOutcome({ type: 'package_install_result', success: false, manager: 'npm', requestedPackages: ['@eslint/js'], verifiedPackages: [], missingPackages: ['@eslint/js'], exitCode: 1 })).toBe('failed');
  });

  it('uses the same event copy in the console stream and the conversational UI', () => {
    const event = { type: 'tool_started', tool: 'Read', input: { file_path: 'src/index.ts' } } as const;
    const html = renderToStaticMarkup(React.createElement(ConsoleRunPanel, {
      agentEvents: [event],
      loading: true,
      task: 'Inspect the project',
      model: 'gemini-3.5-flash',
    }));

    expect(html).toContain(eventTitle(event));
    expect(html).toContain('src/index.ts');
    expect(formatAgentError('socket hang up', 'RUN_STREAM_DISCONNECTED')).toContain('Live run connection lost');
  });

  it('shows the provider issue and retry pause in the conversational thread', () => {
    const html = renderToStaticMarkup(React.createElement(CoderChatPanel, {
      task: 'Retry after a provider issue.',
      model: 'openrouter:z-ai/glm-5.2:free',
      loading: false,
      liveProgress: '',
      liveState: null,
      result: null,
      workspace: '',
      thread: [{
        id: 'provider-pause',
        role: 'assistant',
        status: 'error',
        content: 'The provider was temporarily unavailable.',
        createdAt: 1710000000000,
        agentEvents: [
          {
            type: 'provider_attempt_failed',
            message: 'All LLM providers failed:\n- openrouter | model "z-ai/glm-5.2:free" | provider key pool: upstream shared pool rate-limited',
            recoverable: true,
          },
          {
            type: 'cooldown_waiting',
            attempt: 1,
            delayMs: 5_000,
            waitingUntil: 1710000005000,
            provider: 'openrouter',
            model: 'z-ai/glm-5.2:free',
            providerError: 'HTTP 429 from OpenRouter\nRetry after: 5',
            message: 'OpenRouter is temporarily unavailable. The run is paused.',
          },
          {
            type: 'retrying',
            attempt: 1,
            message: 'Provider cooldown ended. Resuming from the saved action checkpoint.',
          },
        ],
      }],
      canContinue: false,
      onTaskChange: () => undefined,
      onModelChange: () => undefined,
      onRunTask: () => undefined,
      onGenerateWorkPlan: () => undefined,
      onContinue: () => undefined,
      onStartNew: () => undefined,
    }));

    expect(html).toContain('Provider issue detected');
    expect(html).toContain('upstream shared pool rate-limited');
    expect(html).toContain('Run paused for provider availability');
    expect(html).toContain('Automatic retry in 5 seconds');
    expect(html).toContain('Provider error details');
    expect(html).toContain('thread-provider-pause');
  });

  it('collects added and removed lines from the latest run file diffs', () => {
    const reviews = getRunFileChangeReviews([
      {
        type: 'file_changed',
        path: 'ui/src/App.tsx',
        diff: '--- before\n+++ after\n-old value\n+new value',
      },
      {
        type: 'file_changed',
        path: 'ui/src/App.tsx',
        diff: '--- before\n+++ after\n+another line',
      },
    ]);

    expect(reviews['ui/src/App.tsx']).toEqual({
      addedLines: ['new value', 'another line'],
      removedLines: ['old value'],
    });
  });

  it('derives the compact chat change summary from persisted files and diffs', () => {
    expect(getCoderChangeSummary({
      filesChanged: ['server.ts', 'ui/src/App.tsx'],
      agentEvents: [{
        type: 'file_changed',
        path: 'server.ts',
        diff: '--- before\n+++ after\n-old value\n+new value\n+another line',
      }],
    })).toEqual({
      files: [
        { path: 'server.ts', addedLines: 2, removedLines: 1 },
        { path: 'ui/src/App.tsx', addedLines: 0, removedLines: 0 },
      ],
      addedLines: 2,
      removedLines: 1,
    });
  });

  it('renders a completed coder result as one chat reply with review controls', () => {
    const html = renderToStaticMarkup(React.createElement(CoderChatPanel, {
      task: 'Update the chat result surface.',
      model: 'openai-fast',
      loading: false,
      liveProgress: '',
      liveState: null,
      result: { success: true, finalAnswer: 'Implemented the chat result surface.', steps: [], stepCount: 1 },
      workspace: '',
      thread: [{
        id: 'completed-edit',
        role: 'assistant',
        status: 'success',
        content: 'Implemented the chat result surface.',
        filesChanged: ['server.ts', 'ui/src/App.tsx'],
        agentEvents: [{
          type: 'file_changed',
          path: 'server.ts',
          diff: '--- before\n+++ after\n-old value\n+new value\n+another line',
        }],
        createdAt: 1710000000000,
      }],
      canContinue: false,
      onTaskChange: () => undefined,
      onModelChange: () => undefined,
      onRunTask: () => undefined,
      onGenerateWorkPlan: () => undefined,
      onContinue: () => undefined,
      onStartNew: () => undefined,
      onUndoChanges: () => undefined,
    }));

    expect(html).toContain('coder-change-summary');
    expect(html).toContain('Edited 2 files');
    expect(html).toContain('+2');
    expect(html).toContain('-1');
    expect(html).toContain('Review');
    expect(html).toContain('Undo');
    expect(html).not.toContain('Final Result');
  });

  it('ignores partial persisted agent events instead of calling string methods on missing fields', () => {
    expect(isRenderableAgentEvent(undefined)).toBe(false);
    expect(isRenderableAgentEvent({ message: 'legacy event without a type' })).toBe(false);

    const thread = [{
      id: 'legacy-events',
      role: 'assistant' as const,
      status: 'error' as const,
      content: 'The saved run contains a partial legacy event.',
      createdAt: 1710000000000,
      agentEvents: [
        { message: 'missing type' },
        { type: 'model_response' },
        { type: 'error', message: 'Run failed safely' },
      ],
    }] as unknown as CoderThreadMessage[];

    expect(() => renderToStaticMarkup(
      React.createElement(CoderChatPanel, {
        task: '',
        model: 'openai-fast',
        loading: false,
        liveProgress: '',
        liveState: null,
        result: null,
        workspace: '',
        thread,
        canContinue: false,
        onTaskChange: () => undefined,
        onModelChange: () => undefined,
        onRunTask: () => undefined,
        onGenerateWorkPlan: () => undefined,
        onContinue: () => undefined,
        onStartNew: () => undefined,
        onClearThread: () => undefined,
      })
    )).not.toThrow();
  });

  it('uses structured audit success before legacy error-word matching', () => {
    expect(auditStepFailed(JSON.stringify({ success: true, output: 'No errors found' }))).toBe(false);
    expect(auditStepFailed(JSON.stringify({ success: false, error: 'rate limited' }))).toBe(true);
    expect(auditStepFailed('Tool execution failed: HTTP 429')).toBe(true);
  });

  it('shows the user request and loop context beside the visible agent response', () => {
    const thread = [{
      id: 'context-linked-response',
      role: 'assistant' as const,
      status: 'success' as const,
      content: 'The run completed.',
      createdAt: 1710000000000,
      agentEvents: [{
        type: 'model_response' as const,
        message: 'I am inspecting the requested file before editing.',
        provider: 'openai',
        model: 'planner',
        phase: 'planning' as const,
        context: {
          userRequest: 'Please inspect the requested file and update the implementation.',
          loopState: 'inspect',
          trigger: 'user_request' as const,
          latestEvidence: 'Read passed | target exists',
        },
      }],
    }] as unknown as CoderThreadMessage[];

    const html = renderToStaticMarkup(React.createElement(CoderChatPanel, {
      task: 'Please inspect the requested file and update the implementation.',
      model: 'openai-fast',
      loading: false,
      liveProgress: '',
      liveState: null,
      result: null,
      workspace: '',
      thread,
      canContinue: false,
      onTaskChange: () => undefined,
      onModelChange: () => undefined,
      onRunTask: () => undefined,
      onGenerateWorkPlan: () => undefined,
      onContinue: () => undefined,
      onStartNew: () => undefined,
      onClearThread: () => undefined,
    }));

    expect(html).toContain('I am inspecting the requested file before editing.');
    expect(html).toContain('Thought before action');
  });

  it('renders the complete safe action summary instead of replacing it with a shorter provider summary', () => {
    const html = renderToStaticMarkup(React.createElement(CoderChatPanel, {
      task: 'Update the requested feature.',
      model: 'openai-fast',
      loading: false,
      liveProgress: '',
      liveState: null,
      result: null,
      workspace: '',
      thread: [{
        id: 'full-safe-summary',
        role: 'assistant',
        status: 'success',
        content: 'Completed.',
        createdAt: 1710000000000,
        agentEvents: [{
          type: 'model_response',
          message: 'I inspected the target and will apply the smallest scoped edit before running the focused verification command.',
          provider: 'gemini',
          model: 'gemini-test',
          phase: 'planning',
          decision: {
            reasoningSummary: 'Inspecting the target.',
            summaryOrigin: 'provider',
          },
        }],
      }],
      canContinue: false,
      onTaskChange: () => undefined,
      onModelChange: () => undefined,
      onRunTask: () => undefined,
      onGenerateWorkPlan: () => undefined,
      onContinue: () => undefined,
      onStartNew: () => undefined,
      onClearThread: () => undefined,
    }));

    expect(html).toContain('I inspected the target and will apply the smallest scoped edit before running the focused verification command.');
    expect(html).toContain('Inspecting the target.');
  });

  it('labels an engine-generated action summary as intent instead of agent thought', () => {
    const html = renderToStaticMarkup(React.createElement(CoderChatPanel, {
      task: 'Inspect the requested file.',
      model: 'openai-fast',
      loading: false,
      liveProgress: '',
      liveState: null,
      result: null,
      workspace: '',
      thread: [{
        id: 'engine-action-summary',
        role: 'assistant',
        status: 'success',
        content: 'Completed.',
        createdAt: 1710000000000,
        agentEvents: [{
          type: 'model_response',
          message: 'I am reading src/index.ts to inspect the current implementation.',
          provider: 'gemini',
          model: 'gemini-test',
          phase: 'planning',
          decision: {
            tool: 'Read',
            summaryOrigin: 'engine',
          },
        }],
      }],
      canContinue: false,
      onTaskChange: () => undefined,
      onModelChange: () => undefined,
      onRunTask: () => undefined,
      onGenerateWorkPlan: () => undefined,
      onContinue: () => undefined,
      onStartNew: () => undefined,
      onClearThread: () => undefined,
    }));

    expect(html).toContain('Action intent');
    expect(html).not.toContain('Thought before action');
  });

  it('maps the coding chat into the harness workflow stages', () => {
    const events = [
      { type: 'run_started' as const, task: 'Update the feature.' },
      { type: 'plan_updated' as const, plan: ['Inspect', 'Implement', 'Verify'] },
      { type: 'tool_started' as const, tool: 'Read' },
      { type: 'tool_result' as const, tool: 'Read', result: '{"success":true}' },
      { type: 'decision_record' as const, record: { id: 'd1', step: 1, provider: 'openai', model: 'planner', action: { action: 'Read', action_input: {} }, reasoningVisibility: 'collapsed', reasoningSource: 'model', status: 'succeeded' as const } },
      { type: 'verification_started' as const, command: 'npm test' },
      { type: 'verification_result' as const, success: true, output: 'passed' },
      { type: 'final' as const, message: 'Completed.' },
    ];
    const stages = deriveHarnessStages('Update the feature.', events, false, { success: true });

    expect(stages.map((stage) => stage.status)).toEqual(['complete', 'complete', 'complete', 'complete', 'complete']);
    expect(deriveHarnessStages('Update the feature.', [{ type: 'tool_started', tool: 'Read' }], true)[2].status).toBe('active');
    expect(deriveHarnessStages('Update the feature.', [{ type: 'error', message: 'failed' }], false, { success: false })[4].status).toBe('blocked');

    const html = renderToStaticMarkup(React.createElement(HarnessCodingChatSection, {
      task: 'Update the feature.',
      events,
      loading: false,
      result: { success: true },
    }));
    expect(html).toContain('Coding Harness');
    expect(html).toContain('Task Input');
    expect(html).toContain('Tool Execution');
    expect(html).toContain('Review');
    expect(html).toContain('Report');
  });

  it('sources Coder provider routes from every API Pool surface', () => {
    const coderSource = readFileSync(join(process.cwd(), 'ui/src/components/CoderChatPanel.tsx'), 'utf8');
    const apiPoolSource = readFileSync(join(process.cwd(), 'ui/src/components/APICheckerComponent.tsx'), 'utf8');
    const modelOptionsSource = readFileSync(join(process.cwd(), 'ui/src/modelOptions.ts'), 'utf8');

    expect(coderSource).toContain("fetch('/api/openrouter/model-targets')");
    expect(coderSource).toContain("fetch('/api/groq/model-targets')");
    expect(coderSource).toContain("model.startsWith('groq:')");
    expect(coderSource).toContain("isLegacyGroqTarget");
    expect(coderSource).toContain('ConsoleRunPanel');
    expect(coderSource).toContain("fetch('/api/kimi/model-targets')");
    expect(coderSource).toContain("fetch('/api/requesty/model-targets')");
    expect(coderSource).toContain("fetch('/api/local-ai/model-targets')");
    expect(coderSource).not.toContain('BUILTIN_NVIDIA_MODEL_OPTIONS');
    expect(coderSource).not.toContain('BUILTIN_OPENROUTER_MODEL_OPTIONS');
    expect(coderSource).not.toContain('POLLINATIONS_TEXT_MODEL_OPTIONS');
    expect(modelOptionsSource).toContain('poolside/laguna-xs-2.1');
    expect(coderSource).not.toContain('Direct Provider Models');
    expect(apiPoolSource).toContain('Groq Provider');
    expect(apiPoolSource).toContain('Kimi API Pool');
    expect(apiPoolSource).toContain('Requesty API Pool');
    expect(apiPoolSource).toContain('Saved to Model Target');
    expect(apiPoolSource).toContain('/api/requesty/test');
    expect(apiPoolSource).toContain('/api/groq/status');
    expect(apiPoolSource).toContain('/api/groq/settings');
    expect(apiPoolSource).toContain('/api/groq/test');
    expect(apiPoolSource).toContain('/api/openrouter/settings');
    expect(apiPoolSource).toContain('/api/openrouter/models');
    expect(apiPoolSource).toContain('/api/openrouter/model-targets');
    expect(apiPoolSource).toContain('OpenRouter Account &amp; Models');
    expect(apiPoolSource).toContain('Add Model');
    expect(apiPoolSource).toContain('Edit Models');
    expect(apiPoolSource).toContain('OpenRouter Model Settings');
    expect(apiPoolSource).toContain('Save Models');
    expect(apiPoolSource).toContain('/api/openrouter/model-targets/" + encodeURIComponent(target.id) + "/test');
    expect(apiPoolSource).toContain('/model-target`');
    expect(coderSource).toContain('provider-model-targets-updated');
    expect(coderSource).toContain('AI workspace activity');
    expect(coderSource).toContain('AI is writing code');
    expect(coderSource).toContain('Free-tier presentation pacing active');
    expect(coderSource).toContain('role="dialog"');
  });

  it('keeps the Run Audits history icon imported from lucide-react', () => {
    const appSource = readFileSync(join(process.cwd(), 'ui/src/App.tsx'), 'utf8');
    const lucideImport = appSource.match(/import\s*\{([\s\S]*?)\}\s*from\s*["']lucide-react["']/)?.[1] || '';

    expect(appSource).toContain('<History');
    expect(lucideImport).toMatch(/\bHistory\b/);
  });

  it('imports the Requesty route icon used by API Pool', () => {
    const apiPoolSource = readFileSync(join(process.cwd(), 'ui/src/components/APICheckerComponent.tsx'), 'utf8');
    const lucideImport = apiPoolSource.match(/import\s*\{([\s\S]*?)\}\s*from\s*["']lucide-react["']/)?.[1] || '';

    expect(apiPoolSource).toContain('<Route');
    expect(lucideImport).toMatch(/\bRoute\b/);
  });

  it('exposes executed commands, file reads, file writes, and tool executions in thread chat', () => {
    const thread: CoderThreadMessage[] = [{
      id: 'thread-events-full-trace',
      role: 'assistant',
      status: 'success',
      content: 'Task completed successfully.',
      createdAt: 1710000000000,
      agentEvents: [
        { type: 'tool_started', tool: 'Read', input: { file_path: 'src/server.ts' } },
        { type: 'file_read', path: 'src/server.ts' },
        { type: 'tool_result', tool: 'Read', result: 'export const port = 3000;' },
        { type: 'tool_started', tool: 'Write', input: { file_path: 'src/server.ts', content: 'export const port = 8080;' } },
        { type: 'file_changed', path: 'src/server.ts', summary: 'Updated port number', diff: '--- src/server.ts\n+++ src/server.ts\n-export const port = 3000;\n+export const port = 8080;' },
        { type: 'tool_result', tool: 'Write', result: '{"success":true,"bytesWritten":26}' },
        { type: 'command_started', command: 'npm test -- --runInBand' },
        { type: 'command_output', command: 'npm test -- --runInBand', output: 'PASS src/server.test.ts (1 test passed)' },
        { type: 'verification_started', command: 'npm test' },
        { type: 'verification_result', success: true, output: 'All 5 checks passed.' },
      ],
    }];

    const html = renderToStaticMarkup(React.createElement(CoderChatPanel, {
      task: 'Update the port in server.ts',
      model: 'openai-fast',
      loading: false,
      liveProgress: '',
      liveState: null,
      result: null,
      workspace: 'c:/Projects/react-engine-077',
      thread,
      canContinue: false,
      onTaskChange: () => undefined,
      onModelChange: () => undefined,
      onRunTask: () => undefined,
      onGenerateWorkPlan: () => undefined,
      onContinue: () => undefined,
      onStartNew: () => undefined,
      onClearThread: () => undefined,
    }));

    // Verify Read file is exposed
    expect(html).toContain('thread-file-read');
    expect(html).toContain('Read file:');
    expect(html).toContain('src/server.ts');

    // Verify File changed / written is exposed with diff
    expect(html).toContain('thread-file-changed');
    expect(html).toContain('Updated port number');
    expect(html).toContain('Show changes / diff');
    expect(html).toContain('export const port = 8080;');

    // Verify the Codex-style tool call row groups parameters and results
    expect(html).toContain('thread-tool-call');
    expect(html).toContain('data-tool-name="Read"');
    expect(html).toContain('data-tool-state="completed"');
    expect(html).toContain('>IN</div>');
    expect(html).toContain('>OUT</div>');
    expect(html).toContain('export const port = 3000;');

    // Verify the safe circular reasoning path and the most important feedback
    expect(html).toContain('agent-reasoning-orbit');
    expect(html).toContain('agent-loop-reason');
    expect(html).toContain('agent-loop-act');
    expect(html).toContain('agent-loop-observe');
    expect(html).toContain('agent-loop-feedback');
    expect(html).toContain('agent-key-feedback');
    expect(html).toContain('data-feedback-type="verification_result"');

    // Verify Command execution and command output is exposed
    expect(html).toContain('thread-command-started');
    expect(html).toContain('npm test -- --runInBand');
    expect(html).toContain('thread-command-output');
    expect(html).toContain('PASS src/server.test.ts');

    // Verify verification checks
    expect(html).toContain('Verification Passed');
    expect(html).toContain('All 5 checks passed.');
  });

  it('renders one current status with a chronological action stack below it', () => {
    const html = renderToStaticMarkup(React.createElement(CoderChatPanel, {
      task: 'Inspect and update the service.',
      model: 'openai-fast',
      loading: false,
      liveProgress: '',
      liveState: null,
      result: null,
      workspace: 'c:/Projects/react-engine-077',
      thread: [{
        id: 'stacked-actions',
        role: 'assistant',
        status: 'success',
        content: 'Action history is available.',
        createdAt: 1710000000000,
        agentEvents: [
          { type: 'model_response', message: 'I will inspect the service.' },
          { type: 'tool_started', tool: 'Read', input: { file_path: 'src/service.ts' } },
          { type: 'tool_result', tool: 'Read', result: '{"success":true}' },
          { type: 'command_started', command: 'npm test' },
          { type: 'command_output', command: 'npm test', output: 'PASS' },
        ],
      }],
      canContinue: false,
      onTaskChange: () => undefined,
      onModelChange: () => undefined,
      onRunTask: () => undefined,
      onGenerateWorkPlan: () => undefined,
      onContinue: () => undefined,
      onStartNew: () => undefined,
      onClearThread: () => undefined,
    }));

    expect((html.match(/data-testid="agent-current-status"/g) || [])).toHaveLength(1);
    expect((html.match(/data-agent-action-stack-item="true"/g) || [])).toHaveLength(4);
    expect(html.indexOf('data-testid="agent-current-status"')).toBeLessThan(html.indexOf('data-testid="agent-action-stack"'));
    expect(html).toContain('Action history');
    expect(html).not.toContain('Live response');
    expect(html).not.toContain('llm-request-pending-banner');
    expect(html).not.toContain('provider-pause-banner');
  });

  it('does not expose another thread continuation in a new session', () => {
    const selected = selectSessionContinuationRun([
      { id: 'latest-legacy', threadId: 'missing-thread', status: 'interrupted' as const },
      { id: 'older-run', threadId: 'active-thread', status: 'interrupted' as const },
    ], 'different-thread', []);

    expect(selected).toBeUndefined();
  });

  it('prefers the newest interrupted run belonging to the open session', () => {
    const selected = selectSessionContinuationRun([
      { id: 'older-session-run', threadId: 'active-thread', status: 'interrupted' as const, createdAt: 100 },
      { id: 'legacy-run', threadId: 'missing-thread', status: 'interrupted' as const, createdAt: 300 },
      { id: 'latest-session-run', threadId: 'active-thread', status: 'interrupted' as const, createdAt: 200 },
    ], 'active-thread', []);

    expect(selected?.id).toBe('latest-session-run');
  });

  it('uses the latest run linked in the active thread instead of an older interrupted task', () => {
    const selected = selectSessionContinuationRun([
      { id: 'first-task', threadId: 'active-thread', status: 'interrupted' as const, createdAt: 100 },
      { id: 'last-task', threadId: 'active-thread', status: 'interrupted' as const, createdAt: 200 },
    ], 'active-thread', [
      { runId: 'first-task' },
      { runId: 'last-task' },
    ]);

    expect(selected?.id).toBe('last-task');
  });

  it('does not resurrect an older interruption after the latest thread run is terminal', () => {
    const selected = selectSessionContinuationRun([
      { id: 'older-interruption', threadId: 'active-thread', status: 'interrupted' as const, createdAt: 100 },
      { id: 'completed-child', threadId: 'active-thread', status: 'completed' as const, createdAt: 200 },
    ], 'active-thread', [
      { runId: 'older-interruption' },
      { runId: 'completed-child' },
    ]);

    expect(selected).toBeUndefined();
  });

  it('continues the latest failed run when the server preserved its checkpoint', () => {
    const selected = selectSessionContinuationRun([
      { id: 'failed-with-checkpoint', threadId: 'active-thread', status: 'failed' as const, createdAt: 300 },
    ], 'active-thread', [{ runId: 'failed-with-checkpoint' }]);

    expect(selected?.id).toBe('failed-with-checkpoint');
  });

  it('allows a completed phased run only when the resumable endpoint marks it eligible', () => {
    const selected = selectSessionContinuationRun([
      {
        id: 'phase-complete',
        threadId: 'active-thread',
        status: 'completed' as const,
        createdAt: 300,
        metadata: { continuationAvailable: true },
      },
    ], 'active-thread', [{ runId: 'phase-complete' }]);

    expect(selected?.id).toBe('phase-complete');
  });

  it('renders continuation evidence in the saved-run preview', () => {
    const html = renderToStaticMarkup(React.createElement(ContinuationRunPreview, {
      preview: {
        currentGoal: 'Finish saved work.',
        remainingPlanItem: 'Implement lineage',
        latestVerifiedCheck: 'unit-tests: npm.cmd test',
        blocker: 'Approval is required',
      },
    }));

    expect(html).toContain('Implement lineage');
    expect(html).toContain('unit-tests: npm.cmd test');
    expect(html).toContain('Approval is required');
  });

  it('renders backend-shaped repo map data', () => {
    const html = renderToStaticMarkup(
      React.createElement(RepoMapPanel, {
        repoMap: {
          frontend: {
            rootDir: 'ui',
            components: ['ui/src/components/CoderChatPanel.tsx'],
            pages: [],
            utilities: [],
            configFiles: [],
          },
          backend: {
            apiRoutes: ['server.ts'],
            services: [],
            dataLayer: [],
            tools: ['src/tools/devTools.ts'],
            configFiles: [],
          },
          tests: { testFiles: ['src/__tests__/uiMigratedPanels.test.ts'], testDirs: ['src/__tests__'] },
          docs: { readmeFiles: ['README.md'], docDirs: ['docs'], apiDocs: [] },
          scripts: { available: ['build', 'test:unit'], categories: {} },
          artifacts: { buildOutputs: ['dist'], coverage: [], logs: ['logs'], cache: [] },
        },
      })
    );

    expect(html).toContain('Repository Map');
    expect(html).toContain('CoderChatPanel.tsx');
    expect(html).toContain('server.ts');
    expect(html).toContain('test:unit');
  });

  it('renders verified agent timeline state', () => {
    const html = renderToStaticMarkup(
      React.createElement(AgentTimeline, {
        executions: [
          {
            taskId: 'task-frontend-1',
            agentRole: 'frontend',
            status: 'verified',
            progress: 100,
            outputs: {
              changedFiles: ['ui/src/App.tsx'],
              commandsRun: ['npm run build'],
              warnings: [],
            },
            errors: [],
            confidence: 0.95,
            attemptNumber: 1,
            verification: {
              gates: [
                { gate: 'no-critical-failures', status: 'pass' },
              ],
            },
          },
        ],
      })
    );

    expect(html).toContain('Agent Execution Timeline');
    expect(html).toContain('Verified');
    expect(html).toContain('ui/src/App.tsx');
    expect(html).toContain('Verification Gates');
  });

  it('renders the thread-scoped orchestration center around existing execution panels', () => {
    const html = renderToStaticMarkup(
      React.createElement(OrchestrationCenter, {
        workPlan: {
          id: 'plan-12345678',
          userRequest: 'Refresh the coder workflow',
          createdAt: 1710000000000,
          estimatedComplexity: 'moderate',
          classification: 'feature',
          touchedLayers: ['frontend', 'tests'],
          targetSurfaces: ['Coder Chat'],
          affectedFiles: ['ui/src/App.tsx'],
          fileOwnership: [{
            file: 'ui/src/App.tsx',
            owner: 'frontend',
            confidence: 'high',
            reason: 'Owns the application shell',
          }],
          executionStrategy: 'sequential',
          canRunParallel: false,
          riskFactors: [],
          safetyScore: 90,
          requiresApproval: true,
        },
        taskExecutionStatus: 'approved',
        selectedTab: 'plan',
        visible: true,
        onToggleVisible: () => undefined,
        onSelectTab: () => undefined,
      }),
    );

    expect(html).toContain('orchestration-center');
    expect(html).toContain('Orchestration center');
    expect(html).toContain('orchestration-tab-execution');
    expect(html).toContain('Full-Stack Task Plan');
    expect(html).toContain('Approve Plan');
  });

  it('renders refreshed coder chat shell with workspace explorer and thread history', () => {
    const thread: CoderThreadMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        status: 'running',
        content: 'Inspect ui/src/components/CoderChatPanel.tsx',
        createdAt: 1710000000000,
      },
      {
        id: 'msg-2',
        role: 'assistant',
        status: 'success',
        content: 'The refreshed Coder Chat keeps the ReAct stream intact.',
        agentEvents: [{
          type: 'package_install_started',
          manager: 'npm',
          packages: ['@eslint/js'],
          dev: true,
          cwd: 'c:/Projects/react-engine-077',
          command: 'npm install --save-dev @eslint/js',
        }, {
          type: 'package_install_result',
          success: true,
          manager: 'npm',
          requestedPackages: ['@eslint/js'],
          verifiedPackages: ['@eslint/js'],
          missingPackages: [],
          cwd: 'c:/Projects/react-engine-077',
          exitCode: 0,
          output: 'added 1 package',
        }, {
          type: 'model_response',
          message: 'I will inspect the current chat surface.',
          provider: 'gemini',
          model: 'gemini-test',
          phase: 'planning',
        }],
        createdAt: 1710000010000,
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(CoderChatPanel, {
        task: 'Inspect ui/src/components/CoderChatPanel.tsx',
        model: 'openai-fast',
        loading: true,
        liveProgress: 'Reading workspace context...',
        liveState: {
          plan: [{ step: 'Inspect current chat surface', status: 'in_progress' }],
          steps: [
            {
              thought: 'Need to inspect the CoderChatPanel component.',
              action: 'Read',
              action_input: { path: 'ui/src/components/CoderChatPanel.tsx' },
            },
          ],
        },
        result: null,
        workspace: 'c:/Projects/react-engine-077',
        thread,
        checkingGemini: false,
        geminiStatus: { configured: true },
        canContinue: false,
        onTaskChange: () => undefined,
        onModelChange: () => undefined,
        onRunTask: () => undefined,
        onGenerateWorkPlan: () => undefined,
        onContinue: () => undefined,
        onStartNew: () => undefined,
        onCheckGemini: () => undefined,
        onClearThread: () => undefined,
      })
    );

    expect(html).toContain('React Engine Explorer');
    expect(html).toContain('Coder Chat');
    expect(html).toContain('Workspace Explorer');
    expect(html).toContain('Workspace');
    expect(html).toContain('ReAct Coder');
    expect(html).toContain('Inspect ui/src/components/CoderChatPanel.tsx');
    expect(html).not.toContain('Agent-led');
    expect(html).not.toContain('Structured');
    expect(html).not.toContain('/api/chat');
    expect(html).not.toContain('/api/structure');
    expect(html).not.toContain('/api/file/read');
    expect(html).not.toContain('/api/file/write');
  });

  it('renders coder chat failure state with continuation controls', () => {
    const html = renderToStaticMarkup(
      React.createElement(CoderChatPanel, {
        task: 'Continue a task that hit the step budget',
        model: 'openai-fast',
        loading: false,
        liveProgress: '',
        liveState: null,
        result: {
          success: false,
          error: 'Max steps exceeded',
          errorCode: 'MAX_STEPS_EXCEEDED',
          steps: [],
          stepCount: 60,
        },
        workspace: '',
        thread: [],
        checkingGemini: false,
        geminiStatus: null,
        canContinue: true,
        onOpenRunAudit: () => undefined,
        onTaskChange: () => undefined,
        onModelChange: () => undefined,
        onRunTask: () => undefined,
        onGenerateWorkPlan: () => undefined,
        onContinue: () => undefined,
        onStartNew: () => undefined,
        onCheckGemini: () => undefined,
        onClearThread: () => undefined,
      })
    );

    expect(html).toContain('Final Result');
    expect(html).toContain('Turn limit reached. Progress was saved and is ready to continue from the checkpoint.');
    expect(html).toContain('Checkpoint saved');
    expect(html).not.toContain('Agent stopped');
    expect(html).toContain('Open execution audit');
    expect(html).toContain('Continue');
    expect(html).toContain('New Task');
  });

  it('keeps successful timeline items separate from the terminal failure', () => {
    const html = renderToStaticMarkup(
      React.createElement(CoderChatPanel, {
        task: 'Inspect and update one file',
        model: 'nvidia-target:0:z-ai%2Fglm-5.2',
        loading: false,
        liveProgress: '',
        liveState: null,
        result: null,
        workspace: '',
        thread: [{
          id: 'failed-run',
          role: 'assistant',
          status: 'error',
          content: 'All providers failed',
          createdAt: 1710000000000,
          agentEvents: [
            {
              type: 'model_response',
              message: 'I’m reading src/index.ts before making the requested change.',
              provider: 'gemini',
              model: 'gemini-3.5-flash',
              phase: 'planning',
              decision: {
                tool: 'Read',
                arguments: { file_path: 'src/index.ts' },
                reasoningSummary: 'I inspected the task context and will read the relevant source file first.',
                rationale: 'I need to inspect initialization before changing it.',
                codingState: 'inspect',
                summaryOrigin: 'model',
                rationaleOrigin: 'model',
              },
            },
            { type: 'file_read', path: 'src/index.ts' },
            { type: 'error', message: 'All providers failed' },
          ],
        }],
        canContinue: false,
        onTaskChange: () => undefined,
        onModelChange: () => undefined,
        onRunTask: () => undefined,
        onGenerateWorkPlan: () => undefined,
        onContinue: () => undefined,
        onStartNew: () => undefined,
      })
    );

    expect(html).toContain('Summary:');
    expect(html).toContain('I inspected the task context and will read the relevant source file first.');
    expect(html).toContain('All providers failed');
    expect(html).not.toContain('System Alert');
  });

  it('renders a saved server run as one-click Session Chat continuation', () => {
    const html = renderToStaticMarkup(
      React.createElement(CoderChatPanel, {
        task: 'Continue the saved task',
        model: 'gemini-3.5-flash',
        loading: false,
        liveProgress: '',
        liveState: null,
        result: null,
        workspace: 'c:/workspace',
        thread: [],
        canContinue: false,
        resumableRun: {
          id: 'saved-run-1',
          status: 'interrupted',
          task: 'Continue the saved task',
        },
        onTaskChange: () => undefined,
        onModelChange: () => undefined,
        onRunTask: () => undefined,
        onGenerateWorkPlan: () => undefined,
        onContinue: () => undefined,
        onResumeServerRun: () => undefined,
        onStartNew: () => undefined,
      })
    );

    expect(html).toContain('Resume Session');
    expect(html).toContain('interrupted');
    expect(html).not.toContain('Continue server run');
  });

  it('estimates the bounded planner prompt instead of rendered event and thread history', () => {
    const thread = Array.from({ length: 80 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 ? 'assistant' as const : 'user' as const,
      content: `Historical UI content ${'error details '.repeat(500)}`,
      createdAt: 1710000000000 + index,
    }));
    const steps = Array.from({ length: 6 }, (_, index) => ({
      thought: `step ${index}`,
      action: 'Read',
      action_input: { file_path: `src/${index}.ts` },
      observation: 'large observation '.repeat(2_000),
    }));

    const estimate = estimateActivePromptTokens(
      thread,
      'Fix the active task',
      'C:/workspace',
      steps,
      [{ step: 'Inspect and repair', status: 'in_progress' }],
      { approvalPolicy: 'full_access', affectedFiles: [] },
    );

    expect(estimate).toBeLessThanOrEqual(8_200);
  });

  it('keeps coder thread memory prompt unchanged for empty or current-only threads', () => {
    const currentRequest = 'Update ui/src/App.tsx';
    const currentOnlyThread: CoderThreadMessage[] = [
      {
        id: 'msg-current',
        role: 'user',
        content: currentRequest,
        createdAt: 1710000000000,
      },
    ];

    expect(buildCoderThreadMemoryPrompt(currentRequest, [])).toBe(currentRequest);
    expect(buildCoderThreadMemoryPrompt(currentRequest, currentOnlyThread)).toBe(currentRequest);
  });

  it('ignores legacy thread messages with missing content instead of calling trim on undefined', () => {
    const malformedThread = [{
      id: 'legacy-message',
      role: 'assistant',
      content: undefined,
      createdAt: 1710000000000,
    }] as unknown as CoderThreadMessage[];

    expect(() => buildCoderThreadMemoryPrompt('Fix the active task.', malformedThread)).not.toThrow();
    expect(buildCoderThreadMemoryPrompt('Fix the active task.', malformedThread)).toBe('Fix the active task.');
  });

  it('renders legacy thread messages with missing content safely', () => {
    const malformedThread = [{
      id: 'legacy-message',
      role: 'assistant',
      content: undefined,
      status: 'success',
      createdAt: 1710000000000,
    }] as unknown as CoderThreadMessage[];

    expect(() => renderToStaticMarkup(
      React.createElement(CoderChatPanel, {
        task: 'Fix the active task.',
        model: 'gemini-3.5-flash',
        loading: false,
        liveProgress: '',
        liveState: null,
        result: null,
        workspace: '',
        thread: malformedThread,
        canContinue: false,
        onTaskChange: () => undefined,
        onModelChange: () => undefined,
        onRunTask: () => undefined,
        onGenerateWorkPlan: () => undefined,
        onContinue: () => undefined,
        onStartNew: () => undefined,
      })
    )).not.toThrow();
  });

  it('renders file-change events without an optional diff safely', () => {
    const event = {
      type: 'file_changed',
      path: 'ui/src/App.tsx',
    } as const;

    expect(() => renderToStaticMarkup(
      React.createElement(CoderChatPanel, {
        task: 'Fix the active task.',
        model: 'gemini-3.5-flash',
        loading: true,
        liveProgress: 'Editing files',
        liveState: null,
        result: null,
        workspace: '',
        thread: [],
        agentEvents: [event],
        canContinue: false,
        onTaskChange: () => undefined,
        onModelChange: () => undefined,
        onRunTask: () => undefined,
        onGenerateWorkPlan: () => undefined,
        onContinue: () => undefined,
        onStartNew: () => undefined,
      })
    )).not.toThrow();
  });

  it('builds coder thread memory with prior context and current request last', () => {
    const thread: CoderThreadMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Inspect ui/src/components/CoderChatPanel.tsx and preserve the thread rail.',
        createdAt: 1710000000000,
      },
      {
        id: 'msg-2',
        role: 'assistant',
        status: 'success',
        content: 'Confirmed the rail uses local threads and should keep /api/react/stream.',
        createdAt: 1710000010000,
      },
    ];
    const currentRequest = 'Now make the agent remember this thread.';
    const prompt = buildCoderThreadMemoryPrompt(currentRequest, thread);

    expect(prompt).toContain('Continuation handoff.');
    expect(prompt).toContain('Inspect ui/src/components/CoderChatPanel.tsx');
    expect(prompt).toContain('/api/react/stream');
    expect(prompt).toContain('- ui/src/components/CoderChatPanel.tsx');
    expect(prompt.endsWith(`Current request:\n${currentRequest}`)).toBe(true);
    expect(prompt).not.toContain('/api/chat');
  });

  it('keeps same-workspace context for definite references to the application', () => {
    const thread: CoderThreadMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Lets continue working on the Pacman game.',
        createdAt: 1710000000000,
      },
      {
        id: 'msg-2',
        role: 'assistant',
        status: 'success',
        content: 'Fixed src/games/pacman/PacManGame.ts and the build now passes.',
        filesChanged: ['src/games/pacman/PacManGame.ts'],
        createdAt: 1710000010000,
      },
    ];

    const prompt = buildCoderThreadMemoryPrompt(
      'can you add documentation how to run the application?',
      thread,
      'C:/workspace',
    );

    expect(prompt).toContain('Continuation handoff.');
    expect(prompt).toContain('Pacman game');
    expect(prompt).toContain('src/games/pacman/PacManGame.ts');
  });

  it('uses the raw user request for relevance when the execution prompt contains analysis metadata', () => {
    const thread: CoderThreadMessage[] = [{
      id: 'msg-1', role: 'user', content: 'Fix the Pacman game loop.', createdAt: 1710000000000,
    }];
    const analyzedPrompt = 'Coder task analysis preflight:\nTask kind: feature\nUser request:\nCreate an unrelated settings dashboard.';

    const prompt = buildCoderThreadMemoryPrompt(
      analyzedPrompt,
      thread,
      'C:/workspace',
      'Create an unrelated settings dashboard.',
    );

    expect(prompt).toContain('New task. Ignore prior execution history');
    expect(prompt).not.toContain('Pacman game loop');
  });

  it('drops stale performance tracker references for unrelated project TODO requests', () => {
    const thread: CoderThreadMessage[] = [
      {
        id: 'msg-1',
        role: 'assistant',
        status: 'success',
        content: 'Prior task touched todo/PERFORMANCE_AND_AGENT_HARDENING_TODO.md.',
        createdAt: 1710000000000,
      },
    ];

    const prompt = buildCoderThreadMemoryPrompt('lets work on Phase 2 Maze & Pellets, update TODO once done', thread);

    expect(prompt).not.toContain('todo/PERFORMANCE_AND_AGENT_HARDENING_TODO.md');
  });

  it('starts unrelated requests with clean execution memory but retains explicit preferences', () => {
    const thread: CoderThreadMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Always use TypeScript. Update the Pacman maze collision logic.',
        createdAt: 1710000000000,
      },
      {
        id: 'msg-2',
        role: 'assistant',
        status: 'success',
        content: 'Changed src/game/maze.ts and verified the collision behavior.',
        filesChanged: ['src/game/maze.ts'],
        createdAt: 1710000010000,
      },
    ];

    const prompt = buildCoderThreadMemoryPrompt('Create a settings dashboard for account preferences.', thread);

    expect(prompt).toContain('New task. Ignore prior execution history');
    expect(prompt).toContain('Always use TypeScript.');
    expect(prompt).not.toContain('src/game/maze.ts');
    expect(prompt).not.toContain('collision behavior');
  });

  it('omits absolute thread-memory paths outside the active workspace', () => {
    const thread: CoderThreadMessage[] = [
      {
        id: 'msg-1',
        role: 'assistant',
        status: 'success',
        content: 'Updated C:\\MPC Project Test\\tank\\src\\App.tsx and C:\\MPC Project Test\\Pacman\\TODO.md.',
        filesChanged: [
          'C:\\MPC Project Test\\tank\\src\\App.tsx',
          'C:\\MPC Project Test\\Pacman\\TODO.md',
        ],
        createdAt: 1710000000000,
      },
    ];

    const prompt = buildCoderThreadMemoryPrompt(
      'continue the Pacman TODO work',
      thread,
      'C:\\MPC Project Test\\Pacman'
    );

    expect(prompt).not.toContain('C:\\MPC Project Test\\tank');
    expect(prompt).toContain('C:\\MPC Project Test\\Pacman\\TODO.md');
  });

  it('uses only the latest status instead of replaying recent turns', () => {
    const thread: CoderThreadMessage[] = Array.from({ length: 8 }, (_, index) => ({
      id: `msg-${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `Turn ${index} content`,
      createdAt: 1710000000000 + index,
    }));

    const prompt = buildCoderThreadMemoryPrompt('Use the recent context.', thread);
    expect(prompt).not.toContain('Recent turns:');
    expect(prompt).not.toContain('Turn 0 content');
    expect(prompt).not.toContain('Turn 2 content');
    expect(prompt).toContain('Turn 7 content');
  });

  it('turns a failed prior run into bounded incremental repair guidance', () => {
    const thread: CoderThreadMessage[] = [
      {
        id: 'msg-user',
        role: 'user',
        content: 'Implement the send button in ui/src/components/SendButton.tsx.',
        createdAt: 1710000000000,
      },
      {
        id: 'msg-run',
        role: 'assistant',
        status: 'error',
        runId: 'run-1',
        content: 'The run failed during verification.',
        filesChanged: ['ui/src/components/SendButton.tsx'],
        agentEvents: [
          { type: 'file_changed', path: 'ui/src/components/SendButton.tsx' },
          { type: 'verification_result', success: false, output: 'Error: click handler did not fire' },
        ],
        createdAt: 1710000010000,
      },
    ];

    const prompt = buildCoderThreadMemoryPrompt(
      'Fix the broken send button without changing the rest of the panel.',
      thread,
      'C:/workspace',
    );

    expect(prompt).toContain('Incremental repair handoff:');
    expect(prompt).toContain('ui/src/components/SendButton.tsx');
    expect(prompt).toContain('click handler did not fire');
    expect(prompt).toContain('focused Edit/minimal patch');
    expect(prompt).toContain('Do not regenerate or rewrite an existing file wholesale');
  });

  it('resumes from the newest user refinement instead of the first chat message', () => {
    const thread: CoderThreadMessage[] = [
      { id: 'user-1', role: 'user', content: 'Build a dashboard.', createdAt: 1 },
      { id: 'assistant-1', role: 'assistant', content: 'The dashboard shell is ready.', createdAt: 2 },
      { id: 'user-2', role: 'user', content: 'Update it to use live API data and add loading states.', createdAt: 3 },
      { id: 'assistant-2', role: 'assistant', content: 'API wiring is partly complete.', createdAt: 4 },
    ];

    const prompt = buildLatestCoderContinuationPrompt('Build a dashboard.', thread);

    expect(prompt.endsWith('Current request:\nUpdate it to use live API data and add loading states.')).toBe(true);
    expect(prompt).toContain('API wiring is partly complete.');
  });

  it('renders live cooldown countdown chip for NVIDIA free-tier key cooldown and throttle retry', () => {
    // 1. Live cooldown badge on free_tier_key_cooldown
    const futureTime = Date.now() + 42_000;
    const cooldownEvent = {
      type: 'pacing_wait' as const,
      profile: 'conservative' as const,
      delayMs: 42_000,
      waitingUntil: futureTime,
      scope: 'free_tier_key_cooldown' as const,
      message: 'Waiting 42.0s for nvidia/meta/llama-3.1-8b key cooldown to clear.',
      provider: 'nvidia',
      model: 'meta/llama-3.1-8b',
    };

    const liveCooldownHtml = renderToStaticMarkup(React.createElement(CooldownCountdownBadge, {
      event: cooldownEvent,
      isLive: true,
    }));
    expect(liveCooldownHtml).toContain('NVIDIA key cooling');
    expect(liveCooldownHtml).toContain('retry in');
    expect(liveCooldownHtml).toContain('data-cooldown-state="cooling"');

    // 2. Ready / ended badge turns green
    const endedCooldownHtml = renderToStaticMarkup(React.createElement(CooldownCountdownBadge, {
      event: cooldownEvent,
      isLive: false,
    }));
    expect(endedCooldownHtml).toContain('Cooldown cleared');
    expect(endedCooldownHtml).toContain('data-cooldown-state="ready"');

    // 3. Engine throttle retry event (Fix C nvidia_cooldown_retry)
    const retryEvent = {
      type: 'nvidia_cooldown_retry' as const,
      attempt: 2,
      maxAttempts: 5,
      pauseMs: 30_000,
      waitingUntil: Date.now() + 30_000,
      message: 'All NVIDIA keys throttled — waiting 30s before retry #2',
      provider: 'nvidia',
    };

    const retryHtml = renderToStaticMarkup(React.createElement(CooldownCountdownBadge, {
      event: retryEvent,
      isLive: true,
    }));
    expect(retryHtml).toContain('All NVIDIA keys throttled — waiting');
    expect(retryHtml).toContain('before retry #2');
    expect(retryHtml).toContain('data-cooldown-state="cooling"');
  });

  it('renders NVIDIA key cooldown pause card and stream status in CoderChatPanel', () => {
    const thread: CoderThreadMessage[] = [{
      id: 'cooldown-msg',
      role: 'assistant',
      status: 'running',
      content: 'Waiting for key cooldown.',
      createdAt: 1710000000000,
      agentEvents: [
        {
          type: 'pacing_wait',
          profile: 'conservative',
          delayMs: 42_000,
          waitingUntil: Date.now() + 42_000,
          scope: 'free_tier_key_cooldown',
          message: 'Waiting 42.0s for nvidia key cooldown to clear.',
          provider: 'nvidia',
        },
      ],
    }];

    const html = renderToStaticMarkup(React.createElement(CoderChatPanel, {
      task: 'Refactor utils',
      model: 'meta/llama-3.1-8b',
      loading: true,
      liveProgress: 'Waiting for key cooldown',
      liveState: null,
      result: null,
      workspace: '',
      thread,
      canContinue: false,
      agentEvents: thread[0].agentEvents,
      agentStatus: 'waiting for provider',
      onTaskChange: () => undefined,
      onModelChange: () => undefined,
      onRunTask: () => undefined,
      onGenerateWorkPlan: () => undefined,
      onContinue: () => undefined,
      onStartNew: () => undefined,
    }));

    expect(html).toContain('thread-provider-pause');
    expect(html).toContain('cooldown-countdown-chip');
    expect(html).toContain('NVIDIA key cooldown');
  });

  it('renders throttle retry pause card and console log in ConsoleRunPanel and CoderChatPanel', () => {
    const retryEvent = {
      type: 'nvidia_cooldown_retry' as const,
      attempt: 1,
      maxAttempts: 5,
      pauseMs: 30_000,
      waitingUntil: Date.now() + 30_000,
      message: 'All NVIDIA keys throttled — waiting 30s before retry #1',
      provider: 'nvidia',
    };

    const thread: CoderThreadMessage[] = [{
      id: 'retry-msg',
      role: 'assistant',
      status: 'running',
      content: 'Retrying NVIDIA request.',
      createdAt: 1710000000000,
      agentEvents: [retryEvent],
    }];

    const chatHtml = renderToStaticMarkup(React.createElement(CoderChatPanel, {
      task: 'Fix database query',
      model: 'meta/llama-3.1-8b',
      loading: true,
      liveProgress: 'All NVIDIA keys throttled',
      liveState: null,
      result: null,
      workspace: '',
      thread,
      canContinue: false,
      agentEvents: [retryEvent],
      agentStatus: 'waiting for provider',
      onTaskChange: () => undefined,
      onModelChange: () => undefined,
      onRunTask: () => undefined,
      onGenerateWorkPlan: () => undefined,
      onContinue: () => undefined,
      onStartNew: () => undefined,
    }));

    expect(chatHtml).toContain('thread-provider-pause');
    expect(chatHtml).toContain('THROTTLE RETRY');
    expect(chatHtml).toContain('cooldown-countdown-chip');
    expect(chatHtml).toContain('All NVIDIA keys throttled');

    const consoleHtml = renderToStaticMarkup(React.createElement(ConsoleRunPanel, {
      agentEvents: [retryEvent],
      loading: true,
      task: 'Fix database query',
      model: 'meta/llama-3.1-8b',
      agentStatus: 'waiting for provider',
      liveProgress: '',
      liveState: null,
      result: null,
      onStopTask: () => undefined,
      onFixSettings: () => undefined,
    }));

    expect(consoleHtml).toContain('All NVIDIA keys throttled');
    expect(consoleHtml).toContain('PROVIDER');
  });
});
