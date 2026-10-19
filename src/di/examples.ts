/**
 * Dependency Injection Examples
 * Demonstrates how to use the DI system in different scenarios
 */

import {
  initializeDIContainer,
  getDIContainer,
  resetDIContainer,
  di,
  DefaultToolRegistry,
  FilteredToolRegistry,
  FileExecutionLogger,
  InMemoryExecutionLogger,
  ConsoleStructuredLogger,
  FileStorage,
  InMemoryStorage,
  PollinationsLLMProvider,
  GeminiLLMProvider,
  CompositeLLMProvider,
  MockLLMProvider,
} from '../di/index.js';
import { ReActEngine } from '../react/engine.js';

/**
 * Example 1: Basic initialization with defaults
 * Uses environment variables for configuration
 */
export async function example1_BasicInitialization() {
  console.log('\n=== Example 1: Basic Initialization ===');

  // Initialize with defaults from environment
  const container = initializeDIContainer();

  // Access services
  const llm = container.getLLMProvider();
  const tools = container.getToolRegistry();
  const logger = container.getExecutionLogger();

  console.log(`LLM Provider: ${llm.getProviderName()}`);
  console.log(`Available tools: ${tools.size()}`);

  // Create and run ReActEngine with DI
  const engine = new ReActEngine({
    maxSteps: 5,
    model: 'qwen-coder',
  });

  console.log('Engine created successfully with injected dependencies');
}

/**
 * Example 2: Custom LLM providers
 * Set up multiple providers with fallback chain
 */
export async function example2_CustomLLMProviders() {
  console.log('\n=== Example 2: Custom LLM Providers ===');

  const pollinationsProvider = new PollinationsLLMProvider(process.env.POLLINATIONS_API_KEY);
  const geminiProvider = new GeminiLLMProvider(process.env.GEMINI_API_KEY);

  // Create composite provider with fallback chain
  const compositeProvider = new CompositeLLMProvider([pollinationsProvider, geminiProvider]);

  // Initialize container with custom providers
  const container = initializeDIContainer({
    llmProviders: [compositeProvider],
  });

  const llm = container.getLLMProvider();
  console.log(`Primary provider: ${llm.getProviderName()}`);

  // Test cost estimation
  const cost = llm.estimateStepCost('qwen-coder');
  console.log(`Estimated cost per step: $${cost.toFixed(6)}`);

  // Create engine using injected provider
  const engine = new ReActEngine({
    maxSteps: 3,
    model: 'qwen-coder',
  });

  console.log('Engine created with custom LLM providers');
}

/**
 * Example 3: Filtered tool registry
 * Restrict available tools for security or performance
 */
export async function example3_FilteredToolRegistry() {
  console.log('\n=== Example 3: Filtered Tool Registry ===');

  const baseRegistry = new DefaultToolRegistry();
  console.log(`Total available tools: ${baseRegistry.size()}`);

  // Allow only specific tools
  const allowedTools = ['Read', 'Write', 'Bash'];
  const filteredRegistry = new FilteredToolRegistry(baseRegistry, allowedTools);

  console.log(`Allowed tools: ${allowedTools.join(', ')}`);
  console.log(`Filtered registry size: ${filteredRegistry.size()}`);

  // Initialize container with filtered registry
  const container = initializeDIContainer({
    toolRegistry: filteredRegistry,
  });

  const tools = container.getToolRegistry();
  console.log(`Enabled tools: ${tools.getNames().join(', ')}`);
}

/**
 * Example 4: In-memory logger for testing
 * Useful for unit tests and development
 */
export async function example4_InMemoryLogging() {
  console.log('\n=== Example 4: In-Memory Logging ===');

  const memoryLogger = new InMemoryExecutionLogger();
  const memoryStorage = new InMemoryStorage();
  const consoleLogger = new ConsoleStructuredLogger(true);

  // Initialize container with in-memory implementations
  const container = initializeDIContainer({
    executionLogger: memoryLogger,
    storage: memoryStorage,
    structuredLogger: consoleLogger,
  });

  console.log('Initialized with in-memory logging for testing');

  // Create engine and run
  const engine = new ReActEngine({
    maxSteps: 2,
    model: 'qwen-coder',
  });

  console.log('Engine ready for testing without file I/O');
}

/**
 * Example 5: Mock LLM for testing
 * Use mock responses without hitting real APIs
 */
export async function example5_MockLLM() {
  console.log('\n=== Example 5: Mock LLM Provider ===');

  const mockProvider = new MockLLMProvider('Mock response: Task completed successfully');
  mockProvider.setResponse('qwen-coder', 'Special response for qwen-coder model');

  // Initialize container with mock provider
  resetDIContainer(); // Clear previous instance
  const container = initializeDIContainer({
    llmProviders: [mockProvider],
  });

  // Create engine with mock
  const engine = new ReActEngine({
    maxSteps: 2,
    model: 'qwen-coder',
  });

  console.log('Engine created with mock LLM provider for testing');

  // Create test response
  const response = await mockProvider.createChatCompletion(
    [{ role: 'user', content: 'Hello' }],
    'qwen-coder'
  );
  console.log(`Mock response: ${response}`);
}

/**
 * Example 6: Using DI convenience object
 * Access services via simple di object
 */
