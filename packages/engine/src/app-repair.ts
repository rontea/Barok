/** Host-neutral repair policies and task-prompt construction for app verification. */

export interface RepairSuggestion {
  check: string;
  failureReason: string;
  suggestedActions: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
}

export interface RepairPlan {
  canRepair: boolean;
  suggestions: RepairSuggestion[];
  summary: string;
}

export interface RepairCheck {
  name: string;
  passed: boolean;
  error?: string;
}

export interface RepairQualityGate {
  name: string;
  passed: boolean;
  critical: boolean;
  description: string;
  failureReason?: string;
}

export interface RepairVerificationResult {
  passed: boolean;
  checks: RepairCheck[];
  signals: Array<{ passed: boolean }>;
  qualityGates?: RepairQualityGate[];
}

export interface RepairManifestInput {
  appName: string;
  requiredOutputFiles?: string[];
}

export interface RepairAppSpecInput {
  appType?: string;
  requiredFeatures?: string[];
}

/** Analyze failed verification checks and rank the supported repair actions. */
export function analyzeFailures(result: RepairVerificationResult): RepairPlan {
  const suggestions: RepairSuggestion[] = [];

  for (const check of result.checks) {
    if (!check.passed) {
      const suggestion = generateRepairSuggestion(check.name, check.error || '');
      if (suggestion) suggestions.push(suggestion);
    }
  }

  const priorityOrder: Record<RepairSuggestion['priority'], number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  suggestions.sort((left, right) => priorityOrder[left.priority] - priorityOrder[right.priority]);

  const canRepair = suggestions.some((suggestion) => suggestion.suggestedActions.length > 0);
  const summary = canRepair
    ? `Found ${suggestions.length} issues that may be repairable. Top priority: ${suggestions[0]?.check}`
    : `Found ${suggestions.length} issues but they require manual fixes or are not repairable.`;

  return { canRepair, suggestions, summary };
}

function generateRepairSuggestion(checkName: string, error: string): RepairSuggestion | null {
  switch (checkName) {
    case 'entry HTML file exists':
      return {
        check: checkName,
        failureReason: 'Entry point file was not created',
        suggestedActions: [
          'Check that the file path is correct in the app spec',
          'Verify the Write action actually created the file',
          'Check for file system errors in the previous step',
        ],
        priority: 'critical',
      };
    case 'loads without uncaught console errors':
      return {
        check: checkName,
        failureReason: `Console errors detected: ${error}`,
        suggestedActions: [
          'Review the generated code for JavaScript errors',
          'Check for missing dependencies or library imports',
          'Verify that API endpoints or data sources are accessible',
          'Inspect the HTML/CSS syntax for correctness',
        ],
        priority: 'high',
      };
    case 'desktop and mobile layout render without overlap':
      return {
        check: checkName,
        failureReason: 'Layout is not responsive or has overflow issues',
        suggestedActions: [
          'Add or update CSS media queries for mobile viewports',
          'Ensure root container has max-width constraints',
          'Use flexbox or CSS Grid for better responsive design',
          'Add viewport meta tag if missing',
          'Check for horizontal scroll or overflow:hidden issues',
        ],
        priority: 'high',
      };
    case 'primary interactive controls respond':
      return {
        check: checkName,
        failureReason: 'No interactive controls detected in the app',
        suggestedActions: [
          'Add buttons or input fields for user interaction',
          'Implement click handlers or event listeners',
          'Ensure interactive elements are visible and not hidden',
          'Check that the app type requires interactivity',
        ],
        priority: 'high',
      };
    case 'game can start or restart':
      return {
        check: checkName,
        failureReason: 'No restart/start button found for the game',
        suggestedActions: [
          'Add a visible "Restart" or "Start Game" button',
          'Implement game state initialization and reset logic',
          'Ensure the button is properly wired to game logic',
        ],
        priority: 'high',
      };
    case 'project builds successfully':
      return {
        check: checkName,
        failureReason: `Build failed: ${error}`,
        suggestedActions: [
          'Check for TypeScript or Vite configuration errors',
          'Verify that all dependencies are installed (npm install)',
          'Look for syntax errors in src files',
          'Ensure all imports and exports are correct',
          'Check the build logs for specific error messages',
        ],
        priority: 'critical',
      };
    default:
      return null;
  }
}

