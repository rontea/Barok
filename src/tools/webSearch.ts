import { z } from 'zod/v4';

import type { WebSearchParams } from '../types/schemas.js';

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

const TavilyResultSchema = z.object({
  title: z.string().default('Untitled result'),
  url: z.string(),
  content: z.string().default(''),
  score: z.number().optional(),
  published_date: z.string().optional(),
});

const TavilyResponseSchema = z.object({
  query: z.string().optional(),
  answer: z.string().optional(),
  results: z.array(TavilyResultSchema).default([]),
  response_time: z.number().optional(),
});

export interface WebSearchToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { detail?: unknown; message?: unknown; error?: unknown };
    const message = body.detail ?? body.message ?? body.error;
    if (typeof message === 'string' && message.trim()) return message.trim();
  } catch {
    // Do not return an untrusted HTML error body.
  }
  return response.statusText || `HTTP ${response.status}`;
}

export async function webSearchTool(
  params: WebSearchParams,
  signal?: AbortSignal,
): Promise<WebSearchToolResult> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    return {
      success: false,
      error: 'WebSearch is not configured. Add TAVILY_API_KEY to the server-side .env file and restart the agent.',
    };
  }

  try {
    const response = await fetch(TAVILY_SEARCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: params.query,
        max_results: params.max_results,
        search_depth: params.search_depth,
        topic: params.topic,
        include_answer: params.include_answer,
        include_raw_content: false,
        ...(params.include_domains ? { include_domains: params.include_domains } : {}),
        ...(params.exclude_domains ? { exclude_domains: params.exclude_domains } : {}),
      }),
      signal,
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Tavily search failed (${response.status}): ${await readErrorMessage(response)}`,
      };
    }

    const parsed = TavilyResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return { success: false, error: 'Tavily returned an unexpected response format.' };
    }

    return {
      success: true,
      output: JSON.stringify({
        query: parsed.data.query || params.query,
        ...(parsed.data.answer ? { answer: parsed.data.answer } : {}),
        results: parsed.data.results,
        ...(parsed.data.response_time === undefined
          ? {}
          : { response_time: parsed.data.response_time }),
      }, null, 2),
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      success: false,
      error: `Tavily search failed: ${error instanceof Error ? error.message : 'Unknown network error'}`,
    };
  }
}
