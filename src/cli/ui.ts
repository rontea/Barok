import chalk from 'chalk';

/**
 * Displays the CLI banner with application title and information.
 * Shows "Raw ReAct MCP — AI Agent Framework" with decorative borders.
 * @returns {void}
 */
export function logBanner() {
  console.log(
    chalk.cyan(
      `
╔══════════════════════════════════════════════════════════════╗
║              Raw ReAct MCP — AI Agent Framework              ║
║  ReAct Loop • Pollinations AI • Full Tool Access • MCP Ready ║
╚══════════════════════════════════════════════════════════════╝
`
    )
  );
}

/**
 * Logs a success message with a green checkmark emoji.
 * @param {string} message - The success message to display
 * @returns {void}
 * @example
 * logSuccess('API key saved to .env file');
 */
export function logSuccess(message: string) {
  console.log(chalk.green(`✅ ${message}`));
}

/**
 * Logs an error message with a red X emoji.
 * @param {string} message - The error message to display
 * @returns {void}
 * @example
 * logError('API key cannot be empty');
 */
export function logError(message: string) {
  console.log(chalk.red(`❌ ${message}`));
}

/**
 * Logs a warning message with a yellow warning emoji.
 * @param {string} message - The warning message to display
 * @returns {void}
 * @example
 * logWarning('Low balance — add more at https://enter.pollinations.ai');
 */
export function logWarning(message: string) {
  console.log(chalk.yellow(`⚠️  ${message}`));
}

/**
 * Logs an informational message with a blue info emoji.
 * @param {string} message - The info message to display
 * @returns {void}
 * @example
 * logInfo('Check internet and verify your API key');
 */
export function logInfo(message: string) {
  console.log(chalk.blue(`ℹ️  ${message}`));
}
