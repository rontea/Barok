# Dependency Injection System

A comprehensive dependency injection (DI) framework for the ReAct Engine, enabling flexible component management, testing, and extensibility.

## Overview

The DI system provides:
- **LLM Provider Abstraction**: Swap between Gemini, Pollinations, or custom providers
- **Tool Registry**: Manage available tools with filtering and customization
- **Logger/Storage Abstraction**: Use file-based or in-memory implementations
- **Centralized Configuration**: Single point for wiring all dependencies
- **Testing Support**: Mock providers and in-memory implementations for unit tests

## Architecture

```
┌─────────────────────────────────────────┐
│     Application (CLI, Server, etc)      │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│      DI Container (getDIContainer)      │
│  - LLM Provider                         │
│  - Tool Registry                        │
│  - Execution Logger                     │
│  - Structured Logger                    │
│  - Storage                              │
└────────────────┬────────────────────────┘
                 │
      ┌──────────┼──────────┬─────────────┐
      │          │          │             │
      ▼          ▼          ▼             ▼
┌──────────┐ ┌────────┐ ┌──────────┐ ┌─────────┐
│ Pollinations
│ Provider │ │ Gemini │ │Tool Reg  │ │ Logger  │
└──────────┘ └────────┘ └──────────┘ └─────────┘
```

## Core Interfaces

### LLMProvider
```typescript
interface LLMProvider {
  createChatCompletion(messages, model, options?): Promise<string>;
  estimateStepCost(model): number;
  getProviderName(): string;
  isAvailable(): boolean;
}
```

### ToolRegistry
```typescript
interface ToolRegistry {
  getAll(): ToolDefinition[];
  get(name: string): ToolDefinition | undefined;
  getEnabled(): ToolDefinition[];
  has(name: string): boolean;
  register(tool: ToolDefinition): void;
  setEnabled(name: string, enabled: boolean): void;
  getNames(): string[];
  size(): number;
}
```

### ExecutionLogger
```typescript
interface ExecutionLogger {
  recordRun(report: RunReport): Promise<void>;
  getRecentRuns(limit?: number): Promise<RunReport[]>;
  getRun(id: string): Promise<RunReport | null>;
  clear?(): Promise<void>;
}
```

### StructuredLogger
```typescript
interface StructuredLogger {
  startRequest(id: string, task: string): void;
  endStep(id, step, action, result, reasoning): void;
  endRequest(id, result, error?, metadata?): void;
  flush(): Promise<void>;
  log(level, message, meta?): void;
}
```

### Storage
```typescript
interface Storage {
  save(key: string, data: unknown): Promise<void>;
  load(key: string): Promise<unknown | null>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  keys(): Promise<string[]>;
  clear?(): Promise<void>;
}
```

## Quick Start

### Basic Setup

```typescript
import { initializeDIContainer, di } from '@di';
import { ReActEngine } from '@react/engine';

// Initialize with defaults
initializeDIContainer();

// Access services via di convenience object
const llmProvider = di.llm();
const toolRegistry = di.tools();

// Create engine with injected dependencies
const engine = new ReActEngine({
  maxSteps: 10,
  model: 'qwen-coder',
});

// Engine automatically uses injected DI services
```

### Custom Configuration

```typescript
import {
  initializeDIContainer,
  PollinationsLLMProvider,
  GeminiLLMProvider,
  CompositeLLMProvider,
} from '@di';

const pollinationsProvider = new PollinationsLLMProvider(
  process.env.POLLINATIONS_API_KEY
);
const geminiProvider = new GeminiLLMProvider(
  process.env.GEMINI_API_KEY
);

// Create composite provider with fallback chain
const compositeProvider = new CompositeLLMProvider([
  pollinationsProvider,
  geminiProvider,
]);

const container = initializeDIContainer({
  llmProviders: [compositeProvider],
  debug: true,
});
```

## Providers

### LLM Providers

#### PollinationsLLMProvider
Wraps the Pollinations API client
```typescript
const provider = new PollinationsLLMProvider(apiKey);
const response = await provider.createChatCompletion(messages, 'qwen-coder');
```

