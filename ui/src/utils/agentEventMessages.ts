import type {
  AgentRequestEnvelope,
  AgentRunStatus,
  AgentStreamEvent,
  ReActResult,
} from '../components/CoderChatPanel';

export interface AgentEventMessage {
  title: string;
  detail: string;
}

const didObservationSucceed = (observation?: string): boolean => {
  if (!observation) return true;
  try {
    const parsed = JSON.parse(observation);
    if (parsed && typeof parsed === 'object' && 'success' in parsed) {
      return Boolean((parsed as { success?: unknown }).success);
    }
  } catch {
    // Fall through to text checks for legacy observations.
  }
  return !/success"\s*:\s*false|Mutation rejected|Guarded mutation rejected|Error executing|Tool execution failed|failed|error/i.test(observation);
};

export const formatAgentRequestRoute = (request: AgentRequestEnvelope): string => {
  const route = request.resolvedRoute || request.requestedRoute;
  if (!route) return 'selected provider';

  let provider = (route.provider || '').trim();
  let model = (route.model || '').trim();
  let keyInfo = '';

  if (route.credentialIndex !== undefined && Number.isInteger(route.credentialIndex)) {
    keyInfo = `Key ${route.credentialIndex + 1}`;
  }

  // Resolve target model identifiers (e.g. nvidia-target:key-1-deepseek-ai-deepseek-v4-flash, gemini-target:...)
  if (model.startsWith('nvidia-target:')) {
    provider = 'nvidia';
    const targetSlug = model.slice('nvidia-target:'.length);
    const keyMatch = targetSlug.match(/^(?:key-(\d+)-|(\d+):)/i);
    if (keyMatch) {
      const idx = keyMatch[1] ?? keyMatch[2];
      if (!keyInfo) keyInfo = `Key ${Number(idx) + (keyMatch[2] ? 1 : 0)}`;
    }
    const cleanSlug = targetSlug.replace(/^(?:key-\d+-|\d+:)/i, '');
    model = decodeURIComponent(cleanSlug);
    const knownNamespace = /^(deepseek-ai|nvidia|poolside|minimaxai|z-ai|stepfun-ai|moonshotai|thinkingmachines|meta|mistralai|qwen|google|openai|nv-mistralai)-(.*)$/i;
    const nsMatch = model.match(knownNamespace);
    if (nsMatch) {
      model = `${nsMatch[1]}/${nsMatch[2]}`;
    }
  } else if (model.startsWith('gemini-target:')) {
    provider = 'gemini';
    const targetSlug = model.slice('gemini-target:'.length);
    const keyMatch = targetSlug.match(/^(?:key-(\d+)-|(\d+):)/i);
    if (keyMatch) {
      const idx = keyMatch[1] ?? keyMatch[2];
      if (!keyInfo) keyInfo = `Key ${Number(idx) + (keyMatch[2] ? 1 : 0)}`;
    }
    model = targetSlug.replace(/^(?:key-\d+-|\d+:)/i, '');
  } else if (model.startsWith('local-target:')) {
    provider = 'local';
    model = model.slice('local-target:'.length).replace(/^(?:key-\d+-|\d+:)/i, '');
  } else if (model.startsWith('colab-target:')) {
    provider = 'colab';
    model = model.slice('colab-target:'.length).replace(/^(?:key-\d+-|\d+:)/i, '');
  } else if (model.startsWith('openrouter:')) {
    if (!provider || provider.startsWith('composite')) provider = 'openrouter';
    model = model.slice('openrouter:'.length);
  } else if (model.startsWith('groq:')) {
    if (!provider || provider.startsWith('composite')) provider = 'groq';
    model = model.slice('groq:'.length);
  } else if (model.startsWith('cerebras:')) {
    if (!provider || provider.startsWith('composite')) provider = 'cerebras';
    model = model.slice('cerebras:'.length);
  } else if (model.startsWith('sambanova:')) {
    if (!provider || provider.startsWith('composite')) provider = 'sambanova';
    model = model.slice('sambanova:'.length);
  } else if (model.startsWith('kimi:')) {
    if (!provider || provider.startsWith('composite')) provider = 'kimi';
    model = model.slice('kimi:'.length);
  } else if (model.startsWith('requesty:')) {
    if (!provider || provider.startsWith('composite')) provider = 'requesty';
    model = model.slice('requesty:'.length);
  } else if (model.startsWith('pollinations:')) {
    if (!provider || provider.startsWith('composite')) provider = 'pollinations';
    model = model.slice('pollinations:'.length);
  }

  // If provider is still composite[...], infer from model namespace
  if (provider.startsWith('composite') || provider.includes('[') || provider === 'unknown') {
    const m = model.toLowerCase();
    if (m.startsWith('gemini-') || m.startsWith('gemini/')) {
      provider = 'gemini';
    } else if (
      m.startsWith('nvidia/') ||
      m.startsWith('poolside/') ||
      m.startsWith('minimaxai/') ||
      m.startsWith('z-ai/') ||
      m.startsWith('deepseek-ai/') ||
      m.startsWith('stepfun-ai/') ||
      m.startsWith('moonshotai/') ||
      m.startsWith('thinkingmachines/') ||
      m.startsWith('meta/') ||
      m.startsWith('mistralai/') ||
      m.startsWith('qwen/') ||
      m.startsWith('google/')
    ) {
      provider = 'nvidia';
    } else {
      provider = '';
    }
  }

  const modelWithKey = keyInfo && !model.includes(`(${keyInfo})`)
    ? `${model} (${keyInfo})`
    : model;

  if (provider && modelWithKey) {
    return `${provider} / ${modelWithKey}`;
  }
  return modelWithKey || provider || 'selected provider';
};

