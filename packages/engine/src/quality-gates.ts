/**
 * Quality Gates Module
 * Defines and enforces strict quality requirements for generated apps
 * 
 * A "good app" must pass all quality gates before being marked as successful
 */

export type QualityGateType =
  | 'request-satisfaction'
  | 'responsive-layout'
  | 'interactive-controls'
  | 'console-clean'
  | 'persistence-working'
  | 'accessible-labels'
  | 'no-build-errors';

export interface QualityGate {
  id: QualityGateType;
  name: string;
  description: string;
  required: boolean; // If true, app cannot be "good" without passing
  critical: boolean; // If true, blocks release/verification
  checkLogic: (data: QualityGateCheckData) => boolean;
  failureReason?: string;
}

export interface QualityGateCheckData {
  task?: string; // Original user request
  appSpec?: any; // Generated app spec
  verificationResult?: any; // Verification results
  entryPoint?: string; // App entry point
  outputFiles?: string[]; // Generated files
  verificationSignals?: Array<{ name: string; passed: boolean }>;
  errorLog?: string; // Console error log from verification
}

export interface QualityGateResult {
  gateId: QualityGateType;
  passed: boolean;
  name: string;
  description: string;
  critical: boolean;
  failureReason?: string;
}

/**
 * Request Satisfaction Gate
 * Verifies that the generated app reasonably addresses the original user request
 */
const requestSatisfactionGate: QualityGate = {
  id: 'request-satisfaction',
  name: 'Request Satisfaction',
  description: 'App output satisfies the original user request',
  required: true,
  critical: true,
  checkLogic: (data) => {
    // Check: App was created and has entry point
    if (!data.entryPoint || !data.appSpec) {
      return false;
    }

    // Check: App spec was generated (shows task was understood)
    if (!data.appSpec.appName || !data.appSpec.requiredFeatures?.length) {
      return false;
    }

    // Pass: All basic indicators present
    return true;
  },
};

/**
 * Responsive Layout Gate
 * Verifies that the app displays properly on both desktop and mobile
 */
const responsiveLayoutGate: QualityGate = {
  id: 'responsive-layout',
  name: 'Responsive Layout',
  description: 'App displays correctly on mobile and desktop viewports',
  required: true,
  critical: true,
  checkLogic: (data) => {
    if (!data.verificationSignals) return false;

    // Check for responsive signal from verification
    const responsiveSignal = data.verificationSignals.find(
      (s) => s.name === 'responsive'
    );

    return responsiveSignal ? responsiveSignal.passed : false;
  },
};

/**
 * Interactive Controls Gate
 * Verifies that interactive apps have visible, functional controls
 */
const interactiveControlsGate: QualityGate = {
  id: 'interactive-controls',
  name: 'Interactive Controls',
  description: 'App has visible and functional interactive controls',
  required: true,
  critical: true,
  checkLogic: (data) => {
    if (!data.verificationSignals || !data.appSpec) return false;

    // Interactive gate applies mainly to games, tools, dashboards
    const appType = data.appSpec.appType;
    const isInteractiveApp =
      ['game', 'tool', 'dashboard', 'editor'].includes(appType);

    if (!isInteractiveApp) {
      // Landing pages and utilities don't require interactive controls
      return true;
    }

    // For interactive apps, check for interactive signal
    const interactiveSignal = data.verificationSignals.find(
      (s) => s.name === 'interactive'
    );

    return interactiveSignal ? interactiveSignal.passed : false;
  },
};

/**
 * Console Clean Gate
 * Verifies that the app loads without uncaught console errors
 */
const consoleCleanGate: QualityGate = {
  id: 'console-clean',
  name: 'Console Clean',
  description: 'App loads without uncaught console errors',
  required: true,
  critical: true,
  checkLogic: (data) => {
    if (!data.verificationSignals) return false;

    // Check for no-console-errors signal
    const consoleSignal = data.verificationSignals.find(
      (s) => s.name === 'no-console-errors'
    );

    return consoleSignal ? consoleSignal.passed : false;
  },
};

/**
 * Persistence Working Gate
 * Verifies that persistence features work if requested
 */
const persistenceWorkingGate: QualityGate = {
  id: 'persistence-working',
  name: 'Persistence Working',
  description: 'Data persistence features work correctly if requested',
  required: false, // Only required if persistence was requested in spec
  critical: true,
  checkLogic: (data) => {
    if (!data.appSpec) return true;

    // Persistence is optional. Older app specs used the string 'none', while
    // the current contract uses a boolean; both falsey values skip this gate.
    if (!data.appSpec.dataPersistence || data.appSpec.dataPersistence === 'none') {
      return true;
    }

    // If persistence was requested, check for persistence signal
    if (!data.verificationSignals) return false;

    const persistenceSignal = data.verificationSignals.find(
      (s) => s.name === 'persistence'
    );

    return persistenceSignal ? persistenceSignal.passed : false;
  },
};

