/**
 * Provider response text normalization and safe JSON extraction for planner actions.
 * These helpers only parse text; they never evaluate provider output.
 */

/**
 * Helper: Fix JSON strings with escaped characters
 */
export function fixJsonString(jsonStr: string): string {
  let isInsideString = false;
  let isEscaped = false;
  let stringStartIndex = -1;
  let isWindowsPathString = false;
  let newStr = '';

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (char === '"' && !isEscaped) {
      isInsideString = !isInsideString;
      if (isInsideString) {
        stringStartIndex = i + 1;
        isWindowsPathString = false;
      } else {
        stringStartIndex = -1;
        isWindowsPathString = false;
      }
      newStr += char;
    } else if (isInsideString) {
      if (char === '\n') {
        newStr += '\\n';
        isEscaped = false;
      } else if (char === '\r') {
        newStr += '\\r';
        isEscaped = false;
      } else if (char === '\t') {
        newStr += '\\t';
        isEscaped = false;
      } else if (char === '\\' && !isEscaped) {
        const peek = jsonStr[i + 1];
        if (
          isWindowsPathString ||
          (stringStartIndex >= 0 && /^[A-Za-z]:$/.test(jsonStr.slice(stringStartIndex, i)))
        ) {
          isWindowsPathString = true;
          if (peek === '\\') {
            // Already escaped JSON path separator; preserve the pair.
            newStr += char;
            isEscaped = true;
          } else {
            // A model-written Windows path often contains raw separators.
            // Escape even JSON-significant sequences such as \n and \t so
            // JSON.parse cannot turn the filename into control characters.
            newStr += '\\\\';
            isEscaped = false;
          }
          continue;
        }

        isEscaped = true;
        const validUnicodeEscape =
          peek === 'u' && /^[0-9a-fA-F]{4}$/.test(jsonStr.slice(i + 2, i + 6));
        if (
          peek &&
          (
            !['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'].includes(peek) ||
            (peek === 'u' && !validUnicodeEscape)
          )
        ) {
          newStr += '\\\\';
        } else {
          newStr += char;
        }
      } else {
        isEscaped = false;
        newStr += char;
      }
    } else {
      newStr += char;
    }
  }

  return newStr;
}

export function balanceTrailingJsonObject(jsonStr: string): string {
  let braceCount = 0;
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (char === '"' && !isEscaped) {
      inString = !inString;
    } else if (inString) {
      if (char === '\\' && !isEscaped) {
        isEscaped = true;
      } else {
        isEscaped = false;
      }
    } else if (char === '{') {
      braceCount++;
    } else if (char === '}') {
      braceCount--;
    }
  }

  if (inString || braceCount <= 0) return jsonStr;
  return `${jsonStr}${'}'.repeat(braceCount)}`;
}

export function removeStrayPrimitiveTerminatorQuotes(jsonStr: string): string {
  let inString = false;
  let isEscaped = false;
  let result = '';

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (char === '"' && !isEscaped) {
      if (!inString) {
        const previous = result.trimEnd().at(-1);
        const next = jsonStr.slice(i + 1).trimStart().at(0);
        if (previous && /[0-9eE.\-]|[a-z]/.test(previous) && (next === '}' || next === ',' || next === ']')) {
          continue;
        }
      }

      inString = !inString;
      result += char;
      continue;
    }

    if (inString && char === '\\' && !isEscaped) {
      isEscaped = true;
    } else {
      isEscaped = false;
    }

    result += char;
  }

  return result;
}

/**
 * Providers sometimes return a JavaScript object literal while correcting a
 * tool call, for example `{ darkMode: 'class', }`. Convert only the common
 * JSON5-style differences that are safe to recognize without evaluating the
 * response. This keeps arbitrary source/config text out of the tool parser.
 */
