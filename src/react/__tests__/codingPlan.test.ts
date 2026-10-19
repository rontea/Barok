import { describe, expect, it } from '@jest/globals';
import { parseCodingPlan, tryParseCodingPlan } from '../codingPlan.js';
import { classifyCodingTask } from '../model-router.js';

describe('coding task routing and structured planning', () => {
  it('uses one call for informational work and proportional calls for implementation', () => {
    expect(classifyCodingTask('Explain how this module works').calls).toEqual(['informational']);
    expect(classifyCodingTask('Fix a typo', ['README.md']).calls).toEqual(['plan_code']);
    expect(classifyCodingTask('Add API and frontend integration', ['server.ts', 'ui/App.tsx'])).toEqual(expect.objectContaining({
      complexity: 'medium', calls: ['plan', 'code'],
    }));
  });

  it('adds review and approval only for complex or high-risk work', () => {
    expect(classifyCodingTask('Major architecture refactor').calls).toEqual(['plan', 'code', 'review']);
    expect(classifyCodingTask('Migrate production authentication schema')).toMatchObject({
      complexity: 'high-risk', requiresApproval: true, calls: ['plan', 'code', 'review'],
    });
  });

  it('repairs fenced JSON and trailing commas locally', () => {
    const plan = parseCodingPlan('```json\n{"summary":"Fix","taskType":"simple","proposedChanges":["Edit"],}\n```');
    expect(plan.summary).toBe('Fix');
    expect(plan.assumptions).toEqual([]);
  });

  it('allows at most a targeted correction response for malformed plans', () => {
    expect(tryParseCodingPlan('not json')).toEqual(expect.objectContaining({
      success: false, correctionAllowed: true,
    }));
  });
});
