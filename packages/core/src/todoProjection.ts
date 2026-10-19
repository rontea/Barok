export type DurableTodoStatus = 'pending' | 'in_progress' | 'completed';

/** The intentionally small, durable representation of one todo item. */
export interface DurableTodoItem {
  id: string;
  content: string;
  status: DurableTodoStatus;
}

/** Links are metadata, not completion evidence. Evidence is still replayed separately. */
export interface TodoItemLink {
  itemId: string;
  acceptanceCriteria: string[];
  evidenceIds: string[];
}

export interface TodoProgressCursor {
  currentItemId?: string;
  currentStep?: number;
  phase?: string;
  remainingItemIds: string[];
}

export interface TodoProjectionSource {
  eventId: string;
  seq: number;
  type: string;
}

export interface TodoProjection {
  revision: number;
  items: DurableTodoItem[];
  links: TodoItemLink[];
  acceptanceCriteria: string[];
  progressCursor?: TodoProgressCursor;
  source?: TodoProjectionSource;
}

export interface TodoPlanItemLike {
  id?: unknown;
  step?: unknown;
  status?: unknown;
  acceptanceCriteria?: unknown;
  evidenceIds?: unknown;
}

/**
 * Structural input accepted by the pure projection. Hosts adapt their durable
 * event envelope to this small shape without exposing transport-specific types.
 */
export interface TodoProjectionEvent {
  eventId: string;
  seq: number;
  type: string;
  data: unknown;
}

const MAX_ITEMS = 50;
const MAX_TEXT = 1_000;
const MAX_METADATA_ITEMS = 20;
const MAX_EVIDENCE_IDS = 50;

function text(value: unknown, maxLength = MAX_TEXT): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength) : '';
}

function stringList(value: unknown, limit = MAX_METADATA_ITEMS, maxLength = 500): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => text(item, maxLength))
    .filter(Boolean))].slice(0, limit);
}

function status(value: unknown): DurableTodoStatus {
  return value === 'in_progress' || value === 'completed' ? value : 'pending';
}

function itemId(value: unknown, index: number): string {
  const candidate = text(value, 200);
  return candidate || `todo-${index + 1}`;
}

function normalizeItems(value: unknown): DurableTodoItem[] {
  const source = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const ids = new Set<string>();
  const items: DurableTodoItem[] = [];
  for (const [index, raw] of source.slice(0, MAX_ITEMS).entries()) {
    const record: Record<string, unknown> = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : { content: raw };
    const content = text(record.content ?? record.step ?? record.text);
    if (!content) continue;
    let id = itemId(record.id, index);
    if (ids.has(id)) id = `todo-${index + 1}`;
    if (ids.has(id)) continue;
    ids.add(id);
    items.push({ id, content, status: status(record.status) });
  }
  return items;
}

function normalizeLinks(value: unknown, itemIds: Set<string>): TodoItemLink[] {
  if (!Array.isArray(value)) return [];
  const links: TodoItemLink[] = [];
  for (const raw of value.slice(0, MAX_ITEMS)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const itemIdValue = text(record.itemId, 200);
    if (!itemIdValue || !itemIds.has(itemIdValue)) continue;
    links.push({
      itemId: itemIdValue,
      acceptanceCriteria: stringList(record.acceptanceCriteria),
      evidenceIds: stringList(record.evidenceIds, MAX_EVIDENCE_IDS, 256),
    });
  }
  return links;
}

function linksForItems(items: DurableTodoItem[], sourceItems?: unknown): TodoItemLink[] {
  const source = Array.isArray(sourceItems) ? sourceItems : [];
  return items.map((item, index) => {
    const raw = source[index] && typeof source[index] === 'object' && !Array.isArray(source[index])
      ? source[index] as Record<string, unknown>
      : {};
    return {
      itemId: item.id,
      acceptanceCriteria: stringList(raw.acceptanceCriteria),
      evidenceIds: stringList(raw.evidenceIds, MAX_EVIDENCE_IDS, 256),
    };
  });
}

export function createTodoSnapshot(
  plan: readonly TodoPlanItemLike[],
  revision: number,
): { revision: number; items: DurableTodoItem[] } {
  const items = normalizeItems(plan.map((item) => ({
    id: item.id,
    content: item.step,
    status: item.status,
  })));
  return { revision: Math.max(1, Math.floor(revision)), items };
}

export function createTodoLinks(
  plan: readonly TodoPlanItemLike[],
  acceptanceCriteria: readonly string[] = [],
  progressCursor?: TodoProgressCursor,
): { links: TodoItemLink[]; acceptanceCriteria: string[]; progressCursor?: TodoProgressCursor } {
  const snapshot = createTodoSnapshot(plan, 1);
  return {
    links: linksForItems(snapshot.items, plan),
    acceptanceCriteria: stringList(acceptanceCriteria),
    ...(progressCursor ? { progressCursor } : {}),
  };
}