export function repairJavaScriptObjectLiteral(jsonStr: string): string {
  let result = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;

  // JavaScript object literals also allow numeric and hyphenated property
  // names without quotes. Tailwind color scales commonly use keys such as
  // `50`, `100`, and `950`, so treat those as property starts as well.
  const isIdentifierStart = (value: string): boolean => /[A-Za-z0-9_$-]/.test(value);
  const isIdentifierPart = (value: string): boolean => /[A-Za-z0-9_$-]/.test(value);

  for (let index = 0; index < jsonStr.length; index += 1) {
    const char = jsonStr[index];

    if (quote === '"') {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        quote = undefined;
      }
      continue;
    }

    if (quote === "'") {
      if (escaped) {
        // Convert escaped single quotes to literal single quotes inside the
        // JSON double-quoted string, while preserving other valid escapes.
        result += char === "'" ? "'" : `\\${char}`;
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === "'") {
        result += '"';
        quote = undefined;
      } else {
        result += char === '"' ? '\\"' : char;
      }
      continue;
    }

    if (char === '"') {
      quote = '"';
      result += char;
      continue;
    }
    if (char === "'") {
      quote = "'";
      result += '"';
      continue;
    }

    if (char === ',') {
      const next = jsonStr.slice(index + 1).match(/^\s*([}\]])/)?.[1];
      if (next) {
        // JSON does not allow a trailing comma.
        continue;
      }
    }

    if (isIdentifierStart(char)) {
      let end = index + 1;
      while (end < jsonStr.length && isIdentifierPart(jsonStr[end])) end += 1;
      const next = jsonStr.slice(end).match(/^\s*:/)?.[0];
      const previous = result.trimEnd().at(-1);
      if (next && (previous === '{' || previous === ',')) {
        result += `"${jsonStr.slice(index, end)}"`;
        index = end - 1;
        continue;
      }
    }

    result += char;
  }

  return result;
}

export function stripJsonComments(jsonStr: string): string {
  let result = '';
  let inString = false;
  let quote: '"' | "'" | undefined;
  let isEscaped = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (inString) {
      result += char;
      if (char === '\\' && !isEscaped) {
        isEscaped = true;
      } else {
        if (char === quote && !isEscaped) {
          inString = false;
          quote = undefined;
        }
        isEscaped = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      isEscaped = false;
      result += char;
      continue;
    }

    if (char === '/' && jsonStr[i + 1] === '/') {
      const nextNewline = jsonStr.indexOf('\n', i + 2);
      if (nextNewline === -1) break;
      i = nextNewline - 1;
      continue;
    }

    if (char === '/' && jsonStr[i + 1] === '*') {
      const nextClose = jsonStr.indexOf('*/', i + 2);
      if (nextClose === -1) break;
      i = nextClose + 1;
      continue;
    }

    result += char;
  }

  return result;
}

export function repairToolSelectionJson(rawJson: string): string[] {
  const balanced = balanceTrailingJsonObject(rawJson);
  const cleaned = removeStrayPrimitiveTerminatorQuotes(rawJson);
  const cleanedBalanced = balanceTrailingJsonObject(cleaned);
  const strippedComments = stripJsonComments(rawJson);
  const strippedBalanced = balanceTrailingJsonObject(strippedComments);
  const candidates = [rawJson, balanced, cleaned, cleanedBalanced, strippedComments, strippedBalanced];
  return Array.from(new Set([
    ...candidates,
    ...candidates.map(repairJavaScriptObjectLiteral),
  ]));
}

export function decodeXmlEntity(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|#x[\da-f]+|#\d+);/gi, (entity) => {
    const normalized = entity.toLowerCase();
    if (normalized === '&amp;') return '&';
    if (normalized === '&lt;') return '<';
    if (normalized === '&gt;') return '>';
    if (normalized === '&quot;') return '"';
    if (normalized === '&apos;') return "'";
    if (normalized.startsWith('&#x')) {
      return String.fromCodePoint(Number.parseInt(normalized.slice(3, -1), 16));
    }
    return String.fromCodePoint(Number.parseInt(normalized.slice(2, -1), 10));
  });
}

/**
 * Some smaller/open models emit XML-like tool calls instead of JSON, for
 * example `<tool_call>Read <arg_key>file_path</arg_key>...`. Convert this
 * provider format to the same JSON envelope used by the normal parser.
 */
export function extractXmlToolCall(text: string): string | null {
  const callMatch = text.match(/<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/i);
  if (!callMatch) return null;

  const body = callMatch[1];
  const toolMatch = body.match(/^\s*([A-Za-z][A-Za-z0-9_.:-]*)\b/i);
  if (!toolMatch) return null;

  const argumentsValue: Record<string, string> = {};
  const argumentPattern = /<arg_key\b[^>]*>\s*([\s\S]*?)\s*<\/arg_key>\s*<arg_value\b[^>]*>([\s\S]*?)<\/arg_value>/gi;
  for (const match of body.matchAll(argumentPattern)) {
    const key = decodeXmlEntity(match[1]).trim();
    if (!key) continue;
    argumentsValue[key] = decodeXmlEntity(match[2]).trim();
  }

  return JSON.stringify({ tool: toolMatch[1], arguments: argumentsValue });
}

/**
 * Helper: Extract JSON object from text
 */
