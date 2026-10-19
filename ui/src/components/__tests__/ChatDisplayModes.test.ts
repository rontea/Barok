import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "@jest/globals";
import { AppearanceSettingsPanel } from "../AppearanceSettingsPanel";
import { RotatingChatSection } from "../RotatingChatSection";
import { StreamlinedChatView } from "../StreamlinedChatView";
import { TestSuitePanel } from "../TestSuitePanel";
import { ConsoleRunPanel } from "../ConsoleRunPanel";
import type { AgentStreamEvent } from "../CoderChatPanel";
import {
  CODER_COMPOSER_DOCK_CLASS,
  CODER_COMPOSER_FORM_CLASS,
} from "../../utils/composerLayout";

const events: AgentStreamEvent[] = [
  { type: "tool_started", tool: "read_file", input: { path: "src/App.tsx" } },
  { type: "tool_result", tool: "read_file", result: "loaded" },
  { type: "final", message: "The task is complete." },
];

describe("Coder Chat display modes", () => {
  it("renders the Interface & Display settings and reset action", () => {
    const html = renderToStaticMarkup(
      React.createElement(AppearanceSettingsPanel),
    );
    expect(html).toContain("Interface &amp; Display");
    expect(html).toContain("Rotating Carousel");
    expect(html).toContain("interface-display-reset");
  });

  it("renders streamlined action history and final answer evidence", () => {
    const html = renderToStaticMarkup(
      React.createElement(StreamlinedChatView, {
        events,
        content: "The task is complete.",
      }),
    );
    expect(html).toContain("streamlined-action-history-card");
    expect(html).toContain("streamlined-action-row");
    expect(html).toContain("streamlined-final-answer");
  });

  it("projects real search, file, command, thought, verification, model, and runtime evidence", () => {
    const reasoningStart = {
      type: "reasoning_start" as const,
      id: "thought-1",
      provider: "openai",
      model: "gpt-5",
      phase: "planning" as const,
      visibility: "collapsed" as const,
      source: "model" as const,
      startedAt: 1_000,
    } as unknown as AgentStreamEvent;
    const richEvents: AgentStreamEvent[] = [
      {
        type: "tool_started",
        tool: "Grep",
        toolCallId: "grep-1",
        input: { pattern: "StreamlinedChatView", path: "ui/src" },
      },
      {
        type: "tool_result",
        tool: "Grep",
        toolCallId: "grep-1",
        result: JSON.stringify({ counts: { matches: 3, files: 2 } }),
      },
      { type: "file_read", path: "ui/src/components/StreamlinedChatView.tsx" },
      {
        type: "file_changed",
        path: "ui/src/components/StreamlinedChatView.tsx",
        diff: "@@ -10,2 +10,3 @@\n-old line\n+new line\n+another line",
      },
      reasoningStart,
      {
        type: "reasoning_end",
        id: "thought-1",
        provider: "openai",
        model: "gpt-5",
        phase: "planning",
        visibility: "collapsed",
        source: "model",
        summary: "Selected the guarded presentation change.",
        completedAt: 2_500,
      } as unknown as AgentStreamEvent,
      {
        type: "command_output",
        command: "npm run build",
        output: "Build completed successfully.",
      },
      {
        type: "verification_result",
        success: true,
        output: "Verification passed.",
      },
      {
        type: "llm_request_finished",
        request: {
          status: "succeeded",
          durationMs: 3_200,
          resolvedRoute: { provider: "openai", model: "gpt-5" },
        },
      },
      {
        type: "final",
        message: "The focused presentation change is complete.",
        provider: "openai",
        model: "gpt-5",
      },
    ];
    const html = renderToStaticMarkup(
      React.createElement(StreamlinedChatView, {
        events: richEvents,
        model: "fallback-model",
        onReviewFile: () => undefined,
      }),
    );

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("streamlined-exploration-toggle");
    expect(html).toContain("Exploring 1 file, 1 search");
    expect(html).toContain("openai/gpt-5");
    expect(html).toContain("Ran for 3.2s");
    expect(html).toContain("streamlined-search-row");
    expect(html).toContain("3 matches");
    expect(html).toContain("streamlined-file-row");
    expect(html).toContain("TSX");
    expect(html).toContain("+2");
    expect(html).toContain("-1");
    expect(html).toContain("streamlined-review-file");
    expect(html).toContain("streamlined-command-row");
    expect(html).toContain("streamlined-copy-output");
    expect(html).toContain("streamlined-thought-row");
    expect(html).toContain("Selected the guarded presentation change.");
    expect(html).toContain("1.5s");
    expect(html).toContain("Build output");
    expect(html).toContain("Verification Passed");
  });

  it("covers compact, live, highlighted, empty, and privacy-filtered Streamlined states", () => {
    const liveHtml = renderToStaticMarkup(
      React.createElement(StreamlinedChatView, {
        events: [{ type: "final", message: "Done." }],
        loading: true,
        density: "compact",
        highlightedEventId: "evt-0-final",
      }),
    );
    expect(liveHtml).toContain('class="w-full space-y-3 font-sans antialiased text-[#e4e4e7] p-2"');
    expect(liveHtml).toContain("Executing next action...");
    expect(liveHtml).toContain("ring-2 ring-cyan-300/70");
    expect(liveHtml).toContain("streamlined-final-answer");

    const emptyHtml = renderToStaticMarkup(
      React.createElement(StreamlinedChatView, { events: [] }),
    );
    expect(emptyHtml).toContain("streamlined-empty-state");
    expect(emptyHtml).toContain("No exploration steps recorded");

    const hiddenReasoningHtml = renderToStaticMarkup(
      React.createElement(StreamlinedChatView, {
        events: [{
          type: "reasoning_end",
          id: "hidden-thought",
          provider: "openai",
          model: "gpt-5",
          phase: "planning",
          visibility: "hidden",
          source: "provider",
          summary: "private reasoning must remain hidden",
        }],
      }),
    );
    expect(hiddenReasoningHtml).not.toContain("private reasoning must remain hidden");
  });

  it("renders the rotating compact card and expanded-history affordance", () => {
    const html = renderToStaticMarkup(
      React.createElement(RotatingChatSection, { events }),
    );
    expect(html).toContain("rotating-chat-section");
    expect(html).toContain("rotating-compact-card");
    expect(html).toContain("View history");
  });

  it("keeps console entries selectable and linked to their source event identity", () => {
    const html = renderToStaticMarkup(
      React.createElement(ConsoleRunPanel, {
        agentEvents: events,
        onSelectEvent: () => undefined,
      }),
    );
    expect(html).toContain('id="evt-0-tool_started"');
    expect(html).toContain('role="button"');
    expect(html).toContain("evt-2-final");
  });

  it("keeps the composer bounded and safe on narrow screens", () => {
    expect(CODER_COMPOSER_DOCK_CLASS).toContain("max-h-[45vh]");
    expect(CODER_COMPOSER_DOCK_CLASS).toContain("overflow-y-auto");
    expect(CODER_COMPOSER_DOCK_CLASS).toContain("env(safe-area-inset-bottom)");
    expect(CODER_COMPOSER_FORM_CLASS).toContain("min-w-0");
  });

  it("renders deterministic Test Suite status evidence and run controls", () => {
    const html = renderToStaticMarkup(
      React.createElement(TestSuitePanel, {
        cases: [
          {
            id: "suite-1",
            category: "Workflow",
            title: "Smoke case",
            tag: "Smoke",
            prompt: "Inspect the workspace.",
            modelName: "openai-fast",
          },
        ],
        runs: {
          "suite-1": {
            status: "passed",
            runId: "run-123",
            durationMs: 1250,
            modelName: "openai-fast",
            summary: "Completed.",
          },
        },
        activeCaseId: "suite-1",
        activeEvents: events,
        onRunCase: () => undefined,
        onRunAll: () => undefined,
        onRetryFailed: () => undefined,
        onStop: () => undefined,
        onOpenChat: () => undefined,
        onOpenAudit: () => undefined,
      }),
    );
    expect(html).toContain("test-suite-workspace");
    expect(html).toContain("Run all");
    expect(html).toContain("Retry failed");
    expect(html).toContain("Passed");
    expect(html).toContain("run-123");
    expect(html).toContain("Open audit");
    expect(html).toContain("test-suite-active-step");
    expect(html).toContain("test-suite-live-console");
  });
});
