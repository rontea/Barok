# API Response Formats Reference

## 1. Pollinations API Client Responses

**File:** [src/pollinations/client.ts](src/pollinations/client.ts)

### `generateImage()` Response
```typescript
Promise<{
  url: string;           // Full URL to generated image (https://gen.pollinations.ai/image/...)
  data?: string;         // Base64 encoded image with MIME type prefix (data:image/png;base64,...)
  format: string;        // Image format extracted from Content-Type (e.g., 'png', 'jpg')
}>
```

**Parameters:**
```typescript
{
  prompt: string;              // Required: Image description
  model?: string;              // Default: 'flux' (flux, turbo, gptimage, kontext, seedream, etc.)
  width?: number;              // Default: 1024
  height?: number;             // Default: 1024
  seed?: number;               // Optional: reproducible results
  enhance?: boolean;           // Default: true
  negative_prompt?: string;    // What to avoid
  quality?: string;            // low, medium, high, hd
}
```

**Example Response:**
```json
{
  "url": "https://gen.pollinations.ai/image/a%20beautiful%20sunset?model=flux&width=1024&height=1024&enhance=true",
  "data": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "format": "png"
}
```

### `generateText()` Response
```typescript
Promise<{
  text: string;              // Generated text output
  model: string;             // Model that was used
  usage: {
    tokens: number;          // Total tokens used
  }
}>
```

**Parameters:**
```typescript
{
  prompt: string;            // Required: Text prompt
  model?: string;            // Default: 'openai' (openai, claude, deepseek, gemini, mistral, etc.)
  temperature?: number;      // Default: 0.7 (0.0-2.0)
  max_tokens?: number;       // Default: 1024 (1-32768)
}
```

**Example Response:**
```json
{
  "text": "This is the generated text response from the model...",
  "model": "openai",
  "usage": {
    "tokens": 245
  }
}
```

### `chatCompletion()` Response
```typescript
Promise<{
  content: string;           // Main text response
  tool_calls?: Array<{
    name: string;            // Tool/function name
    arguments: Record<string, unknown>;  // Tool arguments
  }>
}>
```

**Parameters:**
```typescript
{
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;                        // Required: Conversation history
  model?: string;            // Default: 'openai'
  tools?: unknown[];         // Optional: Available tools/functions
}
```

**Routing:**
- Anonymous requests to text endpoints → `https://text.pollinations.ai/openai`
- Authenticated requests → `https://gen.pollinations.ai` (with Bearer token)

**Example Response:**
```json
{
  "content": "I will help you with that task...",
  "tool_calls": [
    {
      "name": "Bash",
      "arguments": {
        "command": "ls -la"
      }
    }
  ]
}
```

---

## 2. Gemini API Integration

**File:** [src/react/engine.ts](src/react/engine.ts) (lines 364-530)

### Gemini API Initialization
```typescript
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,  // Standard AIzaSy... or auth AQ... key
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build'
    }
  }
});
```

### `generateContent()` Response
```typescript
const response = await ai.models.generateContent({
  model: string;              // 'gemini-3.5-flash', 'gemini-2.5-flash', etc.
  contents: string;           // Text prompt
  config?: {
    systemInstruction?: string;
  }
});

// Response structure:
{
  text?: string;              // Generated text (access via response.text)
  // ... other response properties
}
```

**Supported Native Gemini Models:**
- `gemini-3.5-flash` - Recommended fallback (high rate limits)
- `gemini-3.1-flash-lite` - Secondary fallback
- `gemini-2.5-flash` - Legacy fallback
- `gemini-2.5-pro` - High-performance model
- `gemini-2.0-flash` - Alternative option
- `gemini-3.1-flash-lite` - Lightweight option

**Example Response:**
```typescript
{
  text: "Here's the response from Gemini model..."
}
```

### Error Handling
The engine handles these error types:
- **Permanent Quota Errors:** "exceeded your current quota", "billing details", "resource_exhausted"
- **Retryable Errors:** 429 (rate limit), 503 (unavailable), 500 (server error)
- **Auto-routing:** Seamlessly rotates between available models when one is rate-limited

### Fallback Chain
1. Primary: Model from config (Pollinations or Gemini)
2. If Pollinations fails (402/rate limit) → `gemini-3.5-flash`
3. If gemini-3.5-flash fails → `gemini-3.1-flash-lite`
4. If gemini-3.1-flash-lite fails → `gemini-2.5-flash`
5. Final fallback: Unauthenticated Pollinations public pool

