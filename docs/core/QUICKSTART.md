# ✅ Barok — Quick Start Card

## 🎯 TL;DR

**Barok is a full-stack autonomous AI development system and agent harness** with multi-provider routing (Gemini, Pollinations, OpenRouter, Groq, local models), guarded workspace developer tools, SQLite persistence, and an interactive Web Dashboard.

**Repository Location:** `<path-to-barok>` (e.g. `C:\Projects\Barok` or `~/projects/Barok`)

---

## 🚀 Installation (2 minutes)

```bash
cd <path-to-barok>

# 1. Install Node.js 18+ first (if not installed)
# Download: https://nodejs.org

# 2. Install dependencies
npm install

# 3. Get free API key
# Visit: https://enter.pollinations.ai
# Create key → copy pk_* key

# 4. Configure
echo "POLLINATIONS_API_KEY=<pollinations-api-key>" > .env

# 5. Build
npm run build

# 6. Test
node dist/cli.js test
# Expected: ✅ Connected to Pollinations
```

---

## 🎮 Three Ways to Run

### 1. As MCP Server (Claude Desktop)
```bash
node dist/cli.js mcp
```

Add to Claude Desktop config:
```json
{
  "mcpServers": {
    "barok": {
      "command": "node",
      "args": ["<path-to-barok>/dist/cli.js", "mcp"]
    }
  }
}
```

Now Claude can: `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`,
`generateImage`, `generateText`, `chatCompletion`, `Task*`

---

### 2. Direct ReAct Loop (CLI)
```bash
# Simple
node dist/cli.js react "Create a Python script that prints fibonacci numbers"

# With options
node dist/cli.js react "Build a REST API" --model claude --max-steps 15 --verbose

# JSON output (for automation)
node dist/cli.js react "task" --output json > result.json
```

---

### 3. Multi-Agent Crew
```typescript
import { CrewCoordinator, AgentRole } from './src/agents/crew.js';
import { pollinationsClient } from './src/pollinations/client.js';

const crew = new CrewCoordinator(pollinationsClient);

// Auto-breakdown complex task
const result = await crew.orchestrateComplexTask('Build full-stack app with auth');
console.log(result);

// Or manual assignment
await crew.createTask('Write API', AgentRole.CODER);
await crew.createTask('Research OAuth', AgentRole.RESEARCHER);
await crew.runAll(parallel: false);
```

---

## 📊 Available Tools (12 total)

| Tool | Category | Purpose | Example |
|------|----------|---------|---------|
| **Bash** | Shell | Execute commands | `Bash({ command: "npm test" })` |
| **Read** | Files | Read file contents | `Read({ file_path: "src/app.ts" })` |
| **Write** | Files | Create/overwrite file | `Write({ file_path: "out.txt", content: "..." })` |
| **Edit** | Files | String replacement | `Edit({ file_path: "a.js", old_string: "x", new_string: "y" })` |
| **Glob** | Search | Find files by pattern | `Glob({ pattern: "**/*.ts" })` |
| **Grep** | Search | Regex search in files | `Grep({ pattern: "function\\s+test", type: "files_with_matches" })` |
| **TaskCreate** | Tasks | Create a task | `TaskCreate({ subject: "Fix bug", description: "..." })` |
| **TaskList** | Tasks | List all tasks | `TaskList({})` |
| **TaskUpdate** | Tasks | Update status | `TaskUpdate({ id: "1", status: "completed" })` |
| **generateImage** | AI | Generate images | `generateImage({ prompt: "sunset", model: "flux" })` |
| **generateText** | AI | Text generation | `generateText({ prompt: "Explain quantum physics" })` |
| **chatCompletion** | AI | Chat with tool calling | `chatCompletion({ messages: [...], tools: [...] })` |

---

## 🏗️ Project Structure

