import React, { useState } from "react";
import {
  TerminalSquare,
  Settings,
  Play,
  Loader2,
  RefreshCw,
  FolderOpen,
  X,
  ChevronRight,
  CornerRightUp,
  Flower2,
  AlertCircle,
  History,
  ShieldCheck,
  ClipboardList,
} from "lucide-react";
import { Button, Input, Textarea, Select } from "./components/FormComponents";
import { LoadingSpinner } from "./components/LoadingComponents";
import { Modal, FolderSelectorModal, ConfirmModal } from "./components/ModalComponents";
import { FinalAnswerRenderer } from "./components/FinalAnswerRenderer";
import { CoderChatPanel } from "./components/CoderChatPanel";
import { TestSuitePanel, type TestSuiteCase, type TestSuiteRunRecord, type TestSuiteStatus } from "./components/TestSuitePanel";
import { OrchestrationCenter } from "./components/OrchestrationCenter";
import ProjectManager from "./components/ProjectManager";
import { WorkspaceHome } from "./components/WorkspaceHome";
import { SettingsModal } from "./components/SettingsModal";
import type {
  AgentRunStatus,
  AgentStreamEvent,
  ApprovalMode,
  CoderMode,
  ExecutionPacingProfile,
  CoderImageAttachment,
  CoderThreadMessage,
  CoderThreadSummary,
} from "./components/CoderChatPanel";
import { getWorkspaceFileUrl } from "./utils/appArtifacts";
import { buildCoderThreadMemoryPrompt, buildLatestCoderContinuationPrompt, getLatestCoderUserRequest } from "./utils/coderThreadMemory";
import { mergeCoderThreadHistory } from "./utils/coderThreadHistory";
import { compactCoderThread, compactCoderThreadState } from "./utils/coderThreadPayload";
import { selectSessionContinuationRun } from "./utils/sessionContinuation";
import {
  createTypewriterController,
  type TypewriterController,
} from "./utils/typewriter";
import {
  createContinuationHandoff,
  type ContinuationHandoff,
  type ContinuationReason,
} from "../../src/react/continuation";
import { getExecutionProfilePreset } from "../../src/config/executionProfiles";
import { sanitizeCoderThreadTitle } from "../../src/utils/coderThreadTitle";
import { normalizeCoderModelSelection, type ModelOption } from "./modelOptions";
import { normalizePendingUserQuestion, type PendingUserQuestion } from "./utils/pendingUserQuestion";
import { formatAgentError, formatTerminalResultError, getAgentEventMessage } from "./utils/agentEventMessages";
import {
  readOrchestrationPreferences,
  writeOrchestrationPreferences,
  type OrchestrationTab,
} from "./utils/orchestrationPreferences";
import type { ExplorerTabId } from "../../src/contracts/migrationContracts";

const PAGE_TITLES: Record<ExplorerTabId, string> = {
  coder: "Coder Chat",
  tests: "Test Suite",
  structure: "Structure",
  audits: "Run Audits",
};

const StructureExplorer = React.lazy(() =>
  import("./StructureExplorer").then((module) => ({ default: module.StructureExplorer }))
);
const RunAuditsPanel = React.lazy(() =>
  import("./components/RunAuditsPanel").then((module) => ({ default: module.RunAuditsPanel }))
);
const DirectChatPanel = React.lazy(() =>
  import("./components/DirectChatPanel").then((module) => ({ default: module.DirectChatPanel }))
);

interface ReActStep {
  thought: string;
  action: string;
  action_input: Record<string, unknown>;
  observation?: string;
  is_done?: boolean;
  final_answer?: string;
  pollenCost?: number;
  startTime?: number;
  endTime?: number;
  durationMs?: number;
}

interface PlanItem {
  step: string;
  status: "pending" | "in_progress" | "completed";
}

interface WorkspaceFileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  summary?: string;
  diff?: string;
  changedAt: number;
  runId?: string;
  changeCount: number;
}

function fileChangeKey(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim().toLowerCase();
}

export interface AppSpec {
  appType: 'game' | 'tool' | 'dashboard' | 'landing' | 'editor' | 'utility';
  outputMode: 'single-html' | 'vanilla-web' | 'vite-react';
  appName: string;
  entryPoint: string;
  requiredFeatures: string[];
  designDirection: string;
  dataPersistence: 'none' | 'localStorage' | 'indexedDB' | 'backend';
  verificationChecks: string[];
}

interface VerificationSignal {
  name: string;
  type?: string;
  passed: boolean;
  details?: string;
  message?: string;
}

interface VerificationCheck {
  name: string;
  passed: boolean;
  reason?: string;
}

export interface VerificationResult {
  passed: boolean;
  checkedAt: string;
  checks: VerificationCheck[];
  signals: VerificationSignal[];
}

interface CostSummary {
  totalCost: number;
  totalTokens: number;
  callCount: number;
  averageCostPerCall: number;
  costByProvider: Record<string, number>;
  costByModel: Record<string, number>;
}

interface ReActResult {
  success: boolean;
  executionCompleted?: boolean;
  verificationStatus?: 'passed' | 'failed' | 'blocked' | 'incomplete' | 'unavailable';
  finalAnswer?: string;
  plan?: PlanItem[];
  steps: ReActStep[];
  stepCount: number;
  pollenCost?: number;
  error?: string;
  errorCode?: string;
  performanceTrace?: {
    counters?: Record<string, number>;
  };
  approvalRequest?: {
    category: string;
    risk: string;
    scope: string;
    summary: string;
    reason: string;
  };
  planApproval?: PlanApprovalView;
  // Phase 2: App Building Contract
  appSpec?: AppSpec;
  // Phase 3: Verification
  appManifestId?: string;
  outputFiles?: string[];
  verificationResult?: VerificationResult;
  // Phase 4: Efficiency
  costSummary?: CostSummary;
  resumeState?: {
    task: string;
    plan: PlanItem[];
    steps: ReActStep[];
    modelContextWindow?: number;
    blockedReason?: string;
    codingState?: "understand" | "discover" | "plan" | "awaiting_plan_approval" | "inspect" | "implement" | "verify" | "repair" | "review" | "complete" | "blocked";
    planApproval?: PlanApprovalView;
  };
}

// Phase 7 - Full-Stack Developer-Agent UI Types

export type ExecutionLayer =
  | 'frontend'
  | 'backend'
  | 'data'
  | 'config'
  | 'tests'
  | 'docs'
  | 'cli'
  | 'vscode-extension';

type TaskClassification =
  | 'bug_fix'
  | 'feature'
  | 'refactor'
  | 'test_only'
  | 'docs_only'
  | 'infrastructure'
  | 'generated_app'
  | 'investigation';

type TaskComplexity = 'trivial' | 'simple' | 'moderate' | 'complex' | 'expert';
type ExecutionStrategy = 'sequential' | 'parallel' | 'mixed';

