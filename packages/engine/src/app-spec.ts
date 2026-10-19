/** Minimal provider capability needed to complete an app specification. */
export interface AppSpecLLMProvider {
  createChatCompletion(
    messages: Array<{ role: string; content: string }>,
    model: string,
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<string>;
}

export type AppType = 'game' | 'tool' | 'dashboard' | 'landing' | 'editor' | 'utility';
export type AppOutputMode = 'single-html' | 'vanilla-web' | 'vite-react';

export interface AppSpec {
  appType: AppType;
  outputMode: AppOutputMode;
  appName: string;
  entryPoint: string;
  requiredFeatures: string[];
  designDirection: string;
  dataPersistence: boolean;
  verificationChecks: string[];
}

interface RawAppSpec {
  appType?: unknown;
  outputMode?: unknown;
  appName?: unknown;
  entryPoint?: unknown;
  requiredFeatures?: unknown;
  designDirection?: unknown;
  dataPersistence?: unknown;
  verificationChecks?: unknown;
}

const APP_TYPES: AppType[] = ['game', 'tool', 'dashboard', 'landing', 'editor', 'utility'];
const OUTPUT_MODES: AppOutputMode[] = ['single-html', 'vanilla-web', 'vite-react'];

const APP_REQUEST_PATTERNS = [
  /\b(build|create|make|generate|write|develop|scaffold)\b[\s\S]{0,80}\b(app|application|site|website|game|dashboard|tool|editor|studio|calculator|kanban|todo|piano|synth|paint|canvas)\b/i,
  /\b(app|application|site|website|game|dashboard|tool|editor|studio|calculator|kanban|todo|piano|synth|paint|canvas)\b[\s\S]{0,80}\b(build|create|make|generate|write|develop|scaffold)\b/i,
  /\bstandalone\b[\s\S]{0,80}\b(html|app|game|tool|website)\b/i,
];

export function isAppBuildRequest(task: string): boolean {
  return APP_REQUEST_PATTERNS.some((pattern) => pattern.test(task));
}

export function classifyAppType(task: string): AppType {
  const lower = task.toLowerCase();

  if (/\b(game|snake|arcade|quiz|puzzle|platformer|runner)\b/.test(lower)) return 'game';
  if (/\b(dashboard|admin|analytics|metrics|crm|kanban)\b/.test(lower)) return 'dashboard';
  if (/\b(landing|homepage|marketing|portfolio|product page|venue)\b/.test(lower)) return 'landing';
  if (/\b(editor|paint|drawing|canvas|studio|builder|designer)\b/.test(lower)) return 'editor';
  if (/\b(tool|calculator|converter|timer|pomodoro|planner|tracker|synth|piano)\b/.test(lower)) return 'tool';

  return 'utility';
}

export function selectOutputMode(task: string): AppOutputMode {
  const lower = task.toLowerCase();
  if (
    /\b(vite|typescript project)\b/.test(lower)
    || /\breact(?:\.js)?\s+(?:project|app|application|site|website|components?)\b/.test(lower)
    || /\b(?:using|with|in)\s+react(?:\.js)?\b/.test(lower)
  ) {
    return 'vite-react';
  }
  if (/\b(vanilla|plain javascript|no framework|without (?:npm|package\.json|a build system)|multi[- ]file|multiple files|separate files|distinct files|different files|three[- ]files?|3[- ]files?)\b/.test(lower)
    || /\bhtml\b[\s,/+]+(?:and\s+)?css\b[\s,/+]*(?:and\s+)?(?:js|javascript)\b/.test(lower)) {
    return 'vanilla-web';
  }
  return 'single-html';
}

export function inferAppName(task: string): string {
  const quoted = task.match(/["']([^"']{2,80})["']/);
  if (quoted?.[1]) return toTitleCase(quoted[1]);

  const named = task.match(/\b(?:named|called|for)\s+([a-z0-9][a-z0-9 -]{1,50})/i);
  if (named?.[1]) return toTitleCase(named[1].replace(/\b(in|inside|with|that|which)\b[\s\S]*$/i, '').trim());

  const appType = classifyAppType(task);
  return toTitleCase(`${appType} app`);
}

export function buildFallbackAppSpec(task: string): AppSpec {
  const appType = classifyAppType(task);
  const outputMode = selectOutputMode(task);
  const appName = inferAppName(task);
  const lower = task.toLowerCase();
  const requiresPersistence = /\b(localstorage|persist|save|history|remember|session|high[- ]score|tasks|todo|kanban)\b/.test(lower);

  return {
    appType,
    outputMode,
    appName,
    entryPoint: defaultEntryPoint(appName, outputMode),
    requiredFeatures: inferRequiredFeatures(task, appType),
    designDirection: inferDesignDirection(task, appType),
    dataPersistence: requiresPersistence,
    verificationChecks: inferVerificationChecks(appType, outputMode, requiresPersistence),
  };
}

export async function createAppSpec(
  task: string,
  llm: AppSpecLLMProvider,
  model: string
): Promise<AppSpec | null> {
  if (!isAppBuildRequest(task)) return null;

  const fallback = buildFallbackAppSpec(task);

  const systemPrompt = `You convert app-building requests into a structured implementation contract.
Return ONLY a JSON object with these fields:
{
  "appType": "game|tool|dashboard|landing|editor|utility",
  "outputMode": "single-html|vanilla-web|vite-react",
  "appName": "short human-readable name",
  "entryPoint": "relative entry file path",
  "requiredFeatures": ["specific feature"],
  "designDirection": "short design direction",
  "dataPersistence": true,
  "verificationChecks": ["specific check"]
}

Rules:
- Prefer "single-html" when the request asks for standalone HTML or a single file.
- Use "vanilla-web" for multi-file HTML/CSS/JavaScript apps without a requested framework or build system.
- Use "vite-react" only when the request asks for a React, Vite, or TypeScript project.
- Include concrete interactive behavior in requiredFeatures.
- Include responsive layout and initial-load verification checks.`;

  try {
    const response = await llm.createChatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Task: ${task}` },
      ],
      model,
      { temperature: 0.1, maxTokens: 900 }
    );

    const json = extractJsonObject(response);
    if (!json) return fallback;

    let parsed: RawAppSpec | null;
    try {
      parsed = JSON.parse(json) as RawAppSpec | null;
    } catch {
      return fallback;
    }
    if (!parsed) return fallback;

    return normalizeAppSpec(parsed, fallback);
  } catch {
    return fallback;
  }
}

export function formatAppSpec(spec?: AppSpec): string {
  if (!spec) return 'No app-building contract.';

  return [
    `App contract:`,
    `- Type: ${spec.appType}`,
    `- Output: ${spec.outputMode}`,
    `- Name: ${spec.appName}`,
    `- Entry: ${spec.entryPoint}`,
    `- Persistence: ${spec.dataPersistence ? 'yes' : 'no'}`,
    `- Features: ${spec.requiredFeatures.join('; ')}`,
    `- Design: ${spec.designDirection}`,
    `- Verification: ${spec.verificationChecks.join('; ')}`,
  ].join('\n');
}

function normalizeAppSpec(raw: RawAppSpec, fallback: AppSpec): AppSpec {
  const appType = typeof raw.appType === 'string' && isAppType(raw.appType)
    ? raw.appType
    : fallback.appType;
  const outputMode = fallback.outputMode === 'vanilla-web'
    ? 'vanilla-web'
    : typeof raw.outputMode === 'string' && isOutputMode(raw.outputMode)
      ? raw.outputMode
      : fallback.outputMode;
  const appName = normalizeString(raw.appName, fallback.appName);

  return {
    appType,
    outputMode,
    appName,
    entryPoint: normalizeEntryPoint(raw.entryPoint, appName, outputMode, fallback.entryPoint),
    requiredFeatures: normalizeStringArray(raw.requiredFeatures, fallback.requiredFeatures, 8),
    designDirection: normalizeString(raw.designDirection, fallback.designDirection),
    dataPersistence: fallback.dataPersistence || raw.dataPersistence === true,
    verificationChecks: normalizeVerificationChecks(raw.verificationChecks, fallback.verificationChecks, outputMode),
  };
}

function extractJsonObject(text: string): string | null {
  const startIdx = text.indexOf('{');
  const endIdx = text.lastIndexOf('}');
  if (startIdx === -1 || endIdx <= startIdx) return null;
  return text.substring(startIdx, endIdx + 1);
}

function inferRequiredFeatures(task: string, appType: AppType): string[] {
  const lower = task.toLowerCase();
  const features = new Set<string>();

  if (appType === 'game') {
    features.add('playable game loop');
    features.add('score display');
    features.add('restart control');
  }
  if (appType === 'dashboard') {
    features.add('organized data views');
    features.add('interactive status controls');
  }
  if (appType === 'editor') {
    features.add('editable canvas or workspace');
    features.add('tool controls');
  }
  if (appType === 'tool') {
    features.add('interactive controls');
    features.add('clear output or feedback state');
  }
  if (appType === 'landing') {
    features.add('clear first-viewport brand or offer');
    features.add('responsive content sections');
  }

  if (/\b(todo|task|kanban)\b/.test(lower)) features.add('task creation and status updates');
  if (/\b(timer|pomodoro)\b/.test(lower)) features.add('start, pause, and reset timer controls');
  if (/\b(localstorage|persist|save|history|high[- ]score)\b/.test(lower)) features.add('localStorage persistence');
  if (/\b(canvas|paint|drawing)\b/.test(lower)) features.add('canvas drawing interactions');
  if (/\b(keyboard|arrow key|hotkey)\b/.test(lower)) features.add('keyboard interaction support');
  if (/\b(sound|audio)\b/.test(lower)) features.add('audio feedback');

  features.add('responsive layout');
  return Array.from(features);
}

function inferDesignDirection(task: string, appType: AppType): string {
  const lower = task.toLowerCase();
  if (/\b(neon|retro|arcade)\b/.test(lower)) return 'retro neon, energetic, game-like';
  if (/\b(premium|polished|elegant)\b/.test(lower)) return 'polished, modern, high-fidelity';
  if (appType === 'dashboard') return 'quiet, dense, scannable operational UI';
  if (appType === 'landing') return 'visual, brand-forward, responsive marketing layout';
  if (appType === 'game') return 'immersive, responsive, playful interface';
  return 'clean, responsive, practical interface';
}

function inferVerificationChecks(
  appType: AppType,
  outputMode: AppOutputMode,
  dataPersistence: boolean
): string[] {
  const checks = new Set<string>();
  checks.add(outputMode === 'vite-react' ? 'project builds successfully' : 'entry HTML file exists');
  checks.add('loads without uncaught console errors');
  checks.add('desktop and mobile layout render without overlap');
  checks.add('primary interactive controls respond');
  if (appType === 'game') checks.add('game can start or restart');
  if (appType === 'editor') checks.add('editor tools update the workspace');
  if (dataPersistence) checks.add('state persists with localStorage');
  return Array.from(checks);
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeStringArray(value: unknown, fallback: string[], limit: number): string[] {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
  return normalized.length ? normalized : fallback;
}

function normalizeEntryPoint(
  value: unknown,
  appName: string,
  outputMode: AppOutputMode,
  fallback: string
): string {
  if (outputMode === 'vanilla-web') {
    return typeof value === 'string' && /\.html?$/i.test(value.trim()) ? value.trim() : 'index.html';
  }
  if (typeof value === 'string' && value.trim()) return value.trim();
  return defaultEntryPoint(appName, outputMode, fallback);
}

function normalizeVerificationChecks(
  value: unknown,
  fallback: string[],
  outputMode: AppOutputMode,
): string[] {
  const checks = normalizeStringArray(value, fallback, 8);
  if (outputMode === 'vite-react') return checks;
  const withoutBuildCheck = checks.filter((check) => !/^project builds successfully$/i.test(check));
  return withoutBuildCheck.some((check) => /^entry HTML file exists$/i.test(check))
    ? withoutBuildCheck
    : ['entry HTML file exists', ...withoutBuildCheck].slice(0, 8);
}

function defaultEntryPoint(appName: string, outputMode: AppOutputMode, fallback?: string): string {
  if (outputMode === 'single-html') return `${toKebabCase(appName)}.html`;
  if (outputMode === 'vanilla-web') return 'index.html';
  return fallback || 'src/App.tsx';
}

function isAppType(value: string): value is AppType {
  return APP_TYPES.includes(value as AppType);
}

function isOutputMode(value: string): value is AppOutputMode {
  return OUTPUT_MODES.includes(value as AppOutputMode);
}

function toKebabCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'app';
}

function toTitleCase(value: string): string {
  return value
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
