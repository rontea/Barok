/**
 * Typed process-wide settings that can be changed while the server is running.
 * Environment variables are read once during initialization; persisted values
 * then take precedence and SQLite remains the durable source of truth.
 */

export type RuntimeLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface RuntimeSettings {
  maxSteps: number;
  maxLlmRequestsPerTask: number;
  budget: number;
  requestTimeoutMs: number;
  crewAgents: number;
  crewParallel: boolean;
  parallelTasks: boolean;
  maxRetries: number;
  retryBackoffMs: number;
  retryMultiplier: number;
  logLevel: RuntimeLogLevel;
  debug: boolean;
  reactVerbose: boolean;
  enableLogging: boolean;
  toolTimeoutDefault: number;
  toolTimeoutBash: number;
  toolTimeoutFileops: number;
  toolTimeoutGlob: number;
  toolTimeoutGrep: number;
  toolTimeoutSubagent: number;
}

export interface RuntimeToolTimeouts {
  default: number;
  bash: number;
  fileOps: number;
  glob: number;
  grep: number;
  subAgent: number;
}

const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  maxSteps: 25,
  maxLlmRequestsPerTask: 20,
  budget: 100,
  requestTimeoutMs: 300_000,
  crewAgents: 4,
  crewParallel: true,
  parallelTasks: true,
  maxRetries: 3,
  retryBackoffMs: 1_000,
  retryMultiplier: 2,
  logLevel: 'info',
  debug: false,
  reactVerbose: false,
  enableLogging: true,
  toolTimeoutDefault: 30_000,
  toolTimeoutBash: 30_000,
  toolTimeoutFileops: 15_000,
  toolTimeoutGlob: 10_000,
  toolTimeoutGrep: 30_000,
  toolTimeoutSubagent: 120_000,
};

function readEnvironmentNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function readEnvironmentBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (typeof raw !== 'string') return fallback;
  switch (raw.trim().toLowerCase()) {
    case 'true':
    case '1':
    case 'yes':
    case 'on':
      return true;
    case 'false':
    case '0':
    case 'no':
    case 'off':
      return false;
    default:
      return fallback;
  }
}

function readEnvironmentSettings(): Partial<RuntimeSettings> {
  return {
    maxSteps: readEnvironmentNumber('MAX_STEPS', DEFAULT_RUNTIME_SETTINGS.maxSteps),
    maxLlmRequestsPerTask: readEnvironmentNumber(
      'REACT_ENGINE_LLM_MAX_REQUESTS_PER_TASK', DEFAULT_RUNTIME_SETTINGS.maxLlmRequestsPerTask,
    ),
    budget: readEnvironmentNumber('BUDGET', DEFAULT_RUNTIME_SETTINGS.budget),
    requestTimeoutMs: readEnvironmentNumber('REQUEST_TIMEOUT', DEFAULT_RUNTIME_SETTINGS.requestTimeoutMs),
    crewAgents: readEnvironmentNumber('CREW_AGENTS', DEFAULT_RUNTIME_SETTINGS.crewAgents),
    crewParallel: readEnvironmentBoolean('CREW_PARALLEL', DEFAULT_RUNTIME_SETTINGS.crewParallel),
    parallelTasks: readEnvironmentBoolean('PARALLEL_TASKS', DEFAULT_RUNTIME_SETTINGS.parallelTasks),
    maxRetries: readEnvironmentNumber('MAX_RETRIES', DEFAULT_RUNTIME_SETTINGS.maxRetries),
    retryBackoffMs: readEnvironmentNumber('RETRY_BACKOFF_MS', DEFAULT_RUNTIME_SETTINGS.retryBackoffMs),
    retryMultiplier: readEnvironmentNumber('RETRY_MULTIPLIER', DEFAULT_RUNTIME_SETTINGS.retryMultiplier),
    logLevel: ['debug', 'info', 'warn', 'error'].includes(process.env.LOG_LEVEL || '')
      ? process.env.LOG_LEVEL as RuntimeLogLevel
      : DEFAULT_RUNTIME_SETTINGS.logLevel,
    debug: readEnvironmentBoolean('DEBUG', DEFAULT_RUNTIME_SETTINGS.debug),
    reactVerbose: readEnvironmentBoolean('REACT_VERBOSE', DEFAULT_RUNTIME_SETTINGS.reactVerbose),
    enableLogging: readEnvironmentBoolean('ENABLE_LOGGING', DEFAULT_RUNTIME_SETTINGS.enableLogging),
    toolTimeoutDefault: readEnvironmentNumber('TOOL_TIMEOUT_DEFAULT', DEFAULT_RUNTIME_SETTINGS.toolTimeoutDefault),
    toolTimeoutBash: readEnvironmentNumber('TOOL_TIMEOUT_BASH', DEFAULT_RUNTIME_SETTINGS.toolTimeoutBash),
    toolTimeoutFileops: readEnvironmentNumber('TOOL_TIMEOUT_FILEOPS', DEFAULT_RUNTIME_SETTINGS.toolTimeoutFileops),
    toolTimeoutGlob: readEnvironmentNumber('TOOL_TIMEOUT_GLOB', DEFAULT_RUNTIME_SETTINGS.toolTimeoutGlob),
    toolTimeoutGrep: readEnvironmentNumber('TOOL_TIMEOUT_GREP', DEFAULT_RUNTIME_SETTINGS.toolTimeoutGrep),
    toolTimeoutSubagent: readEnvironmentNumber('TOOL_TIMEOUT_SUBAGENT', DEFAULT_RUNTIME_SETTINGS.toolTimeoutSubagent),
  };
}

