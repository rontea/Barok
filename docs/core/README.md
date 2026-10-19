# Barok (formerly Raw ReAct MCP) — Core Documentation

> [!NOTE]
> This document preserves the foundational design and usage guide for the ReAct engine and MCP tool integration.
> In the modern Barok monorepo (`v0.0.1-experimental`), core ReAct contracts and validation are factored into `@barok/core` and `@barok/engine`, while MCP adapters are in `@barok/adapter-mcp` and `apps/mcp-server`.

**AI Agent Framework — ReAct Loop powered by Pollinations AI & Gemini with full tool access via MCP**

```bash
# Quick start (interactive)
npm run setup

# Build monorepo packages
npm run build:packages

# Start CLI or MCP server:
npm run dev
node dist/cli.js mcp
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     YOUR AI AGENT                          │
│                    (ReAct Loop)                           │
└─────────────┬──────────────────────────┬──────────────────┘
              │ Reason                  │ Act
              ▼                         ▼
┌─────────────────────┐      ┌─────────────────────────┐
│  LangGraph Engine   │─────▶│  Tool Router           │
│  (state machine)    │      │  (MCP / Direct)        │
└──────────┬──────────┘      └───────────┬─────────────┘
           │                             │
           │ Calls Tool                  │ Executes
           ▼                             ▼
┌─────────────────────┐      ┌─────────────────────────┐
│  Pollinations API   │      │  Dev Tools             │
│  - Chat Completion  │      │  - Bash                │
│  - Text Gen         │      │  - Read/Write/Edit     │
│  - Image Gen        │      │  - Glob/Grep           │
│  - Audio Gen        │      │  - Task Manager        │
└─────────────────────┘      └─────────────────────────┘
```

## Getting Started

### 1. Install & Setup

```bash
# Install dependencies
npm install

# Run interactive setup wizard (recommended)
npm run setup

# Or set API keys manually in .env:
#   - Get Pollinations key from: https://enter.pollinations.ai (for default models)
#   - Get Google Gemini key from: https://aistudio.google.com/ (for native fast Gemini models & balance fallback)
#   - Add to .env:
#     POLLINATIONS_API_KEY=<pollinations-api-key>
#     GEMINI_API_KEY=your_gemini_key_here
```

### 2. Verify Installation

```bash
# Run diagnostics
npm run doctor

# Test API connectivity
npm run test

# Check pollen balance
npm run balance
```

### 3. Try It Out

```bash
# Run a quick demo (safe, low cost)
npm run demo

# Run your own task
npm run react -- "Write a Python hello world function"

# With options
npm run react -- --model gpt-3.5-turbo --budget 5 --verbose "Explain recursion"
```

### 4. Use with MCP Clients (Claude Desktop, Continue)

```bash
# Start the MCP server
npm start -- mcp
```

#### Option A: Claude Desktop

