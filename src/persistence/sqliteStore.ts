import { randomUUID } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { normalizeHarnessEvent } from './harnessEvent.js';
import { validateAgentContextSnapshot, type StoredAgentContextSnapshot } from './contextSnapshot.js';

export interface StoredCoderThread {
  id: string;
  title: string;
  messages: unknown[];
  createdAt: number;
  updatedAt: number;
}

export interface StoredCoderThreadSummary {
  id: string;
  title: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ThreadHistoryPurgeResult {
  threadsDeleted: number;
  runsDeleted: number;
  eventsDeleted: number;
  contextSnapshotsDeleted: number;
  inboxEntriesDeleted: number;
  runAuditsDeleted: number;
  protocolAuditsDeleted: number;
}

/** Persistent conversation state intentionally lives outside agent_runs. */
export type StoredConversationSession = StoredCoderThread;

export interface StoredMemory {
  id: string;
  scope: string;
  content: string;
  metadata?: unknown;
  createdAt: number;
  updatedAt: number;
}

export type StoredAgentRunStatus = 'running' | 'waiting_for_user' | 'waiting_for_provider' | 'completed' | 'failed' | 'stopped' | 'interrupted' | 'killed';

export type AgentInboxTarget = 'next-turn' | 'next-step';
export type AgentInboxStatus = 'pending' | 'claimed' | 'cancelled' | 'processed';

export interface StoredAgentInboxEntry {
  runId: string;
  messageId: string;
  inboxSeq: number;
  source: string;
  target: AgentInboxTarget;
  message: string;
  createdAt: number;
  updatedAt: number;
  status: AgentInboxStatus;
  claimedAt?: number;
  claimedBy?: string;
  cancelledAt?: number;
  processedAt?: number;
}

export interface AgentInboxEnqueueInput {
  runId: string;
  messageId: string;
  source: string;
  target: AgentInboxTarget;
  message: string;
  createdAt?: number;
}

export interface AgentInboxListOptions {
  status?: AgentInboxStatus;
  target?: AgentInboxTarget;
}

export class AgentInboxConflictError extends Error {
  readonly code = 'DUPLICATE_PENDING_INBOX_MESSAGE';

  constructor(message = 'An inbox message with this ID is already pending.') {
    super(message);
    this.name = 'AgentInboxConflictError';
  }
}

export interface StoredAgentRun {
  id: string;
  kind: string;
  threadId?: string;
  status: StoredAgentRunStatus;
  task: string;
  workspace?: string;
  model?: string;
  metadata?: unknown;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  stopReason?: string;
  result?: unknown;
  lastEventSeq: number;
  seenAt?: number;
}

export interface StoredAgentRunEvent {
  runId: string;
  seq: number;
  eventType: string;
  event: unknown;
  createdAt: number;
}

export interface StoredAgentRunEventPage {
  events: StoredAgentRunEvent[];
  afterSeq: number;
  nextSeq: number;
  lastSeq: number;
  hasMore: boolean;
}

export interface StoredServerStart {
  id: number;
  pid: number;
  port: number;
  startedAt: string;
  version: string;
}

export interface AgentRunEventProjection {
  metadata?: unknown;
  status?: StoredAgentRunStatus;
  stopReason?: string;
  result?: unknown;
  finishedAt?: number;
  contextSnapshot?: StoredAgentContextSnapshot;
}

export interface StoredNvidiaModelTarget {
  id: string;
  title: string;
  modelId: string;
  apiKeyIndex: number;
  apiFamily: string;
  endpoint: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  supportsStreaming?: boolean;
  supportsTools?: boolean;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type StoredRunAuditOutcomeKind =
  | 'completed'
  | 'checkpoint_turn_limit'
  | 'checkpoint_rate_limit'
  | 'cancelled'
  | 'fatal_error'
  | 'unknown';

export type StoredThreadAuditStatus =
  | 'completed'
  | 'paused'
  | 'waiting_cooldown'
  | 'cancelled'
  | 'failed';

export interface StoredRunAudit {
  id: string;
  threadId?: string;
  runId: string;
  parentRunId?: string;
  attemptIndex: number;
  outcomeKind?: StoredRunAuditOutcomeKind;
  threadTitle?: string;
  cumulativeCost?: number;
  cumulativeSteps?: number;
  task: string;
  model: string;
  timestamp: string;
  success: boolean;
  stepCount: number;
  totalPollenCost: number;
  budget: number;
  finalAnswer?: string;
  error?: string;
  steps: unknown[];
  filesChanged?: string[];
  performanceTrace?: unknown;
}

export interface StoredThreadAuditSummary {
  threadId: string;
  threadTitle?: string;
  status: StoredThreadAuditStatus;
  latestOutcomeKind?: StoredRunAuditOutcomeKind;
  totalAttempts: number;
  totalSteps: number;
  totalPollenCost: number;
  filesChanged: string[];
  lastModel: string;
  lastTimestamp: string;
  runs: StoredRunAudit[];
  performanceSummary?: { durationMs: number; tokens: number };
}

type JsonValue = unknown;

let sharedStore: SQLiteAppStore | null = null;

const DEFAULT_DB_PATH = path.join(process.cwd(), 'storage', 'react-engine.sqlite');
const LEGACY_DB_PATHS = [
  path.join(process.cwd(), 'logs', 'react-engine.sqlite'),
  path.join(process.cwd(), 'data', 'react-engine.sqlite'),
];

const safeJsonParse = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const RUN_AUDIT_OUTCOMES = new Set<StoredRunAuditOutcomeKind>([
  'completed',
  'checkpoint_turn_limit',
  'checkpoint_rate_limit',
  'cancelled',
  'fatal_error',
  'unknown',
]);

function finiteNumber(value: unknown, fallback = 0): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function auditOutcome(row: Record<string, unknown>): StoredRunAuditOutcomeKind {
  const value = typeof row.outcome_kind === 'string' ? row.outcome_kind : '';
  if (RUN_AUDIT_OUTCOMES.has(value as StoredRunAuditOutcomeKind)) {
    return value as StoredRunAuditOutcomeKind;
  }
  return row.success ? 'completed' : row.error ? 'fatal_error' : 'unknown';
}

function successfulObservation(observation: unknown): boolean {
  if (!observation) return false;
  const text = String(observation);
  try {
    const parsed = JSON.parse(text) as { success?: unknown };
    if (parsed && typeof parsed === 'object' && 'success' in parsed) return Boolean(parsed.success);
  } catch {
    // Legacy observations are plain text.
  }
  return !/error executing|tool execution failed|"success"\s*:\s*false|failed|error|pattern not found|guarded mutation rejected/i.test(text);
}

function derivedFilesChanged(steps: unknown[]): string[] {
  const files = new Set<string>();
  for (const value of steps) {
    if (!value || typeof value !== 'object') continue;
    const step = value as Record<string, unknown>;
    if (step.action !== 'Write' && step.action !== 'Edit') continue;
    if (!successfulObservation(step.observation)) continue;
    const input = (step.actionInput ?? step.action_input) as Record<string, unknown> | undefined;
    if (!input || typeof input !== 'object') continue;
    const file = input.file_path ?? input.path ?? input.filename ?? input.file;
    if (typeof file === 'string' && file.trim()) files.add(file.trim());
  }
  return Array.from(files);
}

function mapRunAuditRow(row: Record<string, unknown>): StoredRunAudit {
  const stepsValue = safeJsonParse<unknown>(typeof row.steps_json === 'string' ? row.steps_json : null, []);
  const steps = Array.isArray(stepsValue) ? stepsValue : [];
  const storedFilesValue = safeJsonParse<unknown>(typeof row.files_changed_json === 'string' ? row.files_changed_json : null, []);
  const storedFiles = Array.isArray(storedFilesValue)
    ? storedFilesValue.filter((file): file is string => typeof file === 'string' && Boolean(file.trim())).map((file) => file.trim())
    : [];
  const filesChanged = Array.from(new Set(storedFiles.length > 0 ? storedFiles : derivedFilesChanged(steps)));
  const threadId = typeof row.thread_id === 'string' && row.thread_id.trim() ? row.thread_id.trim() : undefined;
  const performanceTrace = typeof row.performance_trace_json === 'string'
    ? safeJsonParse<unknown>(row.performance_trace_json, undefined)
    : undefined;

  return {
    id: String(row.id),
    threadId,
    runId: typeof row.run_id === 'string' && row.run_id.trim() ? row.run_id : String(row.id),
    parentRunId: typeof row.parent_run_id === 'string' && row.parent_run_id.trim() ? row.parent_run_id : undefined,
    attemptIndex: Math.max(1, Math.floor(finiteNumber(row.attempt_index, 1))),
    outcomeKind: auditOutcome(row),
    threadTitle: typeof row.thread_title === 'string' && row.thread_title.trim() ? row.thread_title : undefined,
    cumulativeCost: row.cumulative_cost == null ? undefined : finiteNumber(row.cumulative_cost),
    cumulativeSteps: row.cumulative_steps == null ? undefined : Math.max(0, Math.floor(finiteNumber(row.cumulative_steps))),
    task: String(row.task || ''),
    model: String(row.model || ''),
    timestamp: String(row.timestamp || ''),
    success: Boolean(row.success),
    stepCount: Math.max(0, Math.floor(finiteNumber(row.step_count))),
    totalPollenCost: finiteNumber(row.total_pollen_cost),
    budget: finiteNumber(row.budget),
    finalAnswer: row.final_answer == null ? undefined : String(row.final_answer),
    error: row.error == null ? undefined : String(row.error),
    steps,
    filesChanged,
    performanceTrace,
  };
}

function statusForAudit(run: StoredRunAudit): StoredThreadAuditStatus {
  switch (run.outcomeKind) {
    case 'completed':
      return 'completed';
    case 'checkpoint_turn_limit':
      return 'paused';
    case 'checkpoint_rate_limit':
      return 'waiting_cooldown';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'failed';
  }
}

export class SQLiteAppStore {
  private db: DatabaseSync;

