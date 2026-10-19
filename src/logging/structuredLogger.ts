/**
 * Structured Logging System
 * 
 * Provides centralized, structured logging with:
 * - Request ID tracking
 * - Agent ID and Step ID
 * - Timestamps and execution duration
 * - Token usage metrics
 * - Cost tracking
 * - Log aggregation and querying
 */

import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { ReActEngineExecutionMetrics } from '@barok/engine';

/**
 * Log severity levels
 */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

/**
 * Log event types
 */
export enum EventType {
  REQUEST_START = 'request_start',
  REQUEST_END = 'request_end',
  AGENT_START = 'agent_start',
  AGENT_END = 'agent_end',
  STEP_START = 'step_start',
  STEP_END = 'step_end',
  API_CALL = 'api_call',
  TOOL_EXECUTION = 'tool_execution',
  ERROR = 'error',
  METRIC = 'metric',
}

/**
 * Metrics tracked for an execution unit
 */
export type ExecutionMetrics = ReActEngineExecutionMetrics;

/**
 * Core structured log entry
 */
export interface StructuredLogEntry {
  timestamp: string; // ISO 8601
  requestId: string;
  agentId?: string;
  stepId?: string;
  eventType: EventType;
  level: LogLevel;
  message: string;
  metadata?: Record<string, any>;
  metrics?: ExecutionMetrics;
  context?: Record<string, any>;
}

/**
 * Request context tracking
 */
export interface RequestContext {
  requestId: string;
  agentId?: string;
  currentStepId?: string;
  startTime: number;
  metadata?: Record<string, any>;
}

/**
 * Aggregated request report
 */
export interface RequestReport {
  requestId: string;
  agentId?: string;
  startTime: string;
  endTime: string;
  duration: number; // milliseconds
  success: boolean;
  stepCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  logs: StructuredLogEntry[];
  error?: string;
}

export interface LogPersistenceLimits {
  maxRecordBytes: number;
  maxFileBytes: number;
  maxFiles: number;
  maxAgeMs: number;
}

export const DEFAULT_LOG_PERSISTENCE_LIMITS: Readonly<LogPersistenceLimits> = Object.freeze({
  maxRecordBytes: 16 * 1024,
  maxFileBytes: 5 * 1024 * 1024,
  maxFiles: 50,
  maxAgeMs: 14 * 24 * 60 * 60 * 1000,
});