export const isTimeoutResult = (value?: { error?: string; errorCode?: string } | null): boolean =>
  Boolean(value && /\b(?:timed[_\s-]*out|timeout|deadline(?:\s+exceeded)?)\b/i.test(`${value.errorCode || ''} ${value.error || ''}`));

export const eventFailed = (event: AgentStreamEvent): boolean => {
  if (event.type === 'error') return true;
  if (event.type === 'harness_intervention') return true;
  if (event.type === 'decision_record') return event.record.status === 'failed' || event.record.status === 'invalidated';
  if (event.type === 'package_install_result') return !event.success;
  if (event.type === 'llm_request_finished') return event.request.status === 'failed' || event.request.status === 'timed_out';
  if (event.type !== 'tool_result' && event.type !== 'verification_result') return false;
  if (event.type === 'verification_result') return !event.success;
  return !didObservationSucceed(typeof event.result === 'string' ? event.result : JSON.stringify(event.result || ''));
};

export const eventTimedOut = (event: AgentStreamEvent): boolean => {
  const detail = event.type === 'tool_result'
    ? typeof event.result === 'string' ? event.result : JSON.stringify(event.result || '')
    : event.type === 'verification_result'
      ? event.output
      : event.type === 'command_output'
        ? event.output
        : event.type === 'package_install_result'
          ? event.output
          : event.type === 'error' || event.type === 'execution_failed' || event.type === 'provider_attempt_failed' || event.type === 'retrying' || event.type === 'cooldown_waiting' || event.type === 'nvidia_cooldown_retry'
            ? event.message
            : event.type === 'llm_request_finished'
              ? event.request.error
              : '';
  if (event.type === 'llm_request_finished' && event.request.status === 'timed_out') return true;
  return isTimeoutResult({ error: detail });
};

export type AgentEventOutcome = 'completed' | 'failed' | 'started' | 'stopped' | 'info';

export const getAgentEventOutcome = (event: AgentStreamEvent): AgentEventOutcome => {
  if (eventFailed(event) || event.type === 'execution_failed') return 'failed';
  if (event.type === 'run_terminal_advice') return 'failed';
  if (event.type === 'stopped' || event.type === 'interrupted' || event.type === 'killed') return 'stopped';
  if (event.type === 'run_started' || event.type === 'reasoning_start' || event.type === 'llm_request_started' || event.type === 'tool_started' || event.type === 'command_started' || event.type === 'package_install_started' || event.type === 'verification_started') return 'started';
  if (event.type === 'console_output' || event.type === 'agent_guidance_snapshot' || event.type === 'plan_updated' || event.type === 'policy_decision' || event.type === 'user_input_required' || event.type === 'user_input_resolved' || event.type === 'model_target_resolved' || event.type === 'llm_request_finished' || event.type === 'llm_request_heartbeat' || event.type === 'pacing_wait' || event.type === 'provider_attempt_failed' || event.type === 'provider_rotation_occurred' || event.type === 'cooldown_waiting' || event.type === 'nvidia_cooldown_retry' || event.type === 'retrying') return 'info';
  if (event.type === 'todo_snapshot' || event.type === 'todo_links_updated') return 'info';
  return 'completed';
};

