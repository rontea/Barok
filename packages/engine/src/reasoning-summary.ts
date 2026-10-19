export interface VisibleReasoningSummaryInput {
  providerReasoningSummary: string;
  modelReasoningSummary: string;
  actionRationale: string;
  actionSummary: string;
}

export type VisibleReasoningSummary = {
  summary: string;
  origin: 'engine' | 'model' | 'provider';
};

const GENERIC_REASONING_SUMMARY_RE = /^use the current task evidence (?:and select the next concrete tool action|to choose the next concrete action)\.?$/i;

function isGenericReasoningSummary(value: string): boolean {
  return GENERIC_REASONING_SUMMARY_RE.test(value.replace(/\s+/g, ' ').trim());
}

function isPlannerProtocolEcho(value: string): boolean {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return /^Selected tool\s*:/i.test(normalized) ||
    (/^Planner decision\s+\d+\s*:/i.test(normalized) && /\bSelected tool\s*:\s*[A-Za-z][\w.-]*\s*\(/i.test(normalized));
}

export function selectVisibleReasoningSummary({
  providerReasoningSummary,
  modelReasoningSummary,
  actionRationale,
  actionSummary,
}: VisibleReasoningSummaryInput): VisibleReasoningSummary {
  const providerSummary = providerReasoningSummary.trim();
  const usableProviderSummary = isGenericReasoningSummary(providerSummary) || isPlannerProtocolEcho(providerSummary) ? '' : providerSummary;
  const modelSummary = modelReasoningSummary.trim();
  const usableModelSummary = isGenericReasoningSummary(modelSummary) || isPlannerProtocolEcho(modelSummary) ? '' : modelSummary;
  const rawRationale = actionRationale.trim();
  const rationale = isPlannerProtocolEcho(rawRationale) ? '' : rawRationale;
  const summary = actionSummary.trim();

  if (usableProviderSummary) return { summary: usableProviderSummary, origin: 'provider' };
  if (rationale) return { summary: rationale, origin: 'model' };
  if (usableModelSummary) return { summary: usableModelSummary, origin: 'model' };
  if (summary) return { summary, origin: 'engine' };
  return { summary: '', origin: 'engine' };
}
