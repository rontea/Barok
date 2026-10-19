export interface UnknownToolOutcome {
  toolCallId: string;
  tool: string;
  input?: Record<string, unknown>;
  requestId?: string;
  stepId?: string;
  startedAt?: number;
  repairedAt: number;
  reason: string;
  retryPolicy: 'verify_before_retry';
}

export interface UnknownRequestOutcome {
  requestId: string;
  stepId?: string;
  request: Record<string, unknown>;
  startedAt?: number;
  repairedAt: number;
  reason: string;
}

interface LifecycleEvent {
  eventType: string;
  event: unknown;
}

interface ToolStartedPayload {
  type?: unknown;
  tool?: unknown;
  input?: unknown;
  requestId?: unknown;
  stepId?: unknown;
  toolCallId?: unknown;
  outcome?: UnknownToolOutcome;
}

function payloadOf(event: LifecycleEvent): ToolStartedPayload | undefined {
  const rawEvent = event.event;
  const data = rawEvent && typeof rawEvent === 'object' && !Array.isArray(rawEvent)
    ? (rawEvent as { data?: unknown }).data
    : undefined;
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data as ToolStartedPayload
    : undefined;
}

function eventTimestamp(event: unknown): number | undefined {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return undefined;
  const timestamp = (event as { timestamp?: unknown }).timestamp;
  return typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : undefined;
}

function boundedRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100));
}

function requestPayloadOf(event: LifecycleEvent): Record<string, unknown> | undefined {
  const rawEvent = event.event;
  const data = rawEvent && typeof rawEvent === 'object' && !Array.isArray(rawEvent)
    ? (rawEvent as { data?: unknown }).data
    : undefined;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const request = (data as { request?: unknown }).request;
  return request && typeof request === 'object' && !Array.isArray(request)
    ? request as Record<string, unknown>
    : undefined;
}

/** Find model requests whose durable start has no terminal envelope. */
export function findUnfinishedModelRequests(events: LifecycleEvent[]): UnknownRequestOutcome[] {
  const started = new Map<string, UnknownRequestOutcome>();
  const closed = new Set<string>();

  for (const event of events) {
    const request = requestPayloadOf(event);
    if (!request) continue;
    const requestId = typeof request?.requestId === 'string' ? request.requestId : '';
    if (!requestId) continue;
    if (event.eventType === 'llm_request_started') {
      if (closed.has(requestId)) continue;
      started.set(requestId, {
        requestId,
        ...(typeof request.stepId === 'string' ? { stepId: request.stepId } : {}),
        request: { ...request },
        ...(eventTimestamp(event.event) !== undefined ? { startedAt: eventTimestamp(event.event) } : {}),
        repairedAt: 0,
        reason: '',
      });
      continue;
    }
    if (event.eventType === 'llm_request_finished') {
      closed.add(requestId);
      started.delete(requestId);
    }
  }

  return [...started.values()];
}

export function createUnknownRequestEnvelope(
  request: UnknownRequestOutcome,
  reason = 'The process stopped before a durable model request outcome was recorded.',
  repairedAt = Date.now(),
): Record<string, unknown> {
  const startedAt = typeof request.startedAt === 'number' ? request.startedAt : repairedAt;
  return {
    ...request.request,
    requestId: request.requestId,
    ...(request.stepId ? { stepId: request.stepId } : {}),
    status: 'unknown',
    completedAt: repairedAt,
    durationMs: Math.max(0, repairedAt - startedAt),
    error: reason.slice(0, 500),
  };
}

/** Find tool calls whose durable start has no durable result or repair outcome. */
export function findUnfinishedToolCalls(events: LifecycleEvent[]): UnknownToolOutcome[] {
  const started = new Map<string, UnknownToolOutcome>();
  const closed = new Set<string>();

  for (const event of events) {
    const payload = payloadOf(event);
    if (!payload) continue;
    const toolCallId = typeof payload?.toolCallId === 'string'
      ? payload.toolCallId
      : typeof payload?.outcome?.toolCallId === 'string'
        ? payload.outcome.toolCallId
        : '';
    if (!toolCallId) continue;

    if (event.eventType === 'tool_started' || payload?.type === 'tool_started') {
      if (closed.has(toolCallId)) continue;
      const tool = typeof payload.tool === 'string' ? payload.tool : 'unknown';
      started.set(toolCallId, {
        toolCallId,
        tool: tool.slice(0, 160),
        input: boundedRecord(payload.input),
        ...(typeof payload.requestId === 'string' ? { requestId: payload.requestId.slice(0, 160) } : {}),
        ...(typeof payload.stepId === 'string' ? { stepId: payload.stepId.slice(0, 160) } : {}),
        repairedAt: 0,
        ...(eventTimestamp(event.event) !== undefined
          ? { startedAt: eventTimestamp(event.event) }
          : {}),
        reason: '',
        retryPolicy: 'verify_before_retry',
      });
      continue;
    }

    if (event.eventType === 'tool_result' || event.eventType === 'tool_outcome_unknown' || payload?.type === 'tool_result' || payload?.type === 'tool_outcome_unknown') {
      closed.add(toolCallId);
      started.delete(toolCallId);
    }
  }

  return [...started.values()];
}

export function createUnknownToolOutcome(
  call: UnknownToolOutcome,
  reason = 'The process stopped after tool dispatch began but before a durable tool result was recorded.',
  repairedAt = Date.now(),
): UnknownToolOutcome {
  return {
    ...call,
    repairedAt,
    reason: reason.slice(0, 500),
    retryPolicy: 'verify_before_retry',
  };
}
