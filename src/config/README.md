# Centralized Configuration System

A comprehensive, type-safe configuration management system for react-engine-077 that centralizes all configuration concerns (environment, runtime, models, tools, and workspace) in one place.

## Overview

The configuration system provides:

- ✅ **Type-safe** configuration access with TypeScript interfaces
- ✅ **Centralized** management of all config types
- ✅ **Validation** with detailed error reporting
- ✅ **Environment variable** integration
- ✅ **Sensible defaults** for all settings
- ✅ **Easy overrides** and updates
- ✅ **Model registry** with pricing information
- ✅ **Path security** validation
- ✅ **Tool management** with per-tool configuration

## Architecture

```
src/config/
├── types.ts              # Configuration type definitions
├── baseManager.ts        # Base class for all config managers
├── envConfig.ts          # Environment configuration manager
├── runtimeConfig.ts      # Runtime configuration manager
├── modelConfig.ts        # Model registry and pricing
├── toolConfig.ts         # Tool settings and timeouts
├── workspaceConfig.ts    # Workspace paths and security
├── configService.ts      # Central coordination service
├── utils.ts              # Utility functions
├── index.ts              # Public exports
└── examples.ts           # Usage examples
```

## Configuration Types

### 1. Environment Configuration (`EnvConfig`)

Manages environment variables and credentials.

```typescript
interface EnvConfig {
  // API Keys
  pollinationsApiKey: string;        // Required: Pollinations API key
  geminiApiKey?: string;              // Optional: Google Gemini API key

  // Logging
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  debugMode: boolean;
  verbose: boolean;

  // MCP Server
  mcpServerName: string;
  mcpVersion: string;
  mcpPort?: number;

  // Feature flags
  enableParallelTasks: boolean;
  enableLogging: boolean;
}
```

**Environment Variables:**
- `POLLINATIONS_API_KEY` - API key (required)
- `GEMINI_API_KEY` - Optional Gemini key
- `LOG_LEVEL` - Logging level
- `DEBUG` - Debug mode flag
- `REACT_VERBOSE` - Verbose output
- `MCP_SERVER_NAME` - MCP server name
- `MCP_VERSION` - MCP server version
- `MCP_PORT` - Optional MCP port
- `PARALLEL_TASKS` - Enable parallel task execution
- `ENABLE_LOGGING` - Enable logging

### 2. Runtime Configuration (`RuntimeConfig`)

Manages application behavior and performance settings.

```typescript
interface RuntimeConfig {
  // Agent settings
  maxSteps: number;                   // Max ReAct loop iterations (1-1000)
  defaultModel: string;               // Default LLM model
  budget: number;                     // Cost budget in pollen units

  // Timeouts (milliseconds)
  requestTimeout: number;
  defaultToolTimeout: number;

  // Crew agent settings
  crewAgentCount: number;
  crewEnableParallel: boolean;

  // Retry settings
  maxRetries: number;
  retryBackoffMs: number;
  retryMultiplier: number;

  // Workspace
  workspaceRoot: string;
}
```

**Environment Variables:**
- `MAX_STEPS` - Max ReAct steps (default: 10)
- Model selection is persisted in Settings > API Pool; it is not read from `.env`.
- `BUDGET` - Cost budget
- `REQUEST_TIMEOUT` - Request timeout ms
- `TOOL_TIMEOUT_DEFAULT` - Tool timeout ms
- `CREW_AGENTS` - Crew agent count (default: 4)
- `CREW_PARALLEL` - Enable crew parallelization
- `MAX_RETRIES` - Max retry attempts
- `RETRY_BACKOFF_MS` - Retry backoff ms
- `RETRY_MULTIPLIER` - Retry multiplier
- `WORKSPACE_ROOT` - Workspace root path

### 3. Model Configuration (`ModelConfig`)

Manages model registry, pricing, and capabilities.

