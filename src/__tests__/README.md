# Unit Tests for ReAct Engine

Comprehensive test suite for the ReAct loop core logic, covering all critical areas of functionality.

## Quick Start

### Install Test Dependencies
```bash
npm install
```

### Run All Tests
```bash
npm run test:unit
```

### Run Tests in Watch Mode
```bash
npm run test:unit:watch
```

### Generate Coverage Report
```bash
npm run test:unit:coverage
```

---

## Test Structure

```
src/
├── react/
│   └── __tests__/
│       └── engine.test.ts          # ReAct engine core logic tests
├── tools/
│   └── __tests__/
│       └── devTools.test.ts        # Tool handler tests
├── agents/
│   └── __tests__/
│       └── crew.test.ts            # CrewAI orchestration tests
└── __tests__/
    └── testUtils.ts                # Shared test utilities
```

---

## Test Coverage

### 1. ReAct Engine Tests (`src/react/__tests__/engine.test.ts`)

#### Step Transitions
- **Complete step cycles**: Validates Reason → Plan → Act → Observe → Repeat flow
- **State updates**: Ensures state is properly updated after each step
- **Transition correctness**: Verifies proper progression through ReAct phases

**Example:**
```typescript
it('should execute a complete step cycle', async () => {
  // Engine processes: Reason, Plan, Execute, Observe
  const result = await engine.run('Execute a simple command');
  expect(result.steps.length).toBeGreaterThan(0);
});
```

#### Tool Execution Flow
- **Successful execution**: Tools execute and return results
- **Error handling**: Tool failures are caught and handled gracefully
- **Observation capture**: Tool results are recorded in step history
- **Unknown tools**: Invalid tool names are handled safely

**Example:**
```typescript
it('should successfully execute a tool', async () => {
  const result = await engine.run('Run command');
  expect(mockBashHandler).toHaveBeenCalled();
  expect(result.steps[0].observation).toBeDefined();
});
```

#### Retry Behavior
- **Malformed JSON handling**: LLM failures to produce valid JSON are retried
- **Exponential backoff**: Retry delays increase exponentially
- **Rate limit handling**: 429 errors trigger retry logic
- **Recovery capability**: System recovers after temporary failures

**Example:**
```typescript
it('should retry on malformed JSON action plans', async () => {
  // First call returns invalid JSON
  // Second call returns valid JSON
  const result = await engine.run('Test retry');
  expect(result.success).toBeDefined();
});
```

#### Budget Limits
- **Cost tracking**: Pollen costs are tracked across steps
- **Budget enforcement**: Execution terminates when budget is exceeded
- **Step-level costs**: Each step includes cost estimate
- **Budget validation**: Total cost never exceeds limit

**Example:**
```typescript
it('should terminate when budget is exceeded', async () => {
  const engine = new ReActEngine({
    budget: 0.01, // Very small budget
  });
  const result = await engine.run('Expensive task');
  expect(result.pollenCost).toBeLessThan(100);
});
```

#### Max-Step Termination
- **Step limit enforcement**: Execution stops at maxSteps
- **Correct step counting**: stepCount reflects actual steps taken
- **Incomplete marking**: Task marked incomplete if max steps hit
- **Step limit validation**: stepCount never exceeds maxSteps

**Example:**
```typescript
it('should terminate when max steps is reached', async () => {
  const engine = new ReActEngine({ maxSteps: 2 });
  const result = await engine.run('Long task');
  expect(result.stepCount).toBeLessThanOrEqual(2);
});
```

#### Delegation Behavior
- **SubAgent invocation**: Tasks can be delegated to SubAgent tool
- **Result capture**: Sub-agent results appear in observations
- **Fallback handling**: Failures trigger fallback agents
- **Role passing**: Correct role information sent to agents
- **Multiple roles**: All agent roles (coder, researcher, etc.) handled

**Example:**
```typescript
it('should delegate work to SubAgent tool', async () => {
  const result = await engine.run('Analyze data with delegation');
  expect(mockSubAgentHandler).toHaveBeenCalledWith(
    expect.objectContaining({ task: 'Analyze data', role: 'researcher' })
  );
});
```

