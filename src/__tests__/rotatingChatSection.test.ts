import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  RotatingChatSection,
  deriveRotatingItemsFromEvents,
  deriveRotatingItemsFromMessages,
} from '../../ui/src/components/RotatingChatSection';
import { StreamlinedChatView } from '../../ui/src/components/StreamlinedChatView';
import { CoderChatPanel, type AgentStreamEvent, type CoderThreadMessage } from '../../ui/src/components/CoderChatPanel';

describe('RotatingChatSection', () => {
  const sampleEvents: AgentStreamEvent[] = [
    { type: 'run_started', task: 'Inspect and refactor project' },
    { type: 'reasoning_start', id: 'r1', visibility: 'full' },
    { type: 'reasoning_end', id: 'r1', summary: 'Need to examine existing configuration and test files.', visibility: 'full' },
    { type: 'tool_started', tool: 'read_file', input: { file_path: 'package.json' } },
    { type: 'file_read', path: 'package.json' },
    { type: 'tool_result', tool: 'read_file', result: '{"name":"react-app","version":"1.0.0"}' },
    { type: 'tool_started', tool: 'edit_file', input: { file_path: 'package.json', edit: 'updated' } },
    { type: 'file_changed', path: 'package.json', summary: 'Updated dependencies', diff: '--- a/package.json\n+++ b/package.json' },
    { type: 'tool_result', tool: 'edit_file', result: '{"success":true}' },
    { type: 'command_started', command: 'npm test' },
    { type: 'command_output', command: 'npm test', output: 'PASS 1 test passed' },
    { type: 'verification_started', command: 'npm test' },
    { type: 'verification_result', success: true, output: 'All verification checks passed successfully.' },
    { type: 'model_response', message: 'The project inspection and refactor is complete!' },
  ];

  it('correctly categorizes and maps agent events into rotating chat items', () => {
    const items = deriveRotatingItemsFromEvents(sampleEvents);

    expect(items.length).toBeGreaterThan(5);

    const toolItems = items.filter((i) => i.category === 'tool');
    expect(toolItems.length).toBeGreaterThanOrEqual(2);
    expect(toolItems[0].categoryLabel).toContain('Tool: read_file');

    const planningItems = items.filter((i) => i.category === 'planning');
    expect(planningItems.length).toBeGreaterThanOrEqual(1);

    const verificationItem = items.find((i) => i.rawEvent?.type === 'verification_result');
    expect(verificationItem).toBeDefined();
    expect(verificationItem?.status).toBe('completed');
    expect(verificationItem?.outputPayload).toContain('All verification checks passed');

    const responseItem = items.find((i) => i.category === 'response');
    expect(responseItem).toBeDefined();
    expect(responseItem?.summary).toContain('inspection and refactor is complete');
  });

  it('correctly maps thread messages into rotating chat items', () => {
    const messages: CoderThreadMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        status: 'completed',
        content: 'Please help organize the chat section.',
        createdAt: 1710000000000,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        status: 'completed',
        content: 'I have updated the chat section to support rotating messages.',
        createdAt: 1710000010000,
      },
    ];

    const items = deriveRotatingItemsFromMessages(messages);
    expect(items).toHaveLength(2);
    expect(items[0].category).toBe('user');
    expect(items[0].categoryLabel).toBe('You');
    expect(items[1].category).toBe('response');
    expect(items[1].categoryLabel).toBe('ReAct Coder');
  });

  it('renders in compact rotating messages carousel mode by default', () => {
    const html = renderToStaticMarkup(
      React.createElement(RotatingChatSection, {
        events: sampleEvents,
        loading: false,
        isExpanded: false,
        title: 'Agent Progress',
      })
    );

    // Carousel header and controls
    expect(html).toContain('data-testid="rotating-compact-card"');
    expect(html).toContain('Agent Progress');
    expect(html).toContain('Expand to Chat Format');
    expect(html).toContain('aria-label="Rotation navigation"');
    expect(html).toContain('Step 1 of ');
    expect(html).toContain('Auto-rotating every');

    // Does not show the expanded list container when collapsed
    expect(html).not.toContain('data-testid="rotating-expanded-chat-list"');
  });

  it('renders in expanded chat text format when isExpanded is true', () => {
    const html = renderToStaticMarkup(
      React.createElement(RotatingChatSection, {
        events: sampleEvents,
        loading: false,
        isExpanded: true,
        title: 'Agent Progress',
      })
    );

    // Expanded list header and controls
    expect(html).toContain('data-testid="rotating-expanded-chat-list"');
    expect(html).toContain('Collapse to Rotating');
    expect(html).toContain('Filter:');
    expect(html).toContain('Tools &amp; Files');
    expect(html).toContain('Planning');

    // Conversational chat text format rows
    expect(html).toContain('data-testid="chat-text-row"');
    expect(html).toContain('Inspect and refactor project');
    expect(html).toContain('View Payload / Code Output');
  });

  it('integrates seamlessly with CoderChatPanel and provides Style toggle', () => {
    const html = renderToStaticMarkup(
      React.createElement(CoderChatPanel, {
        task: 'Refactor chat section to rotating messages',
        model: 'gemini-2.5-flash',
        loading: false,
        liveProgress: '',
        liveState: null,
        result: null,
        workspace: '/workspace/app',
        thread: [
          {
            id: 'msg-with-events',
            role: 'assistant',
            status: 'success',
            content: 'Task done with rotating messages.',
            createdAt: 1710000000000,
            agentEvents: sampleEvents,
          },
        ],
        canContinue: false,
        onTaskChange: () => undefined,
        onModelChange: () => undefined,
        onRunTask: () => undefined,
        onGenerateWorkPlan: () => undefined,
        onContinue: () => undefined,
        onStartNew: () => undefined,
        onClearThread: () => undefined,
      })
    );

    // The reference keeps chat layout selection out of the thread toolbar.
    expect(html).not.toContain('data-testid="message-format-streamlined"');
    expect(html).not.toContain('data-testid="message-format-rotating"');
    expect(html).not.toContain('data-testid="message-format-chat-text"');

    // Header top of thread controls (Provider and Target Model on left section)
    expect(html).toContain('data-testid="thread-provider-selection"');
    expect(html).toContain('data-testid="thread-provider-select"');
    expect(html).toContain('data-testid="thread-target-model-selection"');
    expect(html).toContain('data-testid="thread-target-model-select"');
    expect(html).toContain('All Providers');

    // Streamlined chat section is the default presentation.
    expect(html).toContain('data-testid="streamlined-exploration-toggle"');
    expect(html).toContain('data-testid="streamlined-action-history-card"');

    // The streamlined default keeps the legacy telemetry hooks screen-reader
    // only so integrations can continue to inspect the same event history.
    expect(html).toContain('data-testid="agent-current-status"');
    expect(html).toContain('data-testid="agent-reasoning-orbit"');
    expect(html).toContain('data-testid="agent-action-stack"');
  });

  it('renders StreamlinedChatView with inline action pills and narrative text', () => {
    const html = renderToStaticMarkup(
      React.createElement(StreamlinedChatView, {
        events: sampleEvents,
        loading: false,
        testId: 'test-streamlined-view',
      })
    );

    expect(html).toContain('data-testid="test-streamlined-view"');
    expect(html).toContain('data-testid="streamlined-action-row"');
    // Verifies narrative reasoning is shown
    expect(html).toContain('Need to examine existing configuration and test files.');
    // Verifies action badges
    expect(html).toContain('Ran');
    expect(html).toContain('npm test');
    expect(html).toContain('Read');
    expect(html).toContain('package.json');
    expect(html).toContain('The project inspection and refactor is complete!');
  });

  it('renders Action history with edited file report and places final answer below it', () => {
    const html = renderToStaticMarkup(
      React.createElement(StreamlinedChatView, {
        events: [],
        loading: false,
        content: 'Final answer below action history with edited file report.',
        modelName: 'gemini-3.8-flash',
        executionDurationSeconds: 312,
        changeSummary: {
          files: [
            { path: 'ui/src/components/CoderChatPanel.tsx', addedLines: 24, removedLines: 4 },
            { path: 'ui/src/components/__tests__/QualityGatesPanel.test.ts', addedLines: 0, removedLines: 80, status: 'deleted' },
          ],
          addedLines: 24,
          removedLines: 84,
        },
        testId: 'test-streamlined-history-report',
      })
    );

    expect(html).toContain('data-testid="test-streamlined-history-report"');
    expect(html).toContain('Gemini 3.8 Flash');
    expect(html).toContain('Ran for 5m 12s');
    expect(html).toContain('Action history');
    expect(html).toContain('Here are key actions taken for the app:');
    expect(html).toContain('Edited 2 files');
    expect(html).toContain('ui/src/components/CoderChatPanel.tsx');
    expect(html).toContain('ui/src/components/__tests__/QualityGatesPanel.test.ts');
    expect(html).toContain('Built');
    // Verifies final answer is rendered with testid
    expect(html).toContain('data-testid="streamlined-final-answer"');
    expect(html).toContain('Final answer below action history with edited file report.');

    // Verifies sequential order: Action history card appears BEFORE the final answer
    const actionHistoryPos = html.indexOf('data-testid="streamlined-action-history-card"');
    const finalAnswerPos = html.indexOf('data-testid="streamlined-final-answer"');
    expect(actionHistoryPos).toBeGreaterThan(-1);
    expect(finalAnswerPos).toBeGreaterThan(actionHistoryPos);
  });
});
