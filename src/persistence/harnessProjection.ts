import {
  isKnownHarnessEventType,
  type HarnessEventEnvelope,
  type HarnessEventCorrelation,
  type JsonValue,
} from './harnessEvent.js';
import { getToolCapabilities } from '@barok/engine';
import {
  projectTodoEvents,
  toCoderTaskAnalysisView,
  type CoderTaskAnalysisView,
  type TodoProjection,
} from '@barok/core';

export interface HarnessTimelineItem {
  eventId: string;
  seq: number;
  type: string;
  timestamp: number;
  correlation?: HarnessEventCorrelation;
  summary: string;
  decisionCategory?: string;
}

export interface HarnessEvidenceItem {
  eventId: string;
  seq: number;
  kind: 'provider' | 'tool';
  type: string;
  data: JsonValue;
}

export interface HarnessActiveTool {
  toolCallId: string;
  tool: string;
  requestId?: string;
  stepId?: string;
  startedAt: number;
}

export interface HarnessReplayViolation {
  code: string;
  message: string;
  eventIds: string[];
  seqs: number[];
}

export interface HarnessReplayInvariants {
  valid: boolean;
  sequence: {
    valid: boolean;
    missingSequences: number[];
    duplicateSequences: number[];
  };
  turnStepEnclosure: {
    valid: boolean;
    stepIds: string[];
    orphanEventIds: string[];
    violations: string[];
  };
  callResultPairing: {
    valid: boolean;
    startedCallIds: string[];
    closedCallIds: string[];
    unmatchedCallIds: string[];
    orphanResultEventIds: string[];
    duplicateStartCallIds: string[];
    duplicateResultCallIds: string[];
    unidentifiedEventIds: string[];
  };
  requestPairing: {
    valid: boolean;
    startedRequestIds: string[];
    finishedRequestIds: string[];
    openRequestIds: string[];
    duplicateFinishRequestIds: string[];
  };
  mutationEvidence: {
    valid: boolean;
    mutationCallIds: string[];
    missingEvidenceCallIds: string[];
    missingEvidenceEventIds: string[];
    unresolvedEvidenceIds: string[];
    mismatchedEvidenceIds: string[];
  };
  violations: HarnessReplayViolation[];
}

export interface HarnessRunProjection {
  runId: string;
  sessionId: string;
  eventCount: number;
  lastSeq: number;
  contiguous: boolean;
  missingSequences: number[];
  duplicateSequences: number[];
  timeline: HarnessTimelineItem[];
  rawEvidence: HarnessEvidenceItem[];
  activeTools: HarnessActiveTool[];
  latestState?: JsonValue;
  latestCheckpoint?: JsonValue;
  latestProgress?: string;
  taskAnalysis?: CoderTaskAnalysisView;
  /** Latest replayable todo view; process-local run status is excluded. */
  todo?: TodoProjection;
  terminal?: {
    eventId: string;
    type: string;
    data: JsonValue;
    timestamp: number;
  };
  unknownEventTypes: string[];
  replayInvariants: HarnessReplayInvariants;
}

export interface HarnessProjectionOptions {
  /** Keep the compact timeline in the returned projection. */
  includeTimeline?: boolean;
  /** Keep raw provider/tool payloads in the returned projection. */
  includeRawEvidence?: boolean;
}

