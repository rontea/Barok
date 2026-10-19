import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  Copy,
  Loader2,
  Send,
  Square,
  Trash2,
  User,
} from "lucide-react";
import { FinalAnswerRenderer } from "./FinalAnswerRenderer";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  timestamp: number;
  model?: string;
  provider?: string;
  isStreaming?: boolean;
}

interface DirectChatPanelProps {
  model?: string;
  workspace?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortModel(model?: string): string {
  if (!model) return "";
  // Strip prefix (openrouter:, groq:, etc.)
  const clean = model.includes(":") ? model.split(":").slice(1).join(":") : model;
  // Keep the last two path segments for readability
  const parts = clean.split("/");
  return parts.length > 2 ? parts.slice(-2).join("/") : clean;
}

// ─── UserBubble ───────────────────────────────────────────────────────────────

function UserBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end gap-2.5">
      <div className="max-w-[85%] min-w-0">
        <div className="rounded-xl rounded-tr-sm border border-cyan-500/20 bg-cyan-950/30 px-4 py-3">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-white">
            {message.content}
          </p>
        </div>
        <p className="mt-1 text-right font-mono text-[10px] text-text-dark">
          {formatTime(message.timestamp)}
        </p>
      </div>
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-950/50">
        <User className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
      </div>
    </div>
  );
}

// ─── AssistantBubble ──────────────────────────────────────────────────────────