```typescript
interface ModelConfig {
  models: Map<string, ModelDefinition>;
  defaultTextModel: string;
  defaultImageModel: string;
  geminiBaseUrl: string;
  pollinationsBaseUrl: string;
}

interface ModelDefinition {
  name: string;
  provider: 'gemini' | 'pollinations' | 'anthropic' | 'openai';
  type: 'text' | 'image' | 'multimodal';
  pricing: {
    promptTokens: number;      // $ per 1K tokens
    completionTokens: number;  // $ per 1K tokens
  };
  maxTokens: number;
  contextWindow: number;
  supportsVision: boolean;
  supportsToolUse: boolean;
  supportsFunctionCalling: boolean;
  isActive: boolean;
  description?: string;
}
```

**Built-in Models:**
- `gemini-1.5-pro` - Google Gemini 1.5 Pro (multimodal, 1M context)
- `gemini-1.5-flash` - Google Gemini 1.5 Flash (fast, economical)
- `claude-3.5-sonnet` - Anthropic Claude 3.5 Sonnet
- `flux` - Pollinations Flux (image generation)
- `qwen` - Pollinations Qwen (text)
- `qwen-coder` - Pollinations Qwen Coder (optimized for code)
- `openai-gpt-4` - OpenAI GPT-4 (not configured by default)

### 4. Tool Configuration (`ToolConfig`)

Manages tool settings, timeouts, and capabilities.

```typescript
interface ToolConfig {
  // Tool timeouts (milliseconds)
  timeouts: {
    default: number;         // 30 seconds
    bash: number;            // 30 seconds
    fileOperations: number;  // 15 seconds
    globPatterns: number;    // 10 seconds
    grep: number;            // 30 seconds
    subAgent: number;        // 2 minutes
  };

  // Execution settings
  maxBufferSize: number;
  maxConcurrentTools: number;

  // Tool enable/disable
  enabledTools: Set<string>;

  // Tool-specific settings
  bashMaxLines: number;
  fileOpsSizeLimit: number;
}
```

**Environment Variables:**
- `TOOL_TIMEOUT_DEFAULT` - Default timeout
- `TOOL_TIMEOUT_BASH` - Bash timeout
- `TOOL_TIMEOUT_FILEOPS` - File operations timeout
- `TOOL_TIMEOUT_GLOB` - Glob pattern timeout
- `TOOL_TIMEOUT_GREP` - Grep timeout
- `TOOL_TIMEOUT_SUBAGENT` - SubAgent timeout

### 5. Workspace Configuration (`WorkspaceConfig`)

Manages workspace paths and security settings.

```typescript
interface WorkspaceConfig {
  // Paths
  rootPath: string;
  logsPath: string;
  cachePath: string;
  tempPath: string;

  // Properties
  name: string;
  description: string;

  // Security
  allowedPaths: string[];
  blockedPaths: string[];
  enforcePathValidation: boolean;

  // Performance
  maxFileSize: number;
  indexingEnabled: boolean;
}
```

## Usage

### Basic Usage

```typescript
import { getConfigService, config } from '@config';

// Get the global config service
const configService = getConfigService();

// Access configuration sections
const env = configService.getEnvConfig().getConfig();
const runtime = configService.getRuntimeConfig().getConfig();
const models = configService.getModelConfig().getConfig();
const tools = configService.getToolConfig().getConfig();
const workspace = configService.getWorkspaceConfig().getConfig();

// Use convenience getters
console.log(config.env().logLevel);
console.log(config.runtime().maxSteps);
console.log(config.getTimeout('bash'));
console.log(config.isPathAllowed('/tmp/file.txt'));
```

### Working with Environment Configuration

```typescript
import { getConfigService } from '@config';

const envConfig = getConfigService().getEnvConfig();

// Check API keys
if (envConfig.hasApiKey('pollinations')) {
  const key = envConfig.getApiKey('pollinations');
  // Use key
}

// Reload from environment
envConfig.reload();

// Validate
const errors = envConfig.validate();
```

### Working with Runtime Configuration

```typescript
import { getConfigService } from '@config';

const runtimeConfig = getConfigService().getRuntimeConfig();

// Get values
const runtime = runtimeConfig.getConfig();
console.log(runtime.maxSteps);

// Update settings
runtimeConfig.updateSettings({
  maxSteps: 20,
  defaultModel: 'gemini-1.5-pro',
  budget: 50
});

// Validate
const errors = runtimeConfig.validate();
```

