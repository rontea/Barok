import {
  classifyError,
  executeWithRotation,
  RetryableErrorType,
} from '@barok/engine';

describe('Engine public retry policy', () => {
  it('classifies authentication errors as permanent', () => {
    expect(classifyError(new Error('401 unauthorized')).type).toBe(RetryableErrorType.PERMANENT);
  });

  it('rotates to the next option when an option fails permanently', async () => {
    const attempts: string[] = [];
    const result = await executeWithRotation(
      ['first', 'second'],
      async (option) => {
        attempts.push(option);
        if (option === 'first') throw new Error('401 unauthorized');
        return 'ok';
      },
      { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
    );

    expect(result).toMatchObject({ success: true, data: 'ok', attempts: 2 });
    expect(attempts).toEqual(['first', 'second']);
  });
});