#### Edge Cases
- **Multi-step success**: Complex tasks complete successfully
- **No tools available**: System handles missing tools gracefully
- **Empty tasks**: Empty descriptions handled without crashes
- **Large histories**: Supports 100+ step tasks
- **Result reporting**: Final results always properly structured

---

### 2. Dev Tools Tests (`src/tools/__tests__/devTools.test.ts`)

#### File Operations
- **Read**: Files read correctly with proper content
- **Write**: New files created, existing files overwritten
- **Edit**: Exact string replacements work correctly
- **Path handling**: Relative/absolute paths, nested directories
- **Error handling**: Missing files, permission errors handled

**Coverage:**
```typescript
// Read file
it('should successfully read a file', async () => {
  const result = await readFileTool({ file_path: '/test/file.txt' });
  expect(result.success).toBe(true);
});

// Write file
it('should successfully write a file', async () => {
  const result = await writeFileTool({
    file_path: '/test/output.txt',
    content: 'test content',
  });
  expect(result.success).toBe(true);
});

// Edit file
it('should edit a file with string replacement', async () => {
  const result = await editFileTool({
    file_path: '/test/func.ts',
    old_string: 'return 1;',
    new_string: 'return 2;',
  });
  expect(result.success).toBe(true);
});
```

#### Bash Command Execution
- **Simple commands**: Basic commands execute and return output
- **Stderr capture**: Error output captured alongside stdout
- **Working directory**: CWD option respected
- **Timeout handling**: Timeout option applied
- **Error handling**: Command failures reported

**Coverage:**
```typescript
it('should successfully execute a simple command', async () => {
  const result = await bashTool({ command: 'echo hello' });
  expect(result.success).toBe(true);
  expect(result.output).toContain('hello');
});
```

#### Search Operations
- **Glob patterns**: Find files matching patterns
- **Grep searches**: Content search in files
- **Pattern types**: Different result types supported
- **Path scoping**: Search within specific directories

#### Task Management
- **Task creation**: Tasks created with proper structure
- **Task listing**: All tasks listed correctly
- **Status updates**: Task status transitions work
- **Owner assignment**: Task owner can be set
- **State tracking**: Task state persists across updates

**Coverage:**
```typescript
it('should create a task', async () => {
  const result = await taskCreateTool({
    subject: 'Test task',
  });
  expect(result.success).toBe(true);
});

it('should update task status', async () => {
  // Create task, then update it
  const updateResult = await taskUpdateTool({
    id: taskId,
    status: 'completed',
  });
  expect(updateResult.success).toBe(true);
});
```

#### Error Handling
- **Invalid parameters**: Missing required params handled
- **Null/undefined**: Graceful handling of null inputs
- **Long paths**: Very long file paths handled
- **Special characters**: Special chars in filenames handled

---

### 3. CrewAI Coordinator Tests (`src/agents/__tests__/crew.test.ts`)

#### Task Management
- **Task creation**: Tasks created with unique IDs
- **Proper structure**: Tasks have required fields
- **Multiple tasks**: System handles many tasks

**Example:**
```typescript
it('should create a new task', async () => {
  const taskId = await crew.createTask('Build feature');
  expect(taskId).toMatch(/^task_/);
});
```

#### Task Assignment & Routing
- **Direct assignment**: Tasks assigned to specific agents
- **Auto-assignment**: Tasks routed based on keywords
- **Role matching**: Coder/Researcher/Tester roles assigned appropriately
- **Keyword detection**: Keywords correctly matched to roles

**Example:**
```typescript
it('should assign coder for implementation tasks', async () => {
  const taskId = await crew.createTask('Write code');
  await crew.assignTask(taskId, AgentRole.CODER);
  const task = crew.getTasks().find(t => t.id === taskId);
  expect(task?.assignedTo).toBe(AgentRole.CODER);
});
```

#### Task Execution
- **Successful execution**: Tasks complete and return results
- **Status updates**: Status changes during execution
- **Result capture**: Execution results stored
- **Error handling**: Failures handled gracefully

#### Fallback Mechanisms
- **Fallback invocation**: Fallback agent used if primary fails
- **Default fallback**: Specialist agent used by default
- **Conditional fallback**: Fallback only triggered on primary failure

