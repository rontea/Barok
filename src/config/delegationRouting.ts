import { getSQLiteAppStore } from '../persistence/sqliteStore.js';
import {
  getGeminiTargetModelValue,
  getSavedGeminiModelTargets,
  isGeminiTargetModelValue,
  resolveGeminiModelTarget,
} from './geminiTargets.js';
import {
  getNvidiaTargetModelValue,
  getSavedNvidiaModelTargets,
  isNvidiaTargetModelValue,
  resolveNvidiaModelTarget,
} from './nvidiaTargets.js';
import {
  DELEGATION_ROLES,
  DELEGATION_SETTINGS_KEY,
  MAX_DELEGATION_ROLE_RULE_LENGTH,
  MAX_DELEGATION_ROLE_RULES_LENGTH,
  MAX_DELEGATION_SLOTS,
} from './delegationContracts.js';
import type {
  DelegationRole,
  DelegationRoute,
  DelegationRouteOption,
  DelegationSettings,
  DelegationSettingsSnapshot,
  DelegationSlot,
  DelegationValidation,
} from './delegationContracts.js';

export {
  DELEGATION_ROLES,
  DELEGATION_SETTINGS_KEY,
  MAX_DELEGATION_ROLE_RULE_LENGTH,
  MAX_DELEGATION_ROLE_RULES_LENGTH,
  MAX_DELEGATION_SLOTS,
} from './delegationContracts.js';
export type {
  DelegationProvider,
  DelegationRole,
  DelegationRoute,
  DelegationRouteOption,
  DelegationSettings,
  DelegationSettingsSnapshot,
  DelegationSlot,
  DelegationValidation,
} from './delegationContracts.js';

const DEFAULT_SETTINGS: DelegationSettings = {
  enabled: false,
  delegates: [],
  allowedRoles: [...DELEGATION_ROLES],
  roleRules: {},
  maxConcurrentDelegates: 1,
};

function isDelegationRole(value: unknown): value is DelegationRole {
  return typeof value === 'string' && (DELEGATION_ROLES as readonly string[]).includes(value);
}

function normalizeRoleRules(value: unknown): Partial<Record<DelegationRole, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Partial<Record<DelegationRole, string>> = {};
  for (const [key, rawRule] of Object.entries(value)) {
    if (!isDelegationRole(key) || typeof rawRule !== 'string') continue;
    const rule = rawRule.trim().slice(0, MAX_DELEGATION_ROLE_RULE_LENGTH);
    if (rule) result[key] = rule;
  }
  return result;
}

function normalizeRoute(value: unknown): DelegationRoute | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<DelegationRoute>;
  const provider = candidate.provider === 'nvidia' || candidate.provider === 'gemini'
    ? candidate.provider
    : undefined;
  const model = typeof candidate.model === 'string' ? candidate.model.trim() : '';
  return provider && model ? { provider, model } : null;
}

export function normalizeDelegationSettings(value: unknown): DelegationSettings {
  const source = value && typeof value === 'object' ? value as Partial<DelegationSettings> : {};
  const rawDelegates = Array.isArray(source.delegates) ? source.delegates : [];
  const seenSlots = new Set<number>();
  const delegates = rawDelegates
    .map((candidate, index): DelegationSlot | null => {
      const item = candidate && typeof candidate === 'object' ? candidate as Partial<DelegationSlot> : {};
      const parsedSlot = Number(item.slot);
      const slot = Number.isInteger(parsedSlot) && parsedSlot >= 1 && parsedSlot <= MAX_DELEGATION_SLOTS
        ? parsedSlot
        : index + 1;
      if (seenSlots.has(slot)) return null;
      seenSlots.add(slot);
      return { slot, route: normalizeRoute(item.route) };
    })
    .filter((item): item is DelegationSlot => Boolean(item))
    .sort((a, b) => a.slot - b.slot)
    .slice(0, MAX_DELEGATION_SLOTS);

  const maxConcurrent = Number(source.maxConcurrentDelegates);
  const allowedRoles = Array.isArray(source.allowedRoles)
    ? Array.from(new Set(source.allowedRoles.filter(isDelegationRole)))
    : [...DELEGATION_ROLES];
  return {
    enabled: source.enabled === true,
    delegates,
    allowedRoles,
    roleRules: normalizeRoleRules(source.roleRules),
    // Delegation is intentionally serialized. Older settings may contain a
    // higher value, but allowing it would let workers overlap and defeat the
    // parent/worker pause-and-resume contract.
    maxConcurrentDelegates: Number.isFinite(maxConcurrent)
      ? 1
      : DEFAULT_SETTINGS.maxConcurrentDelegates,
  };
}

