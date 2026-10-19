import { describe, expect, it } from '@jest/globals';
import {
  getProviderCapabilities,
  buildStructuredActionInstruction,
  createMalformedProviderResponseAudit,
  completeAgentDecisionRecord,
  createAgentDecisionRecord,
  assessAgentDecisionEvidence,
  normalizeAgentDecision,
  normalizeAgentDecisionWithRecovery,
  redactMalformedProviderResponse,
  validateAgentDecision,
  FormatFailureSwitchPolicy,
  providerKindFromName,
} from '../agentDecision.js';

describe('provider-neutral AgentDecision protocol', () => {
  it('creates a collapsed decision record and closes it with bounded evidence', () => {
    const record = createAgentDecisionRecord({
      id: 'decision-1',
      step: 2,
      provider: 'openai',
      model: 'planner',
      action: { action: 'Read', action_input: { file_path: 'src/app.ts' } },
      rationale: 'Inspect the target before editing.',
      expectedEvidence: ['The target exists.'],
      reasoningVisibility: 'collapsed',
      reasoningSource: 'model',
    });

    expect(record).toMatchObject({
      id: 'decision-1',
      status: 'pending',
      reasoningVisibility: 'collapsed',
      reasoningSource: 'model',
    });

    const completed = completeAgentDecisionRecord(record, {
      status: 'success',
      summary: JSON.stringify({ success: true, output: 'Target exists; apiKey=sk-secret-value' }),
    });

    expect(completed).toMatchObject({
      status: 'succeeded',
      observedEvidence: { status: 'success' },
    });
    expect(completed.observedEvidence?.summary).toContain('Target exists');
    expect(completed.observedEvidence?.summary).not.toContain('sk-secret-value');
  });

  it('marks unavailable evidence as invalidated instead of claiming success', () => {
    const record = createAgentDecisionRecord({
      id: 'decision-2',
      step: 1,
      provider: 'legacy_text',
      model: 'planner',
      action: { action: 'Read', action_input: {} },
    });

    expect(completeAgentDecisionRecord(record, { status: 'unknown', summary: 'No structured observation.' }).status).toBe('invalidated');
  });

  it('only invalidates a decision when expected evidence is explicitly contradicted', () => {
    expect(assessAgentDecisionEvidence(['The target exists.'], 'Read result: target not found.')).toBe('contradicted');
    expect(assessAgentDecisionEvidence(['The target exists.'], 'Read result: target exists and is readable.')).toBe('supported');
    expect(assessAgentDecisionEvidence(['The target exists.'], 'Read result: source preview returned.')).toBe('unverified');

    const record = createAgentDecisionRecord({
      id: 'decision-3',
      step: 1,
      provider: 'openai',
      model: 'planner',
      action: { action: 'Read', action_input: {} },
      expectedEvidence: ['The target exists.'],
    });
    const completed = completeAgentDecisionRecord(record, {
      status: 'success',
      summary: JSON.stringify({ success: true, output: 'Target not found.' }),
    });

    expect(completed).toMatchObject({
      status: 'invalidated',
      observedEvidence: { status: 'success', assessment: 'contradicted' },
    });
  });

  it('uses typed checks when available and links the result to tool evidence', () => {
    const record = createAgentDecisionRecord({
      id: 'decision-typed',
      step: 3,
      provider: 'openai',
      model: 'planner',
      action: { action: 'Read', action_input: { file_path: 'src/app.ts' } },
      expectedEvidence: ['The target exists.'],
      evidenceChecks: [{ type: 'file_exists', path: 'src/app.ts' }],
    });

    const completed = completeAgentDecisionRecord(record, {
      status: 'success',
      summary: JSON.stringify({ success: true, output: 'Read src/app.ts' }),
    }, {
      action: record.action,
      observation: JSON.stringify({ success: true, output: 'Read src/app.ts' }),
      toolEvidence: {
        id: 'evidence-1',
        status: 'success',
        input: { file_path: 'src/app.ts' },
        output: 'Read src/app.ts',
      },
    });

    expect(completed).toMatchObject({
      status: 'succeeded',
      toolEvidenceId: 'evidence-1',
      observedEvidence: {
        assessment: 'supported',
        checkResults: [{ type: 'file_exists', status: 'passed' }],
      },
    });
  });

  it('validates search, package, and workspace-specific evidence against their producing tools', () => {
    const cases = [
      {
        id: 'decision-search',
        action: { action: 'Grep', action_input: { pattern: 'AgentTimeline' } },
        check: { type: 'search_match' as const, text: 'AgentTimeline' },
        observation: JSON.stringify({ success: true, output: 'ui/src/components/AgentTimeline.tsx' }),
      },
      {
        id: 'decision-package',
        action: { action: 'PackageInstall', action_input: { packages: ['react'] } },
        check: { type: 'package_installed' as const, packageName: 'react' },
        observation: JSON.stringify({ success: true, packageInstall: { verifiedPackages: ['react'], missingPackages: [] } }),
      },
      {
        id: 'decision-workspace',
        action: { action: 'WorkspaceChanges', action_input: { path: '.' } },
        check: { type: 'workspace_change_detected' as const, path: 'src/app.ts' },
        observation: JSON.stringify({ success: true, files: [{ path: 'src/app.ts' }] }),
      },
    ];

    for (const item of cases) {
      const record = createAgentDecisionRecord({
        id: item.id,
        step: 1,
        provider: 'openai',
        model: 'planner',
        action: item.action,
        evidenceChecks: [item.check],
      });
      const completed = completeAgentDecisionRecord(record, { status: 'success', summary: item.observation }, {
        action: record.action,
        observation: item.observation,
        toolEvidence: { id: `${item.id}-evidence`, status: 'success', input: item.action.action_input, output: item.observation },
      });
      expect(completed.status).toBe('succeeded');
      expect(completed.observedEvidence?.checkResults?.[0]).toMatchObject({ type: item.check.type, status: 'passed' });
    }
  });

  it('normalizes legacy text JSON and Action/Input text', () => {
    expect(normalizeAgentDecision('{"action":"Read","action_input":{"file_path":"src/app.ts"}}', { provider: 'legacy_text' }).decision).toMatchObject({
      provider: 'legacy_text',
      status: 'act',
      action: { action: 'Read', action_input: { file_path: 'src/app.ts' } },
    });
    expect(normalizeAgentDecision('Action: Bash\nAction Input: {"command":"npm.cmd test"}', { provider: 'legacy_text' }).decision?.action).toEqual({
      action: 'Bash',
      action_input: { command: 'npm.cmd test' },
    });
  });

  it('normalizes OpenAI, Anthropic, and Gemini native tool calls to the same action', () => {
    const expected = { action: 'Read', action_input: { file_path: 'README.md' } };
    const openai = normalizeAgentDecision({ choices: [{ message: { tool_calls: [{ function: { name: 'Read', arguments: '{"file_path":"README.md"}' } }] } }] }, { provider: 'openai' });
    const anthropic = normalizeAgentDecision({ content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } }] }, { provider: 'anthropic' });
    const gemini = normalizeAgentDecision({ candidates: [{ content: { parts: [{ functionCall: { name: 'Read', args: { file_path: 'README.md' } } }] } }] }, { provider: 'gemini' });

    expect(openai.decision?.action).toEqual(expected);
    expect(anthropic.decision?.action).toEqual(expected);
    expect(gemini.decision?.action).toEqual(expected);
  });

  it('normalizes a response-only provider message without inventing an action', () => {
    const result = normalizeAgentDecision({ role: 'assistant', content: 'I need clarification.' }, { provider: 'openai' });

    expect(result.decision).toMatchObject({ status: 'respond', rationale: 'I need clarification.' });
    expect(result.decision?.action).toBeUndefined();
  });

  it('validates allowed tools and exposes bounded recovery metadata', () => {
    const unknown = normalizeAgentDecision('{"tool":"Delete","arguments":{}}', { allowedTools: ['Read'] });
    const malformed = normalizeAgentDecisionWithRecovery('{"tool":"Read","arguments":', { maxRetries: 2 });

    expect(unknown.errors).toContain('Unknown tool: Delete');
    expect(unknown.recoverable).toBe(true);
    expect(malformed.decision).toBeUndefined();
    expect(malformed.retryCount).toBe(1);
    expect(validateAgentDecision({ version: 1, id: 'd1', status: 'act', action: { action: 'Read', action_input: {} } }, ['Read'])).toEqual([]);
  });

  it('normalizes bounded decision metadata alongside the tool action', () => {
    const result = normalizeAgentDecision({
      tool: 'Read',
      arguments: { file_path: 'README.md' },
      rationale: 'Inspect the project contract before editing.',
      expectedEvidence: ['The contract identifies the requested scope.', 'The target exists.'],
      preconditions: ['The workspace is readable.'],
      stopCondition: 'Stop inspecting once the target and acceptance criteria are confirmed.',
      confidence: 1.4,
    }, { provider: 'legacy_text', allowedTools: ['Read'] });

    expect(result.decision).toMatchObject({
      rationale: 'Inspect the project contract before editing.',
      expectedEvidence: ['The contract identifies the requested scope.', 'The target exists.'],
      preconditions: ['The workspace is readable.'],
      stopCondition: 'Stop inspecting once the target and acceptance criteria are confirmed.',
      confidence: 1,
    });
  });

  it('redacts credentials from malformed raw responses', () => {
    const redacted = redactMalformedProviderResponse('{"apiKey":"sk-secret-value","authorization":"Bearer secret"}');

    expect(redacted).not.toContain('sk-secret-value');
    expect(redacted).not.toContain('Bearer secret');
    expect(redacted).toContain('[REDACTED]');
  });

  it('reports provider capability metadata consistently', () => {
    expect(getProviderCapabilities('openai')).toMatchObject({ nativeToolCalls: true, jsonSchema: true });
    expect(getProviderCapabilities('nvidia')).toMatchObject({ nativeToolCalls: true, jsonSchema: true });
    expect(getProviderCapabilities('legacy_text')).toMatchObject({ nativeToolCalls: false, jsonSchema: false });
    expect(buildStructuredActionInstruction('openai')).toMatch(/native tool/i);
    expect(buildStructuredActionInstruction('nvidia', false)).toMatch(/exactly one JSON/i);
    expect(buildStructuredActionInstruction('legacy_text')).toMatch(/exactly one JSON/i);
  });

  it('does not infer one provider from a composite provider name', () => {
    expect(providerKindFromName('composite[gemini,nvidia,openrouter]')).toBe('unknown');
  });

  it('keeps malformed-response recovery bounded across fuzz-style mutations', () => {
    const malformedInputs = [
      '{"tool":"Read","arguments":',
      '{"tool":"Read","arguments":{"file_path":"x"}',
      '```json\n{"action":"Read","action_input":null}\n```',
      '{"tool_calls":[{"function":{"name":"Read","arguments":"not-json"}}]}',
      'role=assistant token=sk-secret-value tool_calls=[]',
    ];

    for (const input of malformedInputs) {
      const result = normalizeAgentDecisionWithRecovery(input, { maxRetries: 2 });
      expect(result.retryCount).toBeLessThanOrEqual(1);
      if (!result.decision) {
        expect(result.redactedRaw || '').not.toContain('sk-secret-value');
        expect(createMalformedProviderResponseAudit(input, result).type).toBe('malformed_provider_response');
      }
    }
  });

  it('switches target after repeated format failures and resets on success', () => {
    const policy = new FormatFailureSwitchPolicy([
      { provider: 'openai', model: 'gpt-tool' },
      { provider: 'gemini', model: 'gemini-tool' },
    ], 2);

    expect(policy.recordFailure('openai', 'gpt-tool')).toBeUndefined();
    expect(policy.recordFailure('openai', 'gpt-tool')).toMatchObject({ provider: 'gemini', model: 'gemini-tool', failureCount: 2 });
    policy.recordSuccess('openai', 'gpt-tool');
    expect(policy.getFailureCount('openai', 'gpt-tool')).toBe(0);
  });
});