function record(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : undefined;
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function compact(value: string | undefined, limit = 240): string {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function eventSummary(event: HarnessEventEnvelope): string {
  const data = record(event.data);
  if (event.type === 'tool_started') return `Tool started: ${compact(stringValue(data?.tool) || 'unknown tool')}`;
  if (event.type === 'tool_result') return `Tool result: ${compact(stringValue(data?.result) || 'result recorded')}`;
  if (event.type === 'tool_outcome_unknown') return `Tool outcome unknown: ${compact(stringValue(record(data?.outcome)?.tool) || 'unknown tool')}`;
  if (event.type === 'harness_intervention') return `Harness intervention (${compact(stringValue(data?.gateName) || 'guard')}): ${compact(stringValue(data?.reason) || 'action blocked')}`;
  if (event.type === 'task_analysis_ready') {
    const analysis = record(data?.taskAnalysis);
    const affectedFiles = Array.isArray(analysis?.affectedFiles) ? analysis.affectedFiles.length : 0;
    return `Task analysis ready: ${compact(stringValue(analysis?.taskKind) || 'investigation')} · ${affectedFiles} affected files`;
  }
  if (event.type === 'decision_record') {
    const decision = record(data?.record);
    const category = stringValue(decision?.decisionCategory);
    return `Decision${category ? ` (${compact(category, 40)})` : ''}: ${compact(stringValue(record(decision?.action)?.action) || 'action selected')}`;
  }
  if (event.type === 'model_response') return `Assistant response: ${compact(stringValue(data?.message) || 'response recorded')}`;
  if (event.type === 'llm_request_started' || event.type === 'llm_request_finished') {
    const request = record(data?.request);
    const route = record(request?.resolvedRoute) || record(request?.requestedRoute);
    return `Model request ${stringValue(request?.status) || 'recorded'}: ${compact(`${stringValue(route?.provider) || 'provider'}/${stringValue(route?.model) || 'model'}`)}`;
  }
  if (event.type === 'provider_rotation_occurred') {
    const from = stringValue(data?.fromProvider) || 'provider';
    const to = stringValue(data?.toProvider) || 'provider';
    return `Provider route rotated: ${compact(from)} -> ${compact(to)}`;
  }
  if (event.type === 'progress') return `Progress: ${compact(typeof event.data === 'string' ? event.data : stringValue(data?.message))}`;
  if (event.type === 'final') return `Final: ${compact(stringValue(data?.message) || 'final response recorded')}`;
  if (event.type === 'error' || event.type === 'execution_failed') return `Failure: ${compact(stringValue(data?.message) || stringValue(data?.error) || 'error recorded')}`;
  if (event.type === 'checkpoint') return 'Checkpoint saved';
  if (event.type === 'state' || event.type === 'state_transition') return 'Execution state updated';
  return `${event.type} recorded`;
}

function evidenceKind(type: string): HarnessEvidenceItem['kind'] | undefined {
  if (type.startsWith('llm_request') || type === 'model_stream' || type === 'model_response' || type === 'provider_rotation_occurred') return 'provider';
  if (type.startsWith('tool_') || type === 'harness_intervention' || type === 'file_changed' || type === 'command_output' || type === 'verification_result') return 'tool';
  return undefined;
}

function toolIdentity(event: HarnessEventEnvelope): { toolCallId: string; tool: string; requestId?: string; stepId?: string } | undefined {
  const data = record(event.data);
  const outcome = record(data?.outcome);
  const toolCallId = stringValue(event.correlation?.toolCallId) || stringValue(data?.toolCallId) || stringValue(outcome?.toolCallId);
  if (!toolCallId) return undefined;
  const tool = stringValue(data?.tool) || stringValue(outcome?.tool) || 'unknown';
  return {
    toolCallId,
    tool,
    ...(stringValue(event.correlation?.requestId) || stringValue(data?.requestId) ? { requestId: stringValue(event.correlation?.requestId) || stringValue(data?.requestId) } : {}),
    ...(stringValue(event.correlation?.stepId) || stringValue(data?.stepId) ? { stepId: stringValue(event.correlation?.stepId) || stringValue(data?.stepId) } : {}),
  };
}

function requestIdentity(event: HarnessEventEnvelope): { requestId: string; stepId?: string } | undefined {
  const data = record(event.data);
  const request = record(data?.request);
  const requestId = stringValue(event.correlation?.requestId) || stringValue(request?.requestId);
  if (!requestId) return undefined;
  const stepId = stringValue(event.correlation?.stepId) || stringValue(request?.stepId);
  return { requestId, ...(stepId ? { stepId } : {}) };
}

function stepIdOf(event: HarnessEventEnvelope): string | undefined {
  const data = record(event.data);
  const nested = record(data?.request) || record(data?.outcome);
  return stringValue(event.correlation?.stepId) || stringValue(data?.stepId) || stringValue(nested?.stepId);
}

function evidenceReferences(event: HarnessEventEnvelope): string[] {
  const data = record(event.data);
  const refs: string[] = [];
  if (typeof data?.evidenceId === 'string' && data.evidenceId.trim()) refs.push(data.evidenceId);
  if (Array.isArray(data?.evidenceIds)) {
    for (const item of data.evidenceIds) if (typeof item === 'string' && item.trim()) refs.push(item);
  }
  return [...new Set(refs)];
}

function boundedViolationMessage(message: string): string {
  return compact(message, 300);
}

/**
 * Rebuild the durable run view from events only. Unknown event types remain
 * visible in the timeline and are never coerced into a known event shape.
 */
export function projectHarnessEvents(events: HarnessEventEnvelope[], options: HarnessProjectionOptions = {}): HarnessRunProjection {
  const includeTimeline = options.includeTimeline !== false;
  const includeRawEvidence = options.includeRawEvidence !== false;
  const sorted = [...events].sort((left, right) => left.seq - right.seq);
  const todo = projectTodoEvents(sorted);
  const first = sorted[0];
  const missingSequences: number[] = [];
  const duplicateSequences: number[] = [];
  const seen = new Set<number>();
  let expected = first?.seq || 0;
  for (const event of sorted) {
    if (seen.has(event.seq)) duplicateSequences.push(event.seq);
    seen.add(event.seq);
    while (expected < event.seq) missingSequences.push(expected++);
    expected = Math.max(expected, event.seq + 1);
  }

  const active = new Map<string, HarnessActiveTool>();
  const timeline: HarnessTimelineItem[] = [];
  const rawEvidence: HarnessEvidenceItem[] = [];
  const unknownEventTypes = new Set<string>();
  let latestState: JsonValue | undefined;
  let latestCheckpoint: JsonValue | undefined;
  let latestProgress: string | undefined;
  let taskAnalysis: CoderTaskAnalysisView | undefined;
  let terminal: HarnessRunProjection['terminal'];
  const violations: HarnessReplayViolation[] = [];
  const addViolation = (code: string, message: string, related: HarnessEventEnvelope[]): void => {
    const eventIds = [...new Set(related.map((event) => event.eventId))];
    const seqs = [...new Set(related.map((event) => event.seq))].sort((left, right) => left - right);
    violations.push({ code, message: boundedViolationMessage(message), eventIds, seqs });
  };
  const toolStarts = new Map<string, HarnessEventEnvelope>();
  const duplicateStartCallIds = new Set<string>();
  const toolClosures = new Map<string, HarnessEventEnvelope[]>();
  const orphanResultEvents: HarnessEventEnvelope[] = [];
  const unidentifiedToolEvents: HarnessEventEnvelope[] = [];
  const evidenceById = new Map<string, { event: HarnessEventEnvelope; record: Record<string, JsonValue> }>();
  const requestStarts = new Map<string, HarnessEventEnvelope>();
  const requestFinishes = new Map<string, HarnessEventEnvelope[]>();
  const stepEvents = new Map<string, HarnessEventEnvelope[]>();
  const stepResponses = new Map<string, HarnessEventEnvelope[]>();
  const mutationStarts = new Map<string, HarnessEventEnvelope>();
  const mutationMissingEvidence: string[] = [];
  const mutationMissingEvidenceEvents: HarnessEventEnvelope[] = [];
  const unresolvedEvidenceIds: string[] = [];
  const mismatchedEvidenceIds: string[] = [];

  for (const event of sorted) {
    if (!isKnownHarnessEventType(event.type)) unknownEventTypes.add(event.type);
    if (includeTimeline) {
      timeline.push({
        eventId: event.eventId,
        seq: event.seq,
        type: event.type,
        timestamp: event.timestamp,
      ...(event.correlation ? { correlation: event.correlation } : {}),
      summary: eventSummary(event),
      ...(event.type === 'decision_record'
        ? (() => {
            const decision = record(record(event.data)?.record);
            const category = stringValue(decision?.decisionCategory);
            return category ? { decisionCategory: compact(category, 40) } : {};
          })()
        : {}),
      });
    }
    const evidence = evidenceKind(event.type);
    if (includeRawEvidence && evidence) {
      rawEvidence.push({ eventId: event.eventId, seq: event.seq, kind: evidence, type: event.type, data: event.data });
    }

    const stepId = stepIdOf(event);
    if (stepId) {
      const eventsForStep = stepEvents.get(stepId) || [];
      eventsForStep.push(event);
      stepEvents.set(stepId, eventsForStep);
    }
    if (event.type === 'model_response' && stepId) {
      const responses = stepResponses.get(stepId) || [];
      responses.push(event);
      stepResponses.set(stepId, responses);
    }
    if (event.type === 'tool_evidence') {
      const recordValue = record(record(event.data)?.record);
      const id = stringValue(recordValue?.id);
      if (recordValue && id) evidenceById.set(id, { event, record: recordValue });
    }
    if (event.type === 'file_changed' && evidenceReferences(event).length === 0) mutationMissingEvidenceEvents.push(event);
    if (event.type === 'llm_request_started') {
      const identity = requestIdentity(event);
      if (identity) requestStarts.set(identity.requestId, event);
    }
    if (event.type === 'llm_request_finished') {
      const identity = requestIdentity(event);
      if (identity) {
        const finishes = requestFinishes.get(identity.requestId) || [];
        finishes.push(event);
        requestFinishes.set(identity.requestId, finishes);
      }
    }

    if (event.type === 'state') latestState = event.data;
    if (event.type === 'checkpoint') latestCheckpoint = event.data;
    if (event.type === 'progress') latestProgress = typeof event.data === 'string' ? event.data : stringValue(record(event.data)?.message);
    if (event.type === 'task_analysis_ready') taskAnalysis = toCoderTaskAnalysisView(record(event.data)?.taskAnalysis);
    if (event.type === 'tool_started') {
      const identity = toolIdentity(event);
      if (!identity) {
        unidentifiedToolEvents.push(event);
      } else {
        if (toolStarts.has(identity.toolCallId)) {
          duplicateStartCallIds.add(identity.toolCallId);
          addViolation('duplicate_tool_start', `Tool call ${identity.toolCallId} started more than once.`, [toolStarts.get(identity.toolCallId)!, event]);
        }
        toolStarts.set(identity.toolCallId, event);
        toolClosures.set(identity.toolCallId, toolClosures.get(identity.toolCallId) || []);
        if (getToolCapabilities(identity.tool).mutating) mutationStarts.set(identity.toolCallId, event);
        active.set(identity.toolCallId, { ...identity, startedAt: event.timestamp });
      }
    }
    if (event.type === 'tool_result' || event.type === 'tool_outcome_unknown') {
      const identity = toolIdentity(event);
      if (!identity) {
        unidentifiedToolEvents.push(event);
      } else {
        const closures = toolClosures.get(identity.toolCallId) || [];
        closures.push(event);
        toolClosures.set(identity.toolCallId, closures);
        if (!toolStarts.has(identity.toolCallId)) orphanResultEvents.push(event);
        active.delete(identity.toolCallId);
        const start = toolStarts.get(identity.toolCallId);
        if (start) {
          const startedIdentity = toolIdentity(start);
          if (startedIdentity && ((identity.stepId && startedIdentity.stepId && identity.stepId !== startedIdentity.stepId) ||
              (identity.requestId && startedIdentity.requestId && identity.requestId !== startedIdentity.requestId))) {
            addViolation('tool_correlation_mismatch', `Tool call ${identity.toolCallId} result correlation does not match its start.`, [start, event]);
          }
        }
        if (event.type !== 'tool_outcome_unknown' && getToolCapabilities(identity.tool).mutating) {
          const refs = evidenceReferences(event);
          if (!refs.length) mutationMissingEvidence.push(identity.toolCallId);
          for (const ref of refs) {
            const evidenceRecord = evidenceById.get(ref);
            if (!evidenceRecord) unresolvedEvidenceIds.push(ref);
            else if (stringValue(evidenceRecord.record.action) !== identity.tool) mismatchedEvidenceIds.push(ref);
          }
        }
      }
    }
    if (['done', 'stopped', 'interrupted', 'killed'].includes(event.type)) {
      terminal = { eventId: event.eventId, type: event.type, data: event.data, timestamp: event.timestamp };
    }
  }

  const startedCallIds = [...toolStarts.keys()];
  const closedCallIds = [...toolClosures.entries()].filter(([, closures]) => closures.length > 0).map(([id]) => id);
  const unmatchedCallIds = startedCallIds.filter((id) => !(toolClosures.get(id)?.length));
  const duplicateResultCallIds = [...toolClosures.entries()].filter(([, closures]) => closures.length > 1).map(([id]) => id);
  if (unidentifiedToolEvents.length) addViolation('unidentified_tool_event', 'A tool lifecycle event is missing its stable tool-call ID.', unidentifiedToolEvents);
  if (orphanResultEvents.length) addViolation('orphan_tool_result', 'A tool result has no durable tool start.', orphanResultEvents);
  if (unmatchedCallIds.length) addViolation('unmatched_tool_start', `Tool calls have no durable result or unknown-outcome repair: ${unmatchedCallIds.join(', ')}.`, unmatchedCallIds.map((id) => toolStarts.get(id)!).filter(Boolean));
  if (duplicateResultCallIds.length) addViolation('duplicate_tool_result', `Tool calls have more than one durable closure: ${duplicateResultCallIds.join(', ')}.`, duplicateResultCallIds.flatMap((id) => toolClosures.get(id) || []));

  const startedRequestIds = [...requestStarts.keys()];
  const finishedRequestIds = [...requestFinishes.keys()];
  const openRequestIds = startedRequestIds.filter((id) => !(requestFinishes.get(id)?.length));
  const duplicateFinishRequestIds = [...requestFinishes.entries()].filter(([, finishes]) => finishes.length > 1).map(([id]) => id);
  if (openRequestIds.length) addViolation('open_model_request', `Model requests have no durable terminal envelope: ${openRequestIds.join(', ')}.`, openRequestIds.map((id) => requestStarts.get(id)!).filter(Boolean));
  if (duplicateFinishRequestIds.length) addViolation('duplicate_model_request_finish', `Model requests have more than one terminal envelope: ${duplicateFinishRequestIds.join(', ')}.`, duplicateFinishRequestIds.flatMap((id) => requestFinishes.get(id) || []));

  const stepIds = [...stepEvents.keys()];
  const orphanStepEvents: HarnessEventEnvelope[] = [];
  const stepViolations: string[] = [];
  for (const [stepId, eventsForStep] of stepEvents) {
    const responses = stepResponses.get(stepId) || [];
    const toolEvents = eventsForStep.filter((event) => ['tool_started', 'tool_result', 'tool_outcome_unknown'].includes(event.type));
    if (toolEvents.length && responses.length === 0) {
      orphanStepEvents.push(...toolEvents);
      stepViolations.push(`step ${stepId} contains tool lifecycle events but no model response`);
    }
    for (const response of responses) {
      const identity = toolIdentity(response);
      if (identity?.toolCallId && !toolStarts.has(identity.toolCallId)) {
        orphanStepEvents.push(response);
        stepViolations.push(`step ${stepId} response references tool call ${identity.toolCallId} without a start`);
      }
    }
  }
  if (orphanStepEvents.length) addViolation('step_enclosure', stepViolations.join('; '), orphanStepEvents);

  const missingEvidenceCallIds = [...new Set(mutationMissingEvidence)];
  const unresolvedEvidence = [...new Set(unresolvedEvidenceIds)];
  const mismatchedEvidence = [...new Set(mismatchedEvidenceIds)];
  if (missingEvidenceCallIds.length) addViolation('missing_mutation_evidence', `Completed mutating calls do not reference tool evidence: ${missingEvidenceCallIds.join(', ')}.`, missingEvidenceCallIds.map((id) => toolStarts.get(id)!).filter(Boolean));
  if (mutationMissingEvidenceEvents.length) addViolation('unreferenced_file_change', 'A durable file-change mutation has no tool-evidence reference.', mutationMissingEvidenceEvents);
  if (unresolvedEvidence.length) addViolation('unresolved_mutation_evidence', `Mutation events reference missing evidence IDs: ${unresolvedEvidence.join(', ')}.`, sorted.filter((event) => evidenceReferences(event).some((ref) => unresolvedEvidence.includes(ref))));
  if (mismatchedEvidence.length) addViolation('mismatched_mutation_evidence', `Mutation events reference evidence for another tool: ${mismatchedEvidence.join(', ')}.`, sorted.filter((event) => evidenceReferences(event).some((ref) => mismatchedEvidence.includes(ref))));

  const sequenceValid = missingSequences.length === 0 && duplicateSequences.length === 0;
  const callResultValid = unmatchedCallIds.length === 0 && orphanResultEvents.length === 0 && duplicateStartCallIds.size === 0 && duplicateResultCallIds.length === 0 && unidentifiedToolEvents.length === 0;
  const requestPairingValid = openRequestIds.length === 0 && duplicateFinishRequestIds.length === 0;
  const turnStepValid = orphanStepEvents.length === 0;
  const mutationEvidenceValid = missingEvidenceCallIds.length === 0 && mutationMissingEvidenceEvents.length === 0 && unresolvedEvidence.length === 0 && mismatchedEvidence.length === 0;
  const replayInvariants: HarnessReplayInvariants = {
    valid: sequenceValid && callResultValid && requestPairingValid && turnStepValid && mutationEvidenceValid,
    sequence: { valid: sequenceValid, missingSequences, duplicateSequences },
    turnStepEnclosure: { valid: turnStepValid, stepIds, orphanEventIds: [...new Set(orphanStepEvents.map((event) => event.eventId))], violations: stepViolations },
    callResultPairing: {
      valid: callResultValid,
      startedCallIds,
      closedCallIds,
      unmatchedCallIds,
      orphanResultEventIds: orphanResultEvents.map((event) => event.eventId),
      duplicateStartCallIds: [...duplicateStartCallIds],
      duplicateResultCallIds,
      unidentifiedEventIds: unidentifiedToolEvents.map((event) => event.eventId),
    },
    requestPairing: { valid: requestPairingValid, startedRequestIds, finishedRequestIds, openRequestIds, duplicateFinishRequestIds },
    mutationEvidence: {
      valid: mutationEvidenceValid,
      mutationCallIds: [...mutationStarts.keys()],
      missingEvidenceCallIds,
      missingEvidenceEventIds: mutationMissingEvidenceEvents.map((event) => event.eventId),
      unresolvedEvidenceIds: unresolvedEvidence,
      mismatchedEvidenceIds: mismatchedEvidence,
    },
    violations,
  };

  return {
    runId: first?.runId || '',
    sessionId: first?.sessionId || first?.runId || '',
    eventCount: sorted.length,
    lastSeq: sorted.at(-1)?.seq || 0,
    contiguous: missingSequences.length === 0 && duplicateSequences.length === 0,
    missingSequences,
    duplicateSequences,
    timeline,
    rawEvidence,
    activeTools: [...active.values()],
    ...(latestState !== undefined ? { latestState } : {}),
    ...(latestCheckpoint !== undefined ? { latestCheckpoint } : {}),
    ...(latestProgress !== undefined ? { latestProgress } : {}),
    ...(taskAnalysis ? { taskAnalysis } : {}),
    ...(todo ? { todo } : {}),
    ...(terminal ? { terminal } : {}),
    unknownEventTypes: [...unknownEventTypes],
    replayInvariants,
  };
}
