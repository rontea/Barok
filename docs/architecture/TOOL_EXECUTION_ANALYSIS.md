# Tool Execution Analysis: Current Implementation Patterns

## Executive Summary
The project has a multi-layered tool execution system with subprocess handling in `devTools.ts`, tool invocation through MCP in `server.ts`, and reasoning loop execution in `engine.ts`. Timeout handling exists at the subprocess level but lacks comprehensive timeout mechanisms for glob/grep operations and tool orchestration.

---

## 1. WHERE TOOLS ARE EXECUTED & CALLED

### Primary Execution Locations

#### A. [src/tools/devTools.ts](src/tools/devTools.ts#L1) - Tool Implementations
- **File**: Contains all tool handler functions (bash, read, write, edit, glob, grep, tasks, sub-agents)
- **Registry**: `DEV_TOOLS` object maps tool names to their definitions
- **Export**: `getAllToolDefinitions()` returns array of `ToolDefinition` objects
- **Entry Point**: Each tool has a handler function that takes params and returns `Promise<ToolResult>`

```typescript
export interface ToolDefinition {
  name: DevTool;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<ToolResult>;
}
```

#### B. [src/mcp/server.ts](src/mcp/server.ts#L1) - Tool Invocation (MCP)
- **Invocation Method**: `CallToolRequestSchema` handler
- **Flow**: Polls `getAllToolDefinitions()` to find matching tool by name
- **Execution**: Calls `toolDef.handler(args as Record<string, unknown>)`
- **Response Format**: Wraps result in MCP `CallToolResult` with validation
- **Error Handling**: Basic try-catch, logs validation failures when debug=true

#### C. [src/react/engine.ts](src/react/engine.ts#L1) - ReAct Loop Execution
- **Invocation Method**: `executeAction()` private method (lines ~900)
- **Flow**: 
  1. LLM reasons about task
  2. LLM plans action and selects tool
  3. `executeAction()` calls tool handler
  4. Result becomes observation for next step
- **Loop Context**: 
  - Max steps limit (default 10)
  - Budget tracking (pollen cost)
  - Step-by-step state management

---

## 2. SUBPROCESS EXECUTION & TOOL TYPES

### Tools Running Subprocesses

#### A. **Bash Tool** - [src/tools/devTools.ts L220-250](src/tools/devTools.ts#L220)
```typescript
export async function bashTool(params: BashParams): Promise<ToolResult> {
  const workingDir = params.cwd ? resolvePath(params.cwd) : getWorkspace();
  const timeoutMs = params.timeout || 30000;  // 30 second default

  const result = await util.promisify(exec)(params.command, {
    cwd: workingDir,
    timeout: timeoutMs,        // TIMEOUT SET HERE
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    env: { ...process.env, TERM: 'xterm-256color' },
  });

  return { success: true, output: result.stdout || result.stderr };
}
```
- **Process Type**: Child process via Node.js `child_process.exec`
- **Timeout**: 30 seconds (user-configurable via params)
- **Buffer**: 10MB max output
- **Environment**: Uses process.env + safe TERM setting
- **Error Handling**: Catches errors, returns error message

**Subprocess Flow:**
```
bashTool(params)
  ↓
exec(command, { cwd, timeout, maxBuffer })
  ↓
  Promise<ExecException | ExecFileException>
  ↓
  Try-catch with error extraction
```

#### B. **Glob Tool** - [src/tools/devTools.ts L260-280](src/tools/devTools.ts#L260)
```typescript
export async function globTool(params: GlobParams): Promise<ToolResult> {
  const { glob } = await import('glob');
  const globAsync = promisify(glob);
  
  const files = await globAsync(params.pattern, {
    nodir: true,
    absolute: true,
    cwd: getWorkspace(),
  });
  
  return { success: true, output: files.join('\n') };
}
```
- **Process Type**: Node.js `glob` library (file system scanning)
- **Timeout**: **NONE** - No timeout mechanism
- **Risk**: Can hang on large file systems or circular symlinks (disabled but still risky)
- **Error Handling**: Basic try-catch