const MAX_LOG_TEXT_CHARS = 1_000;
const OMIT_LOG_VALUE_KEY = /(?:prompt|messages?|file.?contents?|source.?code|raw(?:response|output|input)|private.?key|api.?key|password|authorization)/i;
const REDACT_SECRET_TEXT = /\bBearer\s+[A-Za-z0-9._~+/-]{16,}|\b(?:sk|pk|nvapi|gsk|csk|rqsty-sk|rqsty|AIzaSy)[_-]?[A-Za-z0-9_-]{8,}|\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|secret)\s*[:=]\s*[^\s,;"']+/gi;
const ABSOLUTE_WINDOWS_PATH = /(?:\b[A-Za-z]:\\(?:[^\\\s"'<>|]+\\)*[^\\\s"'<>|]*|\\\\[^\\\s"'<>|]+\\(?:[^\\\s"'<>|]+\\)*[^\\\s"'<>|]*)/g;
const ABSOLUTE_UNIX_PATH = /(?<![:/\w])\/(?:[^/\s"'<>|]+\/)+[^/\s"'<>|]*/g;

function redactLogText(value: string): string {
  return value
    .replace(REDACT_SECRET_TEXT, '[REDACTED]')
    .replace(ABSOLUTE_WINDOWS_PATH, '[PATH]')
    .replace(ABSOLUTE_UNIX_PATH, '[PATH]');
}

function truncateLogText(value: string, maxChars = MAX_LOG_TEXT_CHARS): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 14))}…[truncated]`;
}

function summarizeTask(task: unknown): string | undefined {
  if (typeof task !== 'string' || !task.trim()) return undefined;
  const withoutCode = task.replace(/```[\s\S]*?```/g, ' [code omitted] ');
  let omitSection = false;
  const safeSections = withoutCode
    .split(/\r?\n/)
    .filter((line) => {
      if (/^\s*(?:system prompt|developer instructions|file contents?|source code|attached file|raw (?:logs?|output))\s*:/i.test(line)) {
        omitSection = true;
        return false;
      }
      if (!line.trim()) {
        omitSection = false;
        return true;
      }
      return !omitSection;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return truncateLogText(redactLogText(safeSections), 240);
}

function sanitizeLogValue(value: unknown, key = '', depth = 0, budget = { remaining: 256 }): unknown {
  if (OMIT_LOG_VALUE_KEY.test(key) || ['input', 'output', 'content', 'code', 'source'].includes(key.toLowerCase())) return '[OMITTED]';
  if (key.toLowerCase() === 'task') return summarizeTask(value) || '[OMITTED]';
  if (typeof value === 'string') return truncateLogText(redactLogText(value));
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  if (depth >= 5 || budget.remaining <= 0) return '[OMITTED: limit]';
  budget.remaining--;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeLogValue(item, key, depth + 1, budget));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 40).map(([childKey, childValue]) => [
      childKey,
      sanitizeLogValue(childValue, childKey, depth + 1, budget),
    ]));
  }
  return String(value);
}

function sanitizeRequestMetadata(metadata?: Record<string, any>): Record<string, any> | undefined {
  if (!metadata) return undefined;
  const safe: Record<string, any> = {};
  const taskSummary = summarizeTask(metadata.task);
  if (taskSummary) safe.taskSummary = taskSummary;
  for (const key of ['taskId', 'model', 'maxSteps', 'maxRetries', 'taskComplexity', 'budget']) {
    const value = metadata[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      safe[key] = sanitizeLogValue(value, key);
    }
  }
  return Object.keys(safe).length ? safe : undefined;
}

function serializedBoundedEntry(entry: StructuredLogEntry, maxBytes: number): string {
  const bounded: StructuredLogEntry = {
    ...entry,
    message: truncateLogText(redactLogText(entry.message), 512),
    context: sanitizeLogValue(entry.context) as Record<string, any> | undefined,
    metrics: entry.metrics ? {
      ...entry.metrics,
      error: entry.metrics.error ? truncateLogText(redactLogText(entry.metrics.error), 512) : undefined,
    } : undefined,
  };
  let serialized = JSON.stringify(bounded);
  if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) return serialized;

  bounded.context = { truncated: true };
  serialized = JSON.stringify(bounded);
  while (Buffer.byteLength(serialized, 'utf8') > maxBytes && bounded.message.length > 24) {
    bounded.message = truncateLogText(bounded.message, Math.floor(bounded.message.length / 2));
    serialized = JSON.stringify(bounded);
  }
  if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) return serialized;
  return JSON.stringify({
    timestamp: entry.timestamp,
    requestId: entry.requestId,
    eventType: entry.eventType,
    level: entry.level,
    message: 'Log record omitted: size limit',
  });
}

/**
 * Structured Logger - Centralized logging system
 */
export class StructuredLogger {
  private static instance: StructuredLogger;
  private requestContextStack: RequestContext[] = [];
  private logBuffer: StructuredLogEntry[] = [];
  private logHistory: StructuredLogEntry[] = [];
  private metricsBuffer: Map<string, ExecutionMetrics> = new Map();
  private logDir: string;
  private flushInterval: NodeJS.Timeout | null = null;
  private bufferSize = 100; // Flush after N logs
  private autoFlush = true;
  private readonly persistenceLimits: LogPersistenceLimits;
  private flushChain: Promise<void> = Promise.resolve();

  private constructor(logDir = './logs', limits: Partial<LogPersistenceLimits> = {}) {
    this.logDir = logDir;
    this.persistenceLimits = {
      ...DEFAULT_LOG_PERSISTENCE_LIMITS,
      ...limits,
      maxRecordBytes: Math.max(256, limits.maxRecordBytes ?? DEFAULT_LOG_PERSISTENCE_LIMITS.maxRecordBytes),
      maxFileBytes: Math.max(256, limits.maxFileBytes ?? DEFAULT_LOG_PERSISTENCE_LIMITS.maxFileBytes),
      maxFiles: Math.max(1, limits.maxFiles ?? DEFAULT_LOG_PERSISTENCE_LIMITS.maxFiles),
      maxAgeMs: Math.max(1, limits.maxAgeMs ?? DEFAULT_LOG_PERSISTENCE_LIMITS.maxAgeMs),
    };
    this.ensureLogDir();
  }

  /**
   * Get singleton instance
   */
  static getInstance(logDir?: string): StructuredLogger {
    if (!StructuredLogger.instance) {
      StructuredLogger.instance = new StructuredLogger(logDir);
    }
    return StructuredLogger.instance;
  }

  /**
   * Ensure log directory exists
   */
  private ensureLogDir(): void {
    // Directory creation happens asynchronously, but we'll handle it in write methods
  }

  /**
   * Start a new request context
   */
  startRequest(agentId?: string, metadata?: Record<string, any>): string {
    const requestId = uuidv4();
    const safeMetadata = sanitizeRequestMetadata(metadata);
    const context: RequestContext = {
      requestId,
      agentId,
      startTime: Date.now(),
      metadata: safeMetadata,
    };
    this.requestContextStack.push(context);

    this.log(EventType.REQUEST_START, `Request started`, LogLevel.INFO, {
      agentId,
      ...safeMetadata,
    });

    return requestId;
  }

  /**
   * End current request context
   */
  endRequest(success: boolean, error?: string): RequestContext | undefined {
    const context = this.requestContextStack.pop();
    if (!context) return undefined;

    const duration = Date.now() - context.startTime;

    this.log(EventType.REQUEST_END, `Request ended`, LogLevel.INFO, {
      success,
      error,
      duration,
    });

    // Track error for later retrieval
    if (!success && error) {
      this.metricsBuffer.set(`${context.requestId}_error`, {
        startTime: context.startTime,
        endTime: Date.now(),
        success: false,
        error,
      });
    }

    return context;
  }

  /**
   * Start an agent execution
   */
  startAgent(agentId: string, metadata?: Record<string, any>): void {
    const context = this.getCurrentContext();
    if (context) {
      context.agentId = agentId;
    }

    this.log(EventType.AGENT_START, `Agent started: ${agentId}`, LogLevel.INFO, {
      agentId,
      ...metadata,
    });
  }

  /**
   * End agent execution
   */
  endAgent(success: boolean, error?: string, metrics?: ExecutionMetrics): void {
    this.log(EventType.AGENT_END, `Agent ended`, LogLevel.INFO, {
      success,
      error,
    }, metrics);
  }

  /**
   * Start a step/action
   */
  startStep(stepId: string, action: string, input?: any): void {
    const context = this.getCurrentContext();
    if (context) {
      context.currentStepId = stepId;
    }

    this.log(EventType.STEP_START, `Step started: ${action}`, LogLevel.INFO, {
      stepId,
      action,
      input,
    });
  }

  /**
   * End step/action
   */
  endStep(observation?: string, metrics?: ExecutionMetrics): void {
    const context = this.getCurrentContext();
    const stepId = context?.currentStepId;

    this.log(EventType.STEP_END, `Step ended`, LogLevel.INFO, {
      stepId,
      observation: observation ? observation.substring(0, 500) : undefined,
    }, metrics);

    if (context) {
      context.currentStepId = undefined;
    }
  }

  /**
   * Log an API call
   */
  logApiCall(
    apiName: string,
    model?: string,
    inputTokens?: number,
    outputTokens?: number,
    cost?: number,
    duration?: number
  ): void {
    const metrics: ExecutionMetrics = {
      startTime: Date.now() - (duration || 0),
      endTime: Date.now(),
      duration,
      inputTokens,
      outputTokens,
      totalTokens: (inputTokens || 0) + (outputTokens || 0),
      cost,
    };

    this.log(EventType.API_CALL, `API call: ${apiName}`, LogLevel.INFO, {
      apiName,
      model,
    }, metrics);
  }

  /**
   * Log tool execution
   */
  logToolExecution(
    toolName: string,
    input?: any,
    output?: any,
    duration?: number,
    success = true,
    error?: string
  ): void {
    const metrics: ExecutionMetrics = {
      startTime: Date.now() - (duration || 0),
      endTime: Date.now(),
      duration,
      success,
      error,
    };

    this.log(EventType.TOOL_EXECUTION, `Tool executed: ${toolName}`, LogLevel.INFO, {
      toolName,
      input,
      output: output ? (typeof output === 'string' ? output.substring(0, 500) : JSON.stringify(output).substring(0, 500)) : undefined,
      success,
      error,
    }, metrics);
  }

  /**
   * Log an error
   */
  logError(message: string, error: Error | string, context?: Record<string, any>): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.log(EventType.ERROR, message, LogLevel.ERROR, {
      error: errorMessage,
      ...context,
    });
  }

  /**
   * Log a custom metric
   */
  logMetric(name: string, value: number, unit?: string, metadata?: Record<string, any>): void {
    this.log(EventType.METRIC, `Metric: ${name}`, LogLevel.INFO, {
      metricName: name,
      metricValue: value,
      unit,
      ...metadata,
    });
  }

  /**
   * Internal log method
   */
  private log(
    eventType: EventType,
    message: string,
    level: LogLevel = LogLevel.INFO,
    context?: Record<string, any>,
    metrics?: ExecutionMetrics
  ): void {
    const requestContext = this.getCurrentContext();
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      requestId: requestContext?.requestId || 'no-request',
      agentId: requestContext?.agentId,
      stepId: requestContext?.currentStepId,
      eventType,
      level,
      message: truncateLogText(redactLogText(message), 512),
      context: sanitizeLogValue(context) as Record<string, any> | undefined,
      metrics: metrics ? {
        ...metrics,
        error: metrics.error ? truncateLogText(redactLogText(metrics.error), 512) : undefined,
      } : undefined,
    };

    this.logBuffer.push(entry);
    this.logHistory.push(entry);
    if (this.logHistory.length > 10000) {
      this.logHistory = this.logHistory.slice(-10000);
    }
    // Step boundaries remain in structured JSON logs. The interactive engine
    // already renders them, so echoing routine STEP_END records only produces
    // confusing duplicate "Step ended" lines in the terminal.
    if (eventType !== EventType.STEP_END) {
      console.log(`[${entry.level}] [${entry.requestId}] ${message}`);
    }

    // Auto-flush if buffer is full
    if (this.autoFlush && this.logBuffer.length >= this.bufferSize) {
      this.flushAsync().catch(err => console.error('Failed to flush logs:', err));
    }
  }

  /**
   * Get current request context
   */
  private getCurrentContext(): RequestContext | undefined {
    return this.requestContextStack[this.requestContextStack.length - 1];
  }

  /**
   * Flush logs to disk
   */
  async flush(): Promise<void> {
    const pending = this.flushChain.then(() => this.flushBufferedLogs());
    this.flushChain = pending.catch((err) => console.error('Failed to flush logs:', err));
    await this.flushChain;
  }

  private async flushBufferedLogs(): Promise<void> {
    if (this.logBuffer.length === 0) return;

    try {
      await fs.mkdir(this.logDir, { recursive: true });

      const entries = this.logBuffer;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const fileEntries = new Map<string, { count: number; requestIds: Set<string> }>();
      let sequence = 0;
      for (const entry of entries) {
        const line = `${serializedBoundedEntry(entry, Math.min(this.persistenceLimits.maxRecordBytes, this.persistenceLimits.maxFileBytes - 1))}\n`;
        let filename = sequence === 0 ? `logs_${timestamp}.jsonl` : `logs_${timestamp}_${String(sequence).padStart(3, '0')}.jsonl`;
        let filepath = path.join(this.logDir, filename);
        let currentSize = 0;
        try {
          currentSize = (await fs.stat(filepath)).size;
        } catch {
          // The first file in this rotation does not exist yet.
        }
        while (currentSize > 0 && currentSize + Buffer.byteLength(line, 'utf8') > this.persistenceLimits.maxFileBytes) {
          sequence++;
          filename = `logs_${timestamp}_${String(sequence).padStart(3, '0')}.jsonl`;
          filepath = path.join(this.logDir, filename);
          try {
            currentSize = (await fs.stat(filepath)).size;
          } catch {
            currentSize = 0;
          }
        }
        await fs.appendFile(filepath, line, 'utf8');
        const summary = fileEntries.get(filename) || { count: 0, requestIds: new Set<string>() };
        summary.count++;
        summary.requestIds.add(entry.requestId);
        fileEntries.set(filename, summary);
      }

      // Also write to central index. The index is an optimization for lookup;
      // reports can still be generated from memory if the index is unavailable.
      try {
        const indexPath = path.join(this.logDir, 'logs_index.json');
        let index: any[] = [];
        try {
          const existing = await fs.readFile(indexPath, 'utf8');
          index = JSON.parse(existing);
        } catch {
          // Start fresh
        }

        for (const [file, batch] of fileEntries) {
          const existing = index.find((item: any) => item.file === file);
          if (existing) {
            existing.timestamp = new Date().toISOString();
            existing.entryCount = (Number(existing.entryCount) || 0) + batch.count;
            existing.requestIds = Array.from(new Set([...(existing.requestIds || []), ...batch.requestIds]));
          } else {
            index.unshift({
              file,
              timestamp: new Date().toISOString(),
              entryCount: batch.count,
              requestIds: Array.from(batch.requestIds),
            });
          }
        }
        await this.applyRetention(index);
        await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8');
      } catch {
        // Best-effort only.
      }

      this.logBuffer = this.logBuffer.slice(entries.length);
    } catch (err) {
      console.error('Failed to flush logs:', err);
    }
  }

  private async applyRetention(index: any[]): Promise<void> {
    const now = Date.now();
    const files = (await fs.readdir(this.logDir))
      .filter((file) => /^logs_\d{4}-\d{2}-\d{2}T.*\.jsonl$/.test(file));
    const fileStats = await Promise.all(files.map(async (file) => {
      const filepath = path.join(this.logDir, file);
      try {
        const stat = await fs.stat(filepath);
        return { file, filepath, mtimeMs: stat.mtimeMs, size: stat.size };
      } catch {
        return undefined;
      }
    }));
    const ordered = fileStats.filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((a, b) => b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file));
    const retained = new Set<string>();
    for (const [position, item] of ordered.entries()) {
      if (
        now - item.mtimeMs <= this.persistenceLimits.maxAgeMs
        && item.size <= this.persistenceLimits.maxFileBytes
        && position < this.persistenceLimits.maxFiles
      ) {
        retained.add(item.file);
      } else {
        await fs.unlink(item.filepath).catch(() => undefined);
      }
    }
    for (let i = index.length - 1; i >= 0; i--) {
      if (!retained.has(index[i]?.file)) index.splice(i, 1);
    }
  }

  /**
   * Async flush (non-blocking)
   */
  private flushAsync(): Promise<void> {
    return this.flush().catch(err => console.error('Async flush failed:', err));
  }

  /**
   * Generate report for a request
   */
  async generateRequestReport(requestId: string): Promise<RequestReport | null> {
    try {
      // Flush first to ensure all logs are on disk
      await this.flush();

      const allLogs: StructuredLogEntry[] = [];

      try {
        // Read from index and find all files with this request
        const indexPath = path.join(this.logDir, 'logs_index.json');
        const indexContent = await fs.readFile(indexPath, 'utf8');
        const index = JSON.parse(indexContent);

        const relevantFiles = index
          .filter((summary: any) => summary.requestIds.includes(requestId))
          .map((summary: any) => summary.file);

        for (const file of relevantFiles) {
          try {
            const content = await fs.readFile(path.join(this.logDir, file), 'utf8');
            const entries = content
              .split('\n')
              .filter(line => line.trim())
              .map(line => JSON.parse(line))
              .filter((entry: StructuredLogEntry) => entry.requestId === requestId);
            allLogs.push(...entries);
          } catch {
            // Skip file if read fails
          }
        }
      } catch {
        // Disk persistence is best-effort; keep reports available from memory.
      }

      if (allLogs.length === 0) {
        allLogs.push(...this.logHistory.filter(entry => entry.requestId === requestId));
      }

      if (allLogs.length === 0) return null;

      // Generate report
      const firstLog = allLogs[0];
      const lastLog = allLogs[allLogs.length - 1];
      const startTime = new Date(firstLog.timestamp);
      const endTime = new Date(lastLog.timestamp);
      const duration = endTime.getTime() - startTime.getTime();

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCost = 0;
      let stepCount = 0;
      let success = true;
      let error: string | undefined;

      for (const log of allLogs) {
        if (log.eventType === EventType.STEP_END) {
          stepCount++;
        }
        if (log.metrics) {
          totalInputTokens += log.metrics.inputTokens || 0;
          totalOutputTokens += log.metrics.outputTokens || 0;
          totalCost += log.metrics.cost || 0;
          if (log.metrics.success === false) {
            success = false;
          }
          if (log.metrics.error) {
            error = log.metrics.error;
          }
        }
        if (log.eventType === EventType.ERROR) {
          success = false;
          error = log.context?.error;
        }
        if (log.eventType === EventType.REQUEST_END) {
          if (log.context?.success === false) {
            success = false;
          }
          if (log.context?.error) {
            error = log.context.error;
          }
        }
      }

      return {
        requestId,
        agentId: firstLog.agentId,
        startTime: firstLog.timestamp,
        endTime: lastLog.timestamp,
        duration,
        success,
        stepCount,
        totalInputTokens,
        totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        totalCost,
        logs: allLogs,
        error,
      };
    } catch (err) {
      console.error('Failed to generate request report:', err);
      return null;
    }
  }

  /**
   * Get all logs for a request
   */
  async getRequestLogs(requestId: string): Promise<StructuredLogEntry[]> {
    const report = await this.generateRequestReport(requestId);
    return report?.logs || [];
  }

  /**
   * Query logs by criteria
   */
  async queryLogs(criteria: {
    eventType?: EventType;
    level?: LogLevel;
    requestId?: string;
    agentId?: string;
    limit?: number;
  }): Promise<StructuredLogEntry[]> {
    // In production, this would query from a database or log aggregator
    // For now, return from buffer
    let results = this.logBuffer;

    if (criteria.eventType) {
      results = results.filter(e => e.eventType === criteria.eventType);
    }
    if (criteria.level) {
      results = results.filter(e => e.level === criteria.level);
    }
    if (criteria.requestId) {
      results = results.filter(e => e.requestId === criteria.requestId);
    }
    if (criteria.agentId) {
      results = results.filter(e => e.agentId === criteria.agentId);
    }

    if (criteria.limit) {
      results = results.slice(-criteria.limit);
    }

    return results;
  }

  /**
   * Clear all logs from memory (not disk)
   */
  clear(): void {
    this.logBuffer = [];
    this.logHistory = [];
    this.metricsBuffer.clear();
    this.requestContextStack = [];
  }
}

/**
 * Global logger singleton
 */
export const logger = StructuredLogger.getInstance();

/**
 * Convenient shortcuts for common operations
 */
export const log = {
  startRequest: (agentId?: string, metadata?: Record<string, any>) => logger.startRequest(agentId, metadata),
  endRequest: (success: boolean, error?: string) => logger.endRequest(success, error),
  startAgent: (agentId: string, metadata?: Record<string, any>) => logger.startAgent(agentId, metadata),
  endAgent: (success: boolean, error?: string, metrics?: ExecutionMetrics) => logger.endAgent(success, error, metrics),
  startStep: (stepId: string, action: string, input?: any) => logger.startStep(stepId, action, input),
  endStep: (observation?: string, metrics?: ExecutionMetrics) => logger.endStep(observation, metrics),
  apiCall: (apiName: string, model?: string, inputTokens?: number, outputTokens?: number, cost?: number, duration?: number) =>
    logger.logApiCall(apiName, model, inputTokens, outputTokens, cost, duration),
  toolExecution: (toolName: string, input?: any, output?: any, duration?: number, success?: boolean, error?: string) =>
    logger.logToolExecution(toolName, input, output, duration, success, error),
  error: (message: string, error: Error | string, context?: Record<string, any>) => logger.logError(message, error, context),
  metric: (name: string, value: number, unit?: string, metadata?: Record<string, any>) => logger.logMetric(name, value, unit, metadata),
  flush: () => logger.flush(),
  generateReport: (requestId: string) => logger.generateRequestReport(requestId),
  queryLogs: (criteria: any) => logger.queryLogs(criteria),
};
