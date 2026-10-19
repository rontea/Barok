# Barok

Barok provides a DeepSeek Harness plugin and a standalone local AI development
app. This README prioritizes the Harness plugin; standalone app details follow
in a separate section.

## Barok plugin for DeepSeek Harness

The plugin adds Barok Core utilities and coding-workflow guidance to a DeepSeek
Harness profile. It provides read-only task classification and file-path
normalization tools, and prompts Harness to apply requested code changes with
its own workspace tools. It does not start a separate agent or call a model;
Harness uses its configured model to chat and invoke tools.

| Tool | Purpose | Example |
| --- | --- | --- |
| `barok_classify_task` | Classify a coding request using Barok task policy. | `{"task":"Fix the crash when saving a file"}` |
| `barok_normalize_file_paths` | Normalize and deduplicate path candidates. | `{"paths":["src\\index.ts","src/index.ts"]}` |

### What the plugin actually does

`@barok/plugin-deepseek` exposes two functions from `@barok/core` as Harness
tools and adds one system-prompt section. When the profile starts, Harness loads
the bundle, registers the tools, and includes the coding guidance when it
assembles a request. During a chat, the configured model may ask Harness to run
a Barok tool; Harness passes the JSON result back to the model. Barok tools do
not run automatically on every message.

```text
Your request -> Harness model decides whether to call a tool
             -> Barok plugin runs the selected Core helper on its arguments
             -> JSON result returns to the model
```

#### `barok_classify_task`

Accepts one required, non-empty `task` string and returns one classification:

| Result | Meaning |
| --- | --- |
| `bug_fix` | The request appears to fix a bug or broken behavior. |
| `feature` | The request appears to add or implement a capability. |
| `refactor` | The request appears to restructure or optimize existing work. |
| `test_only` | The request appears limited to adding or improving tests. |
| `docs_only` | The request appears limited to documentation. |
| `infrastructure` | The request appears to concern configuration, setup, build, or infrastructure. |
| `generated_app` | The request appears to create a browser or web application. |
| `investigation` | No stronger category matched; investigate or explain the request. |

This is a deterministic keyword and pattern classifier, not an LLM call. It
only sees the text you pass in; it does not inspect your repository, infer
changed files, or make a work plan. If a request matches several categories,
rule order determines the single result.

Example:

```json
{"task":"Fix the crash when saving a file"}
```
Returns: `{"classification":"bug_fix"}`.

#### `barok_normalize_file_paths`

Accepts a required `paths` array of strings and returns a cleaned array. It
trims whitespace and surrounding punctuation, changes Windows backslashes to
`/`, splits some accidentally concatenated filenames at recognized extensions,
drops empty candidates, and removes duplicates while preserving first-seen
order.

```json
{"paths":["src\\index.ts","src/index.ts","index.htmlstyles.css"]}
```
Returns: `{"paths":["src/index.ts","index.html","styles.css"]}`.

It recognizes these extensions as split points: `.tsx`, `.ts`, `.jsx`, `.js`,
`.json`, `.md`, `.css`, `.html`, `.cjs`, `.mjs`, `.yml`, `.yaml`, `.xaml`, `.cs`,
`.py`, `.sh`, `.pdf`, and `.docx`. It only processes the candidate strings: it
does not check whether paths exist, resolve them against the selected workspace,
or assess whether they are safe to edit.

#### Coding workflow guidance

For implementation requests, the plugin prompts Harness to briefly inspect
relevant files and apply changes with Harness's `read`, `write`, and `edit` tools
in the same turn. It asks the model to put source in tool-call arguments, not
assistant messages, and to report a failed tool call instead of falling back to
chat code. It only reports changes after successful tool results. This guidance
does not give the Barok plugin filesystem access or override Harness or Windows
write permissions. Explanation, review, and sample-only requests remain chat-only.

#### What the plugin does not do

- It does not call DeepSeek, Qwen, or another model, and it does not need an API key.
- It does not read or write workspace files, run shell commands, edit code, run tests, or create folders.
- It does not start Barok's standalone agent, manage Harness sessions, or save data.
- It cannot guarantee that the model follows the coding guidance or calls a workspace tool. The model provider and Harness decide when tool calls happen.

Harness's own coding and workspace tools perform repository changes. The Barok
plugin contributes the two data helpers and coding guidance described above;
its package is a private local bundle installed into a Harness profile. Build
and profile setup instructions follow below.

### Build and install (Windows PowerShell)

