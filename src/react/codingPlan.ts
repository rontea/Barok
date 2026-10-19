import { z } from 'zod';

export const codingPlanSchema = z.object({
  summary: z.string().trim().min(1).max(2_000),
  taskType: z.enum(['informational', 'simple', 'medium', 'complex', 'high-risk']),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
  filesToInspect: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  filesToModify: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  proposedChanges: z.array(z.string().trim().min(1).max(1_000)).min(1).max(100),
  validationCommands: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
  risks: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
  approvalRequired: z.boolean().default(false),
});

export type CodingPlan = z.infer<typeof codingPlanSchema>;

function extractJsonObject(value: string): string {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced || value;
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  return start >= 0 && end > start ? source.slice(start, end + 1) : source;
}

/**
 * Repairs only safe serialization noise locally. It never invents missing
 * plan fields or restarts a complete coding workflow.
 */
export function parseCodingPlan(value: string | unknown): CodingPlan {
  if (typeof value !== 'string') return codingPlanSchema.parse(value);
  const json = extractJsonObject(value)
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/^\uFEFF/, '');
  return codingPlanSchema.parse(JSON.parse(json));
}

export function tryParseCodingPlan(value: string | unknown):
  | { success: true; plan: CodingPlan }
  | { success: false; error: string; correctionAllowed: true } {
  try {
    return { success: true, plan: parseCodingPlan(value) };
  } catch {
    return {
      success: false,
      error: 'The coding plan did not match the required structured schema.',
      correctionAllowed: true,
    };
  }
}

