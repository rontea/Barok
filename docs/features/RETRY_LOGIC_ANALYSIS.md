# Retry Logic Analysis - react-engine-077

> Historical snapshot: the private `generateGeminiWithRetry()` helper described
> below was removed on 2026-10-09 after a repository-wide search found no
> callers. Current ReAct model requests use the injected `LLMProvider`; keep the
> Gemini section below for historical context only.

## Executive Summary

The codebase implements retry logic in **3 main locations** with **2 distinct backoff strategies** and **duplicate patterns** that could be consolidated.

---

## 1. Retry Implementations

### 1.1 Gemini LLM Retry Logic
**File:** [src/react/engine.ts](src/react/engine.ts#L394)  
**Method:** `generateGeminiWithRetry()`  
**Lines:** 394-489

#### Configuration
- **Max Retries:** `10` (default, configurable parameter)
- **Retryable Models:** `['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash']`

#### Backoff Strategy
**Primary Strategy: Model Rotation (with stagger delay)**
- For models in the `modelBypassList`:
  - Rotates to next model in list on rate limit/overload
  - **Stagger delay:** `1000-1500ms` (1 + random * 0.5 seconds)
  - No exponential backoff when rotating
  - Prevents exhausting retries during service outages

**Fallback Strategy: Exponential Backoff (for non-rotatable models)**
- **Formula:** `2.2^attempt * 1000 + random(0-1000)ms`
- **Example timings:**
  - Attempt 1: 2200-3200ms
  - Attempt 2: 4840-5840ms
  - Attempt 3: 10648-11648ms
  - Attempt 10: ~2.35 hours (exponential explosion)

**Header-Based Retry-After Parsing**
- Extracts `retry in Xs` from error messages
- Parsed delay format: `(parsedSeconds + 1.5) * 1000ms`
- Example: "retry in 30s" → waits 31500ms

#### Error Classification

**Permanent (Fast-Fail) Errors:**
- `exceeded your current quota`
- `plan and billing`
- `billing details`
- `insufficient_quota`
- `quota_exceeded`
- `resource_exhausted`
- `429` + `quota` (combined pattern)

**Retryable Errors:**
- HTTP: `429, 503, 500`
- Keywords: `quota, rate limit, unavailable, temporary, overloaded, demand`

#### Code Structure
```typescript
while (attempt < maxRetries) {
  try {
    // Attempt API call
    return response.text;
  } catch (error) {
    if (isPermanentQuotaError) {
      throw error; // Fast fail
    }
    if (isRetryableError && attempt < maxRetries) {
      if (canRotate) {
        // Model rotation strategy
        rotateDelayMs = 1000 + Math.random() * 500;
        currentModel = nextModel;
        continue;
      }
      // Exponential backoff
      delayMs = Math.pow(2.2, attempt) * 1000 + Math.random() * 1000;
      await sleep(delayMs);
    } else {
      throw error;
    }
  }
}
```

---

### 1.2 Pollinations API Retry Logic
**File:** [src/react/engine.ts](src/react/engine.ts#L495)  
**Method:** `generatePollinationsWithRetry()`  
**Lines:** 495-569

#### Configuration
- **Max Retries:** `4` per model
- **Backup Models:** `[primaryModel, 'openai', 'mistral', 'llama', 'qwen-coder']`
- **Auth Schedules:** Tries authenticated first, falls back to public
- **Model Loop Structure:**
  - Outer: `authSchedules` (authenticated, then public)
  - Middle: `uniqueModels` (primary + 4 backups)
  - Inner: `4 attempts` per model

Total possible attempts: 2 auth paths × 5 models × 4 attempts = **40 maximum requests**

#### Backoff Strategy
**Strategy: Exponential Backoff with Rate-Limit Awareness**
- **Base backoff (rate-limited 429):** `3000ms`
- **Base backoff (other errors):** `500ms`
- **Formula:** `baseBackoff * 1.5^attempt + random(0-500)ms`

**Example timings (rate-limited):**
- Attempt 1: 3000-3500ms
- Attempt 2: 4500-5000ms
- Attempt 3: 6750-7250ms
- Attempt 4: 10125-10625ms

#### Error Classification

**Fast-Fail (Auth Issues):**
- HTTP `402` (payment required)
- `balance` (insufficient balance)
- `payment_required`
- HTTP `401` (unauthorized)
- Action: Stop trying authenticated models, skip to public

**Unrecoverable (Server-Side):**
- HTTP: `502, 503, 504`
- Keywords: `gateway, timeout, unavailable`
- HTTP `404` (not found)
- Action: Skip to next model (break attempt loop)

**Retryable:** All other errors

#### Code Structure
```typescript
for (const isAuth of authSchedules) {  // 2 passes: [true, false]
  for (const currentModel of uniqueModels) {  // 5 models
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        return res.content;
      } catch (error) {
        if (isPaymentError) {
          stopAuth = true;
          break;  // Skip remaining auth models
        }
        if (isServerError || error.includes('404')) {
          break;  // Skip to next model
        }
        if (attempt < 4) {
          const baseBackoff = isRateLimit ? 3000 : 500;
          const backoff = baseBackoff * Math.pow(1.5, attempt) + Math.random() * 500;
          await sleep(backoff);
        }
      }
    }
  }
}
```

---

### 1.3 Crew Agent Orchestration & Synthesis Retry
**File:** [src/agents/crew.ts](src/agents/crew.ts#L240)  
**Methods:** `orchestrate()` and task synthesis  
**Lines:** 240-310

#### Configuration
- **Max Retries:** `5` for both orchestration and synthesis
- **Same strategy applied to both operations**

#### Backoff Strategy
**Strategy: Exponential Backoff (No Rate-Limit Awareness)**
- **Formula:** `2000 * 1.5^i ms` (where i is 0-indexed)
- **No random jitter**

**Example timings:**
- Attempt 0: 2000ms
- Attempt 1: 3000ms
- Attempt 2: 4500ms
- Attempt 3: 6750ms
- Attempt 4: 10125ms

#### Error Classification
- **All errors caught trigger retry** (generic catch-all)
- No distinction between retryable and permanent errors
- No fast-fail logic

#### Code Structure
```typescript
let retries = 5;
for (let i = 0; i < retries; i++) {
  try {
    res = await this.llm.chatCompletion({...});
    break;  // Success
  } catch (e: any) {
    if (i === retries - 1) throw e;
    const backoff = 2000 * Math.pow(1.5, i);
    console.log(`⚠️ Orchestrate failed, retrying in ${backoff}ms...`);
    await new Promise(r => setTimeout(r, backoff));
  }
}
```

---

## 2. Backoff Strategy Comparison

| Strategy | Location | Formula | Max Delay | Jitter | Rate-Limit Aware | Model Rotation |
|----------|----------|---------|-----------|--------|------------------|-----------------|
| **Gemini (Exponential)** | engine.ts L467 | `2.2^x * 1000 + rand(0-1000)` | ~2.35h (attempt 10) | Yes ±1000ms | Yes (parsed from headers) | Yes (5 models) |
| **Gemini (Stagger)** | engine.ts L460 | `1000 + rand(0-500)` | 1500ms | Yes ±500ms | No | Yes (model rotation) |
| **Pollinations** | engine.ts L560 | `base * 1.5^x + rand(0-500)` | ~10.6s (attempt 4) | Yes ±500ms | Yes (3s vs 0.5s base) | Yes (5 models) |
| **Crew** | crew.ts L253 | `2000 * 1.5^i` | ~10.1s (attempt 4) | **No** | No | **No** |

---

## 3. Duplicate Retry Patterns

### Pattern Duplication Analysis

#### Pattern 1: Exponential Backoff Loop
**Duplicated in:**
- [src/react/engine.ts](src/react/engine.ts#L467) (Gemini fallback)
- [src/react/engine.ts](src/react/engine.ts#L560) (Pollinations)
- [src/agents/crew.ts](src/agents/crew.ts#L253) (Orchestration)

**Differences:**
- Exponent varies: `2.2` vs `1.5` vs `1.5`
- Base multiplier: `1000` vs `1.5` vs `2000`
- Jitter handling: random vs no random in crew

**Duplication Severity:** 🔴 **HIGH** - Same pattern, different constants

#### Pattern 2: Try-Catch-Retry Loop
**Duplicated in:**
- [src/react/engine.ts](src/react/engine.ts#L401) Gemini outer loop
- [src/react/engine.ts](src/react/engine.ts#L511) Pollinations nested loops
- [src/agents/crew.ts](src/agents/crew.ts#L248) Orchestration

**Differences:**
- Loop structures vary (while, for-of, for-in combinations)
- Error classification logic duplicated in each

**Duplication Severity:** 🟡 **MEDIUM** - Similar structure, different error handling

#### Pattern 3: Error Classification
**Duplicated in:**
- [src/react/engine.ts](src/react/engine.ts#L419-435) Gemini error checks
- [src/react/engine.ts](src/react/engine.ts#L528-555) Pollinations error checks

**Errors classified:**
- `429` (rate limit)
- `500, 502, 503, 504` (server errors)
- Permanent quota errors

**Duplication Severity:** 🔴 **HIGH** - Identical error patterns, verbatim strings

---

## 4. Missing Error Handling Patterns

### Issues Found

1. **No Connection/Network Errors Handling**
   - No explicit handling for `ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`
   - Network errors will be caught as generic retryable

2. **No Circuit Breaker Pattern**
   - No tracking of repeated failures per service
   - Will keep retrying even if service is clearly down

3. **No Retry Budgeting**
   - Crew agent: hardcoded 5 retries for ALL failures
   - No weighted retry strategy based on error type

4. **Inconsistent Timeout Integration**
   - [src/tools/executionTimeout.ts](src/tools/executionTimeout.ts) provides timeout protection
   - **NOT integrated with retry logic**
   - A timeout expiration won't trigger retries

5. **No Observability**
   - Retry attempts logged but not structured
   - No metrics/counters for retry success rates

---

## 5. Code Consolidation Recommendations

### High Priority: Extract Retry Utility

**Opportunity:** Create a reusable retry function to eliminate duplication

```typescript
// src/utils/retryWithBackoff.ts
interface RetryConfig {
  maxAttempts: number;
  backoffStrategy: 'exponential' | 'linear' | 'fixed';
  baseDelayMs: number;
  exponent?: number;
  jitter?: boolean;
  errorClassifier: (error: any) => 'retryable' | 'permanent' | 'unrecoverable';
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  onRetry?: (attempt: number, error: any, nextDelayMs: number) => void
): Promise<T> {
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === config.maxAttempts) throw error;
      
      const classification = config.errorClassifier(error);
      if (classification === 'permanent') throw error;
      if (classification === 'unrecoverable') throw error;
      
      const delayMs = calculateBackoff(attempt, config);
      onRetry?.(attempt, error, delayMs);
      await sleep(delayMs);
    }
  }
}
```

### Medium Priority: Unified Error Classification

**Opportunity:** Create centralized error classification module

```typescript
// src/utils/errorClassifier.ts
export interface ErrorClassification {
  type: 'retryable' | 'permanent' | 'unrecoverable';
  reason: string;
  isRateLimit?: boolean;
  suggestedDelay?: number;
}

export function classifyError(error: any): ErrorClassification {
  const msg = error.message?.toLowerCase() || '';
  
  // Shared logic for all APIs
  if (msg.includes('quota') && msg.includes('exceeded')) return { type: 'permanent', reason: 'quota_exceeded' };
  if (msg.includes('401') || msg.includes('403')) return { type: 'permanent', reason: 'auth_failed' };
  if (msg.includes('429')) return { type: 'retryable', reason: 'rate_limited', isRateLimit: true };
  if (msg.includes('50')) return { type: 'retryable', reason: 'server_error' };
  // ... etc
}
```

---

## 6. Summary Statistics

| Metric | Value |
|--------|-------|
| **Total Retry Implementations** | 3 |
| **Duplicate Patterns** | 3 (backoff, try-catch, error classification) |
| **Unique Backoff Strategies** | 2 (exponential, stagger) |
| **Error Types Handled** | ~15 distinct error patterns |
| **Max Retry Attempts** | 4-10 (varies by implementation) |
| **Maximum Total Requests** | ~40 (Pollinations: 2 × 5 × 4) |
| **Lines of Duplicate Code** | ~150-200 lines |

---

## 7. Detailed Error Handling Breakdown

### Error Type → Retryable Classification

| Error Pattern | Gemini | Pollinations | Crew | Category |
|---|---|---|---|---|
| 429 (Rate Limit) | ✅ Retryable | ✅ Retryable (3s base) | ❌ Retry all | Transient |
| 500, 502, 503, 504 | ✅ Retryable | ✅ Retryable (500ms base) | ❌ Retry all | Transient |
| 401, 402, 403 | ❌ Fail fast | ✅ Fail fast (402/401) | ❌ Retry all | Permanent |
| Quota exceeded | ❌ Fail fast | ✅ Fail fast (auth) | ❌ Retry all | Permanent |
| Connection errors | ❌ Retry | ❌ Retry | ❌ Retry all | Transient |
| Timeout | ❌ Not integrated | ❌ Not integrated | ❌ Not integrated | Transient |
| Invalid JSON | ❌ Not caught | ❌ Validation only | ❌ Retry all | Data error |

---

## Appendix: File Reference Map

```
src/react/engine.ts
├─ generateGeminiWithRetry (L394-489)
│  ├─ Max retries: 10
│  ├─ Strategy: Model rotation + exponential backoff
│  └─ Error classification: Permanent quota vs retryable
│
├─ generatePollinationsWithRetry (L495-569)
│  ├─ Max retries: 4 per model, 40 total
│  ├─ Strategy: Model rotation + exponential backoff
│  └─ Error classification: Auth fail vs server error vs retryable
│
└─ createChatCompletion (L571-754)
   ├─ Fallback chains to other models/APIs
   └─ Delegates to above retry methods

src/agents/crew.ts
├─ orchestrate (L240-274)
│  ├─ Max retries: 5
│  ├─ Strategy: Simple exponential backoff
│  └─ Error classification: Retry all
│
└─ synthesis loop (L295-310)
   ├─ Max retries: 5
   ├─ Strategy: Simple exponential backoff
   └─ Error classification: Retry all

src/tools/executionTimeout.ts
├─ executeWithTimeout (provides timeout protection)
└─ NOT integrated with retry logic
```
