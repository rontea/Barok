# Primary Orchestrator: Gemini 3.5 Flash

## Overview

The **Primary Orchestrator** uses Google's **Gemini 3.5 Flash** as the central intelligence for orchestrating complex multi-agent tasks. It replaces the need for manual task decomposition by providing an intelligent, high-performance orchestration layer.

## Key Responsibilities

### 1. **Task Planning**
- Analyzes complex user requests and decomposes them into manageable subtasks
- Assigns complexity levels (low/medium/high) to each subtask
- Prioritizes subtasks based on dependencies and importance
- Identifies required capabilities for each subtask

### 2. **ReAct Loop Control**
- Manages the Reasoning-Action-Observation loop for orchestration decisions
- Reasons about the current execution state after each task
- Makes intelligent decisions about which task to execute next
- Handles task dependencies and sequential/parallel execution
- Records each reasoning step for transparency

### 3. **Delegation Decisions**
- Intelligently delegates each subtask to specialized agents
- Considers task complexity and required capabilities
- Maintains confidence scores for each delegation decision
- Provides fallback agents if the primary agent fails
- Learns from delegation outcomes

### 4. **Result Synthesis**
- Consolidates results from multiple specialized agents
- Synthesizes a coherent final answer that directly addresses the original request
- Highlights connections and dependencies between subtask results
- Suggests actionable next steps if applicable

## Architecture

```
User Task
    ↓
┌─────────────────────────────────────┐
│   Gemini 3.5 Flash Orchestrator    │
├─────────────────────────────────────┤
│ ▸ Task Planning                     │
│ ▸ ReAct Loop Control                │
│ ▸ Delegation Decisions              │
│ ▸ Result Synthesis                  │
└─────────────────────────────────────┘
    ↓ ↓ ↓ ↓ ↓ ↓
┌─────────────────────────────────────┐
│    Specialized Agent Pool           │
├─────────────────────────────────────┤
│ • Coder       - Code generation     │
│ • Researcher  - Information finding │
│ • Tester      - QA & validation     │
│ • Reviewer    - Code review         │
│ • Planner     - Architecture design │
│ • Documenter  - Documentation       │
│ • Specialist  - Edge cases          │
└─────────────────────────────────────┘
    ↓
Final Synthesized Result
```

## Usage

### CLI Command

```bash
# Using the orchestrator command
npm start -- orchestrator "Build and test a Node.js REST API"

# Or using the alias
npm start -- orch "Write documentation for the authentication system"
```

### Programmatic API

```typescript
import { CrewCoordinator } from './src/agents/crew.js';
import { pollinationsClient } from './src/pollinations/client.js';

const crew = new CrewCoordinator(pollinationsClient);

// Use the primary orchestrator (Gemini 3.5 Flash)
const result = await crew.orchestrateWithPrimaryOrchestrator(
  "Your complex task here"
);

console.log(result);

// Access orchestrator metrics
const metrics = crew.getOrchestratorMetrics();
console.log(metrics.metrics);
```

## Execution Flow

### Phase 1: Planning
1. Gemini 3.5 Flash analyzes the task
2. Generates 2-8 concrete subtasks
3. Assigns complexity levels and priorities
4. Identifies required capabilities

### Phase 2: ReAct Loop
1. **Reason**: Think about current state and next best action
2. **Act**: Delegate to an appropriate agent
3. **Observe**: Record the delegation decision
4. Repeat until all tasks are planned

### Phase 3: Execution
1. For each planned task:
   - Execute with the delegated agent
   - If failure, try fallback agents
   - Record the result
2. Display real-time progress

### Phase 4: Synthesis
1. Collect all task results
2. Use Gemini 3.5 Flash to synthesize a comprehensive answer
3. Return final result with metrics

## Configuration

### Environment Variables

```bash
# Required: Gemini API Key
export GEMINI_API_KEY="your_gemini_api_key"

# Optional: Pollinations API Key
export POLLINATIONS_API_KEY="your_pollinations_key"

# Optional: Default model for sub-agents
export DEFAULT_MODEL="claude"
```

### Model Configuration

Gemini 3.5 Flash is configured in [modelConfig.ts](../../src/config/modelConfig.ts):

```typescript
'gemini-3.5-flash': {
  name: 'Gemini 3.5 Flash',
  provider: 'gemini',
  type: 'multimodal',
  pricing: {
    promptTokens: 0.000035,  // $0.035 per 1M tokens
    completionTokens: 0.00014, // $0.14 per 1M tokens
  },
  maxTokens: 16384,
  contextWindow: 1000000,
  supportsVision: true,
  supportsToolUse: true,
  supportsFunctionCalling: true,
  isActive: true,
  description: 'Google Gemini 3.5 Flash - Latest ultrafast model, ideal for orchestration',
}
```

## Performance Characteristics

### Speed
- **Gemini 3.5 Flash** is optimized for speed with minimal latency
- Ideal for real-time orchestration decisions
- Fast enough to manage complex multi-step workflows

### Cost
- **Very economical**: $0.035 per 1M prompt tokens, $0.14 per 1M completion tokens
- 10x cheaper than many enterprise LLMs
- Suitable for high-volume orchestration tasks

### Quality
- Advanced reasoning capabilities for task planning and decomposition
- Accurate delegation decisions
- High-quality result synthesis

## Advanced Features

### Task Dependencies
The orchestrator respects task dependencies:
- Automatically sequences tasks that depend on earlier results
- Executes independent tasks in an optimal order

### Fallback Handling
For each task, the orchestrator provides:
- Primary agent assignment
- Fallback agents (2-3 options)
- Automatic retry with fallbacks on failure