---

## 3. NVIDIA NIM API Integration

**Files:**
- [src/di/providers/llmProvider.ts](src/di/providers/llmProvider.ts)
- [src/config/nvidiaModels.ts](src/config/nvidiaModels.ts)
- [ui/src/modelOptions.ts](ui/src/modelOptions.ts)

### Configuration
```bash
NVIDIA_API_KEY=<nvidia-api-key>
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
```

### Model Metadata
Every NVIDIA model option stores its exact model id and API family. Do not infer routing from display names.

```typescript
{
  provider: 'nvidia',
  modelId: 'qwen/qwen3-coder-480b-a35b-instruct',
  apiFamily: 'chat-completions',
  endpoint: '/chat/completions',
  supportsStreaming: true,
  supportsTools: true,
  inputModalities: ['text'],
  outputModalities: ['text'],
  defaultParams: {
    temperature: 0.2,
    maxTokens: 4096,
    topP: 0.95
  }
}
```

### Chat Completions Request
```typescript
await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${NVIDIA_API_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  },
  body: JSON.stringify({
    model: 'qwen/qwen3-coder-480b-a35b-instruct',
    messages: [
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Write a TypeScript helper.' }
    ],
    temperature: 0.2,
    max_tokens: 4096,
    top_p: 0.95,
    stream: false
  })
});
```

### Chat Completions Response
```json
{
  "choices": [
    {
      "message": {
        "content": "Generated response text..."
      }
    }
  ]
}
```

### Responses API Metadata
`openai/gpt-oss-120b` is registered as a Responses-family NVIDIA model, but the current provider does not send it through chat completion code.

```typescript
{
  model: 'openai/gpt-oss-120b',
  apiFamily: 'responses',
  endpoint: '/responses'
}
```

### Embeddings API Metadata
`baai/bge-m3` is registered as an embeddings-family NVIDIA model, but it is intentionally hidden from the chat picker.

```typescript
{
  model: 'baai/bge-m3',
  apiFamily: 'embeddings',
  endpoint: '/embeddings'
}
```

### Registered NVIDIA Models
- `nvidia/nemotron-3-ultra-550b-a55b` - chat completions, UI-selectable.
- `nvidia/nemotron-3-super-120b-a12b` - chat completions, UI-selectable.
- `qwen/qwen3-coder-480b-a35b-instruct` - chat completions, UI-selectable.
- `minimaxai/minimax-m3` - chat completions, UI-selectable.
- `z-ai/glm-5.2` - chat completions, UI-selectable.
- `deepseek-ai/deepseek-v4-flash` - chat completions with tool calling, UI-selectable; 1M-token context.
- `stepfun-ai/step-3.7-flash` - multimodal chat completions with tool calling, UI-selectable; 262K context.
- `google/gemma-4-31b-it` - multimodal chat completions with tool calling, UI-selectable; 262K context.
- `google/diffusiongemma-26b-a4b-it` - separate multimodal diffusion chat model with tool calling, UI-selectable; 262K context.
- `moonshotai/kimi-k2.6` - multimodal chat completions with tool calling, UI-selectable; 262K context.
- `openai/gpt-oss-120b` - Responses API metadata only; not routed through chat completions.
- `baai/bge-m3` - embeddings metadata only; not routed through chat completions.

### Custom NVIDIA Model Targets
The API Pool UI can save custom NVIDIA model targets without code changes. Saved targets are persisted in SQLite app settings and appear in the UI Model Target list.

```json
{
  "id": "glm-workhorse",
  "title": "GLM Workhorse",
  "modelId": "z-ai/glm-5.2",
  "apiKeyIndex": 1,
  "apiFamily": "chat-completions",
  "endpoint": "/chat/completions",
  "temperature": 0.2,
  "maxTokens": 4096,
  "topP": 0.95
}
```

The selectable model value becomes `nvidia-target:glm-workhorse`; the NVIDIA provider resolves that target at runtime and sends the real `modelId`.

### Routing Rules
- NVIDIA model ids are sent to the NVIDIA provider first.
- NVIDIA target values such as `nvidia-target:glm-workhorse` are resolved to saved target metadata before the request is sent.
- NVIDIA chat fallback keeps NVIDIA model ids intact while rotating between registered chat models.
- Cross-provider fallback normalizes NVIDIA requests to provider-safe defaults, such as `openai-fast` for Pollinations or `gemini-3.5-flash` for Gemini.
- Non-chat NVIDIA API families fail fast in chat code so embeddings, rerank, Responses, audio, and async NVCF models cannot be sent to `/chat/completions`.

