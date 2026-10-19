import { GoogleGenAI } from '@google/genai';
import { redactProviderSecrets } from '../di/providers/providerErrors.js';
import { getCachedGeminiAccountProfiles } from '../config/geminiProfiles.js';

interface DiagnosticResult {
  provider: string;
  status: 'working' | 'error' | 'warning';
  details: string;
  errorCode?: string;
  errorMessage?: string;
  timestamp: string;
}

async function testGeminiKey(apiKey: string, keyIndex: number, isPrimary: boolean): Promise<DiagnosticResult> {
  const keyLabel = isPrimary ? `Primary Key (Index 0)` : `Pool Key ${keyIndex}`;
  const timestamp = new Date().toISOString();

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });

    // Test basic API call
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: "Respond with exactly the word SUCCESS",
    });

    const text = response.text?.trim() || '';
    
    if (text.toUpperCase().includes('SUCCESS')) {
      return {
        provider: `Gemini API - ${keyLabel}`,
        status: 'working',
        details: `✅ Successfully validated with gemini-3.5-flash model. Response: "${text}"`,
        timestamp
      };
    } else {
      return {
        provider: `Gemini API - ${keyLabel}`,
        status: 'warning',
        details: `⚠️ Unexpected response from API: "${text}"`,
        timestamp
      };
    }
  } catch (error: any) {
    const errorCode = error?.error?.error?.code || error?.code || 'UNKNOWN';
    const errorMessage = redactProviderSecrets(error?.error?.error?.message || error?.message || String(error));
    
    // Categorize error
    let status: 'error' | 'warning' = 'error';
    let details = '';

    if (errorCode === 403 || errorMessage?.includes('PERMISSION_DENIED') || errorMessage?.includes('blocked')) {
      status = 'error';
      details = `❌ API Key Blocked (403): The API key may be restricted or the API is not enabled in Google Cloud Console.\n   Key: [REDACTED]\n   Error: ${errorMessage?.substring(0, 100)}`;
    } else if (errorCode === 401 || errorMessage?.includes('UNAUTHENTICATED')) {
      status = 'error';
      details = `❌ Authentication Failed (401): Invalid API key.\n   Key: [REDACTED]\n   Please verify the key is correct.`;
    } else if (errorCode === 429 || errorMessage?.includes('RESOURCE_EXHAUSTED')) {
      status = 'warning';
      details = `⚠️ Rate Limit Exceeded (429): Too many requests. Please wait before retrying.\n   This key may need a cooldown period.`;
    } else if (errorMessage?.includes('quota') || errorMessage?.includes('QUOTA_EXCEEDED')) {
      status = 'error';
      details = `❌ Quota Exceeded: This project has exceeded its API quota.\n   Check Google Cloud Console → API & Services → Quotas`;
    } else {
      status = 'error';
      details = `❌ API Error: ${errorMessage?.substring(0, 150)}`;
    }

    return {
      provider: `Gemini API - ${keyLabel}`,
      status,
      details,
      errorCode,
      errorMessage,
      timestamp
    };
  }
}