```
<path-to-barok>/
├── src/
│   ├── mcp/
│   │   └── server.ts          # MCP server (196 lines)
│   ├── pollinations/
│   │   └── client.ts          # Pollinations API wrapper
│   ├── tools/
│   │   └── devTools.ts        # Bash/Read/Write/Edit/Glob/Grep + TaskManager
│   ├── react/
│   │   └── engine.ts          # ReAct loop (LangGraph pattern)
│   ├── agents/
│   │   └── crew.ts            # CrewAI multi-agent
│   ├── types/
│   │   └── schemas.ts         # Zod schemas (Pydantic AI style)
│   ├── validation/
│   │   └── validators.ts      # Runtime validation
│   └── cli.ts                 # Entry point (commander)
├── examples/
│   └── runExamples.ts         # Demo scripts
├── package.json
├── tsconfig.json
├── build.js
├── .env.example
├── README.md                  # Main docs
├── RUN_GUIDE.md              # ⭐ Complete runbook (you are here)
└── CREDITS.md                # Influences & attribution

Total: ~1700 lines TypeScript
```

---

## 🔧 Key Commands

```bash
# Install
npm install

# Build (TypeScript → JavaScript bundled)
npm run build

# Start MCP server
npm run start -- mcp
# or
node dist/cli.js mcp

# Run ReAct task
npm run react -- "your task description"
# or
node dist/cli.js react "your task"

# Multi-agent crew example
node dist/examples/runExamples.js

# Test connectivity
npm test
# or
node dist/cli.js test

# Demo (no API key needed — simulates LLM)
node dist/examples/react-demo.js

# Watch mode (development)
npm run dev react -- "task"

# Lint
npm run lint
```

---

## 🆘 Common Issues

| Problem | Solution |
|---------|----------|
| `POLLINATIONS_API_KEY required` | Set `.env` file or env var |
| `Cannot find module` | Run `npm install` first |
| `401 error` | Invalid API key — get new from enter.pollinations.ai |
| `ENOENT` file not found | Use absolute paths, check permissions |
| `maxSteps exceeded` | Increase `--max-steps` or simplify task |
| MCP not connecting | Verify path to `dist/cli.js` is absolute in Claude config |
| Build fails | Node.js ≥ 18 required, delete `node_modules` + `npm install` |

See **RUN_GUIDE.md** for full troubleshooting.

---

## 🔗 Documentation Files