export const eventTitle = (event: AgentStreamEvent): string => {
  switch (event.type) {
    case 'run_started': return 'Started';
    case 'agent_guidance_snapshot': return `Agent context: ${event.codingState}`;
    case 'run_terminal_advice': return `Next steps: ${event.title}`;
    case 'state_transition': return `State: ${event.transition.to}`;
    case 'recovery_transition': return `Recovery: ${event.to}`;
    case 'console_output': return 'Console output';
    case 'model_target_resolved': return event.route === 'recovery'
      ? 'Recovery model selected'
      : event.route === 'fallback'
        ? 'Same-provider model fallback'
        : 'Model target resolved';
    case 'llm_request_started': return `Calling ${formatAgentRequestRoute(event.request)}`;
    case 'llm_request_finished': return eventTimedOut(event)
      ? 'Provider request timed out'
      : event.request.status === 'failed'
        ? 'Provider request failed'
        : 'Provider response received';
    case 'llm_request_heartbeat': return event.stale ? 'Provider request may be stalled' : 'Waiting for provider response';
    case 'provider_rotation_occurred': return `Route rotated: ${event.fromProvider} -> ${event.toProvider}`;
    case 'model_response': return 'Agent decision';
    case 'model_stream': return event.requestKind === 'final_answer.synthesize' ? 'Assistant response' : 'Model response';
    case 'reasoning_start': return 'Thinking started';
    case 'reasoning_delta': return 'Reasoning update';
    case 'reasoning_end': return event.visibility === 'redacted' ? 'Thinking redacted' : 'Reasoning summary';
    case 'decision_record': return `Decision${event.record.decisionCategory ? ` (${event.record.decisionCategory})` : ''} ${event.record.status}`;
    case 'provider_attempt_failed': return 'Provider attempt failed';
    case 'cooldown_waiting': return 'Waiting for provider';
    case 'nvidia_cooldown_retry': return 'All NVIDIA keys throttled';
    case 'retrying': return 'Retrying from checkpoint';
    case 'execution_failed': return eventTimedOut(event) ? 'Run timed out' : 'Execution failed';
    case 'pacing_wait': return event.scope === 'free_tier_key_cooldown' ? 'NVIDIA key cooldown' : event.scope === 'fallback' ? 'Waiting for retry' : 'Request pacing';
    case 'plan_updated': return 'Plan updated';
    case 'todo_snapshot': return 'Todo snapshot';
    case 'todo_links_updated': return 'Todo links updated';
    case 'workplan_updated': return 'Workplan updated';
    case 'tool_started': return `Tool: ${event.tool}`;
    case 'tool_result': return eventTimedOut(event) ? `${event.tool} timed out` : `${event.tool} result`;
    case 'tool_evidence': return 'Tool evidence recorded';
    case 'harness_intervention': return `Harness guard: ${event.gateName.replace(/_/g, ' ')}`;
    case 'file_read': return 'Read file';
    case 'file_changed': return 'Changed file';
    case 'command_started': return 'Running command';
    case 'command_output': return eventTimedOut(event) ? 'Command timed out' : 'Command output';
    case 'package_install_started': return 'Installing dependencies';
    case 'package_install_result': return eventTimedOut(event) ? 'Dependency installation timed out' : event.success ? 'Dependencies installed' : 'Dependency installation failed';
    case 'verification_started': return 'Verifying';
    case 'verification_result': return eventTimedOut(event) ? 'Verification timed out' : event.success ? 'Verification Passed' : 'Verification Failed';
    case 'user_input_required': return 'Waiting for your answer';
    case 'user_input_resolved': return event.cancelled ? 'Question skipped' : 'Answer received';
    case 'user_message_queued': return 'Message queued';
    case 'user_message_processed': return 'Message processed';
    case 'inbox_message_enqueued': return 'Inbox message queued';
    case 'inbox_message_claimed': return 'Inbox message claimed';
    case 'inbox_message_replaced': return 'Inbox message replaced';
    case 'inbox_message_cancelled': return 'Inbox message cancelled';
    case 'inbox_message_processed': return 'Inbox message processed';
    case 'inbox_cleared': return 'Inbox cleared';
    case 'inbox_requeued': return 'Inbox requeued';
    case 'inbox_claims_released': return 'Inbox claims released';
    case 'policy_decision': return event.decision.allowed ? 'Policy allowed action' : event.decision.requiresApproval ? 'Approval required' : 'Policy blocked action';
    case 'final': return 'Final answer';
    case 'stopped': return 'Stopped';
    case 'interrupted': return 'Interrupted';
    case 'killed': return 'Killed';
    case 'error': return eventTimedOut(event) ? 'Run timed out' : 'Error';
    default: return 'Activity';
  }
};

