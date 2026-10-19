/**
 * Configuration System Examples
 * Shows how to use the centralized configuration system
 */

import {
  ConfigService,
  initializeConfigService,
  getConfigService,
  config,
  loadAndValidateConfig,
  printConfigReport,
  EnvConfigManager,
  RuntimeConfigManager,
  ModelConfigManager,
  ToolConfigManager,
  WorkspaceConfigManager,
} from '../config/index.js';

// ============================================================================
// BASIC USAGE
// ============================================================================

/**
 * Initialize and use global config
 */
export function basicExample() {
  // Initialize with defaults
  const configService = initializeConfigService();

  // Get config values
  const runtime = configService.getRuntimeConfig().getConfig();
  console.log(`Max steps: ${runtime.maxSteps}`);
  console.log(`Default model: ${runtime.defaultModel}`);

  // Or use convenience getters
  console.log(`API Key configured: ${config.env().pollinationsApiKey ? 'Yes' : 'No'}`);
  console.log(`Timeout for bash: ${config.getTimeout('bash')}ms`);
}

// ============================================================================
// ENVIRONMENT CONFIGURATION
// ============================================================================

/**
 * Work with environment configuration
 */
export function envConfigExample() {
  const envConfig = getConfigService().getEnvConfig();

  // Get API key
  const pollinationsKey = envConfig.getApiKey('pollinations');
  const geminiKey = envConfig.getApiKey('gemini');

  console.log(`Has Pollinations API key: ${envConfig.hasApiKey('pollinations')}`);
  console.log(`Has Gemini API key: ${envConfig.hasApiKey('gemini')}`);

  // Get logging settings
  const env = envConfig.getConfig();
  console.log(`Log level: ${env.logLevel}`);
  console.log(`Debug mode: ${env.debugMode}`);
  console.log(`Verbose: ${env.verbose}`);

  // Validate
  const errors = envConfig.validate();
  if (errors.length > 0) {
    console.error('Environment config errors:', errors);
  }
}

// ============================================================================
// RUNTIME CONFIGURATION
// ============================================================================

/**
 * Work with runtime configuration
 */
export function runtimeConfigExample() {
  const runtimeConfig = getConfigService().getRuntimeConfig();
  const runtime = runtimeConfig.getConfig();

  console.log(`Max steps: ${runtime.maxSteps}`);
  console.log(`Default model: ${runtime.defaultModel}`);
  console.log(`Budget: ${runtime.budget === Infinity ? 'Unlimited' : runtime.budget}`);
  console.log(`Request timeout: ${runtime.requestTimeout}ms`);
  console.log(`Tool timeout: ${runtime.defaultToolTimeout}ms`);

  // Update settings
  runtimeConfig.updateSettings({
    maxSteps: 20,
    defaultModel: 'gemini-1.5-pro',
  });

  console.log(`Updated max steps: ${runtimeConfig.getValue('maxSteps')}`);
}

// ============================================================================
// MODEL CONFIGURATION
// ============================================================================

/**
 * Work with model configuration
 */
export function modelConfigExample() {
  const modelConfig = getConfigService().getModelConfig();

  // Get available models
  const activeModels = modelConfig.getActiveModels();
  console.log(`Active models: ${activeModels.map(m => m.name).join(', ')}`);

  // Get text models
  const textModels = modelConfig.getModelsByType('text');
  console.log(`Text models: ${textModels.map(m => m.name).join(', ')}`);

  // Get image models
  const imageModels = modelConfig.getModelsByType('image');
  console.log(`Image models: ${imageModels.map(m => m.name).join(', ')}`);

  // Calculate cost
  const modelName = 'gemini-1.5-pro';
  const cost = modelConfig.calculateCost(modelName, 1000, 500);
  console.log(`Cost for ${modelName} (1000 input, 500 output tokens): $${cost.toFixed(6)}`);

  // Get specific model
  const model = modelConfig.getModel('claude-3.5-sonnet');
  if (model) {
    console.log(`\nModel: ${model.name}`);
    console.log(`Provider: ${model.provider}`);
    console.log(`Type: ${model.type}`);
    console.log(`Context window: ${model.contextWindow} tokens`);
    console.log(`Supports vision: ${model.supportsVision}`);
    console.log(`Supports tool use: ${model.supportsToolUse}`);
  }

  // Register custom model (if needed)
  modelConfig.registerModel({
    name: 'custom-model',
    provider: 'anthropic',
    type: 'text',
    pricing: {
      promptTokens: 0.01,
      completionTokens: 0.02,
    },
    maxTokens: 4096,
    contextWindow: 100000,
    supportsVision: false,
    supportsToolUse: true,
    supportsFunctionCalling: true,
    isActive: true,
    description: 'Custom model for testing',
  });

  console.log(`\nRegistered custom-model`);
}

// ============================================================================
// TOOL CONFIGURATION
// ============================================================================

/**
 * Work with tool configuration
 */
