import type { PlanItem } from './plan-approval.js';
import type { ReActEngineToolDefinition } from './react-runtime.js';

const MAX_TODO_ITEMS = 50;
const MAX_TODO_TEXT = 1_000;

type TodoOperation = 'set' | 'add' | 'update' | 'remove' | 'list' | 'clear';

interface TodoInput {
  operation?: TodoOperation;
  items?: unknown[];
  id?: string;
  index?: number;
  step?: string;
  status?: PlanItem['status'];
  acceptanceCriteria?: unknown;
  evidenceIds?: unknown;
}

interface TodoToolState {
  plan: PlanItem[];
}

interface TodoToolOptions {
  getState: () => TodoToolState | undefined;
  onPlanUpdated?: (plan: PlanItem[]) => void;
}

function compactText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_TODO_TEXT);
}

function itemStep(value: unknown): string {
  if (typeof value === 'string') return compactText(value);
  if (!value || typeof value !== 'object') return '';
  const item = value as Record<string, unknown>;
  for (const key of ['step', 'text', 'content', 'subject']) {
    if (typeof item[key] === 'string') return compactText(item[key]);
  }
  return '';
}

function itemStatus(value: unknown): PlanItem['status'] {
  return value === 'in_progress' || value === 'completed' ? value : 'pending';
}

function stringList(value: unknown, maxItems = 20, maxLength = 500): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => typeof item === 'string' ? item.trim().replace(/\s+/g, ' ').slice(0, maxLength) : '')
    .filter(Boolean))].slice(0, maxItems);
}

function itemId(value: unknown, fallback: string): string {
  if (value && typeof value === 'object' && typeof (value as Record<string, unknown>).id === 'string') {
    const id = compactText((value as Record<string, unknown>).id as string);
    if (id) return id;
  }
  return fallback;
}

function normalizeItems(items: unknown[], startIndex: number): { items?: PlanItem[]; error?: string } {
  if (!Array.isArray(items)) return { error: 'Todo requires an items array for this operation.' };
  if (items.length > MAX_TODO_ITEMS) return { error: `Todo supports at most ${MAX_TODO_ITEMS} items.` };

  const normalized: PlanItem[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const step = itemStep(items[index]);
    if (!step) return { error: `Todo item ${index + 1} must contain non-empty text.` };
    const id = itemId(items[index], `todo-${startIndex + index + 1}`);
    if (ids.has(id)) return { error: `Todo item id "${id}" is duplicated.` };
    ids.add(id);
    const raw = items[index] && typeof items[index] === 'object'
      ? items[index] as Record<string, unknown>
      : {};
    const kind = raw.kind === 'inspect' || raw.kind === 'implement' || raw.kind === 'verify'
      ? raw.kind
      : undefined;
    const acceptanceCriteria = stringList(raw.acceptanceCriteria);
    const evidenceIds = stringList(raw.evidenceIds, 50, 256);
    normalized.push({
      id,
      step,
      status: itemStatus(raw.status),
      ...(kind ? { kind } : {}),
      ...(acceptanceCriteria.length ? { acceptanceCriteria } : {}),
      ...(evidenceIds.length ? { evidenceIds } : {}),
    });
  }
  return { items: normalized };
}

function normalizeCursor(plan: PlanItem[]): void {
  let activeSeen = false;
  for (const item of plan) {
    if (item.status === 'in_progress') {
      if (activeSeen) item.status = 'pending';
      activeSeen = true;
    }
  }
  if (!activeSeen) {
    const next = plan.find((item) => item.status === 'pending');
    if (next) next.status = 'in_progress';
  }
}

function selectedIndex(plan: PlanItem[], input: TodoInput): number {
  if (typeof input.index === 'number' && Number.isInteger(input.index)) return input.index;
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  if (id) return plan.findIndex((item) => item.id === id);
  return -1;
}

function result(state: TodoToolState, operation: TodoOperation, changed: boolean): Record<string, unknown> {
  return {
    success: true,
    operation,
    changed,
    items: state.plan,
    output: JSON.stringify(state.plan, null, 2),
  };
}