export function extractJsonFromText(text: string): string | null {
  const xmlToolCall = extractXmlToolCall(text);
  if (xmlToolCall) return xmlToolCall;

  // Some OpenAI-compatible providers emit a tagged call envelope instead of
  // JSON with a top-level `tool` field, for example:
  // `<|tool_call>call:Todo{"operation":"set",...}<tool_call|>`.
  // Preserve the provider's tool name before extracting the payload. Without
  // this, normalizeToolSelection() sees only `{ operation: ... }` and treats
  // every tagged call as Command because Command is the only generic tool
  // whose arguments also contain `operation`.
  const taggedCall = text.match(
    /<\|tool_call\>\s*call:([A-Za-z][A-Za-z0-9_.:-]*)\s*(?=\{)/i,
  ) || text.match(
    /(?:^|\s)call:([A-Za-z][A-Za-z0-9_.:-]*)\s*(?=\{)/i,
  );
  if (taggedCall) {
    const payload = extractJsonFromText(text.slice((taggedCall.index || 0) + taggedCall[0].length));
    if (payload) {
      return `{"tool":${JSON.stringify(taggedCall[1])},"arguments":${payload}}`;
    }
  }

  const jsonBlock = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  if (jsonBlock && /(?:["']?(?:tool|action)["']?\s*:)/i.test(jsonBlock[1])) {
    return jsonBlock[1].trim();
  }

  let firstJson: string | null = null;

  // Providers occasionally prefix a valid action with an echoed observation
  // (for example the complete contents of package.json). Scan all balanced
  // objects and prefer a candidate that declares the action contract rather
  // than letting the echoed data mask the actual tool selection.
  for (let startIdx = text.indexOf('{'); startIdx !== -1; startIdx = text.indexOf('{', startIdx + 1)) {
    let braceCount = 0;
    let inString = false;
    let isEscaped = false;

    for (let i = startIdx; i < text.length; i++) {
      const char = text[i];

      if (char === '"' && !isEscaped) {
        inString = !inString;
      } else if (inString) {
        if (char === '\\' && !isEscaped) {
          isEscaped = true;
        } else {
          isEscaped = false;
        }
      } else if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          const candidate = text.substring(startIdx, i + 1);
          if (
            /(?:["']?(?:tool|action)["']?\s*:)/i.test(candidate) ||
            /(?:["']?(?:file_path|command|operation)["']?\s*:)/i.test(candidate)
          ) {
            return candidate;
          }
          firstJson ||= candidate;
          break;
        }
      }
    }
  }

  if (firstJson) return firstJson;

  const startIdx = text.indexOf('{');
  const lastBraceIdx = text.lastIndexOf('}');
  return lastBraceIdx > startIdx ? text.substring(startIdx, lastBraceIdx + 1) : null;
}

export function extractPlannerToolSelectionJson(text: string): string | null {
  const trimmed = text.trimStart();
  const isPseudoToolNarration =
    /^Selected tool\s*:/i.test(trimmed) ||
    (/^Planner decision\s+\d+\s*:/i.test(trimmed) && /\bSelected tool\s*:\s*[A-Za-z][\w.-]*\s*\(/i.test(trimmed));
  return isPseudoToolNarration ? null : extractJsonFromText(text);
}

export function extractJsonArrayFromText(text: string): string | null {
  const startIdx = text.indexOf('[');
  const endIdx = text.lastIndexOf(']');
  if (startIdx === -1 || endIdx <= startIdx) return null;
  return text.substring(startIdx, endIdx + 1);
}

/**
 * Some model backends occasionally return a serialized chat/message envelope
 * instead of the requested plain assistant content. Keep the ReAct loop focused
 * on the actual user-visible text so the action planner does not receive
 * provider metadata such as {"role":"assistant","tool_calls":[]}.
 */
export function normalizeAssistantText(response: string): string {
  const trimmed = response.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return response;
  }

  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(trimmed);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return response;
    }
    parsed = value as Record<string, unknown>;
  } catch {
    return response;
  }

  const keys = Object.keys(parsed);
  const looksLikeMessageEnvelope =
    keys.includes('role') ||
    keys.includes('reasoning') ||
    keys.includes('tool_calls');

  if (!looksLikeMessageEnvelope || keys.includes('tool') || keys.includes('action')) {
    return response;
  }

  const content = parsed.content;
  if (typeof content === 'string' && content.trim().length > 0) {
    return content;
  }

  // Never promote provider `reasoning`/`reasoning_content` fields to visible
  // planner text. Those fields may contain raw chain-of-thought. A provider
  // summary must arrive through the bounded completion-result channel instead.
  return '';
}

