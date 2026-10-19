/**
 * Logger and Storage Implementations
 * Adapters for logging and persistence
 */

import type { ExecutionLogger, RunReport, StructuredLogger, Storage } from '../types.js';
import { promises as fs } from 'fs';
import * as path from 'path';
import { SQLiteAppStore, getSQLiteAppStore } from '../../persistence/sqliteStore.js';
import type { MalformedProviderResponseAudit } from '@barok/engine';

/**
 * File-based Execution Logger
 * Stores run reports as JSON files
 */
export class FileExecutionLogger implements ExecutionLogger {
  private logsPath: string;

  constructor(logsPath: string = 'logs') {
    this.logsPath = logsPath;
  }

  async recordRun(report: RunReport): Promise<void> {
    // Ensure directory exists
    await fs.mkdir(this.logsPath, { recursive: true });

    // Write individual run file
    const runFile = path.join(this.logsPath, `run_${report.id}.json`);
    await fs.writeFile(runFile, JSON.stringify(report, null, 2));

    // Update audit log
    const auditFile = path.join(this.logsPath, 'react_runs_audit.json');
    let auditData: Record<string, unknown>[] = [];

    try {
      const existing = await fs.readFile(auditFile, 'utf-8');
      auditData = JSON.parse(existing);
    } catch {
      // File doesn't exist yet
    }

    // Keep last 100 runs
    auditData.unshift({
      id: report.id,
      task: report.task,
      timestamp: new Date().toISOString(),
      estimatedCost: report.metadata.estimatedCost,
      result: report.result.substring(0, 100),
    });

    if (auditData.length > 100) {
      auditData = auditData.slice(0, 100);
    }

    await fs.writeFile(auditFile, JSON.stringify(auditData, null, 2));
  }

  async getRecentRuns(limit: number = 10): Promise<RunReport[]> {
    try {
      const auditFile = path.join(this.logsPath, 'react_runs_audit.json');
      const data = await fs.readFile(auditFile, 'utf-8');
      const auditData = JSON.parse(data) as Array<{ id: string }>;

      const runs: RunReport[] = [];
      for (let i = 0; i < Math.min(limit, auditData.length); i++) {
        const run = await this.getRun(auditData[i].id);
        if (run) {
          runs.push(run);
        }
      }
      return runs;
    } catch {
      return [];
    }
  }

  async getRun(id: string): Promise<RunReport | null> {
    try {
      const runFile = path.join(this.logsPath, `run_${id}.json`);
      const data = await fs.readFile(runFile, 'utf-8');
      return JSON.parse(data) as RunReport;
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    try {
      const files = await fs.readdir(this.logsPath);
      for (const file of files) {
        if (file.startsWith('run_') || file === 'react_runs_audit.json') {
          await fs.unlink(path.join(this.logsPath, file));
        }
      }
    } catch {
      // Directory may not exist
    }
  }

  async recordProtocolAudit(audit: MalformedProviderResponseAudit, runId?: string): Promise<void> {
    await fs.mkdir(this.logsPath, { recursive: true });
    const auditFile = path.join(this.logsPath, 'protocol_audits.json');
    let records: Array<Record<string, unknown>> = [];
    try {
      records = JSON.parse(await fs.readFile(auditFile, 'utf-8'));
    } catch {
      records = [];
    }
    records.unshift({
      id: `protocol-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      runId,
      ...audit,
      createdAt: Date.now(),
    });
    await fs.writeFile(auditFile, JSON.stringify(records.slice(0, 200), null, 2));
  }
}

/**
 * SQLite-backed Execution Logger
 * Stores run reports in the shared application database.
 */
export class SQLiteExecutionLogger implements ExecutionLogger {
  private store: SQLiteAppStore;

  constructor(store: SQLiteAppStore = getSQLiteAppStore()) {
    this.store = store;
  }

  async recordRun(report: RunReport): Promise<void> {
    const timestamp = new Date(report.metadata.endTime || Date.now()).toISOString();
    this.store.saveRun(
      {
        id: report.id,
        task: report.task,
        model: report.metadata.model,
        timestamp,
        success: !report.error,
        stepCount: report.steps.length,
        totalPollenCost: report.metadata.actualCost ?? report.metadata.estimatedCost ?? 0,
        budget: 0,
        finalAnswer: report.result,
        error: report.error,
        steps: report.steps,
      },
      this.formatRawRunLog(report, timestamp)
    );
  }

  async getRecentRuns(limit: number = 10): Promise<RunReport[]> {
    return this.store.getRecentRuns<any>(limit).map((run) => this.toRunReport(run));
  }

  async getRun(id: string): Promise<RunReport | null> {
    const run = this.store.getRun<any>(id);
    return run ? this.toRunReport(run) : null;
  }

  async clear(): Promise<void> {
    this.store.clearRuns();
  }

  async recordProtocolAudit(audit: MalformedProviderResponseAudit, runId?: string): Promise<void> {
    this.store.recordProtocolAudit({
      id: `protocol-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      runId,
      auditType: audit.type,
      provider: audit.provider,
      errors: audit.errors,
      recoverable: audit.recoverable,
      rawRedacted: audit.rawRedacted,
      context: {
        model: audit.model,
        attempt: audit.attempt,
        parsedKeys: audit.parsedKeys,
        recoveryOutcome: audit.recoveryOutcome,
      },
    });
  }

  private toRunReport(run: any): RunReport {
    const endTime = Date.parse(run.timestamp) || Date.now();
    return {
      id: run.id,
      task: run.task,
      result: run.finalAnswer || '',
      error: run.error,
      steps: (run.steps || []).map((step: any) => ({
        action: step.action || '',
        result: step.observation || step.result || '',
        reasoning: step.thought || step.reasoning || '',
      })),
      metadata: {
        model: run.model,
        startTime: endTime,
        endTime,
        estimatedCost: run.totalPollenCost || 0,
        actualCost: run.totalPollenCost || 0,
      },
    };
  }

  private formatRawRunLog(report: RunReport, timestamp: string): string {
    return `
=============================================
RUN REPORT (ID: ${report.id})
=============================================
Timestamp   : ${timestamp}
Task        : "${report.task}"
Model Used  : ${report.metadata.model}
Success     : ${report.error ? 'NO' : 'YES'}
Steps Taken : ${report.steps.length}
Estimated Cost: ${report.metadata.estimatedCost}
${report.error ? `Error: ${report.error}\n` : ''}
Result:
${report.result}
=============================================
`;
  }
}

/**
 * In-Memory Execution Logger
 * Stores run reports in memory (useful for testing)
 */
export class InMemoryExecutionLogger implements ExecutionLogger {
  private runs: Map<string, RunReport> = new Map();

