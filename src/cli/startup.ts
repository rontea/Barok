import { fileURLToPath } from 'url';
import { dirname } from 'path';
import * as readline from 'readline';
import { stdin, stdout } from 'process';

/**
 * The absolute path to the current module file (cli module directory).
 * @type {string}
 */
export const __filename = fileURLToPath(import.meta.url);

/**
 * The absolute path to the directory containing the current module.
 * @type {string}
 */
export const __dirname = dirname(__filename);

/**
 * The readline interface for interactive prompts.
 * Provides stdin input and stdout output for CLI interactions.
 * @type {readline.Interface}
 */
export const rl = readline.createInterface({ input: stdin, output: stdout });

/**
 * Prompts the user for input via CLI and returns their answer.
 * @param {string} query - The prompt text to display to the user
 * @returns {Promise<string>} A promise that resolves with the user's input
 * @example
 * const apiKey = await question('Enter your API key: ');
 */
export function question(query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, (answer) => resolve(answer));
  });
}

/**
 * Prompts the user for a yes/no question via CLI.
 * Accepts 'y', 'Y', or any string starting with 'y' as yes. All other inputs are treated as no.
 * The prompt will display "(y/N): " to the user.
 * @param {string} query - The yes/no question to ask the user
 * @returns {Promise<boolean>} A promise that resolves to true if user answers yes, false otherwise
 * @example
 * const proceed = await questionYN('Continue anyway?');
 * if (proceed) {
 *   // continue
 * }
 */
export function questionYN(query: string): Promise<boolean> {
  return new Promise((resolve) => {
    rl.question(query + ' (y/N): ', (answer) => {
      resolve(answer.toLowerCase().startsWith('y'));
    });
  });
}