  constructor(dbPath = process.env.REACT_ENGINE_DB_PATH || DEFAULT_DB_PATH) {
    if (!process.env.REACT_ENGINE_DB_PATH && dbPath === DEFAULT_DB_PATH) {
      migrateLegacyDatabaseFile(dbPath);
    }

    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS run_audits (
        id TEXT PRIMARY KEY,
        task TEXT NOT NULL,
        model TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        success INTEGER NOT NULL,
        step_count INTEGER NOT NULL,
        total_pollen_cost REAL NOT NULL,
        budget REAL NOT NULL,
        final_answer TEXT,
        error TEXT,
        steps_json TEXT NOT NULL,
        performance_trace_json TEXT,
        files_changed_json TEXT,
        raw_log TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_run_audits_timestamp
        ON run_audits(timestamp DESC);

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS server_starts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pid INTEGER NOT NULL,
        port INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        version TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_server_starts_pid_port_id
        ON server_starts(pid, port, id DESC);

      CREATE TABLE IF NOT EXISTS coder_threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        messages_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_coder_threads_updated_at
        ON coder_threads(updated_at DESC);

      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        thread_id TEXT,
        status TEXT NOT NULL,
        task TEXT NOT NULL,
        workspace TEXT,
        model TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        finished_at INTEGER,
        stop_reason TEXT,
        result_json TEXT,
        last_event_seq INTEGER NOT NULL DEFAULT 0,
        seen_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_agent_runs_status_updated_at
        ON agent_runs(status, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_agent_runs_thread_updated_at
        ON agent_runs(thread_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS agent_run_events (
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        event_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (run_id, seq),
        FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_agent_run_events_run_seq
        ON agent_run_events(run_id, seq);

      CREATE TABLE IF NOT EXISTS agent_run_context_snapshots (
        run_id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        context_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        event_seq INTEGER NOT NULL,
        model TEXT,
        model_context_window INTEGER,
        token_estimate INTEGER NOT NULL,
        compaction_version TEXT NOT NULL,
        messages_json TEXT NOT NULL,
        evidence_ids_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_agent_run_context_snapshots_updated_at
        ON agent_run_context_snapshots(updated_at DESC);

      CREATE TABLE IF NOT EXISTS agent_run_inbox (
        run_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        inbox_seq INTEGER NOT NULL,
        source TEXT NOT NULL,
        target TEXT NOT NULL CHECK(target IN ('next-turn', 'next-step')),
        message TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'claimed', 'cancelled', 'processed')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        claimed_at INTEGER,
        claimed_by TEXT,
        cancelled_at INTEGER,
        processed_at INTEGER,
        PRIMARY KEY (run_id, message_id),
        UNIQUE (run_id, inbox_seq),
        FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_agent_run_inbox_run_status_target_seq
        ON agent_run_inbox(run_id, status, target, inbox_seq);

      CREATE TABLE IF NOT EXISTS memory_items (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memory_items_scope_updated_at
        ON memory_items(scope, updated_at DESC);

      CREATE TABLE IF NOT EXISTS nvidia_model_targets (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        model_id TEXT NOT NULL,
        api_key_index INTEGER NOT NULL,
        api_family TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        temperature REAL,
        max_tokens INTEGER,
        top_p REAL,
        stream INTEGER NOT NULL DEFAULT 0,
        supports_streaming INTEGER NOT NULL DEFAULT 1,
        supports_tools INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_nvidia_model_targets_api_key_index
        ON nvidia_model_targets(api_key_index);

      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS protocol_audits (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        audit_type TEXT NOT NULL,
        provider TEXT NOT NULL,
        errors_json TEXT NOT NULL,
        recoverable INTEGER NOT NULL,
        raw_redacted TEXT NOT NULL,
        context_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_protocol_audits_created_at
        ON protocol_audits(created_at DESC);
    `);

    this.addColumnIfMissing('run_audits', 'performance_trace_json', 'TEXT');
    this.addColumnIfMissing('run_audits', 'thread_id', 'TEXT');
    this.addColumnIfMissing('run_audits', 'run_id', 'TEXT');
    this.addColumnIfMissing('run_audits', 'parent_run_id', 'TEXT');
    this.addColumnIfMissing('run_audits', 'attempt_index', 'INTEGER DEFAULT 1');
    this.addColumnIfMissing('run_audits', 'outcome_kind', 'TEXT');
    this.addColumnIfMissing('run_audits', 'thread_title', 'TEXT');
    this.addColumnIfMissing('run_audits', 'cumulative_cost', 'REAL');
    this.addColumnIfMissing('run_audits', 'cumulative_steps', 'INTEGER');
    this.addColumnIfMissing('run_audits', 'files_changed_json', 'TEXT');
    this.addColumnIfMissing('protocol_audits', 'context_json', 'TEXT');
    this.addColumnIfMissing('nvidia_model_targets', 'stream', 'INTEGER NOT NULL DEFAULT 0');

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_run_audits_thread_timestamp
        ON run_audits(thread_id, timestamp DESC);
    `);
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((entry) => entry.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  saveRun(report: {
    id: string;
    threadId?: string;
    runId?: string;
    parentRunId?: string;
    attemptIndex?: number;
    outcomeKind?: string;
    threadTitle?: string;
    cumulativeCost?: number;
    cumulativeSteps?: number;
    task: string;
    model: string;
    timestamp: string;
    success: boolean;
    stepCount: number;
    totalPollenCost: number;
    budget: number;
    finalAnswer?: string;
    error?: string;
    steps: unknown[];
    filesChanged?: string[];
    performanceTrace?: unknown;
  }, rawLog: string): void {
    this.db.prepare(`
      INSERT INTO run_audits (
        id, task, model, timestamp, success, step_count, total_pollen_cost,
        budget, final_answer, error, steps_json, performance_trace_json, files_changed_json, raw_log,
        thread_id, run_id, parent_run_id, attempt_index, outcome_kind, thread_title,
        cumulative_cost, cumulative_steps
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        task = excluded.task,
        model = excluded.model,
        timestamp = excluded.timestamp,
        success = excluded.success,
        step_count = excluded.step_count,
        total_pollen_cost = excluded.total_pollen_cost,
        budget = excluded.budget,
        final_answer = excluded.final_answer,
        error = excluded.error,
        steps_json = excluded.steps_json,
        performance_trace_json = excluded.performance_trace_json,
        files_changed_json = excluded.files_changed_json,
        raw_log = excluded.raw_log,
        thread_id = excluded.thread_id,
        run_id = excluded.run_id,
        parent_run_id = excluded.parent_run_id,
        attempt_index = excluded.attempt_index,
        outcome_kind = excluded.outcome_kind,
        thread_title = excluded.thread_title,
        cumulative_cost = excluded.cumulative_cost,
        cumulative_steps = excluded.cumulative_steps
    `).run(
      report.id,
      report.task,
      report.model,
      report.timestamp,
      report.success ? 1 : 0,
      report.stepCount,
      report.totalPollenCost,
      report.budget,
      report.finalAnswer ?? null,
      report.error ?? null,
      JSON.stringify(report.steps),
      report.performanceTrace === undefined ? null : JSON.stringify(report.performanceTrace),
      report.filesChanged === undefined ? null : JSON.stringify(report.filesChanged),
      rawLog,
      report.threadId ?? null,
      report.runId ?? report.id,
      report.parentRunId ?? null,
      report.attemptIndex ?? 1,
      report.outcomeKind ?? (report.success ? 'completed' : 'unknown'),
      report.threadTitle ?? null,
      report.cumulativeCost ?? report.totalPollenCost,
      report.cumulativeSteps ?? report.stepCount
    );
  }

  getRecentRuns<T>(limit = 100): T[] {
    const rows = this.db.prepare(`
      SELECT * FROM run_audits
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;

    return rows.map((row) => mapRunAuditRow(row)) as T[];
  }

  getRun<T>(id: string): T | null {
    const row = this.db.prepare('SELECT * FROM run_audits WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return mapRunAuditRow(row) as T;
  }

  /** Return one aggregated lifecycle row per conversation/task thread. */
  getRecentThreads(limit = 50): StoredThreadAuditSummary[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 50;
    const groups = this.db.prepare(`
      SELECT
        CASE
          WHEN thread_id IS NULL OR TRIM(thread_id) = '' THEN 'legacy:' || id
          ELSE thread_id
        END AS grouping_thread_id,
        COUNT(*) AS total_attempts,
        SUM(step_count) AS total_steps,
        SUM(total_pollen_cost) AS total_pollen_cost,
        MAX(timestamp) AS last_timestamp
      FROM run_audits
      GROUP BY grouping_thread_id
      ORDER BY last_timestamp DESC
      LIMIT ?
    `).all(safeLimit) as Array<{ grouping_thread_id: string }>;

    return groups
      .map((group) => this.getThreadDetailsByKey(String(group.grouping_thread_id)))
      .filter((summary): summary is StoredThreadAuditSummary => Boolean(summary));
  }

  /** Return aggregate thread headers without reading retained step observations. */
  getRecentThreadHeaders(limit = 50): StoredThreadAuditSummary[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 50;
    const groups = this.db.prepare(`
      SELECT
        CASE
          WHEN thread_id IS NULL OR TRIM(thread_id) = '' THEN 'legacy:' || id
          ELSE thread_id
        END AS grouping_thread_id,
        MAX(timestamp) AS last_timestamp
      FROM run_audits
      GROUP BY grouping_thread_id
      ORDER BY last_timestamp DESC
      LIMIT ?
    `).all(safeLimit) as Array<{ grouping_thread_id: string }>;

    return groups
      .map((group) => this.getThreadHeaderByKey(String(group.grouping_thread_id)))
      .filter((summary): summary is StoredThreadAuditSummary => Boolean(summary));
  }

  /** Return every persisted attempt for one thread in chronological order. */
  getThreadDetails(threadId: string): StoredThreadAuditSummary | null {
    const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : '';
    if (!normalizedThreadId) return null;
    const direct = this.getThreadDetailsByKey(normalizedThreadId);
    if (direct) return direct;

    // Legacy audit rows have no thread_id. They are exposed as one-run
    // synthetic threads so upgrading does not make historical audits vanish.
    if (normalizedThreadId.startsWith('legacy:')) {
      return this.getThreadDetailsByKey(normalizedThreadId);
    }
    return null;
  }

  /** Return one bounded page of attempts for an audit thread. Offsets count back from the newest attempt. */
  getThreadAuditPage(threadId: string, limit = 20, offset = 0): {
    thread: StoredThreadAuditSummary;
    pagination: { offset: number; limit: number; total: number; hasMore: boolean; nextOffset: number };
  } | null {
    const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : '';
    if (!normalizedThreadId) return null;
    const isLegacy = normalizedThreadId.startsWith('legacy:');
    const key = isLegacy ? normalizedThreadId.slice('legacy:'.length) : normalizedThreadId;
    const where = isLegacy ? 'id = ?' : 'thread_id = ?';
    const header = this.getThreadHeaderByKey(normalizedThreadId);
    if (!header) return null;

    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.floor(limit))) : 20;
    const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
    const total = header.totalAttempts;
    const end = Math.max(0, total - safeOffset);
    const start = Math.max(0, end - safeLimit);
    const rows = this.db.prepare(`
      SELECT * FROM run_audits WHERE ${where}
      ORDER BY timestamp ASC, rowid ASC LIMIT ? OFFSET ?
    `).all(key, end - start, start) as Array<Record<string, unknown>>;
    const runs = rows.map((row) => mapRunAuditRow(row));
    return {
      thread: { ...header, runs },
      pagination: {
        offset: safeOffset,
        limit: safeLimit,
        total,
        hasMore: start > 0,
        nextOffset: safeOffset + (end - start),
      },
    };
  }

  /** Fetch a bounded slice of one run's chronological step history without loading sibling attempts. */
  getRunAuditSteps(threadId: string, runId: string, limit = 100, offset = 0): {
    runId: string;
    steps: unknown[];
    pagination: { offset: number; limit: number; total: number; hasMore: boolean; nextOffset: number };
  } | null {
    const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : '';
    const normalizedRunId = typeof runId === 'string' ? runId.trim() : '';
    if (!normalizedThreadId || !normalizedRunId) return null;
    const isLegacy = normalizedThreadId.startsWith('legacy:');
    const threadKey = isLegacy ? normalizedThreadId.slice('legacy:'.length) : normalizedThreadId;
    const where = isLegacy ? 'id = ? AND (id = ? OR run_id = ?)' : 'thread_id = ? AND (id = ? OR run_id = ?)';
    const row = this.db.prepare(`SELECT id, run_id, steps_json FROM run_audits WHERE ${where} LIMIT 1`)
      .get(threadKey, normalizedRunId, normalizedRunId) as Record<string, unknown> | undefined;
    if (!row) return null;

    const stepsValue = safeJsonParse<unknown>(typeof row.steps_json === 'string' ? row.steps_json : null, []);
    const allSteps = Array.isArray(stepsValue) ? stepsValue : [];
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 100;
    const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
    const end = Math.max(0, allSteps.length - safeOffset);
    const start = Math.max(0, end - safeLimit);
    const steps = allSteps.slice(start, end);
    return {
      runId: typeof row.run_id === 'string' ? row.run_id : String(row.id),
      steps,
      pagination: {
        offset: safeOffset,
        limit: safeLimit,
        total: allSteps.length,
        hasMore: start > 0,
        nextOffset: safeOffset + (end - start),
      },
    };
  }

  private getThreadDetailsByKey(groupingThreadId: string): StoredThreadAuditSummary | null {
    const isLegacy = groupingThreadId.startsWith('legacy:');
    const legacyRunId = isLegacy ? groupingThreadId.slice('legacy:'.length) : '';
    const rows = (isLegacy
      ? this.db.prepare('SELECT * FROM run_audits WHERE id = ? ORDER BY timestamp ASC').all(legacyRunId)
      : this.db.prepare('SELECT * FROM run_audits WHERE thread_id = ? ORDER BY timestamp ASC, rowid ASC').all(groupingThreadId)
    ) as Array<Record<string, unknown>>;
    if (rows.length === 0) return null;

    const runs = rows.map((row) => mapRunAuditRow(row));
    const latest = runs[runs.length - 1];
    const filesChanged = Array.from(new Set(runs.flatMap((run) => run.filesChanged || [])));
    const title = [...runs].reverse().find((run) => run.threadTitle)?.threadTitle
      || latest.threadTitle
      || latest.task;

    return {
      threadId: isLegacy ? groupingThreadId : String(latest.threadId || groupingThreadId),
      threadTitle: title,
      status: statusForAudit(latest),
      latestOutcomeKind: latest.outcomeKind,
      totalAttempts: runs.length,
      totalSteps: runs.reduce((sum, run) => sum + run.stepCount, 0),
      totalPollenCost: runs.reduce((sum, run) => sum + run.totalPollenCost, 0),
      filesChanged,
      lastModel: latest.model,
      lastTimestamp: latest.timestamp,
      runs,
    };
  }

  private getThreadHeaderByKey(groupingThreadId: string): StoredThreadAuditSummary | null {
    const isLegacy = groupingThreadId.startsWith('legacy:');
    const legacyRunId = isLegacy ? groupingThreadId.slice('legacy:'.length) : '';
    const where = isLegacy ? 'id = ?' : 'thread_id = ?';
    const key = isLegacy ? legacyRunId : groupingThreadId;
    const stats = this.db.prepare(`
      SELECT COUNT(*) AS total_attempts, SUM(step_count) AS total_steps,
        SUM(total_pollen_cost) AS total_pollen_cost
      FROM run_audits WHERE ${where}
    `).get(key) as { total_attempts?: unknown; total_steps?: unknown; total_pollen_cost?: unknown } | undefined;
    if (!stats || finiteNumber(stats.total_attempts) < 1) return null;

    const latestRow = this.db.prepare(`
      SELECT id, thread_id, run_id, parent_run_id, attempt_index, outcome_kind,
        thread_title, cumulative_cost, cumulative_steps, task, model, timestamp,
        success, step_count, total_pollen_cost, budget, files_changed_json,
        performance_trace_json, '[]' AS steps_json, NULL AS final_answer, NULL AS error
      FROM run_audits WHERE ${where}
      ORDER BY timestamp DESC, rowid DESC LIMIT 1
    `).get(key) as Record<string, unknown> | undefined;
    if (!latestRow) return null;

    const latest = mapRunAuditRow(latestRow);
    const files = new Set<string>();
    const auditRows = this.db.prepare(`SELECT files_changed_json, performance_trace_json FROM run_audits WHERE ${where}`).all(key) as Array<{
      files_changed_json?: string | null;
      performance_trace_json?: string | null;
    }>;
    const performanceSummary = auditRows.reduce((summary, row) => {
      const values = safeJsonParse<unknown>(row.files_changed_json, []);
      if (Array.isArray(values)) {
        for (const value of values) if (typeof value === 'string' && value.trim()) files.add(value.trim());
      }
      const trace = safeJsonParse<{ durationMs?: unknown; counters?: Record<string, unknown> } | undefined>(row.performance_trace_json, undefined);
      const durationMs = Number(trace?.durationMs) || 0;
      const counters = trace?.counters || {};
      const inputTokens = Number(counters.llm_input_tokens) || 0;
      const outputTokens = Number(counters.llm_output_tokens) || 0;
      const totalTokens = Number(counters.llm_total_tokens) || inputTokens + outputTokens;
      return {
        durationMs: summary.durationMs + (Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0),
        tokens: summary.tokens + (Number.isFinite(totalTokens) && totalTokens > 0 ? totalTokens : 0),
      };
    }, { durationMs: 0, tokens: 0 });

    return {
      threadId: isLegacy ? groupingThreadId : String(latest.threadId || groupingThreadId),
      threadTitle: latest.threadTitle || latest.task,
      status: statusForAudit(latest),
      latestOutcomeKind: latest.outcomeKind,
      totalAttempts: Math.floor(finiteNumber(stats.total_attempts)),
      totalSteps: Math.max(0, Math.floor(finiteNumber(stats.total_steps))),
      totalPollenCost: finiteNumber(stats.total_pollen_cost),
      filesChanged: Array.from(files),
      lastModel: latest.model,
      lastTimestamp: latest.timestamp,
      runs: [latest],
      performanceSummary,
    };
  }

  getRawRunLog(): string {
    const rows = this.db.prepare(`
      SELECT raw_log FROM run_audits
      ORDER BY timestamp ASC
    `).all() as Array<{ raw_log: string }>;

    if (rows.length === 0) return 'No logs recorded yet.';
    return rows.map((row) => row.raw_log).join('\n');
  }

  clearRuns(): void {
    this.db.prepare('DELETE FROM run_audits').run();
  }

  getRunCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM run_audits').get() as { count: number };
    return Number(row.count || 0);
  }

  recordProtocolAudit(audit: {
    id: string;
    runId?: string;
    auditType: string;
    provider: string;
    errors: string[];
    recoverable: boolean;
    rawRedacted: string;
    context?: Record<string, unknown>;
    createdAt?: number;
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO protocol_audits
        (id, run_id, audit_type, provider, errors_json, recoverable, raw_redacted, context_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      audit.id,
      audit.runId ?? null,
      audit.auditType,
      audit.provider,
      JSON.stringify(audit.errors),
      audit.recoverable ? 1 : 0,
      audit.rawRedacted,
      audit.context ? JSON.stringify(audit.context) : null,
      audit.createdAt ?? Date.now()
    );
  }

  listProtocolAudits(limit = 100): Array<{
    id: string;
    runId?: string;
    auditType: string;
    provider: string;
    errors: string[];
    recoverable: boolean;
    rawRedacted: string;
    context?: Record<string, unknown>;
    createdAt: number;
  }> {
    const rows = this.db.prepare(`
      SELECT id, run_id, audit_type, provider, errors_json, recoverable, raw_redacted, context_json, created_at
      FROM protocol_audits ORDER BY created_at DESC LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      runId: row.run_id ? String(row.run_id) : undefined,
      auditType: String(row.audit_type),
      provider: String(row.provider),
      errors: safeJsonParse(String(row.errors_json || '[]'), [] as string[]),
      recoverable: Boolean(row.recoverable),
      rawRedacted: String(row.raw_redacted || ''),
      context: row.context_json ? safeJsonParse(String(row.context_json), {} as Record<string, unknown>) : undefined,
      createdAt: Number(row.created_at),
    }));
  }

  migrateLegacyReactLogs(logDir = path.join(process.cwd(), 'logs'), deleteAfterImport = false): {
    imported: number;
    deleted: number;
    skipped: number;
    errors: string[];
  } {
    if (!existsSync(logDir)) {
      return { imported: 0, deleted: 0, skipped: 0, errors: [] };
    }

    let imported = 0;
    let deleted = 0;
    let skipped = 0;
    const errors: string[] = [];
    const importedRunFiles = new Set<string>();

    const importReport = (report: any, sourceFile: string): boolean => {
      if (!report?.id || !report?.task || !report?.model || !report?.timestamp) {
        skipped += 1;
        return false;
      }

      this.saveRun(
        {
          id: String(report.id),
          task: String(report.task),
          model: String(report.model),
          timestamp: String(report.timestamp),
          success: Boolean(report.success),
          stepCount: Number(report.stepCount ?? report.steps?.length ?? 0),
          totalPollenCost: Number(report.totalPollenCost ?? 0),
          budget: Number(report.budget ?? 0),
          finalAnswer: report.finalAnswer,
          error: report.error,
          steps: Array.isArray(report.steps) ? report.steps : [],
        },
        formatLegacyRawRunLog(report)
      );

      imported += 1;
      if (sourceFile.startsWith('run_') && sourceFile.endsWith('.json')) {
        importedRunFiles.add(sourceFile);
      }
      return true;
    };

    const auditPath = path.join(logDir, 'react_runs_audit.json');
    let importedAuditFile = false;
    if (existsSync(auditPath)) {
      try {
        const auditReports = JSON.parse(readFileSync(auditPath, 'utf8'));
        if (Array.isArray(auditReports)) {
          for (const report of auditReports) {
            importReport(report, 'react_runs_audit.json');
          }
          importedAuditFile = true;
        } else {
          skipped += 1;
        }
      } catch (error) {
        errors.push(`react_runs_audit.json: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    for (const file of readdirSync(logDir)) {
      if (!file.startsWith('run_') || !file.endsWith('.json')) continue;

      try {
        const report = JSON.parse(readFileSync(path.join(logDir, file), 'utf8'));
        importReport(report, file);
      } catch (error) {
        skipped += 1;
        errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (deleteAfterImport) {
      for (const file of importedRunFiles) {
        rmSync(path.join(logDir, file), { force: true });
        deleted += 1;
      }

      if (importedAuditFile) {
        rmSync(auditPath, { force: true });
        deleted += 1;
      }

      const rawLogPath = path.join(logDir, 'react_runs.log');
      if (existsSync(rawLogPath)) {
        rmSync(rawLogPath, { force: true });
        deleted += 1;
      }
    }

    return { imported, deleted, skipped, errors };
  }

  saveSetting(key: string, value: JsonValue): void {
    this.db.prepare(`
      INSERT INTO app_settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), new Date().toISOString());
  }

  getSetting<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(key) as { value_json: string } | undefined;
    return row ? safeJsonParse<T | null>(row.value_json, null) : null;
  }

  getAllSettings(): Record<string, JsonValue> {
    const rows = this.db.prepare('SELECT key, value_json FROM app_settings ORDER BY key').all() as Array<{ key: string; value_json: string }>;
    return Object.fromEntries(rows.map((row) => [row.key, safeJsonParse(row.value_json, null)]));
  }

  checkHealth(): void {
    this.db.prepare('SELECT 1').get();
  }

  recordServerStart(start: Omit<StoredServerStart, 'id'>): StoredServerStart {
    const result = this.db.prepare(`
      INSERT INTO server_starts (pid, port, started_at, version)
      VALUES (?, ?, ?, ?)
    `).run(start.pid, start.port, start.startedAt, start.version);

    // Keep enough history to compare recent restarts without letting this
    // low-volume lifecycle table grow forever.
    this.db.prepare(`
      DELETE FROM server_starts
      WHERE id NOT IN (SELECT id FROM server_starts ORDER BY id DESC LIMIT 100)
    `).run();

    return { id: Number(result.lastInsertRowid), ...start };
  }

  getServerStart(pid: number, port: number): StoredServerStart | null {
    const row = this.db.prepare(`
      SELECT id, pid, port, started_at, version
      FROM server_starts
      WHERE pid = ? AND port = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(pid, port) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: Number(row.id),
      pid: Number(row.pid),
      port: Number(row.port),
      startedAt: String(row.started_at),
      version: String(row.version),
    };
  }

  upsertThread(thread: StoredCoderThread): void {
    this.db.prepare(`
      INSERT INTO coder_threads (id, title, messages_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        messages_json = excluded.messages_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run(thread.id, thread.title, JSON.stringify(thread.messages || []), thread.createdAt, thread.updatedAt);
  }

  listThreads(): StoredCoderThread[] {
    const rows = this.db.prepare(`
      SELECT id, title, messages_json, created_at, updated_at
      FROM coder_threads
      ORDER BY updated_at DESC
    `).all() as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      messages: safeJsonParse(String(row.messages_json || '[]'), []),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }));
  }

  listThreadSummaries(
    limit = 50,
    before?: { updatedAt: number; id: string },
  ): StoredCoderThreadSummary[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(201, Math.floor(limit))) : 50;
    const rows = before
      ? this.db.prepare(`
          SELECT id, title, created_at, updated_at,
            CASE WHEN json_valid(messages_json) THEN json_array_length(messages_json) ELSE 0 END AS message_count
          FROM coder_threads
          WHERE updated_at < ? OR (updated_at = ? AND id < ?)
          ORDER BY updated_at DESC, id DESC
          LIMIT ?
        `).all(before.updatedAt, before.updatedAt, before.id, safeLimit) as Array<Record<string, unknown>>
      : this.db.prepare(`
          SELECT id, title, created_at, updated_at,
            CASE WHEN json_valid(messages_json) THEN json_array_length(messages_json) ELSE 0 END AS message_count
          FROM coder_threads
          ORDER BY updated_at DESC, id DESC
          LIMIT ?
        `).all(safeLimit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      messageCount: Number(row.message_count) || 0,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }));
  }

  getThread(id: string): StoredCoderThread | null {
    const row = this.db.prepare(`
      SELECT id, title, messages_json, created_at, updated_at
      FROM coder_threads
      WHERE id = ?
    `).get(id) as Record<string, unknown> | undefined;

    return row ? {
      id: String(row.id),
      title: String(row.title),
      messages: safeJsonParse(String(row.messages_json || '[]'), []),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    } : null;
  }

  deleteThread(id: string): void {
    this.deleteThreadHistory(id);
  }

  clearThreads(): void {
    this.clearThreadHistory();
  }

  /** Return all execution runs owned by a conversation, including delegated children. */
  listAgentRunIdsForThread(threadId: string): string[] {
    const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : '';
    if (!normalizedThreadId) return [];
    const rows = this.db.prepare(`
      SELECT id, thread_id, metadata_json
      FROM agent_runs
    `).all() as Array<Record<string, unknown>>;
    const selected = new Set<string>();
    const metadataById = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const id = String(row.id);
      const metadata = safeJsonParse<Record<string, unknown>>(String(row.metadata_json || ''), {});
      metadataById.set(id, metadata);
      if (String(row.thread_id || '') === normalizedThreadId || metadata.parentSessionId === normalizedThreadId) {
        selected.add(id);
      }
    }

    // Include nested delegated runs even when their own thread_id is empty.
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, metadata] of metadataById) {
        if (!selected.has(id) && typeof metadata.parentRunId === 'string' && selected.has(metadata.parentRunId)) {
          selected.add(id);
          changed = true;
        }
      }
    }
    return [...selected];
  }

