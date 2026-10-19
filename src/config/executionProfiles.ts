/**
 * User-facing execution presets.
 *
 * These values intentionally live outside the engine and provider adapters so
 * the UI can describe the same behavior that the runtime actually applies.
 * Billing is still determined by the selected provider/model; these presets
 * only control pacing, presentation, and request resilience.
 *
 * This is the adjustment point for the four user-facing pacing profiles. Keep
 * every profile's values explicit so a pacing change updates the engine and
 * the UI together. The object keys remain stable for saved runs and API
 * compatibility; their labels are the names users see in the UI.
 */

export type ExecutionPacingProfile = 'automatic' | 'conservative' | 'phased' | 'fast';

export interface ExecutionProfilePreset {
  label: string;
  description: string;
  /** Delay between model requests owned by the ReAct engine. */
  requestIntervalMs: number;
  /** Minimum provider-side interval for free-tier-aware routes. */
  providerRequestIntervalMs: number;
  /** Extra time reserved to show successful workspace activity. */
  toolPresentation: {
    readMs: number;
    writeMs: number;
  };
  /** Time reserved to show the safe action summary before tool execution. */
  decisionPresentation: {
    minMs: number;
    maxMs: number;
    charactersPerStep: number;
  };
  /** Whether the live status text uses the free-tier typewriter presentation. */
  typewriter: {
    enabled: boolean;
    intervalMs: number;
  };
  /** Minimum request timeout applied to free-tier execution profiles. */
  requestTimeoutFloorMs: number;
}

export type ExecutionProfilePresetMap = Record<ExecutionPacingProfile, ExecutionProfilePreset>;

export const EXECUTION_PROFILE_PRESETS: ExecutionProfilePresetMap = {
  automatic: {
    label: 'Adaptive',
    description: 'Waits for each model and tool turn to finish, then continues immediately; backoff is reserved for throttling and failures.',
    requestIntervalMs: 0,
    providerRequestIntervalMs: 6_000,
    toolPresentation: { readMs: 0, writeMs: 0 },
    decisionPresentation: { minMs: 0, maxMs: 0, charactersPerStep: 120 },
    typewriter: { enabled: false, intervalMs: 32 },
    requestTimeoutFloorMs: 0,
  },
  conservative: {
    label: 'Free',
    description: 'Uses a six-second request gap, free-tier request spacing, and readable action presentation.',
    requestIntervalMs: 6_000,
    providerRequestIntervalMs: 6_000,
    toolPresentation: { readMs: 1_600, writeMs: 3_200 },
    decisionPresentation: { minMs: 1_000, maxMs: 3_000, charactersPerStep: 120 },
    typewriter: { enabled: true, intervalMs: 32 },
    requestTimeoutFloorMs: 120_000,
  },
  phased: {
    label: 'Free Conservative',
    description: 'Uses a ten-second request gap and slower action presentation for the strongest free-tier protection.',
    requestIntervalMs: 10_000,
    providerRequestIntervalMs: 10_000,
    toolPresentation: { readMs: 2_400, writeMs: 4_800 },
    decisionPresentation: { minMs: 1_000, maxMs: 4_000, charactersPerStep: 120 },
    typewriter: { enabled: true, intervalMs: 42 },
    requestTimeoutFloorMs: 120_000,
  },
  fast: {
    label: 'Paid',
    description: 'Removes intentional engine pacing for the lowest latency; provider safeguards and checkpoint recovery still apply.',
    requestIntervalMs: 0,
    providerRequestIntervalMs: 0,
    toolPresentation: { readMs: 0, writeMs: 0 },
    decisionPresentation: { minMs: 0, maxMs: 0, charactersPerStep: 120 },
    typewriter: { enabled: false, intervalMs: 8 },
    requestTimeoutFloorMs: 0,
  },
};

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(min, Math.min(max, Math.floor(parsed)))
    : fallback;
}

