import { describe, expect, it } from '@jest/globals';
import { classifyCoderIntent, createCoderRespondResponse } from '../intent';

describe('Coder Chat intent intelligence', () => {
  it.each([
    ['hi just an inquiry'],
    ['what are you doing?'],
    ['can you help me with this?'],
  ])('keeps conversational message in chat mode: %s', (message) => {
    const intent = classifyCoderIntent(message);

    expect(intent.mode).toBe('chat');
    expect(intent.executionTask).toBeUndefined();
  });

  it.each([
    ['check the workspace and tell me what this project is'],
    ['fix ui/src/App.tsx'],
    ['run npm test'],
  ])('routes explicit workspace work to execution mode: %s', (message) => {
    const intent = classifyCoderIntent(message);

    expect(intent.mode).toBe('execute');
    expect(intent.executionTask).toBe(message);
  });

  it.each([
    ['I would like to know why the run is failing', 'why the run is failing'],
    ['The user is asking about how model targets are selected', 'how model targets are selected'],
  ])('keeps indirect information requests in chat: %s', (message) => {
    const intent = classifyCoderIntent(message);

    expect(intent.mode).toBe('chat');
    expect(intent.executionTask).toBeUndefined();
  });

  it.each([
    ['The user would like to update the Gemini model targets under each profile', 'update the Gemini model targets under each profile'],
    ['I would like to fix ui/src/App.tsx', 'fix ui/src/App.tsx'],
    ['Please run npm test', 'run npm test'],
  ])('unwraps indirect action requests into one execution task: %s', (message, executionTask) => {
    const intent = classifyCoderIntent(message);

    expect(intent.mode).toBe('execute');
    expect(intent.executionTask).toBe(executionTask);
  });

  it('routes implementation feedback about harness behavior to execution', () => {
    const message = 'I think our harness should be checking phrases like user is asking about and user would like to so the agent can progress.';
    const intent = classifyCoderIntent(message);

    expect(intent.mode).toBe('execute');
    expect(intent.executionTask).toBe(message);
  });

  it('returns a chat response without an execution task for QV3MES-style input', async () => {
    const response = await createCoderRespondResponse({
      message: 'hi just an inquiry',
      thread: [],
      workspace: 'C:/MPC Project Test',
      model: 'openai-fast',
    });

    expect(response.mode).toBe('chat');
    expect(response.reply).toContain("won't inspect files or run tools");
    expect(response.executionTask).toBeUndefined();
  });

  it('returns execution response preserving the task for clear workspace requests', async () => {
    const response = await createCoderRespondResponse({
      message: 'check the workspace and tell me what this project is',
      thread: [],
      workspace: 'C:/MPC Project Test',
      model: 'openai-fast',
    });

    expect(response.mode).toBe('execute');
    expect(response.executionTask).toBe('check the workspace and tell me what this project is');
    expect(response.reply).toBeUndefined();
  });

  it('forces execution when agent mode is selected', async () => {
    const response = await createCoderRespondResponse({
      message: 'what do you think?',
      mode: 'agent',
    });

    expect(response.mode).toBe('execute');
    expect(response.executionTask).toBe('what do you think?');
  });

  it('asks for scope before executing a broad agent-mode mutation', async () => {
    const response = await createCoderRespondResponse({
      message: 'fix the website with your thinking ability',
      mode: 'agent',
      workspace: 'C:/Projects/react-engine-077',
    });

    expect(response.mode).toBe('clarify');
    expect(response.reply).toMatch(/target|success condition/i);
    expect(response.analysis?.contract?.blocker?.code).toBe('missing_acceptance_criteria');
  });

  it('routes affirmative follow-ups to the prior actionable workspace task', async () => {
    const response = await createCoderRespondResponse({
      message: 'yes please',
      workspace: 'C:/MPC Project Test/Pacman',
      thread: [
        {
          role: 'user',
          content: '## Phase 2: Maze & Pellets - lets work on it and once done mark it complete?',
        },
        {
          role: 'assistant',
          content: 'Shall I go ahead and implement all four Phase 2 items?',
          status: 'success',
        },
      ],
    });

    expect(response.mode).toBe('execute');
    expect(response.executionTask).toContain('Phase 2: Maze & Pellets');
    expect(response.analysis?.expectedChangeIntent).toBe('modify');
  });

  it('keeps workspace-like requests conversational in chat mode', async () => {
    const response = await createCoderRespondResponse({
      message: 'fix ui/src/App.tsx',
      mode: 'chat',
    });

    expect(response.mode).toBe('chat');
    expect(response.reply).toContain('Chat mode');
  });

  it('passes the exact Coder Chat model target to the LLM provider', async () => {
    const requestedModels: string[] = [];
    const llm = {
      createChatCompletion: async (_messages: Array<{ role: string; content: string }>, model: string) => {
        requestedModels.push(model);
        return 'Target route confirmed.';
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'test',
      isAvailable: () => true,
    };

    const response = await createCoderRespondResponse({
      message: 'Which API target are you using?',
      mode: 'chat',
      model: 'groq-target:key-2',
    }, llm);

    expect(response.mode).toBe('chat');
    expect(requestedModels).toEqual(['groq-target:key-2']);
  });

  it('includes prior user and assistant turns when answering in the same thread', async () => {
    const messages: Array<{ role: string; content: string }> = [];
    const llm = {
      createChatCompletion: async (requestMessages: Array<{ role: string; content: string }>) => {
        messages.push(...requestMessages);
        return 'The next step is to verify the existing implementation.';
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'test',
      isAvailable: () => true,
    };

    const response = await createCoderRespondResponse({
      message: 'What should I do next?',
      mode: 'chat',
      model: 'openai-fast',
      thread: [
        { role: 'user', content: 'Explain the current task.' },
        { role: 'assistant', content: 'The current task is to improve the chat flow.', status: 'success' },
      ],
    }, llm);

    expect(response.mode).toBe('chat');
    expect(messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'system', content: expect.any(String) },
      { role: 'user', content: 'Explain the current task.' },
      { role: 'assistant', content: 'The current task is to improve the chat flow.' },
      { role: 'user', content: expect.stringContaining('What should I do next?') },
    ]);
  });

  it('returns a safe reasoning summary for a chat response', async () => {
    let completionOptions: any;
    const llm = {
      createChatCompletion: async (
        _messages: Array<{ role: string; content: string }>,
        _model: string,
        options?: any,
      ) => {
        completionOptions = options;
        options?.onCompletionResult?.({
          text: 'The answer is ready.',
          toolCalls: [],
          reasoningSummary: 'I connected the answer to the earlier thread context.',
          provider: 'test',
          model: 'openai-fast',
        });
        return 'The answer is ready.';
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'test',
      isAvailable: () => true,
    };

    const response = await createCoderRespondResponse({
      message: 'Can you summarize that?',
      mode: 'chat',
      model: 'openai-fast',
      thread: [{ role: 'assistant', content: 'The earlier answer explained the design.' }],
    }, llm);

    expect(response.reasoningSummary).toBe('I connected the answer to the earlier thread context.');
    expect(completionOptions.reasoning).toEqual({ effort: 'low', summary: 'concise', exclude: true });
  });

  it('gives the chat model the underlying meaning of an indirect question', async () => {
    const messages: Array<{ role: string; content: string }> = [];
    const llm = {
      createChatCompletion: async (requestMessages: Array<{ role: string; content: string }>) => {
        messages.push(...requestMessages);
        return 'The run is failing because the selected model is unavailable.';
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'test',
      isAvailable: () => true,
    };

    const response = await createCoderRespondResponse({
      message: 'The user is asking about why the run is failing',
      mode: 'auto',
      model: 'openai-fast',
    }, llm);

    expect(response.mode).toBe('chat');
    expect(response.reply).toContain('selected model');
    expect(messages.at(-1)?.content).toContain('Harness interpretation: why the run is failing');
  });

  it('migrates the legacy Gemini alias and supplies same-provider recovery models', async () => {
    const calls: Array<{ model: string; options?: Record<string, unknown> }> = [];
    const llm = {
      createChatCompletion: async (
        _messages: Array<{ role: string; content: string }>,
        model: string,
        options?: Record<string, unknown>,
      ) => {
        calls.push({ model, options });
        return 'Gemini recovery route confirmed.';
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'test',
      isAvailable: () => true,
    };

    const response = await createCoderRespondResponse({
      message: 'Which Gemini model is active?',
      mode: 'chat',
      model: 'gemini',
      geminiProfileId: 'default',
    }, llm);

    expect(response.mode).toBe('chat');
    expect(calls[0].model).toBe('gemini-3.6-flash');
    expect(calls[0].options).toMatchObject({
      geminiProfileId: 'default',
      pinModel: false,
      sameProviderFallbackModels: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
    });
  });
});
