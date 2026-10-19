import { z } from 'zod';
import {
  CheckOutcomeSchema,
  EvaluationRunStatusSchema,
} from './evaluationSchema.js';

export const EVALUATION_FIXTURE_SCHEMA_VERSION = 1 as const;

const FixtureIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/);
const RelativeFixturePathSchema = z.string().min(1).superRefine((value, context) => {
  const normalized = value.replace(/\\/g, '/');
  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split('/').some((segment) => segment === '..')
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Fixture path must stay relative to the disposable workspace: ${value}`,
    });
  }
});

export const EvaluationProjectFixtureSchema = z.object({
  schemaVersion: z.literal(EVALUATION_FIXTURE_SCHEMA_VERSION),
  id: FixtureIdSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  projectType: z.enum([
    'vanilla_js',
    'react_vite',
    'node_typescript',
    'python',
    'no_git',
    'dirty_git',
    'missing_package_manager',
    'windows_paths',
  ]),
  packageManager: z.enum(['npm', 'pnpm', 'yarn', 'bun', 'pip', 'none', 'missing']),
  gitMode: z.enum(['none', 'clean', 'dirty']),
  files: z.record(RelativeFixturePathSchema, z.string()).refine(
    (files) => Object.keys(files).length > 0,
    'Project fixture must contain at least one file'
  ),
  dirtyChange: z.object({
    path: RelativeFixturePathSchema,
    content: z.string(),
  }).optional(),
  expectedDiscovery: z.object({
    languages: z.array(z.string().min(1)).default([]),
    frameworks: z.array(z.string().min(1)).default([]),
    commands: z.array(z.string().min(1)).default([]),
  }).default({ languages: [], frameworks: [], commands: [] }),
}).superRefine((fixture, context) => {
  if (fixture.gitMode === 'dirty' && !fixture.dirtyChange) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Dirty Git fixtures require dirtyChange',
      path: ['dirtyChange'],
    });
  }
});

const ScriptedActionSchema = z.object({
  tool: z.string().min(1),
  input: z.unknown().optional(),
  status: z.enum(['selected', 'dispatched', 'succeeded', 'failed', 'rejected', 'recovery']),
  atMs: z.number().int().nonnegative(),
  finishedAtMs: z.number().int().nonnegative().optional(),
}).passthrough();

const ScriptedMutationSchema = z.object({
  actionIndex: z.number().int().nonnegative().optional(),
  requirementIds: z.array(FixtureIdSchema).default([]),
  path: RelativeFixturePathSchema,
  operation: z.enum(['created', 'modified', 'deleted', 'moved', 'formatted']),
  success: z.boolean(),
  atMs: z.number().int().nonnegative(),
  overlapsUserChange: z.boolean().default(false),
}).passthrough();

const ScriptedVerificationSchema = z.object({
  actionIndex: z.number().int().nonnegative().optional(),
  requirementIds: z.array(FixtureIdSchema).default([]),
  name: z.string().min(1),
  outcome: CheckOutcomeSchema,
  summary: z.string().optional(),
  atMs: z.number().int().nonnegative(),
}).passthrough();

const EvidenceReferenceSchema = z.string().regex(/^(observation|mutation|verification):\d+$/);

const ScriptedFinalClaimSchema = z.object({
  text: z.string().min(1),
  requirementIds: z.array(FixtureIdSchema).default([]),
  evidenceRefs: z.array(EvidenceReferenceSchema).default([]),
  support: z.enum(['supported', 'contradicted', 'unverifiable']),
}).passthrough();

export const ScriptedEvaluationRunSchema = z.object({
  status: EvaluationRunStatusSchema,
  durationMs: z.number().int().nonnegative(),
  cost: z.number().nonnegative().optional(),
  actions: z.array(ScriptedActionSchema).default([]),
  observations: z.array(z.object({
    actionIndex: z.number().int().nonnegative().optional(),
    kind: z.string().min(1),
    success: z.boolean().optional(),
    data: z.unknown(),
    atMs: z.number().int().nonnegative(),
  }).passthrough()).default([]),
  mutations: z.array(ScriptedMutationSchema).default([]),
  verificationChecks: z.array(ScriptedVerificationSchema).default([]),
  finalClaims: z.array(ScriptedFinalClaimSchema).default([]),
}).superRefine((script, context) => {
  const checkActionIndex = (index: number | undefined, path: Array<string | number>) => {
    if (index !== undefined && index >= script.actions.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Script references missing action index ${index}`,
        path,
      });
    }
  };
  script.observations.forEach((item, index) => checkActionIndex(item.actionIndex, ['observations', index, 'actionIndex']));
  script.mutations.forEach((item, index) => checkActionIndex(item.actionIndex, ['mutations', index, 'actionIndex']));
  script.verificationChecks.forEach((item, index) => checkActionIndex(item.actionIndex, ['verificationChecks', index, 'actionIndex']));
});