export function createTodoProgressCursor(
  plan: readonly TodoPlanItemLike[],
  currentStep?: number,
  phase?: string,
): TodoProgressCursor {
  const items = createTodoSnapshot(plan, 1).items;
  const current = items.find((item) => item.status === 'in_progress') || items.find((item) => item.status === 'pending');
  const safeCurrentStep = typeof currentStep === 'number' && Number.isSafeInteger(currentStep) && currentStep >= 0
    ? currentStep
    : undefined;
  return {
    ...(current ? { currentItemId: current.id } : {}),
    ...(safeCurrentStep !== undefined ? { currentStep: safeCurrentStep } : {}),
    ...(text(phase, 100) ? { phase: text(phase, 100) } : {}),
    remainingItemIds: items.filter((item) => item.status !== 'completed').map((item) => item.id),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function planFromState(value: unknown): unknown[] | undefined {
  const candidate = record(value);
  if (Array.isArray(candidate?.plan)) return candidate.plan;
  const nested = record(candidate?.state);
  return Array.isArray(nested?.plan) ? nested.plan : undefined;
}

function stateValue(value: unknown): Record<string, unknown> | undefined {
  const candidate = record(value);
  return record(candidate?.state) || candidate;
}

function cursorFromState(value: unknown, items: DurableTodoItem[]): TodoProgressCursor | undefined {
  const state = stateValue(value);
  if (!state) return undefined;
  const plan = Array.isArray(state.plan) ? state.plan : items;
  const cursor = createTodoProgressCursor(
    plan.map((item) => {
      const raw = record(item) || {};
      return { id: raw.id, step: raw.step ?? raw.content, status: raw.status };
    }),
    typeof state.current_step === 'number' ? state.current_step : undefined,
    typeof state.codingState === 'string' ? state.codingState : undefined,
  );
  return cursor;
}

function workPlanAcceptanceCriteria(value: unknown): string[] | undefined {
  const workPlan = record(record(value)?.workPlan);
  return workPlan && Array.isArray(workPlan.acceptanceCriteria)
    ? stringList(workPlan.acceptanceCriteria)
    : undefined;
}

/**
 * Rebuild todo state from durable events. Process-local run status, activation,
 * and live transport observations are deliberately not inputs to this view.
 */
export function projectTodoEvents(events: readonly TodoProjectionEvent[]): TodoProjection | undefined {
  const sorted = [...events].sort((left, right) => left.seq - right.seq);
  let items: DurableTodoItem[] = [];
  let links: TodoItemLink[] = [];
  let acceptanceCriteria: string[] = [];
  let progressCursor: TodoProgressCursor | undefined;
  let revision = 0;
  let durableSnapshotSeen = false;
  let source: TodoProjectionSource | undefined;
  let cursorSeq = -1;

  for (const event of sorted) {
    const data = record(event.data);
    if (event.type === 'todo_snapshot') {
      const nextRevision = typeof data?.revision === 'number' && Number.isSafeInteger(data.revision)
        ? Math.max(1, data.revision)
        : revision + 1;
      if (durableSnapshotSeen && nextRevision < revision) continue;
      items = normalizeItems(data?.items);
      revision = nextRevision;
      durableSnapshotSeen = true;
      links = linksForItems(items);
      source = { eventId: event.eventId, seq: event.seq, type: event.type };
      continue;
    }

    if (event.type === 'plan_updated' && !durableSnapshotSeen) {
      const legacyItems = normalizeItems(data?.plan);
      if (legacyItems.length || Array.isArray(data?.plan)) {
        items = legacyItems;
        revision = Math.max(revision, 1);
        links = linksForItems(items, data?.plan);
        source = { eventId: event.eventId, seq: event.seq, type: event.type };
      }
    }

    if (event.type === 'state' || event.type === 'checkpoint') {
      if (!durableSnapshotSeen) {
        const statePlan = planFromState(data);
        if (statePlan) {
          items = normalizeItems(statePlan);
          revision = Math.max(revision, 1);
          links = linksForItems(items, statePlan);
          source = { eventId: event.eventId, seq: event.seq, type: event.type };
        }
      }
      const nextCursor = cursorFromState(data, items);
      if (nextCursor && event.seq >= cursorSeq) {
        progressCursor = nextCursor;
        cursorSeq = event.seq;
      }
    }

    if (event.type === 'todo_links_updated') {
      const nextRevision = typeof data?.revision === 'number' && Number.isSafeInteger(data.revision)
        ? Math.max(1, data.revision)
        : revision;
      if (nextRevision < revision) continue;
      revision = nextRevision;
      links = normalizeLinks(data?.links, new Set(items.map((item) => item.id)));
      acceptanceCriteria = stringList(data?.acceptanceCriteria);
      const nextCursor = record(data?.progressCursor);
      if (nextCursor) {
        progressCursor = {
          ...(text(nextCursor.currentItemId, 200) ? { currentItemId: text(nextCursor.currentItemId, 200) } : {}),
          ...(typeof nextCursor.currentStep === 'number' && Number.isSafeInteger(nextCursor.currentStep) && nextCursor.currentStep >= 0
            ? { currentStep: nextCursor.currentStep }
            : {}),
          ...(text(nextCursor.phase, 100) ? { phase: text(nextCursor.phase, 100) } : {}),
          remainingItemIds: stringList(nextCursor.remainingItemIds, MAX_ITEMS, 200),
        };
        cursorSeq = event.seq;
      }
      source = { eventId: event.eventId, seq: event.seq, type: event.type };
    }

    if (event.type === 'workplan_updated') {
      const criteria = workPlanAcceptanceCriteria(data);
      if (criteria) acceptanceCriteria = criteria;
    }
  }

  if (!durableSnapshotSeen && revision === 0 && items.length === 0 && !acceptanceCriteria.length && !progressCursor) return undefined;
  return {
    revision,
    items,
    links,
    acceptanceCriteria,
    ...(progressCursor ? { progressCursor } : {}),
    ...(source ? { source } : {}),
  };
}
