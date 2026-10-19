# 📖 Complete Run Guide — Barok

For current server-backed run operations, state transitions, event interpretation, and model tuning, see the [Running Agent Guide](./RUNNING_AGENT_GUIDE.md).

## Table of Contents
1. [Quick Start](#-quick-start)
2. [Installation](#-installation)
3. [Configuration](#-configuration)
4. [Running Modes](#-running-modes)
5. [MCP Integration](#-mcp-integration)
6. [Examples](#-examples)
7. [Troubleshooting](#-troubleshooting)
8. [Advanced](#-advanced)

---

## 🚀 Quick Start (5 Minutes)

```bash
# 1. Clone/cd to project
cd <path-to-barok>

# 2. Install dependencies (requires Node.js 18+)
npm install

# 3. Get API key (free)
# Visit: https://enter.pollinations.ai
# Click "Create API Key" → Copy the pk_* key

# 4. Configure
echo "POLLINATIONS_API_KEY=<pollinations-api-key>" > .env

# 5. Test connection
node dist/cli.js test
# Expected output: ✅ Connected to Pollinations

# 6. Try a simple ReAct task
node dist/cli.js react "List all .ts files in src/ directory"
```

That's it! You now have a working ReAct loop.

---

## 📦 Installation

### Prerequisites

| Software | Version | Why |
|----------|---------|-----|
| **Node.js** | ≥ 18.0.0 | Runtime + npm |
| **npm** | ≥ 7.0.0 | Dependency management |
| **Pollinations API Key** | Free | LLM provider |

**Get Node.js:**
- Download from nodejs.org (LTS recommended)
- Or use nvm: `nvm install 20 && nvm use 20`
- Verify: `node --version` → should show v18+

### Step-by-Step Install

```bash
# 1. Navigate to project
cd <path-to-barok>

# 2. Install all dependencies (≈30 seconds)
npm install

# What gets installed:
# - @modelcontextprotocol/sdk  (MCP protocol)
# - @anthropic-ai/sdk          (Anthropic API types)
# - zod                       (validation)
# - typescript                (compiler)
# - esbuild                   (bundler)
# - commander                 (CLI framework)
# - dotenv                    (config loader)
# - openai                    (API client for Pollinations)
# - ... plus all sub-dependencies

# 3. Build TypeScript → JavaScript (bundled)
npm run build

# This creates dist/ directory with:
# - cli.js      (main entry point)
# - mcp/server.js (MCP server)
# - react/engine.js (ReAct engine)
# - pollinations/client.js (API wrapper)
# - agents/crew.js (multi-agent)
# - etc.

# 4. Verify build
ls dist/
# Should see: cli.js mcp/ pollinations/ tools/ react/ agents/
```

### Direct Monorepo Execution

```bash
# From the repository root:
npm run dev
# Or run with CLI args:
node dist/cli.js react "your task"
```

---

## ⚙️ Configuration

### 1. Pollinations AI API Key (Default)

By default, the ReAct loop uses free-tier and premium models via Pollinations AI. Get your publishable key:

1. Go to [https://enter.pollinations.ai](https://enter.pollinations.ai)
2. Sign up / log in
3. Click **Create New Key**
4. Copy the key (starts with `pk_` for public usage)

### 2. Native Google Gemini API Key (Highly Recommended)

You can activate native Google Gemini model integration which entirely bypasses external proxies, yielding exceptional rate limits and faster response times for heavier agent workflows:

1. Visit the [Google AI Studio](https://aistudio.google.com/)
2. Generate an API Key (Free tier available)
3. Copy your key (standard keys often start with `AIzaSy...`; newer auth keys may start with `AQ...`)

This key enables:
- Natively running fast high-performance reasoning via **Gemini 3.5 Flash** (`gemini-3.5-flash`) and **Gemini 1.5 Flash** (`gemini-1.5-flash`).
- **Pollination Balance Fallback**: If you run out of Pollinations pollen (status 402/payment required/rate limit), the ReAct engine automatically falls back to native `gemini-3.5-flash` so your agent task doesn't fail!

### Environment Variables (.env)

Create a `.env` file in your project's root directory:

```env
# .env

# Pollinations AI Key
POLLINATIONS_API_KEY=<pollinations-api-key>

# Native Gemini API Key (Required for Native models or Fallback)
GEMINI_API_KEY=your_gemini_key_here

# Optional: Change defaults
MAX_STEPS=15                    # Max ReAct iterations (default: 10)
DEFAULT_MODEL=gemini-3.5-flash  # Use Native Gemini 3.5 Flash locally!
DEBUG=true                     # Verbose MCP logging
REACT_VERBOSE=true            # Show each ReAct step
```

**Load env file:** The CLI and full-stack Express server automatically load `.env` at boot.

### 🔍 API Verification & Diagnosis

You can quickly verify that your keys are configured correctly and active:

#### Option A: Via Web UI
Launch the dashboard (`npm run dev`) and click the **Check Gemini Fallback** / **Check Gemini** button. It will trigger a secure validator (`/api/gemini/validate`) checking that your key communicates properly with the Gemini ecosystem and is ready to act as a failover.

#### Option B: Via Command Line
Test your connection natively:
```bash
node dist/cli.js test
```

### Alternative: Environment Variables Directly

```bash
# Linux/Mac
export POLLINATIONS_API_KEY=pk_your_key

# Windows PowerShell
$env:POLLINATIONS_API_KEY="pk_your_key"

# Then run
node dist/cli.js react "task"
```

### Configuration File (Optional)

Create `config.json` for more complex setups:

```json
{
  "pollinations": {
    "apiKey": "pk_your_key",
    "defaultModel": "claude",
    "timeout": 30000
  },
  "react": {
    "maxSteps": 10,
    "verbose": true
  },
  "crew": {
    "maxParallelAgents": 3
  }
}
```

Load with: `node dist/cli.js --config ./config.json react "task"`

---

## 🎮 Running Modes

The system supports **4 distinct modes**:

### Mode 1: MCP Server (For Claude Desktop/Cursor)

This exposes all tools to any MCP-compatible client.

**Start the server:**
```bash
# Option A: Direct node
node dist/cli.js mcp

# Option B: Via npm script
npm run start -- mcp

# With debug logging
node dist/cli.js mcp --debug
```

**What happens:**
1. Server starts and listens on stdin/stdout (stdio transport)
2. Waits for JSON-RPC messages from MCP client
3. Advertises all tools (Bash, Read, generateImage, etc.)
4. Executes tool calls on request

**Connect Claude Desktop:**

1. Open Claude Desktop
2. Go to Settings → **MCP Servers** (or "Add MCP Server")
3. Click **Add New Server**
4. Fill in:
   - **Name:** Barok
   - **Command:** `node`
   - **Arguments:** `<path-to-barok>/dist/cli.js mcp`
   - **Working directory:** `<path-to-barok>`
   - **Environment:** Add `POLLINATIONS_API_KEY` = your key

5. Save & Restart Claude Desktop

**Usage in Claude:**
```
You: "Write a bash script that backs up my Documents folder"
→ Claude calls: Bash({ command: "mkdir -p ~/backups" })
→ Observed: "Directory created"
→ Claude calls: Bash({ command: "cp -r ~/Documents ~/backups/" })
→ Observed: "Copied 234 files"
→ Claude: "Done! Backed up your Documents folder."
```

### Mode 2: Direct ReAct Loop (CLI)

Run a task from the command line, get structured output.

**Basic usage:**
```bash
node dist/cli.js react "Your task description here"
```

**Examples:**
```bash
# Simple
node dist/cli.js react "Count Python files in src/"

# Complex
node dist/cli.js react "Create a REST API with Express.js that has:
  - GET /users endpoint
  - POST /users to create
  - Store data in JSON file
  - Include error handling"

# With options
node dist/cli.js react "Build a React component" --model claude --max-steps 20 --verbose

# Parallel execution (JSON output for parsing)
node dist/cli.js react "list all .js files" --output json > results.json
```

**Available options:**
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--model <name>` | string | `claude` | Pollinations model (claude, openai, deepseek, etc.) |
| `--max-steps <n>` | number | `10` | Maximum reasoning iterations |
| `--verbose` | boolean | `false` | Print each step |
| `--output <format>` | string | `text` | Output format: `text` or `json` |
| `--help` | flag | — | Show help |

**JSON output for automation:**
```json
{
  "success": true,
  "finalAnswer": "Created user API with 3 endpoints...",
  "stepCount": 7,
  "steps": [
    {
      "thought": "I'll start by initializing npm project",
      "action": "Bash({\"command\":\"npm init -y\"})",
      "observation": "package.json created"
    },
    ...
  ]
}
```

**Programmatic usage:**
```typescript
import { ReActEngine } from './src/react/engine.js';
import { pollinationsClient } from './src/pollinations/client.js';

pollinationsClient.setApiKey(process.env.POLLINATIONS_API_KEY!);

const engine = new ReActEngine({
  model: 'claude',
  maxSteps: 15,
  verbose: true,
});

const result = await engine.run('Analyze security vulnerabilities in this codebase');
console.log(result.finalAnswer);
```

### Mode 3: Multi-Agent Crew

Orchestrate multiple specialized agents working together.

**Quick demo:**
```bash
# Run the crew example
node dist/examples/runExamples.js
```

**Or programmatically:**
```typescript
import { CrewCoordinator, AgentRole } from './src/agents/crew.js';
import { pollinationsClient } from './src/pollinations/client.js';

pollinationsClient.setApiKey(process.env.POLLINATIONS_API_KEY!);

const crew = new CrewCoordinator(pollinationsClient);

// Method 1: Auto-breakdown complex tasks
const answer = await crew.orchestrateComplexTask(`
  Build a full-stack app:
  1. Backend API with Express
  2. Frontend with HTML/CSS/JS
  3. Deploy to Vercel
`);
console.log(answer);

// Method 2: Manual task assignment
await crew.createTask('Set up Express server', AgentRole.CODER);
await crew.createTask('Research best database for this', AgentRole.RESEARCHER);
await crew.createTask('Write unit tests', AgentRole.TESTER);
await crew.createTask('Code review', AgentRole.REVIEWER);

// Execute sequentially or in parallel
const results = await crew.runAll(parallel: false);
results.forEach(r => console.log(`${r.taskId}: ${r.result}`));

// See all agents
console.log('Available agents:', crew.getAgents());
// [ 'coder', 'researcher', 'tester', 'reviewer' ]
```

**Agent roles:**

| Role | Goal | Tools Used |
|------|------|------------|
| **Coder** | Write high-quality code | Write, Edit, Bash, Glob, Grep |
| **Researcher** | Find and synthesize info | WebFetch (if added), Read, Glob |
| **Tester** | Ensure quality through testing | Bash (test runners), Read, Glob |
| **Reviewer** | Find issues and suggest improvements | Read, Grep, Bash (linters) |

### Mode 4: MCP Client (Connect from Another Process)

Write your own MCP client that connects to this server:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client(
  { name: 'my-client', version: '1.0' },
  { capabilities: { tools: {} } }
);

await client.connect(
  new StdioClientTransport({
    command: 'node',
    args: ['<path-to-barok>/dist/cli.js', 'mcp'],
  })
);

// List tools
const tools = await client.listTools();
console.log('Available tools:', tools.tools.map(t => t.name));

// Call a tool
const result = await client.callTool({
  name: 'Bash',
  arguments: { command: 'ls -la' },
});
console.log(result.content);
```

---

## 🔌 MCP Integration Details

### What is MCP?

Model Context Protocol (MCP) is a standard way for AI assistants to access external tools. Think of it as **USB-C for AI tools** — one standard, many devices.

### MCP Transport Types

This server uses **stdio** (standard input/output):
```
Claude Desktop ←(JSON-RPC over stdio)→ Raw ReAct MCP Server
```

**Why stdio?**
- Simple (no network setup)
- Secure (local only)
- Standard for CLI tools
- Works everywhere

### Connecting Different MCP Clients

#### Claude Desktop
```json
// ~/Library/Application Support/Claude/claude_desktop_config.json
// Mac: ~/Library/Application Support/Claude/
// Windows: %APPDATA%\Claude\
// Linux: ~/.config/Claude/

{
  "mcpServers": {
    "barok": {
      "command": "node",
      "args": ["<path-to-barok>/dist/cli.js", "mcp"],
      "env": {
        "POLLINATIONS_API_KEY": "<pollinations-api-key>",
        "MAX_STEPS": "15"
      },
      "workingDirectory": "<path-to-barok>"
    }
  }
}
```

**Restart Claude Desktop** → Tools appear automatically.

#### Cursor IDE
```json
// ~/.cursor/mcp.json or project .mcp.json
{
  "mcpServers": {
    "barok": {
      "command": "node",
      "args": ["<path-to-barok>/dist/cli.js", "mcp"],
      "cwd": "<path-to-barok>",
      "env": {
        "POLLINATIONS_API_KEY": "pk_your_key"
      }
    }
  }
}
```

**Reload Cursor window** (Cmd+Shift+P → "Developer: Reload Window").

#### Windsurf / Continue
Same JSON format. Check their docs for MCP config path.

### MCP Tool Lifecycle

```
1. Client connects → Server sends "initialize" response
2. Client requests "initialized" notification
3. Client calls "tools/list"
   → Server returns: [
       { name: "Bash", inputSchema: {...} },
       { name: "Read", ... },
       { name: "generateImage", ... }
     ]
4. Client displays tools to LLM (invisible to user)
5. User asks: "Create a file"
6. LLM decides: "I'll use Write tool"
7. Client calls: "tools/call" with { name: "Write", arguments: {...} }
8. Server executes → returns result
9. Client shows result to LLM
10. Loop continues until LLM says task complete
```

### MCP Tool Schema Format

Each tool advertised as:
```json
{
  "name": "Bash",
  "description": "Execute a shell command in the terminal",
  "inputSchema": {
    "type": "object",
    "properties": {
      "command": {
        "type": "string",
        "description": "The shell command to execute"
      },
      "cwd": {
        "type": "string",
        "description": "Working directory"
      },
      "timeout": {
        "type": "integer",
        "description": "Timeout in ms",
        "default": 30000
      }
    },
    "required": ["command"]
  }
}
```

---

## 📚 Examples

See `examples/` directory for full examples.

### Example 1: Hello World ReAct

```bash
node dist/cli.js react "Print 'Hello, World!' in three languages"
```

**Expected output:**
```
🎯 Task: Print 'Hello, World!' in three languages

📍 Step 1/10
💭 Thought: I'll create a simple script that prints Hello World in English, Spanish, and French.
🔨 Action: Write({ file_path: "/tmp/hello.js", content: "console.log('Hello, World!'); console.log('¡Hola Mundo!'); console.log('Bonjour Monde!');" })
👁️  Observed: Written 94 characters to /tmp/hello.js

📍 Step 2/10
💭 Thought: Now I should run the script to verify it works.
🔨 Action: Bash({ command: "node /tmp/hello.js" })
👁️  Observed: Hello, World!
¡Hola Mundo!
Bonjour Monde!

📍 Step 3/10
💭 Thought: Task complete — the script prints in 3 languages as requested.

✅ Task Complete!
Final answer: Created and verified a JavaScript file that prints "Hello, World!" in English, Spanish ("¡Hola Mundo!"), and French ("Bonjour Monde!").
```

### Example 2: File System Exploration

```bash
node dist/cli.js react "Find all TypeScript files in src/ that contain the word 'React'"
```

**What happens:**
1. **Reason:** "Need to search for files with 'React'"
2. **Act:** `Glob({ pattern: "src/**/*.ts" })` → gets list of files
3. **Observe:** 47 files found
4. **Reason:** "Now grep each for 'React'"
5. **Act:** `Grep({ pattern: "React", type: "files_with_matches" })`
6. **Observe:** 12 files contain "React"
7. **Act:** `Read({ file_path: "src/components/Button.tsx" })` (example)
8. **Observe:** File contents shown
9. **Done:** Returns list of matching files with brief context

### Example 3: Image Generation

```bash
node dist/cli.js react "Generate an image of a sunset over mountains and save it"
```

**Steps:**
1. LLM decides: "I'll use generateImage"
2. Calls: `generateImage({ prompt: "sunset over mountains", model: "flux" })`
3. Pollinations API returns base64 image + URL
4. LLM: "Now save to file"
5. Calls: `Write({ file_path: "./sunset.png", content: "<base64 data>" })`
6. Done

**Result:** Image file saved locally.

### Example 4: Crew of Agents

```typescript
// file: crew-demo.ts
import { CrewCoordinator, AgentRole } from './src/agents/crew.js';
import { pollinationsClient } from './src/pollinations/client.js';

const crew = new CrewCoordinator(pollinationsClient);

const task = `
  Build a CLI todo app with these features:
  - Add/remove tasks
  - Mark complete
  - Save to JSON file
  - List all tasks
`;

const result = await crew.orchestrateComplexTask(task);
console.log(result);
```

**What the crew does:**
1. **Orchestrator** (main LLM) breaks task into subtasks:
   - "Initialize Node.js project" → **Coder**
   - "Implement task data model" → **Coder**
   - "Write CLI interface" → **Coder**
   - "Add persistence layer" → **Coder**
   - "Write tests" → **Tester**

2. Each agent executes via ReAct loop
3. Results collected
4. Orchestrator synthesizes final answer

---

## 🐛 Troubleshooting

### "POLLINATIONS_API_KEY is required"

**Fix:** Set environment variable
```bash
# Bash/Zsh
export POLLINATIONS_API_KEY=pk_your_key

# Fish
set -x POLLINATIONS_API_KEY pk_your_key

# PowerShell
$env:POLLINATIONS_API_KEY="pk_your_key"

# Windows CMD
set POLLINATIONS_API_KEY=pk_your_key
```

**Permanent:** Add to shell profile (`.bashrc`, `.zshrc`, PowerShell profile) or create `.env` file in project root.

---

### "Cannot find module '@modelcontextprotocol/sdk'"

**Fix:** Dependencies not installed
```bash
npm install
```

If still failing, delete `node_modules` and lockfile, reinstall:
```bash
rm -rf node_modules package-lock.json
npm install
```

---

### "Error: Pollinations API error 401"

**Fix:** Invalid or missing API key
1. Verify key is set: `echo $POLLINATIONS_API_KEY`
2. Check key format: should start with `pk_` or `sk_`
3. If using `sk_` (secret), ensure you're on server-side
4. Get new key from https://enter.pollinations.ai
5. For client-side (MCP), **use `pk_` key only** (publishable, rate-limited)

---

### "Tool execution failed: ENOENT: no such file or directory"

**Cause:** File path doesn't exist or permission denied

**Fix:**
```bash
# 1. Use absolute paths
Read({ file_path: "/absolute/path/to/file.ts" })

# 2. Check file exists
node dist/cli.js react "Check if README.md exists: ls -la"

# 3. Permissions
# Windows: Run as Administrator if accessing protected dirs
# Linux/Mac: chmod +r file, or use sudo (not recommended for production)
```

**Best practice:** Work in project subdirectory, not system directories.

---

### "MCP server disconnects immediately"

**Cause:** Stdio transport issues, or process crashes

**Debug:**
```bash
# Run with debug logging
DEBUG=true node dist/cli.js mcp

# Should see:
# 🚀 barok v0.0.1-experimental starting...
# ✅ MCP server ready
# (then hangs, waiting for input)

# If it exits with error, check:
# 1. POLLINATIONS_API_KEY set? (not required for MCP start, needed for tool calls)
# 2. Dependencies installed: ls node_modules/@modelcontextprotocol
# 3. Build completed: ls dist/cli.js
```

**Claude Desktop logs:**
- Mac: `~/Library/Logs/Claude/`
- Windows: `%APPDATA%\Claude\logs\`
- Linux: `~/.config/Claude/logs/`

---

### "maxSteps exceeded" error

**Cause:** ReAct loop reached iteration limit without LLM signaling completion

**Fix:**
1. Increase max steps: `node dist/cli.js react "task" --max-steps 20`
2. Simplify task (break into smaller subtasks)
3. Check if LLM is stuck in loop (verbose mode shows step-by-step)
4. Add `REACT_VERBOSE=true` to see what's happening

---

### "Validation error" from tool

**Cause:** Tool arguments don't match schema

**Example:**
```
Validation error: [{"code":"invalid_type","expected":"number","received":"string","path":["timeout"],"message":"Expected number, received string"}]
```

**Fix:** Pass correct types
```typescript
// ❌ Wrong
Bash("ls")  // command should be { command: "ls" }

// ✅ Correct
Bash({ command: "ls" })
```

---

### "zod: SyntaxError: Unexpected token" in Windows

**Cause:** Windows path separators (`\` vs `/`)

**Fix:** The codebase uses `path.resolve()` which handles cross-platform. If you see path errors:
1. Update to latest Node.js (20+ handles paths better)
2. Use forward slashes: `C:/Projects/...` not `C:\Projects\...`
3. Set `cwd` parameter explicitly in Bash calls

---

### Build fails with "Cannot find module 'fs/promises'"

**Cause:** Node.js version too old (fs/promises added in v14)

**Fix:** Upgrade Node.js to ≥ 18
```bash
node --version  # must be 18+
# If not:
# Download from nodejs.org or use nvm:
nvm install 20
nvm use 20
```

---

### "Error: Invalid model name: claude"

**Cause:** Pollinations doesn't have that model, or API key invalid

**Fix:**
```bash
# Check available models
node dist/cli.js test
# Outputs: Available image models: flux, turbo, gptimage...
#         Available text models: openai, claude, deepseek...

# Use correct model name
node dist/cli.js react "task" --model openai
# or
node dist/cli.js react "task" --model claude
```

**Available model names** (from Pollinations registry):
- **Text:** `openai`, `claude`, `deepseek`, `gemini`, `mistral`, `qwen-coder`
- **Image:** `flux`, `turbo`, `gptimage`, `kontext`, `seedream`
- **Audio voices:** `nova`, `alloy`, `echo`, `fable`, etc.

---

## 🔧 Advanced

### Custom Tool Development

**Add a new tool in 3 steps:**

1. **Define schema** (`src/types/schemas.ts`):
```typescript
export const MyToolSchema = defineSchema({
  name: 'MyTool',
  fields: {
    param1: field({ type: 'string', required: true }),
    param2: field({ type: 'integer', default: 42 }),
  },
});
```

2. **Implement handler** (`src/tools/devTools.ts`):
```typescript
export async function myTool(params: { param1: string; param2: number }): Promise<ToolResult> {
  // Your logic
  return { success: true, output: `Done: ${params.param1}` };
}
```

3. **Register** (add to `DEV_TOOLS` constant):
```typescript
MyTool: {
  name: 'MyTool',
  description: 'Does something useful',
  inputSchema: MyToolSchema.export(),
  handler: (params) => myTool(params as any),
},
```

**Tool automatically available in:**
- MCP (advertised to clients)
- ReAct loop (LLM can call it)
- CrewAI agents (assign to specific roles)

---

### Changing the LLM Backend

Currently uses Pollinations AI (multi-model). Switch to different provider:

**Option A: Use OpenAI directly**
```typescript
// src/pollinations/client.ts
import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export class PollinationsClient {
  async chatCompletion(params) {
    const res = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: params.messages,
      tools: params.tools,
    });
    return { content: res.choices[0].message.content };
  }
}
```

**Option B: Anthropic SDK**
```typescript
import { Anthropic } from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async chatCompletion(params) {
  const res = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4096,
    messages: params.messages,
    tools: params.tools,
  });
  // Handle tool use blocks...
}
```

---

### Dockerizing

Create `Dockerfile`:
```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist
COPY .env .

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["mcp"]
```

Build & run:
```bash
docker build -t barok .
docker run -it --rm \
  -e POLLINATIONS_API_KEY=pk_your_key \
  barok mcp
```

For development with hot reload:
```bash
docker run -it --rm \
  -v $(pwd):/app \
  -w /app \
  node:20-alpine \
  sh -c "npm install && npm run dev"
```

---

### Performance Tuning

**Speed up ReAct loops:**
1. Lower `maxSteps` (default 10 → 5)
2. Use faster model: `--model openai-fast` or `deepseek`
3. Disable verbose: `--verbose false`
4. Cache tool results (not yet implemented)

**Reduce API costs:**
- Use `pk_` keys (rate-limited, not billable)
- Set `maxSteps=5` to limit LLM calls
- Use cheaper models: `deepseek`, `gemini-fast`
- Each ReAct step = 1 LLM call (reason) + 1 tool call

---

### Security Hardening

**Add confirmation for destructive commands:**
```typescript
// In src/tools/devTools.ts, modify bashTool:
const DANGEROUS_COMMANDS = ['rm -rf', 'mkfs', 'dd', '>', '2>/dev/null'];

export async function bashTool(params) {
  if (DANGEROUS_COMMANDS.some(cmd => params.command.includes(cmd))) {
    console.error(`⚠️  DANGEROUS COMMAND: ${params.command}`);
    console.error('Add --force to bypass (NOT RECOMMENDED)');
    return { success: false, error: 'Command blocked by safety guard' };
  }
  // ... execute
}
```

**File operation allowlist:**
```typescript
const ALLOWED_PATHS = [
  '/Users/you/projects/',
  '/tmp/',
];

function isPathAllowed(path: string): boolean {
  return ALLOWED_PATHS.some(allowed => path.startsWith(allowed));
}
```

**Rate limiting:**
```typescript
const calls = new Map<string, number[]>();

function isRateLimited(toolName: string): boolean {
  const now = Date.now();
  const history = calls.get(toolName) || [];
  const recent = history.filter(t => now - t < 60000); // last minute
  if (recent.length >= 10) return true;
  recent.push(now);
  calls.set(toolName, recent);
  return false;
}
```

---

## 📊 Monitoring & Debugging

**Enable debug logs:**
```bash
DEBUG=true node dist/cli.js react "task"
# Shows: tool calls, LLM prompts, responses, timing

# MCP debug
node dist/cli.js mcp --debug 2>&1 | tee mcp.log
```

**Profile performance:**
```typescript
// In src/react/engine.ts, add timing:
console.time('reason');
await this.reason(state);
console.timeEnd('reason');  // Shows how long LLM takes

console.time('act');
await this.executeAction(action);
console.timeEnd('act');  // Shows tool execution time
```

**Log to file:**
```bash
node dist/cli.js react "task" 2>&1 | tee session.log
```

---

## 🧪 Testing

**Quick connectivity test:**
```bash
node dist/cli.js test
# Tests: API connectivity, model listing, balance check (if sk_ key)
```

**Run schema validation tests:**
```typescript
// test/validation.test.ts
import { validateToolCall } from '../src/validation/validators.js';

const result = validateToolCall('Bash', { command: 'ls' });
console.assert(result.isValid === true);

const invalid = validateToolCall('Bash', { cmd: 'oops' });
console.assert(invalid.isValid === false);
```

**MCP protocol test (requires MCP client):**
```typescript
// test/mcp.test.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client(...);
await client.connect(new StdioClientTransport({
  command: 'node',
  args: ['dist/cli.js', 'mcp'],
}));
const tools = await client.listTools();
console.log('Tools advertised:', tools.tools.length);
```

---

## 🎯 Use Cases

**This system excels at:**

1. **Automated code generation** — Full files from natural language
2. **Codebase exploration** — Find, read, analyze, modify
3. **Multi-step workflows** — Break complex tasks into subtasks
4. **Research + implementation** — Researcher + Coder agents
5. **Image generation integrated** — Create assets while coding
6. **Script automation** — Shell commands orchestrated by LLM

**Not suitable for:**
- Production without sandboxing (full shell access = risk)
- Long-running daemons (ReAct has step limits)
- Real-time interaction (latency of LLM + tools)
- High-volume API calls (rate limits)

---

## 📞 Getting Help

**Check logs first:** Most errors are in console output with stack traces.

**Common issues:**
- API key missing → Set `.env`
- Build not run → `npm run build`
- Wrong Node version → Upgrade to 18+
- Permission errors → Run in user-writable directory

**Debug mode:**
```bash
DEBUG=true REACT_VERBOSE=true node dist/cli.js react "task" 2>&1 | less
```

**Still stuck?** File an issue with:
1. OS + Node version
2. Full error message
3. What command you ran
4. `.env` contents (redact API key)

---

## 🗺️ Architecture Reference

For understanding how it all connects:

```
┌─────────────┐
│   Claude    │  ← You use this (Desktop/Cursor)
│   Desktop   │     with MCP
└──────┬──────┘
       │ MCP (JSON-RPC over stdio)
       ▼
┌─────────────────────┐
│  Raw ReAct MCP      │  ← This server
│  (node dist/cli.js) │
│                     │
│  ┌────────────────┐ │
│  │   MCP Layer    │ │  Tools advertised:
│  │ - listTools    │ │  Bash, Read, Write, Edit,
│  │ - callTool     │ │  Glob, Grep, generateImage,
│  └────────────────┘ │  generateText, chatCompletion
│         │            │
│         ▼            │
│  ┌────────────────┐ │
│  │ Tool Router    │ │  Routes to:
│  │ - Pollinations │ │    → PollinationsClient (API)
│  │ - DevTools     │ │    → DevTools (local fs/shell)
│  │ - TaskManager  │ │    → In-memory task store
│  └────────────────┘ │
└─────────────────────┘
```

---

**That's everything.** You now have:
- ✅ Installation guide
- ✅ Configuration options
- ✅ All 4 running modes
- ✅ MCP integration steps
- ✅ Examples
- ✅ Troubleshooting
- ✅ Advanced customization
- ✅ Architecture overview

**Time to run:**
```bash
cd <path-to-barok>
npm install
npm run build
npm run dev
```
