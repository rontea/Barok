import { validateReactResult, validateReactStep } from '@barok/engine';
import {
  validateReactResult as validateLegacyReactResult,
  validateReactStep as validateLegacyReactStep,
} from '../responseValidator.js';

describe('Engine ReAct output validation', () => {
  const validStep = {
    thought: 'Inspect the requested file.',
    action: 'Read',
    action_input: { path: 'src/app.ts' },
  };

  test('accepts a valid step and keeps the compatibility validator behavior', () => {
    expect(validateReactStep(validStep)).toEqual({ success: true, data: validStep });
    expect(validateLegacyReactStep(validStep)).toEqual(validateReactStep(validStep));
  });

  test('reports the same field errors through Engine and the old validator path', () => {
    const invalidStep = { thought: 12, action: 'Read', action_input: [] };
    const result = validateReactStep(invalidStep);
    expect(result.success).toBe(false);
    expect(result.errors?.map(({ field }) => field)).toEqual(['thought', 'action_input']);
    expect(validateLegacyReactStep(invalidStep)).toEqual(result);
  });

  test('validates result steps and nonnegative integer step counts', () => {
    const result = {
      success: true,
      steps: [validStep],
      stepCount: 1,
    };
    expect(validateReactResult(result)).toEqual({ success: true, data: result });
    expect(validateLegacyReactResult(result)).toEqual(validateReactResult(result));
    expect(validateReactResult({ ...result, stepCount: -1 }).success).toBe(false);
  });
});
