/**
 * Phase 3.3 - Real-World Work Plan Scenarios
 * Realistic scenarios for validating work plans across multiple layers
 * Combines Phase 3.1 (orchestrator), Phase 3.2 (integration), and Phase 2 context
 */

import type { FullStackWorkPlan } from './workPlanOrchestrator.js';
import type { IntegratedWorkPlan, Phase2Context } from './workPlanIntegration.js';

/**
 * Scenario definition with expected outcomes
 */
export interface WorkPlanScenario {
  name: string;
  description: string;
  userRequest: string;
  expectedClassification: string;
  expectedComplexity: string;
  expectedLayers: string[];
  affectedFiles: string[];
  expectedModuleCount: number;
  expectedRiskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval: boolean;
  expectedWarnings: number;
  expectedErrors: number;
  validationCriteria: {
    canProceed: boolean;
    requiresManualReview: boolean;
    escalationNeeded: boolean;
  };
}

/**
 * Bug Fix Scenario: Fix authentication validation issue
 */
export const bugFixAuthValidationScenario: WorkPlanScenario = {
  name: 'Bug Fix: Auth Validation',
  description: 'Fix authentication validation logic that incorrectly rejects valid tokens',
  userRequest: 'Fix auth validation bug that rejects valid JWT tokens due to incorrect expiry check',
  expectedClassification: 'bug_fix',
  expectedComplexity: 'simple',
  expectedLayers: ['backend', 'tests'],
  affectedFiles: [
    'src/middleware/auth.ts',
    'src/middleware/__tests__/auth.test.ts',
    'tests/integration/auth.test.ts',
  ],
  expectedModuleCount: 1,
  expectedRiskLevel: 'low',
  requiresApproval: false,
  expectedWarnings: 0,
  expectedErrors: 0,
  validationCriteria: {
    canProceed: true,
    requiresManualReview: false,
    escalationNeeded: false,
  },
};

/**
 * Feature Scenario: Add two-factor authentication
 */
export const featureTwoFactorAuthScenario: WorkPlanScenario = {
  name: 'Feature: Two-Factor Auth',
  description: 'Add two-factor authentication to improve account security',
  userRequest: 'Add two-factor authentication with TOTP and backup codes. Include UI forms and API endpoints.',
  expectedClassification: 'new_feature',
  expectedComplexity: 'complex',
  expectedLayers: ['backend', 'frontend', 'data', 'tests'],
  affectedFiles: [
    'src/services/authService.ts',
    'src/api/2fa.ts',
    'src/middleware/auth.ts',
    'ui/components/Login.tsx',
    'ui/components/Setup2FA.tsx',
    'ui/pages/Profile.tsx',
    'data/migrations/add_2fa_tables.sql',
    'tests/integration/2fa.test.ts',
  ],
  expectedModuleCount: 2,
  expectedRiskLevel: 'medium',
  requiresApproval: false,
  expectedWarnings: 1,
  expectedErrors: 0,
  validationCriteria: {
    canProceed: true,
    requiresManualReview: true,
    escalationNeeded: false,
  },
};

/**
 * Refactoring Scenario: Extract auth service layer
 */
export const refactorAuthServiceExtractionScenario: WorkPlanScenario = {
  name: 'Refactor: Extract Auth Service',
  description: 'Extract authentication logic from middleware into dedicated service for reusability',
  userRequest: 'Refactor authentication logic out of middleware into a reusable AuthService class with clear interfaces',
  expectedClassification: 'refactor',
  expectedComplexity: 'moderate',
  expectedLayers: ['backend', 'tests'],
  affectedFiles: [
    'src/services/authService.ts',
    'src/middleware/auth.ts',
    'src/api/routes/auth.ts',
    'src/__tests__/services/authService.test.ts',
    'tests/integration/auth.test.ts',
  ],
  expectedModuleCount: 1,
  expectedRiskLevel: 'medium',
  requiresApproval: false,
  expectedWarnings: 1,
  expectedErrors: 0,
  validationCriteria: {
    canProceed: true,
    requiresManualReview: true,
    escalationNeeded: false,
  },
};

/**
 * Infrastructure Scenario: Update authentication provider
 */
export const infrastructureAuthProviderScenario: WorkPlanScenario = {
  name: 'Infrastructure: Update Auth Provider',
  description: 'Migrate from custom JWT auth to OAuth2 with multiple providers',
  userRequest: 'Update authentication to use OAuth2 providers (Google, GitHub) instead of JWT. Update all auth middleware.',
  expectedClassification: 'infrastructure',
  expectedComplexity: 'expert',
  expectedLayers: ['backend', 'frontend', 'config', 'tests'],
  affectedFiles: [
    'package.json',
    'src/config/auth.ts',
    'src/middleware/auth.ts',
    'src/api/routes/auth.ts',
    'src/services/authService.ts',
    'ui/components/Login.tsx',
    'ui/config/oauth.ts',
    '.env.example',
    'tests/integration/oauth.test.ts',
  ],
  expectedModuleCount: 2,
  expectedRiskLevel: 'critical',
  requiresApproval: true,
  expectedWarnings: 3,
  expectedErrors: 0,
  validationCriteria: {
    canProceed: true,
    requiresManualReview: true,
    escalationNeeded: true,
  },
};

/**
 * Multi-Layer Scenario: Add feature across all layers
 */