/** Format a repair plan as an actionable prompt. */
export function formatRepairPrompt(plan: RepairPlan, appName: string): string {
  if (!plan.canRepair) {
    return `The app "${appName}" failed verification with issues that may require manual fixes. ` +
      `Issues found:\n${plan.suggestions.map((suggestion) => `- ${suggestion.check}: ${suggestion.failureReason}`).join('\n')}`;
  }

  const priorityActions = plan.suggestions
    .filter((suggestion) => suggestion.priority === 'critical')
    .map((suggestion) => `- ${suggestion.check}: ${suggestion.suggestedActions.join('; ')}`)
    .join('\n');
  return `The app "${appName}" failed verification checks. Please repair the code to fix these critical issues:\n\n${priorityActions}\n\nRetest after making changes.`;
}

/** Retry only when a failed verification still has at least one successful signal. */
export function shouldRepair(result: RepairVerificationResult, _maxRepairAttempts = 2): boolean {
  if (result.passed) return false;
  return result.signals.some((signal) => signal.passed);
}

export function getRepairSuccessLikelihood(
  failedSignals: number,
  totalSignals: number,
): 'high' | 'medium' | 'low' {
  const passRate = (totalSignals - failedSignals) / totalSignals;
  if (passRate >= 0.75) return 'high';
  if (passRate >= 0.5) return 'medium';
  return 'low';
}

/** Build the scoped repair task from verification evidence and declared outputs. */
export function createRepairTask(
  manifest: RepairManifestInput,
  result: RepairVerificationResult,
  appSpec?: RepairAppSpecInput,
  repairFiles: string[] = [],
): string {
  const plan = analyzeFailures(result);
  const failedChecks = result.checks.filter((check) => !check.passed);
  const passedSignals = result.signals.filter((signal) => signal.passed).length;
  const criticalGateFails = result.qualityGates?.filter((gate) => !gate.passed && gate.critical) || [];
  const hasQualityGateFails = criticalGateFails.length > 0;

  let repairPrompt = `
Repair Task: ${manifest.appName} (App Verification)

Original Request: ${appSpec ? `${appSpec.appType || 'unknown'} app with ${(appSpec.requiredFeatures || []).join(', ')}` : 'unknown'}

Repair policy:
- This is an incremental repair pass over the existing implementation, not a new app build.
- Preserve features and behavior that already passed verification, as well as unrelated user changes.
- Inspect the current files and current workspace diff first, find the smallest cause, and prefer a focused Edit/minimal patch.
- Do not regenerate or rewrite an existing file wholesale unless it is genuinely missing or the verification issue requires a whole-file replacement.
- If a prior side-effecting action had an uncertain outcome, inspect the workspace before attempting it again.

Verification Results:
- Passed: ${passedSignals}/${result.signals.length} signals
- Failed Checks: ${failedChecks.length}`;

  if (hasQualityGateFails) {
    repairPrompt += `
- Critical Quality Gate Failures: ${criticalGateFails.length}
${criticalGateFails.map((gate) => `  ❌ ${gate.name}: ${gate.description}`).join('\n')}`;
  }

  if (repairFiles.length > 0) {
    repairPrompt += `

Repair file scope discovered from the generated app:
${repairFiles.map((file) => `- ${file}`).join('\n')}

Read each existing target before editing it. Existing-file Write/Edit actions must use the guarded hash returned by that Read. Keep changes within this scope unless a newly discovered app reference justifies expanding it.`;
  }

  const requiredOutputs = Array.isArray(manifest.requiredOutputFiles)
    ? manifest.requiredOutputFiles.filter((file: unknown): file is string => typeof file === 'string' && Boolean(file.trim()))
    : [];
  if (requiredOutputs.length > 0) {
    repairPrompt += `

Required app deliverables:
${requiredOutputs.map((file) => `- ${file}`).join('\n')}

Ensure every required deliverable exists inside the active workspace. Create a missing declared deliverable when needed, and keep its local HTML CSS/JavaScript references valid.`;
  }

  repairPrompt += `

Critical Issues to Fix:
${plan.suggestions
    .filter((suggestion) => suggestion.priority === 'critical' || suggestion.priority === 'high')
    .map((suggestion) => `- ${suggestion.check}: ${suggestion.failureReason}\n  Actions: ${suggestion.suggestedActions.join('; ')}`)
    .join('\n')}`;

  if (hasQualityGateFails) {
    repairPrompt += `

Quality Gate Failures (must be fixed for app to be "good"):
${criticalGateFails.map((gate) => `- ${gate.name}: ${gate.failureReason || gate.description}`).join('\n')}`;
  }

  repairPrompt += `

Please:
- Review the existing generated files and current diff.
- Fix the most critical issues with the smallest scoped change${hasQualityGateFails ? '; prioritize the quality gate failures' : ''}.
- Re-run verification after fixes.
- Continue until all critical checks pass.

Focus on: ${criticalGateFails[0]?.name || failedChecks[0]?.name || 'general improvements'}
`;

  return repairPrompt;
}
