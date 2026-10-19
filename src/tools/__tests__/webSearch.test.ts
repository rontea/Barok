import { jest } from '@jest/globals';
import * as fs from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { configuredWebSearchTool, DEV_TOOLS, runWithWorkspace } from '../devTools.js';
import { saveKnowledgeSettings } from '../knowledgeSettings.js';
import { classifyPolicyAction } from '../permissionPolicy.js';
import { webSearchTool } from '../webSearch.js';

describe('WebSearch', () => {
  const originalApiKey = process.env.TAVILY_API_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = originalApiKey;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns a setup error when Tavily is not configured', async () => {
    delete process.env.TAVILY_API_KEY;

    const result = await webSearchTool({
      query: 'latest TypeScript release',
      max_results: 5,
      search_depth: 'basic',
      topic: 'general',
      include_answer: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('TAVILY_API_KEY');
  });

  it('is registered and classified as a network action', () => {
    expect(DEV_TOOLS.WebSearch).toBeDefined();
    expect(classifyPolicyAction({ action: 'WebSearch', action_input: { query: 'example' } }))
      .toEqual({ category: 'network', risk: 'high' });
  });

  it('blocks searches before network access when disabled for the workspace', async () => {
    const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-web-search-disabled-'));
    await saveKnowledgeSettings(workspace, { webSearchEnabled: false });
    process.env.TAVILY_API_KEY = 'tvly-test-key';
    global.fetch = jest.fn();

    const result = await runWithWorkspace(workspace, () => configuredWebSearchTool({
      query: 'current documentation',
      max_results: 3,
      search_depth: 'basic',
      topic: 'general',
      include_answer: false,
    }));

    expect(result).toEqual({
      success: false,
      error: 'WebSearch is disabled for this workspace. Enable it in Settings > Agent Resources.',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls Tavily and returns normalized source results', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key';
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      query: 'OpenAI tools',
      answer: 'Tool calling lets models request application functions.',
      results: [{
        title: 'Tools guide',
        url: 'https://example.com/tools',
        content: 'A relevant excerpt.',
        score: 0.98,
      }],
      response_time: 0.12,
    }), { status: 200 }));

    const result = await webSearchTool({
      query: 'OpenAI tools',
      max_results: 3,
      search_depth: 'basic',
      topic: 'general',
      include_answer: true,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tvly-test-key',
        }),
      }),
    );
    expect(result.output).toContain('https://example.com/tools');
    expect(result.output).not.toContain('tvly-test-key');
  });
});
