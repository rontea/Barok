import { z } from 'zod/v4';

const AgentDecisionMetadataSchema = z.object({
  rationale: z.string().max(600).optional(),
  planUpdate: z.array(z.string().max(240)).max(6).optional(),
  expectedEvidence: z.array(z.string().max(240)).max(6).optional(),
  evidenceChecks: z.array(z.object({
    type: z.enum(['file_exists', 'contains_text', 'command_passed', 'files_changed', 'verification_passed', 'search_match', 'package_installed', 'workspace_change_detected']),
    path: z.string().max(240).optional(),
    text: z.string().max(600).optional(),
    command: z.string().max(600).optional(),
    packageName: z.string().max(240).optional(),
  })).max(6).optional(),
  preconditions: z.array(z.string().max(240)).max(6).optional(),
  stopCondition: z.string().max(240).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const AgentDecisionRecordSchema = AgentDecisionMetadataSchema.extend({
  version: z.literal(1),
  id: z.string().min(1),
  step: z.number().int().nonnegative(),
  provider: z.enum(['openai', 'anthropic', 'gemini', 'nvidia', 'legacy_text', 'unknown']),
  model: z.string().max(160),
  action: z.object({
    action: z.string().min(1).max(120),
    action_input: z.record(z.string(), z.unknown()),
  }),
  decisionCategory: z.enum(['planning', 'inspection', 'implementation', 'verification', 'recovery', 'coordination', 'clarification', 'completion', 'unknown']).optional(),
  reasoningId: z.string().optional(),
  reasoningVisibility: z.enum(['hidden', 'collapsed', 'full', 'redacted']),
  reasoningSource: z.enum(['engine', 'model', 'provider', 'native']),
  status: z.enum(['pending', 'succeeded', 'failed', 'invalidated']),
  toolEvidenceId: z.string().optional(),
  observedEvidence: z.object({
    status: z.enum(['success', 'failure', 'unknown']),
    assessment: z.enum(['supported', 'contradicted', 'unverified']),
    checkResults: z.array(z.object({
      type: z.enum(['file_exists', 'contains_text', 'command_passed', 'files_changed', 'verification_passed', 'search_match', 'package_installed', 'workspace_change_detected']),
      status: z.enum(['passed', 'failed', 'unverified']),
      detail: z.string().max(240).optional(),
    })).max(6).optional(),
    summary: z.string().max(240),
  }).optional(),
  createdAt: z.number().nonnegative(),
  completedAt: z.number().nonnegative().optional(),
});

/** Structured output accepted from one ReAct reasoning turn. */
export const ReactStepResponseSchema = z.object({
  thought: z.string().describe('Agent thought process'),
  action: z.string().describe('Action taken (e.g., tool name)'),
  action_input: z.record(z.string(), z.unknown()).describe('Input to the action'),
  observation: z.string().optional().describe('Observation from action result'),
  is_done: z.boolean().optional().describe('Whether reasoning is complete'),
  final_answer: z.string().optional().describe('Final answer if done'),
  pollenCost: z.number().nonnegative().optional().describe('API cost in pollen tokens'),
  decision: AgentDecisionMetadataSchema.optional().describe('Bounded action intent metadata'),
  decisionRecord: AgentDecisionRecordSchema.optional().describe('Decision lifecycle and observed evidence'),
});

export type ReactStepResponse = z.infer<typeof ReactStepResponseSchema>;

/** Final result shape returned by the ReAct loop. */
export const ReactResultResponseSchema = z.object({
  success: z.boolean().describe('Whether agent execution succeeded'),
  finalAnswer: z.string().optional().describe('Final answer from agent'),
  result: z.string().optional().describe('Backward-compatible final result field'),
  steps: z.array(ReactStepResponseSchema).describe('Reasoning steps taken'),
  stepCount: z.number().int().nonnegative().describe('Number of steps executed'),
  pollenCost: z.number().nonnegative().optional().describe('Total API cost in pollen tokens'),
  error: z.string().optional().describe('Error message if failed'),
  errorCode: z.string().optional().describe('Machine-readable error code if failed'),
  recoverable: z.boolean().optional().describe('Whether the failure can be continued or retried'),
  suggestedNextAction: z.string().optional().describe('Suggested recovery action for the user'),
});

export type ReactResultResponse = z.infer<typeof ReactResultResponseSchema>;

export interface ReActEngineValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: Array<{ field: string; message: string }>;
  warnings?: string[];
}

function validateReactOutput<T>(data: unknown, schema: z.ZodType<T>): ReActEngineValidationResult<T> {
  try {
    return { success: true, data: schema.parse(data) };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        errors: error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      };
    }
    return {
      success: false,
      errors: [{ field: 'root', message: `Unknown validation error: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }
}

export function validateReactStep(data: unknown): ReActEngineValidationResult<ReactStepResponse> {
  return validateReactOutput(data, ReactStepResponseSchema);
}

export function validateReactResult(data: unknown): ReActEngineValidationResult<ReactResultResponse> {
  return validateReactOutput(data, ReactResultResponseSchema);
}