#### C. **Grep Tool** - [src/tools/devTools.ts L282-380](src/tools/devTools.ts#L282)
```typescript
export async function grepTool(params: GrepParams): Promise<ToolResult> {
  const files = await glob(globPattern, {
    nodir: true,
    absolute: true,
    follow: false,  // Symlinks disabled
  });
  
  for (const file of files) {
    // Regex matching on file contents
    const content = await fs.readFile(file, 'utf-8');
    // Line-by-line matching...
  }
  
  return { success: true, output, truncated };
}
```
- **Process Type**: File I/O + regex matching
- **Timeout**: **NONE** - No timeout mechanism
- **Risk**: Can hang on:
  - Large glob patterns
  - Large files (fs.readFile)
  - Expensive regex operations
- **Safety**: Try-catch blocks skip unreadable files

#### D. **Other File Tools** - Read/Write/Edit
```typescript
// No subprocesses, direct fs.promises operations
readFileTool(params)    → fs.readFile()
writeFileTool(params)   → fs.mkdir() + fs.writeFile()
editFileTool(params)    → fs.readFile() + fs.writeFile()
```
- **Process Type**: Node.js fs operations
- **Timeout**: None (but fast on local systems)
- **Risk**: Low - blocked only by disk I/O

#### E. **Task Tools** - Create/List/Update
```typescript
taskCreateTool()   → In-memory Map operation
taskListTool()     → In-memory iteration
taskUpdateTool()   → In-memory Map update
```
- **Process Type**: Memory operations (no subprocesses)
- **Timeout**: None needed

#### F. **SubAgent Tool** - [src/tools/devTools.ts L440-460](src/tools/devTools.ts#L440)
```typescript
export async function subAgentTool(params: SubAgentParams): Promise<ToolResult> {
  const { CrewCoordinator } = await import('../agents/crew.js');
  const coordinator = new CrewCoordinator(pollinationsClient);
  
  const taskId = await coordinator.createTask(params.task, assignedTo, fallbackTo);
  const result = await coordinator.executeTask(taskId);
  
  return { success: true, output: result };
}
```
- **Process Type**: Sub-agent execution (nested LLM calls)
- **Timeout**: **NONE** - Inherits parent engine timeout behavior
- **Risk**: Can stack timeouts (parent + sub-agent limits)

---

## 3. CURRENT TIMEOUT/CANCELLATION HANDLING

### Timeout Mechanisms in Place