---

## 4. MCP Tool Response Formats

**File:** [src/mcp/server.ts](src/mcp/server.ts)

### MCP `CallToolResult` Response
```typescript
type CallToolResult = {
  content: Array<{
    type: 'text';              // Always 'text' for content type
    text: string;              // Response text/JSON
  }>;
  isError?: boolean;           // Optional: marks if response is an error
}
```

### Pollinations Tool Responses

#### generateImage Response (MCP wrapper)
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"success\": true, \"url\": \"https://gen.pollinations.ai/image/...\", \"data\": \"data:image/png;base64,...[truncated]...\"}"
    }
  ]
}
```

#### generateText Response (MCP wrapper)
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"text\": \"Generated response\", \"model\": \"openai\", \"usage\": {\"tokens\": 245}}"
    }
  ]
}
```

#### chatCompletion Response (MCP wrapper)
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"content\": \"Response text\", \"tool_calls\": [{\"name\": \"Bash\", \"arguments\": {...}}]}"
    }
  ]
}
```

### Dev Tools Response Format

**File:** [src/tools/devTools.ts](src/tools/devTools.ts)

#### `ToolResult` Structure
```typescript
interface ToolResult {
  success: boolean;           // Whether tool execution succeeded
  output?: string;            // Tool output text
  error?: string;             // Error message if failed
  truncated?: boolean;        // Whether output was truncated
}
```

#### Dev Tool Examples:

**Bash Tool Response:**
```json
{
  "success": true,
  "output": "file1.txt\nfile2.txt\n",
  "truncated": false
}
```

**Read Tool Response:**
```json
{
  "success": true,
  "output": "file contents here...",
  "truncated": false
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "File not found: /path/to/file.txt",
  "truncated": false
}
```

#### Dev Tool Definitions
```typescript
interface ToolDefinition {
  name: DevTool;
  description: string;
  inputSchema: Record<string, unknown>;  // JSON Schema format
  handler: (params: Record<string, unknown>) => Promise<ToolResult>;
}
```

Available dev tools:
- `Bash` - Execute shell commands
- `Read` - Read file contents
- `Write` - Write to files
- `Edit` - String replacement in files
- `Glob` - File pattern matching
- `Grep` - Text search in files

---

## 5. Agent Execution Results

**Files:**
- [src/react/engine.ts](src/react/engine.ts) (ReActEngine)
- [src/agents/crew.ts](src/agents/crew.ts) (CrewCoordinator)

### ReAct Engine Result - `ReactResult`
```typescript
interface ReactResult {
  success: boolean;           // Whether task succeeded
  finalAnswer?: string;       // Task completion response (if successful)
  steps: any[];               // Array of ReactStep objects
  stepCount: number;          // Number of steps executed
  pollenCost?: number;        // Estimated Pollen tokens spent
  error?: string;             // Error message (if failed)
}
```

### Individual Step - `ReactStep`
```typescript
interface ReactStep {
  thought: string;            // Reasoning about what to do
  action: string;             // Tool/action to execute (e.g., "Read", "Bash")
  action_input: Record<string, unknown>;  // Parameters for the action
  observation?: string;       // Result of executing the action
  is_done?: boolean;          // Whether this was the final step
  final_answer?: string;      // Final synthesized answer (on final step)
  pollenCost?: number;        // Cost of this specific step
}
```

**Example ReactResult (Success):**
```json
{
  "success": true,
  "finalAnswer": "The task has been completed successfully. Here's what was done:\n1. Read the file...\n2. Modified the content...\n3. Wrote changes back...",
  "steps": [
    {
      "thought": "I need to understand the current structure of the project",
      "action": "Read",
      "action_input": { "file_path": "/path/to/file.ts" },
      "observation": "File contains 250 lines of TypeScript code",
      "is_done": false,
      "pollenCost": 0.0015
    },
    {
      "thought": "Now I'll modify the file as requested",
      "action": "Edit",
      "action_input": { "file_path": "/path/to/file.ts", "old_string": "...", "new_string": "..." },
      "observation": "Successfully edited the file",
      "is_done": true,
      "final_answer": "Changes applied successfully",
      "pollenCost": 0.0012
    }
  ],
  "stepCount": 2,
  "pollenCost": 0.0027,
  "error": null
}
```

**Example ReactResult (Failed):**
```json
{
  "success": false,
  "finalAnswer": null,
  "steps": [],
  "stepCount": 0,
  "pollenCost": 0.0045,
  "error": "Budget exceeded: spent 100.5 pollen, limit 100"
}
```

### Crew Coordinator Task Execution
```typescript
class CrewCoordinator {
  async executeTask(taskId: string): Promise<string | null>;
}

