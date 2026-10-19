const SUPPORTED_FILE_EXTENSIONS =
  '(?:tsx|ts|jsx|js|json|md|css|html|cjs|mjs|yml|yaml|xaml|cs|py|sh|pdf|docx)';
const FILE_EXTENSION_PATTERN = new RegExp(`\\.${SUPPORTED_FILE_EXTENSIONS}`, 'gi');

function cleanFilePathCandidate(value: string): string {
  return value
    .trim()
    .replace(/^['"`;,[\](){}]+|['"`,;:()[\]{}]+$/g, '')
    .replace(/\\/g, '/');
}

/**
 * Splits adjacent file names that lost their separators in a prompt or
 * continuation handoff, such as `index.htmlstyles.cssscript.js`.
 *
 * The model may still produce a genuinely unusual file name containing a
 * known extension, so this only splits at repeated known extensions and
 * leaves ordinary candidates unchanged.
 */
export function splitConcatenatedFilePath(value: string): string[] {
  const normalized = value.trim();
  if (!normalized) return [];

  const parts: string[] = [];
  let cursor = 0;
  for (const match of normalized.matchAll(FILE_EXTENSION_PATTERN)) {
    const end = (match.index ?? 0) + match[0].length;
    const part = cleanFilePathCandidate(normalized.slice(cursor, end));
    if (part) parts.push(part);
    cursor = end;
  }

  if (parts.length === 0) {
    const candidate = cleanFilePathCandidate(normalized);
    return candidate ? [candidate] : [];
  }

  const remainder = cleanFilePathCandidate(normalized.slice(cursor));
  if (remainder) parts.push(remainder);

  return Array.from(new Set(parts));
}

/** Splits, normalizes, and deduplicates a readonly list of file path candidates. */
export function normalizeFilePathCandidates(
  values: readonly string[],
): string[] {
  return Array.from(new Set(values.flatMap(splitConcatenatedFilePath).filter(Boolean)));
}