interface FileOwnership {
  file: string;
  owner: 'frontend' | 'backend' | 'data' | 'test' | 'reviewer' | 'documentation';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

interface AcceptanceCriterion {
  id: string;
  description: string;
  verification: 'manual' | 'automated';
  required: boolean;
  layer?: ExecutionLayer;
}

interface VerificationPlan {
  id: string;
  type: 'unit-test' | 'integration-test' | 'e2e-test' | 'manual-review' | 'smoke-test';
  description: string;
  affectedLayers: ExecutionLayer[];
  commands?: string[];
  expectedOutcome: string;
}

interface FullStackWorkPlan {
  id: string;
  userRequest: string;
  createdAt: number;
  estimatedComplexity: TaskComplexity;
  classification: TaskClassification;
  touchedLayers: ExecutionLayer[];
  targetSurfaces: string[];
  affectedFiles: string[];
  fileOwnership: FileOwnership[];
  executionStrategy: ExecutionStrategy;
  canRunParallel: boolean;
  verificationPlan: VerificationPlan[];
  riskFactors: string[];
  safetyScore: number;
  requiresApproval: boolean;
  approvalReason?: string;
}

interface BoundedAgentTask {
  id: string;
  agentRole: 'frontend' | 'backend' | 'data' | 'test' | 'reviewer' | 'documentation';
  userRequest: string;
  classification: TaskClassification;
  complexity: TaskComplexity;
  ownedFiles: string[];
  touchedLayers: ExecutionLayer[];
  allowedTools: string[];
  createdAt: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

interface AgentTaskExecution {
  taskId: string;
  agentRole: string;
  status: 'pending' | 'assigned' | 'executing' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'verified' | 'verification-failed';
  progress: number;
  startTime?: number;
  endTime?: number;
  durationMs?: number;
  outputs: {
    changedFiles: string[];
    commandsRun: string[];
    testResults?: Record<string, boolean>;
    verificationResults?: Array<{
      check?: string;
      passed: boolean;
      skipped?: boolean;
      duration?: number;
      reason?: string;
      stdout?: string;
      stderr?: string;
    }>;
    errors?: string[];
    warnings?: string[];
  };
  errors: Array<{ message: string; code?: string; timestamp: number; recoverable: boolean }>;
  confidence: number;
  attemptNumber: number;
  lastUpdatedAt?: number;
  verification?: any;
}

interface ConflictWarning {
  type: 'file-conflict' | 'ownership-conflict' | 'dependency-conflict' | 'dirty-file-conflict';
  severity: 'warning' | 'critical';
  files: string[];
  agents: string[];
  description: string;
}

export interface DiffSummary {
  layer: ExecutionLayer;
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
  riskLevel: 'low' | 'medium' | 'high';
}

interface RepoMapData {
  timestamp?: number;
  workspace?: string;
  frontend?: { path?: string; rootDir?: string; modules?: string[]; components?: string[]; pages?: string[]; utilities?: string[]; configFiles?: string[] };
  backend?: { path?: string; modules?: string[]; apiRoutes?: string[]; services?: string[]; dataLayer?: string[]; tools?: string[]; configFiles?: string[] };
  tests?: { path?: string; modules?: string[]; testFiles?: string[]; testDirs?: string[]; coverage?: boolean };
  docs?: { path?: string; modules?: string[]; readmeFiles?: string[]; docDirs?: string[]; apiDocs?: string[] };
  scripts?: { path?: string; scripts?: string[]; available?: string[]; categories?: Record<string, string[]> };
  generated?: { path?: string; artifacts?: string[] };
  artifacts?: { buildOutputs?: string[]; coverage?: string[]; logs?: string[]; cache?: string[] };
}

interface GeminiProfileOption {
  id: string;
  label: string;
  purpose: string;
  keySuffix?: string;
  health?: {
    status?: 'available' | 'cooldown' | 'disabled' | 'misconfigured';
    cooldownUntil?: number;
  };
}

interface ConfiguredApiProvider {
  id: string;
  label: string;
  targetCount: number;
}

const testCategories = [
  {
    category: "Orchestration & Workflow",
    tests: [
      {
        title: "💬 Sub-Agent Falling Back to Specialist",
        tag: "Fallback Test",
        prompt:
          'Use the SubAgent tool to delegate a task to a non-existent agent role "UnavailableAgent". The coordinator should automatically fall back to the "specialist" agent to output a helpful response.',
        modelName: "openai-fast",
      },
      {
        title: "📝 Specialist Documenter Guide",
        tag: "Routing Test",
        prompt:
          'Use the SubAgent tool with the "documenter" role to write a concise 3-bullet-point overview about how Agent-Role-Fallback mechanisms enhance reliability in multi-agent orchestration.',
        modelName: "openai-fast",
      },
      {
        title: "📐 Architect: Complex Subtasks",
        tag: "Planner Orchestration",
        prompt:
          'Use the SubAgent tool with the "planner" role to outline a detailed architectural blueprint for connecting custom MCP servers with secure API Gateways.',
        modelName: "openai-fast",
      },
      {
        title: "🧪 QA: Autonomous Tester Flow",
        tag: "Tester Agent",
        prompt:
          'Assign a task to the "tester" agent to write a complete unit test suite mockup for the ReActEngine class and check for all possible error or quota bounds.',
        modelName: "openai-fast",
      },
    ],
  },
  {
    category: "Code & File Operations",
    tests: [
      {
        title: "⚙️ Write ESM Server Helper",
        tag: "File/Task Test",
        prompt:
          "Write a basic Express health check route helper file named test-helper.js with standard ESM exports.",
        modelName: "openai-fast",
      },
      {
        title: "🔍 Workspace Analysis",
        tag: "Discovery Test",
        prompt:
          'Use the SubAgent tool with the "specialist" role to search for files containing the word "subAgentTool" inside the src directory.',
        modelName: "openai-fast",
      },
      {
        title: "📁 Temp Folder File Write Test",
        tag: "Offline Core",
        prompt:
          'Create a temporary folder named "react_temp_test" if it does not exist, and write a test file named "test_offline.txt" inside it with the text "Engine offline test working". Verify using bash that the file exists and its contents are correct.',
        modelName: "openai-fast",
      },
      {
        title: "🤖 Main Agent Ground Cover",
        tag: "Offline Crew Test",
        prompt:
          'Create a temporary folder named "crew_temp_test" if it does not exist. Break this task down so that a coder agent writes a file "crew_offline.txt" with the content "Crew offline test working" inside the folder, and another agent verifies the file using bash. Print the results.',
        modelName: "openai-fast",
      },
      {
        title: "🔨 Sub-Agent Build Project",
        tag: "Build Development",
        prompt:
          'Assign a task to the "coder" sub-agent to draft a clean, simple calculator helper class in "src/test-subagent.ts" that handles addition, subtraction, and multiplication, and verify it with a simple TypeScript comment section.',
        modelName: "openai-fast",
      },
    ],
  },
  {
    category: "Resilience & Edge Cases",
    tests: [
      {
        title: "🚀 Stress Test: Overload Rotation",
        tag: "Load Test",
        prompt:
          "Generate multiple fast, sequential sub-agent tasks to analyze the current system status and logs, checking model rotation and automatic backoff/bypass behavior.",
        modelName: "openai-fast",
      },
      {
        title: "🐞 Error Recovery: Invalid Path",
        tag: "Fault Tolerance",
        prompt:
          'Attempt to execute a sub-agent task that reads from a non-existent illegal file directory "/invalid/illegal_path/nonexistent.txt" to check if the engine handles errors cleanly and displays user-friendly output.',
        modelName: "openai-fast",
      },
    ],
  },
];

const testSuiteCases: TestSuiteCase[] = testCategories.flatMap((category, categoryIndex) =>
  category.tests.map((test, testIndex) => ({
    id: `suite-${categoryIndex + 1}-${testIndex + 1}`,
    category: category.category,
    title: test.title,
    tag: test.tag,
    prompt: test.prompt,
    modelName: test.modelName,
  }))
);

const collectTestSuiteOutput = (events: AgentStreamEvent[]) => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  for (const event of events) {
    if (event.type === 'command_output') stdout.push(event.output);
    if (event.type === 'console_output') stdout.push(event.message);
    if (event.type === 'package_install_result' && event.output) stdout.push(event.output);
    if (event.type === 'verification_result' && event.output) stdout.push(event.output);
    if (event.type === 'error' || event.type === 'execution_failed' || event.type === 'provider_attempt_failed' || event.type === 'cooldown_waiting') {
      stderr.push(event.message);
    }
  }
  return {
    stdout: stdout.filter(Boolean).join('\n\n'),
    stderr: stderr.filter(Boolean).join('\n\n'),
  };
};

const hydrateTestSuiteRunsFromAudit = (threads: any[]): Record<string, TestSuiteRunRecord> => {
  const hydrated: Record<string, TestSuiteRunRecord> = {};
  for (const thread of threads) {
    const runs = Array.isArray(thread?.runs) ? thread.runs : [];
    for (const run of runs) {
      const searchable = [thread?.threadTitle, thread?.threadId, run?.task, run?.threadTitle].filter(Boolean).join(' ');
      const testCase = testSuiteCases.find((candidate) => searchable.includes(candidate.title));
      if (!testCase) continue;
      const timestamp = typeof run?.timestamp === 'string' ? Date.parse(run.timestamp) : 0;
      const previous = hydrated[testCase.id];
      if (previous?.finishedAt && timestamp && previous.finishedAt > timestamp) continue;
      const outcome = String(run?.outcomeKind || '').toLowerCase();
      const error = typeof run?.error === 'string' ? run.error : undefined;
      const status: TestSuiteStatus = run?.success === true || outcome === 'completed'
        ? 'passed'
        : outcome === 'cancelled' || outcome === 'interrupted' || outcome === 'killed'
          ? 'cancelled'
          : /timeout|timed.?out/i.test(`${outcome} ${error || ''}`)
            ? 'timed_out'
            : outcome.includes('checkpoint')
              ? 'blocked'
              : 'failed';
      const verificationStatus = run?.verificationResult?.passed === true
        ? 'passed'
        : run?.verificationResult?.passed === false
          ? 'failed'
          : undefined;
      const durationMs = Number(run?.performanceTrace?.durationMs || 0);
      hydrated[testCase.id] = {
        status,
        runId: run?.runId || run?.id,
        modelName: run?.model || testCase.modelName,
        finishedAt: timestamp || undefined,
        durationMs: durationMs > 0 ? durationMs : undefined,
        summary: run?.finalAnswer || error,
        error,
        verificationStatus,
        stepCount: Number(run?.stepCount || run?.steps?.length || 0) || undefined,
        pollenCost: Number(run?.totalPollenCost || run?.pollenCost || 0) || undefined,
        filesChanged: Array.isArray(run?.filesChanged) ? run.filesChanged : [],
      };
    }
  }
  return hydrated;
};

const PREFERRED_WORKSPACE_KEY = "react-engine-preferred-workspace";
const CODER_CHAT_THREADS_KEY = "react-engine-coder-chat-threads";
const CODER_MODEL_TARGET_KEY = "react-engine-coder-model-target";
const CODER_APPROVAL_MODE_KEY = "react-engine-coder-approval-mode";
const CODER_PACING_PROFILE_KEY = "react-engine-coder-pacing-profile";
const CODER_REQUEST_BUDGET_ENABLED_KEY = "react-engine-coder-request-budget-enabled";
const CODER_REPLAY_GUARD_ENABLED_KEY = "react-engine-coder-replay-guard-enabled";
const CODER_WAIT_FOR_PROVIDER_ENABLED_KEY = "react-engine-coder-wait-for-provider-enabled";
const CODER_SAFETY_DEFAULTS_VERSION_KEY = "react-engine-coder-safety-defaults-version";
const CODER_SAFETY_DEFAULTS_VERSION = "4";
const DEFAULT_REACT_TURN_WINDOW = 60;
const CONTINUATION_TURN_WINDOW = 40;
const STREAM_UI_FLUSH_MS = 120;
const STREAM_UI_TERMINAL_FLUSH_MS = 0;
const CODER_THREAD_PERSIST_DEBOUNCE_MS = 650;

function isOfflineModelSelection(selection: string): boolean {
  return /^(?:local|colab)(?:-target)?:/i.test(selection.trim());
}

function readCoderSafetyPreference(key: string): boolean {
  try {
    // Migrate settings from builds where these protections could be left off
    // across sessions. Future explicit opt-outs still persist normally.
    if (window.localStorage.getItem(CODER_SAFETY_DEFAULTS_VERSION_KEY) !== CODER_SAFETY_DEFAULTS_VERSION) {
      window.localStorage.setItem(CODER_SAFETY_DEFAULTS_VERSION_KEY, CODER_SAFETY_DEFAULTS_VERSION);
      // Local/offline runs are completion-driven. Keep the request guard
      // available as an explicit opt-in, but do not let it end a normal task.
      window.localStorage.setItem(CODER_REQUEST_BUDGET_ENABLED_KEY, "disabled");
      window.localStorage.setItem(CODER_REPLAY_GUARD_ENABLED_KEY, "enabled");
      // A local model server can restart or briefly disappear. Keep the run at
      // its checkpoint and retry the same route until it is available again.
      window.localStorage.setItem(CODER_WAIT_FOR_PROVIDER_ENABLED_KEY, "enabled");
    }
    return window.localStorage.getItem(key) !== "disabled";
  } catch {
    return true;
  }
}

interface StreamReactOptions {
  trackCoderThread?: boolean;
  stopMessage?: string;
  runKind?: "react" | "coder" | "app";
  threadId?: string | null;
  displayTask?: string;
  existingRunId?: string;
  taskAnalysis?: CoderTaskAnalysis | null;
  approvalPolicy?: ApprovalMode;
  continuationHandoff?: ContinuationHandoff;
  pacingProfile?: ExecutionPacingProfile;
  selectedModel?: string;
  selectedGeminiProfileId?: string;
}

type CoderTaskKind =
  | "question"
  | "investigation"
  | "bug_fix"
  | "new_feature"
  | "refactor"
  | "test_only"
  | "docs_only"
  | "continuation"
  | "new_instance";

type FileChangeIntent = "read_only" | "create" | "modify" | "delete" | "rename" | "unknown";

interface CoderTaskAnalysis {
  id: string;
  userRequest: string;
  taskKind: CoderTaskKind;
  instanceMode: "continuation" | "new_instance" | "unknown";
  targetLayer?: "ui" | "backend" | "shared" | "config" | "docs" | "tests" | "unknown" | "full_stack";
  behaviorScope?: "read_only" | "existing_behavior_fix" | "new_behavior" | "new_instance" | "maintenance";
  refactorRisk?: "safe_change" | "risky_refactor";
  confidence: number;
  workspace: string;
  projectFileMap?: {
    workspace: string;
    generatedAt: number;
    totalFiles: number;
    omittedCount: number;
    files: Array<{ path: string; layer: string; role: string; exists: boolean }>;
  };
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
  riskLevel: "low" | "medium" | "high";
  riskFactors?: string[];
  requiresApproval: boolean;
  approvalPolicy?: ApprovalMode;
  requiredInspections: string[];
  verificationPlan: string[];
  validationRequirements?: string[];
  rationale: string;
}

interface CoderRespondResponse {
  mode: "chat" | "execute" | "clarify";
  reply?: string;
  reasoningSummary?: string;
  executionTask?: string;
  reason?: string;
  confidence?: number;
  analysis?: CoderTaskAnalysis;
  error?: string;
}

interface CoderAnalyzeResponse {
  responseMode: "chat" | "plan" | "execute" | "clarify";
  analysis: CoderTaskAnalysis;
  error?: string;
}

interface CoderThreadState {
  threads: CoderThreadSummary[];
  activeThreadId: string | null;
}

interface StoredAgentRun {
  id: string;
  kind: "react" | "coder" | "app" | "agent" | string;
  threadId?: string;
  status: "running" | "waiting_for_user" | "waiting_for_provider" | "completed" | "failed" | "stopped" | "interrupted" | "killed";
  task: string;
  workspace?: string;
  model?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  lastMeaningfulProgressAt?: number;
  lastWorkspaceChangeAt?: number;
  lastSuccessfulVerificationAt?: number;
  finishedAt?: number;
  stopReason?: string;
  result?: any;
  lastEventSeq: number;
  seenAt?: number;
}

interface PendingPolicyApproval {
  runId: string;
  scope: string;
  category: string;
  risk: string;
  summary: string;
  reason: string;
}

interface PlanApprovalView {
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  proposedPlan: PlanItem[];
  approvedPlan?: PlanItem[];
  scope: { files: string[]; mutationScopes: string[]; verificationCommands: string[] };
  reason: string;
  decisionReason?: string;
}

const isMaxStepsResult = (value: ReActResult | null) =>
  Boolean(
    value &&
      !value.success &&
      (value.errorCode === "MAX_STEPS_EXCEEDED" ||
        value.error === "Max steps exceeded")
  );

const isPhaseCompletedResult = (value: ReActResult | null) =>
  Boolean(value?.success && value.errorCode === "PHASE_COMPLETED");

const isProviderRecoveryResult = (value: ReActResult | null) =>
  Boolean(
    !value?.success &&
    (value?.errorCode === "MODEL_FALLBACK_CONFIRMATION_REQUIRED" ||
      value?.errorCode === "PROVIDER_RETRY_LIMIT" ||
      value?.errorCode === "PROVIDER_COOLDOWN_TOO_LONG" ||
      value?.errorCode === "PROVIDER_WAIT_DISABLED")
  );

const isCompletedWithVerificationFailure = (value: ReActResult | null) =>
  Boolean(value?.executionCompleted === true && value?.verificationStatus === 'failed');

const isProviderWaitDisabledResult = (value: ReActResult | null) =>
  Boolean(!value?.success && value?.errorCode === "PROVIDER_WAIT_DISABLED");

const isApprovalRequiredResult = (value: ReActResult | null) =>
  Boolean(!value?.success && value?.errorCode === "APPROVAL_REQUIRED" && value.approvalRequest);

const isPlanApprovalRequiredResult = (value: ReActResult | null) =>
  Boolean(!value?.success && value?.errorCode === "PLAN_APPROVAL_REQUIRED" && value.planApproval);

const isTaskRequestBudgetResult = (value: ReActResult | null) =>
  Boolean(!value?.success && value?.errorCode === "TASK_LLM_REQUEST_BUDGET_REACHED");

const isTimedOutResult = (value?: Pick<ReActResult, 'error' | 'errorCode'> | null) =>
  Boolean(value && /\b(?:timed[\s_-]*out|timeout|deadline(?:\s+exceeded)?)\b/i.test(`${value.errorCode || ''} ${value.error || ''}`));

const AUTO_CONTINUE_DELAY_SECONDS = 0;
// Autonomous continuation applies only to the internal execution checkpoint.
// Request-budget, provider, approval, cancellation, and ordinary task failures
// still stop for inspection or an explicit user decision.
const AUTO_CONTINUE_ENABLED = true;

const isAutomaticContinuationResult = (value: ReActResult | null) =>
  isMaxStepsResult(value);

const isContinuableResult = (value: ReActResult | null) =>
  isMaxStepsResult(value) || isPhaseCompletedResult(value) || isProviderRecoveryResult(value) ||
  isTaskRequestBudgetResult(value);

const normalizeAgentRole = (owner?: string): BoundedAgentTask["agentRole"] => {
  const role = (owner || "").toLowerCase();
  if (role.includes("front")) return "frontend";
  if (role.includes("back")) return "backend";
  if (role.includes("data")) return "data";
  if (role.includes("test") || role.includes("qa")) return "test";
  if (role.includes("review")) return "reviewer";
  if (role.includes("doc")) return "documentation";
  return "reviewer";
};

const inferLayerForFile = (file: string): ExecutionLayer => {
  if (file.startsWith("ui/")) return "frontend";
  if (file.startsWith("tests/") || file.includes("__tests__") || file.endsWith(".test.ts")) return "tests";
  if (file.startsWith("docs/") || file.toLowerCase().includes("readme")) return "docs";
  if (file.includes("config") || file.endsWith(".json") || file.endsWith(".env")) return "config";
  if (file.startsWith("src/")) return "backend";
  return "backend";
};

const extractMentionedFiles = (text: string): string[] => {
  const matches = text.match(/[A-Za-z0-9_.@/-]+\.(?:tsx|ts|jsx|js|json|md|css|html|cjs|mjs|yml|yaml)/g) || [];
  return Array.from(new Set(matches.map((match) => match.replace(/^["'`]+|["'`,.]+$/g, ""))));
};

const statusFromAgentEvent = (event: AgentStreamEvent): AgentRunStatus | undefined => {
  if (event.type === "run_started") return "thinking";
  if (event.type === "state_transition") {
    if (event.transition.to === "verifying") return "verifying";
    if (event.transition.to === "implementing" || event.transition.to === "repairing") return "editing files";
    if (event.transition.to === "awaiting_plan_approval" || event.transition.to === "awaiting_approval") return "waiting for you";
    if (event.transition.to === "planning" || event.transition.to === "inspecting") return "planning";
  }
  if (event.type === "model_target_resolved") return "thinking";
  if (event.type === "llm_request_started" || event.type === "llm_request_finished") return "thinking";
  if (event.type === "model_response") return "thinking";
  if (event.type === "cooldown_waiting" || event.type === "nvidia_cooldown_retry" || (event.type === "pacing_wait" && event.scope === "free_tier_key_cooldown")) return "waiting for provider";
  if (event.type === "provider_attempt_failed" || event.type === "retrying") return "thinking";
  if (event.type === "execution_failed") return "failed";
  if (event.type === "plan_updated" || event.type === "todo_snapshot" || event.type === "todo_links_updated") return "planning";
  if (event.type === "workplan_updated") return "planning";
  if (event.type === "file_read") return "reading files";
  if (event.type === "file_changed") return "editing files";
  if (event.type === "command_started" || event.type === "command_output") return "running command";
  if (event.type === "package_install_started") return "installing dependencies";
  if (event.type === "package_install_result") return event.success ? "thinking" : "failed";
  if (event.type === "verification_started" || event.type === "verification_result") return "verifying";
  if (event.type === "user_input_required") return "waiting for you";
  if (event.type === "user_input_resolved") return "thinking";
  if (event.type === "final") return "completed";
  if (event.type === "stopped") return "stopped";
  if (event.type === "interrupted" || event.type === "killed") return event.type;
  if (event.type === "error") return "failed";
  return undefined;
};

const createCoderThreadId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const getCoderThreadTitle = (messages: CoderThreadMessage[], fallback = "New coder thread") => {
  return sanitizeCoderThreadTitle(fallback, messages);
};

const createEmptyCoderThread = (): CoderThreadSummary => {
  const now = Date.now();
  return {
    id: createCoderThreadId(),
    title: "New coder thread",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
};

const normalizeCoderThreadState = (state: CoderThreadState): CoderThreadState => {
  const threads = (Array.isArray(state?.threads) ? state.threads : [])
    .filter((thread) => thread && typeof thread.id === "string")
    .map((thread) => {
      const messages = (Array.isArray(thread.messages) ? thread.messages : [])
        .filter((message): message is CoderThreadMessage => Boolean(message && typeof message === 'object'))
        .map((message, index) => ({
          ...message,
          id: typeof message.id === 'string' && message.id ? message.id : `${thread.id}-message-${index}`,
          role: message.role === 'user' || message.role === 'assistant' || message.role === 'system' ? message.role : 'system',
          content: typeof message.content === 'string' ? message.content : '',
          createdAt: Number(message.createdAt) || Date.now(),
        }));

      return {
      ...thread,
      messages,
      title: sanitizeCoderThreadTitle(thread.title, messages),
      createdAt: Number(thread.createdAt) || Date.now(),
      updatedAt: Number(thread.updatedAt) || Number(thread.createdAt) || Date.now(),
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const activeThreadId = threads.some((thread) => thread.id === state.activeThreadId)
    ? state.activeThreadId
    : threads[0]?.id || null;

  return { threads, activeThreadId };
};

const loadCoderThreadState = (): CoderThreadState => {
  if (typeof window === "undefined") return { threads: [], activeThreadId: null };

  try {
    const raw = window.localStorage.getItem(CODER_CHAT_THREADS_KEY);
    if (!raw) return { threads: [], activeThreadId: null };
    const parsed = JSON.parse(raw);
    return normalizeCoderThreadState({
      threads: Array.isArray(parsed?.threads) ? parsed.threads : [],
      activeThreadId: parsed?.activeThreadId || null,
    });
  } catch {
    return { threads: [], activeThreadId: null };
  }
};

const loadCoderModelTarget = () => {
  if (typeof window === "undefined") return normalizeCoderModelSelection(undefined);
  try {
    const stored = window.localStorage.getItem(CODER_MODEL_TARGET_KEY);
    // The old env-backed default must not survive as a hidden browser
    // override after the provider setting is changed.
    if (!stored || /^(?:z-ai\/glm-5\.2|openrouter:(?:openrouter\/free|z-ai\/glm-5\.2:free))$/i.test(stored.trim())) {
      return normalizeCoderModelSelection(undefined);
    }
    return normalizeCoderModelSelection(stored);
  } catch {
    return normalizeCoderModelSelection(undefined);
  }
};

const normalizeWorkPlanForUi = (plan: any): FullStackWorkPlan => ({
  ...plan,
  affectedFiles: (plan.affectedFiles || []).map((item: any) => typeof item === "string" ? item : item.file).filter(Boolean),
  fileOwnership: (plan.fileOwnership || []).map((ownership: any) => ({
    ...ownership,
    file: ownership.file || ownership.path,
    owner: normalizeAgentRole(ownership.owner),
    confidence: ownership.confidence || "medium",
    reason: ownership.reason || "Assigned by generated workplan",
  })),
});

function App() {
  const [task, setTask] = useState("");
  const [model, setModel] = useState(loadCoderModelTarget);
  const [workspace, setWorkspace] = useState("");
  const [showWorkspaceHome, setShowWorkspaceHome] = useState(false);
  const [geminiProfiles, setGeminiProfiles] = useState<GeminiProfileOption[]>([]);
  const [geminiProfileId, setGeminiProfileId] = useState("");
  const allowCrossProviderFallback = false;
  const [fallbackAuthorizationRunId, setFallbackAuthorizationRunId] = useState<string | null>(null);
  const [pendingModelChange, setPendingModelChange] = useState<{
    runId: string;
    resumeAfterChange: boolean;
  } | null>(null);
  const [recoveryModel, setRecoveryModel] = useState("");
  const [configuredModelOptions, setConfiguredModelOptions] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [appActionLoading, setAppActionLoading] = useState(false);
  const [liveProgress, setLiveProgress] = useState("");
  const [liveState, setLiveState] = useState<any>(null);
  const [result, setResult] = useState<ReActResult | null>(null);
  const [workspaceRefreshTrigger, setWorkspaceRefreshTrigger] = useState(0);
  const [workspaceFileChanges, setWorkspaceFileChanges] = useState<Record<string, WorkspaceFileChange>>({});
  const [workspaceLastRefreshedAt, setWorkspaceLastRefreshedAt] = useState<number | null>(null);
  const [structureDirty, setStructureDirty] = useState(false);
  const [pendingWorkspace, setPendingWorkspace] = useState<string | null>(null);

  const [showFolderModal, setShowFolderModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showContinueModal, setShowContinueModal] = useState(false);
  const [showAuditHistory, setShowAuditHistory] = useState(false);

  const [autoContinueSeconds, setAutoContinueSeconds] = useState(AUTO_CONTINUE_DELAY_SECONDS);
  const [autoContinuePaused, setAutoContinuePaused] = useState(false);
  const [fsPath, setFsPath] = useState("");
  const [fsParent, setFsParent] = useState<string | null>(null);
  const [fsDirectories, setFsDirectories] = useState<string[]>([]);
  const [fsLoading, setFsLoading] = useState(false);
  const [fsError, setFsError] = useState("");
  const [rootLoading, setRootLoading] = useState(false);
  const [rootError, setRootError] = useState("");

  const [mcpConnected, setMcpConnected] = useState(false);

  // Pollen balance status
  const [pollenStatus, setPollenStatus] = useState<any>(null);
  const [checkingPollen, setCheckingPollen] = useState(false);
  const [configuredApiProviders, setConfiguredApiProviders] = useState<ConfiguredApiProvider[]>([]);

  // Phase 7 - Full-Stack Developer-Agent UI State
  const [workPlan, setWorkPlan] = useState<FullStackWorkPlan | null>(null);
  const [workPlanLoading, setWorkPlanLoading] = useState(false);
  const [workPlanApproved, setWorkPlanApproved] = useState(false);
  const [agentExecutions, setAgentExecutions] = useState<AgentTaskExecution[]>([]);
  const [conflicts, setConflicts] = useState<ConflictWarning[]>([]);
  const [diffs, setDiffs] = useState<DiffSummary[]>([]);
  const [repoMap, setRepoMap] = useState<RepoMapData | null>(null);
  const [taskExecutionStatus, setTaskExecutionStatus] = useState<'pending' | 'approved' | 'executing' | 'paused' | 'completed' | 'failed'>('pending');
  const [coderThreadState, setCoderThreadState] = useState<CoderThreadState>(() => loadCoderThreadState());
  const orchestrationThreadScope = coderThreadState.activeThreadId || 'new-thread';
  const [orchestrationPreferences, setOrchestrationPreferences] = useState(() =>
    readOrchestrationPreferences(orchestrationThreadScope)
  );
  const orchestrationPreferencesScopeRef = React.useRef(orchestrationThreadScope);
  const [coderMode, setCoderMode] = useState<CoderMode>("auto");
  const [coderApprovalMode, setCoderApprovalMode] = useState<ApprovalMode>(() => {
    try {
      const value = window.localStorage.getItem(CODER_APPROVAL_MODE_KEY);
      return value === "auto_approve" || value === "full_access" ? value : "ask";
    } catch {
      return "ask";
    }
  });
  const [coderPacingProfile, setCoderPacingProfile] = useState<ExecutionPacingProfile>(() => {
    try {
      const value = window.localStorage.getItem(CODER_PACING_PROFILE_KEY);
      return value === "automatic" || value === "conservative" || value === "phased" || value === "fast" ? value : "automatic";
    } catch {
      return "automatic";
    }
  });
  const [requestBudgetEnabled, setRequestBudgetEnabled] = useState(() => {
    return readCoderSafetyPreference(CODER_REQUEST_BUDGET_ENABLED_KEY);
  });
  const [replayGuardEnabled, setReplayGuardEnabled] = useState(() => {
    return readCoderSafetyPreference(CODER_REPLAY_GUARD_ENABLED_KEY);
  });
  const [waitForProviderAvailability, setWaitForProviderAvailability] = useState(() => {
    return readCoderSafetyPreference(CODER_WAIT_FOR_PROVIDER_ENABLED_KEY);
  });
  // Fast pacing removes the delay between requests; it does not disable
  // checkpoint-safe recovery when a provider returns a transient 429/timeout.
  const resolveWaitForProviderAvailability = (_pacingProfile?: ExecutionPacingProfile) =>
    waitForProviderAvailability;
  const [coderTaskAnalysis, setCoderTaskAnalysis] = useState<CoderTaskAnalysis | null>(null);
  const [coderAgentEvents, setCoderAgentEvents] = useState<AgentStreamEvent[]>([]);
  const [coderAgentStatus, setCoderAgentStatus] = useState<AgentRunStatus | undefined>(undefined);
  const [pendingPolicyApproval, setPendingPolicyApproval] = useState<PendingPolicyApproval | null>(null);
  const [policyApprovalBusy, setPolicyApprovalBusy] = useState(false);
  const [pendingPlanApproval, setPendingPlanApproval] = useState<{ runId: string; approval: PlanApprovalView } | null>(null);
  const [planApprovalDraft, setPlanApprovalDraft] = useState('');
  const [planApprovalBusy, setPlanApprovalBusy] = useState(false);
  const [pendingUserQuestion, setPendingUserQuestion] = useState<PendingUserQuestion | null>(null);
  const [userQuestionAnswer, setUserQuestionAnswer] = useState("");
  const [userQuestionOption, setUserQuestionOption] = useState("");
  const [userQuestionBusy, setUserQuestionBusy] = useState(false);
  const [resumableRuns, setResumableRuns] = useState<StoredAgentRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  // Tab View state
  const [activeTab, setActiveTab] = useState<ExplorerTabId>("coder");
  React.useEffect(() => {
    const sectionTitle = showSettingsModal ? "Settings" : PAGE_TITLES[activeTab];
    document.title = `Barok · ${sectionTitle}`;
  }, [activeTab, showSettingsModal]);
  const [structureFocusRequest, setStructureFocusRequest] = useState<{ path: string; requestId: number } | null>(null);
  const structureFocusRequestIdRef = React.useRef(0);
  const [selectedAuditRunId, setSelectedAuditRunId] = useState<string | null>(null);
  const [testSuiteRuns, setTestSuiteRuns] = useState<Record<string, TestSuiteRunRecord>>({});
  const [activeTestSuiteCaseId, setActiveTestSuiteCaseId] = useState<string | null>(null);
  const testSuiteActiveCaseRef = React.useRef<string | null>(null);
  const testSuiteQueueRef = React.useRef<string[]>([]);

  const handleOpenStructureFile = React.useCallback((path: string) => {
    structureFocusRequestIdRef.current += 1;
    setStructureFocusRequest({ path, requestId: structureFocusRequestIdRef.current });
    setActiveTab("structure");
  }, []);

  React.useEffect(() => {
    if (orchestrationPreferencesScopeRef.current === orchestrationThreadScope) {
      writeOrchestrationPreferences(orchestrationThreadScope, orchestrationPreferences);
      return;
    }

    orchestrationPreferencesScopeRef.current = orchestrationThreadScope;
    setOrchestrationPreferences(readOrchestrationPreferences(orchestrationThreadScope));
  }, [orchestrationPreferences, orchestrationThreadScope]);

  const updateOrchestrationPreferences = React.useCallback((update: Partial<typeof orchestrationPreferences>) => {
    setOrchestrationPreferences((current) => ({ ...current, ...update }));
  }, []);

  React.useEffect(() => {
    if (activeTab !== 'tests') return;
    let cancelled = false;
    const loadPersistedTestSuiteRuns = async () => {
      try {
        const response = await fetch('/api/react/threads?limit=100');
        if (!response.ok) return;
        const data = await response.json().catch(() => ({}));
        const hydrated = hydrateTestSuiteRunsFromAudit(Array.isArray(data.threads) ? data.threads : []);
        if (cancelled || Object.keys(hydrated).length === 0) return;
        setTestSuiteRuns((current) => {
          const next = { ...hydrated, ...current };
          for (const testCase of testSuiteCases) {
            if (current[testCase.id]?.status === 'running' || current[testCase.id]?.status === 'queued') {
              next[testCase.id] = current[testCase.id];
            }
          }
          return next;
        });
      } catch {
        // Audit history is supplemental; live Test Suite state remains authoritative during a run.
      }
    };
    void loadPersistedTestSuiteRuns();
    return () => { cancelled = true; };
  }, [activeTab]);

  const reactStreamAbortRef = React.useRef<AbortController | null>(null);
  const activeRunIdRef = React.useRef<string | null>(null);
  const lastRunIdRef = React.useRef<string | null>(null);
  const pendingQuestionKeyRef = React.useRef<string | null>(null);
  const resolvedQuestionKeyRef = React.useRef<string | null>(null);
  const resumeInFlightRef = React.useRef<string | null>(null);
  const autoContinueTriggeredRef = React.useRef(false);
  const coderThreadHydratedRef = React.useRef(false);
  const dirtyCoderThreadIdsRef = React.useRef<Set<string>>(new Set());
  const backendCoderThreadSummariesRef = React.useRef(new Map<string, { updatedAt: number; messageCount: number }>());
  const hydratedBackendCoderThreadIdsRef = React.useRef(new Set<string>());
  const hydratingBackendCoderThreadIdsRef = React.useRef(new Set<string>());
  const lastPersistedCoderActiveThreadIdRef = React.useRef<string | null>(coderThreadState.activeThreadId);
  const coderThreadStateRef = React.useRef(coderThreadState);
  const coderThread = coderThreadState.threads.find((thread) => thread.id === coderThreadState.activeThreadId)?.messages || [];
  const activeSessionRun = React.useMemo(
    () => selectSessionContinuationRun(resumableRuns, coderThreadState.activeThreadId, coderThread),
    [coderThread, coderThreadState.activeThreadId, resumableRuns]
  );

  React.useEffect(() => {
    coderThreadStateRef.current = coderThreadState;
  }, [coderThreadState]);

  const getCoderThreadIdForRun = (runId?: string | null) => {
    if (runId) {
      const persistedThreadId = resumableRuns.find((run) => run.id === runId)?.threadId;
      if (persistedThreadId) return persistedThreadId;
      const localThreadId = coderThreadState.threads.find((thread) =>
        thread.messages.some((message) => message.runId === runId)
      )?.id;
      if (localThreadId) return localThreadId;
    }
    return coderThreadState.activeThreadId || undefined;
  };

  React.useEffect(() => {
    activeRunIdRef.current = activeRunId;
  }, [activeRunId]);

  const refreshResumableRuns = React.useCallback(async () => {
    try {
      const res = await fetch("/api/runs?kind=coder&resumable=true");
      if (!res.ok) return;
      const data = await res.json();
      const runs = Array.isArray(data.runs) ? data.runs as StoredAgentRun[] : [];
      setResumableRuns(runs);

      // Run summaries intentionally omit the full metadata payload. Re-read
      // the active question separately so a reload/reconnect can restore the
      // modal instead of leaving the agent paused with no way to answer it.
      const waitingRun = runs.find((run) => run.status === 'waiting_for_user');
      if (!waitingRun) return;
      const pendingResponse = await fetch(`/api/runs/${encodeURIComponent(waitingRun.id)}/user-input`);
      const pendingData = await pendingResponse.json().catch(() => ({}));
      if (!pendingResponse.ok) return;
      const restored = normalizePendingUserQuestion(waitingRun.id, pendingData.request);
      if (!restored) return;

      const questionKey = `${restored.runId}:${restored.requestId}`;
      if (resolvedQuestionKeyRef.current === questionKey) return;
      if (pendingQuestionKeyRef.current && pendingQuestionKeyRef.current !== questionKey) return;
      if (pendingQuestionKeyRef.current === questionKey) return;

      pendingQuestionKeyRef.current = questionKey;
      setPendingUserQuestion(restored);
      setUserQuestionAnswer('');
      setUserQuestionOption(restored.options[0] || '');
      setCoderAgentStatus('waiting for you');
    } catch (error) {
      console.error("Failed to load resumable runs", error);
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const loadProfiles = async () => {
      try {
        const query = workspace.trim() ? `?workspace=${encodeURIComponent(workspace.trim())}` : '';
        const response = await fetch(`/api/gemini/profiles${query}`);
        const data = await response.json();
        if (cancelled || !response.ok) return;
        const profiles = Array.isArray(data.profiles) ? data.profiles : [];
        setGeminiProfiles(profiles);
        setGeminiProfileId((current) => {
          if (current && profiles.some((profile: GeminiProfileOption) => profile.id === current)) return current;
          return typeof data.selectedProfileId === 'string' ? data.selectedProfileId : profiles[0]?.id || '';
        });
      } catch (error) {
        console.error('Failed to load Gemini profiles', error);
      }
    };
    void loadProfiles();
    return () => { cancelled = true; };
  }, [workspace]);

  React.useEffect(() => {
    let cancelled = false;
    const providers = [
      { id: 'nvidia', label: 'NVIDIA', endpoint: '/api/nvidia/model-targets' },
      { id: 'gemini', label: 'Gemini', endpoint: '/api/gemini/model-targets' },
      { id: 'openrouter', label: 'OpenRouter', endpoint: '/api/openrouter/model-targets' },
      { id: 'groq', label: 'Groq', endpoint: '/api/groq/model-targets' },
      { id: 'kimi', label: 'Kimi', endpoint: '/api/kimi/model-targets' },
      { id: 'requesty', label: 'Requesty', endpoint: '/api/requesty/model-targets' },
      { id: 'local-ai', label: 'Local AI', endpoint: '/api/local-ai/model-targets' },
      { id: 'colab', label: 'Colab model', endpoint: '/api/colab/model-targets' },
    ];

    const loadConfiguredProviders = async () => {
      const results = await Promise.allSettled(
        providers.map(async (provider) => {
          const response = await fetch(provider.endpoint);
          if (!response.ok) return null;
          const data = await response.json().catch(() => ({}));
          const targetCount = Array.isArray(data.targets) ? data.targets.length : 0;
          return targetCount > 0 ? { id: provider.id, label: provider.label, targetCount } : null;
        })
      );
      if (cancelled) return;
      setConfiguredApiProviders(
        results.flatMap((result) =>
          result.status === 'fulfilled' && result.value ? [result.value] : []
        )
      );
    };

    const refresh = () => void loadConfiguredProviders();
    void loadConfiguredProviders();
    window.addEventListener('nvidia-model-targets-updated', refresh);
    window.addEventListener('gemini-model-targets-updated', refresh);
    window.addEventListener('provider-model-targets-updated', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('nvidia-model-targets-updated', refresh);
      window.removeEventListener('gemini-model-targets-updated', refresh);
      window.removeEventListener('provider-model-targets-updated', refresh);
    };
  }, []);

  const handleGeminiProfileChange = async (profileId: string) => {
    if (loading) return;
    setGeminiProfileId(profileId);
    if (!workspace.trim()) return;
    try {
      await fetch('/api/gemini/profiles/assignment', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace: workspace.trim(), profileId }),
      });
    } catch (error) {
      console.error('Failed to save Gemini workspace profile', error);
    }
  };

  React.useEffect(() => {
    void refreshResumableRuns();
  }, [refreshResumableRuns]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(CODER_APPROVAL_MODE_KEY, coderApprovalMode);
    } catch {
      // Preference persistence is best-effort.
    }
  }, [coderApprovalMode]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(CODER_PACING_PROFILE_KEY, coderPacingProfile);
    } catch {
      // Preference persistence is best-effort.
    }
  }, [coderPacingProfile]);

  React.useEffect(() => {
    setWorkspaceFileChanges({});
  }, [workspace]);

  const handleRequestBudgetEnabledChange = (enabled: boolean) => {
    setRequestBudgetEnabled(enabled);
    try {
      window.localStorage.setItem(CODER_REQUEST_BUDGET_ENABLED_KEY, enabled ? "enabled" : "disabled");
    } catch {
      // Preference persistence is best-effort.
    }
  };

  const handleReplayGuardEnabledChange = (enabled: boolean) => {
    setReplayGuardEnabled(enabled);
    try {
      window.localStorage.setItem(CODER_REPLAY_GUARD_ENABLED_KEY, enabled ? "enabled" : "disabled");
    } catch {
      // Preference persistence is best-effort.
    }
  };

  const handleWaitForProviderAvailabilityChange = (enabled: boolean) => {
    setWaitForProviderAvailability(enabled);
    try {
      window.localStorage.setItem(CODER_WAIT_FOR_PROVIDER_ENABLED_KEY, enabled ? "enabled" : "disabled");
    } catch {
      // Preference persistence is best-effort.
    }
  };

  React.useEffect(() => {
    try {
      window.localStorage.setItem(CODER_MODEL_TARGET_KEY, model);
    } catch {
      // Preference persistence is best-effort.
    }
  }, [model]);

  React.useEffect(() => {
    let cancelled = false;

    const loadBackendThreads = async () => {
      try {
        const summaries: CoderThreadSummary[] = [];
        let cursor: string | null = null;
        do {
          const params = new URLSearchParams({ limit: '100' });
          if (cursor) params.set('cursor', cursor);
          const res = await fetch(`/api/coder/threads?${params.toString()}`);
          if (!res.ok) throw new Error(`Thread history failed to load (HTTP ${res.status})`);
          const data = await res.json();
          if (cancelled) return;
          if (Array.isArray(data.threads)) {
            summaries.push(...data.threads.filter((thread: any) => thread && typeof thread.id === 'string').map((thread: any) => ({
              ...thread,
              messages: [],
              messagesLoaded: false,
            })));
          }
          const nextCursor = typeof data.page?.nextCursor === 'string' ? data.page.nextCursor : null;
          if (!nextCursor || nextCursor === cursor) break;
          cursor = nextCursor;
        } while (!cancelled);

        if (cancelled) return;
        backendCoderThreadSummariesRef.current = new Map(summaries.map((thread) => [thread.id, {
          updatedAt: Number(thread.updatedAt) || 0,
          messageCount: Number(thread.messageCount) || 0,
        }]));

        setCoderThreadState((prev) => {
          const merged = mergeCoderThreadHistory(prev.threads, summaries);
          merged.localThreadIdsNeedingSync.forEach((threadId) => dirtyCoderThreadIdsRef.current.add(threadId));
          return normalizeCoderThreadState({
            threads: merged.threads,
            activeThreadId: prev.activeThreadId || summaries[0]?.id || null,
          });
        });
      } catch (error) {
        console.error("Failed to load database-backed coder chat threads", error);
      } finally {
        coderThreadHydratedRef.current = true;
      }
    };

    void loadBackendThreads();

    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    const threadId = coderThreadState.activeThreadId;
    if (!threadId || hydratedBackendCoderThreadIdsRef.current.has(threadId) || hydratingBackendCoderThreadIdsRef.current.has(threadId)) return;
    const serverSummary = backendCoderThreadSummariesRef.current.get(threadId);
    if (!serverSummary) return;

    const localThread = coderThreadState.threads.find((thread) => thread.id === threadId);
    const localMessageCount = localThread?.messages.length || 0;
    if (localThread && localThread.updatedAt >= serverSummary.updatedAt && localMessageCount >= serverSummary.messageCount && localThread.messagesLoaded !== false) {
      hydratedBackendCoderThreadIdsRef.current.add(threadId);
      if (localThread.updatedAt > serverSummary.updatedAt || localMessageCount > serverSummary.messageCount) {
        dirtyCoderThreadIdsRef.current.add(threadId);
        setCoderThreadState((prev) => ({ ...prev, threads: [...prev.threads] }));
      }
      return;
    }

    hydratingBackendCoderThreadIdsRef.current.add(threadId);
    void (async () => {
      try {
        const messages: CoderThreadMessage[] = [];
        let cursor: string | null = null;
        let threadDetail: any = null;
        do {
          const params = new URLSearchParams({ limit: '50' });
          if (cursor) params.set('cursor', cursor);
          const response = await fetch(`/api/coder/threads/${encodeURIComponent(threadId)}?${params.toString()}`);
          if (!response.ok) throw new Error(`Thread ${threadId} history failed to load (HTTP ${response.status})`);
          const data = await response.json();
          if (!data.thread || !Array.isArray(data.thread.messages)) throw new Error(`Thread ${threadId} history response was invalid`);
          threadDetail = data.thread;
          messages.unshift(...data.thread.messages);
          const nextCursor = typeof data.page?.nextCursor === 'string' ? data.page.nextCursor : null;
          if (!nextCursor || nextCursor === cursor) break;
          cursor = nextCursor;
        } while (true);

        setCoderThreadState((prev) => {
          const current = prev.threads.find((thread) => thread.id === threadId);
          const detailUpdatedAt = Number(threadDetail?.updatedAt) || 0;
          if (current && current.messagesLoaded !== false && current.updatedAt > detailUpdatedAt) {
            dirtyCoderThreadIdsRef.current.add(threadId);
            return { ...prev, threads: [...prev.threads] };
          }
          const pendingLocalMessages = current?.messagesLoaded === false ? current.messages : [];
          const mergedMessagesById = new Map(messages.map((message) => [message.id, message]));
          for (const message of pendingLocalMessages) {
            if (message.role !== 'user' && message.runId) {
              const existingRunMessage = Array.from(mergedMessagesById.values()).find((item) => item.role !== 'user' && item.runId === message.runId);
              if (existingRunMessage) mergedMessagesById.delete(existingRunMessage.id);
            }
            mergedMessagesById.set(message.id, message);
          }
          const hydratedMessages = Array.from(mergedMessagesById.values())
            .sort((left, right) => left.createdAt - right.createdAt);
          if (pendingLocalMessages.length > 0) dirtyCoderThreadIdsRef.current.add(threadId);
          const hydrated = {
            ...(current || {} as CoderThreadSummary),
            ...threadDetail,
            id: threadId,
            title: pendingLocalMessages.length > 0 ? current?.title || threadDetail.title : threadDetail.title,
            updatedAt: Math.max(Number(current?.updatedAt) || 0, detailUpdatedAt),
            messages: hydratedMessages,
            messageCount: hydratedMessages.length,
            messagesLoaded: true,
          } as CoderThreadSummary;
          const remaining = prev.threads.filter((thread) => thread.id !== threadId);
          const next = normalizeCoderThreadState({
            ...prev,
            threads: [hydrated, ...remaining],
          });
          coderThreadStateRef.current = next;
          return next;
        });
        hydratedBackendCoderThreadIdsRef.current.add(threadId);
      } catch (error) {
        console.error(`Failed to load coder chat thread ${threadId}`, error);
      } finally {
        hydratingBackendCoderThreadIdsRef.current.delete(threadId);
      }
    })();
  }, [coderThreadState.activeThreadId, coderThreadState.threads]);

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const dirtyThreadIds = Array.from(dirtyCoderThreadIdsRef.current);
      const activeThreadChanged = lastPersistedCoderActiveThreadIdRef.current !== coderThreadState.activeThreadId;
      if (dirtyThreadIds.length === 0 && !activeThreadChanged) return;

      try {
        window.localStorage.setItem(CODER_CHAT_THREADS_KEY, JSON.stringify(compactCoderThreadState(coderThreadState)));
        lastPersistedCoderActiveThreadIdRef.current = coderThreadState.activeThreadId;
      } catch (error) {
        console.error("Failed to persist coder chat threads", error);
      }

      if (!coderThreadHydratedRef.current || dirtyThreadIds.length === 0) return;

      dirtyCoderThreadIdsRef.current.clear();

      const threadsById = new Map(coderThreadState.threads.map((thread) => [thread.id, thread]));
      const changedThreads = dirtyThreadIds
        .map((threadId) => threadsById.get(threadId))
        .filter((thread): thread is CoderThreadSummary => Boolean(thread && thread.messagesLoaded !== false));
      const waitingForHistory = dirtyThreadIds
        .filter((threadId) => threadsById.get(threadId)?.messagesLoaded === false);
      waitingForHistory.forEach((threadId) => dirtyCoderThreadIdsRef.current.add(threadId));

      if (changedThreads.length === 0) return;

      void Promise.all(
        changedThreads.map(async (thread) => {
          const response = await fetch(`/api/coder/threads/${encodeURIComponent(thread.id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...thread,
              messages: compactCoderThread(thread.messages),
              workspace: workspace.trim() || undefined,
            }),
          });
          if (!response.ok) {
            throw new Error(`Thread ${thread.id} failed to persist (HTTP ${response.status})`);
          }
        })
      ).catch((error) => {
        console.error("Failed to persist coder chat threads to database", error);
        changedThreads.forEach((thread) => dirtyCoderThreadIdsRef.current.add(thread.id));
      });
    }, CODER_THREAD_PERSIST_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [coderThreadState]);

  React.useEffect(() => {
    let mounted = true;

    const loadDefaultWorkspace = async () => {
      const preferredWorkspace = window.localStorage.getItem(PREFERRED_WORKSPACE_KEY);
      if (preferredWorkspace) {
        setWorkspace(preferredWorkspace);
        setWorkspaceRefreshTrigger((prev) => prev + 1);
        return;
      }

      try {
        const res = await fetch("/api/workspace/default");
        const data = await res.json();
        if (mounted && res.ok && data.workspace) {
          updateWorkspace(data.workspace);
          setWorkspaceRefreshTrigger((prev) => prev + 1);
        }
      } catch (error) {
        console.error("Failed to load default target folder", error);
      }
    };

    loadDefaultWorkspace();

    return () => {
      mounted = false;
    };
  }, []);

  React.useEffect(() => {
    if (!workspace.trim()) return;
    setWorkspaceLastRefreshedAt(Date.now());
  }, [workspace, workspaceRefreshTrigger]);

  const updateWorkspace = (nextWorkspace: string) => {
    const normalizedWorkspace = nextWorkspace.trim();
    setWorkspace(normalizedWorkspace);
    if (normalizedWorkspace) {
      window.localStorage.setItem(PREFERRED_WORKSPACE_KEY, normalizedWorkspace);
    } else {
      window.localStorage.removeItem(PREFERRED_WORKSPACE_KEY);
    }
  };

  // Phase 7 - Full-Stack Developer-Agent UI Handlers

  const handleGenerateWorkPlan = async (userRequest: string, affectedFiles: string[] = []) => {
    if (!userRequest.trim()) return;

    try {
      setLoading(true);
      setWorkPlanLoading(true);
      setLiveProgress('Generating work plan...');
      const response = await fetch('/api/workplan/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userRequest, affectedFiles, workspace }),
      });
      if (!response.ok) throw new Error(`Work plan generation failed: ${response.statusText}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const event of events) {
          if (!event.trim()) continue;
          const eventType = event.split('\n').find((line) => line.startsWith('event: '))?.slice(7);
          const dataLine = event.split('\n').find((line) => line.startsWith('data: '));
          if (!eventType || !dataLine) continue;
          try {
            const eventData = JSON.parse(dataLine.slice(6));
            const data = eventData.data || {};
            setLiveProgress(`[${eventType}] ${data.message || JSON.stringify(data).substring(0, 80)}`);
            if (eventType === 'planning-start') {
              setWorkPlan(null);
              setWorkPlanApproved(false);
              setAgentExecutions([]);
              setConflicts([]);
              setDiffs([]);
              setLiveProgress(`Planning: ${data.userRequest || userRequest}`);
            } else if (eventType === 'context-loading') {
              setLiveProgress('Loading repository context...');
            } else if (eventType === 'context-loaded') {
              setLiveProgress(`Loaded ${data.moduleCount || 0} modules, ${data.dependencySignalCount || 0} dependency signals`);
            } else if (eventType === 'plan-created') {
              setLiveProgress(`Work plan created: ${data.classification || 'task'} (${data.complexity || 'unknown'})`);
            } else if (eventType === 'plan-validated') {
              setLiveProgress('Work plan validated');
            } else if (eventType === 'done' && data.plan) {
              const normalizedPlan = normalizeWorkPlanForUi(data.plan);
              setWorkPlan(normalizedPlan);
              setTaskExecutionStatus('pending');
              setLiveProgress('Work plan ready for review');
              void handleLoadRepoMap();
              void handleAnalyzeConflicts(normalizedPlan);
            } else if (eventType === 'error') {
              setLiveProgress(`Error: ${data.error || 'Work plan generation failed'}`);
            }
          } catch (parseError) {
            console.error('Failed to parse work plan event', parseError);
          }
        }
      }
    } catch (error: any) {
      setLiveProgress(`Error: ${error?.message || 'Work plan generation failed'}`);
    } finally {
      setLoading(false);
      setWorkPlanLoading(false);
    }
  };

  const commitWorkspaceChange = async (nextWorkspace: string) => {
    const normalizedWorkspace = nextWorkspace.trim();
    if (!normalizedWorkspace || normalizedWorkspace === workspace.trim()) {
      setPendingWorkspace(null);
      setShowFolderModal(false);
      setShowWorkspaceHome(false);
      return;
    }

    const runId = activeRunIdRef.current;
    if (runId) {
      setLiveProgress("Stopping the active run before switching workspace...");
      try {
        await fetch(`/api/runs/${encodeURIComponent(runId)}/stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "Workspace changed by user." }),
        });
      } catch (error: any) {
        setLiveProgress(`Workspace switch could not stop the active run: ${error.message || String(error)}`);
        return;
      }
    }

    testSuiteQueueRef.current = [];
    testSuiteActiveCaseRef.current = null;
    setActiveTestSuiteCaseId(null);
    setActiveRunId(null);
    activeRunIdRef.current = null;
    setLoading(false);
    setResult(null);
    setLiveState(null);
    setCoderAgentEvents([]);
    setCoderAgentStatus(undefined);
    setCoderTaskAnalysis(null);
    setWorkPlan(null);
    setWorkPlanApproved(false);
    setWorkPlanLoading(false);
    setAgentExecutions([]);
    setConflicts([]);
    setDiffs([]);
    setRepoMap(null);
    setTaskExecutionStatus('pending');
    setWorkspaceFileChanges({});
    setStructureDirty(false);
    updateWorkspace(normalizedWorkspace);
    setWorkspaceRefreshTrigger((value) => value + 1);
    setPendingWorkspace(null);
    setShowFolderModal(false);
    setShowWorkspaceHome(false);
    setLiveProgress(`Workspace changed to ${normalizedWorkspace}. Workspace maps and run-scoped results were reset.`);
  };

  const handleWorkspaceSelection = (nextWorkspace: string) => {
    const normalizedWorkspace = nextWorkspace.trim();
    if (!normalizedWorkspace || normalizedWorkspace === workspace.trim()) return;

    const hasActiveRun = Boolean(activeRunIdRef.current || loading || testSuiteActiveCaseRef.current);
    const hasWorkspaceArtifacts = Boolean(result?.outputFiles?.length || Object.keys(workspaceFileChanges).length);
    if (hasActiveRun || structureDirty || hasWorkspaceArtifacts) {
      setPendingWorkspace(normalizedWorkspace);
      setShowFolderModal(false);
      return;
    }

    void commitWorkspaceChange(normalizedWorkspace);
  };

  const openWorkspaceFromHome = (nextWorkspace: string) => {
    const normalizedWorkspace = nextWorkspace.trim();
    if (!normalizedWorkspace) return;
    if (normalizedWorkspace === workspace.trim()) {
      setShowWorkspaceHome(false);
      return;
    }
    handleWorkspaceSelection(normalizedWorkspace);
  };

  const handleApproveWorkPlan = () => {
    setWorkPlanApproved(true);
    setTaskExecutionStatus('approved');
    void handleLoadRepoMap();
    void handleAnalyzeConflicts(workPlan || undefined);
  };

  const handleRejectWorkPlan = () => {
    setWorkPlan(null);
    setWorkPlanApproved(false);
    setAgentExecutions([]);
    setConflicts([]);
    setDiffs([]);
    setTaskExecutionStatus('pending');
  };

  /**
   * Stream agent execution updates from the backend
   * Phase 7.1 Task 2: Agent Execution Tracking
   */
  const handleExecuteAgentTask = async (taskId: string, agentRole: string, userRequest: string, ownedFiles: string[]): Promise<AgentTaskExecution | null> => {
    if (!taskId || !agentRole || !userRequest) {
      console.warn('Missing required fields for agent execution');
      return null;
    }

    try {
      setTaskExecutionStatus('executing');
      setLiveProgress(`Starting ${agentRole} execution...`);

      const response = await fetch('/api/agents/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          taskId,
          agentRole,
          userRequest,
          ownedFiles,
          workspace,
          model,
          allowCrossProviderFallback,
          approvedFallbackProviders: [],
          fallbackApprovalGranted: allowCrossProviderFallback,
        })
      });

      if (!response.ok) {
        throw new Error(`Agent execution failed: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      const execution: AgentTaskExecution = {
        taskId,
        agentRole,
        status: 'executing',
        progress: 0,
        outputs: { changedFiles: [], commandsRun: [], errors: [], warnings: [] },
        errors: [],
        confidence: 0,
        attemptNumber: 1,
        lastUpdatedAt: Date.now(),
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const event of events) {
          if (!event.trim()) continue;
          const eventType = event.split('\n').find((line) => line.startsWith('event: '))?.slice(7);
          const dataLine = event.split('\n').find((line) => line.startsWith('data: '));

          if (eventType && dataLine) {
            try {
              const eventData = JSON.parse(dataLine.slice(6));
                
                // Handle specific event types
                switch (eventType) {
                  case 'task-assigned':
                    setLiveProgress(`${agentRole} assigned to task: ${userRequest}`);
                    execution.status = 'assigned';
                    break;

                  case 'execution-start':
                    setLiveProgress(`${agentRole} starting execution...`);
                    execution.status = 'executing';
                    execution.progress = 0;
                    break;

                  case 'file-change':
                    if (!execution.outputs.changedFiles) {
                      execution.outputs.changedFiles = [];
                    }
                    execution.outputs.changedFiles.push(eventData.data.file);
                    setLiveProgress(`Modified: ${eventData.data.file} (+${eventData.data.linesAdded}/-${eventData.data.linesRemoved})`);
                    break;

                  case 'command-executed':
                    if (!execution.outputs.commandsRun) {
                      execution.outputs.commandsRun = [];
                    }
                    execution.outputs.commandsRun.push(eventData.data.command);
                    setLiveProgress(`Executed: ${eventData.data.command} (${eventData.data.duration}ms)`);
                    break;

                  case 'progress-update':
                    execution.progress = eventData.data.progress;
                    setLiveProgress(`${agentRole} progress: ${eventData.data.progress}% - ${eventData.data.message}`);
                    break;

                  case 'verification-start':
                    setLiveProgress(`${agentRole} verifying changes... (${eventData.data.checksCount} checks)`);
                    break;

                  case 'verification-complete':
                    execution.outputs.verificationResults = Array.isArray(eventData.data.results)
                      ? eventData.data.results
                      : [];
                    execution.verification = {
                      status: Number(eventData.data.checksFailed || 0) > 0 ? 'failed' : 'passed',
                      checks: execution.outputs.verificationResults,
                    };
                    if (Number(eventData.data.checksFailed || 0) > 0 || execution.outputs.verificationResults.some((check) => check.passed === false && !check.skipped)) {
                      execution.status = 'verification-failed';
                    }
                    setLiveProgress(`Verification complete: ${eventData.data.checksPassed}/${eventData.data.checksTotal} passed`);
                    break;

                  case 'error':
                    if (!execution.errors) {
                      execution.errors = [];
                    }
                    execution.errors.push(eventData.data.error);
                    setLiveProgress(`Error: ${eventData.data.error}`);
                    break;

                  case 'completion':
                    execution.status = eventData.data.status === 'failed'
                      ? 'failed'
                      : execution.status === 'verification-failed'
                        ? 'verification-failed'
                        : 'completed';
                    execution.progress = 100;
                    execution.confidence = eventData.data.summary?.confidenceScore || 0.95;
                    if (eventData.data.summary?.error && !execution.errors.includes(eventData.data.summary.error)) {
                      execution.errors.push(eventData.data.summary.error);
                    }
                    setLiveProgress(execution.status === 'failed'
                      ? `${agentRole} failed: ${eventData.data.summary?.error || 'execution did not complete successfully'}`
                      : `${agentRole} completed successfully (${eventData.data.summary?.executionTimeMs}ms)`);
                    break;

                  case 'done':
                    if (eventData.data?.result?.success === false || execution.errors.length > 0) {
                      execution.status = 'failed';
                    } else if (execution.status !== 'failed' && execution.status !== 'verification-failed') {
                      execution.status = 'completed';
                    }
                    execution.lastUpdatedAt = Date.now();
                    setAgentExecutions(prev => {
                      const updated = [...prev];
                      const index = updated.findIndex(e => e.taskId === taskId);
                      if (index >= 0) {
                        updated[index] = execution;
                      } else {
                        updated.push(execution);
                      }
                      return updated;
                    });
                    setLiveProgress(execution.status === 'failed'
                      ? `${agentRole} execution finished with errors`
                      : `${agentRole} execution finished`);
                    if (eventData.runId) {
                      void fetch(`/api/runs/${encodeURIComponent(eventData.runId)}/seen`, { method: "POST" }).catch(() => undefined);
                    }
                    break;
                }

                // Update executions after each event
                execution.lastUpdatedAt = Date.now();
                if (eventType !== 'done') {
                  setAgentExecutions(prev => {
                    const updated = [...prev];
                    const index = updated.findIndex(e => e.taskId === taskId);
                    if (index >= 0) {
                      updated[index] = { ...execution };
                    } else {
                      updated.push({ ...execution });
                    }
                    return updated;
                  });
                }
            } catch (e) {
              console.error('Failed to parse event data', e);
            }
          }
        }
      }
      return { ...execution };
    } catch (error: any) {
      console.error('Agent execution failed:', error);
      setLiveProgress(`Error: ${error.message}`);
      setTaskExecutionStatus('failed');
      throw error;
    }
  };

  /**
   * Load repository map structure
   * Phase 7.1 Task 3: Real Repo Map Generation
   */
  const handleLoadRepoMap = async () => {
    try {
      setLiveProgress('Loading repository map...');

      const response = await fetch('/api/repo/map', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          workspace
        })
      });

      if (!response.ok) {
        throw new Error(`Repo map loading failed: ${response.statusText}`);
      }

      const { data: repoMap } = await response.json();

      if (repoMap) {
        setRepoMap(repoMap);
        const frontendCount = [
          ...(repoMap.frontend?.components || []),
          ...(repoMap.frontend?.pages || []),
          ...(repoMap.frontend?.utilities || []),
          ...(repoMap.frontend?.modules || []),
        ].length;
        const backendCount = [
          ...(repoMap.backend?.apiRoutes || []),
          ...(repoMap.backend?.services || []),
          ...(repoMap.backend?.dataLayer || []),
          ...(repoMap.backend?.tools || []),
          ...(repoMap.backend?.modules || []),
        ].length;
        setLiveProgress(`Repository map loaded: ${
          frontendCount
        } frontend items, ${
          backendCount
        } backend items`);
      }
    } catch (error: any) {
      console.error('Repo map loading failed:', error);
      setLiveProgress(`Error loading repo map: ${error.message}`);
    }
  };

  /**
   * Phase 7.1 Task 4: Conflict Detection Integration
   */
  const handleAnalyzeConflicts = async (workPlanData?: FullStackWorkPlan) => {
    try {
      setLiveProgress('Analyzing conflicts...');

      const planToAnalyze = workPlanData || workPlan;
      if (!planToAnalyze) {
        throw new Error('No work plan available for conflict analysis');
      }
      const ownershipPlan = (planToAnalyze.fileOwnership || []).map((ownership) => ({
        path: ownership.file,
        owner: ownership.owner,
        layer: inferLayerForFile(ownership.file),
        readOnly: false,
      }));

      const response = await fetch('/api/conflicts/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          workPlan: {
            userRequest: planToAnalyze.userRequest || '',
            affectedFiles: planToAnalyze.affectedFiles || [],
            ownershipPlan,
            taskId: planToAnalyze.id
          },
          workspace
        })
      });