Configure Claude Desktop:
- Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "barok-react": {
      "command": "node",
      "args": ["<path-to-barok>/dist/cli.js", "mcp"],
      "env": {
        "POLLINATIONS_API_KEY": "your_pollinations_key_here",
        "GEMINI_API_KEY": "your_optional_gemini_key_here"
      }
    }
  }
}
```

#### Option B: Continue.dev (VS Code / JetBrains)

Configure Continue by opening `~/.continue/config.json`. Continue supports the exact same format as Claude Desktop:

```json
{
  "mcpServers": {
    "barok-react": {
      "command": "node",
      "args": ["<path-to-barok>/dist/cli.js", "mcp"],
      "env": {
        "POLLINATIONS_API_KEY": "your_pollinations_key_here",
        "GEMINI_API_KEY": "your_optional_gemini_key_here"
      }
    }
  }
}
```

Now your AI assistant can use all the tools (Bash, Read, Write, etc.) natively through this server!

## Components

### 1. ReAct Engine (`src/react/engine.ts`)
Implements the classic ReAct loop:
- **Reason**: LLM analyzes current state and previous observations
- **Plan**: LLM selects next tool + arguments based on schema
- **Act**: Tool executes (file ops, shell, generation)
- **Observe**: Result captured and fed back into next reasoning step
- **Repeat**: Until `maxSteps` or LLM signals completion

Configurable:
```typescript
const engine = new ReActEngine({
  model: 'claude',        // Pollinations model
  maxSteps: 10,
  verbose: true,
});
const result = await engine.run('Create a todo app');
```

### 2. MCP Server (`src/mcp/server.ts`)
Exposes all tools via Model Context Protocol (stdio transport):
- **Pollinations tools**: `generateImage`, `generateText`, `chatCompletion`
- **Dev tools**: `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`
- **Task tools**: `TaskCreate`, `TaskList`, `TaskUpdate`

Connect from:
- Claude Desktop
- Cursor
- Windsurf
- Any MCP-compatible client

### 3. Validation Layer (`src/validation/`)
Pydantic-style schemas for all tool inputs:
- Zod runtime validation
- Type-safe at compile time
- Clear error messages
- Prevents invalid operations

### 4. CrewAI Coordination (`src/agents/crew.ts`)
Multi-agent orchestration:
- **Coder**: writes code
- **Researcher**: finds info
- **Tester**: validates
- **Reviewer**: improves quality
- **Planner**: creates structured plans and breaks down tasks
- **Documenter**: writes user-centric documentation and readmes

Auto-assignment based on task keywords, or manual assignment:
```typescript
const crew = new CrewCoordinator(pollinationsClient);
await crew.createTask('Write user auth', AgentRole.CODER);
await crew.createTask('Research OAuth best practices', AgentRole.RESEARCHER);
await crew.runAll(parallel: true);
```

## Available Tools

### Dev Tools (File Operations)
| Tool | Purpose | Example |
|------|---------|---------|
| `Read` | Read file contents | `Read({ file_path: "/path/to/file.ts" })` |
| `Write` | Create/overwrite file | `Write({ file_path: "app.js", content: "..." })` |
| `Edit` | String replacement | `Edit({ file_path: "a.js", old_string: "foo", new_string: "bar" })` |
| `Glob` | Find files by pattern | `Glob({ pattern: "src/**/*.ts" })` |
| `Grep` | Search file contents | `Grep({ pattern: "function\\s+test", type: "files_with_matches" })` |

### Shell
| Tool | Purpose | Example |
|------|---------|---------|
| `Bash` | Execute shell commands | `Bash({ command: "npm test", timeout: 60000 })` |

### Pollinations AI
| Tool | Purpose | Example |
|------|---------|---------|
| `generateImage` | Create images | `generateImage({ prompt: "sunset", model: "flux" })` |
| `generateText` | Text generation | `generateText({ prompt: "Explain quantum physics", model: "claude" })` |
| `chatCompletion` | OpenAI-compatible chat | `chatCompletion({ messages: [...], tools: [...] })` |

### Task Management
| Tool | Purpose | Example |
|------|---------|---------|
| `TaskCreate` | Create a task | `TaskCreate({ subject: "Fix bug", description: "..." })` |
| `TaskList` | List all tasks | `TaskList({})` |
| `TaskUpdate` | Update status/owner | `TaskUpdate({ id: "1", status: "completed" })` |

## Usage Examples

### Standalone ReAct Loop

**Important:** When using npm scripts, you must include `--` before arguments:

```bash
# ❌ WRONG — args go to npm, not your command
npm run react "Write hello" --max-steps 5

# ✅ CORRECT — use -- to forward args
npm run react -- "Write hello" --max-steps 5 --budget 10

# Or call directly (no -- needed):
node dist/cli.js react "Write hello" --max-steps 5
```

**Examples:**

```bash
# Simple task
npm run react -- "Say hello world"

# Complex task broken down for multiple specialized agents
npm run crew -- "Build a snake game, test it, and write documentation"

# With options
npm run react -- --model gpt-3.5-turbo --max-steps 5 --budget 5 "Explain quantum physics"

