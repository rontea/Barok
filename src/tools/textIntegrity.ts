/**
 * Guards the text-only file tools against payloads that have already been
 * damaged by a provider, a decoder, or an agent-generated escape sequence.
 *
 * The file tools write UTF-8 text. U+FFFD and most C0/C1 control characters
 * are therefore strong signals that a text payload was decoded incorrectly,
 * rather than intentional source content. Newline, carriage return, tab, and
 * form feed remain valid because they are common in source and documents.
 */

const REPLACEMENT_CHARACTER = '\uFFFD';

export interface TextIntegrityResult {
  valid: boolean;
  error?: string;
}

export function validateTextIntegrity(content: string, filePath = 'file'): TextIntegrityResult {
  const replacementIndex = content.indexOf(REPLACEMENT_CHARACTER);
  if (replacementIndex !== -1) {
    return {
      valid: false,
      error: `Write rejected for ${filePath}: content contains the Unicode replacement character (U+FFFD) at character ${replacementIndex}. The payload is likely corrupted or was decoded with data loss.`,
    };
  }

  for (let index = 0; index < content.length; index += 1) {
    const codePoint = content.codePointAt(index)!;
    const isForbiddenControl =
      (codePoint >= 0x00 && codePoint <= 0x08) ||
      codePoint === 0x0B ||
      (codePoint >= 0x0E && codePoint <= 0x1F) ||
      (codePoint >= 0x7F && codePoint <= 0x9F);
    if (!isForbiddenControl) {
      if (codePoint > 0xFFFF) index += 1;
      continue;
    }

    const formattedCodePoint = codePoint.toString(16).toUpperCase().padStart(4, '0');
    return {
      valid: false,
      error: `Write rejected for ${filePath}: content contains control character U+${formattedCodePoint} at character ${index}. The text payload is likely corrupted.`,
    };
  }

  return { valid: true };
}

export function decodeBase64Utf8(encoded: string): { content?: string; error?: string } {
  const normalized = encoded.trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    return { error: 'content_base64 must be valid base64-encoded UTF-8 content.' };
  }

  try {
    const bytes = Buffer.from(normalized, 'base64');
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { content };
  } catch {
    return { error: 'content_base64 contains invalid UTF-8 bytes.' };
  }
}
