# Delegated Sub-Agent Architecture

## Overview

The **Delegated Sub-Agent Architecture** provides specialized agents for different responsibility domains. Each sub-agent is optimized for specific types of tasks and has access to relevant tools and execution strategies.

## Sub-Agent Types

### 1. **Code Agent** 🔧

**Responsibilities:**
- Writing production-grade code
- Code refactoring and optimization
- Debugging and issue resolution
- Code generation from specifications

**Available Tools:**
- `Write` - Create new files
- `Edit` - Modify existing code
- `Read` - Read files and code
- `Bash` - Execute commands
- `Glob` - File pattern matching
- `Grep` - Text search

**Expertise Areas:**
- Type safety (TypeScript, proper typing)
- Error handling
- Testability and maintainability
- Performance optimization
- Security best practices
- Design patterns

**Example Tasks:**
```
- "Implement a REST API endpoint for user authentication"
- "Refactor this function for better performance"
- "Debug the failing unit test"
- "Convert this JavaScript to TypeScript"
```

### 2. **Research Agent** 🔍

**Responsibilities:**
- Information gathering and analysis
- Content summarization
- Pattern identification
- Data synthesis and reporting

**Available Tools:**
- `Read` - Read files and documentation
- `WebFetch` - Retrieve web content
- `Glob` - Search for files
- `Grep` - Text pattern search
- `Bash` - Execute analysis commands

**Expertise Areas:**
- Accurate information synthesis
- Cross-reference verification
- Clear documentation
- Source attribution
- Insight extraction
- Comprehensive analysis

**Example Tasks:**
```
- "Research best practices for Node.js performance"
- "Summarize the API documentation"
- "Analyze the codebase for security vulnerabilities"
- "Create a report on project dependencies"
```

### 3. **Tool Agent** ⚙️

**Responsibilities:**
- Filesystem operations (create, read, update, delete)
- Shell command execution
- System operations and orchestration
- MCP tool integration

**Available Tools:**
- `Write` - Create/update files
- `Read` - Read files
- `Edit` - Modify files
- `Bash` - Execute shell commands
- `Glob` - File discovery
- `Grep` - Text search

**Expertise Areas:**
- Safe file operations
- Command execution
- Error handling and recovery
- Resource management
- System reliability
- Logging and reporting

**Example Tasks:**
```
- "Create directory structure for a new project"
- "Run the test suite and report results"
- "Find all TODO comments in the codebase"
- "Backup important files and clean up temporary ones"
```

### 4. **Reviewer Agent** ✅

**Responsibilities:**
- Code quality validation
- Consistency checking
- Performance analysis
- Security auditing
- Best practices enforcement

**Available Tools:**
- `Read` - Read files for review
- `Grep` - Search for patterns
- `Bash` - Run analysis tools

**Expertise Areas:**
- Code quality assessment
- Functional correctness
- Performance profiling
- Security vulnerability detection
- Consistency validation
- Best practices adherence
- Test coverage analysis

**Example Tasks:**
```
- "Review this code for quality issues"
- "Validate consistency with coding standards"
- "Check for security vulnerabilities"
- "Assess test coverage"
```

## Architecture

### Sub-Agent Pool

The `SubAgentPool` manages a collection of specialized sub-agents:

```typescript
const pool = new SubAgentPool({
  model: 'claude',
  verbose: true,
});

// Get specific agents
const codeAgent = pool.getCodeAgent();
const researchAgent = pool.getResearchAgent();
const toolAgent = pool.getToolAgent();
const reviewerAgent = pool.getReviewerAgent();

// Execute tasks
const result = await pool.executeWithAgent('code', 'Write a Node.js server');

// Parallel execution
const results = await pool.executeParallel([
  { type: 'code', task: 'Generate the API schema' },
  { type: 'research', task: 'Research best practices' },
  { type: 'reviewer', task: 'Review code quality' },
]);
```

### Orchestrator Integration

The `OrchestratorAgent` automatically routes tasks to appropriate sub-agents:

```typescript
// Automatic sub-agent selection
const orchestrator = new OrchestratorAgent();
const task = {
  description: "Write a function to validate email addresses",
  // subAgentType automatically determined as 'code'
};

const result = await orchestrator.executeTaskWithSubAgent(task);
```

### Sub-Agent Selection Logic

Tasks are automatically routed based on keywords:

| Sub-Agent | Keywords |
|-----------|----------|
| **Code** | code, write, implement, refactor, debug, fix, function, class, method, algorithm |
| **Research** | research, analyze, find, gather, summarize, explain, document, information, study |
| **Tool** | file, directory, bash, command, shell, execute, run, filesystem, mcp |
| **Reviewer** | review, validate, check, audit, verify, test, quality, consistent |

## Usage Examples

### Direct Sub-Agent Usage

