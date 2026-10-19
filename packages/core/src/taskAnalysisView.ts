import { redactPolicyText } from './policyRedaction.js';

export type ProjectFileLayer = 'ui' | 'backend' | 'shared' | 'config' | 'docs' | 'tests' | 'unknown';
export type CoderTaskKind =
  | 'question'
  | 'investigation'
  | 'bug_fix'
  | 'new_feature'
  | 'refactor'
  | 'test_only'
  | 'docs_only'
  | 'continuation'
  | 'new_instance';
export type FileChangeIntent = 'read_only' | 'create' | 'modify' | 'delete' | 'rename' | 'unknown';
export type ApprovalPolicy = 'ask' | 'auto_approve' | 'full_access';
export type CoderTaskInstanceMode = 'continuation' | 'new_instance' | 'unknown';
export type CoderTaskTargetLayer = ProjectFileLayer | 'full_stack';
export type CoderTaskBehaviorScope = 'read_only' | 'existing_behavior_fix' | 'new_behavior' | 'new_instance' | 'maintenance';
export type CoderTaskRefactorRisk = 'safe_change' | 'risky_refactor';
export type CoderTaskRiskLevel = 'low' | 'medium' | 'high';

export interface CoderTaskAnalysisView {
  id: string;
  taskKind: CoderTaskKind;
  instanceMode: CoderTaskInstanceMode;
  targetLayer: CoderTaskTargetLayer;
  behaviorScope: CoderTaskBehaviorScope;
  refactorRisk: CoderTaskRefactorRisk;
  confidence: number;
  expectedChangeIntent: FileChangeIntent;
  mentionedFiles: string[];
  inferredFiles: string[];
  sourceFiles: string[];
  affectedFiles: Array<{
    path: string;
    intent: FileChangeIntent;
    reason: string;
    mustReadBeforeEdit: boolean;
  }>;
  riskLevel: CoderTaskRiskLevel;
  riskFactors: string[];
  requiresApproval: boolean;
  approvalPolicy?: ApprovalPolicy;
  requiredInspections: string[];
  verificationPlan: string[];
  validationRequirements: string[];
  rationale: string;
}

const taskKinds = new Set<CoderTaskKind>([
  'question', 'investigation', 'bug_fix', 'new_feature', 'refactor',
  'test_only', 'docs_only', 'continuation', 'new_instance',
]);
const changeIntents = new Set<FileChangeIntent>(['read_only', 'create', 'modify', 'delete', 'rename', 'unknown']);
const approvalPolicies = new Set<ApprovalPolicy>(['ask', 'auto_approve', 'full_access']);

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function boundedText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = redactPolicyText(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, limit) : undefined;
}

function textList(value: unknown, countLimit = 30, textLimit = 320): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    const text = boundedText(item, textLimit);
    if (text) result.push(text);
    if (result.length >= countLimit) break;
  }
  return result;
}

function boundedPath(value: unknown, workspace: string | undefined): string | undefined {
  const text = boundedText(value, 300);
  if (!text) return undefined;
  const normalized = text.replace(/\\/g, '/');
  const normalizedWorkspace = workspace?.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalizedWorkspace && normalized.toLowerCase().startsWith(`${normalizedWorkspace.toLowerCase()}/`)) {
    return normalized.slice(normalizedWorkspace.length + 1).replace(/^\.\//, '');
  }
  if (/^[a-z]:\//i.test(normalized) || normalized.startsWith('/')) {
    return normalized.split('/').filter(Boolean).slice(-3).join('/');
  }
  return normalized.replace(/^\.\//, '');
}

function pathList(value: unknown, workspace: string | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    const path = boundedPath(item, workspace);
    if (path) result.push(path);
    if (result.length >= 50) break;
  }
  return result;
}

function changeIntent(value: unknown): FileChangeIntent {
  return typeof value === 'string' && changeIntents.has(value as FileChangeIntent)
    ? value as FileChangeIntent
    : 'unknown';
}

/** Allowlist the user-facing analysis fields and bound all strings and arrays. */
export function toCoderTaskAnalysisView(value: unknown): CoderTaskAnalysisView | undefined {
  const analysis = record(value);
  if (!analysis) return undefined;
  const workspace = boundedText(analysis.workspace, 1_000);

  const affectedFiles: CoderTaskAnalysisView['affectedFiles'] = [];
  if (Array.isArray(analysis.affectedFiles)) {
    for (const rawFile of analysis.affectedFiles) {
      const file = record(rawFile);
      const path = boundedPath(file?.path, workspace);
      if (!path) continue;
      affectedFiles.push({
        path,
        intent: changeIntent(file?.intent),
        reason: boundedText(file?.reason, 320) || '',
        mustReadBeforeEdit: file?.mustReadBeforeEdit === true,
      });
      if (affectedFiles.length >= 50) break;
    }
  }

  const taskKind = typeof analysis.taskKind === 'string' && taskKinds.has(analysis.taskKind as CoderTaskKind)
    ? analysis.taskKind as CoderTaskKind
    : 'investigation';
  const confidence = typeof analysis.confidence === 'number' && Number.isFinite(analysis.confidence)
    ? Math.max(0, Math.min(1, analysis.confidence))
    : 0;
  const approvalPolicy = typeof analysis.approvalPolicy === 'string' && approvalPolicies.has(analysis.approvalPolicy as ApprovalPolicy)
    ? analysis.approvalPolicy as ApprovalPolicy
    : undefined;

  return {
    id: boundedText(analysis.id, 120) || 'task-analysis',
    taskKind,
    instanceMode: analysis.instanceMode === 'continuation' || analysis.instanceMode === 'new_instance'
      ? analysis.instanceMode
      : 'unknown',
    targetLayer: typeof analysis.targetLayer === 'string'
      && ['ui', 'backend', 'shared', 'config', 'docs', 'tests', 'unknown', 'full_stack'].includes(analysis.targetLayer)
      ? analysis.targetLayer as CoderTaskTargetLayer
      : 'unknown',
    behaviorScope: typeof analysis.behaviorScope === 'string'
      && ['read_only', 'existing_behavior_fix', 'new_behavior', 'new_instance', 'maintenance'].includes(analysis.behaviorScope)
      ? analysis.behaviorScope as CoderTaskBehaviorScope
      : 'maintenance',
    refactorRisk: analysis.refactorRisk === 'risky_refactor' ? 'risky_refactor' : 'safe_change',
    confidence,
    expectedChangeIntent: changeIntent(analysis.expectedChangeIntent),
    mentionedFiles: pathList(analysis.mentionedFiles, workspace),
    inferredFiles: pathList(analysis.inferredFiles, workspace),
    sourceFiles: pathList(analysis.sourceFiles, workspace),
    affectedFiles,
    riskLevel: analysis.riskLevel === 'medium' || analysis.riskLevel === 'high' ? analysis.riskLevel : 'low',
    riskFactors: textList(analysis.riskFactors, 20, 240),
    requiresApproval: analysis.requiresApproval === true,
    ...(approvalPolicy ? { approvalPolicy } : {}),
    requiredInspections: textList(analysis.requiredInspections, 30, 320),
    verificationPlan: textList(analysis.verificationPlan, 30, 320),
    validationRequirements: textList(analysis.validationRequirements, 30, 320),
    rationale: boundedText(analysis.rationale, 1_000) || '',
  };
}
