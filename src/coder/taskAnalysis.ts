import path from 'path';
import { randomUUID } from 'crypto';
import type { ProjectFileLayer, ProjectFileMap } from './projectFileMap.js';
import type { ApprovalPolicy, CoderTaskKind, FileChangeIntent } from '@barok/core';
import {
  createCodingTaskContract,
  type CodingTaskBlocker,
  type CodingTaskContract,
} from '@barok/core';
import { splitConcatenatedFilePath } from '@barok/core';

export type { ApprovalPolicy, CoderTaskKind, FileChangeIntent } from '@barok/core';

export interface CoderTaskSpecificity {
  goalClarity: number;
  targetClarity: number;
  acceptanceClarity: number;
  score: number;
  missing: string[];
}

export interface CoderTaskAnalysis {
  id: string;
  userRequest: string;
  /** Additive Phase 1 contract; legacy analysis fields remain unchanged. */
  contract?: CodingTaskContract;

  taskKind: CoderTaskKind;
  instanceMode: 'continuation' | 'new_instance' | 'unknown';
  targetLayer: ProjectFileLayer | 'full_stack';
  behaviorScope: 'read_only' | 'existing_behavior_fix' | 'new_behavior' | 'new_instance' | 'maintenance';
  refactorRisk: 'safe_change' | 'risky_refactor';
  confidence: number;
  specificity?: CoderTaskSpecificity;
  /** Marks a repair pass over an existing implementation rather than a new build. */
  repairMode?: boolean;

  workspace: string;
  projectFileMap?: ProjectFileMap;

  mentionedFiles: string[];
  inferredFiles: string[];
  sourceFiles?: string[];

  expectedChangeIntent: FileChangeIntent;

  affectedFiles: Array<{
    path: string;
    intent: FileChangeIntent;
    reason: string;
    mustReadBeforeEdit: boolean;
  }>;

  riskLevel: 'low' | 'medium' | 'high';
  riskFactors: string[];
  requiresApproval: boolean;
  approvalPolicy?: ApprovalPolicy;

  requiredInspections: string[];
  verificationPlan: string[];
  validationRequirements: string[];

  rationale: string;
}

export interface AnalyzeCoderTaskInput {
  message: string;
  mode?: 'auto' | 'chat' | 'agent';
  workspace?: string;
  threadId?: string;
  thread?: Array<{ role?: string; content?: string; status?: string }>;
  previousRunStatus?: string;
  previousChangedFiles?: string[];
  projectFileMap?: ProjectFileMap;
  approvalPolicy?: ApprovalPolicy;
}