#### GeminiLLMProvider
Wraps Google Gemini API
```typescript
const provider = new GeminiLLMProvider(apiKey);
const response = await provider.createChatCompletion(messages, 'gemini-1.5-pro');
```

#### CompositeLLMProvider
Tries multiple providers with fallback chain
```typescript
const composite = new CompositeLLMProvider([primary, fallback1, fallback2]);
// Automatically tries providers in order
```

#### MockLLMProvider
For testing without API calls
```typescript
const mock = new MockLLMProvider('Mock response');
mock.setResponse('model-1', 'Specific response for model-1');
```

### Tool Registry Implementations

#### DefaultToolRegistry
Uses all available tools
```typescript
const registry = new DefaultToolRegistry();
```

#### FilteredToolRegistry
Restricts access to specific tools
```typescript
const baseRegistry = new DefaultToolRegistry();
const filtered = new FilteredToolRegistry(
  baseRegistry,
  ['Read', 'Write', 'Bash'],  // allowlist
  []                           // denylist
);
```

#### MockToolRegistry
For testing
```typescript
const mockRegistry = new MockToolRegistry();
mockRegistry.addTool('TestTool', async (params) => 'Mock result');
```

### Logger Implementations

#### FileExecutionLogger
Stores runs as JSON files (production)
```typescript
const logger = new FileExecutionLogger('logs');
```

#### InMemoryExecutionLogger
Stores in memory (testing)
```typescript
const logger = new InMemoryExecutionLogger();
```

#### ConsoleStructuredLogger
Logs to console
```typescript
const logger = new ConsoleStructuredLogger(debug = false);
```

### Storage Implementations

#### FileStorage
File-based JSON storage (production)
```typescript
const storage = new FileStorage('.cache');
```

#### InMemoryStorage
In-memory storage (testing)
```typescript
const storage = new InMemoryStorage();
```

## Usage Examples

### Example 1: Production Setup
```typescript
import { initializeDIContainer } from '@di';
import { ReActEngine } from '@react/engine';

// Initialize with environment variables
const container = initializeDIContainer({
  apiKeys: {
    pollinations: process.env.POLLINATIONS_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
  },
});

const engine = new ReActEngine({
  maxSteps: 20,
  model: 'qwen-coder',
  budget: 5000,
});

await engine.run('Analyze data and generate report');
```

### Example 2: Testing Setup
```typescript
import {
  resetDIContainer,
  initializeDIContainer,
  MockLLMProvider,
  InMemoryExecutionLogger,
} from '@di';

// Reset for clean test state
resetDIContainer();

// Initialize with test doubles
const container = initializeDIContainer({
  llmProviders: [new MockLLMProvider('Test result')],
  executionLogger: new InMemoryExecutionLogger(),
});

const engine = new ReActEngine({
  maxSteps: 3,
});

await engine.run('Test task');
```

### Example 3: Restricted Tools
```typescript
import {
  initializeDIContainer,
  DefaultToolRegistry,
  FilteredToolRegistry,
} from '@di';

const baseRegistry = new DefaultToolRegistry();

// Only allow Read and Write, deny Bash for security
const restrictedRegistry = new FilteredToolRegistry(
  baseRegistry,
  ['Read', 'Write'],
  ['Bash', 'Glob']
);

const container = initializeDIContainer({
  toolRegistry: restrictedRegistry,
});

// Engine can only use Read and Write
```

### Example 4: Custom Service Registration
```typescript
import { getDIContainer } from '@di';

const container = getDIContainer();

interface Cache {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

const cache: Cache = {
  get: (key) => cachedData.get(key),
  set: (key, value) => cachedData.set(key, value),
};

container.register<Cache>('cache', () => cache);

// Later: retrieve custom service
const retrieved = container.get<Cache>('cache');
```

## Integration with ReActEngine

The ReActEngine automatically uses injected dependencies:

```typescript
const engine = new ReActEngine({
  // Optional: provide specific dependencies
  llmProvider: customProvider,
  toolRegistry: customRegistry,
  
  // Other config
  maxSteps: 10,
  model: 'qwen-coder',
});

// If dependencies aren't provided, they're fetched from DI container
// If DI container isn't initialized, defaults are used (fallback to pollinationsClient)
```