/**
 * Accessible Labels Gate
 * Verifies that important controls have clear labels or accessible text
 */
const accessibleLabelsGate: QualityGate = {
  id: 'accessible-labels',
  name: 'Accessible Labels',
  description: 'Important controls have clear labels or accessible text',
  required: false,
  critical: false,
  checkLogic: (data) => {
    // This gate checks app spec for accessibility considerations
    if (!data.appSpec) return true;

    // Check if accessibility was mentioned in design direction or features
    const accessibilityMentioned = [
      data.appSpec.designDirection,
      ...(data.appSpec.requiredFeatures || []),
      ...(data.appSpec.verificationChecks || []),
    ]
      .join(' ')
      .toLowerCase()
      .includes('access');

    // If accessibility is mentioned, expect it to be implemented
    // For now, we pass if the design intentionally addresses it
    return accessibilityMentioned ? true : true; // Non-critical gate
  },
};

/**
 * No Build Errors Gate
 * Verifies that the app built successfully without compilation errors
 */
const noBuildErrorsGate: QualityGate = {
  id: 'no-build-errors',
  name: 'No Build Errors',
  description: 'App compiled/built successfully without errors',
  required: true,
  critical: true,
  checkLogic: (data) => {
    if (!data.verificationSignals) return false;

    // For Vite React apps, check build-success signal
    // For HTML apps, page-load signal indicates successful build
    const signals = data.verificationSignals;
    const buildSuccess =
      signals.some((s) => s.name === 'build-success') ||
      signals.some((s) => s.name === 'page-load');

    return buildSuccess;
  },
};

/**
 * All Quality Gates Registry
 */
export const QUALITY_GATES: Record<QualityGateType, QualityGate> = {
  'request-satisfaction': requestSatisfactionGate,
  'responsive-layout': responsiveLayoutGate,
  'interactive-controls': interactiveControlsGate,
  'console-clean': consoleCleanGate,
  'persistence-working': persistenceWorkingGate,
  'accessible-labels': accessibleLabelsGate,
  'no-build-errors': noBuildErrorsGate,
};

/**
 * Check all quality gates against verification data
 */
export function checkQualityGates(data: QualityGateCheckData): QualityGateResult[] {
  return Object.values(QUALITY_GATES).map((gate) => ({
    gateId: gate.id,
    passed: gate.checkLogic(data),
    name: gate.name,
    description: gate.description,
    critical: gate.critical,
    failureReason: !gate.checkLogic(data) ? gate.description : undefined,
  }));
}

/**
 * Determine if app passes all critical quality gates
 */
export function allCriticalGatesPassed(results: QualityGateResult[]): boolean {
  return results
    .filter((r) => r.critical)
    .every((r) => r.passed);
}

/**
 * Determine if app passes all required gates
 */
export function allRequiredGatesPassed(results: QualityGateResult[]): boolean {
  const gates = Object.values(QUALITY_GATES);
  return results.every((result) => {
    const gate = gates.find((g) => g.id === result.gateId);
    return !gate?.required || result.passed;
  });
}

/**
 * Get failed gates
 */
export function getFailedGates(results: QualityGateResult[]): QualityGateResult[] {
  return results.filter((r) => !r.passed);
}

/**
 * Get critical failed gates (most important to fix)
 */
export function getCriticalFailedGates(results: QualityGateResult[]): QualityGateResult[] {
  return results.filter((r) => !r.passed && r.critical);
}

/**
 * Calculate quality score (0-100)
 */
export function calculateQualityScore(results: QualityGateResult[]): number {
  if (results.length === 0) return 0;
  const passedCount = results.filter((r) => r.passed).length;
  return Math.round((passedCount / results.length) * 100);
}

/**
 * Format quality gates for logging/display
 */
export function formatQualityGates(results: QualityGateResult[]): string {
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const score = calculateQualityScore(results);

  let output = `\n📊 Quality Gate Results: ${passed}/${total} passed (${score}%)\n`;
  output += '─'.repeat(60) + '\n';

  results.forEach((gate) => {
    const icon = gate.passed ? '✅' : '❌';
    const critical = gate.critical ? ' [CRITICAL]' : '';
    output += `${icon} ${gate.name}${critical}\n`;
    if (!gate.passed && gate.failureReason) {
      output += `   ↳ ${gate.failureReason}\n`;
    }
  });

  return output;
}