/**
 * Create the harness-owned todo tool. Its state is the active React run's
 * plan, so todo items are checkpointed with the run and never leak between
 * workspaces or agents.
 */
export function createTodoTool(options: TodoToolOptions): ReActEngineToolDefinition {
  return {
    name: 'Todo',
    description: 'Manage the agent-owned run todo. Use set or add to create your own useful checklist, update or remove items as work changes, and list or clear the current todo. This only changes harness state, not workspace files.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['set', 'add', 'update', 'remove', 'list', 'clear'],
          description: 'Todo operation to perform.',
        },
        items: {
          type: 'array',
          description: 'Items for set or add. Each item may be a string or an object with step/text, optional id, status, kind, acceptanceCriteria, and evidenceIds.',
        },
        id: { type: 'string', description: 'Stable item id for update or remove.' },
        index: { type: 'integer', description: 'Zero-based item index for update or remove.' },
        step: { type: 'string', description: 'Replacement text for update.' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
        acceptanceCriteria: { type: 'array', description: 'Acceptance criteria linked to the selected todo item.' },
        evidenceIds: { type: 'array', description: 'Durable evidence IDs linked to the selected todo item.' },
      },
      required: ['operation'],
    },
    handler: async (rawParams: unknown) => {
      const state = options.getState();
      if (!state) return { success: false, error: 'Todo is only available during an active run.' };

      const input = rawParams && typeof rawParams === 'object' ? rawParams as TodoInput : {};
      const operation = input.operation;
      if (!operation || !['set', 'add', 'update', 'remove', 'list', 'clear'].includes(operation)) {
        return { success: false, error: 'Todo requires operation: set, add, update, remove, list, or clear.' };
      }
      if (operation === 'list') return result(state, operation, false);
      if (operation === 'clear') {
        state.plan = [];
        options.onPlanUpdated?.([]);
        return result(state, operation, true);
      }

      if (operation === 'set' || operation === 'add') {
        const normalized = normalizeItems(input.items || [], operation === 'add' ? state.plan.length : 0);
        if (normalized.error || !normalized.items) return { success: false, error: normalized.error };
        if (operation === 'set') {
          state.plan = normalized.items;
        } else {
          if (state.plan.length + normalized.items.length > MAX_TODO_ITEMS) {
            return { success: false, error: `Todo supports at most ${MAX_TODO_ITEMS} items.` };
          }
          const existingIds = new Set(state.plan.map((item) => item.id).filter((id): id is string => Boolean(id)));
          if (normalized.items.some((item) => item.id && existingIds.has(item.id))) {
            return { success: false, error: 'Todo item ids must be unique within the run.' };
          }
          state.plan = [...state.plan, ...normalized.items];
        }
        normalizeCursor(state.plan);
        options.onPlanUpdated?.(state.plan);
        return result(state, operation, true);
      }

      const index = selectedIndex(state.plan, input);
      if (index < 0 || index >= state.plan.length) {
        return { success: false, error: 'Todo update/remove requires a valid id or zero-based index.' };
      }
      if (operation === 'remove') {
        state.plan = state.plan.filter((_, itemIndex) => itemIndex !== index);
        normalizeCursor(state.plan);
        options.onPlanUpdated?.(state.plan);
        return result(state, operation, true);
      }

      const current = state.plan[index];
      if (typeof input.step === 'string') {
        const step = compactText(input.step);
        if (!step) return { success: false, error: 'Todo update step must not be empty.' };
        current.step = step;
      }
      if (input.status !== undefined) current.status = itemStatus(input.status);
      if (input.acceptanceCriteria !== undefined) current.acceptanceCriteria = stringList(input.acceptanceCriteria);
      if (input.evidenceIds !== undefined) current.evidenceIds = stringList(input.evidenceIds, 50, 256);
      normalizeCursor(state.plan);
      options.onPlanUpdated?.(state.plan);
      return result(state, operation, true);
    },
  };
}