- **README.md** — Project overview, architecture, quick examples
- **RUN_GUIDE.md** — ⭐ Comprehensive runbook (this file's parent)
- **CREDITS.md** — Influences, attribution to claude-code-main
- **PROJECT_SUMMARY.md** — Technical deep-dive

---

## 🎓 Learning Path

**New here? Follow this order:**

1. **Read README.md** — Understand what's built
2. ** skim RUN_GUIDE.md** — See all the ways to run it
3. **Run the demo:** `node dist/examples/react-demo.js`
   - Shows ReAct loop simulation (no API key needed)
4. **Get API key** from https://enter.pollinations.ai
5. **Run test:** `node dist/cli.js test`
6. **Try simple task:** `node dist/cli.js react "list files in src/"`
7. **Add to Claude Desktop** as MCP server (if you have it)
8. **Run crew example:** `node dist/examples/runExamples.js`

---

## 🌟 Features Checklist

- [x] MCP server (stdio transport)
- [x] Pollinations AI integration (image, text, chat)
- [x] ReAct loop with visible reasoning trace
- [x] File operations (Read/Write/Edit)
- [x] Shell execution (Bash)
- [x] File search (Glob/Grep)
- [x] Task management (Create/List/Update)
- [x] Multi-agent crew (4 roles)
- [x] Schema validation (Zod)
- [x] TypeScript + full type safety
- [x] CLI with commander
- [x] Environment configuration
- [x] Build system (esbuild)
- [x] Comprehensive docs
- [x] Examples & demos
- [ ] WebFetch tool (easy to add)
- [ ] Git operations (easy to add)
- [ ] Database tools (future)
- [ ] Voice I/O (future)

---

## 💡 Example Session Transcript

```bash
$ node dist/cli.js react "Create a Node.js HTTP server"

🎯 Task: Create a Node.js HTTP server

📍 Step 1/10
💭 Thought: I'll create a basic HTTP server that listens on port 3000 and responds to GET requests.
🔨 Action: Write({ "file_path": "/tmp/server.js", "content": "const http = require('http');..." })
👁️  Observed: Written 245 characters to /tmp/server.js

📍 Step 2/10
💭 Thought: Now I'll test if the server starts correctly.
🔨 Action: Bash({ "command": "node /tmp/server.js &" })
👁️  Observed: Server started on port 3000 (PID 12345)

📍 Step 3/10
💭 Thought: Let me verify it responds by making a test request.
🔨 Action: Bash({ "command": "curl -s http://localhost:3000" })
👁️  Observed: {"status":"ok","message":"Server running"}

✅ Task Complete!
Final answer: Created Node.js HTTP server at /tmp/server.js listening on port 3000 with health endpoint. Server responds to GET requests with JSON status. Verified by curl test.

📊 Stats: 3 steps used
```

---

## 🎪 Advanced Example: Crew Building an App

```typescript
const crew = new CrewCoordinator(pollinationsClient);

const result = await crew.orchestrateComplexTask(`
  Build a Tic-Tac-Toe game:
  1. HTML page with 3x3 grid
  2. CSS for styling
  3. JavaScript game logic (win detection, turns)
  4. Reset button
  5. Deploy to GitHub Pages
`);

console.log(result);
```

**What happens:**
1. Orchestrator breaks task into 5 subtasks
2. Auto-assigns: Coder, Coder, Coder, Coder, Coder
3. Each agent runs independent ReAct loop (≈5 steps each)
4. Results collected
5. Orchestrator synthesizes final deployment instructions

**Time:** ~2-3 minutes for full game implementation.

---

## 📈 Performance

| Operation | Time | Cost (Pollinations) |
|-----------|------|-------------------|
| Single ReAct step (LLM call) | 1-3s | ~$0.001 per call |
| Simple task (3 steps) | 5-10s | ~$0.003 |
| Complex task (10 steps) | 15-30s | ~$0.01 |
| Crew of 4 agents (parallel) | 30-60s | ~$0.04 |
| MCP server startup | <1s | Free |

*Cost estimates based on Pollinations pricing (pk_* keys are rate-limited free tier)*

---

## 🎯 Next Steps

After you've run it successfully:

1. **Add WebFetch tool** (one function)
2. **Add Git tool** (Bash wrapper for git commands)
3. **Add browser automation** (Puppeteer/Playwright tool)
4. **Add database tool** (SQLite/PostgreSQL queries)
5. **Persist ReAct state** (save/load from file)
6. **Add web UI** (Express server + React frontend)
7. **Dockerize** (for deployment)
8. **Add vector DB** (for knowledge retrieval)

Each is ~50-200 LOC.

---

## 📞 Support

**Need help?**

1. Check RUN_GUIDE.md troubleshooting section
2. Verify Node.js version: `node --version` (need ≥18)
3. Ensure all deps installed: `ls node_modules/@modelcontextprotocol`
4. Test API: `node dist/cli.js test`
5. Run demo: `node dist/examples/react-demo.js`

**Found a bug?** Create issue with:
- OS: Windows/Mac/Linux
- Node version: `node -v`
- Error message (full stack trace)
- Steps to reproduce
- API key status (set? valid?)

---

**🎉 You're ready to go. Start with:**
```bash
cd <path-to-barok>
npm install
npm run build
npm run dev
```

**Next:** Open `http://localhost:3000` to access the Barok Web Dashboard, or see [RUN_GUIDE.md](./RUN_GUIDE.md) for CLI commands.