export const EvaluationTaskFixtureSchema = z.object({
  schemaVersion: z.literal(EVALUATION_FIXTURE_SCHEMA_VERSION),
  id: FixtureIdSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  projectFixtureId: FixtureIdSchema,
  kind: z.enum([
    'read_only',
    'bug_fix',
    'feature',
    'refactor',
    'todo_phase',
    'continuation',
    'ambiguous',
    'incident',
  ]),
  request: z.string().min(1),
  requirements: z.array(z.object({
    id: FixtureIdSchema,
    text: z.string().min(1),
  })).default([]),
  expectations: z.object({
    expectedStatus: EvaluationRunStatusSchema,
    requiresMutation: z.boolean(),
    expectedChangedFiles: z.array(RelativeFixturePathSchema).default([]),
    minimumVerificationCoverage: z.number().min(0).max(1).default(0),
    expectedFalseCompletion: z.boolean().default(false),
    maximumRepeatedActions: z.number().int().nonnegative().default(0),
    requiresMalformedActionRecovery: z.boolean().default(false),
  }),
  scriptedRun: ScriptedEvaluationRunSchema,
  incident: z.object({
    auditId: z.string().min(1),
    reconstruction: z.boolean(),
    failureSignature: z.string().min(1),
    expectedRecovery: z.string().min(1),
  }).optional(),
  continuationCase: z.object({
    entryPoint: z.enum(['conversational_confirmation', 'max_steps', 'saved_run']),
    expectedDisposition: z.enum(['continue', 'block', 'new_task']),
    expectedParentRunId: z.boolean(),
    maximumRepeatedParentActions: z.number().int().nonnegative().default(0),
    maximumStaleParentFileReads: z.number().int().nonnegative().default(0),
  }).optional(),
}).superRefine((fixture, context) => {
  const requirementIds = new Set(fixture.requirements.map((item) => item.id));
  for (const [index, check] of fixture.scriptedRun.verificationChecks.entries()) {
    for (const requirementId of check.requirementIds) {
      if (!requirementIds.has(requirementId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Verification references missing requirement ${requirementId}`,
          path: ['scriptedRun', 'verificationChecks', index, 'requirementIds'],
        });
      }
    }
  }
  for (const [index, mutation] of fixture.scriptedRun.mutations.entries()) {
    for (const requirementId of mutation.requirementIds) {
      if (!requirementIds.has(requirementId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Mutation references missing requirement ${requirementId}`,
          path: ['scriptedRun', 'mutations', index, 'requirementIds'],
        });
      }
    }
  }
  for (const [index, claim] of fixture.scriptedRun.finalClaims.entries()) {
    for (const requirementId of claim.requirementIds) {
      if (!requirementIds.has(requirementId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Final claim references missing requirement ${requirementId}`,
          path: ['scriptedRun', 'finalClaims', index, 'requirementIds'],
        });
      }
    }
  }
  if (fixture.kind === 'incident' && !fixture.incident) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Incident task fixtures require incident metadata',
      path: ['incident'],
    });
  }
});

export type EvaluationProjectFixture = z.infer<typeof EvaluationProjectFixtureSchema>;
export type EvaluationTaskFixture = z.infer<typeof EvaluationTaskFixtureSchema>;
export type ScriptedEvaluationRun = z.infer<typeof ScriptedEvaluationRunSchema>;

export function parseProjectFixture(value: unknown): EvaluationProjectFixture {
  return EvaluationProjectFixtureSchema.parse(value);
}

export function parseTaskFixture(value: unknown): EvaluationTaskFixture {
  return EvaluationTaskFixtureSchema.parse(value);
}
