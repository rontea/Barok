# Barok — Complete User Guide

For operators monitoring server-backed agent runs, see the [Running Agent Guide](./RUNNING_AGENT_GUIDE.md).

## 🚀 Quick Start (3 Commands)

```bash
# 1. Install dependencies
npm install

# 2. Run setup wizard (enter API key)
npm run setup

# 3. Try the demo (costs ~0.0004 pollen)
npm run demo
```

## 📋 Complete Command Reference

| Command | What it does | Example |
|---------|--------------|---------|
| `npm run setup` | Interactive wizard — API key, install, build | `npm run setup` |
| `npm run doctor` | Diagnose issues, suggest fixes | `npm run doctor` |
| `npm run test` | Test API, show models (abbreviated) | `npm run test` |
| `npm run balance` | Show pollen balance | `npm run balance` |
| `npm run models` | **List all 28 models with full pricing** | `npm run models` |
| `npm run demo` | Safe demo task (cheap model, tiny budget) | `npm run demo` |
| `npm run react -- "<task>"` | Run AI agent on your task | `npm run react -- "Write Python hello world"` |
| `npm start -- mcp` | Start MCP server (Claude Desktop) | `npm start -- mcp` |
| `npm run welcome` | Show quick-start guide | `npm run welcome` |

**Important:** With npm scripts, use `--` before arguments:
```bash
npm run react -- --model openai-fast --budget 5 "your task"
```
Or call directly (no `--` needed):
```bash
node dist/cli.js react --model openai-fast "your task"
```

## 🧠 Using the React Agent

### Basic Usage

```bash
# Simple task — uses default model (openai-fast) and budget (100)
npm run react -- "Write a Node.js script that fetches a URL"

# With custom options
npm run react -- --model openai-large --max-steps 20 --budget 5 "Analyze this codebase"

# See what the AI is thinking
npm run react -- --verbose "Explain how DNS works"

# Low-budget test
npm run react -- --budget 1 --model openai-fast "Say hello"
```

### Model Selection

Run `npm run models` to see all 28 models sorted by cost:

```
   1. nova-fast                 Cost: ~0.0001 pollen / 1K   ✓ tools
   2. qwen-coder                Cost: ~0.0002 pollen / 1K   ✓ tools
   3. openai-fast               Cost: ~0.0004 pollen / 1K   ✓ tools
   ...
  28. openai-large              Cost: ~0.0150 pollen / 1K   ✓ tools   CoT
```

**Recommendations:**
- **Cheapest & fast:** `nova-fast`, `openai-fast` (1 step ≈ $0.0004)
- **Coding tasks:** `qwen-coder`, `qwen-coder-large`
- **Balanced:** `openai`, `mistral`, `llama`
- **Complex reasoning:** `openai-large`, `kimi-k2.6`, `glm`
- **Large context (1M tokens):** `nova-2`, `qwen-large`

Change model:
```bash
node dist/cli.js react --model nova-fast "your task"
```

### Budget Control

Each ReAct step = 3 LLM calls (reason + plan + check). Cost per step:

| Model | Approx cost/step | Steps per 1 pollen |
|-------|------------------|-------------------|
| `nova-fast` | ~0.00004 | 25,000 |
| `openai-fast` | ~0.0004 | 2,500 |
| `openai` | ~0.0013 | 770 |
| `openai-large` | ~0.045 | 22 |

Set budget to limit total spend:
```bash
# Conservative — won't spend more than 1 pollen
npm run react -- --budget 1 "small task"

# Moderate — up to 5 pollen
npm run react -- --budget 5 "medium task"

# Default — 100 pollen (set in .env)
npm run react -- "large task"
```

The engine tracks cumulative cost and stops if budget exceeded:
```
📍 Step 3/10 | 💰 Spent: 0.0012 / 5
...
💰 Pollen spent: ~0.0048
Remaining: 4.9952 pollen
```

### Understanding Output