### Working with Model Configuration

```typescript
import { getConfigService } from '@config';

const modelConfig = getConfigService().getModelConfig();

// Get models by type
const textModels = modelConfig.getModelsByType('text');
const imageModels = modelConfig.getModelsByType('image');
const activeModels = modelConfig.getActiveModels();

// Get models by provider
const geminiModels = modelConfig.getModelsByProvider('gemini');

// Calculate cost
const cost = modelConfig.calculateCost('gemini-1.5-pro', 1000, 500);
console.log(`Cost: $${cost.toFixed(6)}`);

// Get specific model
const model = modelConfig.getModel('claude-3.5-sonnet');
console.log(`Model: ${model.name}, Type: ${model.type}`);

// Register custom model
modelConfig.registerModel({
  name: 'custom-model',
  provider: 'anthropic',
  type: 'text',
  pricing: { promptTokens: 0.01, completionTokens: 0.02 },
  maxTokens: 4096,
  contextWindow: 100000,
  supportsVision: false,
  supportsToolUse: true,
  supportsFunctionCalling: true,
  isActive: true
});
```

### Working with Tool Configuration

```typescript
import { getConfigService } from '@config';

const toolConfig = getConfigService().getToolConfig();

// Get timeout for tool
const bashTimeout = toolConfig.getTimeout('bash');

// Update timeout
toolConfig.setTimeout('bash', 60000);

// Check if tool is enabled
if (toolConfig.isToolEnabled('bash')) {
  // Use bash tool
}

// Get all enabled tools
const enabledTools = toolConfig.getEnabledTools();

// Enable/disable tools
toolConfig.disableTool('grep');
toolConfig.enableTool('bash');
```

### Working with Workspace Configuration

```typescript
import { getConfigService } from '@config';

const workspaceConfig = getConfigService().getWorkspaceConfig();

// Get paths
const rootPath = workspaceConfig.getConfig().rootPath;
const logsPath = workspaceConfig.getLogsPath();
const cachePath = workspaceConfig.getCachePath();

// Full path resolution
const fullPath = workspaceConfig.getFullPath('src/config');

// Path security checks
const isAllowed = workspaceConfig.isPathAllowed('/etc/passwd');
if (isAllowed) {
  // Access file
}

// Add/remove allowed paths
workspaceConfig.addAllowedPath('/tmp/myapp');
workspaceConfig.removeAllowedPath('/tmp/oldapp');
```

### Validation

```typescript
import { getConfigService, loadAndValidateConfig } from '@config';

const service = getConfigService();

// Validate all sections
const allErrors = service.validateAll();

// Validate specific section
const envErrors = service.validateSection('env');

// Check if valid
if (service.isValid()) {
  console.log('✅ Configuration is valid');
} else {
  console.log('❌ Configuration has errors');
}

// Load and validate (strict mode exits on errors)
loadAndValidateConfig(true);  // strict
loadAndValidateConfig(false); // non-strict
```

### Configuration Report

```typescript
import { printConfigReport, getConfigSummary } from '@config';

// Print formatted report
printConfigReport(false); // false = exclude sensitive data

// Get summary as JSON string
const summary = getConfigSummary();
console.log(summary);

// Export config object
const configService = getConfigService();
const exported = configService.export(false);
```

### Initialization with Overrides

```typescript
import { initializeConfigService } from '@config';

const service = initializeConfigService(
  {
    // Runtime overrides
    maxSteps: 15,
    defaultModel: 'gemini-1.5-pro',
    budget: 100
  },
  '/path/to/workspace',
  {
    // Workspace overrides
    name: 'my-workspace',
    description: 'My custom workspace'
  }
);
```

## Validation

All configuration sections are validated with comprehensive error checking:

### Environment Config Validates:
- ✅ API keys are set
- ✅ Log level is valid
- ✅ MCP port is in valid range (1024-65535)