// Returns:
// - Task result string (from agent execution)
// - null if task not found
// - Error message prefixed with "Failed:" if execution failed
```

**Task Structure:**
```typescript
interface Task {
  id: string;                           // Unique task ID (task_1, task_2, etc.)
  description: string;                  // Task description
  assignedTo?: AgentRole;               // Assigned agent role
  fallbackTo?: AgentRole;               // Fallback agent if primary fails
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string | null;               // Task result
}
```

---

## 6. Run Logging & Analytics

**File:** [src/react/logger.ts](src/react/logger.ts)

### `ReactRunReport` - Saved to Logs
```typescript
interface ReactRunReport {
  id: string;                 // Unique run ID (6-char uppercase, e.g., "AB3XY2")
  task: string;               // Original task description
  model: string;              // Model used (openai-fast, claude, gemini-3.5-flash, etc.)
  timestamp: string;          // ISO timestamp of run
  success: boolean;           // Whether execution succeeded
  stepCount: number;          // Number of steps taken
  totalPollenCost: number;    // Total pollen spent
  budget: number;             // Budget limit (or Infinity)
  finalAnswer?: string;       // Final synthesized answer (if successful)
  error?: string;             // Error message (if failed)
  steps: LoggedStep[];        // Formatted steps array
}

interface LoggedStep {
  step: number;               // Step number (1-indexed)
  thought: string;            // Reasoning
  action: string;             // Action taken
  actionInput: any;           // Action parameters
  observation?: string;       // Action result
  pollenCost?: number;        // Step cost
}
```

**Example Report:**
```json
{
  "id": "A7K9M2",
  "task": "Create a TypeScript utility function for parsing dates",
  "model": "openai-fast",
  "timestamp": "2024-06-18T14:22:45.123Z",
  "success": true,
  "stepCount": 3,
  "totalPollenCost": 0.0042,
  "budget": 1,
  "finalAnswer": "Created a robust date parsing utility at src/utils/dateParser.ts",
  "steps": [
    {
      "step": 1,
      "thought": "I need to analyze the project structure first",
      "action": "Glob",
      "actionInput": { "pattern": "src/**/*.ts" },
      "observation": "Found 45 TypeScript files",
      "pollenCost": 0.0012
    }
  ]
}
```

**Logging Locations:**
- Individual run: `logs/run_${runId}.json` (detailed JSON)
- Audit list: `logs/react_runs_audit.json` (last 100 runs)
- Human-readable: `logs/run_${runId}_report.md` (markdown format)

---

## API Response Chain Example

Here's a complete flow showing how responses flow through the system:

```
User Task
  ↓
ReActEngine.run(task)
  ├→ Reason: LLM via Pollinations → generateText()
  │  ├ Response: {text, model, usage}
  │  └ Extract: thought
  │
  ├→ Plan Action: LLM via chatCompletion()
  │  ├ Response: {content, tool_calls?}
  │  └ Parse: action, action_input
  │
  ├→ Execute Action: Tool Handler
  │  ├ Dev Tool: ToolResult {success, output, error}
  │  └ Or Pollinations API: {url, data} / {text, usage} / {content, tool_calls}
  │
  ├→ Observe & Decide: LLM again
  │  └ Response: is_done (boolean)
  │
  └→ Final Result: ReactResult
     {
       success: boolean,
       finalAnswer?: string,
       steps: ReactStep[],
       stepCount: number,
       pollenCost?: number,
       error?: string
     }

Logged to: ReactRunReport → logs/run_${id}.json
```

---

## Performance Metrics

**Pollen Cost Estimation (per step):**
- Model pricing varies: `1e-8` to `0.00001` per token
- Estimated per-step tokens: ~3,100 prompt + 300 completion
- Multiplied by 3 calls per step (reason → plan → execute)
- Example: openai-fast ≈ 0.0005 pollen per step

**Token Usage:**
- Tracked in each API response's `usage` field
- Summed across all calls for total run cost
- Used to enforce budget constraints

**Rate Limiting:**
- Gemini: Auto-rotates between models
- Pollinations: Retries with exponential backoff
- Both: Parse retry-after headers from responses