function numberOr(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function clamp(value: number, min: number, max = Number.POSITIVE_INFINITY): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeSettings(base: RuntimeSettings, input: Partial<RuntimeSettings>): RuntimeSettings {
  const merged = { ...base, ...input };
  return {
    maxSteps: clamp(numberOr(merged.maxSteps, base.maxSteps), 1, 1000),
    maxLlmRequestsPerTask: clamp(numberOr(merged.maxLlmRequestsPerTask, base.maxLlmRequestsPerTask), 1, 100),
    budget: clamp(numberOr(merged.budget, base.budget), 1),
    requestTimeoutMs: clamp(numberOr(merged.requestTimeoutMs, base.requestTimeoutMs), 10_000),
    crewAgents: clamp(numberOr(merged.crewAgents, base.crewAgents), 1, 16),
    crewParallel: typeof merged.crewParallel === 'boolean' ? merged.crewParallel : base.crewParallel,
    parallelTasks: typeof merged.parallelTasks === 'boolean' ? merged.parallelTasks : base.parallelTasks,
    maxRetries: clamp(numberOr(merged.maxRetries, base.maxRetries), 1, 10),
    retryBackoffMs: clamp(numberOr(merged.retryBackoffMs, base.retryBackoffMs), 100),
    retryMultiplier: clamp(numberOr(merged.retryMultiplier, base.retryMultiplier), 1.1),
    logLevel: ['debug', 'info', 'warn', 'error'].includes(String(merged.logLevel))
      ? merged.logLevel as RuntimeLogLevel
      : base.logLevel,
    debug: typeof merged.debug === 'boolean' ? merged.debug : base.debug,
    reactVerbose: typeof merged.reactVerbose === 'boolean' ? merged.reactVerbose : base.reactVerbose,
    enableLogging: typeof merged.enableLogging === 'boolean' ? merged.enableLogging : base.enableLogging,
    toolTimeoutDefault: clamp(numberOr(merged.toolTimeoutDefault, base.toolTimeoutDefault), 1000),
    toolTimeoutBash: clamp(numberOr(merged.toolTimeoutBash, base.toolTimeoutBash), 1000),
    toolTimeoutFileops: clamp(numberOr(merged.toolTimeoutFileops, base.toolTimeoutFileops), 1000),
    toolTimeoutGlob: clamp(numberOr(merged.toolTimeoutGlob, base.toolTimeoutGlob), 1000),
    toolTimeoutGrep: clamp(numberOr(merged.toolTimeoutGrep, base.toolTimeoutGrep), 1000),
    toolTimeoutSubagent: clamp(numberOr(merged.toolTimeoutSubagent, base.toolTimeoutSubagent), 5000),
  };
}

class RuntimeSettingsStore {
  private initialized = false;
  private value: RuntimeSettings = { ...DEFAULT_RUNTIME_SETTINGS };

  /** Call once during startup after dotenv has loaded and SQLite is available. */
  initialize(persisted?: unknown): RuntimeSettings {
    if (this.initialized) {
      if (persisted && typeof persisted === 'object') {
        this.value = normalizeSettings(this.value, persisted as Partial<RuntimeSettings>);
      }
      return this.get();
    }

    const environmentSettings = normalizeSettings(DEFAULT_RUNTIME_SETTINGS, readEnvironmentSettings());
    const savedSettings = persisted && typeof persisted === 'object'
      ? persisted as Partial<RuntimeSettings>
      : {};
    this.value = normalizeSettings(environmentSettings, savedSettings);
    this.initialized = true;
    return this.get();
  }

  get(): RuntimeSettings {
    if (!this.initialized) this.initialize();
    return { ...this.value };
  }

  update(settings: Partial<RuntimeSettings>): RuntimeSettings {
    if (!this.initialized) this.initialize();
    this.value = normalizeSettings(this.value, settings);
    return this.get();
  }
}

export const runtimeSettings = new RuntimeSettingsStore();

export function initializeRuntimeSettings(persisted?: unknown): RuntimeSettings {
  return runtimeSettings.initialize(persisted);
}

export function getRuntimeSettings(): RuntimeSettings {
  return runtimeSettings.get();
}

export function updateRuntimeSettings(settings: Partial<RuntimeSettings>): RuntimeSettings {
  return runtimeSettings.update(settings);
}

export function resolveRuntimeSettings(
  settings: Partial<RuntimeSettings>,
  base: RuntimeSettings = getRuntimeSettings(),
): RuntimeSettings {
  return normalizeSettings(base, settings);
}

export function getRuntimeToolTimeouts(): RuntimeToolTimeouts {
  const settings = getRuntimeSettings();
  return {
    default: settings.toolTimeoutDefault,
    bash: settings.toolTimeoutBash,
    fileOps: settings.toolTimeoutFileops,
    glob: settings.toolTimeoutGlob,
    grep: settings.toolTimeoutGrep,
    subAgent: settings.toolTimeoutSubagent,
  };
}