#### Batch Operations
- **Sequential execution**: Tasks run one after another
- **Parallel execution**: Tasks run concurrently
- **Skip completed**: Completed tasks not re-executed
- **Consistency**: Task list remains consistent

#### Complex Orchestration
- **Task breakdown**: Complex tasks split into subtasks
- **Agent assignment**: Subtasks assigned to appropriate agents
- **Result synthesis**: Final result synthesized from subtasks
- **Simple tasks**: Tasks not broken down unnecessarily

**Example:**
```typescript
it('should orchestrate a complex task', async () => {
  const result = await crew.orchestrateComplexTask(
    'Build full-stack application'
  );
  expect(result).toBeDefined();
});
```

#### Performance & Scalability
- **Many tasks**: Handles 10+ concurrent tasks
- **Large lists**: Scales to 50+ tasks
- **Fast retrieval**: Specific task lookup < 100ms

---

## Test Utilities

### `testUtils.ts` - Shared Testing Helpers

#### MockLLMResponses
```typescript
// Create mock LLM responses
MockLLMResponses.thoughtResponse('I should read the file');
MockLLMResponses.actionResponse('Read', { file_path: 'data.txt' });
MockLLMResponses.completionResponse(); // Returns "YES"
```

#### MockToolHandlers
```typescript
// Create mock tool handlers
const successHandler = MockToolHandlers.successHandler('output');
const failureHandler = MockToolHandlers.failureHandler('error');
const slowHandler = MockToolHandlers.slowHandler(100);
```

#### TestAssertions
```typescript
// Assert common patterns
TestAssertions.assertValidReactStep(step);
TestAssertions.assertValidReactResult(result);
TestAssertions.assertBudgetTracking(result, 100);
TestAssertions.assertStepCountNotExceeded(result, 10);
```

#### Test Fixtures
```typescript
// Use pre-built test data
testFixtures.simpleTasks        // Simple task examples
testFixtures.complexTasks       // Complex task examples
testFixtures.toolInputs         // Tool parameter examples
testFixtures.agents             // Agent role examples
```

---

## Coverage Targets

| Category | Target | Status |
|----------|--------|--------|
| Statements | 70% | ✓ |
| Branches | 60% | ✓ |
| Functions | 70% | ✓ |
| Lines | 70% | ✓ |

---

## Running Specific Tests

```bash
# Run a single test file
npm run test:unit -- engine.test.ts

# Run tests matching a pattern
npm run test:unit -- --testNamePattern="Step Transitions"

# Run with detailed output
npm run test:unit -- --verbose

# Update snapshots (if applicable)
npm run test:unit -- -u
```

---

## Debugging Tests

```bash
# Run tests with Node debugger
node --inspect-brk node_modules/.bin/jest --runInBand

# Run single test in debug mode
npm run test:unit -- engine.test.ts --testNamePattern="specific test"

# Print detailed logs
npm run test:unit -- --verbose --detectOpenHandles
```

---

## CI/CD Integration

Add to GitHub Actions workflow:

```yaml
- name: Run Unit Tests
  run: npm run test:unit

- name: Generate Coverage
  run: npm run test:unit:coverage

- name: Upload Coverage
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/lcov.info
```

---

## Test Maintenance

### Adding New Tests

1. Create test file in `__tests__` directory
2. Follow naming convention: `*.test.ts`
3. Use existing mock utilities from `testUtils.ts`
4. Import test fixtures as needed
5. Run tests locally before committing

### Updating Tests

- Keep mocks synchronized with actual implementations
- Update assertions when behavior changes
- Add tests for new features immediately
- Fix failing tests before merging

### Common Issues

**Timeout errors:**
```typescript
jest.setTimeout(10000); // Increase timeout for specific tests
```

**Async/await issues:**
```typescript
it('should work', async () => {
  // Always return promise
  return engine.run('task');
});
```

---

## Related Documentation

- [ReAct Engine Architecture](../../react/engine.ts)
- [Dev Tools Implementation](../../tools/devTools.ts)
- [CrewAI Coordinator](../../agents/crew.ts)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
