# Sub-Agent Architecture - Quick Reference

## Core Sub-Agents

| Agent | Type | Best For | Keywords |
|-------|------|----------|----------|
| **CodeAgent** | 🔧 Development | Code generation, refactoring, debugging | code, write, implement, refactor, debug, fix |
| **ResearchAgent** | 🔍 Analysis | Research, analysis, summarization | research, analyze, find, gather, summarize |
| **ToolAgent** | ⚙️ System | File ops, shell commands, MCP tools | file, directory, bash, command, shell, execute |
| **ReviewerAgent** | ✅ QA | Validation, auditing, quality checks | review, validate, check, audit, verify, test |

## Usage Patterns

### Pattern 1: Direct Agent Usage

```typescript
import { CodeAgent } from './src/agents/crew.js';

const agent = new CodeAgent({ verbose: true });

// Specialized methods
await agent.generateCode('Write a REST API endpoint');
await agent.refactor(code, 'Improve performance');
await agent.debug(code, 'Function returns undefined');

// Generic execution
await agent.execute('Write a validation function');
```

### Pattern 2: Sub-Agent Pool

```typescript
import { createSubAgentPool } from './src/agents/crew.js';

const pool = createSubAgentPool();

// Get specific agent
const codeAgent = pool.getCodeAgent();

// Execute with agent type
await pool.executeWithAgent('code', 'Generate schema.ts');
await pool.executeWithAgent('research', 'Analyze requirements');

// Parallel execution
await pool.executeParallel([
  { type: 'code', task: 'Generate API routes' },
  { type: 'research', task: 'Research best practices' },
]);
```

### Pattern 3: Crew Coordinator

```typescript
import { CrewCoordinator } from './src/agents/crew.js';

const crew = new CrewCoordinator(pollinationsClient);

// Direct sub-agent execution
const result = await crew.executeWithSubAgent(
  'code',
  'Refactor this legacy function'
);

// Parallel sub-agent tasks
const results = await crew.executeSubAgentTasks([
  { type: 'code', task: 'Generate models' },
  { type: 'research', task: 'Research patterns' },
  { type: 'reviewer', task: 'Create checklist' },
]);

// Get sub-agent pool
const pool = crew.getSubAgentPool();
```

### Pattern 4: Orchestrator Integration

```typescript
const crew = new CrewCoordinator(pollinationsClient);

// Automatic sub-agent routing
const result = await crew.orchestrateWithPrimaryOrchestrator(
  'Build a complete API with tests'
);

// Tasks automatically routed to appropriate sub-agents
// - Code tasks → CodeAgent
// - Research tasks → ResearchAgent
// - File ops → ToolAgent
// - Validation → ReviewerAgent
```

## Common Tasks by Sub-Agent

### CodeAgent Tasks
- ✅ "Generate a TypeScript interface"
- ✅ "Refactor this function for readability"
- ✅ "Debug: Function throws TypeError"
- ✅ "Implement error handling"
- ✅ "Convert JavaScript to TypeScript"

### ResearchAgent Tasks
- ✅ "Summarize this documentation"
- ✅ "Research Node.js performance tips"
- ✅ "Analyze this codebase for patterns"
- ✅ "Find all security vulnerabilities"
- ✅ "Create a report on dependencies"

### ToolAgent Tasks
- ✅ "Create project directory structure"
- ✅ "Run tests and report results"
- ✅ "Find all TODO comments"
- ✅ "Backup and cleanup old files"
- ✅ "Generate project documentation"

### ReviewerAgent Tasks
- ✅ "Review code quality"
- ✅ "Validate consistency with standards"
- ✅ "Security audit of code"
- ✅ "Check test coverage"
- ✅ "Performance analysis"

## Execution Result

```typescript
interface SubAgentExecutionResult {
  success: boolean;        // Execution successful?
  output: string;          // Task result
  executionTime: number;   // Time in ms
  toolsUsed: string[];     // Tools leveraged
  confidence: number;      // 0-1 score
  metadata?: {
    error?: string;        // Error details
    [key: string]: any;
  };
}
```

## Auto-Routing Examples

