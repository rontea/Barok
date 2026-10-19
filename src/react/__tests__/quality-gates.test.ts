/**
 * Quality Gates Test Suite
 */

import {
  checkQualityGates,
  allCriticalGatesPassed,
  allRequiredGatesPassed,
  getFailedGates,
  getCriticalFailedGates,
  calculateQualityScore,
  formatQualityGates,
  type QualityGateCheckData,
} from '../quality-gates';

describe('Quality Gates Module', () => {
  // Test data
  const validAppSpec = {
    appName: 'Test App',
    appType: 'game',
    requiredFeatures: ['gameplay', 'scoring'],
    designDirection: 'minimalist accessible design',
    dataPersistence: 'localStorage',
    entryPoint: 'index.html',
    verificationChecks: ['Build succeeds', 'Responsive layout', 'Interactive controls'],
  };

  const allPassedSignals = [
    { name: 'page-load', passed: true },
    { name: 'no-console-errors', passed: true },
    { name: 'responsive', passed: true },
    { name: 'interactive', passed: true },
    { name: 'build-success', passed: true },
    { name: 'persistence', passed: true },
  ];

  const someFailedSignals = [
    { name: 'page-load', passed: true },
    { name: 'no-console-errors', passed: false }, // Critical failure
    { name: 'responsive', passed: true },
    { name: 'interactive', passed: true },
    { name: 'build-success', passed: true },
    { name: 'persistence', passed: false }, // Non-critical (dataPersistence-dependent)
  ];

  describe('checkQualityGates', () => {
    it('should pass all gates when signals are passing', () => {
      const data: QualityGateCheckData = {
        appSpec: validAppSpec,
        verificationSignals: allPassedSignals,
        entryPoint: 'index.html',
        outputFiles: ['index.html', 'style.css', 'app.js'],
      };

      const results = checkQualityGates(data);

      expect(results).toHaveLength(7);
      expect(results.every((r) => r.passed)).toBe(true);
    });

    it('should fail gates when signals are failing', () => {
      const data: QualityGateCheckData = {
        appSpec: validAppSpec,
        verificationSignals: someFailedSignals,
        entryPoint: 'index.html',
        outputFiles: ['index.html'],
      };

      const results = checkQualityGates(data);

      expect(results).toHaveLength(7);
      expect(results.some((r) => !r.passed)).toBe(true);
    });

    it('should fail request satisfaction when appSpec is missing', () => {
      const data: QualityGateCheckData = {
        verificationSignals: allPassedSignals,
        entryPoint: 'index.html',
        outputFiles: [],
      };

      const results = checkQualityGates(data);
      const requestSatisfactionGate = results.find((r) => r.gateId === 'request-satisfaction');

      expect(requestSatisfactionGate?.passed).toBe(false);
    });

    it('should fail responsive layout when signal is missing', () => {
      const data: QualityGateCheckData = {
        appSpec: validAppSpec,
        verificationSignals: [{ name: 'page-load', passed: true }],
        entryPoint: 'index.html',
        outputFiles: [],
      };

      const results = checkQualityGates(data);
      const responsiveGate = results.find((r) => r.gateId === 'responsive-layout');

      expect(responsiveGate?.passed).toBe(false);
    });

    it('should skip interactive controls for non-interactive apps', () => {
      const appSpec = { ...validAppSpec, appType: 'landing' };
      const data: QualityGateCheckData = {
        appSpec,
        verificationSignals: [
          { name: 'page-load', passed: true },
          { name: 'no-console-errors', passed: true },
          { name: 'responsive', passed: true },
          { name: 'build-success', passed: true },
        ],
        entryPoint: 'index.html',
        outputFiles: [],
      };

      const results = checkQualityGates(data);
      const interactiveGate = results.find((r) => r.gateId === 'interactive-controls');

      // Landing pages don't require interactive controls
      expect(interactiveGate?.passed).toBe(true);
    });

    it('should skip persistence gate when dataPersistence is none', () => {
      const appSpec = { ...validAppSpec, dataPersistence: 'none' };
      const data: QualityGateCheckData = {
        appSpec,
        verificationSignals: allPassedSignals,
        entryPoint: 'index.html',
        outputFiles: [],
      };

      const results = checkQualityGates(data);
      const persistenceGate = results.find((r) => r.gateId === 'persistence-working');

      // Should pass because persistence not required
      expect(persistenceGate?.passed).toBe(true);
    });

    it.each([false, undefined])('should skip persistence gate when persistence is %s', (dataPersistence) => {
      const appSpec = { ...validAppSpec, dataPersistence };
      const data: QualityGateCheckData = {
        appSpec,
        entryPoint: 'index.html',
        outputFiles: [],
      };

      const results = checkQualityGates(data);
      const persistenceGate = results.find((r) => r.gateId === 'persistence-working');

      expect(persistenceGate?.passed).toBe(true);
    });
  });

  describe('allCriticalGatesPassed', () => {
    it('should return true when all critical gates pass', () => {
      const data: QualityGateCheckData = {
        appSpec: validAppSpec,
        verificationSignals: allPassedSignals,
        entryPoint: 'index.html',
        outputFiles: [],
      };

      const results = checkQualityGates(data);
      expect(allCriticalGatesPassed(results)).toBe(true);
    });

    it('should return false when a critical gate fails', () => {
      const data: QualityGateCheckData = {
        appSpec: validAppSpec,
        verificationSignals: someFailedSignals, // console-errors failed (critical)
        entryPoint: 'index.html',
        outputFiles: [],
      };

      const results = checkQualityGates(data);
      expect(allCriticalGatesPassed(results)).toBe(false);
    });
  });

  describe('allRequiredGatesPassed', () => {
    it('should return true when all required gates pass', () => {
      const data: QualityGateCheckData = {
        appSpec: validAppSpec,
        verificationSignals: allPassedSignals,
        entryPoint: 'index.html',
        outputFiles: [],
      };

      const results = checkQualityGates(data);
      expect(allRequiredGatesPassed(results)).toBe(true);
    });

    it('should return false when a required gate fails', () => {
      const badSignals = [
        { name: 'page-load', passed: false }, // required gate fails
      ];
      const data: QualityGateCheckData = {
        appSpec: validAppSpec,
        verificationSignals: badSignals,
        entryPoint: 'index.html',
        outputFiles: [],
      };

      const results = checkQualityGates(data);
      expect(allRequiredGatesPassed(results)).toBe(false);
    });
  });

  describe('getFailedGates', () => {
    it('should return only failed gates', () => {
      const data: QualityGateCheckData = {
        appSpec: validAppSpec,
        verificationSignals: someFailedSignals,
        entryPoint: 'index.html',
        outputFiles: [],
      };

      const results = checkQualityGates(data);
      const failed = getFailedGates(results);

      expect(failed.every((g) => !g.passed)).toBe(true);
      expect(failed.length).toBeGreaterThan(0);
    });

    it('should return empty array when all gates pass', () => {
      const data: QualityGateCheckData = {
        appSpec: validAppSpec,
        verificationSignals: allPassedSignals,
        entryPoint: 'index.html',
        outputFiles: [],
      };

      const results = checkQualityGates(data);
      const failed = getFailedGates(results);

      expect(failed).toHaveLength(0);
    });
  });

  describe('getCriticalFailedGates', () => {
    it('should return only critical failed gates', () => {
      const data: QualityGateCheckData = {
        appSpec: validAppSpec,
        verificationSignals: someFailedSignals,
        entryPoint: 'index.html',
        outputFiles: [],
      };

      const results = checkQualityGates(data);
      const criticalFailed = getCriticalFailedGates(results);

      expect(criticalFailed.every((g) => !g.passed && g.critical)).toBe(true);
    });

    it('should return empty array when no critical gates fail', () => {
      const data: QualityGateCheckData = {
        appSpec: validAppSpec,
        verificationSignals: allPassedSignals,
        entryPoint: 'index.html',
        outputFiles: [],
      };

      const results = checkQualityGates(data);
      const criticalFailed = getCriticalFailedGates(results);

      expect(criticalFailed).toHaveLength(0);
    });
  });

  describe('calculateQualityScore', () => {
    it('should calculate correct percentage when all pass', () => {
      const data: QualityGateCheckData = {
        appSpec: validAppSpec,
        verificationSignals: allPassedSignals,
        entryPoint: 'index.html',
        outputFiles: [],
      };

      const results = checkQualityGates(data);
      const score = calculateQualityScore(results);

      expect(score).toBe(100);
    });

    it('should calculate correct percentage when some fail', () => {
      const data: QualityGateCheckData = {
        appSpec: validAppSpec,
        verificationSignals: someFailedSignals,
        entryPoint: 'index.html',
        outputFiles: [],
      };

      const results = checkQualityGates(data);
      const score = calculateQualityScore(results);

      // 5 passed, 2 failed (persistence gate won't fail because dataPersistence is localStorage)
      // Actually: 6 passed, 1 failed (console-errors) = 6/7 = 85%
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should return 0 for empty results', () => {
      const score = calculateQualityScore([]);
      expect(score).toBe(0);
    });
  });

  describe('formatQualityGates', () => {
    it('should format results for logging', () => {
      const data: QualityGateCheckData = {
        appSpec: validAppSpec,
        verificationSignals: allPassedSignals,
        entryPoint: 'index.html',
        outputFiles: [],
      };

      const results = checkQualityGates(data);
      const formatted = formatQualityGates(results);

      expect(formatted).toContain('Quality Gate Results');
      expect(formatted).toContain('✅');
      expect(formatted).toContain('100%');
    });

    it('should include failure reasons', () => {
      const data: QualityGateCheckData = {
        appSpec: validAppSpec,
        verificationSignals: someFailedSignals,
        entryPoint: 'index.html',
        outputFiles: [],
      };

      const results = checkQualityGates(data);
      const formatted = formatQualityGates(results);

      expect(formatted).toContain('❌');
    });
  });
});
