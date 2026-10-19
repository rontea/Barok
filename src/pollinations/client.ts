const POLLINATIONS_BASE = 'https://gen.pollinations.ai';
const DEFAULT_MODEL = 'flux';
const PUBLIC_TEXT_MODEL = 'openai-fast';
const PUBLIC_TEXT_MODEL_ALIASES = new Set([
  'openai-fast',
  'openai',
  'gpt-oss',
  'gpt-oss-20b',
  'ovh-reasoning',
]);

type HeadersInit = Record<string, string>;

// Import response validators
import {
  validatePollinationsImageResponse,
  validatePollinationsTextResponse,
  validatePollinationsChatResponse,
  safeValidateResponse,
} from '../validation/responseValidator.js';
import { isHttpSuccess, truncateString } from '../validation/stringValidators.js';
import { getRuntimePollinationsApiKey } from '../config/runtimeEnv.js';

export class PollinationsClient {
  private apiKey?: string;
  private fetchImpl: typeof fetch;
  private useRuntimeApiKey: boolean;

  constructor(apiKey?: string | null, fetchImpl?: typeof fetch) {
    this.apiKey = typeof apiKey === 'string' ? apiKey.trim() || undefined : undefined;
    this.useRuntimeApiKey = apiKey !== null;
    this.fetchImpl = fetchImpl || globalThis.fetch;
  }

  setApiKey(key: string): void {
    this.apiKey = key.trim() || undefined;
    this.useRuntimeApiKey = false;
  }

  private getApiKey(): string | undefined {
    return this.useRuntimeApiKey
      ? this.apiKey || getRuntimePollinationsApiKey()
      : this.apiKey;
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const apiKey = this.getApiKey();

    // Text endpoints should route to text.pollinations.ai when anonymous
    let baseUrl = POLLINATIONS_BASE;
    if (!apiKey && endpoint.includes('/v1/chat/completions')) {
      baseUrl = 'https://text.pollinations.ai/openai';
    }

    const url = `${baseUrl}${endpoint}`;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await this.fetchImpl(url, {
      ...options,
      headers: {
        ...headers,
        ...options?.headers,
      },
    });

    if (!isHttpSuccess(res.status)) {
      const error = await res.text();
      throw new Error(
        `Error: Pollinations API request failed\n` +
        `Cause: HTTP ${res.status} error from Pollinations service\n` +
        `Suggested Fix: Verify API endpoint is reachable. Check Pollinations service status. Ensure API key is valid if authenticated.\n` +
        `Context: Status: ${res.status}, Response: ${truncateString(error, 200)}`
      );
    }

    return res.json() as Promise<T>;
  }

  async generateImage(params: {
    prompt: string;
    model?: string;
    width?: number;
    height?: number;
    seed?: number;
    enhance?: boolean;
    negative_prompt?: string;
    quality?: string;
  }): Promise<{ url: string; data?: string; format: string }> {
    const { prompt, model = DEFAULT_MODEL, width = 1024, height = 1024, ...rest } = params;
    const query = new URLSearchParams({
      model,
      width: String(width),
      height: String(height),
      enhance: String(params.enhance ?? true),
      ...(rest.seed && { seed: String(rest.seed) }),
      ...(rest.negative_prompt && { negative_prompt: rest.negative_prompt }),
      ...(rest.quality && { quality: rest.quality }),
    });

    const imageUrl = `${POLLINATIONS_BASE}/image/${encodeURIComponent(prompt)}?${query}`;

    // Fetch the image to return as base64
    const imgRes = await this.fetchImpl(imageUrl);
    if (!isHttpSuccess(imgRes.status)) {
      throw new Error(
        `Error: Pollinations image generation failed\n` +
        `Cause: Image generation request returned HTTP ${imgRes.status}\n` +
        `Suggested Fix: Verify image generation parameters (width, height, quality). Check prompt is valid. Verify service is operational.\n` +
        `Context: Status: ${imgRes.status}, Prompt: ${truncateString(prompt, 100)}`
      );
    }

    const buffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const contentType = imgRes.headers.get('content-type') || 'image/png';

    const response = {
      url: imageUrl,
      data: `data:${contentType};base64,${base64}`,
      format: contentType.split('/')[1] || 'png',
    };

    // Validate response format
    const validatedResponse = safeValidateResponse(
      response,
      validatePollinationsImageResponse,
      'Pollinations.generateImage'
    );
    
    if (!validatedResponse) {
      console.warn('Image response validation failed, returning raw response');
      return response;
    }

    return validatedResponse;
  }

  async generateText(params: {
    prompt: string;
    model?: string;
    temperature?: number;
    max_tokens?: number;
  }): Promise<{ text: string; model: string; usage: { tokens: number } }> {
    const { prompt, model = 'openai', temperature = 0.7, max_tokens = 1024 } = params;

    const res = await this.request<{
      choice: { text: string };
      usage: { total_tokens: number };
    }>(`/text/${encodeURIComponent(prompt)}?model=${model}&temperature=${temperature}&max_tokens=${max_tokens}`);

    const response = {
      text: res.choice.text,
      model,
      usage: { tokens: res.usage.total_tokens },
    };

    // Validate response format
    const validatedResponse = safeValidateResponse(
      response,
      validatePollinationsTextResponse,
      'Pollinations.generateText'
    );
    
    if (!validatedResponse) {
      console.warn('Text response validation failed, returning raw response');
      return response;
    }

    return validatedResponse;
  }