export function toolConfigExample() {
  const toolConfig = getConfigService().getToolConfig();

  // Get enabled tools
  const enabledTools = toolConfig.getEnabledTools();
  console.log(`Enabled tools: ${enabledTools.join(', ')}`);

  // Get timeouts
  console.log(`\nTool timeouts:`);
  console.log(`  Default: ${toolConfig.getTimeout('default')}ms`);
  console.log(`  Bash: ${toolConfig.getTimeout('bash')}ms`);
  console.log(`  File ops: ${toolConfig.getTimeout('fileOperations')}ms`);
  console.log(`  Grep: ${toolConfig.getTimeout('grep')}ms`);

  // Check if tool is enabled
  if (toolConfig.isToolEnabled('bash')) {
    console.log(`\nBash tool is enabled`);
  }

  // Update timeout
  toolConfig.setTimeout('bash', 60000);
  console.log(`Updated bash timeout to: ${toolConfig.getTimeout('bash')}ms`);

  // Disable tool
  toolConfig.disableTool('grep');
  console.log(`Disabled grep tool`);

  // Enable tool
  toolConfig.enableTool('grep');
  console.log(`Enabled grep tool`);

  // Get summary
  const summary = toolConfig.getSummary();
  console.log(`\nTool config summary:`, summary);
}

// ============================================================================
// WORKSPACE CONFIGURATION
// ============================================================================

/**
 * Work with workspace configuration
 */
export function workspaceConfigExample() {
  const workspaceConfig = getConfigService().getWorkspaceConfig();
  const workspace = workspaceConfig.getConfig();

  console.log(`Workspace name: ${workspace.name}`);
  console.log(`Root path: ${workspace.rootPath}`);
  console.log(`Logs path: ${workspaceConfig.getLogsPath()}`);
  console.log(`Cache path: ${workspaceConfig.getCachePath()}`);
  console.log(`Temp path: ${workspaceConfig.getTempPath()}`);

  // Full path resolution
  const fullPath = workspaceConfig.getFullPath('src/config');
  console.log(`\nFull path of "src/config": ${fullPath}`);

  // Path security checks
  const testPath = '/etc/passwd';
  const isAllowed = workspaceConfig.isPathAllowed(testPath);
  console.log(`\nIs "${testPath}" allowed: ${isAllowed}`);

  const allowedPath = workspaceConfig.getFullPath('src');
  const isAllowed2 = workspaceConfig.isPathAllowed(allowedPath);
  console.log(`Is workspace path allowed: ${isAllowed2}`);

  // Add/remove paths
  workspaceConfig.addAllowedPath('/tmp/myapp');
  console.log(`Added allowed path: /tmp/myapp`);

  console.log(`\nAllowed paths:`, workspace.allowedPaths);

  // Get summary
  const summary = workspaceConfig.getSummary();
  console.log(`\nWorkspace config summary:`, summary);
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate configuration
 */
export function validationExample() {
  const service = getConfigService();

  // Validate all
  const allErrors = service.validateAll();
  console.log(`Total validation errors: ${allErrors.length}`);

  // Validate specific section
  const envErrors = service.validateSection('env');
  console.log(`Environment config errors: ${envErrors.length}`);

  if (envErrors.length > 0) {
    console.log('\nEnvironment errors:');
    for (const error of envErrors) {
      console.log(`  - ${error.field}: ${error.error}`);
    }
  }

  // Check validity
  if (service.isValid()) {
    console.log('\n✅ Configuration is valid');
  } else {
    console.log('\n❌ Configuration has errors');
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Use configuration utilities
 */
export function utilitiesExample() {
  // Load and validate
  const isValid = loadAndValidateConfig(false); // false = non-strict mode
  console.log(`Configuration valid: ${isValid}`);

  // Print report
  console.log('\n--- Configuration Report ---');
  printConfigReport(false); // false = exclude sensitive data

  // Get summary
  const summary = getConfigService().export(false);
  console.log('\n--- Configuration Summary ---');
  console.log(JSON.stringify(summary, null, 2));
}

// ============================================================================
// CUSTOM INITIALIZATION
// ============================================================================

/**
 * Initialize config with custom overrides
 */
export function customInitExample() {
  const configService = initializeConfigService(
    {
      // Runtime overrides
      maxSteps: 15,
      defaultModel: 'gemini-1.5-pro',
      budget: 100,
    },
    '/path/to/workspace',
    {
      // Workspace overrides
      name: 'my-workspace',
      description: 'My custom workspace',
    }
  );

  console.log(`Custom config initialized`);
  console.log(`Max steps: ${configService.getRuntimeConfig().getConfig().maxSteps}`);
  console.log(`Workspace: ${configService.getWorkspaceConfig().getConfig().name}`);
}

// ============================================================================
// MAIN EXAMPLE
// ============================================================================

export function runAllExamples() {
  console.log('='.repeat(60));
  console.log('Configuration System Examples');
  console.log('='.repeat(60));

  console.log('\n1. BASIC USAGE');
  console.log('-'.repeat(60));
  basicExample();

  console.log('\n2. ENVIRONMENT CONFIG');
  console.log('-'.repeat(60));
  envConfigExample();

  console.log('\n3. RUNTIME CONFIG');
  console.log('-'.repeat(60));
  runtimeConfigExample();

  console.log('\n4. MODEL CONFIG');
  console.log('-'.repeat(60));
  modelConfigExample();

  console.log('\n5. TOOL CONFIG');
  console.log('-'.repeat(60));
  toolConfigExample();

  console.log('\n6. WORKSPACE CONFIG');
  console.log('-'.repeat(60));
  workspaceConfigExample();

  console.log('\n7. VALIDATION');
  console.log('-'.repeat(60));
  validationExample();

  console.log('\n8. UTILITIES');
  console.log('-'.repeat(60));
  utilitiesExample();

  console.log('\n' + '='.repeat(60));
  console.log('Examples completed');
  console.log('='.repeat(60));
}
