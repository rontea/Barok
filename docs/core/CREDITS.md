# ⚖️ License, Credits & Influences

## 📜 License

**MIT License**

Copyright (c) 2026 Kilo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## 🙏 Credits & Influences

### Yes — I studied claude-code-main to understand how a production MCP server works

**Direct influence from examining** `claude-code-main` (Anthropic's leaked Claude Code source):

| What I learned from claude-code-main | How I implemented it here |
|--------------------------------------|--------------------------|
| **MCP Server architecture** — stdio transport, tool listing, call handling | `src/mcp/server.ts` follows same pattern (Server → ListTools → CallTool handlers) |
| **Tool definition structure** — name, description, inputSchema, annotations | Same shape: `{ name, description, inputSchema, annotations: { readOnlyHint } }` |
| **Permission system design** — tool-level permission checks | Simplified version: validation layer before execution |
| **Dev tools set** — Bash/Read/Write/Edit/Glob/Grep are Claude Code's core dev tools | Same 6 tools directly exposed (Bash/Read/Write/Edit/Glob/Grep) |
| **ReAct pattern** — Claude Code internally does Reason/Act/Observe via LLM loop | Explicit ReAct engine (`src/react/engine.ts`) implementing the same cycle |
| **State management** — tracking steps, observations, completion | `ReactState` with `steps[]` array matching Claude's approach |
| **Agent spawning** — Claude Code's `AgentTool` for sub-agents | CrewAI multi-agent system (`src/agents/crew.ts`) |
| **Task management** — Task* tools for tracking work | TaskCreate/TaskList/TaskUpdate mirrors Claude Code |
| **Error handling** — tool errors as `isError: true` in MCP responses | Same pattern: `{ isError, content: [{type:'text', text:'...'}] }` |
| **Validation** — Zod schemas for tool inputs | Explicit Zod schemas (`src/types/schemas.ts`) like claude-code-main uses |

### What's Different

| Aspect | Claude Code | Raw ReAct MCP (this project) |
|--------|-------------|------------------------------|
| **LLM Provider** | Anthropic only | Pollinations (multi-model: claude, openai, deepseek, gemini, etc.) |
| **Code Size** | ~785KB main.tsx, 4700+ lines | ~1200 lines total (minimal) |
| **Feature Set** | 40+ tools (LSP, WebFetch, Browser, etc.) | 12 core tools (focused on dev + generation) |
| **Framework** | Custom React/Ink TUI CLI | Standalone Node.js CLI + MCP server |
| **Agent System** | Custom agent orchestration | CrewAI-based multi-agent |
| **Validation** | Integrated in tool definitions | Explicit Pydantic-style schemas + Zod |
| **ReAct Control** | Implicit in Agent tool | Explicit ReAct engine with visible loop |
| **Purpose** | General-purpose AI coding assistant | Educational/demo of ReAct + MCP + multi-agent |
| **License** | Proprietary (Anthropic) | MIT (open source) |

### What I Did NOT Copy (even though I could have)

From the claude-code-main source, these are **Anthropic-specific** and NOT included here:
- ❌ Buddy system (Tamagotchi companion)
- ❌ Memory consolidation ("dream" system)
- ❌ Undercover mode (internal repo detection)
- ❌ KAIROS proactive assistant
- ❌ Telemetry/analytics pipeline
- ❌ VSCode extension bridge
- ❌ JetBrains IDE integration
- ❌ GitHub App authentication flow
- ❌ Enterprise policy enforcement
- ❌ Session recording/playback
- ❌ Cost tracking
- ❌ Permission dialog UI (TUI-based)

I extracted only the **tool interface patterns** and **ReAct loop architecture** — the core concepts that are implementation-agnostic.

---

## 🔗 Related Projects

### Pollinations Ecosystem

This project integrates with:

| Project | Role | Integration |
|---------|------|------------|
| **pollinations/pollinations** | Main AI platform | API client calls `gen.pollinations.ai` endpoints |
| **@pollinations/model-context-protocol** | Official MCP server | Alternative server; this project is a custom variant |
| **pollinations-claude-code** (Tolerable) | Claude Code plugin | Different approach (Python-based plugin) |

Claude Code repositories:
| Project | Status | Relation |
|---------|--------|----------|
| **claude-code-main** (leaked) | Source code leak | Architectural reference only (not used directly) |
| **@anthropic-ai/claude-code** | Official npm package | This project is NOT a fork — written from scratch |

---

## 📚 Further Reading

To understand the design decisions, read:

1. **Model Context Protocol spec** — https://modelcontextprotocol.io
2. **ReAct paper** — "ReAct: Synergizing Reasoning and Acting in Language Models" (Yao et al., 2022)
3. **LangGraph documentation** — https://langchain-ai.github.io/langgraph/
4. **Pydantic AI** — https://ai.pydantic.dev/
5. **CrewAI documentation** — https://docs.crewai.com/
6. **Claude Code MCP architecture** (from leaked source):
   - `src/entrypoints/mcp.ts` — MCP server entry
   - `src/tools.ts` — tool registry
   - `src/Tool.ts` — tool interface definition
   - `src/services/mcp/client.ts` — MCP client for connecting outbound

---

## 🏆 Design Goals Achieved

✅ **Minimal** — ~1500 LOC vs Claude Code's 100,000+
✅ **Modular** — Each framework in separate directory
✅ **Replaceable** — Swap LLM, validation, or orchestration easily
✅ **Educational** — Clear code showing how ReAct + MCP + CrewAI work together
✅ **Working** — All four frameworks actually integrated and functional

---

**Built by studying the best (claude-code-main) and selecting the right patterns.**
**Not a copy — a synthesis with Pollinations AI as the LLM provider.**