  async chatCompletion(params: {
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    model?: string;
    tools?: unknown[];
    temperature?: number;
    max_tokens?: number;
    reasoning_effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    signal?: AbortSignal;
  }): Promise<{ content: string; tool_calls?: Array<{ name: string; arguments: Record<string, unknown> }> }> {
    const { messages, model = 'openai', tools, temperature, max_tokens, reasoning_effort, signal } = params;
    const apiKey = this.getApiKey();

    if (!apiKey) {
      const publicModel = PUBLIC_TEXT_MODEL_ALIASES.has(model) ? model : PUBLIC_TEXT_MODEL;
      const res = await this.fetchImpl('https://text.pollinations.ai/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages, model: publicModel, tools, temperature, max_tokens, reasoning_effort }),
        signal,
      });

      if (!isHttpSuccess(res.status)) {
        const error = await res.text();
        throw new Error(
          `Error: Pollinations API request failed\n` +
          `Cause: HTTP ${res.status} error from Pollinations public text service\n` +
          `Suggested Fix: Verify Pollinations public text endpoint is reachable. Try an authenticated key if public access is restricted.\n` +
          `Context: Status: ${res.status}, Response: ${truncateString(error, 200)}`
        );
      }

      const raw = await res.text();
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return { content: raw };
      }

      try {
        const parsed = JSON.parse(raw) as {
          choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ name: string; arguments: Record<string, unknown> }> } }>;
          content?: string;
          tool_calls?: Array<{ name: string; arguments: Record<string, unknown> }>;
        };

        if (parsed.content !== undefined) {
          return { content: parsed.content, tool_calls: parsed.tool_calls };
        }

        const msg = parsed.choices?.[0]?.message;
        if (msg) {
          return {
            content: msg.content || '',
            tool_calls: msg.tool_calls,
          };
        }
      } catch {
        return { content: raw };
      }

      return { content: raw };
    }

    const res = await this.request<{
      choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ name: string; arguments: Record<string, unknown> }> } }>;
      content?: string;
      tool_calls?: Array<{ name: string; arguments: Record<string, unknown> }>;
    }>('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ messages, model, tools, temperature, max_tokens, reasoning_effort }),
      signal,
    });

    // Handle both Pollinations wrapper format (direct content) and OpenAI format (choices[0])
    let response: { content: string; tool_calls?: Array<{ name: string; arguments: Record<string, unknown> }> };
    const normalizeToolCalls = (
      toolCalls?: Array<{ name: string; arguments: unknown }>
    ): Array<{ name: string; arguments: Record<string, unknown> }> | undefined =>
      toolCalls
        ?.filter((call) => call && typeof call.name === 'string')
        .map((call) => ({
          name: call.name,
          arguments:
            call.arguments && typeof call.arguments === 'object' && !Array.isArray(call.arguments)
              ? call.arguments as Record<string, unknown>
              : {},
        }));

    if (res.content !== undefined) {
      response = { content: res.content, tool_calls: normalizeToolCalls(res.tool_calls) };
    } else if (res.choices?.[0]?.message) {
      const msg = res.choices[0].message;

      response = { 
        content: msg.content || '',
        tool_calls: normalizeToolCalls(msg.tool_calls)
      };
    } else {
      throw new Error(
        `Error: Pollinations chat completion returned invalid response format\n` +
        `Cause: Response does not match expected format (missing 'content' field and 'choices' array)\n` +
        `Suggested Fix: Check Pollinations API documentation for response format. Verify service is returning correct version.\n` +
        `Context: Response structure: ${JSON.stringify(Object.keys(res)).substring(0, 100)}`
      );
    }

    // Validate response format
    const validatedResponse = safeValidateResponse(
      response,
      validatePollinationsChatResponse,
      'Pollinations.chatCompletion'
    );
    
    if (!validatedResponse) {
      console.warn('Chat response validation failed, returning raw response');
      return response;
    }

    return validatedResponse;
  }

  async generateAudio(params: {
    text: string;
    voice?: string;
    format?: 'mp3' | 'wav' | 'flac';
  }): Promise<{ data: string; format: string }> {
    const { text, voice = 'nova', format = 'mp3' } = params;
    const endpoint = `/v1/audio/speech?text=${encodeURIComponent(text)}&voice=${voice}&format=${format}`;
    const res = await this.request<{ audio: string }>(endpoint, { method: 'GET' });
    return { data: res.audio, format };
  }

  async listModels(type: 'image' | 'text' | 'audio'): Promise<Array<{name: string; description?: string; pricing?: Record<string, string>}>> {
    const endpoint = `/${type}/models`;
    // API returns array directly, not wrapped in { models: [] }
    const res = await this.request<Array<{name: string; description?: string; pricing?: Record<string, string>}>>(endpoint);
    return Array.isArray(res) ? res : [];
  }

  async getBalance(): Promise<{ pollen: number; currency: string } | null> {
    const apiKey = this.getApiKey();
    if (!apiKey?.startsWith('sk_')) {
      return null; // Only secret keys can access balance
    }
    try {
      const res = await this.request<{balance: number, currency: string}>('/account/balance');
      return { pollen: res.balance, currency: res.currency || 'pollen' };
    } catch {
      return null;
    }
  }

  async getUsage(params?: { daily?: boolean }): Promise<Array<{ timestamp: string; tokens: number; cost: number }>> {
    const query = params?.daily ? '?daily=true' : '';
    const res = await this.request<Array<{ timestamp: string; tokens: number; cost: number }>>(`/account/usage${query}`);
    return res;
  }
}

export const pollinationsClient = new PollinationsClient();