Requirements: Node.js/npm for Barok, and a DeepSeek Harness checkout with
pnpm installed. In the commands below, replace `<path-to-barok>` and
`<path-to-deepseek-harness>` with your local paths (for example,
`C:\Projects\Barok` and `C:\Projects\deepseek-harness` on Windows, or
`~/projects/Barok` and `~/projects/deepseek-harness` on Linux/macOS).

Build Core and the plugin from the Barok repository:

```powershell
Set-Location <path-to-barok>
npm install                 # Skip if dependencies are already installed
npm run build:core
npm run build:plugin-deepseek
```

Then create a dedicated Harness home and profile, install the local plugin,
and start the profile. Keep `DSH_HOME` set in the same PowerShell window for
each Harness command:

```powershell
Set-Location <path-to-deepseek-harness>
# If this Harness checkout has not had its dependencies installed yet, run:
# pnpm install
$env:DSH_HOME = Join-Path $env:LOCALAPPDATA 'Barok\DeepSeekHarness'

# Run once to create the profile. Skip this command if it already exists.
pnpm dsh --profile barok-web-dev --from-default-profile web --dump-config

# Install the plugin from this Barok checkout.
pnpm dsh plugin --profile barok-web-dev add '<path-to-barok>\packages\plugin-deepseek'

# Start the profile.
pnpm dsh --profile barok-web-dev
```

After changing Core or plugin code, rebuild both packages and restart the
Harness profile. The package is currently private and installed from this
checkout; it is not published to npm.

### Run the plugin in Harness

The plugin runs inside the Harness profile; it is not a separate process. If
`barok-web-dev` is already created and the plugin is installed, start it with
these commands in PowerShell:

```powershell
Set-Location <path-to-deepseek-harness>
$env:DSH_HOME = Join-Path $env:LOCALAPPDATA 'Barok\DeepSeekHarness'
pnpm dsh --profile barok-web-dev
```