      if (!response.ok) {
        throw new Error(`Conflict analysis failed: ${response.statusText}`);
      }

      // Parse SSE stream
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const detectedConflicts: ConflictWarning[] = [];
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += new TextDecoder().decode(value);
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const event of events) {
          if (!event.trim()) continue;

          const lines = event.split('\n');
          let eventType = '';
          let eventData = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.substring(7);
            } else if (line.startsWith('data: ')) {
              eventData = line.substring(6);
            }
          }

          if (eventType && eventData) {
            const data = JSON.parse(eventData);

            if (eventType === 'analysis-start') {
              setLiveProgress('Starting conflict analysis...');
            } else if (eventType === 'checking-file-overlaps') {
              setLiveProgress(`Checking ${data.filesChecked} files for overlaps...`);
            } else if (eventType === 'checking-ownership') {
              setLiveProgress(`Checking ownership across ${data.ownersChecked} agents...`);
            } else if (eventType === 'checking-dependencies') {
              setLiveProgress(`Checking ${data.layersAffected} affected layers...`);
            } else if (eventType === 'conflicts-found') {
              // Convert detected conflicts to UI format
              const conflicts = [
                ...(data.conflicts.fileOverlap || []).map((c: any) => ({
                  type: 'file-conflict' as const,
                  severity: c.severity === 'critical' ? 'critical' as const : 'warning' as const,
                  files: c.affectedFiles,
                  agents: c.conflictingAgents || [],
                  description: c.description
                })),
                ...(data.conflicts.ownership || []).map((c: any) => ({
                  type: 'ownership-conflict' as const,
                  severity: 'critical' as const,
                  files: c.affectedFiles,
                  agents: c.conflictingAgents || [],
                  description: c.description
                })),
                ...(data.conflicts.dependency || []).map((c: any) => ({
                  type: 'dependency-conflict' as const,
                  severity: c.severity === 'critical' ? 'critical' as const : 'warning' as const,
                  files: c.affectedFiles,
                  agents: c.conflictingAgents || [],
                  description: c.description
                }))
              ];
              setConflicts(conflicts);
              
              if (data.summary.hasConflicts) {
                setLiveProgress(
                  `Found ${data.summary.totalConflicts} conflict(s): ${
                    data.summary.criticalConflicts
                  } critical. Recommended action: ${data.summary.canProceed ? 'Review' : 'Abort'}`
                );
              } else {
                setLiveProgress('No conflicts detected - safe to proceed');
              }
            } else if (eventType === 'analysis-complete') {
              setLiveProgress(
                `Conflict analysis complete. ${data.summary.fileOverlapCount} file overlaps, ` +
                `${data.summary.ownershipConflictCount} ownership conflicts, ` +
                `${data.summary.dependencyConflictCount} dependency conflicts`
              );
            } else if (eventType === 'error') {
              throw new Error(data.error || 'Unknown error during conflict analysis');
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Conflict analysis failed:', error);
      setLiveProgress(`Error analyzing conflicts: ${error.message}`);
    }
  };

  const createAgentTasksFromWorkPlan = (plan: FullStackWorkPlan): BoundedAgentTask[] => {
    const ownershipByRole = new Map<BoundedAgentTask["agentRole"], string[]>();

    for (const ownership of plan.fileOwnership || []) {
      const role = normalizeAgentRole(ownership.owner);
      const files = ownershipByRole.get(role) || [];
      files.push(ownership.file);
      ownershipByRole.set(role, Array.from(new Set(files)));
    }

    if (ownershipByRole.size === 0) {
      for (const layer of plan.touchedLayers || ["backend"]) {
        const role = normalizeAgentRole(layer);
        ownershipByRole.set(role, plan.affectedFiles || []);
      }
    }

    return Array.from(ownershipByRole.entries()).map(([agentRole, ownedFiles], index) => ({
      id: `${plan.id}-${agentRole}-${index + 1}`,
      agentRole,
      userRequest: plan.userRequest,
      classification: plan.classification,
      complexity: plan.estimatedComplexity,
      ownedFiles,
      touchedLayers: Array.from(new Set((ownedFiles.length ? ownedFiles : plan.affectedFiles).map(inferLayerForFile))),
      allowedTools: ["read", "edit", "shell", "test"],
      createdAt: Date.now(),
      priority: plan.safetyScore < 50 ? "critical" : plan.estimatedComplexity === "complex" || plan.estimatedComplexity === "expert" ? "high" : "medium",
    }));
  };

  const buildDiffsFromExecutions = (executions: AgentTaskExecution[]): DiffSummary[] => {
    const layerMap = new Map<ExecutionLayer, Set<string>>();

    for (const execution of executions) {
      for (const file of execution.outputs.changedFiles || []) {
        const layer = inferLayerForFile(file);
        if (!layerMap.has(layer)) layerMap.set(layer, new Set());
        layerMap.get(layer)!.add(file);
      }
    }

    return Array.from(layerMap.entries()).map(([layer, files]) => {
      const fileList = Array.from(files);
      const riskLevel = fileList.length > 8 ? "high" : fileList.length > 3 ? "medium" : "low";
      return {
        layer,
        filesChanged: fileList,
        linesAdded: fileList.length * 12,
        linesRemoved: fileList.length * 4,
        riskLevel,
      };
    });
  };

  const handleStartExecution = async () => {
    if (!workPlan) {
      setLiveProgress("Generate and approve a work plan before starting execution.");
      return;
    }

    setTaskExecutionStatus('executing');
    setAgentExecutions([]);
    setDiffs([]);

    const tasks = createAgentTasksFromWorkPlan(workPlan);
    if (tasks.length === 0) {
      setTaskExecutionStatus('failed');
      setLiveProgress('No executable agent tasks were derived from the work plan.');
      return;
    }

    try {
      const completedExecutions: AgentTaskExecution[] = [];
      if (workPlan.canRunParallel) {
        const results = await Promise.all(tasks.map((agentTask) =>
          handleExecuteAgentTask(agentTask.id, agentTask.agentRole, agentTask.userRequest, agentTask.ownedFiles)
        ));
        completedExecutions.push(...results.filter(Boolean) as AgentTaskExecution[]);
      } else {
        for (const agentTask of tasks) {
          const result = await handleExecuteAgentTask(agentTask.id, agentTask.agentRole, agentTask.userRequest, agentTask.ownedFiles);
          if (result) completedExecutions.push(result);
        }
      }

      const verificationTargets = completedExecutions.length > 0
        ? completedExecutions
        : tasks.map((agentTask) => ({
            taskId: agentTask.id,
            agentRole: agentTask.agentRole,
            status: 'completed' as const,
            progress: 100,
            outputs: { changedFiles: agentTask.ownedFiles, commandsRun: [], errors: [], warnings: [] },
            errors: [],
            confidence: 0.9,
            attemptNumber: 1,
          }));

      setDiffs(buildDiffsFromExecutions(verificationTargets as AgentTaskExecution[]));
      const failedExecutions = completedExecutions.filter((execution) => execution.status === 'failed' || execution.status === 'verification-failed');
      if (failedExecutions.length > 0) {
        setTaskExecutionStatus('failed');
        setLiveProgress(`${failedExecutions.length}/${completedExecutions.length} agent executions failed.`);
      } else {
        setTaskExecutionStatus('completed');
        setLiveProgress('Agent execution and verification completed.');
      }
    } catch (error: any) {
      setTaskExecutionStatus('failed');
      setLiveProgress(`Agent execution failed: ${error.message || String(error)}`);
    }
  };

  const handlePauseExecution = () => {
    setTaskExecutionStatus('paused');
  };

  const handleResumeExecution = () => {
    setTaskExecutionStatus('executing');
  };

  const handleNarrowScope = (excludedLayers: string[], excludedFiles: string[]) => {
    console.log('Narrowing scope with:', { excludedLayers, excludedFiles });
    setTaskExecutionStatus('executing');
  };

  const handleResolveConflict = (conflictIndex: number, resolution: string) => {
    console.log(`Resolving conflict ${conflictIndex} with: ${resolution}`);
    setConflicts(conflicts.filter((_, idx) => idx !== conflictIndex));
  };

  const addCoderThreadMessage = (
    message: Omit<CoderThreadMessage, "id" | "createdAt">,
    targetThreadId?: string | null,
  ): string => {
    const threadId = targetThreadId || coderThreadStateRef.current.activeThreadId || createCoderThreadId();
    setCoderThreadState((prev) => {
      const now = Date.now();
      const nextMessage: CoderThreadMessage = {
        ...message,
        id: createCoderThreadId(),
        createdAt: now,
      };
      const activeThread = prev.threads.find((thread) => thread.id === threadId) || {
        ...createEmptyCoderThread(),
        id: threadId,
      };
      const nextMessages = [...activeThread.messages, nextMessage];
      const nextThread: CoderThreadSummary = {
        ...activeThread,
        messages: nextMessages,
        title: getCoderThreadTitle(nextMessages),
        updatedAt: now,
      };
      dirtyCoderThreadIdsRef.current.add(nextThread.id);
      const remaining = prev.threads.filter((thread) => thread.id !== nextThread.id);
      const nextState = normalizeCoderThreadState({
        threads: [nextThread, ...remaining],
        activeThreadId: prev.activeThreadId || nextThread.id,
      });
      coderThreadStateRef.current = nextState;
      return nextState;
    });
    return threadId;
  };

  const upsertCoderThreadRunMessage = (
    runId: string,
    message: Omit<CoderThreadMessage, "id" | "createdAt" | "runId">,
    targetThreadId?: string | null,
  ) => {
    const threadId = targetThreadId || coderThreadStateRef.current.activeThreadId || createCoderThreadId();
    setCoderThreadState((prev) => {
      const now = Date.now();
      const activeThread = prev.threads.find((thread) => thread.id === threadId) || {
        ...createEmptyCoderThread(),
        id: threadId,
      };
      const existingIndex = activeThread.messages.findIndex((item) => item.runId === runId && item.role !== "user");
      const nextMessage: CoderThreadMessage = {
        ...message,
        runId,
        id: existingIndex >= 0 ? activeThread.messages[existingIndex].id : createCoderThreadId(),
        createdAt: existingIndex >= 0 ? activeThread.messages[existingIndex].createdAt : now,
      };
      const nextMessages = existingIndex >= 0
        ? activeThread.messages.map((item, index) => index === existingIndex ? nextMessage : item)
        : [...activeThread.messages, nextMessage];
      const nextThread: CoderThreadSummary = {
        ...activeThread,
        messages: nextMessages,
        title: getCoderThreadTitle(nextMessages),
        updatedAt: now,
      };
      dirtyCoderThreadIdsRef.current.add(nextThread.id);
      const remaining = prev.threads.filter((thread) => thread.id !== nextThread.id);
      const nextState = normalizeCoderThreadState({
        threads: [nextThread, ...remaining],
        activeThreadId: prev.activeThreadId || nextThread.id,
      });
      coderThreadStateRef.current = nextState;
      return nextState;
    });
  };

  const handleNewCoderThread = () => {
    const nextThread = createEmptyCoderThread();
    dirtyCoderThreadIdsRef.current.add(nextThread.id);
    setCoderThreadState((prev) =>
      normalizeCoderThreadState({
        threads: [nextThread, ...prev.threads],
        activeThreadId: nextThread.id,
      })
    );
    setResult(null);
    setLiveProgress("");
    setLiveState(null);
    setPendingPolicyApproval(null);
    setCoderAgentEvents([]);
    setCoderAgentStatus(undefined);
    setCoderTaskAnalysis(null);
    setTask("");
  };

  const handleSelectCoderThread = (threadId: string) => {
    setCoderThreadState((prev) => normalizeCoderThreadState({ ...prev, activeThreadId: threadId }));
    setResult(null);
    setLiveProgress("");
    setLiveState(null);
    setCoderAgentEvents([]);
    setCoderAgentStatus(undefined);
    setCoderTaskAnalysis(null);
    setTask("");
  };

  const handleDeleteCoderThread = (threadId: string) => {
    setCoderThreadState((prev) =>
      normalizeCoderThreadState({
        threads: prev.threads.filter((thread) => thread.id !== threadId),
        activeThreadId: prev.activeThreadId === threadId ? null : prev.activeThreadId,
      })
    );
    void fetch(`/api/coder/threads/${encodeURIComponent(threadId)}`, { method: "DELETE" }).catch((error) => {
      console.error("Failed to delete coder chat thread from database", error);
    });
    setResult(null);
    setLiveProgress("");
    setLiveState(null);
    setCoderAgentEvents([]);
    setCoderAgentStatus(undefined);
    setCoderTaskAnalysis(null);
    setTask("");
  };

  const handleRenameCoderThread = async (threadId: string, title: string) => {
    const response = await fetch(`/api/coder/threads/${encodeURIComponent(threadId)}/title`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) throw new Error(`Thread rename failed (HTTP ${response.status})`);
    const data = await response.json();
    const normalizedTitle = sanitizeCoderThreadTitle(data?.thread?.title || title);
    const updatedAt = Number(data?.thread?.updatedAt) || Date.now();
    dirtyCoderThreadIdsRef.current.add(threadId);
    setCoderThreadState((prev) => normalizeCoderThreadState({
      ...prev,
      threads: prev.threads.map((thread) => thread.id === threadId
        ? { ...thread, title: normalizedTitle, updatedAt }
        : thread),
    }));
  };

  const checkPollenBalance = async () => {
    setCheckingPollen(true);
    setPollenStatus(null);
    try {
      const res = await fetch("/api/pollinations/balance");
      if (res.ok) {
        const data = await res.json();
        setPollenStatus(data);
      } else {
        setPollenStatus({
          hasKey: false,
          pollen: null,
          error: "HTTP error " + res.status,
        });
      }
    } catch (e: any) {
      setPollenStatus({
        hasKey: false,
        pollen: null,
        error: e.message || "Verification request failed",
      });
    } finally {
      setCheckingPollen(false);
    }
  };

  React.useEffect(() => {
    checkPollenBalance();
  }, []);

  React.useEffect(() => {
    let mounted = true;
    const checkMcp = async () => {
      try {
        const res = await fetch("/api/mcp-status");
        const data = await res.json();
        if (mounted) setMcpConnected(!!data.connected);
      } catch (e) {
        if (mounted) setMcpConnected(false);
      }
    };
    checkMcp();
    const interval = setInterval(checkMcp, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const loadDirectories = async (path: string = "", baseWorkspace?: string) => {
    setFsLoading(true);
    setFsError("");
    setRootError("");
    try {
      const params = new URLSearchParams();
      params.append('path', path);
      if (baseWorkspace) {
        params.append('workspace', baseWorkspace);
      }
      const res = await fetch(
        `/api/directories?${params.toString()}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to open directory");
      setFsPath(data.path);
      setFsParent(data.parent);
      setFsDirectories(data.directories || []);
    } catch (e: any) {
      console.error(e);
      setFsError(e.message);
    } finally {
      setFsLoading(false);
    }
  };

  const loadRootDirectories = async () => {
    setRootLoading(true);
    setRootError("");
    setFsLoading(true);
    try {
      const res = await fetch('/api/directory-roots');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load local roots');
      setFsPath('');
      setFsParent(null);
      setFsDirectories(data.roots || []);
    } catch (e: any) {
      console.error(e);
      setRootError(e.message);
      setFsDirectories([]);
    } finally {
      setRootLoading(false);
      setFsLoading(false);
    }
  };

  const openFolderModal = () => {
    setShowFolderModal(true);
    if (workspace.trim()) {
      loadDirectories("", workspace);
    } else {
      loadRootDirectories();
    }
  };

  const analyzeCoderRequest = async (submittedTask: string): Promise<CoderAnalyzeResponse> => {
    const response = await fetch("/api/coder/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: submittedTask,
        mode: coderMode,
        approvalPolicy: coderApprovalMode,
        workspace: workspace.trim() || undefined,
        threadId: coderThreadState.activeThreadId || undefined,
        thread: compactCoderThread(coderThread),
      }),
    });
    const data = (await response.json().catch(() => ({}))) as CoderAnalyzeResponse;
    if (!response.ok) throw new Error(data.error || "Coder task analysis failed.");
    return data;
  };

  const executeCoderTask = async (
    submittedTask: string,
    displayContent = submittedTask,
    analysis?: CoderTaskAnalysis | null,
    continuationHandoff?: ContinuationHandoff,
    images?: CoderImageAttachment[],
    requestedThreadId?: string | null,
    selectedModel?: string,
  ) => {
    const targetThreadId = requestedThreadId || coderThreadState.activeThreadId || createCoderThreadId();
    const threadForPrompt = coderThreadState.threads.find((thread) => thread.id === targetThreadId)?.messages || coderThread;
    // A continuation already carries a bounded handoff plus durable run
    // evidence. Re-attaching the full chat-memory envelope here duplicated the
    // original request and inflated prompts on single-slot llama.cpp servers.
    const taskWithThreadMemory = continuationHandoff
      ? submittedTask
      : buildCoderThreadMemoryPrompt(
          submittedTask,
          threadForPrompt,
          workspace.trim() || undefined,
          submittedTask,
        );

    addCoderThreadMessage({
      role: "user",
      status: "running",
      content: displayContent,
      images: images?.length ? images : undefined,
    }, targetThreadId);
    return await streamReactPrompt(taskWithThreadMemory, true, DEFAULT_REACT_TURN_WINDOW, {
      trackCoderThread: true,
      threadId: targetThreadId,
      stopMessage: "Coder Chat process stopped by user.",
      displayTask: submittedTask,
      taskAnalysis: analysis,
      approvalPolicy: coderApprovalMode,
      continuationHandoff,
      selectedModel,
      selectedGeminiProfileId: selectedModel?.startsWith('gemini') ? geminiProfileId : undefined,
    });
  };

  const handleRunCoderTask = async (options?: { task?: string; images?: CoderImageAttachment[] }) => {
    const submittedTask = (options?.task !== undefined ? options.task : task).trim();
    const submittedImages = options?.images || [];
    if (!submittedTask && submittedImages.length === 0) return;

    const displayTask = submittedTask || `[Attached ${submittedImages.length} image${submittedImages.length > 1 ? 's' : ''}]`;
    const imagePayloads = submittedImages.map((img) => ({
      url: img.url,
      mimeType: img.mimeType || 'image/png',
      name: img.name,
      size: img.size,
    }));
    const targetThreadId = coderThreadState.activeThreadId || createCoderThreadId();

    if (coderMode === "agent") {
      setCoderTaskAnalysis(null);
      const fullTask = imagePayloads.length > 0
        ? `${displayTask}\n\n${imagePayloads.map((img, i) => `![${img.name || `Image ${i + 1}`}](${img.url})`).join('\n')}`
        : displayTask;
      await executeCoderTask(fullTask, displayTask, null, undefined, submittedImages, targetThreadId);
      return;
    }

    const threadForResponse = coderThreadState.threads.find((thread) => thread.id === targetThreadId)?.messages || coderThread;
    addCoderThreadMessage({
      role: "user",
      content: displayTask,
      images: submittedImages.length > 0 ? submittedImages : undefined,
    }, targetThreadId);
    setLoading(true);
    setResult(null);
    setLiveProgress("Thinking...");
    setLiveState(null);

    try {
      const response = await fetch("/api/coder/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: submittedTask || (submittedImages.length ? 'Attached image(s)' : ''),
          images: imagePayloads.length > 0 ? imagePayloads : undefined,
          thread: compactCoderThread(threadForResponse),
          threadId: targetThreadId,
          model,
          geminiProfileId: model.startsWith('gemini') ? geminiProfileId || undefined : undefined,
          mode: coderMode,
          approvalPolicy: coderApprovalMode,
          workspace: workspace.trim() || undefined,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as CoderRespondResponse;
      if (!response.ok) throw new Error(data.error || "Coder Chat response failed.");
      if (data.analysis) setCoderTaskAnalysis(data.analysis);

      if (data.mode === "execute") {
        setLoading(false);
        setLiveProgress("");
        addCoderThreadMessage({
          role: "assistant",
          content: data.reason || "Routing this request to the workspace agent.",
        }, targetThreadId);
        const promptToRun = imagePayloads.length > 0
          ? `${data.executionTask || submittedTask}\n\n${imagePayloads.map((img, i) => `![${img.name || `Image ${i + 1}`}](${img.url})`).join('\n')}`
          : (data.executionTask || submittedTask);
        await streamReactPrompt(
          buildCoderThreadMemoryPrompt(
            promptToRun,
            threadForResponse,
            workspace.trim() || undefined,
            data.executionTask || displayTask,
          ),
          true,
          DEFAULT_REACT_TURN_WINDOW,
          {
            trackCoderThread: true,
            threadId: targetThreadId,
            stopMessage: "Coder Chat process stopped by user.",
            displayTask: data.executionTask || displayTask,
            taskAnalysis: data.analysis || null,
            approvalPolicy: coderApprovalMode,
          }
        );
        return;
      }

      addCoderThreadMessage({
        role: "assistant",
        status: "success",
        content: data.reply || "I can help. What would you like to know or do?",
        reasoningSummary: data.reasoningSummary,
      }, targetThreadId);
    } catch (error: any) {
      addCoderThreadMessage({
        role: "assistant",
        status: "error",
        content: error.message || "Coder Chat response failed.",
      }, targetThreadId);
    } finally {
      setLoading(false);
      setLiveProgress("");
      setLiveState(null);
    }
  };

  const handleProceedFromThread = async () => {
    if (loading) return;
    const submittedTask = "yes please";
    try {
      const continuation = await analyzeCoderRequest(submittedTask);
      const parentRunId = lastRunIdRef.current;
      const continuationHandoff = parentRunId ? createContinuationHandoff({
        parentRunId,
        reason: "conversational_confirmation",
        includesParentSteps: false,
        state: result?.resumeState || {
          task: continuation.analysis.userRequest || submittedTask,
          plan: result?.plan || [],
          steps: result?.steps || [],
          blockedReason: result?.error,
        },
      }) : undefined;
      setCoderTaskAnalysis(null);
      await executeCoderTask(continuation.analysis.userRequest || submittedTask, submittedTask, null, continuationHandoff);
    } catch (error: any) {
      setCoderTaskAnalysis(null);
      addCoderThreadMessage({
        role: "assistant",
        status: "error",
        content: error.message || "The prior task could not be identified.",
      });
    }
  };

  const handleStopCoderTask = () => {
    const runId = activeRunIdRef.current;
    if (!runId) {
      setLiveProgress("No active server run to stop.");
      return;
    }
    setLiveProgress("Stopping current Coder Chat process...");
    void fetch(`/api/runs/${encodeURIComponent(runId)}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Coder Chat process stopped by user." }),
    }).catch((error) => {
      setLiveProgress(`Failed to stop run: ${error.message || String(error)}`);
    });
  };

  const updateTestSuiteRun = (testId: string, update: Partial<TestSuiteRunRecord>) => {
    setTestSuiteRuns((current) => ({
      ...current,
      [testId]: { ...(current[testId] || { status: 'not_run' as TestSuiteStatus }), ...update },
    }));
  };

  const runTestSuiteCase = async (testCase: TestSuiteCase, fromQueue = false) => {
    if (testSuiteActiveCaseRef.current || activeRunIdRef.current || loading) return;
    if (!fromQueue) testSuiteQueueRef.current = [];

    const startedAt = Date.now();
    const threadId = `test-suite-${testCase.id}-${startedAt}`;
    testSuiteActiveCaseRef.current = testCase.id;
    setActiveTestSuiteCaseId(testCase.id);
    updateTestSuiteRun(testCase.id, {
      status: 'running',
      modelName: testCase.modelName || model,
      startedAt,
      finishedAt: undefined,
      durationMs: undefined,
      error: undefined,
    });

    try {
      const execution = await executeCoderTask(
        `[Test Suite] ${testCase.title}\n\n${testCase.prompt}`,
        `Test Suite: ${testCase.title}`,
        null,
        undefined,
        undefined,
        threadId,
        testCase.modelName,
      );
      const finishedAt = Date.now();
      const result = execution.result;
      const output = collectTestSuiteOutput(execution.events || []);
      const status: TestSuiteStatus = !result
        ? 'blocked'
        : result.success
          ? 'passed'
          : isTimedOutResult(result)
            ? 'timed_out'
            : result.errorCode === 'USER_STOPPED' || result.errorCode === 'RUN_INTERRUPTED' || result.errorCode === 'RUN_KILLED'
              ? 'cancelled'
              : 'failed';
      updateTestSuiteRun(testCase.id, {
        status,
        runId: execution.runId || undefined,
        finishedAt,
        durationMs: finishedAt - startedAt,
        summary: result?.finalAnswer || result?.error || (status === 'blocked' ? 'The run paused before a terminal result was recorded.' : undefined),
        error: result?.success ? undefined : result?.error,
        filesChanged: result?.outputFiles || [],
        events: execution.events,
        stdout: output.stdout || undefined,
        stderr: output.stderr || undefined,
        verificationStatus: result?.verificationStatus,
        stepCount: result?.stepCount,
        pollenCost: result?.pollenCost,
      });
    } catch (error: any) {
      const finishedAt = Date.now();
      updateTestSuiteRun(testCase.id, {
        status: 'failed',
        finishedAt,
        durationMs: finishedAt - startedAt,
        error: error.message || 'Test case failed before the run was started.',
        summary: error.message || 'Test case failed before the run was started.',
      });
    } finally {
      testSuiteActiveCaseRef.current = null;
      setActiveTestSuiteCaseId(null);
      const nextId = testSuiteQueueRef.current.shift();
      if (nextId) {
        const nextCase = testSuiteCases.find((candidate) => candidate.id === nextId);
        if (nextCase) {
          window.setTimeout(() => void runTestSuiteCase(nextCase, true), 0);
        }
      }
    }
  };

  const handleRunAllTestSuiteCases = () => {
    if (testSuiteActiveCaseRef.current || activeRunIdRef.current || loading || testSuiteCases.length === 0) return;
    testSuiteQueueRef.current = testSuiteCases.map((testCase) => testCase.id);
    testSuiteCases.forEach((testCase) => updateTestSuiteRun(testCase.id, {
      status: 'queued',
      runId: undefined,
      error: undefined,
      stdout: undefined,
      stderr: undefined,
      events: undefined,
    }));
    const firstId = testSuiteQueueRef.current.shift();
    const firstCase = testSuiteCases.find((testCase) => testCase.id === firstId);
    if (firstCase) void runTestSuiteCase(firstCase, true);
  };

  const handleRetryFailedTestSuiteCases = () => {
    if (testSuiteActiveCaseRef.current || activeRunIdRef.current || loading) return;
    const retryableStatuses = new Set<TestSuiteStatus>(['failed', 'timed_out', 'blocked']);
    const retryableCases = testSuiteCases.filter((testCase) => retryableStatuses.has(testSuiteRuns[testCase.id]?.status || 'not_run'));
    if (retryableCases.length === 0) return;
    testSuiteQueueRef.current = retryableCases.map((testCase) => testCase.id);
    retryableCases.forEach((testCase) => updateTestSuiteRun(testCase.id, {
      status: 'queued',
      runId: undefined,
      error: undefined,
      stdout: undefined,
      stderr: undefined,
      events: undefined,
    }));
    const firstId = testSuiteQueueRef.current.shift();
    const firstCase = testSuiteCases.find((testCase) => testCase.id === firstId);
    if (firstCase) void runTestSuiteCase(firstCase, true);
  };

  const handleStopTestSuite = () => {
    testSuiteQueueRef.current = [];
    handleStopCoderTask();
  };

  const handleOpenTestSuiteCase = (testCase: TestSuiteCase) => {
    setTask(testCase.prompt);
    setActiveTab('coder');
  };

  const handleOpenAuditThread = (threadId: string, runId?: string) => {
    if (!threadId) return;
    handleSelectCoderThread(threadId);
    if (runId) lastRunIdRef.current = runId;
    setSelectedAuditRunId(null);
    setActiveTab('coder');
  };

  const handleOpenTestSuiteAudit = (runId?: string) => {
    if (!runId) return;
    setSelectedAuditRunId(runId);
    setActiveTab('audits');
    setWorkspaceRefreshTrigger((value) => value + 1);
  };

  const handlePolicyDecision = async (scope: string, decision: 'allow' | 'deny') => {
    const runId = activeRunIdRef.current;
    if (!runId) return;
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/approvals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, decision }),
      });
      if (!response.ok) throw new Error('Approval decision was not saved.');
      addCoderThreadMessage({ role: 'system', content: `${decision === 'allow' ? 'Approved' : 'Denied'} policy scope: ${scope}` }, getCoderThreadIdForRun(runId));
    } catch (error: any) {
      addCoderThreadMessage({ role: 'system', status: 'error', content: error.message || 'Approval decision failed.' }, getCoderThreadIdForRun(runId));
    }
  };

  const resumeServerRun = async (
    runId: string,
    freshSteps = CONTINUATION_TURN_WINDOW,
    reason: ContinuationReason = "saved_run",
    threadId?: string | null,
    selectedModel = model,
    selectedGeminiProfileId = geminiProfileId,
    confirmModelChange = false,
    continuationTask?: string,
    continuationDisplayTask?: string,
  ) => {
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maxSteps: freshSteps,
        continuousRun: isOfflineModelSelection(selectedModel),
        reason,
        threadId: threadId || undefined,
        pacingProfile: coderPacingProfile,
        model: selectedModel,
        ...(confirmModelChange ? { confirmModelChange: true } : {}),
        requestBudgetEnabled,
        replayGuardEnabled,
        waitForProviderAvailability: resolveWaitForProviderAvailability(),
        geminiProfileId: selectedModel.startsWith('gemini') && selectedGeminiProfileId
          ? selectedGeminiProfileId
          : undefined,
        // Clicking Continue is explicit approval to preserve the task handoff
        // while refreshing stale file evidence if the workspace has changed.
        rebaseWorkspace: true,
        ...(continuationTask?.trim() ? { continuationTask: continuationTask.trim() } : {}),
        ...(continuationDisplayTask?.trim() ? { continuationDisplayTask: continuationDisplayTask.trim() } : {}),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.runId !== 'string') {
      throw new Error(data.error || 'The saved run checkpoint could not be resumed.');
    }
    return {
      runId: data.runId as string,
      workspaceRebased: data.workspaceRebased === true,
    };
  };

  const handleContinueServerRun = async (run: StoredAgentRun) => {
    if (resumeInFlightRef.current) return;
    resumeInFlightRef.current = run.id;
    setLoading(true);
    setActiveTab("coder");
    const targetThreadId = run.threadId || getCoderThreadIdForRun(run.id);
    try {
      if (run.status === "interrupted") {
        await fetch(`/api/runs/${encodeURIComponent(run.id)}/seen`, { method: "POST" }).catch(() => undefined);
      }
      const recoveryModel = typeof run.metadata?.recoveryModel === 'string' && run.metadata.recoveryModel.trim()
        ? run.metadata.recoveryModel.trim()
        : '';
      // recoveryModel is a staged next target, not the model that ran the
      // parent checkpoint. Keep the parent model anchored to run.model so the
      // resume request carries the correct confirmation/audit boundary.
      const parentModel = typeof run.model === 'string' && run.model.trim() ? run.model.trim() : recoveryModel;
      const selectedModel = model.trim()
        ? normalizeCoderModelSelection(model)
        : normalizeCoderModelSelection(recoveryModel || parentModel);
      const modelChanged = selectedModel !== normalizeCoderModelSelection(parentModel);
      const originalGeminiProfileId = parentModel.startsWith('gemini') && typeof run.metadata?.providerProfile === 'string'
        ? run.metadata.providerProfile
        : '';
      const continuationGeminiProfileId = selectedModel.startsWith('gemini')
        ? (modelChanged ? geminiProfileId : originalGeminiProfileId)
        : '';
      const continuationThread = coderThreadState.threads.find((thread) => thread.id === targetThreadId)?.messages || coderThread;
      const continuationTask = buildLatestCoderContinuationPrompt(
        run.task,
        continuationThread,
        workspace.trim() || run.workspace,
      );
      const resumed = run.status === "running" || run.status === "waiting_for_user" || run.status === "waiting_for_provider"
        ? { runId: run.id, workspaceRebased: false }
        : await resumeServerRun(
          run.id,
          CONTINUATION_TURN_WINDOW,
          "saved_run",
          targetThreadId,
          selectedModel,
          continuationGeminiProfileId,
          // Clicking Resume Session is the explicit confirmation for the
          // currently selected target. This lets a configured replacement
          // model take over while the server still records the old parent.
          modelChanged,
          continuationTask,
          getLatestCoderUserRequest(continuationThread),
        );
      if (resumed.workspaceRebased) {
        addCoderThreadMessage({
          role: 'system',
          content: 'The workspace changed after the saved checkpoint. Continuation memory was preserved, while file evidence was refreshed to avoid using stale reads.',
        }, targetThreadId);
      }
      await streamReactPrompt(run.task, true, CONTINUATION_TURN_WINDOW, {
        existingRunId: resumed.runId,
        runKind: run.kind === "app" ? "app" : run.kind === "coder" ? "coder" : "react",
        trackCoderThread: run.kind === "coder",
        threadId: targetThreadId,
        displayTask: typeof run.metadata?.displayTask === "string" ? run.metadata.displayTask : run.task,
        pacingProfile: run.metadata?.pacingProfile === "phased" || run.metadata?.pacingProfile === "conservative" || run.metadata?.pacingProfile === "fast" || run.metadata?.pacingProfile === "automatic"
          ? run.metadata.pacingProfile
          : coderPacingProfile,
      });
    } catch (error: any) {
      const message = error.message || 'The server run could not be resumed.';
      setLiveProgress(message);
      addCoderThreadMessage({ role: 'system', status: 'error', content: `Continuation failed: ${message}` }, targetThreadId);
    } finally {
      if (resumeInFlightRef.current === run.id) resumeInFlightRef.current = null;
      setLoading(false);
    }
  };

  const handleUndoCoderChanges = async (paths: string[]) => {
    const uniquePaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean))).slice(0, 20);
    if (uniquePaths.length === 0) return;
    const pathList = uniquePaths.map((path) => `- ${path}`).join('\n');
    const prompt = [
      'Undo only the changes from the previous agent run in these files:',
      pathList,
      '',
      'Inspect the current files first. Restore the pre-run behavior without overwriting unrelated user edits, then verify the result.',
    ].join('\n');
    await executeCoderTask(prompt, `Undo changes in ${uniquePaths.length} file${uniquePaths.length === 1 ? '' : 's'}`);
  };

  const handlePendingPolicyApproval = async (decision: 'allow' | 'deny') => {
    const pending = pendingPolicyApproval;
    if (!pending || policyApprovalBusy) return;
    setPolicyApprovalBusy(true);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(pending.runId)}/approvals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: pending.scope, decision }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Approval decision was not saved.');

      setPendingPolicyApproval(null);
      const targetThreadId = getCoderThreadIdForRun(pending.runId);
      addCoderThreadMessage({
        role: 'system',
        content: `${decision === 'allow' ? 'Approved' : 'Denied'} policy scope: ${pending.scope}`,
      }, targetThreadId);
      if (decision === 'deny') {
        await refreshResumableRuns();
        return;
      }

      const runsResponse = await fetch('/api/runs?resumable=true');
      const runsData = await runsResponse.json().catch(() => ({}));
      const run = Array.isArray(runsData.runs)
        ? runsData.runs.find((candidate: StoredAgentRun) => candidate.id === pending.runId)
        : undefined;
      if (!run) throw new Error('The approved run is no longer available to resume.');
      await handleContinueServerRun(run);
    } catch (error: any) {
      setLiveProgress(error.message || 'Approval decision failed.');
      addCoderThreadMessage({ role: 'system', status: 'error', content: error.message || 'Approval decision failed.' }, getCoderThreadIdForRun(pending.runId));
    } finally {
      setPolicyApprovalBusy(false);
    }
  };

  const handlePlanApproval = async (decision: 'approve' | 'reject' | 'edit' | 'cancel') => {
    const pending = pendingPlanApproval;
    if (!pending || planApprovalBusy) return;
    setPlanApprovalBusy(true);
    try {
      const plan = decision === 'edit'
        ? planApprovalDraft.split('\n').map((step) => step.trim()).filter(Boolean).map((step) => ({ step, status: 'pending' as const }))
        : undefined;
      const response = await fetch(`/api/runs/${encodeURIComponent(pending.runId)}/plan-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, ...(plan ? { plan } : {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Plan approval decision was not saved.');
      const approval = data.approval as PlanApprovalView;
      const targetThreadId = getCoderThreadIdForRun(pending.runId);
      setPendingPlanApproval(decision === 'edit' ? { runId: pending.runId, approval } : null);
      if (decision === 'edit') {
        setPlanApprovalDraft(approval.proposedPlan.map((item) => item.step).join('\n'));
        addCoderThreadMessage({ role: 'system', content: 'Plan edited. Review the updated plan and approve it to resume.' }, targetThreadId);
        return;
      }
      addCoderThreadMessage({ role: 'system', content: `Plan ${decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'cancelled'}.` }, targetThreadId);
      if (decision !== 'approve') {
        await refreshResumableRuns();
        return;
      }
      const runsResponse = await fetch('/api/runs?resumable=true');
      const runsData = await runsResponse.json().catch(() => ({}));
      const run = Array.isArray(runsData.runs)
        ? runsData.runs.find((candidate: StoredAgentRun) => candidate.id === pending.runId)
        : undefined;
      if (!run) throw new Error('The approved plan run is no longer available to resume.');
      await handleContinueServerRun(run);
    } catch (error: any) {
      setLiveProgress(error.message || 'Plan approval failed.');
      addCoderThreadMessage({ role: 'system', status: 'error', content: error.message || 'Plan approval failed.' }, getCoderThreadIdForRun(pending.runId));
    } finally {
      setPlanApprovalBusy(false);
    }
  };

  const handleUserQuestionResponse = async (cancelled = false) => {
    const pending = pendingUserQuestion;
    if (!pending || userQuestionBusy) return;
    const selectedOption = userQuestionOption.trim();
    const answer = userQuestionAnswer.trim();
    if (!cancelled && !selectedOption && !answer) return;
    setUserQuestionBusy(true);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(pending.runId)}/user-input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: pending.requestId,
          ...(selectedOption ? { selectedOption } : {}),
          ...(answer ? { answer } : {}),
          cancelled,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'The answer could not be delivered to the agent.');
      const questionKey = `${pending.runId}:${pending.requestId}`;
      resolvedQuestionKeyRef.current = questionKey;
      pendingQuestionKeyRef.current = null;
      setPendingUserQuestion(null);
      setUserQuestionAnswer('');
      setUserQuestionOption('');
      setCoderAgentStatus('thinking');
      const targetThreadId = getCoderThreadIdForRun(pending.runId);
      addCoderThreadMessage({
        role: 'system',
        content: cancelled
          ? `You opted out of the agent question: ${pending.question}`
          : `Your answer was sent to the same running agent: ${selectedOption || answer}`,
      }, targetThreadId);
      // After a browser reload there is no live SSE reader attached to the
      // waiting run. Reattach after the answer is accepted so the resumed
      // agent's progress and completion continue to reach this UI.
      if (activeRunIdRef.current !== pending.runId && lastRunIdRef.current !== pending.runId) {
        void streamReactPrompt(pending.question, false, CONTINUATION_TURN_WINDOW, {
          existingRunId: pending.runId,
          runKind: 'coder',
          trackCoderThread: true,
          threadId: targetThreadId,
        });
      }
    } catch (error: any) {
      setLiveProgress(error.message || 'The answer could not be delivered to the agent.');
    } finally {
      setUserQuestionBusy(false);
    }
  };

  const handleGenerateCoderWorkPlan = async () => {
    const submittedTask = task.trim();
    if (!submittedTask) return;
    const targetThreadId = coderThreadState.activeThreadId || createCoderThreadId();
    const threadForPlan = coderThreadState.threads.find((thread) => thread.id === targetThreadId)?.messages || coderThread;
    const taskWithThreadMemory = buildCoderThreadMemoryPrompt(submittedTask, threadForPlan, workspace.trim() || undefined);
    addCoderThreadMessage({ role: "user", status: "running", content: `Generate a workplan:\n${submittedTask}` }, targetThreadId);
    await handleGenerateWorkPlan(taskWithThreadMemory, extractMentionedFiles(taskWithThreadMemory));
    setActiveTab("coder");
    addCoderThreadMessage({ role: "assistant", status: "success", content: "Workplan generation request completed." }, targetThreadId);
  };

  const streamReactPrompt = async (
    targetPrompt: string,
    clearCurrentResult = true,
    maxSteps = DEFAULT_REACT_TURN_WINDOW,
    options: StreamReactOptions = {}
  ) => {
    const targetThreadId = options.threadId || getCoderThreadIdForRun(options.existingRunId);
    const effectiveModel = options.selectedModel || model;
    const effectiveGeminiProfileId = options.selectedGeminiProfileId || geminiProfileId;
    setLoading(true);
    setFallbackAuthorizationRunId(null);
    if (clearCurrentResult) {
      setResult(null);
    }
    setLiveProgress("");
    const handoffContextWindow = options.continuationHandoff?.modelContextWindow;
    setLiveState(handoffContextWindow && handoffContextWindow > 0
      ? { runTokenUsage: { contextWindow: handoffContextWindow } }
      : null);
    setCoderAgentEvents([]);
    setCoderAgentStatus(options.trackCoderThread ? "thinking" : undefined);
    const currentAgentEvents: AgentStreamEvent[] = [];
    const changedFiles = new Set<string>();
    let runId = options.existingRunId || "";
    let finalized = false;
    let terminalResult: ReActResult | null = null;
    let liveCoderContent = "I’m reviewing the request and workspace context.";
    const liveAssistantSections: Array<{ key: string; text: string }> = [
      { key: 'opening', text: liveCoderContent },
    ];
    const reasoningVisibilityById = new Map<string, 'hidden' | 'collapsed' | 'full' | 'redacted'>();
    const reasoningSummaryById = new Map<string, string>();
    let liveAssistantUpdateSequence = 0;
    let streamedFinalAnswer = '';
    let streamedFinalRequestId = '';
    let streamFlushTimer: number | null = null;
    let pendingLiveProgress: string | null = null;
    let pendingLiveState: any = undefined;
    let hasPendingLiveState = false;
    let pendingAgentStatus: AgentRunStatus | undefined;
    let activeQuestionRequestId: string | null = null;
    let lifecycleOutcome: "stopped" | "interrupted" | "killed" | null = null;
    let typewriterController: TypewriterController | undefined;
    const selectedPacingProfile = options.pacingProfile || coderPacingProfile;
    const profilePreset = getExecutionProfilePreset(selectedPacingProfile);
    const usesFreeTierTypewriter = options.trackCoderThread && profilePreset.typewriter.enabled;
    const upsertLiveCoderRunMessage = (status: CoderThreadMessage["status"] = "running") => {
      if (!options.trackCoderThread || !runId || finalized) return;
      upsertCoderThreadRunMessage(runId, {
        role: "assistant",
        status,
        content: liveCoderContent,
        agentEvents: [...currentAgentEvents],
        filesChanged: Array.from(changedFiles),
      }, targetThreadId);
    };
    const publishTypedAgentUpdate = (text: string) => {
      setLiveProgress(text);
    };
    if (usesFreeTierTypewriter) {
      typewriterController = createTypewriterController({
        intervalMs: profilePreset.typewriter.intervalMs,
        onText: publishTypedAgentUpdate,
        queueUpdates: true,
      });
    }
    const setAgentUpdate = (text: string, terminal = false) => {
      if (typewriterController) {
        if (terminal) typewriterController.flush(text);
        else typewriterController.setTarget(text);
        return;
      }
      pendingLiveProgress = text;
    };
    const setLiveAssistantSection = (key: string, text: string) => {
      const normalized = text.replace(/\s+/g, ' ').trim();
      if (!normalized) return;
      const existingIndex = liveAssistantSections.findIndex((section) => section.key === key);
      if (existingIndex >= 0) liveAssistantSections[existingIndex].text = normalized;
      else liveAssistantSections.push({ key, text: normalized });
      while (liveAssistantSections.length > 8) liveAssistantSections.shift();
      liveCoderContent = liveAssistantSections.map((section) => section.text).join('\n\n').slice(-3_000);
    };
    const appendLiveAssistantUpdate = (text: string) => {
      const normalized = text.replace(/\s+/g, ' ').trim();
      if (!normalized || liveAssistantSections[liveAssistantSections.length - 1]?.text === normalized) return;
      liveAssistantUpdateSequence += 1;
      setLiveAssistantSection(`update-${liveAssistantUpdateSequence}`, normalized);
    };
    const replaceLiveAssistantReply = (text: string) => {
      liveAssistantSections.splice(0, liveAssistantSections.length, { key: 'replacement', text });
      liveCoderContent = text;
    };
    const flushStreamUi = () => {
      if (streamFlushTimer !== null) {
        window.clearTimeout(streamFlushTimer);
        streamFlushTimer = null;
      }

      if (pendingLiveProgress !== null) {
        setLiveProgress(pendingLiveProgress);
        pendingLiveProgress = null;
      }

      if (hasPendingLiveState) {
        setLiveState(pendingLiveState);
        pendingLiveState = undefined;
        hasPendingLiveState = false;
      }

      if (pendingAgentStatus) {
        setCoderAgentStatus(pendingAgentStatus);
        pendingAgentStatus = undefined;
      }

      setCoderAgentEvents([...currentAgentEvents]);
      upsertLiveCoderRunMessage();
    };
    const scheduleStreamUiFlush = (delayMs = STREAM_UI_FLUSH_MS) => {
      if (delayMs === STREAM_UI_TERMINAL_FLUSH_MS) {
        flushStreamUi();
        return;
      }
      if (streamFlushTimer !== null) return;
      streamFlushTimer = window.setTimeout(() => flushStreamUi(), delayMs);
    };
    const applyTerminalResult = (
      data: ReActResult,
      lifecycleOverride: "stopped" | "interrupted" | "killed" | null = null,
    ) => {
      const lifecycle = lifecycleOverride || lifecycleOutcome || (
        data.errorCode === "RUN_KILLED" ? "killed" :
        data.errorCode === "RUN_INTERRUPTED" ? "interrupted" :
        data.errorCode === "USER_STOPPED" ? "stopped" : null
      );
      const stopped = lifecycle !== null;
      const completedWithVerificationFailure = isCompletedWithVerificationFailure(data);
      terminalResult = data;
      typewriterController?.cancel();
      const terminalMessage = completedWithVerificationFailure
        ? `Work completed, but verification failed: ${data.error || 'one or more tests failed.'}`
        : data.error
          ? formatTerminalResultError(data, lifecycle || undefined)
          : (stopped ? "The run stopped." : data.success ? "Backend agent completed the response." : "Execution failed.");
      finalized = true;
      if (!data.success && !stopped && !completedWithVerificationFailure) {
        const lastEvent = currentAgentEvents[currentAgentEvents.length - 1];
        if (lastEvent?.type !== "error" || lastEvent.message !== terminalMessage) {
          currentAgentEvents.push({ type: "error", message: terminalMessage });
        }
      }
      flushStreamUi();
      setResult(data);
      setAutoContinueSeconds(AUTO_CONTINUE_DELAY_SECONDS);
      setAutoContinuePaused(!AUTO_CONTINUE_ENABLED || !isAutomaticContinuationResult(data));
      autoContinueTriggeredRef.current = false;
      setShowContinueModal(
        isContinuableResult(data) &&
        !isProviderRecoveryResult(data) &&
        !isApprovalRequiredResult(data) &&
        !isPlanApprovalRequiredResult(data)
      );
      if (isProviderRecoveryResult(data)) {
        setRecoveryModel(effectiveModel);
        setPendingModelChange({ runId, resumeAfterChange: true });
      }
      if (isApprovalRequiredResult(data) && data.approvalRequest) {
        setPendingPolicyApproval({
          runId,
          ...data.approvalRequest,
        });
      }
      if (isPlanApprovalRequiredResult(data) && data.planApproval) {
        setPendingPlanApproval({ runId, approval: data.planApproval });
        setPlanApprovalDraft(data.planApproval.proposedPlan.map((item) => item.step).join('\n'));
      }
      const timedOut = !data.success && isTimedOutResult(data);
      const terminalAgentStatus: AgentRunStatus = stopped
        ? lifecycle || "stopped"
        : data.success || completedWithVerificationFailure
          ? "completed"
          : timedOut
            ? "timed_out"
            : "failed";
      setCoderAgentStatus(terminalAgentStatus);
      if (options.trackCoderThread) {
        upsertCoderThreadRunMessage(runId, {
          role: "assistant",
          status: stopped ? "stopped" : data.success || completedWithVerificationFailure ? "success" : timedOut ? "timed_out" : "error",
          content: data.success
            ? data.finalAnswer || "Task completed."
            : completedWithVerificationFailure
              ? terminalMessage
              : data.error || "Execution failed.",
          agentEvents: currentAgentEvents,
          filesChanged: Array.from(changedFiles),
        }, targetThreadId);
      }
      setWorkspaceRefreshTrigger(prev => prev + 1);
      setTimeout(() => setWorkspaceRefreshTrigger(prev => prev + 1), 1000);
      void fetch(`/api/runs/${encodeURIComponent(runId)}/seen`, { method: "POST" }).catch(() => undefined);
    };
    const reconcileClosedRun = async () => {
      if (finalized || !runId) return false;
      const terminalStatuses = new Set<StoredAgentRun["status"]>(["completed", "failed", "stopped", "interrupted", "killed"]);
      // A stream can close just before executeRun persists its terminal event.
      // Give the server a few seconds to finish and let the saved run remain
      // the source of truth instead of displaying a false disconnect error.
      for (let attempt = 0; attempt < 10; attempt += 1) {
        if (finalized) return false;
        try {
          const runResponse = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
          const runData = await runResponse.json().catch(() => ({}));
          const storedRun = runData?.run as StoredAgentRun | undefined;
          if (runResponse.ok && storedRun && terminalStatuses.has(storedRun.status)) {
            const result: ReActResult = storedRun.result && typeof storedRun.result === "object"
              ? storedRun.result as ReActResult
              : {
                  success: storedRun.status === "completed",
                  error: storedRun.stopReason,
                  steps: [],
                  stepCount: 0,
                };
            const lifecycle = storedRun.status === "stopped" || storedRun.status === "interrupted" || storedRun.status === "killed"
              ? storedRun.status
              : null;
            applyTerminalResult(result, lifecycle);
            return true;
          }
        } catch {
          // Keep retrying while the live-run endpoint is briefly unavailable.
        }
        if (attempt < 9) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return false;
    };

    try {
      if (!runId) {
        const startResponse = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: options.runKind || (options.trackCoderThread ? "coder" : "react"),
            task: targetPrompt,
            model: effectiveModel,
            ...(options.trackCoderThread ? { plannerModel: effectiveModel } : {}),
            maxSteps,
            continuousRun: isOfflineModelSelection(effectiveModel),
            pacingProfile: options.pacingProfile || coderPacingProfile,
            budget: 100,
            requestBudgetEnabled,
            replayGuardEnabled,
            waitForProviderAvailability: resolveWaitForProviderAvailability(options.pacingProfile),
            workspace: workspace.trim() || undefined,
            geminiProfileId: effectiveGeminiProfileId || undefined,
            allowCrossProviderFallback,
            approvedFallbackProviders: [],
            fallbackApprovalGranted: allowCrossProviderFallback,
            threadId: targetThreadId,
            metadata: {
              displayTask: options.displayTask || targetPrompt,
              trackCoderThread: Boolean(options.trackCoderThread),
              taskAnalysis: options.taskAnalysis || undefined,
              pacingProfile: options.pacingProfile || coderPacingProfile,
              providerProfile: effectiveGeminiProfileId || undefined,
              maximumRequestsPerTask: requestBudgetEnabled ? 20 : undefined,
              requestBudgetEnabled,
              replayGuardEnabled,
              waitForProviderAvailability: resolveWaitForProviderAvailability(options.pacingProfile),
              allowCrossProviderFallback,
              approvedFallbackProviders: [],
              fallbackApprovalGranted: allowCrossProviderFallback,
              approvalPolicy: options.approvalPolicy || coderApprovalMode,
              continuationHandoff: options.continuationHandoff,
              parentRunId: options.continuationHandoff?.parentRunId,
              continuationReason: options.continuationHandoff?.reason,
            },
          }),
        });
        const startData = await startResponse.json().catch(() => ({}));
        const startedContextWindow = Number(startData?.run?.metadata?.modelContextWindow);
        if (Number.isFinite(startedContextWindow) && startedContextWindow > 0) {
          pendingLiveState = { runTokenUsage: { contextWindow: startedContextWindow } };
          hasPendingLiveState = true;
        }
          if (startResponse.status === 409 && typeof startData.resumableRunId === "string") {
            const resumableModel = typeof startData.resumableModel === "string" && startData.resumableModel.trim()
              ? normalizeCoderModelSelection(startData.resumableModel)
              : normalizeCoderModelSelection(effectiveModel);
            const resumableThreadId = typeof startData.resumableThreadId === "string" && startData.resumableThreadId.trim()
              ? startData.resumableThreadId
              : targetThreadId;
            const resumed = await resumeServerRun(
              startData.resumableRunId,
              maxSteps,
              "saved_run",
              resumableThreadId,
              resumableModel,
              typeof startData.resumableGeminiProfileId === "string"
                ? startData.resumableGeminiProfileId
                : resumableModel.startsWith('gemini') ? effectiveGeminiProfileId : '',
              false,
              targetPrompt,
              options.displayTask || targetPrompt,
            );
            runId = resumed.runId;
            replaceLiveAssistantReply("I’m resuming from the saved task checkpoint.");
          } else if (startResponse.status === 409 && typeof startData.activeRunId === "string") {
            runId = startData.activeRunId;
            replaceLiveAssistantReply("I’ve reconnected to the active run in this thread.");
          } else {
            if (!startResponse.ok) throw new Error(startData.error || "Failed to start server run.");
            runId = startData.runId;
            if (startData.queued) replaceLiveAssistantReply("I’ve queued your update for the next safe checkpoint.");
          }
      }

      setActiveRunId(runId);
      activeRunIdRef.current = runId;
      lastRunIdRef.current = runId;
      upsertLiveCoderRunMessage();

      let lastEventSeq = 0;
      let reconnectAttempts = 0;
      while (!finalized) {
        try {
          const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/stream?afterSeq=${lastEventSeq}`);

          if (!response.body) throw new Error("No body");
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n\n");
            buffer = lines.pop() || "";

            for (const block of lines) {
              const typeMatch = block.match(/event: (.*)\n/);
              const dataMatch = block.match(/data: (.*)/);
              if (!typeMatch || !dataMatch) continue;

              const idMatch = block.match(/(?:^|\n)id: (\d+)(?:\n|$)/);
              if (idMatch) lastEventSeq = Math.max(lastEventSeq, Number(idMatch[1]));
              const type = typeMatch[1];
              const data = JSON.parse(dataMatch[1]);

          if (
            type === "run_started" ||
            type === "console_output" ||
            type === "model_target_resolved" ||
            type === "reasoning_start" ||
            type === "reasoning_delta" ||
            type === "reasoning_end" ||
            type === "model_response" ||
            type === "model_stream" ||
            type === "decision_record" ||
            type === "llm_request_started" ||
            type === "llm_request_finished" ||
            type === "provider_attempt_failed" ||
            type === "cooldown_waiting" ||
            type === "nvidia_cooldown_retry" ||
            type === "retrying" ||
            type === "execution_failed" ||
            type === "pacing_wait" ||
            type === "plan_updated" ||
            type === "todo_snapshot" ||
            type === "todo_links_updated" ||
            type === "workplan_updated" ||
            type === "state_transition" ||
            type === "recovery_transition" ||
            type === "plan_approval_required" ||
            type === "plan_approval_resolved" ||
            type === "tool_started" ||
            type === "tool_result" ||
            type === "tool_evidence" ||
            type === "file_read" ||
            type === "file_changed" ||
            type === "command_started" ||
            type === "command_output" ||
            type === "package_install_started" ||
            type === "package_install_result" ||
             type === "verification_started" ||
             type === "verification_result" ||
             type === "user_input_required" ||
             type === "user_input_resolved" ||
             type === "user_message_queued" ||
             type === "user_message_processed" ||
             type === "inbox_message_enqueued" ||
             type === "inbox_message_claimed" ||
             type === "inbox_message_replaced" ||
             type === "inbox_message_cancelled" ||
             type === "inbox_message_processed" ||
             type === "inbox_cleared" ||
             type === "inbox_requeued" ||
             type === "inbox_claims_released" ||
             type === "policy_decision" ||
            type === "final" ||
            type === "stopped" ||
            type === "interrupted" ||
            type === "killed"
          ) {
            const event = data as AgentStreamEvent;
            const previousEvent = currentAgentEvents[currentAgentEvents.length - 1];
            if (
              event.type === "model_stream" &&
              event.eventType === "text_delta" &&
              previousEvent?.type === "model_stream" &&
              previousEvent.eventType === "text_delta" &&
              previousEvent.requestId === event.requestId &&
              previousEvent.requestKind === event.requestKind
            ) {
              currentAgentEvents[currentAgentEvents.length - 1] = {
                ...previousEvent,
                delta: `${previousEvent.delta || ''}${event.delta || ''}`,
              };
            } else {
              currentAgentEvents.push(event);
            }
            if (event.type === "policy_decision" && event.decision.requiresApproval && !event.decision.allowed) {
              setPendingPolicyApproval({
                runId,
                scope: event.decision.scope,
                category: event.decision.category,
                risk: event.decision.risk,
                summary: event.decision.summary,
                reason: event.decision.reason,
              });
            }
            if (event.type === "plan_approval_required") {
              setPendingPlanApproval({ runId, approval: event.approval });
              setPlanApprovalDraft(event.approval.proposedPlan.map((item) => item.step).join('\n'));
            }
            if (event.type === "plan_approval_resolved") {
              if (event.approval.status === 'pending') {
                setPendingPlanApproval({ runId, approval: event.approval });
                setPlanApprovalDraft(event.approval.proposedPlan.map((item) => item.step).join('\n'));
              } else {
                setPendingPlanApproval(null);
              }
            }
            if (event.type === "user_input_required") {
              pendingQuestionKeyRef.current = `${runId}:${event.requestId}`;
              resolvedQuestionKeyRef.current = null;
              activeQuestionRequestId = event.requestId;
              setPendingUserQuestion({
                runId,
                requestId: event.requestId,
                question: event.question,
                options: event.options || [],
                allowFreeform: event.allowFreeform,
                context: event.context,
              });
              setUserQuestionAnswer('');
              setUserQuestionOption(event.options?.[0] || '');
            }
            if (event.type === "user_input_resolved") {
              resolvedQuestionKeyRef.current = `${runId}:${event.requestId}`;
              pendingQuestionKeyRef.current = null;
              if (activeQuestionRequestId === event.requestId) activeQuestionRequestId = null;
              setPendingUserQuestion((current) =>
                current?.runId === runId && current.requestId === event.requestId ? null : current
              );
            }
            if (event.type === "model_target_resolved" && Number.isFinite(event.contextWindow) && event.contextWindow > 0) {
              pendingLiveState = {
                ...(pendingLiveState && typeof pendingLiveState === 'object' ? pendingLiveState : {}),
                runTokenUsage: {
                  ...(pendingLiveState?.runTokenUsage && typeof pendingLiveState.runTokenUsage === 'object'
                    ? pendingLiveState.runTokenUsage
                    : {}),
                  contextWindow: event.contextWindow,
                },
              };
              hasPendingLiveState = true;
            }
            if (event.type === "file_changed") {
              changedFiles.add(event.path);
              const key = fileChangeKey(event.path);
              setWorkspaceFileChanges((current) => ({
                ...current,
                [key]: {
                  path: event.path,
                  status: 'modified',
                  summary: event.summary || 'File changed',
                  diff: event.diff || current[key]?.diff,
                  changedAt: Date.now(),
                  runId,
                  changeCount: (current[key]?.changeCount || 0) + 1,
                },
              }));
            }
            if (event.type === "reasoning_start") {
              reasoningVisibilityById.set(event.id, event.visibility);
            }
            if (event.type === "reasoning_delta" && event.phase === 'planning' && reasoningVisibilityById.get(event.id) === 'collapsed') {
              const previousSummary = reasoningSummaryById.get(event.id) || '';
              const separator = previousSummary && !/^[,.;:!?)}\]]/.test(event.delta) ? ' ' : '';
              const nextSummary = `${previousSummary}${separator}${event.delta}`
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 1_200);
              reasoningSummaryById.set(event.id, nextSummary);
              setLiveAssistantSection(`reasoning-${event.id}`, nextSummary);
            }
            if (event.type === "reasoning_end") {
              reasoningVisibilityById.set(event.id, event.visibility);
              if (event.phase === 'planning' && event.visibility === 'collapsed' && event.summary?.trim()) {
                const summary = event.summary.replace(/\s+/g, ' ').trim().slice(0, 1_200);
                reasoningSummaryById.set(event.id, summary);
                setLiveAssistantSection(`reasoning-${event.id}`, summary);
              }
            }
            if (event.type === "tool_started") {
              appendLiveAssistantUpdate(`I’m using ${event.tool} to carry out the next step.`);
            }
            if (event.type === "file_read") {
              appendLiveAssistantUpdate(`I’ve opened ${event.path} to check the existing implementation.`);
            }
            if (event.type === "file_changed") {
              appendLiveAssistantUpdate(`I’ve updated ${event.path}.`);
            }
            if (event.type === "verification_started") {
              appendLiveAssistantUpdate("The change is in place; I’m checking it now.");
            }
            if (event.type === "verification_result") {
              appendLiveAssistantUpdate(event.success
                ? "The verification check passed."
                : "The verification check found an issue, so I’m reviewing the result.");
            }
            if (event.type === "user_message_processed") {
              appendLiveAssistantUpdate("I’ve included your latest update and am continuing from the current checkpoint.");
            }
            if (event.type === "final") {
              (event.filesChanged || []).forEach((file) => changedFiles.add(file));
            }
            const nextStatus = statusFromAgentEvent(event);
            if (nextStatus) pendingAgentStatus = nextStatus;
            if (event.type === "pacing_wait" && event.recoverable) {
              pendingAgentStatus = "thinking";
              setFallbackAuthorizationRunId(runId);
            }
            const isFinalAnswerDelta = event.type === "model_stream" &&
              event.eventType === "text_delta" &&
              event.requestKind === 'final_answer.synthesize' &&
              Boolean(event.delta);
            let nextAgentUpdate: string | undefined;
            if (event.type === "run_started") nextAgentUpdate = "Backend run started.";
            if (event.type === "console_output") nextAgentUpdate = event.message;
            if (event.type === "model_response") nextAgentUpdate = event.message;
            if (event.type === "model_stream" && event.eventType === "text_delta" && event.delta) {
              const isFinalAnswer = event.requestKind === 'final_answer.synthesize';
              if (isFinalAnswer) {
                if (streamedFinalRequestId !== (event.requestId || '')) {
                  streamedFinalRequestId = event.requestId || '';
                  streamedFinalAnswer = '';
                  liveAssistantSections.splice(0, liveAssistantSections.length);
                }
                streamedFinalAnswer += event.delta;
                liveCoderContent = streamedFinalAnswer;
                nextAgentUpdate = streamedFinalAnswer;
              } else {
                nextAgentUpdate = event.delta;
              }
            }
            if (event.type === "model_stream" && event.eventType === "usage" && event.delta) {
              nextAgentUpdate = event.delta;
            }
            if (event.type === "llm_request_started") {
              const route = event.request.resolvedRoute || event.request.requestedRoute;
              const routeLabel = route ? [route.provider, route.model].filter(Boolean).join(' / ') : 'selected provider';
              const timeout = event.request.options?.timeoutMs ? ` (up to ${Math.ceil(event.request.options.timeoutMs / 1_000)}s)` : '';
              nextAgentUpdate = `Waiting for ${routeLabel}${timeout}...`;
            }
            if (event.type === "llm_request_finished") {
              const route = event.request.resolvedRoute || event.request.requestedRoute;
              const routeLabel = route ? [route.provider, route.model].filter(Boolean).join(' / ') : 'selected provider';
              nextAgentUpdate = event.request.status === 'timed_out'
                ? `${routeLabel} timed out; preparing provider recovery.`
                : event.request.status === 'failed'
                  ? `${routeLabel} failed; preparing provider recovery.`
                  : `${routeLabel} returned a response.`;
            }
            if (event.type === "provider_attempt_failed" || event.type === "cooldown_waiting" || event.type === "nvidia_cooldown_retry" || event.type === "retrying") nextAgentUpdate = event.message;
            if (event.type === "execution_failed") nextAgentUpdate = event.message;
            if (event.type === "pacing_wait") nextAgentUpdate = event.message;
            if (event.type === "plan_updated") nextAgentUpdate = "Backend agent updated its plan.";
            if (event.type === "todo_snapshot") nextAgentUpdate = "Backend agent persisted its todo snapshot.";
            if (event.type === "todo_links_updated") nextAgentUpdate = "Backend agent updated todo links and progress.";
            if (event.type === "workplan_updated") nextAgentUpdate = "Backend agent updated its optional workplan.";
            if (event.type === "state_transition") nextAgentUpdate = `Run state: ${event.transition.to} (${event.transition.reason}).`;
            if (event.type === "recovery_transition") nextAgentUpdate = `Recovery: ${event.reason} → ${event.to}.`;
            if (event.type === "user_message_queued") nextAgentUpdate = "Your update was queued for the next safe checkpoint.";
            if (event.type === "user_message_processed") nextAgentUpdate = "The agent is processing your queued update.";
            if (event.type === "inbox_message_enqueued") nextAgentUpdate = "Your inbox update is durably queued.";
            if (event.type === "inbox_message_claimed") nextAgentUpdate = "The agent claimed your inbox update at a safe boundary.";
            if (event.type === "inbox_message_processed") nextAgentUpdate = "The agent accepted your inbox update into its context.";
            if (event.type === "interrupted" || event.type === "killed") {
              lifecycleOutcome = event.type;
              nextAgentUpdate = event.message;
            }
            if (event.type === "plan_approval_required") nextAgentUpdate = "Plan approval is required before workspace mutations begin.";
            if (event.type === "tool_started") nextAgentUpdate = `Backend agent is using ${event.tool}.`;
            if (event.type === "file_read") nextAgentUpdate = `Backend agent read ${event.path}.`;
            if (event.type === "file_changed") nextAgentUpdate = `Backend agent changed ${event.path}.`;
            if (event.type === "command_started") nextAgentUpdate = `Backend agent is running: ${event.command}`;
            if (event.type === "package_install_started") nextAgentUpdate = `Backend agent is installing ${event.packages.join(', ') || 'declared dependencies'} with ${event.manager}.`;
            if (event.type === "package_install_result") nextAgentUpdate = event.success
              ? `Dependency installation completed and verified${event.verifiedPackages.length ? `: ${event.verifiedPackages.join(', ')}` : '.'}`
              : `Dependency installation failed${event.missingPackages.length ? `; missing: ${event.missingPackages.join(', ')}` : '.'}`;
            if (event.type === "verification_started") nextAgentUpdate = event.command
              ? `Backend agent is verifying: ${event.command}`
              : "Backend agent is verifying changes.";
            if (event.type === "user_input_required") nextAgentUpdate = `The agent is waiting for your answer: ${event.question}`;
            if (event.type === "user_input_resolved") nextAgentUpdate = event.cancelled
              ? "The agent is continuing without that answer."
              : "The agent received your answer and is continuing.";
            if (event.type === "final") nextAgentUpdate = "Backend agent produced a final answer.";
            if (event.type === "stopped") nextAgentUpdate = event.message;
            // The live ticker, chat timeline, and console must describe the
            // same event with the same copy. Keep the provider/tool details in
            // the event body so a failed Read, Write, Bash, or model request
            // cannot be reduced to a generic "Reason" message in one surface.
            const canonicalEventMessage = getAgentEventMessage(event);
            if (!isFinalAnswerDelta) {
              nextAgentUpdate = canonicalEventMessage.detail
                ? `${canonicalEventMessage.title}: ${canonicalEventMessage.detail}`
                : canonicalEventMessage.title;
            }
            if (isFinalAnswerDelta) {
              // Keep the accumulated answer as the assistant message body. The
              // batched stream already arrives at a human-readable cadence;
              // don't replace it with the generic event label or enqueue every
              // new prefix into the separate status typewriter.
              typewriterController?.cancel();
              pendingLiveProgress = "Assistant is writing the final response...";
            } else if (nextAgentUpdate && streamedFinalAnswer) {
              // Status events can continue while the final answer is being
              // committed, but they should not replace the assistant's text.
              pendingLiveProgress = event.type === "final" || (event.type === "model_response" && event.phase === 'final')
                ? "Final response ready."
                : nextAgentUpdate;
            } else if (nextAgentUpdate) {
              setAgentUpdate(nextAgentUpdate, event.type === "final" || event.type === "stopped" || event.type === "interrupted" || event.type === "killed");
            }
            scheduleStreamUiFlush(event.type === "final" || event.type === "stopped" || event.type === "interrupted" || event.type === "killed" ? STREAM_UI_TERMINAL_FLUSH_MS : STREAM_UI_FLUSH_MS);

            if (event.type === "todo_snapshot") {
              pendingLiveState = {
                ...(pendingLiveState && typeof pendingLiveState === "object" ? pendingLiveState : {}),
                plan: event.items.map((item) => ({ id: item.id, step: item.content, status: item.status })),
              };
              hasPendingLiveState = true;
            }
            if (event.type === "todo_links_updated") {
              pendingLiveState = {
                ...(pendingLiveState && typeof pendingLiveState === "object" ? pendingLiveState : {}),
                todoProjection: {
                  revision: event.revision,
                  links: event.links,
                  acceptanceCriteria: event.acceptanceCriteria,
                  progressCursor: event.progressCursor,
                },
              };
              hasPendingLiveState = true;
            }
          }

          if (type === "progress") {
            setAgentUpdate(String(data || "Backend agent is working..."));
            scheduleStreamUiFlush();
          } else if (type === "state") {
            pendingLiveState = data;
            hasPendingLiveState = true;
            scheduleStreamUiFlush();
          } else if (type === "checkpoint" && data?.state) {
            pendingLiveState = data.state;
            hasPendingLiveState = true;
            scheduleStreamUiFlush();
          } else if (type === "done") {
            applyTerminalResult(data as ReActResult);
          } else if (type === "error") {
            typewriterController?.cancel();
            finalized = true;
            const errorEvent: AgentStreamEvent = { type: "error", message: formatAgentError(data.error, data.errorCode) };
            currentAgentEvents.push(errorEvent);
            flushStreamUi();
            setCoderAgentStatus("failed");
            const errorResult: ReActResult = {
              success: false,
              error: data.error,
              steps: [],
              stepCount: 0,
            };
            terminalResult = errorResult;
            setResult(errorResult);
            if (options.trackCoderThread) {
              upsertCoderThreadRunMessage(runId, {
                role: "assistant",
                status: "error",
                content: data.error || "Execution failed.",
                agentEvents: currentAgentEvents,
                filesChanged: Array.from(changedFiles),
              }, targetThreadId);
            }
            setWorkspaceRefreshTrigger(prev => prev + 1);
            void fetch(`/api/runs/${encodeURIComponent(runId)}/seen`, { method: "POST" }).catch(() => undefined);
          }
            }
          }
        } catch {
          // The saved run remains authoritative when the transport drops.
          // Reconciliation below decides whether it already finished.
        }
        if (finalized) break;

        const reconciled = await reconcileClosedRun();
        if (reconciled) break;
        reconnectAttempts += 1;
        const reconnectDelayMs = Math.min(5_000, 500 * Math.min(reconnectAttempts, 10));
        setAgentUpdate(`Live connection interrupted; reconnecting (attempt ${reconnectAttempts})...`);
        scheduleStreamUiFlush();
        await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs));
      }
      if (!finalized && runId) {
        const reconciled = await reconcileClosedRun();
        if (!reconciled) {
          applyTerminalResult({
            success: false,
            error: "The live run stream closed before completion was reported. Reconnect or resume the saved run to continue monitoring it.",
            errorCode: "RUN_STREAM_DISCONNECTED",
            steps: [],
            stepCount: 0,
          });
        }
      }
      if (!finalized && runId && activeQuestionRequestId) {
        try {
          const pendingResponse = await fetch(`/api/runs/${encodeURIComponent(runId)}/user-input`);
          const pendingData = await pendingResponse.json().catch(() => ({}));
          if (!pendingResponse.ok || pendingData.request?.requestId !== activeQuestionRequestId) {
            setPendingUserQuestion((current) =>
              current?.runId === runId && current.requestId === activeQuestionRequestId ? null : current
            );
          }
        } catch {
          // Keep the visible question during a transient reconnect failure.
        }
      }
    } catch (error: any) {
      typewriterController?.cancel();
      const errorMessage = error.message || String(error);
      currentAgentEvents.push({ type: "error", message: errorMessage });
      setCoderAgentEvents([...currentAgentEvents]);
      const errorResult: ReActResult = {
        success: false,
        error: errorMessage,
        steps: [],
        stepCount: 0,
      };
      terminalResult = errorResult;
      setResult(errorResult);
      const timedOut = isTimedOutResult({ error: errorMessage });
      setCoderAgentStatus(timedOut ? "timed_out" : "failed");
      if (options.trackCoderThread && runId && !finalized) {
        upsertCoderThreadRunMessage(runId, {
          role: "assistant",
          status: timedOut ? "timed_out" : "error",
          content: errorMessage,
          agentEvents: currentAgentEvents,
          filesChanged: Array.from(changedFiles),
        }, targetThreadId);
      }
    } finally {
      typewriterController?.cancel();
      if (streamFlushTimer !== null) {
        window.clearTimeout(streamFlushTimer);
        streamFlushTimer = null;
      }
      setActiveRunId((current) => current === runId ? null : current);
      activeRunIdRef.current = activeRunIdRef.current === runId ? null : activeRunIdRef.current;
      setLoading(false);
      setLiveProgress("");
      setLiveState(null);
      void refreshResumableRuns();
    }
    return { result: terminalResult, runId, events: [...currentAgentEvents] };
  };

  const handleVerifyGeneratedApp = async () => {
    if (!result?.appSpec) return;
    setAppActionLoading(true);
    setLiveProgress("Verifying generated app...");

    try {
      const response = await fetch("/api/apps/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appSpec: result.appSpec,
          outputFiles: result.outputFiles || [],
          workspace: workspace.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Verification failed");

      setResult(prev => prev ? { ...prev, verificationResult: data.verificationResult } : prev);
      setLiveProgress(data.verificationResult?.passed ? "App verification passed." : "App verification found issues.");
    } catch (error: any) {
      setLiveProgress(`Verification failed: ${error.message || String(error)}`);
    } finally {
      setAppActionLoading(false);
    }
  };

  const handleRepairGeneratedApp = async () => {
    if (!result?.appSpec) return;

    const failedChecks = result.verificationResult?.checks
      ?.filter((check) => !check.passed)
      .map((check) => `- ${check.name}: ${check.reason || "failed"}`)
      .join("\n") || "- Re-run verification and fix any app runtime issues.";

    const repairPrompt = `Repair the generated app "${result.appSpec.appName}" in the target workspace.

Entry point: ${result.appSpec.entryPoint}
Output files: ${(result.outputFiles || [result.appSpec.entryPoint]).join(", ")}

Fix these verification issues:
${failedChecks}

This is an incremental repair of the existing files. Inspect the current implementation and workspace diff first, preserve features that already work, and use the smallest targeted Edit. Do not regenerate or rewrite existing files wholesale unless a file is missing or the failure requires it.

Keep the app as a standalone working file, preserve the requested features, then verify that the preview loads without console errors.`;

    setTask(repairPrompt);
    let repairAnalysis: CoderTaskAnalysis | null = null;
    try {
      const analyzed = await analyzeCoderRequest(repairPrompt);
      repairAnalysis = analyzed.analysis;
      setCoderTaskAnalysis(repairAnalysis);
    } catch {
      // The repair can still run when preflight analysis is unavailable; the
      // prompt itself and the engine's scoped repair guard remain authoritative.
    }
    await executeCoderTask(repairPrompt, repairPrompt, repairAnalysis);
  };

  const handleContinueFromCheckpoint = async (modelChange?: {
    model: string;
    confirmModelChange: boolean;
    runId?: string;
  }) => {
    if (!result) return;
    autoContinueTriggeredRef.current = true;
    const previousRunId = modelChange?.runId || lastRunIdRef.current;
    if (!previousRunId) {
      setLiveProgress('The previous server checkpoint is unavailable. Start a new instance instead.');
      return;
    }
    setShowContinueModal(false);
    try {
      const targetThreadId = getCoderThreadIdForRun(previousRunId);
      const continuationThread = coderThreadState.threads.find((thread) => thread.id === targetThreadId)?.messages || coderThread;
      const continuationTask = buildLatestCoderContinuationPrompt(
        result.resumeState?.task || task || "Continue the current task.",
        continuationThread,
        workspace.trim() || undefined,
      );
      const resumed = await resumeServerRun(
        previousRunId,
        CONTINUATION_TURN_WINDOW,
        isPhaseCompletedResult(result) ? "saved_run" : "max_steps",
        targetThreadId,
        modelChange?.model || model,
        (modelChange?.model || model).startsWith('gemini') ? geminiProfileId : '',
        modelChange?.confirmModelChange === true,
        continuationTask,
        getLatestCoderUserRequest(continuationThread),
      );
      if (resumed.workspaceRebased) {
        addCoderThreadMessage({
          role: 'system',
          content: 'The workspace changed after the saved checkpoint. Automatic continuation preserved the task handoff and refreshed stale file evidence.',
        }, targetThreadId);
      }
      await streamReactPrompt(continuationTask, true, CONTINUATION_TURN_WINDOW, {
        existingRunId: resumed.runId,
        trackCoderThread: true,
        threadId: targetThreadId,
      });
    } catch (error: any) {
      const message = error.message || 'The previous checkpoint could not be resumed.';
      setLiveProgress(message);
      setAutoContinuePaused(true);
      setShowContinueModal(true);
      addCoderThreadMessage({ role: 'system', status: 'error', content: message }, getCoderThreadIdForRun(previousRunId));
    }
  };

  React.useEffect(() => {
    if (!AUTO_CONTINUE_ENABLED || !showContinueModal || !isAutomaticContinuationResult(result) || autoContinuePaused || loading) return;
    if (autoContinueSeconds <= 0) {
      if (!autoContinueTriggeredRef.current) {
        autoContinueTriggeredRef.current = true;
        void handleContinueFromCheckpoint();
      }
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setAutoContinueSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearTimeout(timeoutId);
  }, [showContinueModal, result, autoContinuePaused, loading, autoContinueSeconds]);

  const openModelChangeModal = (runId: string, resumeAfterChange: boolean) => {
    setRecoveryModel(model);
    setPendingModelChange({ runId, resumeAfterChange });
  };

  const handleChangeModelAndContinue = () => {
    const previousRunId = lastRunIdRef.current;
    if (!previousRunId) {
      setLiveProgress('The previous server checkpoint is unavailable. Start a new instance instead.');
      return;
    }
    openModelChangeModal(previousRunId, true);
  };

  const handleSelectRecoveryModelForActiveRun = () => {
    const runId = fallbackAuthorizationRunId;
    if (!runId) return;
    openModelChangeModal(runId, true);
  };

  const handleConfirmModelChange = async () => {
    const pending = pendingModelChange;
    const requestedModel = recoveryModel.trim();
    if (!pending || !requestedModel) return;
    // The user reached this modal and clicked Continue with selected model,
    // which is explicit confirmation even when the global UI model differs
    // from the parent run's model or a staged recovery target.
    const isModelChange = requestedModel !== normalizeCoderModelSelection(model);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(pending.runId)}/fallback-policy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: requestedModel,
          confirmModelChange: true,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Recovery model was not saved.');
      setModel(requestedModel);
      setFallbackAuthorizationRunId(null);
      setPendingModelChange(null);
      setShowContinueModal(false);
      setLiveProgress(isModelChange
        ? `Confirmed model change from ${model} to ${requestedModel}. Continuing the run.`
        : `Retrying the selected model ${requestedModel}.`);
      addCoderThreadMessage({
        role: 'system',
        content: isModelChange
          ? `Confirmed fallback model change from ${model} to ${requestedModel}.`
          : `Confirmed retry with the selected model ${requestedModel}.`,
      });
      if (pending.resumeAfterChange) {
        await handleContinueFromCheckpoint({
          model: requestedModel,
          confirmModelChange: true,
          runId: pending.runId,
        });
      }
    } catch (error: any) {
      setLiveProgress(error.message || 'Recovery model selection failed.');
    }
  };

  const handleOptOutOfFallback = () => {
    setPendingModelChange(null);
    setFallbackAuthorizationRunId(null);
    setShowContinueModal(false);
    setAutoContinuePaused(true);
    setLiveProgress('Provider recovery stopped. The run remains stopped.');
    addCoderThreadMessage({
      role: 'system',
      status: 'stopped',
      content: 'Provider recovery stopped. No other model was started.',
    });
  };

  const recoveryModelOptions = React.useMemo(() => {
    const options = new Map(configuredModelOptions.map((option) => [option.value, option]));
    if (!options.has(model)) {
      options.set(model, { value: model, label: `${model} (current target)` });
    }
    return Array.from(options.values()).map((option) => ({
      value: option.value,
      label: option.value === model ? `${option.label} — retry selected model` : option.label,
    }));
  }, [configuredModelOptions, model]);

  const handleStartNewInstance = () => {
    setAutoContinuePaused(true);
    setShowContinueModal(false);
    handleNewCoderThread();
    setActiveTab("coder");
  };

  const explorerTabs: Array<{
    id: typeof activeTab;
    label: string;
    icon: React.ReactNode;
  }> = [
    { id: "coder", label: "Coder Chat", icon: <TerminalSquare className="w-3.5 h-3.5" /> },
    { id: "tests", label: "Test Suite", icon: <Play className="w-3.5 h-3.5" /> },
    { id: "structure", label: "Structure", icon: <FolderOpen className="w-3.5 h-3.5" /> },
    { id: "audits", label: "Run Audits", icon: <History className="w-3.5 h-3.5" /> },
  ];
  const activeWorkspaceRunCount = Number(Boolean(activeRunId || loading)) + Number(Boolean(activeTestSuiteCaseId));
  const workspaceSwitchHasRisk = Boolean(activeWorkspaceRunCount || structureDirty || result?.outputFiles?.length || Object.keys(workspaceFileChanges).length);

  if (showWorkspaceHome) {
    return (
      <>
        <WorkspaceHome
          currentWorkspace={workspace}
          onOpenWorkspace={openWorkspaceFromHome}
          canRemoveWorkspace={!activeWorkspaceRunCount}
        />
        <ConfirmModal
          isOpen={Boolean(pendingWorkspace)}
          title="Switch workspace?"
          message={`Changing to ${pendingWorkspace || "the selected workspace"} will ${activeWorkspaceRunCount > 0 ? "stop active runs, " : ""}${structureDirty ? "discard the unsaved Structure draft, " : ""}${workspaceSwitchHasRisk && !structureDirty && activeWorkspaceRunCount === 0 ? "clear the current workspace result view, " : ""}and refresh the workspace context.`}
          confirmLabel="Switch workspace"
          cancelLabel="Keep current workspace"
          isDangerous={workspaceSwitchHasRisk}
          onConfirm={() => {
            if (pendingWorkspace) void commitWorkspaceChange(pendingWorkspace);
          }}
          onCancel={() => setPendingWorkspace(null)}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-bg-main text-slate-50 selection:bg-cyan-500/20 selection:text-cyan-300">
      <header className="sticky top-0 z-50 border-b border-border-main bg-bg-panel/95 backdrop-blur">
        <div className="flex w-full flex-col gap-3 px-3 py-2.5 sm:px-4 sm:py-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 sm:gap-3">
              <div className="h-3 w-3 shrink-0 rounded-sm bg-cyan-400" />
              <div className="min-w-0">
                <h1 className="truncate font-display text-sm font-semibold uppercase tracking-wider text-white">
                  ReAct Engine Explorer
                </h1>
                <p className="hidden truncate text-[10px] font-medium uppercase tracking-wider text-text-dim sm:block">
                  Autonomous task completion &amp; workspace synthesis
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2.5">
            <div
              className="flex max-w-full items-center gap-1.5 overflow-x-auto rounded border border-border-main bg-bg-active px-2.5 py-1.5 font-mono text-[10px]"
              aria-label="Configured API providers"
            >
              <span className="shrink-0 text-text-dim">APIS:</span>
              {configuredApiProviders.length > 0 ? (
                configuredApiProviders.map((provider) => (
                  <span
                    key={provider.id}
                    className="inline-flex shrink-0 items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300"
                    title={`${provider.targetCount} configured ${provider.targetCount === 1 ? 'model target' : 'model targets'}`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {provider.label}
                  </span>
                ))
              ) : (
                <span className="shrink-0 text-text-dark">NONE SET</span>
              )}
            </div>

            <div
              className={`flex items-center gap-1.5 rounded border px-2 py-1.5 font-mono text-[10px] sm:gap-2 sm:px-3 ${
                mcpConnected
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                  : "border-border-main bg-bg-active text-text-dark"
              }`}
            >
              <span className="relative flex h-1.5 w-1.5">
                {mcpConnected && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                )}
                <span
                  className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                    mcpConnected ? "bg-emerald-400" : "bg-slate-600"
                  }`}
                />
              </span>
              <span className="text-text-dim">MCP:</span>
              <span>{mcpConnected ? "CONNECTED" : "DISCONNECTED"}</span>
            </div>

            <button
              onClick={checkPollenBalance}
              disabled={checkingPollen}
              className={`flex items-center gap-1.5 rounded border px-2 py-1.5 font-mono text-[10px] transition-colors cursor-pointer sm:gap-2 sm:px-3 ${
                pollenStatus?.liveData 
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                  : pollenStatus?.error || !pollenStatus?.hasKey
                  ? 'border-red-500/20 bg-red-500/10 text-red-300 hover:bg-red-500/20'
                  : 'border-border-main bg-bg-active text-text-dim hover:text-white'
              }`}
              title={pollenStatus?.error ? `Error: ${pollenStatus.error}` : pollenStatus?.message || 'Live balance from https://gen.pollinations.ai/account/balance'}
            >
              {checkingPollen ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : pollenStatus?.error || !pollenStatus?.hasKey ? (
                <AlertCircle className="h-3.5 w-3.5" />
              ) : (
                <Flower2 className="h-3.5 w-3.5" />
              )}
              <span className="text-text-dim">POLLEN:</span>
              <span className="font-semibold">
                {checkingPollen
                  ? 'CHECKING'
                  : pollenStatus?.pollen !== null && pollenStatus?.pollen !== undefined
                  ? `${pollenStatus.pollen.toLocaleString()}`
                  : !pollenStatus?.hasKey
                  ? 'NO KEY'
                  : pollenStatus?.error
                  ? 'ERROR'
                  : 'N/A'}
              </span>
            </button>

            <ProjectManager
              workspace={workspace}
              updateWorkspace={handleWorkspaceSelection}
              handleLoadRepoMap={handleLoadRepoMap}
              repoMap={repoMap}
              onOpenFolderModal={openFolderModal}
              triggerRefresh={() => setWorkspaceRefreshTrigger((value) => value + 1)}
            />

            <button
              type="button"
              onClick={() => setShowWorkspaceHome(true)}
              className="flex items-center gap-1.5 rounded border border-border-main bg-bg-active px-2.5 py-1.5 font-mono text-[10px] text-text-dim transition-colors hover:border-cyan-400/30 hover:text-white sm:gap-2 sm:px-3"
              title="Open workspace launcher"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">WORKSPACES</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSettingsModal(true)}
              className="flex items-center gap-1.5 rounded border border-border-main bg-bg-active px-2.5 py-1.5 font-mono text-[10px] text-text-dim transition-colors hover:text-white sm:gap-2 sm:px-3"
            >
              <Settings className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">SETTINGS</span>
            </button>
          </div>
        </div>
      </header>

      <main className={`flex w-full flex-col px-0 ${activeTab === "coder" ? "gap-0 py-0" : "gap-4 py-4 sm:gap-8 sm:py-8"}`}>

        {/* Tab Controls */}
        <nav
          className="flex w-full gap-1 overflow-x-auto border-b border-border-main bg-neutral-950 px-2 font-sans custom-scrollbar sm:gap-2 sm:px-4"
          aria-label="Workspace navigation"
          data-testid="workspace-tabs"
          role="tablist"
        >
          {explorerTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-current={activeTab === tab.id ? "page" : undefined}
              className={`mb-[-1px] flex shrink-0 items-center gap-1.5 rounded-t-md border-x border-t px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors sm:gap-2 sm:px-4 sm:py-2.5 sm:text-[11px] sm:tracking-widest ${
                activeTab === tab.id
                  ? "border-border-main bg-bg-panel text-white"
                  : "border-transparent text-text-dim hover:text-white"
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>

        <FolderSelectorModal
          isOpen={showFolderModal}
          currentPath={fsPath}
          directories={fsDirectories}
          loading={fsLoading || rootLoading}
          error={fsError || rootError}
          parentPath={fsParent || undefined}
          onNavigate={(path) => loadDirectories(path, workspace.trim() || undefined)}
          onSelect={(path) => {
            if (!path.trim()) return;
            handleWorkspaceSelection(path);
          }}
          onClose={() => setShowFolderModal(false)}
        />

        <ConfirmModal
          isOpen={Boolean(pendingWorkspace)}
          title="Switch workspace?"
          message={`Changing to ${pendingWorkspace || "the selected workspace"} will ${activeWorkspaceRunCount > 0 ? "stop active runs, " : ""}${structureDirty ? "discard the unsaved Structure draft, " : ""}${workspaceSwitchHasRisk && !structureDirty && activeWorkspaceRunCount === 0 ? "clear the current workspace result view, " : ""}and refresh the workspace context.`}
          confirmLabel="Switch workspace"
          cancelLabel="Keep current workspace"
          isDangerous={workspaceSwitchHasRisk}
          onConfirm={() => {
            if (pendingWorkspace) void commitWorkspaceChange(pendingWorkspace);
          }}
          onCancel={() => setPendingWorkspace(null)}
        />

        <Modal
          isOpen={showContinueModal}
          title={isPhaseCompletedResult(result) ? "TODO Progress Saved" : isProviderRecoveryResult(result) ? "Provider Unavailable — Choose Action" : "Agent Continuing"}
          icon={<RefreshCw className="w-5 h-5" />}
          onClose={() => {
            setAutoContinuePaused(true);
            setShowContinueModal(false);
          }}
          size="md"
          footer={
            <>
              {isProviderRecoveryResult(result) ? (
                <>
                  <Button onClick={handleOptOutOfFallback} variant="secondary" disabled={loading}>
                    Leave stopped
                  </Button>
                  <Button onClick={handleChangeModelAndContinue} variant="primary" disabled={loading}>
                    Select model to continue
                  </Button>
                </>
              ) : (
                <>
                  <Button onClick={handleStartNewInstance} variant="secondary">
                    New Task
                  </Button>
                  {isAutomaticContinuationResult(result) && !autoContinuePaused && (
                    <Button onClick={() => setAutoContinuePaused(true)} variant="secondary" disabled={loading}>
                      Cancel auto-resume
                    </Button>
                  )}
                  <Button
                    onClick={() => void handleContinueFromCheckpoint()}
                    variant="primary"
                    disabled={loading}
                  >
                    Continue
                  </Button>
                </>
              )}
            </>
          }
        >
          <div className="space-y-3 text-sm text-zinc-300">
            <p>
              {isPhaseCompletedResult(result)
                ? 'This verified progress is saved. The agent can continue from the durable task context.'
                : isProviderRecoveryResult(result)
                  ? isProviderWaitDisabledResult(result)
                    ? 'Automatic waiting is off for this run. Continue to retry the selected model, or choose another provider/model. Nothing changes until you confirm.'
                    : 'The automatic provider retry limit was reached. Continue to retry the selected model, or choose another provider/model. Nothing changes until you confirm.'
                  : 'The agent reached a safe checkpoint and will continue from its preserved task context.'}
            </p>
            {isAutomaticContinuationResult(result) && (
              <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3 text-sm text-cyan-100">
                {autoContinuePaused
                  ? 'Automatic continuation cancelled. Use Continue when you are ready.'
                  : `Continuing automatically from the saved checkpoint in ${autoContinueSeconds} second${autoContinueSeconds === 1 ? '' : 's'}…`}
              </div>
            )}
          </div>
        </Modal>

        <Modal
          isOpen={Boolean(pendingModelChange)}
          title="Choose Provider / Model"
          icon={<RefreshCw className="w-5 h-5" />}
          onClose={handleOptOutOfFallback}
          size="md"
          footer={
            <>
              <Button onClick={handleOptOutOfFallback} variant="secondary" disabled={loading}>
                Leave stopped
              </Button>
              <Button
                onClick={() => void handleConfirmModelChange()}
                variant="primary"
                disabled={!recoveryModel.trim() || loading}
              >
                Continue with selected model
              </Button>
            </>
          }
        >
          <div className="space-y-4 text-sm text-zinc-300">
            <p>
              Automatic waiting is off. The selected model is <span className="font-mono text-cyan-300">{model}</span>.
              Continue with it to retry once, or choose another provider/model before resuming.
            </p>
            <Select
              label="Target model"
              value={recoveryModel}
              onChange={(event) => setRecoveryModel(event.target.value)}
              options={recoveryModelOptions}
              autoFocus
            />
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
              Continuing resumes both planning and execution on the selected target.
              Leaving it stopped makes no provider/model change. Credentials may rotate within that target; model IDs change only when you select and confirm another target.
            </div>
          </div>
        </Modal>

        <Modal
          isOpen={Boolean(pendingPlanApproval)}
          title="Review TODO Before Execution"
          icon={<ClipboardList className="w-5 h-5" />}
          onClose={() => void handlePlanApproval('cancel')}
          size="md"
          footer={
            <>
              <Button
                onClick={() => void handlePlanApproval('reject')}
                variant="secondary"
                disabled={planApprovalBusy || loading}
              >
                Do not run
              </Button>
              <Button
                onClick={() => void handlePlanApproval('edit')}
                variant="secondary"
                disabled={planApprovalBusy || loading || !planApprovalDraft.trim()}
              >
                {planApprovalBusy ? 'Saving...' : 'Save outline edits'}
              </Button>
              <Button
                onClick={() => void handlePlanApproval('approve')}
                variant="primary"
                disabled={planApprovalBusy || loading || !planApprovalDraft.trim()}
              >
                {planApprovalBusy ? 'Saving...' : 'Approve and resume'}
              </Button>
            </>
          }
        >
          <div className="space-y-4 text-sm text-zinc-300">
            <p>
              I understand the request first, then pause here so you can review the work. No workspace tool or mutation has started.
            </p>
            <Textarea
              label="TODO outline (one action per line)"
              value={planApprovalDraft}
              onChange={(event) => setPlanApprovalDraft(event.target.value)}
              rows={Math.min(10, Math.max(4, pendingPlanApproval?.approval.proposedPlan.length || 4))}
              autoFocus
            />
            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3 text-xs text-cyan-100">
              Approve to resume the same run. Edit the outline and save it if the order or scope needs to change.
            </div>
          </div>
        </Modal>

        <Modal
          isOpen={Boolean(pendingUserQuestion)}
          title="Agent Needs Your Input"
          icon={<CornerRightUp className="w-5 h-5" />}
          onClose={() => void handleUserQuestionResponse(true)}
          size="md"
          footer={
            <>
              <Button
                onClick={() => void handleUserQuestionResponse(true)}
                variant="secondary"
                disabled={userQuestionBusy}
              >
                Opt out
              </Button>
              <Button
                onClick={() => void handleUserQuestionResponse(false)}
                variant="primary"
                disabled={userQuestionBusy || (!userQuestionOption.trim() && !userQuestionAnswer.trim())}
              >
                {userQuestionBusy ? 'Sending...' : 'Answer and continue'}
              </Button>
            </>
          }
        >
          <div className="space-y-4 text-sm text-zinc-300">
            <div>
              <div className="font-medium text-white">{pendingUserQuestion?.question}</div>
              {pendingUserQuestion?.context && (
                <p className="mt-2 text-xs text-zinc-400">{pendingUserQuestion.context}</p>
              )}
            </div>
            {Boolean(pendingUserQuestion?.options.length) && (
              <Select
                label="Choose an option"
                value={userQuestionOption}
                onChange={(event) => setUserQuestionOption(event.target.value)}
                options={(pendingUserQuestion?.options || []).map((option) => ({ value: option, label: option }))}
                autoFocus
              />
            )}
            {pendingUserQuestion?.allowFreeform && (
              <Textarea
                label={pendingUserQuestion?.options.length ? 'Additional answer (optional)' : 'Your answer'}
                value={userQuestionAnswer}
                onChange={(event) => setUserQuestionAnswer(event.target.value)}
                placeholder="Tell the agent how you want it to proceed."
                rows={4}
                autoFocus={!pendingUserQuestion?.options.length}
              />
            )}
            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3 text-xs text-cyan-100">
              The current run is paused on the selected model. Your answer resumes this same agent and tool call; no other model is started.
            </div>
          </div>
        </Modal>

        <Modal
          isOpen={Boolean(pendingPolicyApproval)}
          title="Approval Required"
          icon={<ShieldCheck className="w-5 h-5" />}
          onClose={() => setPendingPolicyApproval(null)}
          size="md"
          footer={
            <>
              <Button
                onClick={() => void handlePendingPolicyApproval('deny')}
                variant="secondary"
                disabled={policyApprovalBusy || loading}
              >
                Deny
              </Button>
              <Button
                onClick={() => void handlePendingPolicyApproval('allow')}
                variant="primary"
                disabled={policyApprovalBusy || loading}
              >
                {policyApprovalBusy ? 'Saving...' : 'Approve and resume'}
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-sm text-zinc-300">
            <p>The agent requested permission for an action. Do you want to approve this exact scope and resume the saved run?</p>
            <div className="grid gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
              <div className="flex flex-wrap gap-2 font-mono uppercase tracking-wider text-amber-200">
                <span>{pendingPolicyApproval?.category || 'action'}</span>
                <span>risk: {pendingPolicyApproval?.risk || 'unknown'}</span>
              </div>
              <div className="font-medium text-white">{pendingPolicyApproval?.summary}</div>
              <div className="rounded border border-amber-500/20 bg-zinc-950 p-2 font-mono text-[11px] text-amber-100 break-words">
                {pendingPolicyApproval?.scope}
              </div>
              <div className="text-zinc-400">{pendingPolicyApproval?.reason}</div>
            </div>
          </div>
        </Modal>

        {activeTab === "coder" && (
          <div className="w-full" data-testid="coder-workspace">
            <OrchestrationCenter
              workPlan={workPlan || undefined}
              workPlanLoading={workPlanLoading}
              workPlanApproved={workPlanApproved}
              agentExecutions={agentExecutions}
              conflicts={conflicts}
              diffs={diffs}
              verificationResult={result?.verificationResult}
              taskExecutionStatus={taskExecutionStatus}
              selectedTab={orchestrationPreferences.tab}
              visible={orchestrationPreferences.visible}
              onToggleVisible={() => updateOrchestrationPreferences({ visible: !orchestrationPreferences.visible })}
              onSelectTab={(tab: OrchestrationTab) => updateOrchestrationPreferences({ tab })}
              onApprovePlan={handleApproveWorkPlan}
              onRejectPlan={handleRejectWorkPlan}
              onStart={() => void handleStartExecution()}
              onPause={handlePauseExecution}
              onResume={handleResumeExecution}
              onRerun={() => void handleStartExecution()}
              onNarrowScope={handleNarrowScope}
              onResolveConflict={handleResolveConflict}
            />
            <CoderChatPanel
            task={task}
            model={model}
            loading={loading}
            liveProgress={liveProgress}
            liveState={liveState}
            result={result}
            workspace={workspace}
            thread={coderThread}
            threads={coderThreadState.threads}
            activeThreadId={coderThreadState.activeThreadId}
            resumableRun={activeSessionRun ? {
              id: activeSessionRun.id,
              status: activeSessionRun.status,
              task: typeof activeSessionRun.metadata?.displayTask === "string"
                ? activeSessionRun.metadata.displayTask
                : activeSessionRun.task,
              model: activeSessionRun.model,
            } : activeRunId && loading ? {
              id: activeRunId,
              status: 'running',
              task,
              model,
            } : undefined}
            canContinue={isContinuableResult(result)}
            coderMode={coderMode}
            approvalMode={coderApprovalMode}
            pacingProfile={coderPacingProfile}
            requestBudgetEnabled={requestBudgetEnabled}
            replayGuardEnabled={replayGuardEnabled}
            waitForProviderAvailability={resolveWaitForProviderAvailability()}
            geminiProfiles={geminiProfiles}
            geminiProfileId={geminiProfileId}
            allowCrossProviderFallback={allowCrossProviderFallback}
            taskAnalysis={coderTaskAnalysis}
            agentEvents={coderAgentEvents}
            agentStatus={coderAgentStatus}
            onTaskChange={setTask}
            onCoderModeChange={setCoderMode}
            onApprovalModeChange={setCoderApprovalMode}
            onPacingProfileChange={setCoderPacingProfile}
            onRequestBudgetEnabledChange={handleRequestBudgetEnabledChange}
            onReplayGuardEnabledChange={handleReplayGuardEnabledChange}
            onWaitForProviderAvailabilityChange={handleWaitForProviderAvailabilityChange}
            onGeminiProfileChange={handleGeminiProfileChange}
            onCrossProviderFallbackChange={() => undefined}
            onAuthorizeFallback={undefined}
            onSelectRecoveryModel={fallbackAuthorizationRunId ? handleSelectRecoveryModelForActiveRun : undefined}
            onModelOptionsChange={setConfiguredModelOptions}
            onModelChange={setModel}
            onRunTask={handleRunCoderTask}
            onStopTask={handleStopCoderTask}
            onGenerateWorkPlan={handleGenerateCoderWorkPlan}
            onContinue={handleContinueFromCheckpoint}
            onResumeServerRun={activeSessionRun
              ? () => void handleContinueServerRun(activeSessionRun)
              : undefined}
            onOpenRunAudit={() => {
              setActiveTab("audits");
              setWorkspaceRefreshTrigger((value) => value + 1);
            }}
            onStartNew={handleStartNewInstance}
             onProceedRequest={handleProceedFromThread}
             onPolicyDecision={handlePolicyDecision}
             pendingPolicyApproval={pendingPolicyApproval}
             policyApprovalBusy={policyApprovalBusy}
             onPolicyApprovalDecision={(decision) => void handlePendingPolicyApproval(decision)}
             pendingUserQuestion={pendingUserQuestion}
             showInlinePolicyApproval={false}
             showInlineUserQuestion={false}
             userQuestionOption={userQuestionOption}
             userQuestionAnswer={userQuestionAnswer}
             userQuestionBusy={userQuestionBusy}
             onUserQuestionOptionChange={setUserQuestionOption}
             onUserQuestionAnswerChange={setUserQuestionAnswer}
             onUserQuestionResponse={(cancelled = false) => void handleUserQuestionResponse(cancelled)}
             onUndoChanges={handleUndoCoderChanges}
            onOpenStructureFile={handleOpenStructureFile}
            onOpenSettings={() => setShowSettingsModal(true)}
            onNewThread={handleNewCoderThread}
            onSelectThread={handleSelectCoderThread}
            onDeleteThread={handleDeleteCoderThread}
            onRenameThread={handleRenameCoderThread}
            onClearThread={() =>
              coderThreadState.activeThreadId
                ? handleDeleteCoderThread(coderThreadState.activeThreadId)
                : handleNewCoderThread()
            }
            />
          </div>
        )}

        {activeTab === "tests" && (
          <div className="w-full" data-testid="test-suite-tab">
            <TestSuitePanel
              cases={testSuiteCases}
              runs={testSuiteRuns}
              activeCaseId={activeTestSuiteCaseId}
              activeEvents={coderAgentEvents}
              onRunCase={(testCase) => void runTestSuiteCase(testCase)}
              onRunAll={handleRunAllTestSuiteCases}
              onRetryFailed={handleRetryFailedTestSuiteCases}
              onStop={handleStopTestSuite}
              onOpenChat={handleOpenTestSuiteCase}
              onOpenAudit={handleOpenTestSuiteAudit}
            />
          </div>
        )}

        {activeTab === "structure" && (
          <div className="w-full" data-testid="structure-workspace">
            <React.Suspense fallback={<LoadingSpinner message="Loading workspace structure..." />}>
              <StructureExplorer
                refreshTrigger={workspaceRefreshTrigger}
                workspace={workspace}
                focusRequest={structureFocusRequest}
                fileChanges={Object.values(workspaceFileChanges)}
                onFileChange={(change) => {
                  const key = fileChangeKey(change.path);
                  setWorkspaceFileChanges((current) => ({
                    ...current,
                    [key]: {
                      ...change,
                      changeCount: (current[key]?.changeCount || 0) + 1,
                    },
                  }));
                }}
                onDirtyChange={setStructureDirty}
              />
            </React.Suspense>
          </div>
        )}

        {activeTab === "audits" && (
          <div className="w-full space-y-4" data-testid="audits-workspace">
            {/* Direct LLM Chat — always visible, no harness loop */}
            <React.Suspense fallback={<LoadingSpinner message="Loading chat..." />}>
              <DirectChatPanel model={model} workspace={workspace} />
            </React.Suspense>

            {/* Audit History — collapsible */}
            <div className="rounded-xl border border-border-main bg-bg-panel overflow-hidden">
              <button
                type="button"
                onClick={() => setShowAuditHistory((prev) => !prev)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-bg-active"
                aria-expanded={showAuditHistory}
              >
                <span className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider text-text-dim">
                  <span className="h-2 w-2 rounded-full bg-cyan-500/50" />
                  Run Audit History
                </span>
                <span className="font-mono text-[10px] text-text-dark">
                  {showAuditHistory ? "▲ Collapse" : "▼ Expand"}
                </span>
              </button>
              {showAuditHistory && (
                <div className="border-t border-border-main p-4">
                  <React.Suspense fallback={<LoadingSpinner message="Loading run audits..." />}>
                    <RunAuditsPanel workspace={workspace} refreshToken={workspaceRefreshTrigger} selectedRunId={selectedAuditRunId} onOpenThread={handleOpenAuditThread} />
                  </React.Suspense>
                </div>
              )}
            </div>
          </div>
        )}


        <SettingsModal
          isOpen={showSettingsModal}
          onClose={() => setShowSettingsModal(false)}
          workspace={workspace}
          model={model}
        />

      </main>

      {activeTab !== "coder" && <footer data-testid="workspace-footer" className="mt-8 border-t border-border-main bg-bg-panel px-4 py-4 font-mono text-[10px] text-text-dark sm:px-6 lg:px-8 xl:px-10">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1 text-cyan-500">
              <span>●</span>
              <span>WORKSPACE ACTIVE</span>
            </div>
            <div>LOCAL {new Date().toLocaleTimeString()}</div>
            <div className="flex items-center gap-1">
              <span>ENGINE:</span>
              <span className="text-white">react-engine-077</span>
            </div>
          </div>
          <div>
            BUILD_STATUS: <span className="text-green-500">STABLE</span>
          </div>
        </div>
      </footer>}
    </div>
  );
}

export default App;