```typescript
import {
  CodeAgent,
  ResearchAgent,
  ToolAgent,
  ReviewerAgent,
} from './src/agents/crew.js';

// Create agents
const codeAgent = new CodeAgent({ verbose: true });
const researchAgent = new ResearchAgent({ verbose: true });

// Execute tasks
const codeResult = await codeAgent.generateCode(
  'Create a function that validates credit card numbers'
);

const refactorResult = await codeAgent.refactor(
  existingCode,
  'Improve performance and readability'
);

const debugResult = await codeAgent.debug(
  code,
  'Function returns undefined instead of expected array'
);

// Research tasks
const summary = await researchAgent.summarize(longDocument, 100);
const analysis = await researchAgent.analyze(data, 'What are the trends?');
```

### Sub-Agent Pool Usage

```typescript
import { createSubAgentPool } from './src/agents/crew.js';

const pool = createSubAgentPool({ verbose: true });

// Execute with specific agent
const result = await pool.executeWithAgent(
  'code',
  'Write a function to calculate fibonacci numbers'
);

// Get available agents
const agents = pool.getAvailableAgents();
// => [
//   { type: 'code', name: 'CodeAgent' },
//   { type: 'research', name: 'ResearchAgent' },
//   { type: 'tool', name: 'ToolAgent' },
//   { type: 'reviewer', name: 'ReviewerAgent' }
// ]

// Parallel execution
const results = await pool.executeParallel([
  { type: 'code', task: 'Generate API routes' },
  { type: 'research', task: 'Research auth best practices' },
  { type: 'tool', task: 'Create project directory structure' },
]);
```

### Crew Coordinator Integration

```typescript
import { CrewCoordinator } from './src/agents/crew.js';

const crew = new CrewCoordinator(pollinationsClient);

// Get sub-agent pool
const pool = crew.getSubAgentPool();

// Execute specific sub-agent task
const result = await crew.executeWithSubAgent(
  'code',
  'Refactor this legacy function for better performance'
);

// Execute multiple tasks in parallel
const results = await crew.executeSubAgentTasks([
  { type: 'code', task: 'Generate the data model' },
  { type: 'research', task: 'Find similar implementations' },
  { type: 'reviewer', task: 'Validate against standards' },
]);

// Get available sub-agents
const subAgents = crew.getAvailableSubAgents();
```

### Orchestrator with Sub-Agents

```typescript
// The orchestrator automatically uses sub-agents during execution
const crew = new CrewCoordinator(pollinationsClient);

const result = await crew.orchestrateWithPrimaryOrchestrator(
  'Build a complete todo API with tests and documentation'
);

// Output shows sub-agent types:
// 👤 PHASE 3: Task Execution with Specialized Sub-Agents
// ⚡ Executing: Write the Express server setup code
//    Delegated to: coder
//    Sub-Agent Type: code
//    ✅ Success (1250ms)
//    🔧 Tools used: Read, Write, Bash
```

## Execution Flow

### Sub-Agent Execution Pipeline

```
1. Input Task
   ↓
2. Determine Sub-Agent Type
   ├─ Keywords/pattern matching
   └─ Task characteristics analysis
   ↓
3. Select Appropriate Sub-Agent
   ├─ CodeAgent (code tasks)
   ├─ ResearchAgent (info tasks)
   ├─ ToolAgent (system tasks)
   └─ ReviewerAgent (validation tasks)
   ↓
4. Build Specialized Prompt
   ├─ System prompt with expertise
   ├─ Tool availability
   └─ Quality standards
   ↓
5. Execute Task
   ├─ Leverage specialized tools
   ├─ Apply domain expertise
   └─ Return detailed result
   ↓
6. Result Metadata
   ├─ Execution time
   ├─ Tools used
   ├─ Success status
   └─ Confidence score
```

## Execution Result Structure

Each sub-agent execution returns:

```typescript
interface SubAgentExecutionResult {
  success: boolean;           // Was execution successful?
  output: string;             // Task result/output
  executionTime: number;      // Execution time in milliseconds
  toolsUsed: string[];        // Tools leveraged
  confidence: number;         // Confidence score (0-1)
  metadata?: {                // Additional information
    error?: string;
    [key: string]: any;
  };
}
```

## Advanced Features

### Parallel Execution

Execute multiple tasks in parallel using different sub-agents:

```typescript
const pool = createSubAgentPool();

const tasks = [
  { type: 'code', task: 'Generate database schema' },
  { type: 'research', task: 'Research ORM best practices' },
  { type: 'tool', task: 'Create project structure' },
];

const results = await pool.executeParallel(tasks);

// All tasks execute concurrently
// Results array contains results in same order as tasks
```

### Custom Sub-Agent Configuration

```typescript
const codeAgent = new CodeAgent({
  model: 'claude-3.5-sonnet',  // Custom model
  verbose: true,                 // Verbose output
  timeout: 120000,               // 2 minute timeout
});

const result = await codeAgent.execute(task);
```

### Sub-Agent Specialization