### Confidence Scoring
Each delegation decision includes:
- Confidence score (0-1)
- Reasoning explanation
- Estimated cost

### Metrics & Observability

```typescript
const metrics = crew.getOrchestratorMetrics();

// Contains:
{
  state: OrchestratorState,          // Full execution state
  metrics: {
    totalTime: number,               // Execution time in ms
    totalTasks: number,              // Number of subtasks
    completedTasks: number,          // Successful tasks
    failedTasks: number,             // Failed tasks
    reactSteps: number,              // ReAct loop iterations
    state: string,                   // Current state
  },
  decisions: Map<string, DelegationDecision>,  // Delegation decisions
  reactSteps: Array<...>             // ReAct loop steps
}
```

## Examples

### Example 1: Build & Test a REST API

```bash
npm start -- orch "Create a complete Node.js REST API for a todo app, including routes, database models, tests, and documentation"
```

**Orchestrator decomposition:**
1. Design API structure and database schema (Planner)
2. Implement API routes and handlers (Coder)
3. Create database models and migrations (Coder)
4. Write comprehensive unit tests (Tester)
5. Create API documentation (Documenter)
6. Code review for quality (Reviewer)

### Example 2: Document Complex System

```bash
npm start -- orchestrator "Write comprehensive documentation for a microservices authentication system including architecture diagrams, API reference, deployment guide, and troubleshooting"
```

**Orchestrator decomposition:**
1. Analyze system architecture (Researcher)
2. Document architecture patterns (Documenter)
3. Create API reference (Coder + Documenter)
4. Write deployment guide (Planner + Documenter)
5. Compile troubleshooting guide (Specialist)

## Comparison with Legacy Orchestrator

| Feature | Legacy | Primary Orchestrator |
|---------|--------|----------------------|
| Planning Model | Pollinations/Claude | Gemini 3.5 Flash |
| Task Decomposition | Basic | Advanced reasoning |
| ReAct Loop | No | Yes |
| Delegation Intelligence | Basic keyword matching | Reasoning-based |
| Result Synthesis | Simple | Advanced synthesis |
| Cost | Higher | 10x cheaper |
| Speed | Moderate | Very fast |
| Observability | Limited | Comprehensive metrics |

## Best Practices

1. **Clear Task Descriptions**: Provide detailed task descriptions for better planning
   ```
   Good: "Build a REST API with authentication, database persistence, and test coverage"
   Bad: "Build an API"
   ```

2. **Monitor Metrics**: Check execution metrics to understand performance
   ```typescript
   const metrics = crew.getOrchestratorMetrics();
   console.log(`Completed in ${metrics.metrics.totalTime}ms`);
   ```

3. **Handle Fallbacks**: The orchestrator automatically handles failures, but monitor them
   ```typescript
   if (metrics.metrics.failedTasks > 0) {
     console.warn(`${metrics.metrics.failedTasks} tasks failed`);
   }
   ```

4. **Set Appropriate Timeouts**: For complex tasks, set reasonable timeouts
   ```typescript
   const orchestrator = new OrchestratorAgent({
     timeout: 600000, // 10 minutes
   });
   ```

## Troubleshooting

### Gemini API Key Not Set

```
ERROR: GEMINI_API_KEY environment variable is not set
```

**Solution**: Set your Gemini API key:
```bash
export GEMINI_API_KEY="your_key_here"
```

### Orchestration Timeout

**Solution**: Increase the timeout or break the task into smaller pieces:
```typescript
const orchestrator = new OrchestratorAgent({
  timeout: 300000, // 5 minutes (default)
  maxReactSteps: 15, // Adjust ReAct loop iterations
});
```

### Poor Task Delegation

**Solution**: Provide more detailed task descriptions for better reasoning

### Low Confidence Scores

**Solution**: Complex tasks may have lower confidence. Monitor and verify results carefully.

## API Reference

### `OrchestratorAgent`

#### Constructor
```typescript
new OrchestratorAgent(config?: OrchestratorConfig)
```

#### Methods
- `planTask(task: string): Promise<Task[]>` - Plan and decompose task
- `executeReActLoop(tasks: Task[]): Promise<void>` - Run orchestration reasoning loop
- `makeDelegationDecision(task: Task, contextTasks: Task[]): Promise<DelegationDecision>` - Make delegation decision
- `synthesizeResults(originalTask: string, taskResults: Array): Promise<string>` - Synthesize final result
- `getState(): OrchestratorState | null` - Get current state
- `getMetrics()` - Get execution metrics
- `getTasks(): Task[]` - Get all tasks
- `getDecisions(): Map<string, DelegationDecision>` - Get delegation decisions
- `getReActSteps()` - Get ReAct loop steps

### `CrewCoordinator`

#### Methods
- `orchestrateWithPrimaryOrchestrator(task: string): Promise<string>` - Run with primary orchestrator
- `getOrchestrator()` - Get orchestrator instance
- `getOrchestratorMetrics()` - Get metrics and state

## Future Enhancements

- [ ] Parallel task execution support
- [ ] Custom agent role definitions
- [ ] Persistent orchestration history
- [ ] Cost optimization strategies
- [ ] Machine learning-based delegation optimization
- [ ] Multi-language task support
- [ ] Real-time streaming results

## Related Documentation

- [Architecture Guide](../architecture/ORCHESTRATION.md)
- [Model Configuration](../../src/config/README.md)
- [ReAct Loop Guide](./REACT_LOOP.md)
- [Agent System Guide](./AGENT_SYSTEM.md)
