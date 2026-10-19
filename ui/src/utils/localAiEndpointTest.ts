export const LOCAL_AI_TEST_RESULTS_KEY = 'barok.localAiEndpointTests';
export const LOCAL_AI_TEST_RESULTS_EVENT = 'barok:local-ai-test-results-updated';
export const LOCAL_AI_TEST_RESULT_MAX_AGE_MS = 15 * 60 * 1_000;

export interface LocalAiEndpointTestResult {
  endpointId: string;
  endpointName: string;
  status: 'healthy' | 'error';
  message: string;
  details?: string;
  testedAt: number;
  latencyMs?: number;
  endpointBaseUrl?: string;
  modelId?: string;
}

export function readLocalAiEndpointTestResults(): Record<string, LocalAiEndpointTestResult> {
  if (typeof window === 'undefined') return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(LOCAL_AI_TEST_RESULTS_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
      .filter((entry): entry is [string, LocalAiEndpointTestResult] => {
        const value = entry[1] as Partial<LocalAiEndpointTestResult> | null;
        return Boolean(value && typeof value === 'object'
          && (value.status === 'healthy' || value.status === 'error')
          && typeof value.endpointName === 'string'
          && typeof value.message === 'string'
          && Number.isFinite(value.testedAt));
      })
      .slice(-50));
  } catch {
    return {};
  }
}

export function saveLocalAiEndpointTestResult(result: LocalAiEndpointTestResult): void {
  if (typeof window === 'undefined') return;
  const existing = readLocalAiEndpointTestResults();
  const next = { ...existing, [result.endpointId]: result };
  const bounded = Object.fromEntries(Object.entries(next).slice(-50));
  try {
    window.localStorage.setItem(LOCAL_AI_TEST_RESULTS_KEY, JSON.stringify(bounded));
    window.dispatchEvent(new CustomEvent(LOCAL_AI_TEST_RESULTS_EVENT));
  } catch {
    // Status remains visible for this settings panel session when storage is unavailable.
  }
}

export function isCurrentLocalAiEndpointFailure(
  result: LocalAiEndpointTestResult | undefined,
  selectedEndpoint?: { baseUrl?: string; modelId?: string },
  now = Date.now(),
): result is LocalAiEndpointTestResult {
  return Boolean(result && result.status === 'error'
    && Number.isFinite(result.testedAt)
    && now >= result.testedAt
    && (!selectedEndpoint?.baseUrl || !result.endpointBaseUrl || selectedEndpoint.baseUrl === result.endpointBaseUrl)
    && (!selectedEndpoint?.modelId || !result.modelId || selectedEndpoint.modelId === result.modelId)
    && now - result.testedAt <= LOCAL_AI_TEST_RESULT_MAX_AGE_MS);
}
