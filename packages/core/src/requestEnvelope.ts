export const REQUEST_ENVELOPE_SCHEMA_VERSION = 1 as const;

export type RequestEnvelopeStatus =
  | 'started'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'cancelled'
  | 'unknown';

export interface RequestEnvelopeRoute {
  provider: string;
  model: string;
  profileId?: string;
  credentialIndex?: number;
}

export interface RequestEnvelope {
  schemaVersion: typeof REQUEST_ENVELOPE_SCHEMA_VERSION;
  requestId: string;
  stepId?: string;
  requestKind?: string;
  status: RequestEnvelopeStatus;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  requestedRoute: RequestEnvelopeRoute;
  resolvedRoute?: RequestEnvelopeRoute;
  context?: {
    taskHash?: string;
    workspaceHash?: string;
    repositoryCommitHash?: string;
  };
  input: {
    messageCount: number;
    messageRoles: string[];
    contentCharacters: number;
    contentHash: string;
    contentPolicy: 'hash_only';
  };
  /** Estimated prompt tokens by planner section; this stores no prompt text. */
  categoryTokens?: {
    task: number;
    plan: number;
    evidence: number;
    activeErrors: number;
    memory: number;
    history: number;
    system: number;
  };
  tools?: {
    schemaVersion?: string;
    names: string[];
    schemaHash: string;
  };
  options?: {
    modelContextWindow?: number;
    maxTokens?: number;
    timeoutMs?: number;
    responseFormat?: 'text' | 'json';
    stream?: boolean;
    role?: string;
  };
  response?: {
    textCharacters?: number;
    textHash?: string;
    toolCallCount?: number;
    finishReason?: string;
    providerRequestId?: string;
  };
  error?: string;
}

export interface CreateRequestEnvelopeInput {
  requestId: string;
  stepId?: string;
  requestKind?: string;
  status: RequestEnvelopeStatus;
  startedAt: number;
  completedAt?: number;
  requestedRoute: RequestEnvelopeRoute;
  resolvedRoute?: RequestEnvelopeRoute;
  taskId?: string;
  workspaceId?: string;
  repositoryCommitHash?: string;
  messages: Array<{ role: string; content: string }>;
  categoryTokens?: RequestEnvelope['categoryTokens'];
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters: Record<string, unknown>;
    };
  }>;
  toolSchemaVersion?: string;
  modelContextWindow?: number;
  maxTokens?: number;
  timeoutMs?: number;
  responseFormat?: 'text' | 'json';
  stream?: boolean;
  role?: string;
  response?: RequestEnvelope['response'];
  error?: string;
}

function hashValue(value: unknown, hashSerializedValue: (serialized: string) => string): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? 'null';
  } catch {
    serialized = JSON.stringify({ unhashable: true, valueType: typeof value });
  }
  return hashSerializedValue(serialized);
}

function optionalHash(
  value: string | undefined,
  hashSerializedValue: (serialized: string) => string,
): string | undefined {
  const normalized = value?.trim();
  return normalized ? hashValue(normalized, hashSerializedValue) : undefined;
}

function boundedRoute(route: RequestEnvelopeRoute): RequestEnvelopeRoute {
  return {
    provider: route.provider.slice(0, 120),
    model: route.model.slice(0, 240),
    ...(route.profileId ? { profileId: route.profileId.slice(0, 120) } : {}),
    ...(route.credentialIndex !== undefined ? { credentialIndex: route.credentialIndex } : {}),
  };
}

function boundedError(error: string | undefined): string | undefined {
  const normalized = error?.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 500) : undefined;
}

/**
 * Build a durable request description without retaining prompt or completion
 * contents. Hashes make a request reconstructable against an external trace
 * or replay fixture while keeping source and user content out of the event log.
 */
export function createRequestEnvelope(
  input: CreateRequestEnvelopeInput,
  hashSerializedValue: (serialized: string) => string,
): RequestEnvelope {
  const messages = input.messages.map((message) => ({
    role: String(message.role).slice(0, 40),
    content: String(message.content),
  }));
  const tools = input.tools?.slice(0, 100).map((tool) => ({
    type: tool.type,
    function: {
      name: String(tool.function.name).slice(0, 160),
      description: tool.function.description?.slice(0, 500),
      parameters: tool.function.parameters,
    },
  }));
  const startedAt = Number.isFinite(input.startedAt) ? input.startedAt : Date.now();
  const completedAt = input.completedAt !== undefined && Number.isFinite(input.completedAt)
    ? input.completedAt
    : undefined;
  const contentCharacters = messages.reduce((total, message) => total + message.content.length, 0);
  const taskHash = optionalHash(input.taskId, hashSerializedValue);
  const workspaceHash = optionalHash(input.workspaceId, hashSerializedValue);
  const error = boundedError(input.error);
  const envelope: RequestEnvelope = {
    schemaVersion: REQUEST_ENVELOPE_SCHEMA_VERSION,
    requestId: input.requestId,
    ...(input.stepId ? { stepId: input.stepId } : {}),
    ...(input.requestKind ? { requestKind: input.requestKind.slice(0, 120) } : {}),
    status: input.status,
    startedAt,
    ...(completedAt !== undefined ? { completedAt } : {}),
    ...(completedAt !== undefined ? { durationMs: Math.max(0, completedAt - startedAt) } : {}),
    requestedRoute: boundedRoute(input.requestedRoute),
    ...(input.resolvedRoute ? { resolvedRoute: boundedRoute(input.resolvedRoute) } : {}),
    context: {
      ...(taskHash ? { taskHash } : {}),
      ...(workspaceHash ? { workspaceHash } : {}),
      ...(input.repositoryCommitHash?.trim() ? { repositoryCommitHash: input.repositoryCommitHash.trim().slice(0, 160) } : {}),
    },
    input: {
      messageCount: messages.length,
      messageRoles: messages.map((message) => message.role),
      contentCharacters,
      contentHash: hashValue(messages, hashSerializedValue),
      contentPolicy: 'hash_only',
    },
    ...(input.categoryTokens ? {
      categoryTokens: Object.fromEntries(
        Object.entries(input.categoryTokens).map(([key, value]) => [
          key,
          Number.isFinite(value) ? Math.max(0, Math.min(1_000_000_000, Math.floor(value))) : 0,
        ]),
      ) as NonNullable<RequestEnvelope['categoryTokens']>,
    } : {}),
    ...(tools?.length ? {
      tools: {
        ...(input.toolSchemaVersion ? { schemaVersion: input.toolSchemaVersion.slice(0, 120) } : {}),
        names: tools.map((tool) => tool.function.name),
        schemaHash: hashValue(tools, hashSerializedValue),
      },
    } : {}),
    options: {
      ...(input.modelContextWindow !== undefined ? { modelContextWindow: input.modelContextWindow } : {}),
      ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.responseFormat ? { responseFormat: input.responseFormat } : {}),
      ...(input.stream !== undefined ? { stream: input.stream } : {}),
      ...(input.role ? { role: input.role.slice(0, 80) } : {}),
    },
    ...(input.response ? { response: input.response } : {}),
    ...(error ? { error } : {}),
  };
  return envelope;
}

export function hashRequestText(
  text: string,
  hashSerializedValue: (serialized: string) => string,
): string {
  return hashValue(text, hashSerializedValue);
}