  /** Return all runs represented by the Coder thread history surface. */
  listAllThreadAgentRunIds(): string[] {
    const rows = this.db.prepare(`
      SELECT id, kind, thread_id, metadata_json
      FROM agent_runs
    `).all() as Array<Record<string, unknown>>;
    return rows
      .filter((row) => {
        const metadata = safeJsonParse<Record<string, unknown>>(String(row.metadata_json || ''), {});
        return row.kind === 'coder'
          || row.kind === 'agent'
          || typeof row.thread_id === 'string' && row.thread_id.trim().length > 0
          || typeof metadata.parentSessionId === 'string' && metadata.parentSessionId.trim().length > 0;
      })
      .map((row) => String(row.id));
  }

  private purgeThreadHistoryRows(
    threadId: string | undefined,
    runIds: string[],
    clearAllAudits: boolean,
  ): ThreadHistoryPurgeResult {
    const placeholders = runIds.map(() => '?').join(', ');
    const runParams = [...runIds];
    const countByRun = (table: string): number => {
      if (!runIds.length) return 0;
      const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE run_id IN (${placeholders})`).get(...runParams) as { count?: number };
      return Number(row.count || 0);
    };
    const result: ThreadHistoryPurgeResult = {
      threadsDeleted: 0,
      runsDeleted: runIds.length,
      eventsDeleted: countByRun('agent_run_events'),
      contextSnapshotsDeleted: countByRun('agent_run_context_snapshots'),
      inboxEntriesDeleted: countByRun('agent_run_inbox'),
      runAuditsDeleted: 0,
      protocolAuditsDeleted: 0,
    };

    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (clearAllAudits) {
        result.runAuditsDeleted = Number((this.db.prepare('SELECT COUNT(*) AS count FROM run_audits').get() as { count?: number }).count || 0);
        result.protocolAuditsDeleted = Number((this.db.prepare('SELECT COUNT(*) AS count FROM protocol_audits').get() as { count?: number }).count || 0);
        this.db.prepare('DELETE FROM run_audits').run();
        this.db.prepare('DELETE FROM protocol_audits').run();
      } else if (threadId) {
        const auditWhere = runIds.length
          ? `(thread_id = ? OR id = ? OR run_id IN (${placeholders}))`
          : '(thread_id = ? OR id = ?)';
        const auditParams = runIds.length ? [threadId, threadId, ...runParams] : [threadId, threadId];
        result.runAuditsDeleted = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM run_audits WHERE ${auditWhere}`).get(...auditParams) as { count?: number }).count || 0);
        result.protocolAuditsDeleted = countByRun('protocol_audits');
        this.db.prepare(`DELETE FROM run_audits WHERE ${auditWhere}`).run(...auditParams);
        if (runIds.length) this.db.prepare(`DELETE FROM protocol_audits WHERE run_id IN (${placeholders})`).run(...runParams);
      }

      if (runIds.length) {
        // Delete dependents explicitly so this remains correct for databases
        // created before foreign-key cascades were enabled.
        this.db.prepare(`DELETE FROM agent_run_events WHERE run_id IN (${placeholders})`).run(...runParams);
        this.db.prepare(`DELETE FROM agent_run_context_snapshots WHERE run_id IN (${placeholders})`).run(...runParams);
        this.db.prepare(`DELETE FROM agent_run_inbox WHERE run_id IN (${placeholders})`).run(...runParams);
        this.db.prepare(`DELETE FROM agent_runs WHERE id IN (${placeholders})`).run(...runParams);
      }
      if (threadId) {
        result.threadsDeleted = Number(this.db.prepare('DELETE FROM coder_threads WHERE id = ?').run(threadId).changes || 0);
      } else if (clearAllAudits) {
        result.threadsDeleted = Number(this.db.prepare('DELETE FROM coder_threads').run().changes || 0);
      }
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve the original error */ }
      throw error;
    }
  }

  deleteThreadHistory(threadId: string): ThreadHistoryPurgeResult {
    const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : '';
    if (!normalizedThreadId) return { threadsDeleted: 0, runsDeleted: 0, eventsDeleted: 0, contextSnapshotsDeleted: 0, inboxEntriesDeleted: 0, runAuditsDeleted: 0, protocolAuditsDeleted: 0 };
    return this.purgeThreadHistoryRows(normalizedThreadId, this.listAgentRunIdsForThread(normalizedThreadId), false);
  }

  clearThreadHistory(): ThreadHistoryPurgeResult {
    return this.purgeThreadHistoryRows(undefined, this.listAllThreadAgentRunIds(), true);
  }

  /** Rebuild the SQLite file after a history purge so deleted pages are returned to disk. */
  vacuum(): void {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    this.db.exec('VACUUM');
  }

  listConversationSessions(): StoredConversationSession[] {
    return this.listThreads();
  }

  listConversationSessionSummaries(
    limit = 50,
    before?: { updatedAt: number; id: string },
  ): StoredCoderThreadSummary[] {
    return this.listThreadSummaries(limit, before);
  }

  getConversationSession(id: string): StoredConversationSession | null {
    return this.getThread(id);
  }

  upsertConversationSession(session: StoredConversationSession): void {
    this.upsertThread(session);
  }

  deleteConversationSession(id: string): void {
    this.deleteThread(id);
  }

  clearConversationSessions(): void {
    this.clearThreads();
  }

  createAgentRun(run: StoredAgentRun): void {
    this.db.prepare(`
      INSERT INTO agent_runs (
        id, kind, thread_id, status, task, workspace, model, metadata_json,
        created_at, updated_at, finished_at, stop_reason, result_json, last_event_seq, seen_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id,
      run.kind,
      run.threadId ?? null,
      run.status,
      run.task,
      run.workspace ?? null,
      run.model ?? null,
      run.metadata === undefined ? null : JSON.stringify(run.metadata),
      run.createdAt,
      run.updatedAt,
      run.finishedAt ?? null,
      run.stopReason ?? null,
      run.result === undefined ? null : JSON.stringify(run.result),
      run.lastEventSeq,
      run.seenAt ?? null
    );
  }

  updateAgentRun(run: Partial<StoredAgentRun> & { id: string }): void {
    const current = this.getAgentRun(run.id);
    if (!current) return;
    const next: StoredAgentRun = { ...current, ...run, updatedAt: run.updatedAt ?? Date.now() };
    this.writeAgentRunRow(next);
  }

  private writeAgentRunRow(next: StoredAgentRun): void {
    this.db.prepare(`
      UPDATE agent_runs
      SET kind = ?, thread_id = ?, status = ?, task = ?, workspace = ?, model = ?,
        metadata_json = ?, updated_at = ?, finished_at = ?, stop_reason = ?,
        result_json = ?, last_event_seq = ?, seen_at = ?
      WHERE id = ?
    `).run(
      next.kind,
      next.threadId ?? null,
      next.status,
      next.task,
      next.workspace ?? null,
      next.model ?? null,
      next.metadata === undefined ? null : JSON.stringify(next.metadata),
      next.updatedAt,
      next.finishedAt ?? null,
      next.stopReason ?? null,
      next.result === undefined ? null : JSON.stringify(next.result),
      next.lastEventSeq,
      next.seenAt ?? null,
      next.id
    );
  }

  /**
   * Append an event and optional run projection in one SQLite transaction.
   * Callers that need a richer cross-store projection must still handle the
   * documented write-behind boundary outside this database transaction.
   */
  appendAgentRunEvent(event: StoredAgentRunEvent, projection?: AgentRunEventProjection): void {
    const envelope = normalizeHarnessEvent(event.event, {
      runId: event.runId,
      seq: event.seq,
      type: event.eventType,
      timestamp: event.createdAt,
    });
    if (envelope.runId !== event.runId || envelope.seq !== event.seq || envelope.type !== event.eventType) {
      throw new Error('Persisted harness event identity does not match its SQLite row.');
    }

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO agent_run_events (run_id, seq, event_type, event_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(event.runId, event.seq, event.eventType, JSON.stringify(envelope), event.createdAt);

      const current = this.getAgentRun(event.runId);
      if (current) {
        const next: StoredAgentRun = {
          ...current,
          ...(projection || {}),
          lastEventSeq: Math.max(current.lastEventSeq, event.seq),
          updatedAt: event.createdAt,
        };
        this.writeAgentRunRow(next);
      }
      if (projection?.contextSnapshot) this.writeAgentContextSnapshot(projection.contextSnapshot);
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve the original transaction error */ }
      throw error;
    }
  }

  upsertAgentRunContextSnapshot(snapshot: StoredAgentContextSnapshot): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.writeAgentContextSnapshot(snapshot);
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve the original transaction error */ }
      throw error;
    }
  }

  private writeAgentContextSnapshot(snapshot: StoredAgentContextSnapshot): void {
    if (!validateAgentContextSnapshot(snapshot)) {
      throw new Error('Invalid durable agent context snapshot.');
    }
    if (!this.getAgentRun(snapshot.runId)) {
      throw new Error(`Cannot persist a context snapshot for unknown run ${snapshot.runId}.`);
    }
    this.db.prepare(`
      INSERT INTO agent_run_context_snapshots (
        run_id, version, context_id, revision, event_seq, model,
        model_context_window, token_estimate, compaction_version,
        messages_json, evidence_ids_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        version = excluded.version,
        context_id = excluded.context_id,
        revision = excluded.revision,
        event_seq = excluded.event_seq,
        model = excluded.model,
        model_context_window = excluded.model_context_window,
        token_estimate = excluded.token_estimate,
        compaction_version = excluded.compaction_version,
        messages_json = excluded.messages_json,
        evidence_ids_json = excluded.evidence_ids_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run(
      snapshot.runId,
      snapshot.version,
      snapshot.contextId,
      snapshot.revision,
      snapshot.eventSeq,
      snapshot.model ?? null,
      snapshot.modelContextWindow ?? null,
      snapshot.tokenEstimate,
      snapshot.compactionVersion,
      JSON.stringify(snapshot.messages),
      JSON.stringify(snapshot.evidenceIds),
      snapshot.createdAt,
      snapshot.updatedAt,
    );
  }

  getAgentRunContextSnapshot(runId: string): StoredAgentContextSnapshot | null {
    const row = this.db.prepare(`
      SELECT run_id, version, context_id, revision, event_seq, model,
        model_context_window, token_estimate, compaction_version,
        messages_json, evidence_ids_json, created_at, updated_at
      FROM agent_run_context_snapshots
      WHERE run_id = ?
    `).get(runId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const snapshot: StoredAgentContextSnapshot = {
      version: Number(row.version) as StoredAgentContextSnapshot['version'],
      runId: String(row.run_id),
      contextId: String(row.context_id),
      revision: Number(row.revision),
      eventSeq: Number(row.event_seq),
      ...(row.model == null ? {} : { model: String(row.model) }),
      ...(row.model_context_window == null ? {} : { modelContextWindow: Number(row.model_context_window) }),
      tokenEstimate: Number(row.token_estimate),
      compactionVersion: String(row.compaction_version),
      messages: safeJsonParse(String(row.messages_json || '[]'), []),
      evidenceIds: safeJsonParse(String(row.evidence_ids_json || '[]'), []),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
    if (!validateAgentContextSnapshot(snapshot)) throw new Error(`Persisted context snapshot for run ${runId} is invalid.`);
    return snapshot;
  }

  getAgentRun(id: string): StoredAgentRun | null {
    const row = this.db.prepare(`
      SELECT id, kind, thread_id, status, task, workspace, model, metadata_json,
        created_at, updated_at, finished_at, stop_reason, result_json, last_event_seq, seen_at
      FROM agent_runs
      WHERE id = ?
    `).get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToAgentRun(row) : null;
  }

  listAgentRuns(limit = 50): StoredAgentRun[] {
    const rows = this.db.prepare(`
      SELECT id, kind, thread_id, status, task, workspace, model, metadata_json,
        created_at, updated_at, finished_at, stop_reason, result_json, last_event_seq, seen_at
      FROM agent_runs
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToAgentRun(row));
  }

  /** Lightweight rows for run pickers; checkpoints, traces, and results stay on the detail endpoint. */
  listAgentRunSummaries(limit = 50, kind?: string): StoredAgentRun[] {
    const kindFilter = kind ? 'WHERE kind = ?' : '';
    const rows = this.db.prepare(`
      SELECT id, kind, thread_id, status, task, workspace, model,
        CASE
          WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.displayTask')
          ELSE NULL
        END AS display_task,
        CASE
          WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.pacingProfile')
          ELSE NULL
        END AS pacing_profile,
        CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.continuationPreview.currentGoal') ELSE NULL END AS continuation_goal,
        CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.continuationPreview.remainingPlanItem') ELSE NULL END AS continuation_plan_item,
        CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.continuationPreview.latestUpdatedFile') ELSE NULL END AS continuation_updated_file,
        CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.continuationPreview.latestVerifiedCheck') ELSE NULL END AS continuation_verified_check,
        CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.continuationPreview.blocker') ELSE NULL END AS continuation_blocker,
        CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.parentRunId') ELSE NULL END AS parent_run_id,
        CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.continuationReason') ELSE NULL END AS continuation_reason,
        CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.continuationQuality.sourcePromptTokens') ELSE NULL END AS continuation_source_tokens,
        CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.continuationQuality.handoffPromptTokens') ELSE NULL END AS continuation_handoff_tokens,
        CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.continuationQuality.promptReductionRatio') ELSE NULL END AS continuation_reduction_ratio,
        CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.continuationQuality.repeatedParentActions') ELSE NULL END AS continuation_repeated_actions,
        CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.continuationQuality.staleParentFileReads') ELSE NULL END AS continuation_stale_reads,
        created_at, updated_at, finished_at, stop_reason, last_event_seq, seen_at
      FROM agent_runs
      ${kindFilter}
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(...(kind ? [kind, limit] : [limit])) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      kind: String(row.kind),
      threadId: row.thread_id == null ? undefined : String(row.thread_id),
      status: String(row.status) as StoredAgentRunStatus,
      task: String(row.task),
      workspace: row.workspace == null ? undefined : String(row.workspace),
      model: row.model == null ? undefined : String(row.model),
      metadata: {
        ...(row.display_task == null ? {} : { displayTask: String(row.display_task) }),
        ...(row.pacing_profile == null ? {} : { pacingProfile: String(row.pacing_profile) }),
        ...(row.continuation_goal == null ? {} : {
          continuationPreview: {
            currentGoal: String(row.continuation_goal),
            ...(row.continuation_plan_item == null ? {} : { remainingPlanItem: String(row.continuation_plan_item) }),
            ...(row.continuation_updated_file == null ? {} : { latestUpdatedFile: String(row.continuation_updated_file) }),
            ...(row.continuation_verified_check == null ? {} : { latestVerifiedCheck: String(row.continuation_verified_check) }),
            ...(row.continuation_blocker == null ? {} : { blocker: String(row.continuation_blocker) }),
          },
        }),
        ...(row.parent_run_id == null ? {} : { parentRunId: String(row.parent_run_id) }),
        ...(row.continuation_reason == null ? {} : { continuationReason: String(row.continuation_reason) }),
        ...(row.continuation_source_tokens == null ? {} : {
          continuationQuality: {
            sourcePromptTokens: Number(row.continuation_source_tokens),
            handoffPromptTokens: Number(row.continuation_handoff_tokens || 0),
            promptReductionRatio: Number(row.continuation_reduction_ratio || 0),
            repeatedParentActions: Number(row.continuation_repeated_actions || 0),
            staleParentFileReads: Number(row.continuation_stale_reads || 0),
          },
        }),
      },
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      finishedAt: row.finished_at == null ? undefined : Number(row.finished_at),
      stopReason: row.stop_reason == null ? undefined : String(row.stop_reason),
      lastEventSeq: Number(row.last_event_seq || 0),
      seenAt: row.seen_at == null ? undefined : Number(row.seen_at),
    }));
  }

  listAgentRunEvents(runId: string, afterSeq = 0, limit?: number): StoredAgentRunEvent[] {
    const normalizedLimit = Number.isInteger(limit) && (limit as number) > 0 ? Math.floor(limit as number) : undefined;
    const query = normalizedLimit
      ? `
          SELECT run_id, seq, event_type, event_json, created_at
          FROM agent_run_events
          WHERE run_id = ? AND seq > ?
          ORDER BY seq ASC
          LIMIT ?
        `
      : `
          SELECT run_id, seq, event_type, event_json, created_at
          FROM agent_run_events
          WHERE run_id = ? AND seq > ?
          ORDER BY seq ASC
        `;
    const rows = (normalizedLimit
      ? this.db.prepare(query).all(runId, afterSeq, normalizedLimit)
      : this.db.prepare(query).all(runId, afterSeq)) as Array<Record<string, unknown>>;

    return rows.map((row) => {
      const runId = String(row.run_id);
      const seq = Number(row.seq);
      const eventType = String(row.event_type);
      const createdAt = Number(row.created_at);
      let rawEvent: unknown;
      try {
        rawEvent = JSON.parse(String(row.event_json || '')) as unknown;
      } catch {
        throw new Error(`Persisted harness event ${runId}:${seq} is not valid JSON.`);
      }
      const event = normalizeHarnessEvent(rawEvent, {
        runId,
        seq,
        type: eventType,
        timestamp: createdAt,
      });
      if (event.runId !== runId || event.seq !== seq || event.type !== eventType) {
        throw new Error('Persisted harness event identity does not match its SQLite row.');
      }
      return { runId, seq, eventType, event, createdAt: event.timestamp };
    });
  }

  listAgentRunEventPage(runId: string, afterSeq = 0, limit = 250): StoredAgentRunEventPage {
    const pageSize = Number.isInteger(limit) && limit > 0 ? Math.floor(limit) : 250;
    const rows = this.listAgentRunEvents(runId, afterSeq, pageSize + 1);
    const hasMore = rows.length > pageSize;
    const events = hasMore ? rows.slice(0, pageSize) : rows;
    const nextSeq = events.at(-1)?.seq || afterSeq;
    const runRow = this.db.prepare(`
      SELECT last_event_seq
      FROM agent_runs
      WHERE id = ?
    `).get(runId) as { last_event_seq?: unknown } | undefined;
    const lastSeq = Math.max(events.at(-1)?.seq || 0, Number(runRow?.last_event_seq || 0));
    return { events, afterSeq, nextSeq, lastSeq, hasMore };
  }

  listAgentRunInbox(runId: string, options: AgentInboxListOptions = {}): StoredAgentInboxEntry[] {
    this.migrateLegacyInbox(runId);
    const clauses = ['run_id = ?'];
    const params: Array<string | number> = [runId];
    if (options.status) {
      clauses.push('status = ?');
      params.push(options.status);
    }
    if (options.target) {
      clauses.push('target = ?');
      params.push(options.target);
    }
    const rows = this.db.prepare(`
      SELECT run_id, message_id, inbox_seq, source, target, message, status,
        created_at, updated_at, claimed_at, claimed_by, cancelled_at, processed_at
      FROM agent_run_inbox
      WHERE ${clauses.join(' AND ')}
      ORDER BY inbox_seq ASC
    `).all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToAgentInboxEntry(row));
  }

  getAgentRunInboxEntry(runId: string, messageId: string): StoredAgentInboxEntry | null {
    this.migrateLegacyInbox(runId);
    const row = this.db.prepare(`
      SELECT run_id, message_id, inbox_seq, source, target, message, status,
        created_at, updated_at, claimed_at, claimed_by, cancelled_at, processed_at
      FROM agent_run_inbox
      WHERE run_id = ? AND message_id = ?
    `).get(runId, messageId) as Record<string, unknown> | undefined;
    return row ? this.rowToAgentInboxEntry(row) : null;
  }

  enqueueAgentInbox(input: AgentInboxEnqueueInput): StoredAgentInboxEntry {
    this.migrateLegacyInbox(input.runId);
    const now = input.createdAt ?? Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existingRow = this.db.prepare(`
        SELECT run_id, message_id, inbox_seq, source, target, message, status,
          created_at, updated_at, claimed_at, claimed_by, cancelled_at, processed_at
        FROM agent_run_inbox
        WHERE run_id = ? AND message_id = ?
      `).get(input.runId, input.messageId) as Record<string, unknown> | undefined;
      if (existingRow) {
        const existing = this.rowToAgentInboxEntry(existingRow);
        if (existing.status === 'pending') throw new AgentInboxConflictError();
        this.db.exec('COMMIT');
        return existing;
      }
      const nextSeq = Number((this.db.prepare(`
        SELECT COALESCE(MAX(inbox_seq), 0) + 1 AS next_seq
        FROM agent_run_inbox
        WHERE run_id = ?
      `).get(input.runId) as { next_seq?: unknown }).next_seq || 1);
      this.db.prepare(`
        INSERT INTO agent_run_inbox (
          run_id, message_id, inbox_seq, source, target, message, status,
          created_at, updated_at, claimed_at, claimed_by, cancelled_at, processed_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, NULL, NULL)
      `).run(
        input.runId,
        input.messageId,
        nextSeq,
        input.source,
        input.target,
        input.message,
        now,
        now,
      );
      this.refreshInboxSummary(input.runId);
      const inserted = this.db.prepare(`
        SELECT run_id, message_id, inbox_seq, source, target, message, status,
          created_at, updated_at, claimed_at, claimed_by, cancelled_at, processed_at
        FROM agent_run_inbox
        WHERE run_id = ? AND message_id = ?
      `).get(input.runId, input.messageId) as Record<string, unknown>;
      this.db.exec('COMMIT');
      return this.rowToAgentInboxEntry(inserted);
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve the original error */ }
      throw error;
    }
  }

  claimAgentRunInbox(
    runId: string,
    target: AgentInboxTarget,
    claimId: string,
    limit = target === 'next-turn' ? 1 : 20,
  ): StoredAgentInboxEntry[] {
    this.migrateLegacyInbox(runId);
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const alreadyClaimed = this.db.prepare(`
        SELECT run_id, message_id, inbox_seq, source, target, message, status,
          created_at, updated_at, claimed_at, claimed_by, cancelled_at, processed_at
        FROM agent_run_inbox
        WHERE run_id = ? AND target = ? AND status = 'claimed' AND claimed_by = ?
        ORDER BY inbox_seq ASC
      `).all(runId, target, claimId) as Array<Record<string, unknown>>;
      if (alreadyClaimed.length > 0) {
        this.db.exec('COMMIT');
        return alreadyClaimed.map((row) => this.rowToAgentInboxEntry(row));
      }

      const rows = this.db.prepare(`
        SELECT message_id
        FROM agent_run_inbox
        WHERE run_id = ? AND target = ? AND status = 'pending'
        ORDER BY inbox_seq ASC
        LIMIT ?
      `).all(runId, target, boundedLimit) as Array<Record<string, unknown>>;
      const now = Date.now();
      const update = this.db.prepare(`
        UPDATE agent_run_inbox
        SET status = 'claimed', updated_at = ?, claimed_at = ?, claimed_by = ?
        WHERE run_id = ? AND message_id = ? AND status = 'pending'
      `);
      for (const row of rows) {
        update.run(now, now, claimId, runId, String(row.message_id));
      }
      this.refreshInboxSummary(runId);
      const claimed = this.db.prepare(`
        SELECT run_id, message_id, inbox_seq, source, target, message, status,
          created_at, updated_at, claimed_at, claimed_by, cancelled_at, processed_at
        FROM agent_run_inbox
        WHERE run_id = ? AND target = ? AND status = 'claimed' AND claimed_by = ?
        ORDER BY inbox_seq ASC
      `).all(runId, target, claimId) as Array<Record<string, unknown>>;
      this.db.exec('COMMIT');
      return claimed.map((row) => this.rowToAgentInboxEntry(row));
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve the original error */ }
      throw error;
    }
  }

  processAgentRunInboxEntry(runId: string, messageId: string, claimId?: string): StoredAgentInboxEntry | null {
    this.migrateLegacyInbox(runId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare(`
        SELECT run_id, message_id, inbox_seq, source, target, message, status,
          created_at, updated_at, claimed_at, claimed_by, cancelled_at, processed_at
        FROM agent_run_inbox
        WHERE run_id = ? AND message_id = ?
      `).get(runId, messageId) as Record<string, unknown> | undefined;
      if (!row) {
        this.db.exec('COMMIT');
        return null;
      }
      const existing = this.rowToAgentInboxEntry(row);
      if (existing.status === 'processed') {
        this.db.exec('COMMIT');
        return existing;
      }
      if (existing.status !== 'claimed' || (claimId && existing.claimedBy !== claimId)) {
        this.db.exec('COMMIT');
        return null;
      }
      const now = Date.now();
      this.db.prepare(`
        UPDATE agent_run_inbox
        SET status = 'processed', updated_at = ?, processed_at = ?, claimed_at = NULL, claimed_by = NULL
        WHERE run_id = ? AND message_id = ? AND status = 'claimed'
      `).run(now, now, runId, messageId);
      this.refreshInboxSummary(runId);
      const processed = this.db.prepare(`
        SELECT run_id, message_id, inbox_seq, source, target, message, status,
          created_at, updated_at, claimed_at, claimed_by, cancelled_at, processed_at
        FROM agent_run_inbox
        WHERE run_id = ? AND message_id = ?
      `).get(runId, messageId) as Record<string, unknown>;
      this.db.exec('COMMIT');
      return this.rowToAgentInboxEntry(processed);
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve the original error */ }
      throw error;
    }
  }

  replaceAgentRunInboxEntry(
    runId: string,
    messageId: string,
    input: { message: string; source?: string; target?: AgentInboxTarget },
  ): StoredAgentInboxEntry | null {
    this.migrateLegacyInbox(runId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare(`
        SELECT run_id, message_id, inbox_seq, source, target, message, status,
          created_at, updated_at, claimed_at, claimed_by, cancelled_at, processed_at
        FROM agent_run_inbox
        WHERE run_id = ? AND message_id = ?
      `).get(runId, messageId) as Record<string, unknown> | undefined;
      if (!row) {
        this.db.exec('COMMIT');
        return null;
      }
      const existing = this.rowToAgentInboxEntry(row);
      if (existing.status !== 'pending') {
        this.db.exec('COMMIT');
        return null;
      }
      const nextSource = input.source ?? existing.source;
      const nextTarget = input.target ?? existing.target;
      if (existing.message === input.message && existing.source === nextSource && existing.target === nextTarget) {
        this.db.exec('COMMIT');
        return existing;
      }
      const now = Date.now();
      this.db.prepare(`
        UPDATE agent_run_inbox
        SET source = ?, target = ?, message = ?, updated_at = ?
        WHERE run_id = ? AND message_id = ? AND status = 'pending'
      `).run(nextSource, nextTarget, input.message, now, runId, messageId);
      this.refreshInboxSummary(runId);
      const replaced = this.db.prepare(`
        SELECT run_id, message_id, inbox_seq, source, target, message, status,
          created_at, updated_at, claimed_at, claimed_by, cancelled_at, processed_at
        FROM agent_run_inbox
        WHERE run_id = ? AND message_id = ?
      `).get(runId, messageId) as Record<string, unknown>;
      this.db.exec('COMMIT');
      return this.rowToAgentInboxEntry(replaced);
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve the original error */ }
      throw error;
    }
  }

  cancelAgentRunInboxEntry(runId: string, messageId: string): StoredAgentInboxEntry | null {
    this.migrateLegacyInbox(runId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare(`
        SELECT run_id, message_id, inbox_seq, source, target, message, status,
          created_at, updated_at, claimed_at, claimed_by, cancelled_at, processed_at
        FROM agent_run_inbox
        WHERE run_id = ? AND message_id = ?
      `).get(runId, messageId) as Record<string, unknown> | undefined;
      if (!row) {
        this.db.exec('COMMIT');
        return null;
      }
      const existing = this.rowToAgentInboxEntry(row);
      if (existing.status === 'cancelled') {
        this.db.exec('COMMIT');
        return existing;
      }
      if (existing.status === 'processed') {
        this.db.exec('COMMIT');
        return null;
      }
      const now = Date.now();
      this.db.prepare(`
        UPDATE agent_run_inbox
        SET status = 'cancelled', updated_at = ?, cancelled_at = ?, claimed_at = NULL, claimed_by = NULL
        WHERE run_id = ? AND message_id = ? AND status IN ('pending', 'claimed')
      `).run(now, now, runId, messageId);
      this.refreshInboxSummary(runId);
      const cancelled = this.db.prepare(`
        SELECT run_id, message_id, inbox_seq, source, target, message, status,
          created_at, updated_at, claimed_at, claimed_by, cancelled_at, processed_at
        FROM agent_run_inbox
        WHERE run_id = ? AND message_id = ?
      `).get(runId, messageId) as Record<string, unknown>;
      this.db.exec('COMMIT');
      return this.rowToAgentInboxEntry(cancelled);
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve the original error */ }
      throw error;
    }
  }

  clearAgentRunInbox(runId: string, target?: AgentInboxTarget): StoredAgentInboxEntry[] {
    this.migrateLegacyInbox(runId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const clauses = ["run_id = ?", "status IN ('pending', 'claimed')"];
      const params: Array<string | number> = [runId];
      if (target) {
        clauses.push('target = ?');
        params.push(target);
      }
      const selectedRows = this.db.prepare(`
        SELECT message_id
        FROM agent_run_inbox
        WHERE ${clauses.join(' AND ')}
      `).all(...params) as Array<Record<string, unknown>>;
      if (selectedRows.length === 0) {
        this.db.exec('COMMIT');
        return [];
      }
      const now = Date.now();
      this.db.prepare(`
        UPDATE agent_run_inbox
        SET status = 'cancelled', updated_at = ?, cancelled_at = ?, claimed_at = NULL, claimed_by = NULL
        WHERE ${clauses.join(' AND ')}
      `).run(now, now, ...params);
      this.refreshInboxSummary(runId);
      const ids = selectedRows.map((row) => String(row.message_id));
      const rows = this.db.prepare(`
        SELECT run_id, message_id, inbox_seq, source, target, message, status,
          created_at, updated_at, claimed_at, claimed_by, cancelled_at, processed_at
        FROM agent_run_inbox
        WHERE run_id = ? AND message_id IN (${ids.map(() => '?').join(',')})
        ORDER BY inbox_seq ASC
      `).all(runId, ...ids) as Array<Record<string, unknown>>;
      this.db.exec('COMMIT');
      return rows.map((row) => this.rowToAgentInboxEntry(row));
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve the original error */ }
      throw error;
    }
  }

  releaseAgentRunInboxClaims(runId: string): StoredAgentInboxEntry[] {
    this.migrateLegacyInbox(runId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const now = Date.now();
      this.db.prepare(`
        UPDATE agent_run_inbox
        SET status = 'pending', updated_at = ?, claimed_at = NULL, claimed_by = NULL
        WHERE run_id = ? AND status = 'claimed'
      `).run(now, runId);
      this.refreshInboxSummary(runId);
      const rows = this.db.prepare(`
        SELECT run_id, message_id, inbox_seq, source, target, message, status,
          created_at, updated_at, claimed_at, claimed_by, cancelled_at, processed_at
        FROM agent_run_inbox
        WHERE run_id = ? AND status = 'pending'
        ORDER BY inbox_seq ASC
      `).all(runId) as Array<Record<string, unknown>>;
      this.db.exec('COMMIT');
      return rows.map((row) => this.rowToAgentInboxEntry(row));
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve the original error */ }
      throw error;
    }
  }

  copyPendingAgentInbox(sourceRunId: string, targetRunId: string): StoredAgentInboxEntry[] {
    if (sourceRunId === targetRunId) return [];
    this.migrateLegacyInbox(sourceRunId);
    this.migrateLegacyInbox(targetRunId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const sourceRows = this.db.prepare(`
        SELECT run_id, message_id, inbox_seq, source, target, message, status,
          created_at, updated_at, claimed_at, claimed_by, cancelled_at, processed_at
        FROM agent_run_inbox
        WHERE run_id = ? AND status IN ('pending', 'claimed')
        ORDER BY inbox_seq ASC
      `).all(sourceRunId) as Array<Record<string, unknown>>;
      let nextSeq = Number((this.db.prepare(`
        SELECT COALESCE(MAX(inbox_seq), 0) + 1 AS next_seq
        FROM agent_run_inbox
        WHERE run_id = ?
      `).get(targetRunId) as { next_seq?: unknown }).next_seq || 1);
      const insert = this.db.prepare(`
        INSERT OR IGNORE INTO agent_run_inbox (
          run_id, message_id, inbox_seq, source, target, message, status,
          created_at, updated_at, claimed_at, claimed_by, cancelled_at, processed_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, NULL, NULL)
      `);
      for (const row of sourceRows) {
        const result = insert.run(
          targetRunId,
          String(row.message_id),
          nextSeq,
          String(row.source),
          String(row.target),
          String(row.message),
          Number(row.created_at),
          Date.now(),
        );
        if (Number(result.changes || 0) > 0) nextSeq += 1;
      }
      this.refreshInboxSummary(targetRunId);
      const copied = this.db.prepare(`
        SELECT run_id, message_id, inbox_seq, source, target, message, status,
          created_at, updated_at, claimed_at, claimed_by, cancelled_at, processed_at
        FROM agent_run_inbox
        WHERE run_id = ? AND status = 'pending'
        ORDER BY inbox_seq ASC
      `).all(targetRunId) as Array<Record<string, unknown>>;
      this.db.exec('COMMIT');
      return copied.map((row) => this.rowToAgentInboxEntry(row));
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve the original error */ }
      throw error;
    }
  }

  private migrateLegacyInbox(runId: string): void {
    const run = this.getAgentRun(runId);
    if (!run || !run.metadata || typeof run.metadata !== 'object' || Array.isArray(run.metadata)) return;
    const metadata = run.metadata as Record<string, unknown>;
    if (!Array.isArray(metadata.queuedMessages)) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      let nextSeq = Number((this.db.prepare(`
        SELECT COALESCE(MAX(inbox_seq), 0) + 1 AS next_seq
        FROM agent_run_inbox
        WHERE run_id = ?
      `).get(runId) as { next_seq?: unknown }).next_seq || 1);
      const insert = this.db.prepare(`
        INSERT OR IGNORE INTO agent_run_inbox (
          run_id, message_id, inbox_seq, source, target, message, status,
          created_at, updated_at, claimed_at, claimed_by, cancelled_at, processed_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, NULL, NULL)
      `);
      for (const item of metadata.queuedMessages) {
        if (!item || typeof item !== 'object') continue;
        const value = item as Record<string, unknown>;
        const message = typeof value.message === 'string' ? value.message.trim().slice(0, 8_000) : '';
        if (!message) continue;
        const messageId = typeof value.id === 'string' && value.id.trim() ? value.id : randomUUID();
        const source = typeof value.source === 'string' && value.source.trim() ? value.source.slice(0, 80) : 'legacy';
        const createdAt = typeof value.queuedAt === 'number' && Number.isFinite(value.queuedAt) ? value.queuedAt : Date.now();
        const result = insert.run(runId, messageId, nextSeq, source, 'next-turn', message, createdAt, createdAt);
        if (Number(result.changes || 0) > 0) nextSeq += 1;
      }
      const retained = { ...metadata };
      delete retained.queuedMessages;
      delete retained.queuedMessageCount;
      const migratedRun = { ...run, metadata: retained, updatedAt: Date.now() };
      this.writeAgentRunRow(migratedRun);
      this.refreshInboxSummary(runId);
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve the original error */ }
      throw error;
    }
  }

  private refreshInboxSummary(runId: string): void {
    const countRow = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM agent_run_inbox
      WHERE run_id = ? AND status IN ('pending', 'claimed')
    `).get(runId) as { count?: unknown };
    const count = Number(countRow?.count || 0);
    const run = this.getAgentRun(runId);
    if (!run) return;
    const metadata = run.metadata && typeof run.metadata === 'object' && !Array.isArray(run.metadata)
      ? { ...(run.metadata as Record<string, unknown>) }
      : {};
    if (count > 0) {
      metadata.queuedMessageCount = count;
      metadata.inboxPendingCount = count;
    } else {
      delete metadata.queuedMessageCount;
      delete metadata.inboxPendingCount;
    }
    this.writeAgentRunRow({ ...run, metadata, updatedAt: Date.now() });
  }

  private rowToAgentInboxEntry(row: Record<string, unknown>): StoredAgentInboxEntry {
    return {
      runId: String(row.run_id),
      messageId: String(row.message_id),
      inboxSeq: Number(row.inbox_seq),
      source: String(row.source),
      target: String(row.target) as AgentInboxTarget,
      message: String(row.message),
      status: String(row.status) as AgentInboxStatus,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      ...(row.claimed_at == null ? {} : { claimedAt: Number(row.claimed_at) }),
      ...(row.claimed_by == null ? {} : { claimedBy: String(row.claimed_by) }),
      ...(row.cancelled_at == null ? {} : { cancelledAt: Number(row.cancelled_at) }),
      ...(row.processed_at == null ? {} : { processedAt: Number(row.processed_at) }),
    };
  }

  markRunningAgentRunsInterrupted(reason = 'Server restarted before the run completed.'): void {
    const now = Date.now();
    this.db.prepare(`
      UPDATE agent_runs
      SET status = 'interrupted', updated_at = ?, finished_at = ?, stop_reason = ?
      WHERE status IN ('running', 'waiting_for_user', 'waiting_for_provider')
    `).run(now, now, reason);
  }

  markAgentRunSeen(id: string): void {
    this.db.prepare(`
      UPDATE agent_runs
      SET seen_at = ?, updated_at = ?
      WHERE id = ?
    `).run(Date.now(), Date.now(), id);
  }

  private rowToAgentRun(row: Record<string, unknown>): StoredAgentRun {
    return {
      id: String(row.id),
      kind: String(row.kind),
      threadId: row.thread_id == null ? undefined : String(row.thread_id),
      status: String(row.status) as StoredAgentRunStatus,
      task: String(row.task),
      workspace: row.workspace == null ? undefined : String(row.workspace),
      model: row.model == null ? undefined : String(row.model),
      metadata: safeJsonParse(String(row.metadata_json || ''), undefined),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      finishedAt: row.finished_at == null ? undefined : Number(row.finished_at),
      stopReason: row.stop_reason == null ? undefined : String(row.stop_reason),
      result: safeJsonParse(String(row.result_json || ''), undefined),
      lastEventSeq: Number(row.last_event_seq || 0),
      seenAt: row.seen_at == null ? undefined : Number(row.seen_at),
    };
  }

  upsertMemory(memory: StoredMemory): void {
    this.db.prepare(`
      INSERT INTO memory_items (id, scope, content, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        scope = excluded.scope,
        content = excluded.content,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      memory.id,
      memory.scope,
      memory.content,
      memory.metadata === undefined ? null : JSON.stringify(memory.metadata),
      memory.createdAt,
      memory.updatedAt
    );
  }

  listMemories(scope = 'global', limit = 50): StoredMemory[] {
    const rows = this.db.prepare(`
      SELECT id, scope, content, metadata_json, created_at, updated_at
      FROM memory_items
      WHERE scope = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(scope, limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      scope: String(row.scope),
      content: String(row.content),
      metadata: safeJsonParse(String(row.metadata_json || 'null'), null),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }));
  }

  deleteMemory(id: string): void {
    this.db.prepare('DELETE FROM memory_items WHERE id = ?').run(id);
  }

  replaceNvidiaModelTargets(targets: StoredNvidiaModelTarget[]): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM nvidia_model_targets').run();
      const insert = this.db.prepare(`
        INSERT INTO nvidia_model_targets (
          id, title, model_id, api_key_index, api_family, endpoint,
          temperature, max_tokens, top_p, stream, supports_streaming, supports_tools,
          notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const target of targets) {
        insert.run(
          target.id,
          target.title,
          target.modelId,
          target.apiKeyIndex,
          target.apiFamily,
          target.endpoint,
          target.temperature ?? null,
          target.maxTokens ?? null,
          target.topP ?? null,
          target.stream === true ? 1 : 0,
          target.supportsStreaming === false ? 0 : 1,
          target.supportsTools === true ? 1 : 0,
          target.notes ?? null,
          target.createdAt,
          target.updatedAt
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listNvidiaModelTargets(): StoredNvidiaModelTarget[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM nvidia_model_targets
      ORDER BY updated_at DESC, title ASC
    `).all() as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      modelId: String(row.model_id),
      apiKeyIndex: Number(row.api_key_index),
      apiFamily: String(row.api_family),
      endpoint: String(row.endpoint),
      temperature: row.temperature === null || row.temperature === undefined ? undefined : Number(row.temperature),
      maxTokens: row.max_tokens === null || row.max_tokens === undefined ? undefined : Number(row.max_tokens),
      topP: row.top_p === null || row.top_p === undefined ? undefined : Number(row.top_p),
      stream: Boolean(row.stream),
      supportsStreaming: Boolean(row.supports_streaming),
      supportsTools: Boolean(row.supports_tools),
      notes: row.notes === null || row.notes === undefined ? undefined : String(row.notes),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }));
  }

  saveValue(key: string, value: JsonValue): void {
    this.db.prepare(`
      INSERT INTO kv_store (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), new Date().toISOString());
  }

  loadValue<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value_json FROM kv_store WHERE key = ?').get(key) as { value_json: string } | undefined;
    return row ? safeJsonParse<T | null>(row.value_json, null) : null;
  }

  deleteValue(key: string): void {
    this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
  }

  hasValue(key: string): boolean {
    const row = this.db.prepare('SELECT 1 AS found FROM kv_store WHERE key = ?').get(key);
    return Boolean(row);
  }

  valueKeys(): string[] {
    const rows = this.db.prepare('SELECT key FROM kv_store ORDER BY key').all() as Array<{ key: string }>;
    return rows.map((row) => row.key);
  }

  clearValues(): void {
    this.db.prepare('DELETE FROM kv_store').run();
  }
}

function migrateLegacyDatabaseFile(nextDbPath: string): void {
  if (existsSync(nextDbPath)) return;

  const legacyDbPath = LEGACY_DB_PATHS.find((candidate) => existsSync(candidate));
  if (!legacyDbPath) return;

  mkdirSync(path.dirname(nextDbPath), { recursive: true });
  copyFileSync(legacyDbPath, nextDbPath);

  for (const suffix of ['-wal', '-shm']) {
    const legacySidecar = `${legacyDbPath}${suffix}`;
    if (existsSync(legacySidecar)) {
      copyFileSync(legacySidecar, `${nextDbPath}${suffix}`);
    }
  }
}

function formatLegacyRawRunLog(report: any): string {
  const steps = Array.isArray(report.steps) ? report.steps : [];
  const trace = steps
    .map((step: any, index: number) => {
      const stepNumber = step.step ?? index + 1;
      const actionInput = step.actionInput ?? step.action_input ?? {};
      const observation = String(step.observation || '').substring(0, 500).trim().replace(/\n/g, '\n  ');
      const trimmedNotice = String(step.observation || '').length > 500 ? '\n  ... [truncated]' : '';

      return `[Step ${stepNumber}]
Thought:
  ${String(step.thought || '').trim().replace(/\n/g, '\n  ')}
Action: ${step.action || ''}
Arguments: ${JSON.stringify(actionInput)}
Observation:
  ${observation}${trimmedNotice}`;
    })
    .join('\n---------------------------------------------\n');

  return `
=============================================
REACT RUN REPORT (ID: ${report.id})
=============================================
Timestamp   : ${report.timestamp}
Task        : "${report.task}"
Model Used  : ${report.model}
Success     : ${report.success ? 'YES' : 'NO'}
Steps Taken : ${report.stepCount ?? steps.length}
Total Cost  : ${Number(report.totalPollenCost || 0).toFixed(5)} Pollen
Budget Limit: ${report.budget ?? 0}
---------------------------------------------
${report.error ? `Error: ${report.error}\n` : ''}${report.finalAnswer ? `Final Answer:\n${report.finalAnswer}\n` : ''}
Execution Trace:
${trace}
=============================================
`;
}

export function getSQLiteAppStore(): SQLiteAppStore {
  if (!sharedStore) {
    sharedStore = new SQLiteAppStore();
  }
  return sharedStore;
}