#### A. Bash Tool Timeout (30 seconds)
- **Location**: [src/tools/devTools.ts L232](src/tools/devTools.ts#L232)
- **Default**: 30 seconds
- **Override**: Via `params.timeout`
- **Error Type**: `TimeoutError` from Node.js (caught in catch block)
- **Response**: Returns error result

#### B. ReAct Loop Budget Check
- **Location**: [src/react/engine.ts L320-340](src/react/engine.ts#L320)
- **Mechanism**: Cost tracking (pollen-based, not time-based)
- **Trigger**: If `state.total_pollen_cost > state.budget`
- **Action**: Exits loop and returns failure result
- **Note**: Time-based, not instruction-based

#### C. ReAct Loop Max Steps
- **Location**: [src/react/engine.ts L290](src/react/engine.ts#L290)
- **Default**: 10 steps
- **Override**: Via `config.maxSteps`
- **Trigger**: `state.current_step < state.max_steps`
- **Action**: Exits loop after max steps

### **GAPS in Timeout/Cancellation**

| Component | Current | Missing |
|-----------|---------|---------|
| Bash | ✅ 30s timeout | User-configurable ✓, but global default |
| Glob | ❌ No timeout | No mechanism |
| Grep | ❌ No timeout | No mechanism |
| File I/O | ❌ No timeout | No mechanism |
| Glob regex | ❌ No timeout | No mechanism |
| Sub-agent | ❌ No timeout | No global timeout |
| Tool orchestration | ❌ No timeout | No per-step timeout |
| Cancellation | ❌ Not supported | No AbortController |

---

## 4. ERROR HANDLING FOR HUNG PROCESSES

### Error Handling Patterns

#### A. Subprocess Error Handling (Bash)
```typescript
catch (error: unknown) {
  if (error instanceof Error) {
    return {
      success: false,
      error: error.message,
      output: (error as any).stdout || '',
    };
  }
  return {
    success: false,
    error: 'Command execution failed',
  };
}
```
- **Catches**: 
  - TimeoutError (from exec timeout)
  - ExecException (non-zero exit code)
  - General Error
- **No Retry**: Subprocess errors are final
- **Propagates**: Error message to next step

#### B. File Operation Error Handling
```typescript
catch (error: unknown) {
  if (error instanceof PathValidationError) {
    return {
      success: false,
      error: `Security: Path access denied - ${error.reason}`,
    };
  }
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
  };
}
```
- **Catches**: PathValidationError (security), general Error
- **Security Focus**: Validates before execution
- **No Recovery**: Fails fast

#### C. Glob/Grep Error Handling
```typescript
catch (error) {
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Grep failed',
  };
}

// Within loop - skip unreadable files
catch (fileError) {
  continue;  // Silent skip
}
```
- **Inner Errors**: Silently skipped (per-file)
- **Outer Errors**: Returned as failure
- **No Logging**: Skipped files not reported

#### D. Tool Execution Error Handling in Engine
```typescript
private async executeAction(action: {
  action: string;
  action_input: Record<string, unknown>;
}): Promise<string> {
  const tool = getAllToolDefinitions().find(t => t.name === action.action);
  if (!tool) {
    return `Error: Unknown tool "${action.action}"`;
  }

  try {
    const result = await tool.handler(action.action_input);
    if (result.success) {
      return result.output || 'Action completed successfully (no output)';
    } else {
      return `Error: ${result.error}\n${result.output || ''}`;
    }
  } catch (error) {
    return `Exception: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}
```
- **Catches**: Unknown tool (string check), execution errors
- **No Retry**: Observes error and continues to next step
- **Observation Loop**: Error becomes input to LLM for next decision

#### E. LLM Retry Logic (in `createChatCompletion`)
```typescript
// Distinguishes between retryable and permanent errors
const isPermanentQuotaError = 
  errMsg.toLowerCase().includes('exceeded your current quota') ||
  // ... other permanent error patterns

const isRetryableError = 
  errMsg.includes('429') || 
  errMsg.includes('503') ||
  // ... other retryable patterns

if (isRetryableError && attempt < maxRetries) {
  // Model rotation + exponential backoff
  let delayMs = Math.pow(2.2, attempt) * 1000 + Math.random() * 1000;
  await new Promise(resolve => setTimeout(resolve, delayMs));
}
```
- **Sophisticated Retry**: Has retryable vs permanent classification
- **Model Rotation**: Can switch models on rate limits
- **Exponential Backoff**: 2.2^n * 1000ms + jitter
- **Max Retries**: 10 retries for Gemini, 4 for Pollinations

**KEY ISSUE**: Robust LLM retry logic but **no equivalent for tool execution timeouts**

---

## 5. CONFIGURATION FOR TOOL BEHAVIOR

### Configuration Sources

#### A. Runtime Config in `ReActEngine`
```typescript
export interface ReactConfig {
  onProgress?: (message: string) => void;
  onStateUpdate?: (state: any) => void;
  maxSteps?: number;
  model?: string;
  verbose?: boolean;
  budget?: number;
  workspace?: string;
}
```
- **Default Values**: [src/react/engine.ts L150-160](src/react/engine.ts#L150)
  - `maxSteps: 10`
  - `model: 'claude'`
  - `verbose: false`
  - `budget: Infinity`
  - `workspace: process.cwd()`

#### B. Per-Tool Configuration

**BashTool**:
```typescript
interface BashParams {
  command: string;
  cwd?: string;
  timeout?: number;  // Milliseconds (default 30000)
}
```

**GlobTool**:
```typescript
interface GlobParams {
  pattern: string;  // No timeout configuration
}
```

**GrepTool**:
```typescript
interface GrepParams {
  pattern: string;
  path?: string;
  includePattern?: string;
  isRegex?: boolean;
  type?: 'content' | 'files_with_matches';
  limit?: number;  // Results limit, not timeout
}
```

#### C. Dependencies in [package.json](package.json)
```json
{
  "dependencies": {
    "glob": "^10.3.10",
    "uuid": "^11.1.0",
    "zod": "^3.24.0",
    // ... other deps
  }
}
```
- **No timeout libraries**: 
  - No `p-timeout`
  - No `node-timeout`
  - No `abort-controller`
- **Glob**: Native support but no timeout wrapper

#### D. Environment Variables
- `GEMINI_API_KEY`: For Gemini model access
- `POLLINATIONS_API_KEY`: For Pollinations auth
- `NODE_OPTIONS`: Set in test scripts (e.g., `--experimental-vm-modules`)

#### E. Tool Validation via Zod Schemas
- [src/types/schemas.ts](src/types/schemas.ts): Defines all tool parameter schemas
- **Runtime Parsing**: Each tool handler calls `.parse()` on received params
- **Validation**: Zod validates structure before execution

---

## 6. SUMMARY OF IMPLEMENTATION PATTERNS

### Execution Flow
```
User Request
    ↓
MCP Server (server.ts)
    ↓
Tool Registry (devTools.ts)
    ↓
Tool Handler → Subprocess (exec/glob/regex/fs)
    ↓
Result (success/error)
    ↓
ReAct Loop (engine.ts)
    ↓
LLM: Reason → Plan → Execute
    ↓
Observation → Repeat
```

### Error Handling Strategy
```
Tool Execution
    ↓
  Try-Catch
    ├─ Success → Return output
    ├─ Tool Error → Return error object
    └─ Exception → Return error string
    ↓
ReAct Loop
    ├─ Validates result structure
    ├─ Logs validation warnings (debug mode)
    ├─ LLM observes error or output
    └─ Continues to next step (no retry)
```

### Timeout Strategy
```
Bash Tool: 30s default (configurable)
└─ → TimeoutError caught and returned

Glob Tool: No timeout
└─ → Can hang indefinitely

Grep Tool: No timeout
└─ → Can hang on large files or expensive regex

File I/O: No timeout
└─ → Fast but unprotected

Sub-agent: No timeout
└─ → Inherits parent limits

LLM Calls: 
├─ Gemini: 10 retries + exponential backoff
├─ Pollinations: 4 retries + model rotation
└─ No hard timeout (relies on API timeout)
```

### Missing Protections
1. **No glob timeout wrapper** - Can hang on large directories
2. **No grep timeout** - Can hang on expensive regex or large files
3. **No per-step tool timeout** - Only Bash has timeout
4. **No AbortController** - Can't cancel mid-execution
5. **No timeout configuration** - Only Bash is user-configurable
6. **No resource limits** - No CPU/memory monitoring
7. **No global tool timeout** - Each tool operates independently

---

## Recommendations for Enhancement

1. **Add timeout wrapper library** (p-timeout or similar)
2. **Global tool timeout configuration** - Central config for all tools
3. **Per-tool timeout overrides** - Allow tool-specific customization
4. **AbortController integration** - Enable cancellation
5. **Timeout for glob/grep** - Wrap with timeout promise
6. **Timeout for file I/O** - Optional timeout for large files
7. **Monitoring dashboard** - Track tool execution times
8. **Graceful degradation** - Fall back to error on timeout instead of hanging
