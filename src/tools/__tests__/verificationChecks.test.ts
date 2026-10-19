/**
 * Phase 6: Layer-Specific Verification Checks Tests
 */

import {
  checkFrontendTypeScript,
  checkFrontendLint,
  checkFrontendBuild,
  checkFrontendPlaywright,
  checkFrontendResponsive,
  checkFrontendConsoleErrors,
  runFrontendChecks,
} from '../verificationChecks/frontendChecks';

import {
  checkBackendTypeScript,
  checkBackendLint,
  checkBackendValidation,
  checkBackendAPISmoke,
  checkBackendSecurity,
  runBackendChecks,
} from '../verificationChecks/backendChecks';

import {
  checkDataSchema,
  checkDataPersistence,
  checkDataSeedData,
  checkTestUnitTests,
  checkTestIntegrationTests,
  checkDocsLinks,
  checkDocsExamples,
  checkDocsReferences,
  checkDocsAPINames,
  runDataChecks,
  runTestChecks,
  runDocsChecks,
} from '../verificationChecks/dataTestDocsChecks';

describe('Phase 6: Layer-Specific Verification Checks', () => {
  describe('Frontend Checks', () => {
    it('should run TypeScript check for frontend', () => {
      const result = checkFrontendTypeScript();

      expect(result.checkType).toBe('typescript');
      expect(typeof result.duration).toBe('number');
      expect(result.details.layer).toBe('frontend');
    });

    it('should run linting check', () => {
      const result = checkFrontendLint();

      expect(result.checkType).toBe('lint');
      expect(result.details.layer).toBe('frontend');
      expect(result.details.tool).toBe('eslint');
    });

    it('should run build check', () => {
      const result = checkFrontendBuild();

      expect(result.checkType).toBe('build');
      expect(result.details.layer).toBe('frontend');
      expect(result.details.tool).toBe('vite');
    });

    it('should run Playwright tests', () => {
      const result = checkFrontendPlaywright();

      expect(result.checkType).toBe('playwright');
      expect(result.details.testsRun).toBeGreaterThan(0);
    });

    it('should run responsive check', () => {
      const result = checkFrontendResponsive();

      expect(result.checkType).toBe('responsive');
      expect(result.details.viewportsChecked).toBeGreaterThan(0);
    });

    it('should run console error check', () => {
      const result = checkFrontendConsoleErrors();

      expect(result.checkType).toBe('console-errors');
      expect(result.details.errorsFound).toBeDefined();
    });

    it('should run all frontend checks', () => {
      const results = runFrontendChecks();

      expect(results.length).toBeGreaterThan(3);
      expect(results.some((r) => r.checkType === 'typescript')).toBe(true);
      expect(results.some((r) => r.checkType === 'build')).toBe(true);
    });

    it('should respect check configuration', () => {
      const results = runFrontendChecks({
        checkTypeScript: true,
        checkBuild: false,
      });

      expect(results.some((r) => r.checkType === 'typescript')).toBe(true);
      expect(results.some((r) => r.checkType === 'build')).toBe(false);
    });
  });

  describe('Backend Checks', () => {
    it('should run TypeScript check for backend', () => {
      const result = checkBackendTypeScript();

      expect(result.checkType).toBe('typescript');
      expect(result.details.layer).toBe('backend');
    });

    it('should run validation check', () => {
      const result = checkBackendValidation();

      expect(result.checkType).toBe('validation');
      expect(result.details.routesChecked).toBeGreaterThan(0);
    });

    it('should run API smoke tests', () => {
      const result = checkBackendAPISmoke();

      expect(result.checkType).toBe('api-smoke');
      expect(result.details.endpointsTested).toBeGreaterThan(0);
    });

    it('should run security checks', () => {
      const result = checkBackendSecurity();

      expect(result.checkType).toBe('security');
      expect(result.details.authMiddlewarePresent).toBeDefined();
      expect(result.details.vulnerabilitiesFound).toBe(0);
    });

    it('should run all backend checks', () => {
      const results = runBackendChecks();

      expect(results.length).toBeGreaterThan(2);
      expect(results.some((r) => r.checkType === 'typescript')).toBe(true);
      expect(results.some((r) => r.checkType === 'api-smoke')).toBe(true);
    });

    it('should respect check configuration', () => {
      const results = runBackendChecks({
        checkTypeScript: false,
        checkSecurity: true,
      });

      expect(results.some((r) => r.checkType === 'typescript')).toBe(false);
      expect(results.some((r) => r.checkType === 'security')).toBe(true);
    });
  });

  describe('Data Checks', () => {
    it('should check database schema', () => {
      const result = checkDataSchema();

      expect(result.checkType).toBe('schema');
      expect(result.details.layer).toBe('data');
      expect(result.details.tablesValidated).toBeGreaterThan(0);
    });

    it('should check persistence layer', () => {
      const result = checkDataPersistence();

      expect(result.checkType).toBe('persistence');
      expect(result.details.operationsTested).toBeGreaterThan(0);
    });

    it('should check seed data', () => {
      const result = checkDataSeedData();

      expect(result.checkType).toBe('seed-data');
      expect(result.details.seedFilesValidated).toBeGreaterThan(0);
    });

    it('should run all data checks', () => {
      const results = runDataChecks();

      expect(results.length).toBe(3);
      expect(results.some((r) => r.checkType === 'schema')).toBe(true);
      expect(results.some((r) => r.checkType === 'persistence')).toBe(true);
    });
  });

  describe('Test Checks', () => {
    it('should run unit tests', () => {
      const result = checkTestUnitTests();

      expect(result.checkType).toBe('unit-tests');
      expect(result.details.testsRun).toBeGreaterThan(0);
      expect(result.details.testsPassed).toBe(result.details.testsRun);
    });

    it('should run focused unit tests', () => {
      const result = checkTestUnitTests(true);

      expect(result.details.focused).toBe(true);
      expect(result.details.testsRun).toBeLessThan(100);
    });

    it('should run integration tests', () => {
      const result = checkTestIntegrationTests();

      expect(result.checkType).toBe('integration-tests');
      expect(result.details.testsRun).toBeGreaterThan(0);
    });

    it('should run test checks with focused mode', () => {
      const results = runTestChecks({ focusedOnly: true });

      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.details.focused !== true || r.checkType === 'unit-tests')).toBe(true);
    });
  });

  describe('Docs Checks', () => {
    it('should check documentation links', () => {
      const result = checkDocsLinks();

      expect(result.checkType).toBe('links');
      expect(result.details.filesScanned).toBeGreaterThan(0);
      expect(result.details.linksChecked).toBeGreaterThan(0);
    });

    it('should check code examples', () => {
      const result = checkDocsExamples();

      expect(result.checkType).toBe('examples');
      expect(result.details.examplesValidated).toBeGreaterThan(0);
    });

    it('should check file references', () => {
      const result = checkDocsReferences();

      expect(result.checkType).toBe('references');
      expect(result.details.referencesChecked).toBeGreaterThan(0);
    });

    it('should check API names', () => {
      const result = checkDocsAPINames();

      expect(result.checkType).toBe('api-names');
      expect(result.details.apiNamesDocumented).toBeGreaterThan(0);
    });

    it('should run all docs checks', () => {
      const results = runDocsChecks();

      expect(results.length).toBe(4);
      expect(results.map((r) => r.checkType)).toContain('links');
      expect(results.map((r) => r.checkType)).toContain('examples');
    });
  });

  describe('Check result properties', () => {
    it('should include duration in all checks', () => {
      const frontendCheck = checkFrontendTypeScript();
      const backendCheck = checkBackendTypeScript();
      const dataCheck = checkDataSchema();

      expect(typeof frontendCheck.duration).toBe('number');
      expect(typeof backendCheck.duration).toBe('number');
      expect(typeof dataCheck.duration).toBe('number');
    });

    it('should include details object', () => {
      const checks = [
        checkFrontendBuild(),
        checkBackendValidation(),
        checkDataPersistence(),
      ];

      for (const check of checks) {
        expect(check.details).toBeDefined();
        expect(typeof check.details).toBe('object');
      }
    });

    it('should have layer information in details', () => {
      const checks = [
        checkFrontendTypeScript(),
        checkBackendLint(),
        checkDataSchema(),
      ];

      for (const check of checks) {
        expect(check.details.layer).toBeDefined();
      }
    });
  });

  describe('Integration scenarios', () => {
    it('should run all checks for full verification', () => {
      const frontendChecks = runFrontendChecks();
      const backendChecks = runBackendChecks();
      const dataChecks = runDataChecks();
      const docChecks = runDocsChecks();

      const allChecks = [
        ...frontendChecks,
        ...backendChecks,
        ...dataChecks,
        ...docChecks,
      ];

      expect(allChecks.length).toBeGreaterThanOrEqual(15);
    });

    it('should handle check configuration across layers', () => {
      const frontendChecks = runFrontendChecks({ checkPlaywright: true });
      const backendChecks = runBackendChecks({ checkSecurity: true });

      expect(
        frontendChecks.some((r) => r.checkType === 'playwright')
      ).toBe(true);
      expect(
        backendChecks.some((r) => r.checkType === 'security')
      ).toBe(true);
    });
  });
});