Harness loads the plugin bundle when this profile starts. Open the Web UI at the
address printed in the terminal, select the configured model (for the local
Qwen setup below, `qwen3.8-27b-iq3s`), and start a new chat. When using local
Qwen, start the llama.cpp server first using the example command below. See
[Use the tools](#use-the-tools) for a prompt to confirm the plugin is working.

### Configure a model and API

The plugin itself does not need an API key. Harness needs a working model
provider for chat and tool use. In the Harness Web UI, open **Settings →
Models** and save a key for a hosted provider such as DeepSeek, or add a
provider for your local model. Harness manages provider credentials separately
from the Barok plugin. For a local endpoint, use the key required by that
server, if it has authentication enabled. The [plugin guide](packages/plugin-deepseek/README.md)
has the hosted DeepSeek key steps.

For the local Qwen server used during development, add a custom provider with:

- Base URL: `http://127.0.0.1:8080/v1`
- API protocol: **OpenAI Chat Completions**
- Model ID: `qwen3.8-27b-iq3s` (use the exact ID returned by the server)

If the Qwen chat template reports `Unexpected reasoning effort high`, add the
following fields to that model/provider in
`$DSH_HOME/profiles/barok-web-dev/cordis.patch.yml`, merging them into the
existing `llm-pi-ai` entry:

```yaml
providers:
  qwen-local:
    reasoning: high
    models:
      - id: qwen3.8-27b-iq3s
        contextWindow: 32768
        reasoningEfforts:
          low: low
          medium: medium
          high: xhigh
```

This maps Harness `high` to the Qwen template's accepted `xhigh` value and
leaves out the profile per-response cap. The server's `-c 32768` still bounds
the combined prompt and generated response. Keep llama.cpp runtime flags such
as `-ngl`, `-fa`, and `-ctk` on the server launch command.

#### Troubleshooting: `Output token limit reached`

This notice means the Harness turn ended at a per-response generation cap. The
profile previously set `maxTokens: 8192`; Qwen's thinking tokens use that same
output budget, so it could reach the cap before returning its answer or a file
edit tool call.

The current profile fix removes `maxTokens` from the model entry, keeps the
32,768-token context window, and maps Harness High to the Qwen template's
accepted `xhigh` effort. The `-c 32768` setting still limits the combined
prompt and response; it does not promise 32,768 generated tokens. llama.cpp
uses `max_tokens: -1` when no request output cap is supplied, which lets it
generate until it stops or reaches its context boundary. See the [llama.cpp
server options](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).

Use `--reasoning-effort xhigh` in the llama-server command because this Qwen
template rejects the literal value `high`. Keep `--reasoning-format deepseek`;
that reports thinking separately as `reasoning_content`. Thinking by itself
does not write files: Harness must call a workspace tool to apply an edit. The
Barok plugin adds prompt guidance to do this for implementation requests, but
cannot grant filesystem access or override session permissions; its own task
and path tools remain read-only.

Example launch command for the local Qwen model (replace `<path-to-models>` with the folder where your model file is stored, e.g. `C:\LocalAI\models` or `~/models`):

```powershell
.\llama-server.exe `
    -m "<path-to-models>\Qwen3.8-27B-GSQ-RCO-IQ3_S-mtp.gguf" `
    -ngl 99 `
    -c 32768 `
    -fa on `
    -ctk q8_0 `
    -ctv q8_0 `
    -b 1024 `
    -ub 512 `
    -np 1 `
    --spec-type draft-mtp `
    --spec-draft-n-max 2 `
    --temp 1.0 `
    --top-p 0.95 `
    --top-k 20 `
    --min-p 0 `
    --jinja `
    --reasoning on `
    --reasoning-effort xhigh `
    --reasoning-format deepseek `
    --host 127.0.0.1 `
    --port 8080 `
    --alias qwen3.8-27b-iq3s
```

After changing the profile or server command, restart llama-server and the
Harness profile, then start a fresh chat so it uses the updated settings.

### Use the tools

Start a Harness chat and ask the agent to use a tool by name. For example:

> Use `barok_classify_task` to classify this request: “Add a CSV export to the reports page.”

You can also ask it to use `barok_normalize_file_paths` with file path
candidates. Both tools only process supplied text; they do not read or modify
workspace files.

See [`packages/plugin-deepseek/README.md`](packages/plugin-deepseek/README.md)
for plugin compatibility notes and additional setup details.

## Standalone Barok app

Barok is a local AI development workspace for working on software projects
with language models. Choose a project workspace, describe a task in Coder
Chat, and Barok can inspect the code, plan the work, use guarded file and
developer tools, make changes, run verification, and show the progress and
results in the dashboard.

Barok's TypeScript agent runtime uses a bounded ReAct loop: it asks a configured
model for a response or tool action, runs approved actions against the selected
workspace, and feeds the results back into the task. Runs, conversations,
checkpoints, and audit events are persisted so work can be reviewed or resumed.

The same capabilities are available through the web dashboard, command-line
interface, and Model Context Protocol (MCP) server. Barok can route requests to
configured hosted or local model providers; the model provider supplies
generation, while Barok manages workspace context, tools, execution limits,
approvals, and run history.

### What the app does

- Provides a Coder chat for questions, investigations, bug fixes, features,
  refactors, tests, documentation, and full-stack tasks.
- Runs bounded ReAct turns: reason, choose a tool, observe the result, and
  continue until the task is complete, paused, blocked, or needs input.
- Builds work plans and can request approval before execution or before risky
  workspace changes.
- Reads and edits files, searches repositories, runs commands, tracks diffs,
  and maps repository structure inside a selected workspace.
- Verifies generated work with tests, build checks, frontend/backend signals,
  and quality gates.
- Persists conversations, runs, checkpoints, artifacts, and audit data so work
  can be resumed after a pause or server restart.
- Supports specialized agent delegation for larger tasks, including coding,
  testing, reviewing, frontend, backend, data, and documentation work.
- Routes requests to configured model providers, including Pollinations and
  optional Gemini, OpenRouter, NVIDIA, Groq, Cerebras, SambaNova,
  Kimi/Moonshot, Requesty, local OpenAI-compatible, and Google Colab endpoints.
- Exposes the developer tools through the Model Context Protocol (MCP).

### How a run works

```text
User request
    -> task analysis and repository context
    -> work plan and optional approval
    -> bounded ReAct execution with workspace tools
    -> live progress and persisted checkpoints
    -> verification and quality gates
    -> final result, diff summary, or resumable state
```

The selected model remains the authoritative target for a run. Provider
retries and credential rotation may recover a request, but switching to a
different model is an explicit resume decision.

### Requirements

- Node.js 18 or newer
- npm
- A Pollinations API key for the default model route
- Optional provider credentials, depending on the routes you want to use

### Quick start

#### 1. Install dependencies

```bash
npm install
```

#### 2. Configure the environment

Copy the example configuration:

```powershell
Copy-Item .env.example .env
```

Then set at least:

```env
POLLINATIONS_API_KEY=your-pollinations-api-key
```

You can add optional provider keys and runtime settings in `.env`. The full
set of supported variables and their defaults is documented in
[`.env.example`](.env.example).

Do not commit `.env` or real API keys. The repository ignores local secrets,
logs, storage, and generated run data.

#### 3. Start the dashboard in development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The development server
runs the Express API and Vite-powered React UI together, with hot reload.

To use another port, set it in `.env`:

```env
PORT=4000
```

### Production build

Create the bundled server, CLI, MCP entry point, and production UI:

```bash
npm run build
npm start
```

The production dashboard is served at [http://localhost:3000](http://localhost:3000)
unless `PORT` is configured otherwise. Build output is written to `dist/`.

### CLI usage

Commands that use `dist/` require `npm run build` first.

Run one task through the ReAct engine:

```bash
npm run react -- "Inspect this project and explain how authentication works"
```

Run a coding task with explicit limits:

```bash
npm run react -- --max-steps 10 --budget 5 "Add tests for the user service"
```

Run a complex task through specialized agents:

```bash
npm run crew -- "Build and test a small Node.js REST API"
```

Other useful commands:

```bash
npm run setup      # Interactive setup helper
npm run doctor     # Diagnose local configuration
npm run models     # List available model routes
npm run balance    # Check the Pollinations balance
npm run demo       # Run the built-in demonstration
```

### MCP server

Start the MCP server after building:

```bash
npm run mcp
```

For an MCP client that launches the server itself, use an absolute path to the
compiled CLI. For example, a Claude Desktop configuration can contain:

```json
{
  "mcpServers": {
    "barok": {
      "command": "node",
      "args": ["C:/Projects/Barok/dist/cli.js", "mcp"],
      "env": {
        "POLLINATIONS_API_KEY": "your-pollinations-api-key"
      }
    }
  }
}
```

The MCP process uses stdout for protocol messages, so diagnostic logging is
kept separate from the JSON-RPC stream.

### Architecture

```text
┌──────────────────────────────┐
│ React dashboard (ui/)        │
│ Coder chat, plans, diffs,    │
│ verification, settings      │
└──────────────┬───────────────┘
               │ HTTP + streaming events
┌──────────────▼───────────────┐
│ Express application           │
│ server.ts                     │
│ runs, persistence, API, MCP  │
└───────┬──────────┬────────────┘
        │          │
┌───────▼──────┐ ┌─▼────────────────┐
│ Agent runtime │ │ Workspace layer  │
│ ReAct loop,   │ │ file/command     │
│ coder flow,   │ │ tools, repo map, │
│ orchestration │ │ diffs, checks    │
└───────┬──────┘ └─┬────────────────┘
        │          │
┌───────▼──────────▼───────────────┐
│ Model providers + durable state  │
│ configured routes, SQLite,       │
│ checkpoints, artifacts, audits   │
└──────────────────────────────────┘
```

Important areas of the repository:

| Path | Responsibility |
| --- | --- |
| `packages/core/` | Zero-dependency contracts, task classifiers, path normalizers, and sanitization views |
| `packages/engine/` | ReAct loop contracts, compaction, budgeting policies, and quality gates |
| `packages/adapter-node/` | Node.js filesystem, execution, and workspace capabilities |
| `packages/adapter-mcp/` | Stdio MCP tool definitions and protocol serialization |
| `packages/plugin-deepseek/` | Cordis-compatible DeepSeek Harness plugin bundle |
| `apps/mcp-server/` | Standalone decoupled stdio MCP server application |
| `server.ts` | Express server, API routes, streaming, persistence wiring, and production hosting |
| `ui/src/` | React dashboard and client-side run/thread state |
| `src/react/` | ReAct engine, checkpoints, continuation, budgets, app generation, and verification |
| `src/coder/` | Coder intent classification, task analysis, and project context |
| `src/orchestration/` | Work plans, agent routing, execution, conflict detection, and quality gates |
| `src/tools/` | Workspace tools, command execution, search, verification, and policy checks |
| `src/agents/` | Crew coordination, roles, sub-agents, and delegation |
| `src/persistence/` | Durable run, conversation, artifact, and event storage |
| `src/pollinations/` | Pollinations API client and model operations |
| `src/mcp/` | MCP server implementation |
| `src/repo/` | Repository mapping, dependency graph, work plan integration, and overwrite prevention |
| `src/config/` | Provider configuration, model targets, runtime and workspace settings |
| `tests/` and `src/**/__tests__/` | Smoke tests, evaluations, unit tests, and integration tests |
| `docs/` | Comprehensive Diátaxis documentation, C4 architecture models, and ADRs |

### Safety and workspace boundaries

This application can execute commands and modify files on behalf of an AI
agent. Use it only with workspaces and tasks you trust.

- File paths are validated against the selected workspace.
- Runs can pause for plan approval, policy approval, or user input.
- Execution has step, request, timeout, and budget limits.
- Changes and verification signals are surfaced in the dashboard.
- Local provider settings and secrets should remain server-side.
- Do not expose the local server to untrusted users without adding suitable
  authentication, authorization, and network controls.

### Testing and checks

Run the main checks with:

```bash
npm test                 # Unit tests
npm run typecheck        # TypeScript checks
npm run lint             # ESLint
npm run test:offline     # Offline smoke test
npm run test:evals:offline
npm run build:packages   # Build monorepo packages
npm run build            # Production build
```

For the full local harness verification:

```bash
npm run verify:harness
```

Live provider tests may consume API quota. The normal unit and offline suites
are designed to run without making live model requests.

### Documentation Map

The repository documentation is indexed in [`docs/README.md`](docs/README.md) and organized using the **Diátaxis Framework** (Tutorials, How-To, Reference, and Architecture Explanation):

#### 🌟 Master Specifications & ADRs
- **[System Documentation](docs/system_documentation/SYSTEM_DOCUMENTATION.md)**: Master architectural specification (monorepo packages, ReAct engine, security model, persistence, and multi-agent orchestration).
- **[Architecture Decision Records (ADRs)](docs/adr/README.md)**: Immutable record of architectural decisions, context, and trade-offs ([0001 Monorepo](docs/adr/0001-monorepo-extraction.md), [0002 SQLite Persistence](docs/adr/0002-node-sqlite-persistence.md), [0003 Version Alignment](docs/adr/0003-version-alignment-experimental.md)).
- **[C4 Architecture Models](docs/architecture/README.md)**: Visual context, containers, components, and code diagrams.

#### 🚀 Getting Started & Tutorials
- **[Documentation Hub](docs/README.md)**: Main Diátaxis navigation portal and overview.
- **[Quickstart Guide](docs/core/QUICKSTART.md)**: First-time setup, environment configuration, and verification.
- **[User Guide](docs/core/USER_GUIDE.md)**: Daily developer workflows: Coder chat, work plans, and diff review.

#### 🛠️ How-To Guides
- **[Run Guide](docs/core/RUN_GUIDE.md)**: Complete operational runbook for Web dashboard, terminal CLI, and MCP servers.
- **[Running Agent Guide](docs/core/RUNNING_AGENT_GUIDE.md)**: Operating the HTTP API, background runs, and live event streams.
- **[Multi-Key Pool Guide](docs/features/MULTI_KEY_POOL_GUIDE.md)**: Key rotation, rate-limit backoff, and fallback routing.
- **[Testing Setup](docs/features/TESTING_SETUP.md)**: Running Jest unit suites, operating gates, and Playwright UI tests.

#### 📖 Reference & Specifications
- **[Harness Compatibility](docs/compatibility/HARNESS_COMPATIBILITY.md)**: Tested runtime matrix and compatibility boundaries for DeepSeek Harness (`dsh`).
- **[API Response Formats](docs/api/API_RESPONSE_FORMATS.md)**: Standard JSON schemas for agent endpoints.
- **[Agent Roles Catalog](docs/features/AGENT_ROLES.md)**: Specialized prompt policies for Coder, Reviewer, Tester, and Documenter roles.

#### 🏛️ Architecture & Security Deep-Dives
- **[System Harness Concept](docs/core/SYSTEM_HARNESS.md)**: The agent harness paradigm, bounded ReAct turns, and safety boundaries.
- **[Filesystem Security](docs/security/FILESYSTEM_SECURITY.md)**: Path canonicalization, traversal defense, and symlink protection algorithms.
- **[Tool Timeout Protection](docs/features/TOOL_TIMEOUT_PROTECTION.md)**: Process isolation, abort signals, and hanging tool defenses.
- **[Dependency Injection](docs/architecture/DEPENDENCY_INJECTION_SUMMARY.md)**: Decoupling platform capabilities from domain contracts.

## License

This project is released under the [MIT License](https://opensource.org/license/mit/).