# Verbose output to see reasoning and pollen cost per step
npm run react -- --verbose --budget 20 "Refactor this function"
```

**Budget tip:** Cost per step depends on model. With `openai-fast` ~0.001 pollen/step; `openai-large` ~0.045. Run `npm run models` for full comparison.

### As MCP Server (Claude Desktop / Continue.dev)
```json
{
  "mcpServers": {
    "barok-react": {
      "command": "node",
      "args": ["<path-to-barok>/dist/cli.js", "mcp"],
      "env": {
        "POLLINATIONS_API_KEY": "pk_your_key"
      }
    }
  }
}
```

Then in Claude Desktop or Continue.dev (using `@barok-react`):
> "Write a bash script to back up my /data folder to ~/backups"

The AI will use `Bash` tool → observe output → iterate until done.

### Programmatic Use
```typescript
import { ReActEngine } from './src/react/engine.js';
import { pollinationsClient } from './src/pollinations/client.js';

const engine = new ReActEngine({
  model: 'claude',
  maxSteps: 20,
  budget: 50, // Maximum pollen to spend
  verbose: true,
});

const result = await engine.run('Analyze this codebase and suggest 3 improvements');
console.log(result.finalAnswer);
// Pollen spent: ~result.pollenCost
```

### Multi-Agent Crew
```typescript
import { CrewCoordinator, AgentRole } from './src/agents/crew.js';

// Initialize a multi-agent system with a specific default model
// (e.g., gemini-3.5-flash, which is fast and efficient for sub-agents)
const crew = new CrewCoordinator(pollinationsClient, 'gemini-3.5-flash');

// Auto-breakdown + assign to different specialized sub-agents!
// Based on the prompt, it automatically distributes tasks to:
// - Planner, Coder, Tester, Reviewer, Documenter, or Researcher
const answer = await crew.orchestrateComplexTask(
  'Design a new CLI tool, write the code, test it, and document how to use it'
);
console.log(answer);
```

### Using Native Gemini API

If you configure the ReAct engine or Crew Coordinator to use `gemini-3.5-flash`, `gemini-3.1-flash-lite`, `gemini-2.5-flash`, or another `gemini-*` model, the engine will intercept those calls and use the **native Gemini API** (Google AI Studio) rather than the default API. This is heavily recommended for multi-agent workloads to utilize the generously high rate limits and low costs of Gemini!

**Setup:**
1. Get an API key from [Google AI Studio](https://aistudio.google.com/)
2. Add it to your `.env` file:
   ```env
   GEMINI_API_KEY=your_gemini_key_here
   ```
3. Use a `gemini-` prefix model for your agents:
   ```bash
   npm run crew --model gemini-3.5-flash "Write a game"
   ```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `POLLINATIONS_API_KEY` | Required. Get from https://enter.pollinations.ai |
| `GEMINI_API_KEY` | Intercepts Gemini models (`gemini-3.5-flash`, etc.) natively |
| `MAX_STEPS` | Default ReAct steps (default: 10) |
| `DEFAULT_MODEL` | Pollinations model (default: claude) |
| `BUDGET` | Default max pollen to spend (default: 100) |
| `DEBUG` | Enable debug logging |

## Quick Reference

### Command-line Usage

**Direct (simplest argument handling):**
```bash
node dist/cli.js react "your task" --max-steps 10 --budget 50
```

**Using npm scripts (requires `--` separator):**
```bash
# The "--" tells npm to pass following args to the script
npm run react -- --max-steps 10 --budget 50 "your task"