export const multiLayerUserOnboardingScenario: WorkPlanScenario = {
  name: 'Multi-Layer: User Onboarding Flow',
  description: 'Complete user onboarding with forms, backend processing, data persistence, and tests',
  userRequest: 'Add complete user onboarding flow with welcome wizard, email verification, and preference setup',
  expectedClassification: 'new_feature',
  expectedComplexity: 'complex',
  expectedLayers: ['frontend', 'backend', 'data', 'tests', 'docs'],
  affectedFiles: [
    'ui/components/WelcomeWizard.tsx',
    'ui/components/EmailVerification.tsx',
    'ui/pages/Onboarding.tsx',
    'src/api/onboarding.ts',
    'src/services/onboardingService.ts',
    'src/middleware/onboarding.ts',
    'data/migrations/add_onboarding_state.sql',
    'tests/integration/onboarding.test.ts',
    'docs/api/onboarding.md',
  ],
  expectedModuleCount: 3,
  expectedRiskLevel: 'high',
  requiresApproval: false,
  expectedWarnings: 2,
  expectedErrors: 0,
  validationCriteria: {
    canProceed: true,
    requiresManualReview: true,
    escalationNeeded: false,
  },
};

/**
 * Validates a work plan scenario
 */
export function validateScenario(
  scenario: WorkPlanScenario,
  workPlan: FullStackWorkPlan | IntegratedWorkPlan
): {
  passes: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check classification
  if (workPlan.classification !== scenario.expectedClassification) {
    errors.push(
      `Classification mismatch: expected '${scenario.expectedClassification}', got '${workPlan.classification}'`
    );
  }

  // Check complexity
  if (workPlan.estimatedComplexity !== scenario.expectedComplexity) {
    warnings.push(
      `Complexity differs: expected '${scenario.expectedComplexity}', got '${workPlan.estimatedComplexity}'`
    );
  }

  // Check layers are covered
  const layerCoverage = scenario.expectedLayers.every((layer) =>
    workPlan.touchedLayers.includes(layer as any)
  );
  if (!layerCoverage) {
    warnings.push(
      `Not all expected layers covered. Expected: ${scenario.expectedLayers.join(', ')}, Got: ${workPlan.touchedLayers.join(', ')}`
    );
  }

  // Check file count is reasonable
  if (workPlan.affectedFiles.length < scenario.affectedFiles.length * 0.7) {
    warnings.push(
      `Fewer files affected than expected. Expected ~${scenario.affectedFiles.length}, got ${workPlan.affectedFiles.length}`
    );
  }

  // Check integrated work plan specific fields
  if ('impactedModules' in workPlan && 'dependencyImpactAnalysis' in workPlan) {
    const integrated = workPlan as IntegratedWorkPlan;

    if (integrated.impactedModules.length === 0 && scenario.expectedModuleCount > 0) {
      warnings.push('No modules identified even though changes affect multiple layers');
    }

    if (integrated.dependencyImpactAnalysis.riskLevel !== scenario.expectedRiskLevel) {
      warnings.push(
        `Risk level mismatch: expected '${scenario.expectedRiskLevel}', got '${integrated.dependencyImpactAnalysis.riskLevel}'`
      );
    }

    if (integrated.safetyAssessment.requiresManualReview !== scenario.validationCriteria.requiresManualReview) {
      warnings.push(
        `Manual review requirement mismatch: expected ${scenario.validationCriteria.requiresManualReview}, got ${integrated.safetyAssessment.requiresManualReview}`
      );
    }
  }

  return {
    passes: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Generates scenario report
 */
export function generateScenarioReport(
  scenario: WorkPlanScenario,
  validation: ReturnType<typeof validateScenario>
): string[] {
  const lines: string[] = [];

  lines.push('╔════════════════════════════════════════════════════════════╗');
  lines.push(`║  SCENARIO VALIDATION REPORT: ${scenario.name.padEnd(26)}║`);
  lines.push('╚════════════════════════════════════════════════════════════╝');
  lines.push('');

  lines.push(`📝 Description: ${scenario.description}`);
  lines.push(`📋 Request: "${scenario.userRequest}"`);
  lines.push('');

  lines.push('📊 Expected Properties:');
  lines.push(`   Classification: ${scenario.expectedClassification}`);
  lines.push(`   Complexity: ${scenario.expectedComplexity}`);
  lines.push(`   Layers: ${scenario.expectedLayers.join(', ')}`);
  lines.push(`   Modules: ${scenario.expectedModuleCount}`);
  lines.push(`   Risk Level: ${scenario.expectedRiskLevel}`);
  lines.push(`   Requires Approval: ${scenario.requiresApproval}`);
  lines.push('');

  if (validation.passes) {
    lines.push('✅ VALIDATION: PASSED');
  } else {
    lines.push('❌ VALIDATION: FAILED');
  }

  if (validation.errors.length > 0) {
    lines.push('');
    lines.push('🚫 ERRORS:');
    for (const error of validation.errors) {
      lines.push(`   • ${error}`);
    }
  }

  if (validation.warnings.length > 0) {
    lines.push('');
    lines.push('⚠️  WARNINGS:');
    for (const warning of validation.warnings) {
      lines.push(`   • ${warning}`);
    }
  }

  lines.push('');
  lines.push('╔════════════════════════════════════════════════════════════╗');

  return lines;
}

/**
 * All scenarios for comprehensive testing
 */
export const allScenarios: WorkPlanScenario[] = [
  bugFixAuthValidationScenario,
  featureTwoFactorAuthScenario,
  refactorAuthServiceExtractionScenario,
  infrastructureAuthProviderScenario,
  multiLayerUserOnboardingScenario,
];
