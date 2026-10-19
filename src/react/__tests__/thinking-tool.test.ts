import { createThinkingTool } from '../thinking-tool.js';

describe('Thinking tool', () => {
  it('returns a bounded visible summary and notifies the chat projection', async () => {
    const summaries: string[] = [];
    const tool = createThinkingTool({ onThought: (summary) => summaries.push(summary) });

    const result = await tool.handler({ summary: '  I will inspect the current target before making a focused change.  ' });

    expect(result).toEqual(expect.objectContaining({
      success: true,
      output: 'I will inspect the current target before making a focused change.',
    }));
    expect(summaries).toEqual(['I will inspect the current target before making a focused change.']);
  });

  it('rejects an empty summary', async () => {
    const tool = createThinkingTool();
    await expect(tool.handler({ summary: '   ' })).resolves.toEqual({
      success: false,
      error: 'Think requires a concise, user-safe summary.',
    });
  });
});