# Shortcut with safe defaults:
npm run demo   # runs demo with tiny budget
```

### Command Cheat Sheet

| Command | Purpose |
|---------|---------|
| `npm run setup` | Interactive setup wizard |
| `npm run doctor` | Diagnose setup issues |
| `npm run test` | Test API connectivity |
| `npm run balance` | Check pollen balance |
| `npm run models` | **List all available AI models** with full pricing |
| `npm run demo` | Run safe demo (costs ~0.0004 pollen) |
| `npm run react -- "<task>"` | Run AI agent on a task |
| `npm run crew -- "<task>"` | Delegate complex task to sub-agents (Coder, Tester, etc.) |
| `npm start -- mcp` | Start MCP server (Claude Desktop) |
| `npm run welcome` | Show quick start guide |

## Model Selection

Pollinations offers 28+ text models. View them:
```bash
node dist/cli.js models
```

### Recommended Models by Use Case

| Model | Cost / 1K tokens | Best For |
|-------|------------------|----------|
| `nova-fast` | ~0.0001 | Ultra cheap, fast, tool-calling |
| `openai-fast` | ~0.0004 | Fast, affordable, reliable |
| `gemini-3.5-flash` | ~0.0000 | Fast, currently free/low cost, great for sub-agents |
| `qwen-coder` | ~0.0002 | Code generation |
| `mistral` | ~0.0003 | Balanced, multilingual |
| `openai` | ~0.0013 | General purpose, balanced |
| `nova-2` | ~0.0027 | Large context (1M), reasoning |
| `openai-large` | ~0.0150 | Most powerful, expensive |
| `claude-fast` | ~0.0055 | Claude Haiku, fast & smart |

### Changing Model

```bash
# Use a cheap/fast model
node dist/cli.js react --model openai-fast "Write a script"

# Use a powerful reasoning model
node dist/cli.js react --model openai-large "Complex analysis task"

# Use a coding-specialized model
node dist/cli.js react --model qwen-coder "Refactor this code"
```

**Cost estimation:** A typical ReAct step makes 3 LLM calls (reason + plan + check). With `openai-fast` (~0.0004/1K output), each step costs ~0.0002-0.0004 pollen. With `openai-large` (~0.015/1K), each step costs ~0.045 pollen.

**Default:** `openai-fast` (fast and affordable for most tasks)

## Usage Tips

### Budget Control

**Cost per step varies by model.** Run `npm run models` to see exact pricing.

Typical costs (approximate, per ReAct step = 3 LLM calls):
- `nova-fast` / `openai-fast`: ~0.001 pollen/step
- `qwen-coder` / `mistral`: ~0.002–0.003 pollen/step
- `openai` / `llama`: ~0.004 pollen/step
- `openai-large` / `claude-fast`: ~0.04–0.06 pollen/step

**Examples:**
```bash
# Cheap model — 1000 steps for ~1 pollen
npm run react -- --model openai-fast --budget 1 "Large task"

# Premium model — 20 steps for ~1 pollen
npm run react -- --model openai-large --budget 1 "Complex analysis"

# Check actual spending:
npm run react -- --verbose --budget 10 "your task"
```

Output shows:
```
💰 Starting balance: 5.25 pollen
📊 Budget limit: 5 pollen (95.2% of balance)
📍 Step 1/20 | 💰 Spent: 0.0000 / 5
...
💰 Pollen spent: ~2.1600
Remaining: 3.0900 pollen
```

### Check Balance & Usage

```bash
# Quick balance check
npm run balance

# Shows:
#   💰 Current balance: 5.25 pollen
#   or: ⚠️  Balance check only available with secret API keys
```

### Troubleshooting

#### "Max steps exceeded" or "402 Insufficient balance"
Your Pollinations account has 0 pollen. Cost per step depends on model (~0.001–0.05 typical).
**Fix:** Add pollen at https://enter.pollinations.ai (minimum 1-5 pollen). Use `--model openai-fast` for cheapest.

#### "Cannot check balance (key lacks account:usage scope)"
Your API key is valid but doesn't have permission to check balance. This is OK — you can still use the API if you have pollen.
**Fix:** Ignore this warning if you know you have pollen. Or request scope upgrade at https://enter.pollinations.ai.

#### "too many arguments for 'react'"
You're using `npm run react` incorrectly.
**Fix:** Use `npm run react -- --max-steps 5 "task"` (note the `--`), or call directly: `node dist/cli.js react "task" --max-steps 5`.

#### "POLLINATIONS_API_KEY not set"
**Fix:** Run `npm run setup` to enter your API key interactively, or add to `.env` file.

#### MCP server not showing tools in Claude Desktop or Continue.dev
**Fix:** Ensure the path in `claude_desktop_config.json` or `~/.continue/config.json` is correct and points to `dist/cli.js`, then restart Claude or Continue.

### Working with MCP Clients

1. Start server: `npm start -- mcp`
2. Configure your client's config file (Claude Desktop or Continue.dev, see above)
3. Restart the client (restart Claude, or reload window in VS Code)
4. Ask: "Use the barok-react tools to create a Node.js script that reads a file"
5. The AI will use `Read`, `Write`, `Bash`, etc. through your server directly.

**Note:** In MCP mode, your MCP client uses its own LLM for reasoning to decide which tools to call. The Pollinations API key is only used by tools that explicitly generate content (e.g. `generateText`, `generateImage`).

### Programmatic Use

```typescript
import { ReActEngine } from './src/react/engine.js';

