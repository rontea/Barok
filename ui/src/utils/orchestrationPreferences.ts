export type OrchestrationTab = 'plan' | 'execution' | 'conflicts' | 'diffs' | 'verification';

export interface OrchestrationPreferences {
  visible: boolean;
  tab: OrchestrationTab;
}

export const ORCHESTRATION_PREFERENCES_STORAGE_KEY = 'coder_orchestration_preferences';

export const DEFAULT_ORCHESTRATION_PREFERENCES: OrchestrationPreferences = {
  visible: true,
  tab: 'plan',
};

const isOrchestrationTab = (value: unknown): value is OrchestrationTab =>
  value === 'plan' || value === 'execution' || value === 'conflicts' || value === 'diffs' || value === 'verification';

const normalizePreferences = (value: unknown): OrchestrationPreferences => {
  if (!value || typeof value !== 'object') return DEFAULT_ORCHESTRATION_PREFERENCES;
  const candidate = value as Partial<OrchestrationPreferences>;
  return {
    visible: typeof candidate.visible === 'boolean' ? candidate.visible : DEFAULT_ORCHESTRATION_PREFERENCES.visible,
    tab: isOrchestrationTab(candidate.tab) ? candidate.tab : DEFAULT_ORCHESTRATION_PREFERENCES.tab,
  };
};

const readAllPreferences = (): Record<string, OrchestrationPreferences> => {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(ORCHESTRATION_PREFERENCES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).map(([scope, value]) => [scope, normalizePreferences(value)]),
    );
  } catch {
    return {};
  }
};

const scopeKey = (threadId?: string | null): string => threadId?.trim() || 'new-thread';

export const readOrchestrationPreferences = (threadId?: string | null): OrchestrationPreferences => {
  return readAllPreferences()[scopeKey(threadId)] || DEFAULT_ORCHESTRATION_PREFERENCES;
};

export const writeOrchestrationPreferences = (
  threadId: string | null | undefined,
  preferences: Partial<OrchestrationPreferences>,
): OrchestrationPreferences => {
  const key = scopeKey(threadId);
  const next = normalizePreferences({ ...readOrchestrationPreferences(threadId), ...preferences });

  try {
    const all = readAllPreferences();
    all[key] = next;
    window.localStorage.setItem(ORCHESTRATION_PREFERENCES_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // The caller still receives the active preference when storage is unavailable.
  }

  return next;
};

export const resetOrchestrationPreferences = (threadId?: string | null): void => {
  try {
    const all = readAllPreferences();
    delete all[scopeKey(threadId)];
    window.localStorage.setItem(ORCHESTRATION_PREFERENCES_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Reset is best effort when storage is unavailable.
  }
};