function normalizeProfilePreset(
  profileId: ExecutionPacingProfile,
  value: unknown,
): ExecutionProfilePreset {
  const base = EXECUTION_PROFILE_PRESETS[profileId];
  const input = isRecord(value) ? { ...value } : {};
  // Migrate the previous automatic defaults to response-driven pacing. Keep
  // deliberate user overrides intact; this only recognizes the old complete
  // default shape that was written by the application itself.
  if (
    profileId === 'automatic'
    && input.requestIntervalMs === 1_500
    && input.providerRequestIntervalMs === 6_000
    && isRecord(input.toolPresentation)
    && input.toolPresentation.readMs === 1_600
    && input.toolPresentation.writeMs === 3_200
  ) {
    delete input.requestIntervalMs;
    delete input.toolPresentation;
  }
  const toolPresentation = isRecord(input.toolPresentation) ? input.toolPresentation : {};
  const decisionPresentation = isRecord(input.decisionPresentation) ? input.decisionPresentation : {};
  const typewriter = isRecord(input.typewriter) ? input.typewriter : {};
  const decisionMinMs = boundedNumber(decisionPresentation.minMs, base.decisionPresentation.minMs, 0, 30_000);
  const decisionMaxMs = boundedNumber(decisionPresentation.maxMs, base.decisionPresentation.maxMs, decisionMinMs, 30_000);

  return {
    ...base,
    requestIntervalMs: boundedNumber(input.requestIntervalMs, base.requestIntervalMs, 0, 60_000),
    providerRequestIntervalMs: boundedNumber(input.providerRequestIntervalMs, base.providerRequestIntervalMs, 0, 60_000),
    toolPresentation: {
      readMs: boundedNumber(toolPresentation.readMs, base.toolPresentation.readMs, 0, 30_000),
      writeMs: boundedNumber(toolPresentation.writeMs, base.toolPresentation.writeMs, 0, 30_000),
    },
    decisionPresentation: {
      minMs: decisionMinMs,
      maxMs: decisionMaxMs,
      charactersPerStep: boundedNumber(decisionPresentation.charactersPerStep, base.decisionPresentation.charactersPerStep, 1, 1_000),
    },
    typewriter: {
      enabled: typeof typewriter.enabled === 'boolean' ? typewriter.enabled : base.typewriter.enabled,
      intervalMs: boundedNumber(typewriter.intervalMs, base.typewriter.intervalMs, 1, 1_000),
    },
    requestTimeoutFloorMs: boundedNumber(input.requestTimeoutFloorMs, base.requestTimeoutFloorMs, 0, 300_000),
  };
}

/** Return a detached copy suitable for UI state or API responses. */
export function cloneExecutionProfilePresets(source: ExecutionProfilePresetMap = EXECUTION_PROFILE_PRESETS): ExecutionProfilePresetMap {
  return (Object.keys(EXECUTION_PROFILE_PRESETS) as ExecutionPacingProfile[]).reduce((profiles, profileId) => {
    const preset = source[profileId] || EXECUTION_PROFILE_PRESETS[profileId];
    profiles[profileId] = {
      ...preset,
      toolPresentation: { ...preset.toolPresentation },
      decisionPresentation: { ...preset.decisionPresentation },
      typewriter: { ...preset.typewriter },
    };
    return profiles;
  }, {} as ExecutionProfilePresetMap);
}

/** Normalize user/API input while keeping labels and safety bounds controlled by the app. */
export function normalizeExecutionProfilePresets(input: unknown): ExecutionProfilePresetMap {
  const source = isRecord(input) ? input : {};
  return (Object.keys(EXECUTION_PROFILE_PRESETS) as ExecutionPacingProfile[]).reduce((profiles, profileId) => {
    profiles[profileId] = normalizeProfilePreset(profileId, source[profileId]);
    return profiles;
  }, {} as ExecutionProfilePresetMap);
}

let activeExecutionProfilePresets = cloneExecutionProfilePresets();

/** Apply persisted settings to new runtime requests without changing profile IDs. */
export function setExecutionProfilePresets(input: unknown): ExecutionProfilePresetMap {
  activeExecutionProfilePresets = normalizeExecutionProfilePresets(input);
  return cloneExecutionProfilePresets(activeExecutionProfilePresets);
}

/** The four pacing profiles shown to users, ordered from fastest to safest. */
export const USER_EXECUTION_PROFILE_IDS: ExecutionPacingProfile[] = [
  'fast',
  'automatic',
  'conservative',
  'phased',
];

export function getExecutionProfilePreset(profile: ExecutionPacingProfile | undefined): ExecutionProfilePreset {
  return activeExecutionProfilePresets[profile || 'automatic'] || activeExecutionProfilePresets.automatic;
}

export function getExecutionProfileProviderIntervalMs(profile: ExecutionPacingProfile | undefined): number {
  return getExecutionProfilePreset(profile).providerRequestIntervalMs;
}
