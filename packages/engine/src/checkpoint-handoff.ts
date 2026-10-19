import type {
  ReactCheckpoint,
  ReactCheckpointHandoff,
  ReactCheckpointRequestIdentity,
  ReactCheckpointState,
  ReactProgressCursor,
} from './checkpoint.js';

export interface ReactCheckpointHandoffEvent {
  eventId: string;
  seq: number;
  type: string;
  data?: unknown;
  correlation?: {
    requestId?: string;
    stepId?: string;
  };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function createReactProgressCursor(state: ReactCheckpointState): ReactProgressCursor {
  const remainingPlanItems = Array.isArray(state.plan)
    ? state.plan.filter((item) => item.status !== 'completed').map((item) => item.step).slice(0, 50)
    : [];
  const currentPlanItem = state.plan?.find((item) => item.status === 'in_progress')?.step || remainingPlanItems[0];
  const lastAction = state.lastRun?.lastAction;
  const lastMeaningfulProgress = lastAction
    ? `${lastAction}${state.lastRun?.lastActionSucceeded === false ? ' outcome recorded' : ' completed'}`
    : undefined;
  return {
    version: 1,
    currentStep: Math.max(0, Number(state.current_step) || 0),
    phase: state.codingState || 'understand',
    ...(currentPlanItem ? { currentPlanItem: currentPlanItem.slice(0, 500) } : {}),
    remainingPlanItems,
    ...(lastMeaningfulProgress ? { lastMeaningfulProgress: lastMeaningfulProgress.slice(0, 240) } : {}),
    ...(state.blockedReason ? { blockedReason: state.blockedReason.slice(0, 500) } : {}),
  };
}

/** True when a checkpoint records a successful source mutation. */
export function hasSuccessfulMutationInCheckpoint(
  checkpoint: Pick<ReactCheckpoint, 'state'>,
): boolean {
  return checkpoint.state.steps.some((step) => {
    if (!/^(?:write|edit)$/i.test(step.action)) return false;
    const observation = typeof step.observation === 'string' ? step.observation : '';
    if (!observation) return false;
    try {
      const parsed = JSON.parse(observation) as { success?: unknown; status?: unknown };
      if (parsed.success === false) return false;
      return parsed.status === undefined || ['passed', 'success', 'completed', 'ok'].includes(String(parsed.status).toLowerCase());
    } catch {
      return !/\b(error|failed|cancelled|canceled)\b/i.test(observation);
    }
  });
}

export function getCheckpointRequestIdentity(
  events: readonly ReactCheckpointHandoffEvent[],
): ReactCheckpointRequestIdentity | undefined {
  const requestEvent = [...events].reverse().find((event) =>
    event.type === 'llm_request_finished' || event.type === 'llm_request_started'
  );
  if (!requestEvent) return undefined;
  const data = objectValue(requestEvent.data);
  const request = objectValue(data?.request);
  const requestId = typeof request?.requestId === 'string' ? request.requestId : requestEvent.correlation?.requestId;
  if (!requestId) return undefined;
  const rawStatus = typeof request?.status === 'string'
    ? request.status
    : requestEvent.type === 'llm_request_started' ? 'started' : 'unknown';
  const status: ReactCheckpointRequestIdentity['status'] = rawStatus === 'started' || rawStatus === 'succeeded' || rawStatus === 'failed' || rawStatus === 'timed_out' || rawStatus === 'cancelled'
    ? rawStatus
    : 'unknown';
  const stepId = typeof request?.stepId === 'string' ? request.stepId : requestEvent.correlation?.stepId;
  return {
    requestId,
    eventId: requestEvent.eventId,
    status,
    ...(stepId ? { stepId } : {}),
  };
}

/** Create bounded event/evidence handoff metadata after the host allocates the checkpoint sequence. */
export function createReactCheckpointHandoff<TState extends ReactCheckpointState>(
  runId: string,
  eventSeq: number,
  checkpoint: ReactCheckpoint<TState>,
  priorEvents: readonly ReactCheckpointHandoffEvent[],
  previousCheckpoint?: ReactCheckpoint,
): ReactCheckpointHandoff {
  const previousEventSeq = previousCheckpoint?.handoff?.eventSeq || Math.max(0, eventSeq - 100);
  const eventIds = priorEvents
    .filter((event) => event.seq > previousEventSeq)
    .map((event) => event.eventId)
    .slice(-100);
  eventIds.push(`${runId}:${eventSeq}`);
  const checkpointState = checkpoint.state as TState & { toolEvidence?: readonly { id?: unknown }[] };
  const evidenceIds = (checkpointState.toolEvidence || [])
    .map((record) => record.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .slice(-50);
  const requestEnvelope = getCheckpointRequestIdentity(priorEvents);
  return {
    version: 1,
    eventSeq,
    ...(requestEnvelope ? { requestEnvelope } : {}),
    evidenceWindow: {
      startStep: Math.max(0, Number(checkpoint.state.evidenceStartStep) || 0),
      endStep: Math.max(0, Number(checkpoint.state.current_step) || 0),
      startEventSeq: previousEventSeq + 1,
      endEventSeq: eventSeq,
      eventIds: [...new Set(eventIds)],
      evidenceIds,
    },
    progressCursor: createReactProgressCursor(checkpoint.state),
  };
}