export function getDelegationSettings(): DelegationSettings {
  return normalizeDelegationSettings(getSQLiteAppStore().getSetting(DELEGATION_SETTINGS_KEY));
}

/** Return the non-secret delegation policy that can be attached to a run audit. */
export function getDelegationSettingsSnapshot(settings: DelegationSettings = getDelegationSettings()): DelegationSettingsSnapshot {
  return {
    enabled: settings.enabled,
    delegates: settings.delegates.map((delegate) => ({
      slot: delegate.slot,
      route: delegate.route ? { provider: delegate.route.provider, model: delegate.route.model } : null,
    })),
    allowedRoles: [...settings.allowedRoles],
    roleRules: { ...settings.roleRules },
    maxConcurrentDelegates: 1,
  };
}

function routeTargetExists(route: DelegationRoute): boolean {
  if (route.provider === 'nvidia') {
    return isNvidiaTargetModelValue(route.model) && Boolean(resolveNvidiaModelTarget(route.model));
  }
  return isGeminiTargetModelValue(route.model) && Boolean(resolveGeminiModelTarget(route.model));
}

function routeKey(route: DelegationRoute): string {
  return `${route.provider}:${route.model}`;
}

function credentialKey(route: DelegationRoute): string | undefined {
  if (route.provider === 'nvidia') {
    const target = resolveNvidiaModelTarget(route.model);
    return target ? `nvidia:key:${target.apiKeyIndex}` : undefined;
  }
  const target = resolveGeminiModelTarget(route.model);
  return target ? `gemini:profile:${target.profileId || `key:${target.apiKeyIndex}`}` : undefined;
}

export function validateDelegationSettings(value: unknown): DelegationValidation {
  const settings = normalizeDelegationSettings(value);
  const errors: string[] = [];
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};

  if (Array.isArray(source.allowedRoles)) {
    const invalidRoles = source.allowedRoles.filter((role) => !isDelegationRole(role));
    if (invalidRoles.length > 0) errors.push(`Unknown delegation role(s): ${invalidRoles.join(', ')}.`);
    if (source.allowedRoles.length === 0) errors.push('Allow at least one delegation role or disable delegation.');
  }
  if (source.roleRules && typeof source.roleRules === 'object' && !Array.isArray(source.roleRules)) {
    let totalRuleLength = 0;
    for (const [role, rawRule] of Object.entries(source.roleRules)) {
      if (!isDelegationRole(role)) {
        errors.push(`Role rule ${role} is not an approved delegation role.`);
        continue;
      }
      if (typeof rawRule !== 'string') {
        errors.push(`Role rule ${role} must be text.`);
        continue;
      }
      totalRuleLength += rawRule.trim().length;
      if (rawRule.trim().length > MAX_DELEGATION_ROLE_RULE_LENGTH) {
        errors.push(`Role rule ${role} exceeds the ${MAX_DELEGATION_ROLE_RULE_LENGTH}-character limit.`);
      }
    }
    if (totalRuleLength > MAX_DELEGATION_ROLE_RULES_LENGTH) errors.push(`Role rules exceed the ${MAX_DELEGATION_ROLE_RULES_LENGTH}-character aggregate limit.`);
  }
  const routes: Array<{ name: string; route: DelegationRoute }> = [];

  for (const delegate of settings.delegates) {
    if (delegate.route) routes.push({ name: `delegate task ${delegate.slot}`, route: delegate.route });
  }

  const delegateCount = settings.delegates.filter((delegate) => Boolean(delegate.route)).length;
  if (settings.enabled && delegateCount === 0) {
    errors.push('Configure at least one delegate task route before enabling delegation.');
  }

  const seenRoutes = new Set<string>();
  const seenCredentials = new Set<string>();
  const enforceRouteUniqueness = settings.enabled;
  for (const entry of routes) {
    const targetExists = routeTargetExists(entry.route);
    if (settings.enabled && !targetExists) {
      errors.push(`${entry.name} points to a missing or invalid saved ${entry.route.provider} model target.`);
    }
    const key = routeKey(entry.route);
    if (enforceRouteUniqueness && seenRoutes.has(key)) {
      errors.push(`${entry.name} reuses a route already assigned elsewhere. Use a different API key/profile target to reduce throttling.`);
    }
    seenRoutes.add(key);
    const credential = credentialKey(entry.route);
    if (enforceRouteUniqueness && credential && seenCredentials.has(credential)) {
      errors.push(`${entry.name} shares an API credential/profile with another route. Use distinct credentials to reduce throttling.`);
    }
    if (credential) seenCredentials.add(credential);
  }

  return { valid: errors.length === 0, errors };
}