```typescript
// These tasks auto-route to CodeAgent
- "Write a function" → CodeAgent
- "Implement authentication" → CodeAgent
- "Debug the failing test" → CodeAgent
- "Refactor for performance" → CodeAgent

// These auto-route to ResearchAgent
- "Research best practices" → ResearchAgent
- "Summarize this document" → ResearchAgent
- "Analyze the data" → ResearchAgent
- "Find information about X" → ResearchAgent

// These auto-route to ToolAgent
- "Create a directory" → ToolAgent
- "Run this command" → ToolAgent
- "Find all files matching" → ToolAgent
- "Execute the test suite" → ToolAgent

// These auto-route to ReviewerAgent
- "Review this code" → ReviewerAgent
- "Validate consistency" → ReviewerAgent
- "Audit for security" → ReviewerAgent
- "Check test coverage" → ReviewerAgent
```

## Performance Tips

1. **Use specialized methods when available**
   ```typescript
   // ✅ Better: Use specialized method
   await codeAgent.refactor(code, goals);
   
   // ⚠️ Less optimal: Generic execution
   await codeAgent.execute(`Refactor: ${code}`);
   ```

2. **Leverage parallel execution for independent tasks**
   ```typescript
   // ✅ Better: Parallel for independent tasks
   await pool.executeParallel([
     { type: 'code', task: 'Generate schema' },
     { type: 'research', task: 'Research patterns' },
   ]);
   
   // ⚠️ Not ideal: Sequential when parallel possible
   await pool.executeWithAgent('code', 'Generate schema');
   await pool.executeWithAgent('research', 'Research patterns');
   ```

3. **Monitor execution metrics**
   ```typescript
   const result = await agent.execute(task);
   
   if (!result.success) {
     console.error(`Failed: ${result.metadata?.error}`);
   } else {
     console.log(`Completed in ${result.executionTime}ms`);
     console.log(`Confidence: ${result.confidence * 100}%`);
   }
   ```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Wrong agent selected | Use clearer keywords in task description |
| Slow execution | Use parallel execution for independent tasks |
| Low confidence | Provide more detailed task specifications |
| Poor quality | Use specialized method or try different model |
| Execution timeout | Increase timeout or reduce task complexity |

## CLI Examples

```bash
# Use orchestrator (auto-routes sub-agents)
npm start -- orchestrator "Build a REST API"
npm start -- orch "Build a REST API"

# Direct sub-agent execution (via orchestrator)
# Currently only via CrewCoordinator programmatically
```

## API Reference

### CodeAgent
```typescript
new CodeAgent(config?)
.execute(task) → SubAgentExecutionResult
.generateCode(specification) → SubAgentExecutionResult
.refactor(code, goals) → SubAgentExecutionResult
.debug(code, issue) → SubAgentExecutionResult
```

### ResearchAgent
```typescript
new ResearchAgent(config?)
.execute(task) → SubAgentExecutionResult
.gather(topic, sources?) → SubAgentExecutionResult
.summarize(content, maxLength?) → SubAgentExecutionResult
.analyze(data, question) → SubAgentExecutionResult
```

### ToolAgent
```typescript
new ToolAgent(config?)
.execute(task) → SubAgentExecutionResult
.manageFiles(operation, path, content?) → SubAgentExecutionResult
.executeCommand(command, description?) → SubAgentExecutionResult
.searchFiles(pattern, path?) → SubAgentExecutionResult
```

### ReviewerAgent
```typescript
new ReviewerAgent(config?)
.execute(task) → SubAgentExecutionResult
.reviewCode(code, criteria?) → SubAgentExecutionResult
.validateConsistency(files, standards) → SubAgentExecutionResult
.validateOutput(output, requirements) → SubAgentExecutionResult
.securityAudit(code) → SubAgentExecutionResult
```

### SubAgentPool
```typescript
new SubAgentPool(config?)
.getCodeAgent() → CodeAgent
.getResearchAgent() → ResearchAgent
.getToolAgent() → ToolAgent
.getReviewerAgent() → ReviewerAgent
.getAgent(type) → BaseSubAgent
.executeWithAgent(type, task) → SubAgentExecutionResult
.executeParallel(tasks) → SubAgentExecutionResult[]
.getAvailableAgents() → AgentInfo[]
```

### CrewCoordinator
```typescript
crew.getSubAgentPool() → SubAgentPool
crew.getAvailableSubAgents() → AgentInfo[]
crew.executeWithSubAgent(type, task) → SubAgentExecutionResult
crew.executeSubAgentTasks(tasks) → SubAgentExecutionResult[]
```

## Related Documentation

- [SUBAGENT_ARCHITECTURE.md](./SUBAGENT_ARCHITECTURE.md) - Full guide
- [PRIMARY_ORCHESTRATOR.md](./PRIMARY_ORCHESTRATOR.md) - Orchestrator guide
- [Agent System Overview](./AGENT_SYSTEM.md)