### Runtime Config Validates:
- ✅ maxSteps is 1-1000
- ✅ Timeouts are positive and reasonable
- ✅ Crew agent count is 1-16
- ✅ Retry settings are valid
- ✅ Retry multiplier is 1.1-5

### Model Config Validates:
- ✅ Default text model exists
- ✅ Default image model exists
- ✅ At least one active text model
- ✅ At least one active image model

### Tool Config Validates:
- ✅ All timeouts are 100ms - 1 hour
- ✅ Buffer size is 1KB - 1GB
- ✅ Concurrent tools is 1-32
- ✅ At least one tool is enabled

### Workspace Config Validates:
- ✅ Root path is absolute
- ✅ At least one allowed path
- ✅ File size limit is 1KB - 1GB

## Default Values

### Environment Defaults
```
POLLINATIONS_API_KEY: (from env or .env)
GEMINI_API_KEY: (optional, from env)
LOG_LEVEL: 'info'
DEBUG: false
VERBOSE: false
MCP_SERVER_NAME: 'raw-react-mcp'
MCP_VERSION: '1.0.0'
ENABLE_LOGGING: true
```

### Runtime Defaults
```
MAX_STEPS: 10
MODEL_SELECTION: persisted in Settings > API Pool
BUDGET: Infinity
REQUEST_TIMEOUT: 300000ms (5 minutes)
TOOL_TIMEOUT: 30000ms (30 seconds)
CREW_AGENTS: 4
MAX_RETRIES: 3
RETRY_BACKOFF: 1000ms
RETRY_MULTIPLIER: 2
```

### Tool Timeouts
```
Default: 30000ms
Bash: 30000ms
File Operations: 15000ms
Glob Patterns: 10000ms
Grep: 30000ms
SubAgent: 120000ms (2 minutes)
```

## Integration with Existing Code

The configuration system is designed to be gradually integrated into existing code:

1. **Immediate benefits**: Use configuration system for new features
2. **Migration path**: Gradually refactor existing code to use centralized config
3. **Backward compatible**: Config values can be passed to existing functions

### Example Migration

Before:
```typescript
const maxSteps = 10; // hardcoded
const model = 'claude'; // hardcoded
const timeout = 30000; // hardcoded
```

After:
```typescript
import { config } from '@config';

const maxSteps = config.runtime().maxSteps;
const model = config.runtime().defaultModel;
const timeout = config.getTimeout('bash');
```

## Error Handling

Configuration validation errors include:

```typescript
interface ConfigValidationError {
  section: 'env' | 'runtime' | 'models' | 'tools' | 'workspace';
  field: string;
  value: unknown;
  error: string;
}
```

Example:
```typescript
{
  section: 'env',
  field: 'pollinationsApiKey',
  value: '',
  error: 'POLLINATIONS_API_KEY is required but not set'
}
```

## Security Considerations

1. **API Keys**: Never logged or exported unless explicitly requested
2. **Path Validation**: Workspace config prevents directory traversal attacks
3. **Type Safety**: Full TypeScript support prevents config misuse
4. **Validation**: All configs validated before use
5. **Isolation**: Each config type is isolated in its own manager

## Performance

- ✅ Lazy loading of configs
- ✅ Minimal overhead
- ✅ Efficient path validation
- ✅ In-memory model registry with fast lookups
- ✅ No file I/O unless explicitly saving

## File Size Impact

```
types.ts:           ~2KB
baseManager.ts:     ~4KB
envConfig.ts:       ~3KB
runtimeConfig.ts:   ~4KB
modelConfig.ts:     ~8KB
toolConfig.ts:      ~5KB
workspaceConfig.ts: ~6KB
configService.ts:   ~7KB
utils.ts:           ~6KB
index.ts:           ~1KB
──────────────────────
Total:             ~46KB
```

## Future Enhancements

Potential future additions:

- [ ] Configuration persistence to JSON/YAML files
- [ ] Configuration hot-reloading
- [ ] Configuration profiles (dev, staging, prod)
- [ ] Configuration inheritance and composition
- [ ] Configuration audit logging
- [ ] Web-based configuration UI
- [ ] Configuration schema export
- [ ] Configuration migration tools
