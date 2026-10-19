const REQUEST_HEADER = /(?:^|\n)\s*(?:(?:current|user|implementation)\s+)?(?:request|task|goal|objective)\s*[:\-]\s*/i;
const HAS_PROMPT_SCAFFOLDING = /(?:^|\n)\s*(?:system\s+(?:role|prompt)|preamble|assistant\s+instructions?)\s*:/i;
const ACTION_LINE = /^\s*(?:[-*]\s*)?(?:please\s+)?(?:build|create|implement|add|fix|refactor|update|inspect|review|write|test|generate|remove|debug|explain|document|can you\b|could you\b|i need\b)\b/i;
const GENERIC_THREAD_TITLES = new Set(['', 'new coder thread', 'new conversation', 'untitled']);

const normalizeActionableText = (value: string): string => {
  let text = value.replace(/\r\n?/g, '\n').trim();
  const requestHeader = REQUEST_HEADER.exec(text);
  if (requestHeader) {
    text = text.slice(requestHeader.index + requestHeader[0].length);
  } else if (HAS_PROMPT_SCAFFOLDING.test(text)) {
    text = text.split('\n').find((line) => ACTION_LINE.test(line)) || '';
  }

  const firstLine = text
    .split('\n')
    .map((line) => line.trim().replace(/^```[a-z0-9_-]*\s*/i, '').replace(/^[#>*\s-]+/, '').trim())
    .find(Boolean);
  return (firstLine || '')
    .replace(/^(?:request|task|goal|objective)\s*[:\-]\s*/i, '')
    .replace(/^['"`]+|['"`]+$/g, '')
    .trim();
};

const truncateTitle = (value: string): string =>
  value.length > 60 ? `${value.slice(0, 57).trimEnd()}...` : value;

/** Removes prompt scaffolding from coder thread titles and derives a safe fallback from the first user message. */
export function sanitizeCoderThreadTitle(title: unknown, messages: unknown = []): string {
  const candidate = typeof title === 'string' ? title.trim() : '';
  const normalizedCandidate = GENERIC_THREAD_TITLES.has(candidate.toLowerCase())
    ? ''
    : normalizeActionableText(candidate);
  if (normalizedCandidate) return truncateTitle(normalizedCandidate);

  const userMessage = Array.isArray(messages)
    ? messages.find((message) => Boolean(message && typeof message === 'object' && (message as { role?: unknown }).role === 'user'))
    : undefined;
  const userContent = userMessage && typeof userMessage === 'object'
    ? (userMessage as { content?: unknown }).content
    : undefined;
  const normalizedUserContent = normalizeActionableText(typeof userContent === 'string' ? userContent : '');
  return normalizedUserContent ? truncateTitle(normalizedUserContent) : 'New coder thread';
}