```
╔══════════════════════════════════════════════════════════════╗
║              Raw ReAct MCP — AI Agent Framework              ║
╚══════════════════════════════════════════════════════════════╝

🎯 Task: Write a Python hello world

⚠️  Cannot verify pollen balance (API key lacks account:usage scope)
   Proceeding with budget: 100 pollen

⚙️  Configuration:
   Model: openai-fast
   Max steps: 10
   Budget: 100 pollen

[ReAct] Step 1/10 | 💰 Spent: 0.0000 / 100
[ReAct] 💭 Thought: I'll create a Python file that prints "Hello, World!"
[ReAct] 🔨 Action: Write({file_path: "hello.py", content: "print('Hello, World!')"})
[ReAct] 👁️  Observed: File written successfully

✅ Task Complete!

Final answer:
────────────────────────────────────────
Created hello.py with: print('Hello, World!')
────────────────────────────────────────

📊 Statistics:
   Steps used: 1
   Pollen spent: ~0.0004
```

## 🔧 Troubleshooting

### "Max steps exceeded" or "402 Insufficient balance"
**Cause:** Account has 0 pollen. Each step costs pollen (amount varies by model).
**Fix:** Add pollen at https://enter.pollinations.ai (minimum 1–5 pollen). Use `--model openai-fast` for lowest cost per step.

### "Cannot check balance (key lacks account:usage scope)"
**Cause:** Your API key is valid but doesn't have permission to check balance. This is normal for public API keys.
**Fix:** This is just a warning — you can still use the API if you have pollen. If you get 402 errors, add pollen. Or request scope upgrade at https://enter.pollinations.ai.

### "too many arguments for 'react'"
**Cause:** Using `npm run react` without `--` separator.
**Fix:**
```bash
# WRONG
npm run react "task" --max-steps 5

# CORRECT
npm run react -- --max-steps 5 "task"

# Or skip npm entirely:
node dist/cli.js react "task" --max-steps 5
```

### "POLLINATIONS_API_KEY not set"
**Fix:** Run `npm run setup` and paste your key, or manually add to `.env`:
```
POLLINATIONS_API_KEY=<pollinations-api-key>
```

### MCP server not showing tools in Claude Desktop
**Fix:**
1. Verify path in `claude_desktop_config.json` points to `dist/cli.js`
2. Restart Claude Desktop completely
3. Check that `npm start -- mcp` runs without errors

### "Cannot read properties of undefined" errors
**Fix:** Ensure you've built the project: `npm run build`

## 🤖 Using with Claude Desktop (MCP)

### 1. Start the MCP Server

```bash
npm start -- mcp
```

Keep this terminal window open. The server runs in the background.

### 2. Configure Claude Desktop

**Mac:**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows:**
```
%APPDATA%\Claude\claude_desktop_config.json
```

Add:
```json
{
  "mcpServers": {
    "barok": {
      "command": "node",
      "args": ["<path-to-barok>/dist/cli.js", "mcp"],
      "env": {
        "POLLINATIONS_API_KEY": "your_key_here"
      }
    }
  }
}
```

**Note:** In MCP mode, Claude uses its own API for reasoning. Your Pollinations key is only needed if you use the `react` command directly.

### 3. Restart Claude Desktop

Close and reopen Claude.

### 4. Use the Tools

Ask Claude:
> "Use the barok-react tools to create a Node.js script that reads a JSON file and prints its contents"

Claude will:
1. Use `Glob` to find JSON files
2. Use `Read` to read a file
3. Use `Write` to create a script
4. Use `Bash` to run it
5. Return results to you

**Available tools in Claude:**
- `Bash` — Execute shell commands
- `Read` / `Write` / `Edit` — File operations
- `Glob` / `Grep` — Search files
- `TaskCreate` / `TaskList` / `TaskUpdate` — Task management
- `generateImage` — Create images (Pollinations)
- `generateText` — Text generation (Pollinations)

## 💰 Pollen (Credits) Guide

### What is pollen?
Pollen is the credit currency on Pollinations. Every API call costs pollen.

### Cost breakdown (per ReAct step = 3 LLM calls)

