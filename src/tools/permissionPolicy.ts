import { realpathSync } from 'fs';
import { isAbsolute, relative, resolve } from 'path';
import { validateAndResolvePath } from '@barok/adapter-node';
import { redactPolicyText } from '@barok/core';
import { classifyPolicyAction } from '@barok/engine';
import type { PolicyAction, PolicyAuditRecord, PolicyCategory, PolicyDecision, PolicyRisk } from '@barok/engine';

export { redactPolicyPayload, redactPolicyText } from '@barok/core';
export { classifyPolicyAction } from '@barok/engine';
export type { PolicyAction, PolicyAuditRecord, PolicyCategory, PolicyDecision, PolicyRisk } from '@barok/engine';

export type PermissionMode = 'read_only' | 'ask' | 'scoped_auto_approve' | 'full_workspace';

export interface PolicyContext {
  workspace: string;
  mode: PermissionMode;
  taskId?: string;
  approvedScopes?: Iterable<string>;
  approvalGrants?: Iterable<ApprovalScopeGrant>;
  ownedProcessIds?: Iterable<number>;
}

/** A durable, task-scoped user decision. Expired grants are never reused. */
export interface ApprovalScopeGrant {
  scope: string;
  decision: 'allow' | 'deny';
  createdAt: number;
  expiresAt?: number;
  reason?: string;
}

function commandText(action: PolicyAction): string {
  const input = action.action_input || {};
  if (action.action === 'PackageInstall') {
    const manager = typeof input.manager === 'string' && input.manager !== 'auto' ? input.manager : 'npm';
    const packages = Array.isArray(input.packages) ? input.packages.filter((item): item is string => typeof item === 'string') : [];
    return [manager, manager === 'npm' ? 'install' : packages.length ? 'add' : 'install', input.dev === true ? '--save-dev' : '', ...packages]
      .filter(Boolean)
      .join(' ');
  }
  return action.action === 'Command'
    ? [input.operation, input.script, input.cwd].filter((value) => typeof value === 'string').join(' ')
    : String(input.command || '');
}

function shellTokens(value: string): string[] {
  return [...value.matchAll(/"([^"]*)"|'([^']*)'|([^\s]+)/g)]
    .map((match) => match[1] ?? match[2] ?? match[3])
    .filter(Boolean);
}

export function getCanonicalInstallScope(action: PolicyAction): string | undefined {
  const input = action.action_input || {};
  let manager = 'auto';
  let packages: string[] = [];
  let dev = false;
  let extraFlags: string[] = [];

  if (action.action === 'PackageInstall') {
    manager = typeof input.manager === 'string' ? input.manager.toLowerCase().replace(/\.cmd$/, '') : 'auto';
    packages = Array.isArray(input.packages)
      ? input.packages.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim())
      : [];
    dev = input.dev === true;
  } else {
    const command = commandText(action).trim();
    if (!command || /(?:&&|\|\||[;<>])/.test(command)) return undefined;
    const tokens = shellTokens(command);
    const executable = tokens.shift()?.toLowerCase().replace(/\.cmd$/, '');
    const operation = tokens.shift()?.toLowerCase();
    if (!executable || !['npm', 'pnpm', 'yarn', 'bun'].includes(executable)) return undefined;
    const validOperation = executable === 'npm'
      ? operation === 'install' || operation === 'i'
      : operation === 'install' || operation === 'add';
    if (!validOperation) return undefined;
    manager = executable;
    for (const token of tokens) {
      if (['-d', '--dev', '--save-dev'].includes(token.toLowerCase())) dev = true;
      else if (token.startsWith('-')) extraFlags.push(token.toLowerCase());
      else packages.push(token);
    }
  }

  const normalizedPackages = Array.from(new Set(packages)).sort((left, right) => left.localeCompare(right));
  extraFlags = Array.from(new Set(extraFlags)).sort();
  const cwd = typeof input.cwd === 'string' && input.cwd.trim()
    ? input.cwd.trim().replace(/\\/g, '/').replace(/\/$/, '')
    : '.';
  return `install:${manager}:${dev ? 'dev' : 'prod'}:${normalizedPackages.join(',') || '(declared)'}:cwd=${cwd}${extraFlags.length ? `:flags=${extraFlags.join(',')}` : ''}`;
}