## Entry Point Integration

### CLI
```typescript
// src/cli.ts
import { initializeDIContainer } from '@di';

// At startup
initializeDIContainer({
  apiKeys: {
    pollinations: process.env.POLLINATIONS_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
  },
  debug: process.env.DEBUG === 'true',
});

// Create engine (uses DI automatically)
const engine = new ReActEngine({ maxSteps, model, budget });
```

### Server
```typescript
// server.ts
import { initializeDIContainer } from '@di';

// At startup
const container = initializeDIContainer({
  apiKeys: { /* ... */ },
});

// Per-request
app.post('/chat', async (req, res) => {
  const engine = new ReActEngine(req.body.config);
  const result = await engine.run(req.body.task);
  res.json(result);
});
```

## Testing

### Unit Testing with Mocks
```typescript
import { resetDIContainer, initializeDIContainer, MockLLMProvider } from '@di';

describe('ReActEngine', () => {
  beforeEach(() => {
    resetDIContainer();
  });

  it('should use mocked LLM provider', async () => {
    const mock = new MockLLMProvider('{"thought": "test"}');
    initializeDIContainer({ llmProviders: [mock] });

    const engine = new ReActEngine();
    const result = await engine.run('test');
    
    expect(result.success).toBe(true);
  });
});
```

### Integration Testing
```typescript
describe('Integration', () => {
  it('should work with real providers', async () => {
    initializeDIContainer({
      apiKeys: {
        pollinations: 'test-key',
        gemini: 'test-key',
      },
    });

    const engine = new ReActEngine();
    // Test with real providers
  });
});
```

## Best Practices

1. **Initialize Once at Startup**
   ```typescript
   // app initialization
   initializeDIContainer(config);
   ```

2. **Use DI Convenience Object**
   ```typescript
   import { di } from '@di';
   const provider = di.llm();
   ```

3. **Reset Between Tests**
   ```typescript
   afterEach(() => resetDIContainer());
   ```

4. **Provide Type-Safe Custom Services**
   ```typescript
   interface MyService { /* ... */ }
   container.register<MyService>('myService', () => instance);
   const service = container.get<MyService>('myService');
   ```

5. **Use Filtered Registry for Security**
   ```typescript
   const restricted = new FilteredToolRegistry(base, allowlist, denylist);
   ```

6. **Composite Providers for Reliability**
   ```typescript
   const reliable = new CompositeLLMProvider([primary, fallback1, fallback2]);
   ```

## Migration Path

### Before (Direct Instantiation)
```typescript
import { pollinationsClient } from '@pollinations/client';
import { getAllToolDefinitions } from '@tools/devTools';

const engine = new ReActEngine({ maxSteps: 10 });
// Tightly coupled to pollinationsClient and getAllToolDefinitions()
```

### After (With DI)
```typescript
import { initializeDIContainer } from '@di';

initializeDIContainer();
const engine = new ReActEngine({ maxSteps: 10 });
// Loosely coupled, testable, configurable
```

## File Structure

```
src/di/
├── types.ts              # All interfaces and types
├── container.ts          # DI container implementation
├── providers/
│   ├── llmProvider.ts    # LLM provider implementations
│   ├── toolRegistry.ts   # Tool registry implementations
│   └── logger.ts         # Logger and storage implementations
├── examples.ts           # Comprehensive usage examples
├── index.ts              # Public API exports
└── README.md            # This file
```

## Performance Considerations

- **Lazy Loading**: Services are created on-demand
- **Singleton Pattern**: Global container ensures single instance per app
- **In-Memory Providers**: Testing implementations are fast and don't I/O
- **Composite Fallback**: Efficient retry chain management

## Future Enhancements

- [ ] Configuration profiles (dev, staging, prod)
- [ ] Dynamic provider switching at runtime
- [ ] Plugin system for custom providers
- [ ] Metrics and observability integration
- [ ] Configuration persistence to file
- [ ] Configuration validation schema

## Support

See [examples.ts](./examples.ts) for 10 complete, runnable examples covering all use cases.