export const eventBody = (event: AgentStreamEvent): string => {
  if (event.type === 'run_started') return event.task;
  if (event.type === 'agent_guidance_snapshot') return [
    `State: ${event.codingState}`,
    `Context estimate: ${event.contextBudgetUsed.toLocaleString()} tokens`,
    event.injectedDirective,
  ].join('\n');
  if (event.type === 'run_terminal_advice') return [event.summary, ...event.guidance].join('\n');
  if (event.type === 'state_transition') return `${event.transition.from} -> ${event.transition.to}\n${event.transition.reason}`;
  if (event.type === 'recovery_transition') return `${event.from} -> ${event.to} (attempt ${event.attempt})\n${event.message || event.reason}`;
  if (event.type === 'console_output') return event.message;
  if (event.type === 'model_target_resolved') {
    const account = event.profileId ? ` - profile ${event.profileId}` : Number.isInteger(event.credentialIndex) ? ` - credential ${Number(event.credentialIndex) + 1}` : '';
    const context = event.contextWindow ? ` - context ${event.contextWindow.toLocaleString()}` : '';
    return `${event.requestedTarget} -> ${event.provider}/${event.resolvedModel}${account}${context}`;
  }
  if (event.type === 'llm_request_started') return [
    `Route: ${formatAgentRequestRoute(event.request)}`,
    event.request.requestKind ? `Request: ${event.request.requestKind}` : '',
    event.request.options?.timeoutMs ? `Timeout budget: ${Math.ceil(event.request.options.timeoutMs / 1_000)}s` : '',
  ].filter(Boolean).join('\n');
  if (event.type === 'llm_request_finished') return [
    `Route: ${formatAgentRequestRoute(event.request)}`,
    `Status: ${event.request.status || 'unknown'}`,
    Number.isFinite(event.request.durationMs) ? `Duration: ${Math.ceil(Number(event.request.durationMs) / 1_000)}s` : '',
    event.request.error || '',
  ].filter(Boolean).join('\n');
  if (event.type === 'llm_request_heartbeat') return [
    `Route: ${event.provider} / ${event.model}`,
    event.requestKind ? `Request: ${event.requestKind}` : '',
    `Elapsed: ${Math.ceil(event.elapsedMs / 1_000)}s`,
    event.deadlineAt ? `Effective deadline: ${new Date(event.deadlineAt).toLocaleTimeString()}` : '',
    event.stale ? 'Provider request exceeded its effective deadline; outcome is unknown. Check the run or stop it if needed.' : 'Provider request is still active.',
  ].filter(Boolean).join('\n');
  if (event.type === 'model_response') return [
    event.message,
    event.decision?.reasoningSummary ? `Summary: ${event.decision.reasoningSummary}` : '',
    event.decision?.rationale ? `Rationale: ${event.decision.rationale}` : '',
    event.context ? `Responding to: ${event.context.latestUserInput || event.context.userRequest}` : '',
  ].filter(Boolean).join('\n');
  if (event.type === 'model_stream') return event.delta || (event.eventType === 'tool_call_delta' ? 'Selecting a tool.' : '');
  if (event.type === 'reasoning_start') return `Safe reasoning summary started (${event.source}; ${event.visibility}).`;
  if (event.type === 'reasoning_delta') return event.delta;
  if (event.type === 'reasoning_end') return event.summary || `Safe reasoning summary completed (${event.source}; ${event.visibility}).`;
  if (event.type === 'decision_record') return [
    `Action: ${event.record.action.action}`,
    event.record.decisionCategory ? `Category: ${event.record.decisionCategory}` : '',
    event.record.rationale ? `Rationale: ${event.record.rationale}` : '',
    event.record.expectedEvidence?.length ? `Expected evidence: ${event.record.expectedEvidence.join(' | ')}` : '',
    event.record.evidenceChecks?.length ? `Typed checks: ${event.record.evidenceChecks.map((check) => check.type).join(' | ')}` : '',
    event.record.toolEvidenceId ? `Tool evidence: ${event.record.toolEvidenceId}` : '',
    event.record.observedEvidence ? `Observed evidence: ${event.record.observedEvidence.status} - ${event.record.observedEvidence.summary}` : 'Observed evidence: pending',
  ].filter(Boolean).join('\n');
  if (event.type === 'provider_attempt_failed' || event.type === 'cooldown_waiting' || event.type === 'nvidia_cooldown_retry' || event.type === 'retrying' || event.type === 'execution_failed' || event.type === 'pacing_wait') return event.message;
  if (event.type === 'provider_rotation_occurred') return `${event.fromProvider}${event.fromProfileId ? ` / ${event.fromProfileId}` : Number.isInteger(event.fromKeyIndex) ? ` account ${Number(event.fromKeyIndex) + 1}` : ''} -> ${event.toProvider}${event.toProfileId ? ` / ${event.toProfileId}` : Number.isInteger(event.toKeyIndex) ? ` account ${Number(event.toKeyIndex) + 1}` : ''}${event.cooldownSeconds > 0 ? ` (${event.cooldownSeconds}s cooldown)` : ''}: ${event.reason}`;
  if (event.type === 'plan_updated') {
    const items = Array.isArray(event.plan) ? event.plan : [event.plan];
    return items.map((item) => typeof item === 'string' ? item : item && typeof item === 'object' && typeof item.step === 'string' ? item.step : '').filter(Boolean).join('\n');
  }
  if (event.type === 'todo_snapshot') return event.items.map((item) => `[${item.status}] ${item.content}`).join('\n');
  if (event.type === 'todo_links_updated') return event.links.length
    ? `${event.links.length} todo item link${event.links.length === 1 ? '' : 's'} updated.`
    : 'Todo links updated.';
  if (event.type === 'workplan_updated') return [event.workPlan?.objective, event.workPlan?.status ? `Status: ${event.workPlan.status}` : ''].filter(Boolean).join('\n');
  if (event.type === 'tool_started') return JSON.stringify(event.input || {}, null, 2);
  if (event.type === 'tool_result') return typeof event.result === 'string' ? event.result : JSON.stringify(event.result ?? {}, null, 2);
  if (event.type === 'tool_evidence') return JSON.stringify(event.record ?? {}, null, 2);
  if (event.type === 'harness_intervention') return [
    event.reason,
    `Action: ${event.targetAction} (step ${event.stepSeq})`,
    `Required evidence: ${event.requiredEvidence.join('; ')}`,
  ].join('\n');
  if (event.type === 'file_read') return event.path;
  if (event.type === 'file_changed') return `${event.path}${event.summary ? ` - ${event.summary}` : ''}`;
  if (event.type === 'command_started') return event.command;
  if (event.type === 'command_output') return event.output;
  if (event.type === 'package_install_started') return `${event.command}${event.cwd ? `\nWorking directory: ${event.cwd}` : ''}`;
  if (event.type === 'package_install_result') return [
    `Manager: ${event.manager}`,
    event.cwd ? `Working directory: ${event.cwd}` : '',
    Number.isInteger(event.exitCode) ? `Exit code: ${event.exitCode}` : '',
    event.verifiedPackages.length ? `Verified packages: ${event.verifiedPackages.join(', ')}` : '',
    event.missingPackages.length ? `Missing packages: ${event.missingPackages.join(', ')}` : '',
    event.output || '',
  ].filter(Boolean).join('\n');
  if (event.type === 'verification_started') return event.command || 'Running verification';
  if (event.type === 'verification_result') return event.output || (event.success ? 'Passed' : 'Failed');
  if (event.type === 'user_input_required') return `${event.question}${event.context ? `\n${event.context}` : ''}`;
  if (event.type === 'user_input_resolved') return event.cancelled ? 'The user opted out.' : event.selectedOption || 'The user provided an answer.';
  if (event.type === 'user_message_queued' || event.type === 'user_message_processed') return event.message;
  if (event.type === 'policy_decision') return `${event.decision.summary}\nScope: ${event.decision.scope}\n${event.decision.reason}`;
  if (event.type === 'final' || event.type === 'stopped' || event.type === 'interrupted' || event.type === 'killed' || event.type === 'error') return event.message;
  if (event.type === 'inbox_message_enqueued' || event.type === 'inbox_message_replaced' || event.type === 'inbox_message_cancelled' || event.type === 'inbox_message_processed') return event.entry.message;
  if (event.type === 'inbox_message_claimed') return event.entries.map((entry) => entry.message).join('\n');
  if (event.type === 'inbox_cleared') return event.entries.map((entry) => entry.message).join('\n');
  if (event.type === 'inbox_requeued') return `Parent run: ${event.parentRunId}`;
  if (event.type === 'inbox_claims_released') return `${event.reason}\n${event.messageIds.join(', ')}`;
  return '';
};