const FILE_PATTERN = /[A-Za-z0-9_.@/\\-]+\.(?:tsx|ts|jsx|js|json|md|css|html|cjs|mjs|yml|yaml|xaml|cs|py|sh|pdf|docx)/gi;
// Do not let words in an absolute Windows path (for example the `Test` in
// `C:\\MPC Project Test\\...`) participate in intent classification.
const WINDOWS_FILE_PATTERN = /[A-Za-z]:[\\/][^"'`\r\n]*?\.(?:tsx|ts|jsx|js|json|md|css|html|cjs|mjs|yml|yaml|xaml|cs|py|sh|pdf|docx)\b/gi;
const DOCUMENT_SOURCE_RE = /\.(?:pdf|docx)$/i;
const CONTINUATION_RE = /(?:^(?:continue|resume)\b|\b(?:continue|resume)\s+(?:the|this|that|previous|last|work|task)\b|\b(?:same issue|again|that broke|previous task|last task)\b)/i;
const WORK_ON_NAMED_TARGET_RE = /\b(?:work|working)\s+on\s+(?!(?:it|this|that|something|anything)\b)(?:the\s+)?[a-z0-9#]/i;

export type CoderRequestFrame = 'direct' | 'polite' | 'embedded_user';

export interface NormalizedCoderRequest {
  original: string;
  normalized: string;
  frame: CoderRequestFrame;
  isInformationRequest: boolean;
}

const INFORMATION_REQUEST_FRAME_PATTERNS: Array<{ pattern: RegExp; frame: CoderRequestFrame }> = [
  {
    pattern: /^(?:i|we)(?:\s+would|'d|\u2019d)\s+like\s+to\s+(?:know|understand|ask|explain|tell\s+me|describe|clarify)\b(?:\s+about)?\s*/i,
    frame: 'polite',
  },
  {
    pattern: /^(?:the\s+)?user\s+(?:is\s+)?asking\s+about\s+/i,
    frame: 'embedded_user',
  },
  {
    pattern: /^(?:i|we)\s+(?:am|are)\s+asking\s+about\s+/i,
    frame: 'polite',
  },
  {
    pattern: /^(?:the\s+)?user\s+(?:is\s+)?asking\s+(?:what|why|how|when|where|who|which)\b\s*/i,
    frame: 'embedded_user',
  },
  {
    pattern: /^(?:the\s+)?user\s+(?:would\s+like|wants?|needs?)\s+(?:(?:for\s+)?(?:you|the\s+agent)\s+)?to\s+(?:know|understand|ask|explain|tell\s+me|describe|clarify)\b(?:\s+about)?\s*/i,
    frame: 'embedded_user',
  },
  {
    pattern: /^(?:i|we)\s+(?:would\s+like|['’]d\s+like|want|need)\s+(?:(?:for\s+)?(?:you|the\s+agent)\s+)?to\s+(?:know|understand|ask|explain|tell\s+me|describe|clarify)\b(?:\s+about)?\s*/i,
    frame: 'polite',
  },
  {
    pattern: /^(?:the\s+)?user\s+(?:needs?|wants?)\s+help\s+(?:with|understanding)\s+/i,
    frame: 'embedded_user',
  },
  {
    pattern: /^(?:i|we)\s+(?:need|want)\s+help\s+(?:with|understanding)\s+/i,
    frame: 'polite',
  },
  {
    pattern: /^(?:can|could|would)\s+you\s+(?:please\s+)?(?:explain|tell\s+me|describe|clarify|help\s+me\s+understand)\b(?:\s+about)?\s*/i,
    frame: 'polite',
  },
  {
    pattern: /^(?:please\s+)?(?:explain|tell\s+me|describe|clarify)\b(?:\s+about)?\s*/i,
    frame: 'polite',
  },
];

const ACTION_REQUEST_FRAME_PATTERNS: Array<{ pattern: RegExp; frame: CoderRequestFrame }> = [
  {
    pattern: /^(?:i|we)(?:\s+would|'d|\u2019d)\s+like\s+to\s+/i,
    frame: 'polite',
  },
  {
    pattern: /^(?:the\s+)?user\s+(?:is\s+)?asking\s+to\s+/i,
    frame: 'embedded_user',
  },
  {
    pattern: /^(?:the\s+)?user\s+(?:would\s+like|wants?|needs?)\s+(?:(?:for\s+)?(?:you|the\s+agent)\s+)?to\s+/i,
    frame: 'embedded_user',
  },
  {
    pattern: /^(?:i|we)\s+(?:would\s+like|['’]d\s+like|want|need)\s+(?:(?:for\s+)?(?:you|the\s+agent)\s+)?to\s+/i,
    frame: 'polite',
  },
  {
    pattern: /^(?:can|could|would)\s+you\s+(?:please\s+)?/i,
    frame: 'polite',
  },
  {
    pattern: /^please\s+/i,
    frame: 'polite',
  },
];

const REQUEST_ACTION_VERB_RE = /\b(?:inspect|analy[sz](?:e|ing)|investigat(?:e|ing)|review(?:ing)?|audit(?:ing)?|check(?:ing)?|scan(?:ning)?|explor(?:e|ing)|fix(?:ing)?|repair(?:ing)?|implement(?:ing)?|add(?:ing)?|creat(?:e|ing)|build(?:ing)?|generat(?:e|ing)|updat(?:e|ing)|modif(?:y|ying)|chang(?:e|ing)|refactor(?:ing)?|remov(?:e|ing)|delet(?:e|ing)|mov(?:e|ing)|renam(?:e|ing)|writ(?:e|ing)|edit(?:ing)?|improv(?:e|ing)|support(?:ing)?|handl(?:e|ing)|recogniz(?:e|ing)|prevent(?:ing)?|stop(?:ping)?|avoid(?:ing)?|enforc(?:e|ing)|validat(?:e|ing)|rout(?:e|ing)|detect(?:ing)?|parse|finish|complete)\b/i;
const DIRECT_ACTION_START_RE = /^(?:inspect|analy[sz](?:e|ing)|investigat(?:e|ing)|review(?:ing)?|audit(?:ing)?|check(?:ing)?|scan(?:ning)?|explor(?:e|ing)|fix(?:ing)?|repair(?:ing)?|implement(?:ing)?|add(?:ing)?|creat(?:e|ing)|build(?:ing)?|generat(?:e|ing)|updat(?:e|ing)|modif(?:y|ying)|chang(?:e|ing)|refactor(?:ing)?|remov(?:e|ing)|delet(?:e|ing)|mov(?:e|ing)|renam(?:e|ing)|writ(?:e|ing)|edit(?:ing)?|improv(?:e|ing)|support(?:ing)?|handl(?:e|ing)|recogniz(?:e|ing)|prevent(?:ing)?|stop(?:ping)?|avoid(?:ing)?|enforc(?:e|ing)|validat(?:e|ing)|rout(?:e|ing)|detect(?:ing)?|parse|finish|complete)\b/i;
const DIRECTIVE_FRAME_RE = /\b(?:should|need(?:s)?\s+to|must|has\s+to|have\s+to|make\s+sure|ensure)\b/i;

function stripAbsoluteFilePaths(message: string): string {
  return message.replace(WINDOWS_FILE_PATTERN, ' ');
}

/**
 * Removes common conversational wrappers while preserving the actual request.
 * This keeps classification deterministic for both direct users and prompts
 * that quote the user's request as "the user is asking about ...".
 */
export function normalizeCoderRequest(message: string): NormalizedCoderRequest {
  const original = message.trim();
  let normalized = original;
  let frame: CoderRequestFrame = 'direct';
  let isInformationRequest = false;

  for (let pass = 0; pass < 3; pass += 1) {
    const informationRule = INFORMATION_REQUEST_FRAME_PATTERNS.find(({ pattern }) => pattern.test(normalized));
    const actionRule = informationRule
      ? undefined
      : ACTION_REQUEST_FRAME_PATTERNS.find(({ pattern }) => pattern.test(normalized));
    const rule = informationRule || actionRule;
    if (!rule) break;

    const next = normalized
      .replace(rule.pattern, '')
      .replace(/^[\s:;,\-]+/, '')
      .trim();
    if (!next || next === normalized) break;

    normalized = next;
    frame = rule.frame;
    isInformationRequest ||= Boolean(informationRule);
  }

  const directQuestion = /^(?:what|why|how|when|where|who|which)\b/i.test(normalized);
  const directExplanation = /^(?:please\s+)?(?:explain|tell\s+me|describe|clarify)\b/i.test(normalized);

  return {
    original,
    normalized: normalized || original,
    frame,
    isInformationRequest: isInformationRequest || directQuestion || directExplanation,
  };
}

export function isCoderInformationRequest(message: string): boolean {
  return normalizeCoderRequest(message).isInformationRequest;
}

export function isCoderActionRequest(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || isCoderInformationRequest(trimmed)) return false;
  if (/^(?:should|could|can|would)\s+i\b/i.test(trimmed)) return false;

  const interpreted = normalizeCoderRequest(trimmed);
  return REQUEST_ACTION_VERB_RE.test(interpreted.normalized) && (
    interpreted.frame !== 'direct' || DIRECTIVE_FRAME_RE.test(trimmed) || DIRECT_ACTION_START_RE.test(interpreted.normalized)
  );
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function extractMentionedFiles(message: string): string[] {
  const withoutRuntimeBanners = message.replace(
    /^\s*Node\.js\s+v\d+(?:\.\d+){1,3}\s*$/gim,
    ''
  );
  const absoluteFiles = (withoutRuntimeBanners.match(WINDOWS_FILE_PATTERN) || [])
    .flatMap((match) => splitConcatenatedFilePath(match));
  const relativeFiles = (withoutRuntimeBanners.replace(WINDOWS_FILE_PATTERN, ' ').match(FILE_PATTERN) || [])
    .flatMap((match) => splitConcatenatedFilePath(match));
  return unique(
    [...absoluteFiles, ...relativeFiles]
  );
}

function resolveRelativeMentionedFiles(files: string[], projectFileMap?: ProjectFileMap): string[] {
  const normalized = unique(files.map((file) => file.replace(/\\/g, '/')));
  const mappedPaths = (projectFileMap?.files || []).map((file) => file.path.replace(/\\/g, '/'));
  const canonical = unique([
    ...normalized,
    ...normalized.flatMap((file) => {
      const candidate = file.replace(/^\.\//, '');
      return mappedPaths.filter((mapped) => mapped === candidate || mapped.endsWith(`/${candidate}`));
    }),
  ]);
  const sourceFiles = canonical.filter((file) =>
    !file.startsWith('./') && !file.startsWith('../') && !file.startsWith('/') && !/^[a-z]:\//i.test(file) && path.posix.extname(file),
  );
  const nestedSources = sourceFiles.filter((file) => path.posix.dirname(file) !== '.');
  const importSources = nestedSources.length ? nestedSources : sourceFiles;

  return unique(canonical.flatMap((file) => {
    if (!file.startsWith('./') && !file.startsWith('../')) return [file];
    const resolved = unique(importSources.map((source) => path.posix.normalize(path.posix.join(path.posix.dirname(source), file))));
    return resolved.length === 1 ? resolved : [file, ...resolved];
  }));
}

function inferFiles(message: string): string[] {
  const lower = message.toLowerCase();
  const files: string[] = [];

  const mentionsTodo = /\b(todo|todos|checklist|task list)\b/.test(lower);
  const mentionsPerformanceTracker =
    /\bperformance_and_agent_hardening_todo\b/.test(lower) ||
    (mentionsTodo && /\b(performance|agent hardening|hardening|speed|faster|slow)\b/.test(lower));
  if (mentionsTodo) {
    files.push('TODO.md');
  }
  if (mentionsPerformanceTracker) {
    files.push('todo/PERFORMANCE_AND_AGENT_HARDENING_TODO.md');
  }
  if (/\b(readme|docs|documentation|changelog)\b/.test(lower)) {
    files.push('README.md', 'docs/README.md');
  }
  if (/\b(chat|composer|send button|message panel|coder chat)\b/.test(lower)) {
    files.push('ui/src/components/CoderChatPanel.tsx', 'ui/src/App.tsx');
  }
  if (/\b(harness|request frame|polite request|user is asking|user would like|dummy model|agent response)\b/.test(lower)) {
    files.push('src/coder/intent.ts', 'src/coder/taskAnalysis.ts');
  }
  if (/\b(performance|optimi[sz]e|faster|slow|streaming ui|batch|throttle|debounce|lazy-load|lazy load)\b/.test(lower)) {
    files.push('ui/src/App.tsx', 'ui/src/components/CoderChatPanel.tsx', 'src/react/run-manager.ts');
  }
  if (/\b(intent|classif|analy[sz]e|task kind|coder behavior)\b/.test(lower)) {
    files.push('src/coder/intent.ts', 'src/coder/taskAnalysis.ts');
  }
  if (/\b(file[- ]?map|project file map|workspace tree|tree scanning|repo map)\b/.test(lower)) {
    files.push('src/coder/projectFileMap.ts', 'server.ts');
  }
  if (/\b(react|agent loop|executor|tool|mutation|edit|write)\b/.test(lower)) {
    files.push('src/react/engine.ts', 'src/react/executor.ts', 'src/tools/devTools.ts');
  }
  if (/\b(repo map|conflict|work ?plan|workspace)\b/.test(lower)) {
    files.push(
      'src/orchestration/repoMapEndpoint.ts',
      'src/orchestration/conflictDetectionEndpoint.ts',
      'src/orchestration/workPlanEndpoint.ts'
    );
  }
  if (/\b(settings page|settings panel)\b/.test(lower)) {
    files.push('ui/src/components/SettingsPanel.tsx', 'ui/src/App.tsx');
  }

  return unique(files);
}

function isApplicationImplementationRequest(message: string): boolean {
  const text = stripAbsoluteFilePaths(message).toLowerCase();
  // A "TODO tracker" or "checklist tracker" is a documentation task, not an app.
  if (/\b(?:todo|checklist|task list|performance hardening)\b/.test(text) && /\btracker\b/.test(text)) {
    return false;
  }
  const application = '(?:web\\s*app(?:lication)?|app(?:lication)?|website|web\\s*site|site|game|dashboard|kanban|tool|editor|planner|tracker)';
  return new RegExp(`\\b(?:build|create|make|implement|develop|generate|scaffold)\\b[\\s\\S]{0,120}\\b${application}\\b`, 'i').test(text) ||
    new RegExp(`\\b${application}\\b[\\s\\S]{0,80}\\b(?:build|create|make|implement|develop|generate|scaffold)\\b`, 'i').test(text);
}

function inferExplicitMultiFileAppOutputs(message: string): string[] {
  const lower = message.toLowerCase();
  const asksForThreeFiles = /\b(?:three|3)[ -]?files?\b/.test(lower);
  const asksForSeparateWebFiles =
    /\b(?:separate|multiple|multi[- ]file|distinct|different) files?\b/.test(lower) &&
    /\bhtml\b/.test(lower) && /\bcss\b/.test(lower) && /\b(?:js|javascript)\b/.test(lower);
  if (!asksForSeparateWebFiles && !asksForThreeFiles) return [];
  if (!asksForSeparateWebFiles && /\b(?:react|vite|typescript project)\b/.test(lower)) return [];

  const mentioned = extractMentionedFiles(message).map((file) => file.replace(/\\/g, '/'));
  const html = mentioned.find((file) => /\.html?$/i.test(file)) || 'index.html';
  const css = mentioned.find((file) => /\.css$/i.test(file)) || 'style.css';
  const js = mentioned.find((file) => /\.(?:m?js|cjs)$/i.test(file)) || 'script.js';
  return unique([html, css, js]);
}

const AFFIRMATIVE_CONTINUATION_RE = /^(?:yes|yep|yeah|sure|ok(?:ay)?|please do|do it|go ahead|proceed|continue|yes please|sounds good|run it|execute it)[\s.!?]*$/i;
const ACTIONABLE_HISTORY_RE = /\b(work on|complete|finish|implement|build|add|create|fix|repair|update|modify|change|edit|write|mark|check|run|verify)\b/i;

function isAffirmativeContinuation(message: string): boolean {
  return AFFIRMATIVE_CONTINUATION_RE.test(message.trim());
}

function findLastActionableUserGoal(thread: AnalyzeCoderTaskInput['thread'] = []): string | undefined {
  return [...thread]
    .reverse()
    .find((message) =>
      message.role === 'user' &&
      typeof message.content === 'string' &&
      ACTIONABLE_HISTORY_RE.test(message.content)
    )
    ?.content
    ?.trim();
}

function resolveUserRequest(input: AnalyzeCoderTaskInput): string {
  const current = input.message.trim();
  if (!isAffirmativeContinuation(current)) return current;

  const priorGoal = findLastActionableUserGoal(input.thread);
  if (!priorGoal) return current;

  return `Continue this request: ${priorGoal}`;
}

function inferFilesFromMap(message: string, projectFileMap?: ProjectFileMap): string[] {
  if (!projectFileMap?.files?.length) return [];
  const lower = message.toLowerCase();
  const mentionsUiSurface = /\b(?:ui|frontend|component|style|screen|panel|button|form|structure|portfolio|page|layout|design|redesign|landing|navigation)\b/.test(lower);
  const tokens = unique(
    lower
      .split(/[^a-z0-9_.-]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4)
  );

  const tokenMatches = projectFileMap.files
    .filter((file) => {
      const filePath = file.path.toLowerCase();
      const baseName = path.posix.basename(filePath);
      if (tokens.some((token) => filePath.includes(token) || baseName.includes(token))) return true;
      if (mentionsUiSurface && file.layer === 'ui') return true;
      if (/\b(server|api|backend|database|persistence|endpoint)\b/.test(lower) && file.layer === 'backend') return true;
      if (/\b(test|spec|coverage)\b/.test(lower) && file.layer === 'tests') return true;
      return false;
    })
    .map((file) => file.path);

  // File names rarely contain the exact wording of a product request. For
  // example, "add to cart" usually maps to a product page, a cart page, and
  // the shared interaction script rather than a file literally named after
  // the whole request. Score a small semantic neighborhood from the project
  // map so the planner starts with real existing targets instead of creating
  // an implementation-plan artifact or guessing a new file.
  const semanticMatches = inferSemanticFilesFromMap(lower, projectFileMap);
  return unique([...tokenMatches, ...semanticMatches]).slice(0, 8);
}

function inferSemanticFilesFromMap(message: string, projectFileMap: ProjectFileMap): string[] {
  const cartRequest = /\b(?:add\s+to\s+cart|cart|basket|checkout|shopping|shop|product(?:s)?|purchase|order)\b/i.test(message);
  if (!cartRequest) return [];

  const domainTerms = [
    ['cart', 12],
    ['basket', 12],
    ['checkout', 11],
    ['product', 10],
    ['shop', 8],
    ['order', 8],
    ['store', 7],
    ['commerce', 7],
    ['script', 6],
    ['app', 5],
    ['main', 5],
    ['index', 4],
  ] as const;
  const sourceExtension = /\.(?:html?|(?:m|c)?jsx?|tsx?|css)$/i;
  const scored = projectFileMap.files
    .filter((file) => file.exists !== false && sourceExtension.test(file.path))
    .map((file) => {
      const normalizedPath = file.path.replace(/\\/g, '/').toLowerCase();
      const searchable = `${normalizedPath} ${file.role.toLowerCase()}`;
      const baseName = path.posix.basename(normalizedPath);
      let score = 0;

      for (const [term, weight] of domainTerms) {
        if (searchable.includes(term)) score += weight;
      }
      if (file.layer === 'ui') score += 1;
      if (/\.(?:html?|(?:m|c)?jsx?|tsx?)$/i.test(baseName)) score += 2;
      if (/^(?:index|main|app)(?:\.[^.]+)?$/i.test(baseName)) score += 3;
      if (/\.css$/i.test(baseName)) score -= 1;

      return { path: file.path, score };
    })
    .filter((file) => file.score >= 5)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));

  return scored.slice(0, 6).map((file) => file.path);
}

function assessTaskSpecificity(
  message: string,
  taskKind: CoderTaskKind,
  mentionedFiles: string[],
  inferredFiles: string[],
): CoderTaskSpecificity {
  const lower = message.toLowerCase();
  const hasAction = REQUEST_ACTION_VERB_RE.test(lower);
  const hasConcreteTarget = mentionedFiles.length > 0 || inferredFiles.length > 0 ||
    /\b(?:component|screen|panel|button|form|route|endpoint|api|function|method|hook|state|style|layout|navigation|link|test|query|database|schema|auth|login|checkout|cart)\b/i.test(lower);
  // A symptom such as "error" or "broken" describes the problem, not how
  // success should be recognized. Keep acceptance clarity reserved for an
  // observable expected behavior or an explicit constraint.
  const hasAcceptanceCue = /\b(?:should|must|when|instead|so that|in order to|expected|acceptance|returns?|displays?|loads?|renders?|shows?|without)\b/i.test(lower);
  const broadTargetOnly = /\b(?:website|web\s*site|site|app|application|project|codebase|system|everything)\b/i.test(lower) && !hasConcreteTarget;

  const goalClarity = hasAction ? 0.72 : 0.2;
  const targetClarity = mentionedFiles.length > 0 || inferredFiles.length > 0
    ? 1
    : hasConcreteTarget
      ? 0.78
      : broadTargetOnly
        ? 0.12
        : 0.25;
  const acceptanceClarity = hasAcceptanceCue ? 1 : 0;
  const score = Number(((goalClarity + targetClarity + acceptanceClarity) / 3).toFixed(2));
  const missing: string[] = [];
  if (!hasConcreteTarget) missing.push('a concrete target (file, component, feature, or behavior)');
  if (!hasAcceptanceCue) missing.push('a success condition or acceptance criterion');

  return { goalClarity, targetClarity, acceptanceClarity, score, missing };
}

function ambiguityBlockerFor(
  message: string,
  taskKind: CoderTaskKind,
  expectedChangeIntent: FileChangeIntent,
  specificity: CoderTaskSpecificity,
  projectFileMap?: ProjectFileMap,
): CodingTaskBlocker | undefined {
  const broadMutationVerb = /\b(?:fix|repair|improve|update|change|make\s+better|clean\s+up)\b/i.test(message);
  const mutable = expectedChangeIntent !== 'read_only' && expectedChangeIntent !== 'unknown';
  const isExplicitlyScopedWorkflow = /\b(?:complete|finish|implement|build|create|add)\b/i.test(message) ||
    taskKind === 'continuation' || taskKind === 'docs_only' || taskKind === 'test_only';
  // A real project map gives the agent a safe discovery path: it can inspect
  // the workspace, identify the relevant source, and only then mutate a file
  // backed by read evidence. Without workspace evidence, broad mutations
  // still need an explicit target and acceptance condition before execution.
  const hasWorkspaceForDiscovery = Boolean(
    projectFileMap &&
    projectFileMap.totalFiles > 0 &&
    projectFileMap.files.some((file) => file.exists !== false),
  );
  if (
    !mutable ||
    !broadMutationVerb ||
    isExplicitlyScopedWorkflow ||
    specificity.score >= 0.35 ||
    hasWorkspaceForDiscovery
  ) return undefined;

  return {
    code: 'missing_acceptance_criteria',
    message: 'The requested mutation is too broad to execute safely.',
    resolution: `Describe what is wrong, identify the target area or file, and state how success should be recognized. Missing: ${specificity.missing.join(' and ')}.`,
  };
}

function workspaceIdentity(value: string): string {
  return path.resolve(value).replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
}

function workspaceMismatchBlocker(
  workspace: string,
  projectFileMap?: ProjectFileMap,
): CodingTaskBlocker | undefined {
  if (!projectFileMap?.workspace?.trim()) return undefined;
  const requestedWorkspace = workspaceIdentity(workspace);
  const mappedWorkspace = workspaceIdentity(projectFileMap.workspace);
  if (requestedWorkspace === mappedWorkspace) return undefined;

  return {
    code: 'workspace_mismatch',
    message: 'The requested workspace does not match the workspace used to build the project file map.',
    resolution: `Requested workspace: ${workspace}. Project map workspace: ${projectFileMap.workspace}. Rebuild the map for the requested workspace or confirm which workspace should be changed before continuing.`,
  };
}

/**
 * Prevent a persisted or externally supplied analysis from steering a run
 * into a different workspace than the one selected for execution.
 */
export function applyCoderTaskWorkspaceGuard(
  analysis: CoderTaskAnalysis | undefined,
  activeWorkspace: string,
): CoderTaskAnalysis | undefined {
  if (!analysis) return analysis;

  const activeIdentity = workspaceIdentity(activeWorkspace);
  const declaredIdentity = analysis.workspace?.trim()
    ? workspaceIdentity(analysis.workspace)
    : activeIdentity;
  const mappedIdentity = analysis.projectFileMap?.workspace
    ? workspaceIdentity(analysis.projectFileMap.workspace)
    : activeIdentity;
  if (declaredIdentity === activeIdentity && mappedIdentity === activeIdentity) return analysis;

  const blocker: CodingTaskBlocker = {
    code: 'workspace_mismatch',
    message: 'The task analysis does not match the active run workspace.',
    resolution: `Analysis workspace: ${analysis.workspace}. Active run workspace: ${activeWorkspace}.${analysis.projectFileMap?.workspace && mappedIdentity !== activeIdentity ? ` Project map workspace: ${analysis.projectFileMap.workspace}.` : ''} Rebuild the analysis for the active workspace or confirm which workspace should be changed before continuing.`,
  };

  return {
    ...analysis,
    contract: analysis.contract
      ? { ...analysis.contract, blocker }
      : analysis.contract,
    validationRequirements: unique([
      ...(analysis.validationRequirements || []),
      'Stop and clarify if the task analysis workspace differs from the active run workspace.',
    ]),
  };
}

function classifyTaskKind(message: string): { taskKind: CoderTaskKind; confidence: number; reason: string } {
  const semanticLower = stripAbsoluteFilePaths(message).toLowerCase();

  if (!message.trim()) {
    return { taskKind: 'question', confidence: 1, reason: 'Empty request needs clarification.' };
  }
  if (/\b(start over|new instance|fresh instance|new agent instance)\b/.test(semanticLower)) {
    return { taskKind: 'new_instance', confidence: 0.86, reason: 'The request explicitly asks for a new instance.' };
  }
  if (CONTINUATION_RE.test(message)) {
    return { taskKind: 'continuation', confidence: 0.84, reason: 'The request references prior work or continuing a previous task.' };
  }
  if (isCoderInformationRequest(message)) {
    return { taskKind: 'question', confidence: 0.86, reason: 'The request is framed as a question or information request.' };
  }
  const diagnosticRequest =
    /^(?:please\s+)?(?:check|confirm|determine|verify)\b[\s\S]{0,180}\b(?:whether|if|still|continu(?:e|ing)|happen(?:s|ing)?|occur(?:s|ring)?|recur(?:s|ring)?|reproduc(?:e|es|ing))\b/.test(semanticLower) ||
    /^(?:please\s+)?check\b/.test(semanticLower) && !/\b(?:fix|repair|implement|add|create|update|modify|change|edit|write|rewrite|delete|remove|rename|refactor|improve)\b/.test(semanticLower);
  if (diagnosticRequest) {
    return { taskKind: 'investigation', confidence: 0.82, reason: 'The request asks to check current behavior without authorizing a code change.' };
  }
  if (isApplicationImplementationRequest(semanticLower)) {
    return { taskKind: 'new_feature', confidence: 0.9, reason: 'The request explicitly asks to implement an application; acceptance criteria do not change it into a documentation task.' };
  }
  if (/\b(complete|finish)\b.*\b(website|web\s*site|site|app|application|project)\b/.test(semanticLower)) {
    return { taskKind: 'new_feature', confidence: 0.8, reason: 'The request asks to complete an existing application experience.' };
  }
  if (
    /\bmake\b.*\b(playable|browser|web|work|run|open|load|render)\b/.test(semanticLower) ||
    /\b(?:should|must|needs? to)\b.*\b(play|work|run|open|load|render)\b.*\b(?:browser|web)\b/.test(semanticLower)
  ) {
    return { taskKind: 'new_feature', confidence: 0.86, reason: 'The request asks to implement a browser-usable application experience.' };
  }
  if (/\b(fix|bug|broken|error|failing|not working|regression|repair)\b/.test(semanticLower)) {
    return { taskKind: 'bug_fix', confidence: 0.86, reason: 'The request asks to correct broken behavior.' };
  }
  if (/\brename\b/.test(semanticLower) ||
      /\bmove\s+[^\n]{0,120}\b(?:file|files|folder|folders|directory|directories)\b/.test(semanticLower)) {
    return { taskKind: 'refactor', confidence: 0.86, reason: 'The request asks for an explicit file-system rename or move.' };
  }
  if (WORK_ON_NAMED_TARGET_RE.test(semanticLower)) {
    return { taskKind: 'new_feature', confidence: 0.82, reason: 'The request asks to complete a planned implementation phase.' };
  }
  if (/\b(optimi[sz]e|speed up|make .* faster|performance hardening)\b/.test(semanticLower) && !/\b(todo|todos|checklist|task list)\b/.test(semanticLower)) {
    return { taskKind: 'refactor', confidence: 0.78, reason: 'The request asks to improve performance without changing public behavior.' };
  }
  if (/\b(refactor|cleanup|restructure|reorganize|simplify)\b/.test(semanticLower)) {
    return { taskKind: 'refactor', confidence: 0.82, reason: 'The request asks to change structure without necessarily adding behavior.' };
  }
  if (/\b(test|tests|spec|coverage)\b/.test(semanticLower) && !/\b(feature|implement|add page)\b/.test(semanticLower)) {
    return { taskKind: 'test_only', confidence: 0.78, reason: 'The request focuses on tests or coverage.' };
  }
  if (
    /\b(todo|todos|checklist|task list)\b/.test(semanticLower) &&
    /\b(mark|check|tick|complete|completed|done|update|add|create|write|track|checkbox)\b/.test(semanticLower)
  ) {
    return { taskKind: 'docs_only', confidence: 0.82, reason: 'The request updates checklist or TODO documentation.' };
  }
  if (/\b(readme|docs|documentation|changelog|comment)\b/.test(semanticLower)) {
    return { taskKind: 'docs_only', confidence: 0.78, reason: 'The request focuses on documentation.' };
  }
  if (
    /\b(edit|update|modify|change|write|rewrite)\b/.test(semanticLower) &&
    (extractMentionedFiles(message).length > 0 ||
      /\b(index|file|page|website|site|app|navigation|link)\b/.test(semanticLower))
  ) {
    return { taskKind: 'refactor', confidence: 0.84, reason: 'The request explicitly asks to modify an identified file or workspace target.' };
  }
  if (
    /\b(?:check|confirm|determine|verify|investigate|inspect|review|audit|analy[sz]e|explore|look into|scan)\b/.test(semanticLower) ||
    /\b(?:whether|if)\b[\s\S]{0,100}\b(?:still|continu(?:e|ing)|happen(?:s|ing)?|occur(?:s|ring)?|recur(?:s|ring)?|reproduc(?:e|es|ing))\b/.test(semanticLower)
  ) {
    return { taskKind: 'investigation', confidence: 0.76, reason: 'The request asks for repository inspection or analysis.' };
  }
  if (/\b(add|create|build|implement|generate|new page|new component|new feature)\b/.test(semanticLower)) {
    return { taskKind: 'new_feature', confidence: 0.82, reason: 'The request asks to add or implement behavior.' };
  }
  if (isCoderActionRequest(message)) {
    const maintenanceRequest = /\b(?:fix|repair|update|modify|change|refactor|remove|delete|rename|edit|improve|prevent|stop|avoid)\b/i.test(semanticLower);
    return maintenanceRequest
      ? { taskKind: 'refactor', confidence: 0.8, reason: 'The request uses directive language for a concrete workspace change.' }
      : { taskKind: 'new_feature', confidence: 0.8, reason: 'The request uses directive language for a concrete implementation task.' };
  }
  if (/\?$/.test(message.trim()) || /\b(explain|what is|how does|why does)\b/.test(semanticLower)) {
    return { taskKind: 'question', confidence: 0.72, reason: 'The request is question-like and does not clearly require mutation.' };
  }

  return { taskKind: 'question', confidence: 0.48, reason: 'The request does not clearly authorize workspace mutation.' };
}

function determineInstanceMode(taskKind: CoderTaskKind, message: string): CoderTaskAnalysis['instanceMode'] {
  const lower = message.toLowerCase();
  if (taskKind === 'continuation' || CONTINUATION_RE.test(message)) {
    return 'continuation';
  }
  if (taskKind === 'new_instance' || /\b(start over|new instance|fresh instance|new task)\b/.test(lower)) {
    return 'new_instance';
  }
  return 'unknown';
}

function determineTargetLayer(files: string[], message: string, projectFileMap?: ProjectFileMap): CoderTaskAnalysis['targetLayer'] {
  const lower = stripAbsoluteFilePaths(message).toLowerCase();
  if (/\b(full stack|frontend and backend|ui and backend|client and server)\b/.test(lower)) return 'full_stack';
  if (/\b(ui|frontend|component|screen|panel|button|style|css|layout|website|web site|browser|playable|portfolio|page|html|app|application|game|dashboard|kanban)\b/.test(lower)) return 'ui';
  if (/\b(api|server|backend|database|sqlite|endpoint|persistence)\b/.test(lower)) return 'backend';
  if (/\b(test|tests|spec|coverage)\b/.test(lower)) return 'tests';
  if (/\b(readme|docs|documentation|changelog)\b/.test(lower)) return 'docs';

  const layerCounts = new Map<ProjectFileLayer, number>();
  const mapByPath = new Map((projectFileMap?.files || []).map((file) => [file.path, file.layer]));
  for (const file of files) {
    const layer = mapByPath.get(file) || inferLayerFromPath(file);
    layerCounts.set(layer, (layerCounts.get(layer) || 0) + 1);
  }

  const meaningfulLayers = Array.from(layerCounts.entries()).filter(([layer]) => layer !== 'unknown');
  if (meaningfulLayers.length > 1) return 'full_stack';
  return meaningfulLayers[0]?.[0] || 'unknown';
}

function inferLayerFromPath(filePath: string): ProjectFileLayer {
  const normalized = filePath.toLowerCase();
  if (normalized.startsWith('ui/') || /\.(tsx|jsx|css|html)$/.test(normalized)) return 'ui';
  if (normalized === 'server.ts' || normalized.startsWith('src/react/') || normalized.startsWith('src/orchestration/') || normalized.startsWith('src/tools/')) return 'backend';
  if (normalized.includes('__tests__') || /\.(test|spec)\./.test(normalized)) return 'tests';
  if (/\.(md|mdx|txt)$/.test(normalized)) return 'docs';
  if (/\.(json|ya?ml)$/.test(normalized) || normalized.includes('config')) return 'config';
  if (normalized.startsWith('src/coder/') || normalized.startsWith('src/repo/') || normalized.startsWith('src/tasks/')) return 'shared';
  return 'unknown';
}

function determineBehaviorScope(
  taskKind: CoderTaskKind,
  intent: FileChangeIntent,
  instanceMode: CoderTaskAnalysis['instanceMode']
): CoderTaskAnalysis['behaviorScope'] {
  if (intent === 'read_only') return 'read_only';
  if (instanceMode === 'new_instance' || taskKind === 'new_instance') return 'new_instance';
  if (taskKind === 'bug_fix' || taskKind === 'continuation') return 'existing_behavior_fix';
  if (taskKind === 'new_feature') return 'new_behavior';
  return 'maintenance';
}

function determineIntent(taskKind: CoderTaskKind, message: string): FileChangeIntent {
  const lower = message.toLowerCase();

  if (['question', 'investigation'].includes(taskKind)) return 'read_only';
  if (taskKind === 'continuation') return 'modify';
  if (isApplicationImplementationRequest(message)) return 'create';
  if (/\b(work on|complete|finish|implement)\b.*\b(phase|task|feature|implementation|todo|checklist)\b/.test(lower)) {
    return 'modify';
  }
  if (/\b(complete|finish)\b.*\b(website|web\s*site|site|app|application|project)\b/.test(lower)) {
    return 'modify';
  }
  if (
    /\b(todo|todos|checklist|task list)\b/.test(lower) &&
    /\b(mark|check|tick|complete|completed|done|update|add check\s*mark|checkbox)\b/.test(lower)
  ) {
    return 'modify';
  }
  if (taskKind === 'docs_only') return 'modify';
  if (/\b(edit|update|modify|change|write|rewrite)\b/.test(lower)) return 'modify';
  // "Delete" and "remove" are common code-editing terms (for example, "remove
  // the bug", "delete unused code in index.html", "remove the lives counter").
  // Removing content from within files is a file modification. Only classify as
  // a destructive file deletion when the request clearly targets deleting a
  // file, folder, or directory from the filesystem.
  const isFileOrDirectoryDeletion =
    /\b(?:delete|remove|rm|unlink)\s+[^\n]{0,80}\b(?:file|files|folder|folders|directory|directories)\b/.test(lower) ||
    (/\b(?:delete|remove|rm|unlink)\s+(?:the\s+)?[\w./\\-]+\.[a-z0-9]+\b/.test(lower) &&
      !/\b(?:delete|remove)\b[^\n]{0,120}\b(?:from|in|inside)\b/.test(lower));
  if (isFileOrDirectoryDeletion) return 'delete';
  if (/\b(delete|remove)\b/.test(lower)) return 'modify';
  // "Move" is also ordinary product language (for example, "make the
  // player move faster"). Only classify it as a destructive file operation
  // when the request clearly names a file-system move/rename.
  if (/\brename\b/.test(lower) ||
      /\bmove\s+[^\n]{0,120}\b(?:file|files|folder|folders|directory|directories)\b/.test(lower)) {
    return 'rename';
  }
  if (taskKind === 'new_feature' || /\b(add|create|generate|new)\b/.test(lower)) return 'create';
  if (taskKind === 'test_only' || taskKind === 'bug_fix' || taskKind === 'refactor') {
    return 'modify';
  }

  return 'unknown';
}

function verificationFor(taskKind: CoderTaskKind, intent: FileChangeIntent, projectFileMap?: ProjectFileMap): string[] {
  if (intent === 'read_only' || taskKind === 'investigation' || taskKind === 'question') {
    return ['No mutation verification required'];
  }
  if (taskKind === 'docs_only') return ['No build required unless docs tooling exists'];

  // The Command runtime resolves this project-neutral operation from files in
  // the workspace. Do not embed npm (or any other ecosystem) in task analysis.
  const hasProjectFiles = (projectFileMap?.totalFiles || 0) > 0;
  return [hasProjectFiles ? 'Command verify' : 'Command verify (discover workspace type)'];
}

function validationRequirementsFor(
  taskKind: CoderTaskKind,
  targetLayer: CoderTaskAnalysis['targetLayer'],
  intent: FileChangeIntent,
  riskLevel: CoderTaskAnalysis['riskLevel']
): string[] {
  if (intent === 'read_only') {
    return ['Summarize inspected evidence and do not claim file changes.'];
  }

  const requirements = [
    'Read each existing target file before editing it.',
    'Keep the change scoped to the classified task and affected files.',
  ];

  if (taskKind === 'bug_fix') {
    requirements.push('Identify the broken existing behavior and explain why the fix addresses it.');
    requirements.push('Preserve the existing implementation and make the smallest targeted patch; do not rewrite unrelated files or regenerate an existing file.');
  }
  if (taskKind === 'new_feature') {
    requirements.push('Confirm the new behavior is implemented without removing existing behavior.');
  }
  if (taskKind === 'refactor') {
    requirements.push('Preserve observable behavior and avoid unrelated rewrites.');
  }
  if (taskKind === 'docs_only') {
    requirements.push('Keep documentation/checklist edits limited to the requested tracker or docs files.');
  }
  if (targetLayer === 'ui' || targetLayer === 'full_stack') {
    requirements.push('Run a build or targeted UI validation when available.');
  }
  if (targetLayer === 'backend' || targetLayer === 'full_stack') {
    requirements.push('Run backend/unit tests or a targeted command check when available.');
  }
  if (riskLevel === 'high') {
    requirements.push('Do not finish until verification has run or the final answer explicitly states why it could not run.');
  }

  return requirements;
}

function riskFactorsFor(input: {
  taskKind: CoderTaskKind;
  targetLayer: CoderTaskAnalysis['targetLayer'];
  intent: FileChangeIntent;
  affectedFileCount: number;
  message: string;
  projectFileMap?: ProjectFileMap;
}): string[] {
  const lower = input.message.toLowerCase();
  const factors: string[] = [];

  if (input.intent === 'delete' || input.intent === 'rename') factors.push('Destructive file operation requested.');
  if (input.taskKind === 'refactor') factors.push('Refactor can change behavior accidentally.');
  if (input.targetLayer === 'full_stack') factors.push('Task crosses UI/backend boundaries.');
  if (input.affectedFileCount > 5) factors.push('Many affected files inferred.');
  if (/\b(auth|payment|billing|database|migration|security|permission|credentials?|token|secret)\b/.test(lower)) {
    factors.push('Sensitive system area mentioned.');
  }
  if (/\b(rewrite|overhaul|architecture|large refactor|restructure)\b/.test(lower)) {
    factors.push('Broad structural rewrite language detected.');
  }
  if (input.projectFileMap?.omittedCount && input.projectFileMap.omittedCount > 0) {
    factors.push('Project file map was truncated; inspect additional files if needed.');
  }

  return factors;
}

function explicitlyTargetsFileForDeletion(file: string, message: string): boolean {
  const lower = message.toLowerCase();
  const normalizedPath = file.replace(/\\/g, '/');
  const baseName = path.posix.basename(normalizedPath).toLowerCase();
  const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const isDeletedTarget = new RegExp(`\\b(?:delete|remove|rm|unlink)\\s+(?:the\\s+)?(?:file\\s+)?${escapedBase}\\b`, 'i').test(lower);
  const isInFileTarget = new RegExp(`\\b(?:delete|remove)\\b[^\n]{0,120}\\b(?:from|in|inside)\\s+(?:the\\s+)?(?:file\\s+)?${escapedBase}\\b`, 'i').test(lower);
  return isDeletedTarget && !isInFileTarget;
}

function intentForAffectedFile(
  file: string,
  defaultIntent: FileChangeIntent,
  mentioned: boolean,
  message?: string,
): FileChangeIntent {
  if (defaultIntent === 'delete') {
    return message && explicitlyTargetsFileForDeletion(file, message) ? 'delete' : 'modify';
  }
  if (defaultIntent !== 'create') return defaultIntent;
  if (mentioned) return 'modify';
  if (
    file.endsWith('/App.tsx') ||
    file.endsWith('/App.ts') ||
    file === 'server.ts' ||
    file.endsWith('/intent.ts') ||
    file.endsWith('/engine.ts') ||
    file.endsWith('/executor.ts') ||
    file.endsWith('/devTools.ts') ||
    file.includes('Endpoint.ts') ||
    file.includes('workPlanOrchestrator.ts')
  ) {
    return 'modify';
  }
  return 'create';
}

function explicitlyRequestsNewFile(message: string, file: string, mentioned: boolean): boolean {
  if (!/\b(create|generate|make|build|implement|add|write|new)\b/i.test(message)) return false;

  const stem = path.posix.basename(file.replace(/\\/g, '/')).replace(/\.[^.]+$/, '');
  if (stem.length < 3) return false;
  const escapedStem = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mentionsFile = new RegExp(`\\b${escapedStem}\\b`, 'i').test(message);
  if (mentioned && !mentionsFile) return false;
  return new RegExp(`\\b(?:create|generate|make|build|implement|add|write)\\b[\\s\\S]{0,80}\\b${escapedStem}\\b`, 'i').test(message);
}

function isKnownMissingFromCompleteMap(file: string, projectFileMap?: ProjectFileMap): boolean {
  if (!projectFileMap || projectFileMap.omittedCount > 0) return false;
  const normalizedFile = file.replace(/\\/g, '/').toLowerCase();
  return !projectFileMap.files.some(
    (entry) => entry.exists !== false && entry.path.replace(/\\/g, '/').toLowerCase() === normalizedFile
  );
}

function isValidCandidateForProjectMap(
  file: string,
  message: string,
  mentioned: boolean,
  projectFileMap?: ProjectFileMap,
): boolean {
  if (!projectFileMap || projectFileMap.omittedCount > 0) return true;
  const normalizedFile = file.replace(/\\/g, '/').toLowerCase();
  const knownFile = projectFileMap.files.some(
    (entry) => entry.exists !== false && entry.path.replace(/\\/g, '/').toLowerCase() === normalizedFile,
  );
  if (knownFile || explicitlyRequestsNewFile(message, file, mentioned)) return true;

  // A compact handoff can prefix a real mapped filename with unrelated text,
  // for example `Rulesindex.html`. Reject that specific ambiguity while
  // retaining genuinely useful missing import targets for diagnostics.
  return !projectFileMap.files.some((entry) => {
    const mapped = entry.path.replace(/\\/g, '/').toLowerCase();
    return mapped !== normalizedFile && normalizedFile.endsWith(mapped) && !normalizedFile.includes('/');
  });
}

export function analyzeCoderTask(input: AnalyzeCoderTaskInput): CoderTaskAnalysis {
  const resolvedRequest = resolveUserRequest(input);
  const userRequest = normalizeCoderRequest(resolvedRequest).normalized;
  const approvalPolicy = input.approvalPolicy || 'ask';
  const workspace = path.resolve(input.workspace || process.cwd());
  const mappedMentions = (input.projectFileMap?.files || [])
    .filter((file) => userRequest.toLowerCase().includes(file.path.toLowerCase()))
    .map((file) => file.path);
  const mentionedFiles = resolveRelativeMentionedFiles(
    unique([...extractMentionedFiles(userRequest), ...mappedMentions]),
    input.projectFileMap,
  )
    .filter((file) => !mappedMentions.some((mapped) => mapped !== file && mapped.toLowerCase().endsWith(file.toLowerCase())));
  const applicationImplementation = isApplicationImplementationRequest(userRequest);
  const explicitAppOutputs = new Set(inferExplicitMultiFileAppOutputs(userRequest).map((file) => file.replace(/\\/g, '/').toLowerCase()));
  const inferredFiles = unique(applicationImplementation
    ? inferExplicitMultiFileAppOutputs(userRequest)
    : [...inferFiles(userRequest), ...inferFilesFromMap(userRequest, input.projectFileMap)])
    .filter((file) => !mentionedFiles.includes(file));
  const classification = classifyTaskKind(userRequest);
  const instanceMode = determineInstanceMode(classification.taskKind, userRequest);
  const requestedChangeIntent = determineIntent(classification.taskKind, userRequest);
  // “Build/create” describes the desired result, not necessarily an empty
  // workspace. Existing project evidence means the initial implementation
  // should inspect and modify source rather than assume a blank project.
  const hasExistingEditableSource = (input.projectFileMap?.files || []).some((file) => !DOCUMENT_SOURCE_RE.test(file.path));
  const expectedChangeIntent = requestedChangeIntent === 'create' && hasExistingEditableSource
    ? 'modify'
    : requestedChangeIntent;
  const readOnly = expectedChangeIntent === 'read_only';
  const candidateFiles = unique([...mentionedFiles, ...inferredFiles]);
  const rejectedFiles = candidateFiles.filter((file) => !isValidCandidateForProjectMap(
    file,
    userRequest,
    mentionedFiles.includes(file),
    input.projectFileMap,
  ));
  const allFiles = candidateFiles.filter((file) => !rejectedFiles.includes(file));
  const validatedMentionedFiles = mentionedFiles.filter((file) => allFiles.includes(file));
  const validatedInferredFiles = inferredFiles.filter((file) => allFiles.includes(file));
  const sourceFiles = allFiles.filter((file) => DOCUMENT_SOURCE_RE.test(file));
  const mutationFiles = allFiles.filter((file) => !DOCUMENT_SOURCE_RE.test(file));
  const targetLayer = determineTargetLayer(allFiles, userRequest, input.projectFileMap);
  const behaviorScope = determineBehaviorScope(classification.taskKind, expectedChangeIntent, instanceMode);
  const specificity = assessTaskSpecificity(userRequest, classification.taskKind, validatedMentionedFiles, validatedInferredFiles);
  const ambiguityBlocker = ambiguityBlockerFor(
    userRequest,
    classification.taskKind,
    expectedChangeIntent,
    specificity,
    input.projectFileMap,
  );
  const blocker = workspaceMismatchBlocker(workspace, input.projectFileMap) || ambiguityBlocker;

  const affectedFiles = mutationFiles.map((file) => {
    const mentioned = validatedMentionedFiles.includes(file);
    const createsKnownMissingFile =
      explicitlyRequestsNewFile(userRequest, file, mentioned) &&
      isKnownMissingFromCompleteMap(file, input.projectFileMap);
    const mappedOutput = input.projectFileMap?.files.find((entry) =>
      entry.path.replace(/\\/g, '/').toLowerCase() === file.replace(/\\/g, '/').toLowerCase()
    );
    const createsDeclaredAppOutput = applicationImplementation && explicitAppOutputs.has(file.replace(/\\/g, '/').toLowerCase()) &&
      (mappedOutput?.exists === false || (!mappedOutput && (
        !input.projectFileMap ||
        (input.projectFileMap.omittedCount === 0 && isKnownMissingFromCompleteMap(file, input.projectFileMap))
      )));
    const intent = readOnly
      ? 'read_only' as const
      : createsKnownMissingFile || createsDeclaredAppOutput
        ? 'create' as const
        : intentForAffectedFile(file, expectedChangeIntent, mentioned, userRequest);

    return {
      path: file,
      intent,
      reason: mentioned
        ? 'The user explicitly mentioned this file.'
        : 'Inferred from the requested coder workflow area.',
      mustReadBeforeEdit: !readOnly && intent !== 'create',
    };
  });

  const riskFactors = riskFactorsFor({
    taskKind: classification.taskKind,
    targetLayer,
    intent: expectedChangeIntent,
    affectedFileCount: affectedFiles.length,
    message: userRequest,
    projectFileMap: input.projectFileMap,
  });
  const refactorRisk: CoderTaskAnalysis['refactorRisk'] =
    classification.taskKind === 'refactor' && riskFactors.length > 0 ? 'risky_refactor' : 'safe_change';
  const riskLevel: CoderTaskAnalysis['riskLevel'] =
    readOnly
      ? 'low'
      : expectedChangeIntent === 'delete' ||
        expectedChangeIntent === 'rename' ||
        affectedFiles.length > 5 ||
        targetLayer === 'full_stack' ||
        riskFactors.length > 1
        ? 'high'
        : 'medium';

  const requiresApproval = approvalPolicy === 'ask' && !readOnly && riskLevel !== 'low';
  const requiredInspections = readOnly
    ? [
        ...sourceFiles.map((file) => `DocumentRead ${file}`),
        ...mutationFiles.map((file) => `Read ${file}`),
      ]
    : [
        ...sourceFiles.map((file) => `DocumentRead ${file}`),
        ...affectedFiles.filter((file) => file.mustReadBeforeEdit).map((file) => `Read ${file.path}`),
        'Check current git dirty state',
      ];
  const validationRequirements = validationRequirementsFor(classification.taskKind, targetLayer, expectedChangeIntent, riskLevel);
  if (expectedChangeIntent !== 'read_only' &&
      /\bseparate files?\b/i.test(userRequest) &&
      /\.(?:html?)\b/i.test(userRequest) &&
      /\.css\b/i.test(userRequest) &&
      /\.js\b/i.test(userRequest)) {
    validationRequirements.push(
      'Create each explicitly requested HTML, CSS, and JavaScript output as a separate file. Link the external CSS and JavaScript from the HTML; do not use style tags, style attributes, inline scripts, or inline event handlers.',
    );
  }
  if (/\b(browser|playable|web app|web game)\b/i.test(userRequest) && expectedChangeIntent !== 'read_only') {
    validationRequirements.push(
      'Do not complete until a browser entry point is implemented and a browser or targeted UI smoke check confirms it loads.',
    );
  }
  if (classification.taskKind === 'new_feature' && /\b(todo|todos|checklist|task list)\b/i.test(userRequest)) {
    validationRequirements.push('Implement and verify the underlying feature before marking its TODO or checklist item complete. Checklist-only edits are not completion evidence.');
  }
  if (/\b(file[- ]?map|project file map|workspace tree|tree scanning)\b/i.test(userRequest)) {
    validationRequirements.push('Preserve ProjectFileMap response shape while narrowing scan scope or caching behavior.');
  }
  if (rejectedFiles.length > 0) {
    validationRequirements.push(
      `Do not use unmapped file candidates until the workspace map confirms them or the request explicitly creates them: ${rejectedFiles.join(', ')}.`,
    );
  }

  const id = `coder-analysis-${randomUUID()}`;
  const contract = createCodingTaskContract({
    id,
    originalRequest: input.message.trim(),
    resolvedRequest: userRequest,
    taskKind: classification.taskKind,
    behaviorScope,
    expectedChangeIntent,
    workspace,
    candidateFiles: allFiles,
    approvalPolicy,
    requiresApproval,
    validationRequirements,
    verificationPlan: verificationFor(classification.taskKind, expectedChangeIntent, input.projectFileMap),
    riskLevel,
    blocker,
  });

  return {
    id,
    userRequest,
    contract,
    taskKind: classification.taskKind,
    instanceMode,
    targetLayer,
    behaviorScope,
    refactorRisk,
    confidence: classification.confidence,
    specificity,
    workspace,
    projectFileMap: input.projectFileMap,
    mentionedFiles: validatedMentionedFiles,
    inferredFiles: validatedInferredFiles,
    sourceFiles,
    expectedChangeIntent,
    affectedFiles,
    riskLevel,
    riskFactors,
    requiresApproval,
    approvalPolicy,
    requiredInspections,
    verificationPlan: verificationFor(classification.taskKind, expectedChangeIntent, input.projectFileMap),
    validationRequirements,
    rationale: classification.reason,
  };
}

/**
 * Extend a mutating task analysis with files discovered while verifying an
 * existing generated app. Repair is allowed to expand into referenced runtime
 * files, but the executor still requires a successful Read before mutation.
 */
export function extendCoderTaskAnalysisForRepair(
  analysis: CoderTaskAnalysis | undefined,
  repairFiles: string[],
): CoderTaskAnalysis | undefined {
  if (!analysis || analysis.expectedChangeIntent === 'read_only') return analysis;

  const workspace = path.resolve(analysis.workspace);
  const normalizedRepairFiles = unique(repairFiles.map((file) => {
    if (!file.trim()) return '';
    const absolute = path.resolve(workspace, file);
    const relative = path.relative(workspace, absolute);
    if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) return '';
    return relative.replace(/\\/g, '/');
  }).filter(Boolean));
  const existingPaths = new Set(analysis.affectedFiles.map((file) => file.path.replace(/\\/g, '/').toLowerCase()));
  const additions = normalizedRepairFiles.filter((file) => !existingPaths.has(file.toLowerCase()));
  if (additions.length === 0) return { ...analysis, repairMode: true };

  const affectedFiles = [
    ...analysis.affectedFiles,
    ...additions.map((file) => ({
      path: file,
      intent: 'modify' as const,
      reason: 'Referenced by the generated app verification repair.',
      mustReadBeforeEdit: true,
    })),
  ];
  const contract = analysis.contract
    ? {
        ...analysis.contract,
        candidateFiles: unique([...analysis.contract.candidateFiles, ...additions]),
      }
    : undefined;

  return {
    ...analysis,
    repairMode: true,
    inferredFiles: unique([...analysis.inferredFiles, ...additions]),
    affectedFiles,
    requiredInspections: unique([
      ...analysis.requiredInspections,
      ...additions.map((file) => `Read ${file}`),
    ]),
    ...(contract ? { contract } : {}),
  };
}

export function responseModeForAnalysis(
  analysis: CoderTaskAnalysis,
  requestedMode: 'auto' | 'chat' | 'agent' = 'auto'
): 'chat' | 'plan' | 'execute' | 'clarify' {
  if (!analysis.userRequest) return 'clarify';
  if (requestedMode === 'chat') return 'chat';
  if (analysis.contract?.blocker) return 'clarify';
  if (requestedMode === 'agent') return 'execute';
  if (analysis.approvalPolicy === 'auto_approve' || analysis.approvalPolicy === 'full_access') {
    return analysis.expectedChangeIntent === 'read_only' ? 'chat' : 'execute';
  }
  if (analysis.taskKind === 'continuation' && analysis.expectedChangeIntent !== 'read_only') return 'execute';
  if (analysis.expectedChangeIntent === 'read_only') {
    return 'chat';
  }
  return 'plan';
}

export function clarificationMessageForAnalysis(analysis: CoderTaskAnalysis): string {
  const blocker = analysis.contract?.blocker;
  if (!blocker) return 'Please clarify the intended workspace outcome before I make changes.';
  return `${blocker.message} ${blocker.resolution}`;
}