function AssistantBubble({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(message.content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, [message.content]);

  return (
    <div className="flex gap-2.5">
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border-main bg-bg-panel">
        {message.isStreaming ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" aria-hidden="true" />
        ) : (
          <Bot className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="rounded-xl rounded-tl-sm border border-border-main bg-bg-panel px-4 py-3">
          {message.content ? (
            <FinalAnswerRenderer content={message.content} compact />
          ) : (
            <span className="inline-flex items-center gap-1.5 text-sm text-text-dim">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />
              Thinking…
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3">
          {message.model && (
            <span className="rounded border border-border-main bg-bg-main px-1.5 py-0.5 font-mono text-[9px] text-text-dark">
              {shortModel(message.model)}
            </span>
          )}
          <span className="font-mono text-[10px] text-text-dark">
            {formatTime(message.timestamp)}
          </span>
          {!message.isStreaming && message.content && (
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 rounded border border-border-main bg-bg-main px-1.5 py-0.5 font-mono text-[10px] text-text-dark transition hover:text-white"
              title="Copy response"
            >
              {copied ? (
                <Check className="h-3 w-3 text-emerald-400" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              Copy
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ErrorBubble ──────────────────────────────────────────────────────────────

function ErrorBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 px-4 py-3 text-sm text-rose-300">
      <span className="mr-2 font-mono text-[9px] font-bold uppercase tracking-wider text-rose-400">
        Error
      </span>
      {message.content}
    </div>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-950/20 text-cyan-400">
        <Bot className="h-6 w-6" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-semibold text-white">Direct Chat</p>
        <p className="mt-1 max-w-xs text-xs text-text-dim">
          Send a message to chat directly with the AI — no agent loop, no task
          planning. Just a conversation.
        </p>
      </div>
    </div>
  );
}

// ─── DirectChatPanel ─────────────────────────────────────────────────────────

export function DirectChatPanel({ model }: DirectChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-scroll to bottom as messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputValue(e.target.value);
      const el = e.target;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    },
    [],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    // Mark any streaming message as done
    setMessages((prev) =>
      prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
    );
  }, []);

  const sendMessage = useCallback(async () => {
    const content = inputValue.trim();
    if (!content || isStreaming) return;

    setInputValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content,
      timestamp: Date.now(),
    };

    const assistantId = makeId();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setIsStreaming(true);

    const ac = new AbortController();
    abortRef.current = ac;

    // Build the history to send (exclude error messages, send only user+assistant)
    const history = [...messages, userMessage]
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    try {
      const response = await fetch("/api/direct-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, model }),
        signal: ac.signal,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error || `Server error ${response.status}`,
        );
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedText = "";
      let resolvedModel = model;
      let resolvedProvider: string | undefined;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              const payload = JSON.parse(line.slice(6)) as Record<string, unknown>;
              if (currentEvent === "delta" && typeof payload.delta === "string") {
                accumulatedText += payload.delta;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: accumulatedText, isStreaming: true }
                      : m,
                  ),
                );
              } else if (currentEvent === "done") {
                if (typeof payload.model === "string") resolvedModel = payload.model;
                if (typeof payload.provider === "string") resolvedProvider = payload.provider;
              } else if (currentEvent === "error") {
                throw new Error(
                  typeof payload.message === "string" ? payload.message : "Stream error",
                );
              }
            } catch (parseErr) {
              // Malformed SSE data — skip
            }
            currentEvent = "";
          }
        }
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: accumulatedText || "(empty response)",
                isStreaming: false,
                model: resolvedModel,
                provider: resolvedProvider,
              }
            : m,
        ),
      );
    } catch (error: unknown) {
      if ((error as Error).name === "AbortError") {
        // User stopped — leave partial content, mark done
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, isStreaming: false } : m,
          ),
        );
      } else {
        const errMsg =
          error instanceof Error ? error.message : "Unknown error";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, role: "error" as const, content: errMsg, isStreaming: false }
              : m,
          ),
        );
      }
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
    }
  }, [inputValue, isStreaming, messages, model]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void sendMessage();
      }
    },
    [sendMessage],
  );

  const clearChat = useCallback(() => {
    stopStreaming();
    setMessages([]);
  }, [stopStreaming]);

  return (
    <div className="flex h-full min-h-[420px] flex-col rounded-xl border border-border-main bg-bg-panel">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-main px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-cyan-400" aria-hidden="true" />
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
            Direct Chat
          </span>
          {model && (
            <span className="rounded border border-cyan-500/20 bg-cyan-950/20 px-1.5 py-0.5 font-mono text-[9px] text-cyan-300">
              {shortModel(model)}
            </span>
          )}
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clearChat}
            className="flex items-center gap-1.5 rounded border border-border-main bg-bg-main px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-dim transition hover:text-rose-300"
            title="Clear conversation"
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>

      {/* Message thread */}
      <div className="custom-scrollbar flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          messages.map((message) =>
            message.role === "user" ? (
              <UserBubble key={message.id} message={message} />
            ) : message.role === "error" ? (
              <ErrorBubble key={message.id} message={message} />
            ) : (
              <AssistantBubble key={message.id} message={message} />
            ),
          )
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="border-t border-border-main px-4 py-3">
        <div className="flex items-end gap-2">
          <label className="flex min-h-[42px] flex-1 items-end gap-2 rounded-xl border border-border-main bg-bg-main px-3 py-2.5 transition focus-within:border-cyan-400">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Type a message… (Ctrl+Enter to send)"
              rows={1}
              className="w-full resize-none bg-transparent text-sm text-white outline-none placeholder:text-text-dark"
              disabled={isStreaming}
              aria-label="Chat input"
            />
          </label>
          {isStreaming ? (
            <button
              type="button"
              onClick={stopStreaming}
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-950/20 text-rose-400 transition hover:bg-rose-950/40"
              title="Stop"
              aria-label="Stop streaming"
            >
              <Square className="h-4 w-4 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={!inputValue.trim()}
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-950/20 text-cyan-400 transition hover:bg-cyan-900/30 disabled:cursor-not-allowed disabled:opacity-40"
              title="Send (Ctrl+Enter)"
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
        <p className="mt-1.5 text-center font-mono text-[10px] text-text-dark">
          Direct model call · no agent loop · Ctrl+Enter to send
        </p>
      </div>
    </div>
  );
}