export const getAgentEventMessage = (event: AgentStreamEvent): AgentEventMessage => ({
  title: eventTitle(event),
  detail: eventBody(event),
});

export const isCheckpointResult = (value?: { error?: string; errorCode?: string } | null): boolean =>
  value?.errorCode === 'MAX_STEPS_EXCEEDED' ||
  value?.error === 'Max steps exceeded' ||
  /turn limit reached|autonomous turn checkpoint reached/i.test(value?.error || '');

export type TerminalRunOutcome = 'completed' | 'checkpoint' | 'timed_out' | 'stopped' | 'interrupted' | 'killed' | 'failed';

export const resolveTerminalRunOutcome = (
  value?: { success?: boolean; error?: string; errorCode?: string } | null,
  fallbackStatus?: AgentRunStatus,
): TerminalRunOutcome => {
  if (isCheckpointResult(value)) return 'checkpoint';
  if (value?.errorCode === 'USER_STOPPED' || fallbackStatus === 'stopped') return 'stopped';
  if (value?.errorCode === 'RUN_INTERRUPTED' || fallbackStatus === 'interrupted') return 'interrupted';
  if (value?.errorCode === 'RUN_KILLED' || fallbackStatus === 'killed') return 'killed';
  if (value?.success) return 'completed';
  if (isTimeoutResult(value) || fallbackStatus === 'timed_out') return 'timed_out';
  return 'failed';
};

