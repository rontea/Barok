/**
 * Jest Test Utilities & Helpers
 * 
 * Common test utilities for mocking, fixtures, and assertions
 */

import type { ReactStep } from '../react/engine.js';

/**
 * Mock response factory for LLM completions
 */
export class MockLLMResponses {
  static thoughtResponse(thought: string) {
    return { content: thought };
  }

  static actionResponse(action: string, args: Record<string, any>) {
    return {
      content: JSON.stringify({
        tool: action,
        arguments: args,
      }),
    };
  }

  static toolNotFoundResponse() {
    return this.actionResponse('UnknownTool', {});
  }

  static invalidJsonResponse() {
    return { content: 'not valid json }{' };
  }

  static completionResponse() {
    return { content: 'YES' };
  }

  static continueResponse() {
    return { content: 'NO' };
  }

  static multipleResponses(...responses: any[]) {
    return responses;
  }
}

/**
 * Tool execution mocks
 */
export class MockToolHandlers {
  static successHandler(output: string = 'Success') {
    return jest.fn().mockResolvedValue({
      success: true,
      output,
    });
  }

  static failureHandler(error: string = 'Error') {
    return jest.fn().mockResolvedValue({
      success: false,
      error,
    });
  }

  static exceptionHandler(error: Error) {
    return jest.fn().mockRejectedValue(error);
  }

  static slowHandler(delayMs: number = 100, output: string = 'Slow result') {
    return jest.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                success: true,
                output,
              }),
            delayMs
          )
        )
    );
  }
}

/**
 * Assertion helpers
 */
export class TestAssertions {
  static assertValidReactStep(step: Partial<ReactStep>) {
    expect(step).toHaveProperty('thought');
    expect(step).toHaveProperty('action');
    expect(step).toHaveProperty('action_input');
    expect(typeof step.thought).toBe('string');
    expect(typeof step.action).toBe('string');
  }

  static assertValidReactResult(result: any) {
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('steps');
    expect(result).toHaveProperty('stepCount');
    expect(Array.isArray(result.steps)).toBe(true);
    expect(typeof result.stepCount).toBe('number');
  }

  static assertStepTransition(before: any, after: any) {
    expect(after.current_step).toBe(before.current_step + 1);
    expect(after.steps.length).toBe(before.steps.length + 1);
  }

  static assertBudgetTracking(result: any, maxBudget: number) {
    if (result.pollenCost !== undefined) {
      expect(result.pollenCost).toBeLessThanOrEqual(maxBudget);
      expect(result.pollenCost).toBeGreaterThanOrEqual(0);
    }
  }

  static assertStepCountNotExceeded(result: any, maxSteps: number) {
    expect(result.stepCount).toBeLessThanOrEqual(maxSteps);
  }
}

/**
 * Test data fixtures
 */
export const testFixtures = {
  simpleTasks: [
    'Write a hello world function',
    'Create a simple API endpoint',
    'Read and display a file',
  ],

  complexTasks: [
    'Build a full-stack authentication system',
    'Implement a microservices architecture',
    'Create a comprehensive test suite',
  ],

  failingTasks: [
    'Execute on a non-existent system',
    'Access restricted resources',
    'Perform impossible computation',
  ],

  toolInputs: {
    bash: { command: 'echo test' },
    read: { file_path: '/test/file.txt' },
    write: { file_path: '/test/output.txt', content: 'test' },
    edit: {
      file_path: '/test/file.ts',
      old_string: 'old',
      new_string: 'new',
    },
    glob: { pattern: '**/*.ts' },
    grep: { pattern: 'test', type: 'files_with_matches' },
  },

  agents: [
    { role: 'coder', task: 'Write the payment processor' },
    { role: 'researcher', task: 'Research the best approach' },
    { role: 'tester', task: 'Test the implementation' },
    { role: 'reviewer', task: 'Review the code quality' },
    { role: 'planner', task: 'Plan the architecture' },
    { role: 'documenter', task: 'Document the system' },
  ],
};

/**
 * Test context manager
 */
export class TestContext {
  private responses: any[] = [];
  private responseIndex = 0;

  setResponses(...responses: any[]) {
    this.responses = responses;
    this.responseIndex = 0;
  }

  getNextResponse() {
    const response = this.responses[this.responseIndex];
    this.responseIndex++;
    return response;
  }

  reset() {
    this.responseIndex = 0;
  }

  getCallCount() {
    return this.responseIndex;
  }
}

/**
 * Performance measurement utilities
 */
export class PerformanceMetrics {
  private startTime: number = 0;
  private measurements: Map<string, number[]> = new Map();

  start() {
    this.startTime = Date.now();
  }

  end(label: string) {
    const elapsed = Date.now() - this.startTime;
    if (!this.measurements.has(label)) {
      this.measurements.set(label, []);
    }
    this.measurements.get(label)!.push(elapsed);
    return elapsed;
  }

  getAverage(label: string): number {
    const times = this.measurements.get(label) || [];
    if (times.length === 0) return 0;
    return times.reduce((a, b) => a + b, 0) / times.length;
  }

  getReport() {
    const report: Record<string, any> = {};
    for (const [label, times] of this.measurements.entries()) {
      report[label] = {
        count: times.length,
        average: times.reduce((a, b) => a + b, 0) / times.length,
        min: Math.min(...times),
        max: Math.max(...times),
      };
    }
    return report;
  }
}
