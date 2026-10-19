export type DelegationProvider = 'nvidia' | 'gemini';

export const DELEGATION_ROLES = ['coder', 'researcher', 'tester', 'reviewer', 'planner', 'documenter', 'specialist'] as const;
export type DelegationRole = typeof DELEGATION_ROLES[number];
export const MAX_DELEGATION_ROLE_RULE_LENGTH = 2_000;
export const MAX_DELEGATION_ROLE_RULES_LENGTH = 8_000;

/** A saved target binds a delegated model to one NVIDIA key or Gemini profile. */
export interface DelegationRoute {
  provider: DelegationProvider;
  model: string;
}

export interface DelegationSlot {
  slot: number;
  route: DelegationRoute | null;
}

export interface DelegationSettings {
  enabled: boolean;
  delegates: DelegationSlot[];
  allowedRoles: DelegationRole[];
  roleRules: Partial<Record<DelegationRole, string>>;
  /** Compatibility field retained for persisted settings. Delegates execute serially. */
  maxConcurrentDelegates: number;
}

export interface DelegationValidation {
  valid: boolean;
  errors: string[];
}

export interface DelegationSettingsSnapshot {
  enabled: boolean;
  delegates: DelegationSlot[];
  allowedRoles: DelegationRole[];
  roleRules: Partial<Record<DelegationRole, string>>;
  maxConcurrentDelegates: 1;
}

export interface DelegationRouteOption {
  provider: DelegationProvider;
  model: string;
  modelId: string;
  label: string;
  credentialIndex: number;
  profileId?: string;
  targetId: string;
}

export const DELEGATION_SETTINGS_KEY = 'agent.delegationRouting';
export const MAX_DELEGATION_SLOTS = 16;
