import type { ReActEngineToolDefinition } from './react-runtime.js';

const MAX_VISIBLE_THINKING_CHARS = 600;

export interface ThinkingToolOptions {
  onThought?: (summary: string) => void;
}

/**
 * A bounded, user-safe checkpoint for reasoning models.
 *
 * This is deliberately a visible-summary tool, not a raw chain-of-thought
 * sink. The model may use it to tell the chat thread what it is about to do,
 * while private scratch reasoning remains provider-side.
 */
export function createThinkingTool(options: ThinkingToolOptions = {}): ReActEngineToolDefinition {
  return {
    name: 'Think',
    description: 'Record one concise, user-visible reasoning summary before a meaningful next action. Use at most once per turn when it improves clarity; do not include private chain-of-thought, scratchpad details, secrets, or exhaustive analysis. This does not replace a real workspace action.',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'A concise user-safe explanation of the next intended action or decision.',
          maxLength: MAX_VISIBLE_THINKING_CHARS,
        },
      },
      required: ['summary'],
      additionalProperties: false,
    },
    handler: async (params: unknown) => {
      const input = params && typeof params === 'object' ? params as Record<string, unknown> : {};
      const summary = typeof input.summary === 'string'
        ? input.summary.replace(/\s+/g, ' ').trim().slice(0, MAX_VISIBLE_THINKING_CHARS)
        : '';
      if (!summary) {
        return {
          success: false,
          error: 'Think requires a concise, user-safe summary.',
        };
      }

      options.onThought?.(summary);
      return {
        success: true,
        output: summary,
        visibleSummary: summary,
      };
    },
  };
}

