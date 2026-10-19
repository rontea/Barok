/**
 * Phase 6: Verification Result Storage
 * Store and retrieve verification results in run history
 */

import type { RepairTask, VerificationResult } from './verificationPlanner.js';

/**
 * Stored verification result with metadata
 */
export interface StoredVerification {
  id: string;
  workPlanId: string;
  result: VerificationResult;
  layers: string[];
  changedFiles: string[];
  timestamp: Date;
  executorAgent?: string;
  repairTasks?: RepairTask[];
  notes?: string;
}

/**
 * Verification history
 */
export interface VerificationHistory {
  totalVerifications: number;
  passedCount: number;
  failedCount: number;
  partialCount: number;
  avgConfidence: number;
  verifications: StoredVerification[];
}

/**
 * In-memory verification result store (in real implementation, would use database)
 */
let verificationStore: Map<string, StoredVerification> = new Map();
let verificationHistory: StoredVerification[] = [];

/**
 * Store verification result
 */
export function storeVerificationResult(
  verification: StoredVerification
): void {
  const id = verification.id || generateVerificationId();
  verification.id = id;
  verification.timestamp = new Date();

  verificationStore.set(id, verification);
  verificationHistory.push(verification);
}

/**
 * Retrieve verification result by ID
 */
export function getVerificationResult(id: string): StoredVerification | undefined {
  return verificationStore.get(id);
}

/**
 * Get verification history
 */
export function getVerificationHistory(): VerificationHistory {
  const passedCount = verificationHistory.filter(
    (v) => v.result.status === 'passed'
  ).length;
  const failedCount = verificationHistory.filter(
    (v) => v.result.status === 'failed'
  ).length;
  const partialCount = verificationHistory.filter(
    (v) => v.result.status === 'partial'
  ).length;

  const avgConfidence =
    verificationHistory.length > 0
      ? verificationHistory.reduce((sum, v) => sum + v.result.confidence, 0) /
        verificationHistory.length
      : 0;

  return {
    totalVerifications: verificationHistory.length,
    passedCount,
    failedCount,
    partialCount,
    avgConfidence,
    verifications: verificationHistory.slice(-20), // Return last 20
  };
}

/**
 * Get verifications for a specific work plan
 */
export function getVerificationsForWorkPlan(
  workPlanId: string
): StoredVerification[] {
  return verificationHistory.filter((v) => v.workPlanId === workPlanId);
}

/**
 * Get failed verifications
 */
export function getFailedVerifications(): StoredVerification[] {
  return verificationHistory.filter(
    (v) => v.result.status === 'failed' || v.result.status === 'partial'
  );
}

/**
 * Get verifications by layer
 */
export function getVerificationsByLayer(layer: string): StoredVerification[] {
  return verificationHistory.filter((v) => v.layers.includes(layer));
}

/**
 * Get recent verifications
 */
export function getRecentVerifications(count: number = 10): StoredVerification[] {
  return verificationHistory.slice(-count);
}

/**
 * Calculate success rate
 */
export function calculateSuccessRate(): number {
  if (verificationHistory.length === 0) return 100;

  const passedCount = verificationHistory.filter(
    (v) => v.result.status === 'passed'
  ).length;

  return (passedCount / verificationHistory.length) * 100;
}

/**
 * Get average verification confidence
 */
export function getAverageConfidence(): number {
  if (verificationHistory.length === 0) return 1;

  return (
    verificationHistory.reduce((sum, v) => sum + v.result.confidence, 0) /
    verificationHistory.length
  );
}

/**
 * Get most common failure types
 */
export function getMostCommonFailures(): Record<string, number> {
  const failureMap: Record<string, number> = {};

  for (const verification of verificationHistory) {
    for (const check of verification.result.failedChecks) {
      const key = check.checkType;
      failureMap[key] = (failureMap[key] || 0) + 1;
    }
  }

  return failureMap;
}

/**
 * Generate verification report
 */
export function generateVerificationReport(): string {
  const history = getVerificationHistory();
  const successRate = calculateSuccessRate();
  const avgConfidence = getAverageConfidence();
  const commonFailures = getMostCommonFailures();

  let report = '# Verification Report\n\n';
  report += `## Overall Statistics\n`;
  report += `- Total Verifications: ${history.totalVerifications}\n`;
  report += `- Passed: ${history.passedCount} (${((history.passedCount / history.totalVerifications) * 100).toFixed(1)}%)\n`;
  report += `- Failed: ${history.failedCount}\n`;
  report += `- Partial: ${history.partialCount}\n`;
  report += `- Success Rate: ${successRate.toFixed(1)}%\n`;
  report += `- Average Confidence: ${(avgConfidence * 100).toFixed(1)}%\n\n`;

  if (Object.keys(commonFailures).length > 0) {
    report += `## Most Common Failures\n\n`;
    const sortedFailures = Object.entries(commonFailures)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    for (const [checkType, count] of sortedFailures) {
      report += `- ${checkType}: ${count} times\n`;
    }
  }

  return report;
}

/**
 * Clear verification history (for testing)
 */
export function clearVerificationHistory(): void {
  verificationStore.clear();
  verificationHistory = [];
}

/**
 * Generate unique verification ID
 */
export function generateVerificationId(): string {
  return `verify-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Export verification for external use
 */
export function exportVerificationData(): unknown {
  return {
    verifications: verificationHistory,
    statistics: getVerificationHistory(),
    successRate: calculateSuccessRate(),
    averageConfidence: getAverageConfidence(),
    commonFailures: getMostCommonFailures(),
  };
}

/**
 * Attach repair task to verification
 */
export function attachRepairTask(
  verificationId: string,
  repairTask: RepairTask
): void {
  const verification = verificationStore.get(verificationId);
  if (verification) {
    if (!verification.repairTasks) {
      verification.repairTasks = [];
    }
    verification.repairTasks.push(repairTask);
  }
}

/**
 * Get repair tasks for verification
 */
export function getRepairTasksForVerification(
  verificationId: string
): RepairTask[] {
  const verification = verificationStore.get(verificationId);
  return verification?.repairTasks || [];
}
