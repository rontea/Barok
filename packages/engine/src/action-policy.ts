export type PolicyCategory =
  | 'read'
  | 'write'
  | 'command'
  | 'network'
  | 'install'
  | 'process'
  | 'git'
  | 'destructive'
  | 'external_service';

export type PolicyRisk = 'low' | 'medium' | 'high' | 'critical';

export interface PolicyAction {
  action: string;
  action_input?: Record<string, unknown>;
}

export interface PolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  category: PolicyCategory;
  risk: PolicyRisk;
  scope: string;
  reason: string;
  summary: string;
}

export interface PolicyAuditRecord extends PolicyDecision {
  timestamp: number;
  taskId?: string;
}

const READ_ONLY_COMMAND_OPERATIONS = new Set([
  'git_status',
  'git_diff',
  'git_log',
  'file_exists',
  'list_directory',
  'process_inspect',
]);

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

/** Classify the requested tool action without requiring a host permission service. */
export function classifyPolicyAction(action: PolicyAction): Pick<PolicyDecision, 'category' | 'risk'> {
  if (action.action === 'PackageInstall') return { category: 'install', risk: 'high' };
  if (action.action === 'ExternalService') return { category: 'external_service', risk: 'high' };
  if (action.action === 'WebSearch') return { category: 'network', risk: 'high' };
  if (action.action === 'Note' || action.action === 'Sample') {
    return action.action_input?.operation === 'add' || action.action_input?.operation === 'set_folder'
      ? { category: 'write', risk: 'medium' }
      : { category: 'read', risk: 'low' };
  }
  if (['Read', 'DocumentRead', 'Glob', 'Grep', 'WorkspaceChanges', 'Wiki', 'Todo', 'WorkPlan'].includes(action.action)) {
    return { category: 'read', risk: 'low' };
  }
  if (['Write', 'Edit'].includes(action.action)) return { category: 'write', risk: 'medium' };
  const operation = action.action_input?.operation;
  if (action.action === 'Command' && typeof operation === 'string' && READ_ONLY_COMMAND_OPERATIONS.has(operation)) {
    return { category: 'read', risk: 'low' };
  }
  const command = commandText(action).toLowerCase();
  const destructiveCommand = /\b(rm\s+-[rfd]*|del\s+\/|remove-item|git\s+(reset\s+--hard|clean\b)|drop\s+(table|database))/.test(command) ||
    /\bformat(?:\.com)?\s+(?:[a-z]:|\/)/.test(command);
  if (destructiveCommand) return { category: 'destructive', risk: 'critical' };
  if (/\b(taskkill|stop-process|kill\s+-|pkill|restart-service|shutdown)\b/.test(command)) return { category: 'process', risk: 'high' };
  if (/\b(npm(?:\.cmd)?|pnpm(?:\.cmd)?|yarn(?:\.cmd)?|bun|pip|cargo|brew)\s+(?:install|i|add|remove|uninstall|update)\b/.test(command)) {
    return { category: 'install', risk: 'high' };
  }
  if (/\b(curl|wget|invoke-webrequest|fetch\(|http[s]?:\/\/|ssh\b|scp\b)\b/.test(command)) return { category: 'network', risk: 'high' };
  if (/\bgit\b/.test(command)) return { category: 'git', risk: /\b(push|commit|merge|rebase)\b/.test(command) ? 'high' : 'low' };
  if (/\b(test|lint|build|typecheck|tsc|jest|vitest|eslint)\b/.test(command)) return { category: 'command', risk: 'low' };
  return { category: 'command', risk: 'medium' };
}