  async recordRun(report: RunReport): Promise<void> {
    this.runs.set(report.id, report);
  }

  async getRecentRuns(limit: number = 10): Promise<RunReport[]> {
    return Array.from(this.runs.values()).slice(0, limit);
  }

  async getRun(id: string): Promise<RunReport | null> {
    return this.runs.get(id) || null;
  }

  async clear(): Promise<void> {
    this.runs.clear();
  }
}

/**
 * Console-based Structured Logger
 * Logs to console with formatting
 */
export class ConsoleStructuredLogger implements StructuredLogger {
  private requests: Map<string, Record<string, unknown>> = new Map();
  private debug: boolean;

  constructor(debug: boolean = false) {
    this.debug = debug;
  }

  startRequest(id: string, task: string): void {
    this.requests.set(id, {
      id,
      task,
      startTime: Date.now(),
      steps: [],
    });
    if (this.debug) {
      console.log(`[Request ${id}] Started: ${task}`);
    }
  }

  endStep(id: string, stepNumber: number, action: string, result: string, reasoning: string): void {
    const request = this.requests.get(id);
    if (request && Array.isArray(request.steps)) {
      (request.steps as Array<Record<string, unknown>>).push({
        step: stepNumber,
        action,
        result: result.substring(0, 100),
        reasoning: reasoning.substring(0, 100),
      });
      if (this.debug) {
        console.log(`  [Step ${stepNumber}] ${action}`);
      }
    }
  }

  endRequest(
    id: string,
    result: string,
    error?: string,
    metadata?: Record<string, unknown>
  ): void {
    const request = this.requests.get(id);
    if (request) {
      request.endTime = Date.now();
      request.result = result.substring(0, 100);
      if (error) {
        request.error = error;
      }
      if (metadata) {
        request.metadata = metadata;
      }
      this.requests.delete(id);

      if (this.debug) {
        console.log(`[Request ${id}] Completed in ${(request.endTime as number) - (request.startTime as number)}ms`);
      }
    }
  }

  async flush(): Promise<void> {
    // Nothing to flush for console logger
  }

  log(level: 'info' | 'debug' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    console.log(`${prefix} ${message}`, meta ? JSON.stringify(meta) : '');
  }
}

/**
 * File-based Storage
 * Stores data as JSON files
 */
export class FileStorage implements Storage {
  private storagePath: string;

  constructor(storagePath: string = 'storage') {
    this.storagePath = storagePath;
  }

  private getFilePath(key: string): string {
    // Sanitize key to prevent directory traversal
    const sanitized = key.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(this.storagePath, `${sanitized}.json`);
  }

  async save(key: string, data: unknown): Promise<void> {
    await fs.mkdir(this.storagePath, { recursive: true });
    const filePath = this.getFilePath(key);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  }

  async load(key: string): Promise<unknown | null> {
    try {
      const filePath = this.getFilePath(key);
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const filePath = this.getFilePath(key);
      await fs.unlink(filePath);
    } catch {
      // File may not exist
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      const filePath = this.getFilePath(key);
      await fs.stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async keys(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.storagePath);
      return files.map((file) => file.replace(/\.json$/, ''));
    } catch {
      return [];
    }
  }

  async clear(): Promise<void> {
    try {
      const files = await fs.readdir(this.storagePath);
      for (const file of files) {
        await fs.unlink(path.join(this.storagePath, file));
      }
    } catch {
      // Directory may not exist
    }
  }
}

/**
 * SQLite-backed Storage
 * Stores arbitrary JSON values in the shared application database.
 */
export class SQLiteStorage implements Storage {
  private store: SQLiteAppStore;

  constructor(store: SQLiteAppStore = getSQLiteAppStore()) {
    this.store = store;
  }

  async save(key: string, data: unknown): Promise<void> {
    this.store.saveValue(key, data);
  }

  async load(key: string): Promise<unknown | null> {
    return this.store.loadValue(key);
  }

  async delete(key: string): Promise<void> {
    this.store.deleteValue(key);
  }

  async has(key: string): Promise<boolean> {
    return this.store.hasValue(key);
  }

  async keys(): Promise<string[]> {
    return this.store.valueKeys();
  }

  async clear(): Promise<void> {
    this.store.clearValues();
  }
}

/**
 * In-Memory Storage
 * Stores data in memory (useful for testing)
 */
export class InMemoryStorage implements Storage {
  private data: Map<string, unknown> = new Map();

  async save(key: string, data: unknown): Promise<void> {
    this.data.set(key, data);
  }

  async load(key: string): Promise<unknown | null> {
    return this.data.get(key) || null;
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.data.has(key);
  }

  async keys(): Promise<string[]> {
    return Array.from(this.data.keys());
  }

  async clear(): Promise<void> {
    this.data.clear();
  }
}
