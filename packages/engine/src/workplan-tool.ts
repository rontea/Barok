import type { AgentWorkPlan, AgentWorkPlanStatus } from './react-contracts.js';
import type { ReActEngineToolDefinition } from './react-runtime.js';

const MAX_WORKPLAN_ITEMS = 20;
const MAX_WORKPLAN_TEXT = 1_000;
const MAX_OBJECTIVE_TEXT = 2_000;

type WorkPlanOperation = 'set' | 'update' | 'list' | 'clear';

interface WorkPlanInput {
  operation?: WorkPlanOperation;
  objective?: string;
  scope?: unknown;
  steps?: unknown;
  acceptanceCriteria?: unknown;
  verification?: unknown;
  risks?: unknown;
  strategy?: string;
  status?: AgentWorkPlanStatus;
}

interface WorkPlanToolState {
  workPlan?: AgentWorkPlan;
}

interface WorkPlanToolOptions {
  getState: () => WorkPlanToolState | undefined;
  onWorkPlanUpdated?: (workPlan?: AgentWorkPlan) => void;
}

function compactText(value: string, maxLength = MAX_WORKPLAN_TEXT): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizeList(value: unknown, field: string): { value?: string[]; error?: string } {
  if (value === undefined) return { value: [] };
  if (!Array.isArray(value)) return { error: `WorkPlan ${field} must be an array of strings.` };
  if (value.length > MAX_WORKPLAN_ITEMS) {
    return { error: `WorkPlan ${field} supports at most ${MAX_WORKPLAN_ITEMS} items.` };
  }
  const normalized = value.map((item) => typeof item === 'string' ? compactText(item) : '').filter(Boolean);
  if (normalized.length !== value.length) return { error: `WorkPlan ${field} items must be non-empty strings.` };
  return { value: normalized };
}

function normalizeStatus(value: unknown, fallback: AgentWorkPlanStatus): AgentWorkPlanStatus | undefined {
  if (value === undefined) return fallback;
  if (value === 'draft' || value === 'active' || value === 'completed' || value === 'blocked') return value;
  return undefined;
}

function result(state: WorkPlanToolState, operation: WorkPlanOperation, changed: boolean): Record<string, unknown> {
  return {
    success: true,
    operation,
    changed,
    workPlan: state.workPlan,
    output: state.workPlan ? JSON.stringify(state.workPlan, null, 2) : 'No agent-owned workplan has been created.',
  };
}

/**
 * Create the harness-owned strategic workplan tool. Its state is checkpointed
 * with the active React run and is never synthesized by the harness.
 */
export function createWorkPlanTool(options: WorkPlanToolOptions): ReActEngineToolDefinition {
  return {
    name: 'WorkPlan',
    description: 'Manage an optional agent-owned strategic workplan. Use set or update when a structured approach helps, list to review it, and clear when it is no longer useful. The harness never creates or requires this plan, and this tool does not change workspace files.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['set', 'update', 'list', 'clear'],
          description: 'WorkPlan operation to perform.',
        },
        objective: { type: 'string', description: 'The outcome this workplan is intended to achieve.' },
        strategy: { type: 'string', description: 'Optional concise implementation strategy.' },
        scope: { type: 'array', items: { type: 'string' }, description: 'Files, modules, or boundaries in scope.' },
        steps: { type: 'array', items: { type: 'string' }, description: 'Optional strategic steps, not an enforced execution order.' },
        acceptanceCriteria: { type: 'array', items: { type: 'string' }, description: 'Observable conditions for considering the work complete.' },
        verification: { type: 'array', items: { type: 'string' }, description: 'Checks to run or evidence to collect.' },
        risks: { type: 'array', items: { type: 'string' }, description: 'Known risks, assumptions, or open decisions.' },
        status: { type: 'string', enum: ['draft', 'active', 'completed', 'blocked'] },
      },
      required: ['operation'],
    },
    handler: async (rawParams: unknown) => {
      const state = options.getState();
      if (!state) return { success: false, error: 'WorkPlan is only available during an active run.' };

      const input = rawParams && typeof rawParams === 'object' ? rawParams as WorkPlanInput : {};
      const operation = input.operation;
      if (!operation || !['set', 'update', 'list', 'clear'].includes(operation)) {
        return { success: false, error: 'WorkPlan requires operation: set, update, list, or clear.' };
      }
      if (operation === 'list') return result(state, operation, false);
      if (operation === 'clear') {
        state.workPlan = undefined;
        options.onWorkPlanUpdated?.(undefined);
        return result(state, operation, true);
      }

      const objective = input.objective === undefined
        ? undefined
        : typeof input.objective === 'string'
          ? compactText(input.objective, MAX_OBJECTIVE_TEXT)
          : '';
      if (input.objective !== undefined && !objective) {
        return { success: false, error: 'WorkPlan objective must be a non-empty string.' };
      }
      const strategy = input.strategy === undefined
        ? undefined
        : typeof input.strategy === 'string'
          ? compactText(input.strategy)
          : '';
      if (input.strategy !== undefined && !strategy) {
        return { success: false, error: 'WorkPlan strategy must be a non-empty string when provided.' };
      }
      const status = normalizeStatus(input.status, operation === 'set' ? 'active' : state.workPlan?.status || 'active');
      if (!status) return { success: false, error: 'WorkPlan status must be draft, active, completed, or blocked.' };

      const listFields = ['scope', 'steps', 'acceptanceCriteria', 'verification', 'risks'] as const;
      const lists: Partial<Record<(typeof listFields)[number], string[]>> = {};
      for (const field of listFields) {
        if (input[field] === undefined) continue;
        const normalized = normalizeList(input[field], field);
        if (normalized.error || !normalized.value) return { success: false, error: normalized.error };
        lists[field] = normalized.value;
      }

      if (operation === 'set') {
        if (!objective) return { success: false, error: 'WorkPlan set requires a non-empty objective.' };
        state.workPlan = {
          objective,
          scope: lists.scope || [],
          steps: lists.steps || [],
          acceptanceCriteria: lists.acceptanceCriteria || [],
          verification: lists.verification || [],
          risks: lists.risks || [],
          ...(strategy ? { strategy } : {}),
          status,
          updatedAt: Date.now(),
        };
      } else {
        if (!state.workPlan) return { success: false, error: 'WorkPlan update requires an existing workplan. Use set first.' };
        state.workPlan = {
          ...state.workPlan,
          ...(objective !== undefined ? { objective } : {}),
          ...(strategy !== undefined ? { strategy } : {}),
          ...lists,
          status,
          updatedAt: Date.now(),
        };
      }
      options.onWorkPlanUpdated?.(state.workPlan);
      return result(state, operation, true);
    },
  };
}