export async function example6_DIConvenience() {
  console.log('\n=== Example 6: DI Convenience Object ===');

  // Initialize container (if not already initialized)
  initializeDIContainer();

  // Access services via convenient di object
  console.log(`LLM Provider: ${di.llm().getProviderName()}`);
  console.log(`Total tools: ${di.tools().size()}`);
  console.log(`Tool names: ${di.getTools().map((t) => t.name).join(', ')}`);

  // Get specific tool
  const readTool = di.getTool('Read');
  console.log(`Found Read tool: ${readTool ? 'yes' : 'no'}`);

  // Enable/disable tools
  di.setToolEnabled('Bash', false);
  console.log(`Enabled tools: ${di.getEnabledTools().length}`);

  // Create engine
  const engine = new ReActEngine();
  console.log('Engine created with DI convenience interface');
}

/**
 * Example 7: Custom workspace configuration
 * Set up DI with custom workspace paths
 */
export async function example7_WorkspaceConfiguration() {
  console.log('\n=== Example 7: Workspace Configuration ===');

  const workspacePath = '/custom/workspace';

  const container = initializeDIContainer({
    workspaceRoot: workspacePath,
    debug: true,
  });

  console.log(`Workspace root: ${workspacePath}`);
  console.log('Structured logger initialized with debug mode enabled');

  // Create engine with workspace config
  const engine = new ReActEngine({
    workspace: workspacePath,
    maxSteps: 3,
  });

  console.log('Engine created with custom workspace configuration');
}

/**
 * Example 8: Using multiple containers
 * Reset and reinitialize for different test scenarios
 */
export async function example8_MultipleContainers() {
  console.log('\n=== Example 8: Multiple Containers ===');

  // First scenario: production setup
  console.log('Scenario 1: Production setup');
  const prodContainer = initializeDIContainer({
    apiKeys: {
      pollinations: process.env.POLLINATIONS_API_KEY,
      gemini: process.env.GEMINI_API_KEY,
    },
  });
  console.log(`Provider: ${prodContainer.getLLMProvider().getProviderName()}`);

  // Reset for testing
  resetDIContainer();

  // Second scenario: testing setup
  console.log('\nScenario 2: Testing setup');
  const mockProvider = new MockLLMProvider('Test response');
  const testContainer = initializeDIContainer({
    llmProviders: [mockProvider],
  });
  console.log(`Provider: ${testContainer.getLLMProvider().getProviderName()}`);

  // Reset for next use
  resetDIContainer();
  console.log('Containers reset successfully');
}

/**
 * Example 9: Extending with custom services
 * Register and retrieve custom dependencies
 */
export async function example9_CustomServices() {
  console.log('\n=== Example 9: Custom Services ===');

  const container = initializeDIContainer();

  // Register custom service
  interface CustomAnalytics {
    recordEvent(name: string): void;
  }

  const analytics: CustomAnalytics = {
    recordEvent: (name) => console.log(`Analytics: ${name}`),
  };

  container.register<CustomAnalytics>('analytics', () => analytics);

  // Retrieve custom service
  const retrievedAnalytics = container.get<CustomAnalytics>('analytics');
  if (retrievedAnalytics) {
    retrievedAnalytics.recordEvent('engine_started');
  }

  console.log('Custom service registered and retrieved');
}

/**
 * Example 10: Complete application setup
 * Full example with all components working together
 */
export async function example10_CompleteSetup() {
  console.log('\n=== Example 10: Complete Application Setup ===');

  // Reset any previous state
  resetDIContainer();

  // Initialize with production settings
  const container = initializeDIContainer({
    apiKeys: {
      pollinations: process.env.POLLINATIONS_API_KEY || 'demo-key',
      gemini: process.env.GEMINI_API_KEY,
    },
    debug: false,
  });

  console.log('✓ DI Container initialized');
  console.log(`✓ LLM Provider: ${container.getLLMProvider().getProviderName()}`);
  console.log(`✓ Tools available: ${container.getToolRegistry().size()}`);
  console.log(`✓ Logger configured`);
  console.log(`✓ Storage configured`);

  // Create application components
  const engine = new ReActEngine({
    maxSteps: 10,
    model: 'qwen-coder',
    budget: 1000,
  });

  console.log('\n✓ ReAct Engine created and ready');
  console.log('✓ All dependencies successfully injected');
  console.log('\nApplication ready for task execution');
}

/**
 * Run all examples
 */
export async function runAllExamples() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║  Dependency Injection System - Complete Examples       ║');
  console.log('╚════════════════════════════════════════════════════════╝');

  try {
    await example1_BasicInitialization();
    await example2_CustomLLMProviders();
    await example3_FilteredToolRegistry();
    await example4_InMemoryLogging();
    await example5_MockLLM();
    await example6_DIConvenience();
    await example7_WorkspaceConfiguration();
    await example8_MultipleContainers();
    await example9_CustomServices();
    await example10_CompleteSetup();

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║  All examples completed successfully!                  ║');
    console.log('╚════════════════════════════════════════════════════════╝');
  } catch (error) {
    console.error('Example failed:', error instanceof Error ? error.message : String(error));
  }
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples().catch(console.error);
}
