export interface PendingUserQuestion {
  runId: string;
  requestId: string;
  question: string;
  options: string[];
  allowFreeform: boolean;
  context?: string;
}

/** Convert the durable user-input request returned by the run API into UI state. */
export function normalizePendingUserQuestion(runId: string, value: unknown): PendingUserQuestion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  const requestId = typeof request.requestId === 'string' ? request.requestId.trim() : '';
  const question = typeof request.question === 'string' ? request.question.trim() : '';
  if (!runId || !requestId || !question) return null;

  const options = Array.isArray(request.options)
    ? Array.from(new Set(request.options.filter((option): option is string => typeof option === 'string')
      .map((option) => option.trim())
      .filter(Boolean)))
    : [];
  const context = typeof request.context === 'string' ? request.context.trim() : '';

  return {
    runId,
    requestId,
    question,
    options,
    allowFreeform: request.allowFreeform !== false || options.length === 0,
    ...(context ? { context } : {}),
  };
}