Each agent can use specialized methods:

```typescript
// CodeAgent specialized methods
const result1 = await codeAgent.refactor(code, goals);
const result2 = await codeAgent.debug(code, issue);
const result3 = await codeAgent.generateCode(specification);

// ResearchAgent specialized methods
const result1 = await researchAgent.gather(topic, sources);
const result2 = await researchAgent.summarize(content, maxLength);
const result3 = await researchAgent.analyze(data, question);

// ToolAgent specialized methods
const result1 = await toolAgent.manageFiles(operation, path, content);
const result2 = await toolAgent.executeCommand(command, description);
const result3 = await toolAgent.searchFiles(pattern, path);

// ReviewerAgent specialized methods
const result1 = await reviewerAgent.reviewCode(code, criteria);
const result2 = await reviewerAgent.validateConsistency(files, standards);
const result3 = await reviewerAgent.validateOutput(output, requirements);
const result4 = await reviewerAgent.securityAudit(code);
```

## Best Practices

### 1. Use Specific Task Descriptions

```typescript
// Good: Clear, specific task
const result = await codeAgent.generateCode(
  'Create a TypeScript class for managing user sessions with encryption'
);

// Poor: Vague task
const result = await codeAgent.generateCode('Write code');
```

### 2. Leverage Specialized Methods

```typescript
// Good: Use specific method
const result = await reviewerAgent.securityAudit(code);

// Less optimal: Generic execution
const result = await reviewerAgent.execute(`Audit security: ${code}`);
```

### 3. Monitor Execution Results

```typescript
const result = await subAgent.execute(task);

if (!result.success) {
  console.error('Execution failed:', result.metadata?.error);
} else {
  console.log(`Completed in ${result.executionTime}ms`);
  console.log(`Tools used: ${result.toolsUsed.join(', ')}`);
  console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
}
```

### 4. Use Parallel Execution for Independent Tasks

```typescript
// Good: Tasks are independent, execute in parallel
const results = await pool.executeParallel([
  { type: 'research', task: 'Research feature requirements' },
  { type: 'tool', task: 'Set up project structure' },
  { type: 'reviewer', task: 'Create quality checklist' },
]);

// Poor: Tasks are dependent, should execute sequentially
const results = await pool.executeParallel([
  { type: 'code', task: 'Generate schema' },
  { type: 'code', task: 'Generate API using schema' }, // Depends on schema
]);
```

### 5. Handle Sub-Agent Failures

```typescript
const result = await subAgent.execute(task);

if (!result.success) {
  // Retry with fallback
  const fallbackAgent = pool.getAgent('specialist');
  const fallbackResult = await fallbackAgent.execute(task);
  
  if (!fallbackResult.success) {
    // Handle complete failure
    throw new Error('All attempts failed');
  }
}
```

## Integration with Orchestrator

The primary orchestrator (Gemini 3.5 Flash) automatically:

1. **Plans tasks** and assigns sub-agent types
2. **Routes tasks** to appropriate sub-agents
3. **Monitors execution** and tracks results
4. **Handles failures** with fallback agents
5. **Synthesizes results** from multiple sub-agents

```typescript
// Automatic sub-agent orchestration
const result = await crew.orchestrateWithPrimaryOrchestrator(
  'Build a complete microservice'
);

// Shows:
// - Task planning with sub-agent type assignment
// - Specialized execution with appropriate agents
// - Detailed metrics about which sub-agents were used
// - Final synthesis from all results
```

## Performance Characteristics

| Sub-Agent | Best For | Typical Time |
|-----------|----------|-------------|
| **Code** | Implementation, refactoring | 5-30 seconds |
| **Research** | Analysis, summarization | 3-20 seconds |
| **Tool** | System operations | 1-10 seconds |
| **Reviewer** | Validation, auditing | 5-20 seconds |

## Troubleshooting

### Sub-Agent Not Selected Correctly

**Problem**: Wrong sub-agent selected for task

**Solution**: Use clearer keywords in task description
```typescript
// Include clear keywords for proper routing
const task = "Refactor and debug the authentication function";
// Will correctly route to CodeAgent (contains: refactor, debug)
```

### Poor Quality Results

**Problem**: Sub-agent produces low-quality output

**Solution**: 
- Use specialized methods if available
- Provide detailed specifications
- Set appropriate model and timeout
- Check confidence score

### Slow Execution

**Problem**: Sub-agent execution is slow

**Solution**:
- Use parallel execution for independent tasks
- Reduce task complexity
- Try different model
- Increase timeout if needed

## API Reference

See [SUBAGENT_API.md](./SUBAGENT_API.md) for complete API documentation.

## Related Documentation

- [Primary Orchestrator](./PRIMARY_ORCHESTRATOR.md)
- [Crew Coordinator Guide](./CREW_COORDINATOR.md)
- [Agent System Overview](./AGENT_SYSTEM.md)
