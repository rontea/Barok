import * as fs from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { pollinationsClient } from '../pollinations/client.js';
import { formatAuthError } from '../utils/errorFormatter.js';
import { logError, logSuccess, logWarning } from './ui.js';
import { question, rl } from './startup.js';
import { validateApiKey } from '../validation/stringValidators.js';

/**
 * Ensures a valid Pollinations API key is available.
 * 
 * Checks for POLLINATIONS_API_KEY in the environment. If not found, prompts the user
 * to enter one, validates the format (must start with 'pk_' or 'sk_'), and saves it
 * to the .env file.
 * 
 * Sets the API key on the pollinations client before returning.
 * 
 * @async
 * @returns {Promise<string>} The valid API key
 * @throws {Exit code 1} If the user provides no input or an invalid key format
 * @example
 * const apiKey = await ensureApiKey();
 */
export async function ensureApiKey(): Promise<string> {
  let apiKey = process.env.POLLINATIONS_API_KEY;

  if (!apiKey) {
    logError(formatAuthError('Pollinations', 'POLLINATIONS_API_KEY'));
    console.log(chalk.white('\n📝 Get your free API key at: https://enter.pollinations.ai'));
    console.log(chalk.gray('   Step 1: Sign up'));
    console.log(chalk.gray('   Step 2: Go to Dashboard → API Keys'));
    console.log(chalk.gray('   Step 3: Copy your key\n'));

    try {
      apiKey = await question(chalk.cyan('Enter your API key: '));
    } catch {
      logError('No input received');
      rl.close();
      process.exit(1);
    }

    apiKey = apiKey.trim();

    if (!apiKey) {
      logError('API key cannot be empty');
      rl.close();
      process.exit(1);
    }

    const validation = validateApiKey(apiKey, 'Pollinations', true);
    if (!validation.valid) {
      logError(validation.error || 'Invalid API key');
      rl.close();
      process.exit(1);
    }

    apiKey = validation.key || apiKey;

    // Save to .env
    const envPath = join(process.cwd(), '.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8');
      if (envContent.includes('POLLINATIONS_API_KEY=')) {
        envContent = envContent.replace(
          /POLLINATIONS_API_KEY=.*/g,
          `POLLINATIONS_API_KEY=${apiKey}`
        );
      } else {
        envContent += `\nPOLLINATIONS_API_KEY=${apiKey}\n`;
      }
    } else {
      envContent = `POLLINATIONS_API_KEY=${apiKey}\n`;
    }
    fs.writeFileSync(envPath, envContent);
    logSuccess('API key saved to .env file\n');
  }

  pollinationsClient.setApiKey(apiKey);
  return apiKey;
}

/**
 * Checks the health and connectivity of the Pollinations API.
 * 
 * Makes a test API request and attempts to fetch the account balance.
 * Distinguishes between different error types (auth errors, insufficient balance, etc.)
 * to provide specific diagnostic information.
 * 
 * @async
 * @param {boolean} [verbose=false] - If true, logs success messages. If false, silent on success.
 * @returns {Promise<Object>} Health status object
 * @returns {boolean} .ok - True if API is reachable and authentication is valid
 * @returns {number|null} .balance - Account balance in pollen, or null if unavailable/unknown
 * @returns {boolean} .hasScope - True if balance info was successfully fetched (indicates account:usage scope)
 * @example
 * const health = await checkApiHealth(true);
 * if (health.ok && health.balance > 100) {
 *   console.log('Good to go!');
 * }
 */
export async function checkApiHealth(verbose = false): Promise<{
  ok: boolean;
  balance?: number | null;
  hasScope?: boolean;
}> {
  try {
    const test = await pollinationsClient.chatCompletion({
      messages: [{ role: 'user', content: 'test' }],
      model: 'openai',
    });

    if (verbose) logSuccess('API connectivity verified');

    try {
      const balance = await pollinationsClient.getBalance();
      return { ok: true, balance: balance?.pollen ?? null, hasScope: !!balance };
    } catch {
      return { ok: true, balance: null, hasScope: false };
    }
  } catch (error: any) {
    if (error.message.includes('402') || error.message.includes('Insufficient')) {
      return { ok: true, balance: 0, hasScope: false }; // key valid but zero balance
    }
    if (error.message.includes('401') || error.message.includes('403')) {
      return { ok: false, balance: null, hasScope: false };
    }
    return { ok: false, balance: null, hasScope: false };
  }
}
