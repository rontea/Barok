/**
 * Configuration utility functions
 */

import { getConfigService } from './configService.js';
import { ConfigValidationError } from './types.js';

/**
 * Load and validate configuration, exit on errors
 */
export function loadAndValidateConfig(strict = true): boolean {
  const service = getConfigService();
  const errors = service.validateAll();

  if (errors.length === 0) {
    console.log('✅ Configuration validated successfully');
    return true;
  }

  // Group errors by section
  const errorsBySection = new Map<string, ConfigValidationError[]>();
  for (const error of errors) {
    if (!errorsBySection.has(error.section)) {
      errorsBySection.set(error.section, []);
    }
    errorsBySection.get(error.section)!.push(error);
  }

  // Print errors
  console.error('❌ Configuration validation failed:\n');
  for (const section of Array.from(errorsBySection.keys())) {
    const sectionErrors = errorsBySection.get(section)!;
    console.error(`  [${section.toUpperCase()}]`);
    for (const error of sectionErrors) {
      console.error(`    • ${error.field}: ${error.error}`);
      if (error.value !== undefined) {
        console.error(`      Current value: ${JSON.stringify(error.value)}`);
      }
    }
    console.error('');
  }

  if (strict) {
    process.exit(1);
  }

  return false;
}

/**
 * Print configuration report
 */
export function printConfigReport(includeSensitive = false): void {
  const service = getConfigService();
  const config = service.getConfig();

  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║      CONFIGURATION REPORT                  ║');
  console.log('╚════════════════════════════════════════════╝\n');

  // Environment
  console.log('📋 ENVIRONMENT:');
  console.log(`   Log Level:       ${config.env.logLevel}`);
  console.log(`   Debug Mode:      ${config.env.debugMode}`);
  console.log(`   Verbose:         ${config.env.verbose}`);
  console.log(`   MCP Server:      ${config.env.mcpServerName} v${config.env.mcpVersion}`);
  if (includeSensitive) {
    console.log(`   API Keys:        Pollinations=${!!config.env.pollinationsApiKey}, Gemini=${!!config.env.geminiApiKey}`);
  }
  console.log('');

  // Runtime
  console.log('⚙️ RUNTIME:');
  console.log(`   Turn Checkpoint: ${config.runtime.maxSteps}`);
  console.log(`   Default Model:   ${config.runtime.defaultModel}`);
  console.log(`   Budget:          ${config.runtime.budget === Infinity ? 'Unlimited' : config.runtime.budget}`);
  console.log(`   Request Timeout: ${config.runtime.requestTimeout}ms`);
  console.log(`   Tool Timeout:    ${config.runtime.defaultToolTimeout}ms`);
  console.log(`   Crew Agents:     ${config.runtime.crewAgentCount}`);
  console.log(`   Max Retries:     ${config.runtime.maxRetries}`);
  console.log('');

  // Models
  console.log('🤖 MODELS:');
  const textModel = config.models.models.get(config.models.defaultTextModel);
  const imageModel = config.models.models.get(config.models.defaultImageModel);
  console.log(`   Default Text:    ${textModel?.name || 'Unknown'}`);
  console.log(`   Default Image:   ${imageModel?.name || 'Unknown'}`);
  const activeModels = Array.from(config.models.models.values()).filter(m => m.isActive);
  console.log(`   Active Models:   ${activeModels.length}`);
  console.log('');

  // Tools
  console.log('🛠️  TOOLS:');
  console.log(`   Enabled Tools:   ${Array.from(config.tools.enabledTools).join(', ')}`);
  console.log(`   Max Buffer:      ${formatBytes(config.tools.maxBufferSize)}`);
  console.log(`   Concurrent:      ${config.tools.maxConcurrentTools}`);
  console.log(`   Timeouts:`);
  for (const [tool, timeout] of Object.entries(config.tools.timeouts)) {
    console.log(`     - ${tool.padEnd(15)} ${timeout}ms`);
  }
  console.log('');

  // Workspace
  console.log('📁 WORKSPACE:');
  console.log(`   Name:            ${config.workspace.name}`);
  console.log(`   Root:            ${config.workspace.rootPath}`);
  console.log(`   Logs:            ${config.workspace.logsPath}`);
  console.log(`   Allowed Paths:   ${config.workspace.allowedPaths.length}`);
  console.log(`   Path Validation: ${config.workspace.enforcePathValidation ? 'Enabled' : 'Disabled'}`);
  console.log(`   Max File Size:   ${formatBytes(config.workspace.maxFileSize)}`);
  console.log('');

  // Validation
  const errors = service.validateAll();
  if (errors.length === 0) {
    console.log('✅ Configuration is valid');
  } else {
    console.log(`⚠️  ${errors.length} validation error(s) found`);
  }
  console.log('');
}

/**
 * Format bytes to human readable format
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Get configuration summary as string
 */
export function getConfigSummary(): string {
  const service = getConfigService();
  const summary = service.export(false);
  return JSON.stringify(summary, null, 2);
}

/**
 * Check if all critical configs are set
 */
export function hasCriticalConfigs(): boolean {
  const service = getConfigService();
  const errors = service.validateAll();

  // Check for critical errors (not warnings)
  const criticalErrors = errors.filter(
    e =>
      (e.section === 'env' && e.field === 'pollinationsApiKey') ||
      (e.section === 'workspace' && e.field === 'rootPath')
  );

  return criticalErrors.length === 0;
}