const engine = new ReActEngine({
  model: 'claude',      // or 'gpt-3.5-turbo', 'openai', etc.
  maxSteps: 20,
  budget: 50,           // max pollen to spend
  verbose: true,
});

const result = await engine.run('Analyze this codebase and suggest improvements');

console.log('Success:', result.success);
console.log('Answer:', result.finalAnswer);
console.log('Steps:', result.stepCount);
console.log('Cost:', `${result.pollenCost} pollen`);
```

## Project Structure

```
<path-to-barok>/
├── packages/                  # Modular extracted packages (v0.0.1-experimental)
│   ├── core/                  # Host-neutral contracts and sanitization
│   ├── engine/                # ReAct contracts, compaction & budget policies
│   ├── adapter-node/          # Node-specific capabilities & process executor
│   ├── adapter-mcp/           # MCP protocol serialization & stdio adapter
│   └── plugin-deepseek/       # Cordis-compatible DeepSeek Harness bundle
├── apps/                      # Standalone applications
│   └── mcp-server/            # Decoupled stdio MCP server entrypoint
├── src/                       # Standalone ReAct application & CLI
│   ├── mcp/                   # MCP server (stdio)
│   ├── pollinations/          # Pollinations API wrapper
│   ├── tools/                 # Dev tools (Bash/Read/Write/Edit/Glob/Grep)
│   ├── react/                 # ReAct loop engine & LangGraph state machine
│   ├── agents/                # CrewAI multi-agent orchestrator
│   ├── validation/            # Pydantic-style validators
│   └── cli.ts                 # CLI entry point
├── package.json
└── tsconfig.json
```

## How It Works: The ReAct Loop

```
Step 1 — Reason
  LLM sees task + history → thinks about what to do next
  "I need to check if package.json exists first"
  → Chooses: Read tool with file_path

Step 2 — Act
  Execute Read(file_path="package.json")
  → Returns file contents

Step 3 — Observe
  LLM sees: "dependencies: { react: ^18.0.0 }"
  "Ah, it's a React project. I should look for src/ directory."

Step 4 — Repeat
  Plans next action: Glob(pattern="src/**/*.tsx")
  → Execute → Observe results → Reason again

... until satisfied or max_steps reached.
```

## Framework Integration

| Framework | Integration |
|-----------|-------------|
| **LangGraph** | ReAct state machine in `src/react/engine.ts` (LangGraph pattern) |
| **Pydantic AI** | Validation schemas in `src/types/schemas.ts` (Pydantic design) |
| **CrewAI** | Multi-agent coordination in `src/agents/crew.ts` |
| **MCP** | Tool exposure via `src/mcp/server.ts` |

**All four frameworks work together:**
- Pollinations LLM provides intelligence
- ReAct loop (LangGraph pattern) controls flow
- Pydantic schemas validate every tool call
- CrewAI coordinates multiple specialized agents
- MCP standardizes tool access across all clients

## Safety & Permissions

⚠️ **WARNING**: This gives LLM full filesystem + shell access.

**Protect yourself:**
1. Only run in trusted directories
2. Use containerization (Docker sandbox)
3. Set file permission allowlists in production
4. Review commands before execution (add confirmation layer)
5. Use `POLLINATIONS_API_KEY` with spend limits

## License

MIT — Free to use, modify, distribute.

Built by Kilo • 2026