export const formatAgentError = (error?: string, errorCode?: string): string => {
  const detail = error?.trim() || 'No additional error details were provided.';
  if (errorCode === 'RUN_STREAM_DISCONNECTED') {
    return `Live run connection lost before a terminal result was received. ${detail}`;
  }
  if (/401|unauthorized|authentication required|invalid api key/i.test(`${errorCode || ''} ${detail}`)) {
    return `Provider authentication failed. Check the API key in Settings. ${detail}`;
  }
  if (isTimeoutResult({ error: detail, errorCode })) {
    return `Provider request timed out. ${detail}`;
  }
  if (errorCode === 'PROVIDER_RETRY_LIMIT' || errorCode === 'PROVIDER_WAIT_DISABLED') {
    return `Provider recovery ended at the saved checkpoint. ${detail}`;
  }
  if (errorCode === 'PROVIDER_COOLDOWN_WAIT_FAILED') {
    return `Provider recovery wait failed. ${detail}`;
  }
  if (/policy blocked|requires approval|permission/i.test(`${errorCode || ''} ${detail}`)) {
    return `Action blocked by permission policy. ${detail}`;
  }
  return detail;
};

export const formatTerminalResultError = (
  result: Pick<ReActResult, 'error' | 'errorCode'>,
  status?: AgentRunStatus,
): string => {
  const outcome = resolveTerminalRunOutcome(result, status);
  if (outcome === 'checkpoint') return 'Turn limit reached. Progress was saved and is ready to continue from the checkpoint.';
  if (outcome === 'timed_out') return formatAgentError(result.error || 'The run timed out before completing.', result.errorCode);
  if (outcome === 'stopped') return result.error || 'The run was stopped.';
  if (outcome === 'interrupted') return result.error || 'The run was interrupted and can be resumed.';
  if (outcome === 'killed') return result.error || 'The run was killed.';
  return formatAgentError(result.error, result.errorCode);
};