export function assertDelegationRoleAllowed(settings: DelegationSettings, role: string): void {
  const normalizedRole = role.trim().toLowerCase();
  if (!isDelegationRole(normalizedRole)) throw new Error(`Unknown sub-agent role: ${role}`);
  if (!settings.allowedRoles.includes(normalizedRole)) {
    throw new Error(`Delegation role ${normalizedRole} is not allowed by the server-side delegation allowlist.`);
  }
}

export function saveDelegationSettings(value: unknown): DelegationSettings {
  const settings = normalizeDelegationSettings(value);
  const validation = validateDelegationSettings(settings);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  getSQLiteAppStore().saveSetting(DELEGATION_SETTINGS_KEY, settings);
  return settings;
}

export function getDelegationRouteOptions(): DelegationRouteOption[] {
  const nvidia = getSavedNvidiaModelTargets().map((target) => ({
    provider: 'nvidia' as const,
    model: getNvidiaTargetModelValue(target.id),
    modelId: target.modelId,
    label: `${target.title} · NVIDIA API key ${target.apiKeyIndex + 1}`,
    credentialIndex: target.apiKeyIndex,
    targetId: target.id,
  }));
  const gemini = getSavedGeminiModelTargets().map((target) => ({
    provider: 'gemini' as const,
    model: getGeminiTargetModelValue(target.id),
    modelId: target.modelId,
    label: `${target.title} · Gemini profile ${target.profileId || target.apiKeyIndex + 1}`,
    credentialIndex: target.apiKeyIndex,
    ...(target.profileId ? { profileId: target.profileId } : {}),
    targetId: target.id,
  }));
  return [...nvidia, ...gemini];
}

export function getDelegationRouteLabel(route: DelegationRoute | null): string {
  if (!route) return 'Unassigned';
  return getDelegationRouteOptions().find((option) => option.provider === route.provider && option.model === route.model)?.label
    || `${route.provider} · ${route.model}`;
}

let nextAutoSlot = 0;

export function resetDelegationSlotAllocator(): void {
  nextAutoSlot = 0;
}

export function selectDelegationRoute(
  settings: DelegationSettings,
  requestedSlot?: number,
): { slot: number; route: DelegationRoute } {
  const configured = settings.delegates.filter((delegate): delegate is DelegationSlot & { route: DelegationRoute } => Boolean(delegate.route));
  if (configured.length === 0) throw new Error('No delegate task routes are configured. Open Settings > Agent delegation first.');

  if (requestedSlot !== undefined) {
    const requested = configured.find((delegate) => delegate.slot === requestedSlot);
    if (!requested) throw new Error(`Delegate task slot ${requestedSlot} is not configured.`);
    return { slot: requested.slot, route: requested.route };
  }

  const selected = configured[nextAutoSlot % configured.length];
  nextAutoSlot = (nextAutoSlot + 1) % configured.length;
  return { slot: selected.slot, route: selected.route };
}

let delegationTail: Promise<void> = Promise.resolve();

/**
 * Serialize child runs behind one queue. The parent action awaits this
 * promise, so it resumes only after the selected worker has finished.
 */
export async function withDelegationConcurrency<T>(settings: DelegationSettings, task: () => Promise<T>): Promise<T> {
  // Keep the settings parameter for API compatibility and future scheduling
  // policy, but never run delegated workers concurrently.
  void settings;
  const previous = delegationTail;
  let release!: () => void;
  delegationTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}