function actionPath(action: PolicyAction): string | undefined {
  const input = action.action_input || {};
  const value = input.file_path ?? input.path;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function activeApprovalGrants(grants: Iterable<ApprovalScopeGrant> | undefined, now = Date.now()): ApprovalScopeGrant[] {
  return [...(grants || [])].filter((grant) => Boolean(grant.scope) && (grant.expiresAt === undefined || grant.expiresAt > now));
}

export function approvedScopesFromGrants(grants: Iterable<ApprovalScopeGrant> | undefined, now = Date.now()): string[] {
  return activeApprovalGrants(grants, now).filter((grant) => grant.decision === 'allow').map((grant) => grant.scope);
}

function scopeMatches(grantScope: string, scope: string): boolean {
  return grantScope === '*' || grantScope === scope;
}

function isScopeDenied(scope: string, context: PolicyContext): boolean {
  return activeApprovalGrants(context.approvalGrants).some((grant) => grant.decision === 'deny' && scopeMatches(grant.scope, scope));
}

function isScopeApproved(scope: string, context: PolicyContext): boolean {
  const approved = new Set(context.approvedScopes || []);
  return approved.has(scope) || approved.has('*') || activeApprovalGrants(context.approvalGrants).some(
    (grant) => grant.decision === 'allow' && scopeMatches(grant.scope, scope)
  );
}

function pathSafetyReason(action: PolicyAction, workspace: string): string | undefined {
  const requestedPath = actionPath(action);
  if (!requestedPath) return undefined;
  try {
    const resolved = validateAndResolvePath(requestedPath, workspace);
    try {
      const realWorkspace = realpathSync(workspace);
      const realTarget = realpathSync(resolved);
      const rel = relative(realWorkspace, realTarget);
      if (rel.startsWith('..') || isAbsolute(rel)) return 'Resolved symlink escapes the workspace.';
    } catch {
      // A new target may not exist yet. The lexical workspace validation remains mandatory.
    }
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : 'Path is outside the workspace.';
  }
}

function processOwnershipReason(command: string, context: PolicyContext): string | undefined {
  const match = command.match(/\b(?:taskkill\s+\/pid|stop-process\s+-id|kill\s+-\w+|kill)\s+(\d+)/i);
  if (!match) return undefined;
  const pid = Number(match[1]);
  if (!new Set(context.ownedProcessIds || []).has(pid)) return `Process ${pid} is not owned by this task.`;
  return undefined;
}

/** Authoritative action authorization for planner guidance and executor dispatch. */
export function evaluatePolicy(action: PolicyAction, context: PolicyContext): PolicyDecision {
  const classification = classifyPolicyAction(action);
  const path = actionPath(action);
  const scope = classification.category === 'install'
    ? getCanonicalInstallScope(action) || `${classification.category}:${path || commandText(action) || action.action}`
    : `${classification.category}:${path || commandText(action) || action.action}`;
  const summary = redactPolicyText(`${action.action}${path ? ` ${path}` : commandText(action) ? ` ${commandText(action)}` : ''}`);
  const blocked = (reason: string): PolicyDecision => ({ allowed: false, requiresApproval: false, ...classification, scope, reason, summary });

  const pathError = pathSafetyReason(action, context.workspace);
  if (pathError) return blocked(`Workspace safety check failed: ${pathError}`);
  const ownershipError = classification.category === 'process' ? processOwnershipReason(commandText(action), context) : undefined;
  if (ownershipError) return blocked(ownershipError);
  if (isScopeDenied(scope, context)) return blocked('This action scope was explicitly denied by the user.');
  if (context.mode === 'read_only' && classification.category !== 'read') return blocked('Read-only mode permits inspection only.');

  const approved = isScopeApproved(scope, context);
  const highAuthority = ['destructive', 'install', 'network', 'process', 'external_service'].includes(classification.category);
  if (highAuthority && !approved) {
    return { allowed: false, requiresApproval: true, ...classification, scope, reason: 'This high-risk action requires an explicit approval scope.', summary };
  }
  if (context.mode === 'ask' && classification.category !== 'read' && classification.risk !== 'low' && !approved) {
    return { allowed: false, requiresApproval: true, ...classification, scope, reason: 'Ask mode requires approval for this action scope.', summary };
  }
  return { allowed: true, requiresApproval: false, ...classification, scope, reason: approved ? 'Allowed by reusable approval scope.' : 'Allowed by active permission mode.', summary };
}

export function policyGuidance(context: PolicyContext): string {
  return `Permission mode: ${context.mode}. Workspace and symlink boundaries are mandatory. Reads are allowed; writes and commands are checked by the same policy as execution. Destructive, install, network, external-service, and process actions require an explicit approval scope. Historical approvals do not apply outside this task.`;
}

export function recordPolicyDecision(target: PolicyAuditRecord[] | undefined, decision: PolicyDecision, taskId?: string): void {
  target?.push({ ...decision, taskId, timestamp: Date.now() });
}