async function testPollinationsAPI(): Promise<DiagnosticResult> {
  const apiKey = process.env.POLLINATIONS_API_KEY;
  const timestamp = new Date().toISOString();

  if (!apiKey) {
    return {
      provider: 'Pollinations API',
      status: 'warning',
      details: `⚠️ No API key configured. Running in free/anonymous mode.\n   Set POLLINATIONS_API_KEY environment variable for authenticated requests.`,
      timestamp
    };
  }

  try {
    // Test balance endpoint
    const balanceUrls = [
      'https://enter.pollinations.ai/api/customer/balance',
      'https://gen.pollinations.ai/account/balance'
    ];

    let lastError = null;
    for (const url of balanceUrls) {
      try {
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          signal: AbortSignal.timeout(5000)
        });

        if (response.ok) {
          const data = await response.json() as any;
          const balance = data.balance || data.pollen || data.tierBalance || 0;
          
          if (balance > 0.02) {
            return {
              provider: 'Pollinations API',
              status: 'working',
              details: `✅ Authentication successful. Balance: ${balance} pollen`,
              timestamp
            };
          } else {
            return {
              provider: 'Pollinations API',
              status: 'warning',
              details: `⚠️ Low balance warning. Current balance: ${balance} pollen. Minimum recommended: 0.02 pollen`,
              timestamp
            };
          }
        }

        if (response.status === 402) {
          return {
            provider: 'Pollinations API',
            status: 'warning',
            details: `⚠️ Insufficient Balance (402): Your balance is too low for API requests.\n   Current balance is less than required. Add credits at https://enter.pollinations.ai/billing`,
            errorCode: '402',
            timestamp
          };
        }

        if (response.status === 401) {
          lastError = 'Authentication failed';
          continue;
        }

        if (response.ok) break;
      } catch (e) {
        lastError = e;
        continue;
      }
    }

    if (lastError) {
      return {
        provider: 'Pollinations API',
        status: 'error',
        details: `❌ Authentication Failed: Invalid API key or authentication error.\n   Key: [REDACTED]\n   Verify key is correct at https://enter.pollinations.ai`,
        errorCode: '401',
        timestamp
      };
    }

    return {
      provider: 'Pollinations API',
      status: 'error',
      details: `❌ API Error: Unable to connect to Pollinations service. Check service status.`,
      timestamp
    };
  } catch (error: any) {
    return {
      provider: 'Pollinations API',
      status: 'error',
      details: `❌ Connection Error: ${error?.message || String(error)}\n   Check that Pollinations service is reachable.`,
      errorMessage: redactProviderSecrets(error?.message),
      timestamp
    };
  }
}

export async function runDiagnostics(): Promise<DiagnosticResult[]> {
  console.log('\n' + '='.repeat(70));
  console.log('🔍 API DIAGNOSTIC SCAN - ' + new Date().toLocaleString());
  console.log('='.repeat(70) + '\n');

  const results: DiagnosticResult[] = [];

  // Test isolated Gemini account profiles without printing credential fragments.
  const geminiProfiles = getCachedGeminiAccountProfiles();

  if (geminiProfiles.length === 0) {
    console.log('⚠️  No Gemini account profiles configured');
  } else {
    console.log('🧪 Testing isolated Gemini account profiles...\n');
    for (let index = 0; index < geminiProfiles.length; index++) {
      const profile = geminiProfiles[index];
      console.log(`[${index + 1}/${geminiProfiles.length}] Testing ${profile.label}...`);
      const result = await testGeminiKey(profile.apiKey, index, index === 0);
      result.provider = `Gemini API - ${profile.label}`;
      results.push(result);
      console.log(`     ${result.details}\n`);
    }
  }

  // Test Pollinations
  console.log('🧪 Testing Pollinations API...\n');
  const pollinationResult = await testPollinationsAPI();
  results.push(pollinationResult);
  console.log(`   ${pollinationResult.details}\n`);

  // Summary
  console.log('='.repeat(70));
  console.log('📊 SUMMARY\n');
  
  const working = results.filter(r => r.status === 'working').length;
  const warnings = results.filter(r => r.status === 'warning').length;
  const errors = results.filter(r => r.status === 'error').length;

  console.log(`Working:   ${working}/${results.length} ✅`);
  console.log(`Warnings:  ${warnings}/${results.length} ⚠️`);
  console.log(`Errors:    ${errors}/${results.length} ❌\n`);

  if (errors > 0) {
    console.log('🔧 RECOMMENDED FIXES:\n');
    results.forEach(result => {
      if (result.status === 'error' && result.errorCode === '403') {
        console.log('1. Gemini API Blocked:');
        console.log('   - Visit Google Cloud Console');
        console.log('   - Enable "Generative Language API"');
        console.log('   - Check API key restrictions\n');
      }
      if (result.status === 'error' && result.errorCode === '401') {
        console.log('2. Authentication Failed:');
        console.log('   - Verify API key is correct');
        console.log('   - Check for typos in .env file');
        console.log('   - Generate a new key if needed\n');
      }
      if (result.status === 'warning' && result.errorCode === '402') {
        console.log('3. Insufficient Balance:');
        console.log('   - Add credits to Pollinations account');
        console.log('   - Visit https://enter.pollinations.ai/billing\n');
      }
    });
  }

  console.log('='.repeat(70) + '\n');
  return results;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runDiagnostics().catch(console.error);
}