| Model | Output cost / 1K | Step cost (≈300 tokens × 3 calls) |
|-------|------------------|--------------------------------|
| `nova-fast` | 0.0001 | ~0.00004 |
| `openai-fast` | 0.0004 | ~0.0004 |
| `openai` | 0.0013 | ~0.0012 |
| `openai-large` | 0.0150 | ~0.045 |
| `claude-fast` | 0.0055 | ~0.016 |

### How much do I need?

**For testing/learning:**
- 1 pollen = ~2,500 steps with `openai-fast` (enough for dozens of tasks)
- 5 pollen = plenty for extensive testing

**For regular use:**
- 20 pollen = moderate usage (~500 steps with `openai-fast`)
- 100 pollen = heavy usage

**To buy pollen:**
1. Go to https://enter.pollinations.ai
2. Click "Billing" or "Add Credits"
3. Choose amount (min ~1–5 pollen ≈ $0.12–0.60)
4. Payment via credit card/crypto
5. Wait 30 seconds, then run `npm run test` to verify

### Track spending

Every `react` run shows:
- Starting balance (if key has scope)
- Budget limit
- Real-time step cost: `📍 Step 3 | 💰 Spent: 0.0012 / 10`
- Final total: `💰 Pollen spent: ~0.0048`

## 🛠️ Development

### Project Structure
```
<path-to-barok>/
├── packages/                  # Extracted packages (@barok/core, @barok/engine, etc.)
├── apps/                      # Standalone applications (apps/mcp-server)
├── src/                       # Main application source
│   ├── mcp/                   # MCP server (stdio)
│   ├── pollinations/          # Pollinations API wrapper
│   ├── tools/                 # Dev tools (Bash/Read/Write/Edit/Glob/Grep)
│   ├── react/                 # ReAct loop engine & LangGraph state
│   ├── agents/                # CrewAI multi-agent
│   ├── validation/            # Pydantic-like validation
│   ├── types/                 # Zod schemas
│   └── cli.ts                 # Entry point
├── dist/                      # Built files (after build)
├── package.json
├── tsconfig.json
└── README.md
```

### Build & Dev

```bash
# Build monorepo packages
npm run build:packages

# Development (hot-reload)
npm run dev

# Lint
npm run lint

# Format
npm run format
```

### Programmatic API

```typescript
import { ReActEngine } from './src/react/engine.js';

const engine = new ReActEngine({
  model: 'openai-fast',  // or 'nova-fast', 'qwen-coder', etc.
  maxSteps: 20,
  budget: 50,            // max pollen to spend
  verbose: true,
});

const result = await engine.run('Create a React component with a button');

if (result.success) {
  console.log('Done:', result.finalAnswer);
} else {
  console.error('Failed:', result.error);
}

console.log(`Cost: ${result.pollenCost} pollen`);
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POLLINATIONS_API_KEY` | (required) | Get from https://enter.pollinations.ai |
| `MAX_STEPS` | `10` | Maximum ReAct loop iterations |
| `DEFAULT_MODEL` | `openai-fast` | Default text model |
| `BUDGET` | `100` | Default max pollen per task |
| `DEBUG` | `false` | Enable debug logging |

Set in `.env` file:
```
POLLINATIONS_API_KEY=sk_your_key
MAX_STEPS=10
DEFAULT_MODEL=openai-fast
BUDGET=100
```

## ⚠️ Safety & Security

This tool gives the AI full filesystem and shell access. **Only run in trusted directories.**

**Mitigations:**
1. Run in isolated/scratch directories when testing
2. Review commands before execution (verbosity helps)
3. Set a low `--budget` to limit potential damage/cost
4. Use file permission allowlists (future feature)
5. Containerize with Docker for isolation

## 📚 Further Help

- **README:** This file
- **Pollinations docs:** https://pollinations.ai/docs
- **MCP spec:** https://modelcontextprotocol.io
- **Issues:** Project issue tracker on GitHub

---

**Built by Kilo • 2026**
