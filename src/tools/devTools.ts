import * as fs from 'fs/promises';
import { basename, dirname, join, resolve, isAbsolute, relative } from 'path';
import { cwd } from 'process';
import { z } from 'zod/v4';
import { createHash } from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

import {
  BashSchema,
  PackageInstallSchema,
  CommandSchema,
  ReadFileSchema,
  DocumentReadSchema,
  WriteFileSchema,
  EditFileSchema,
  GlobSchema,
  WorkspaceChangesSchema,
  GrepSchema,
  WebSearchSchema,
  NoteSchema,
  SampleSchema,
  WikiSchema,
  BashParamsSchema,
  PackageInstallParamsSchema,
  ReadFileParamsSchema,
  DocumentReadParamsSchema,
  WriteFileParamsSchema,
  EditFileParamsSchema,
  GlobParamsSchema,
  WorkspaceChangesParamsSchema,
  GrepParamsSchema,
  WebSearchParamsSchema,
  NoteParamsSchema,
  SampleParamsSchema,
  WikiParamsSchema,
  TaskCreateParamsSchema,
  TaskUpdateParamsSchema,
  SubAgentParamsSchema,
  type BashParams,
  type PackageInstallParams,
  CommandParamsSchema,
  type CommandParams,
  type ReadFileParams,
  type DocumentReadParams,
  type WriteFileParams,
  type EditFileParams,
  type GlobParams,
  type WorkspaceChangesParams,
  type GrepParams,
  type WebSearchParams,
  type NoteParams,
  type SampleParams,
  type WikiParams,
  type TaskCreateParams,
  type TaskUpdateParams,
  type SubAgentParams,
} from '../types/schemas.js';
import { webSearchTool } from './webSearch.js';
import { projectNoteTool } from './noteTool.js';
import { projectSampleTool } from './sampleTool.js';
import { projectWikiTool } from './wikiTool.js';
import { loadKnowledgeSettings } from './knowledgeSettings.js';
import { decodeBase64Utf8, validateTextIntegrity } from './textIntegrity.js';

import { 
  validateAndResolvePath, 
  PathValidationError,
  isPathWithinWorkspace,
  getValidationErrorDetails,
} from '@barok/adapter-node';

import {
  executeWithTimeout,
  getToolTimeout,
  ToolTimeoutError,
  ToolCancellationError,
  type ToolTimeoutConfig,
} from './executionTimeout.js';
import { getRuntimeToolTimeouts } from '../config/runtimeSettings.js';
import { detectCommandEnvironment, executeCommandInvocation, executeLegacyShell, normalizeVerificationShellCommand, resolveCommandOperation } from '@barok/adapter-node';
import { evaluatePolicy, type PolicyContext } from './permissionPolicy.js';
import { extractDocumentText, isStructuredDocumentPath } from './documentReader.js';
import { getToolCapabilities, type ToolCapabilities } from '@barok/engine';
import {
  assertDelegationRoleAllowed,
  getDelegationSettings,
  selectDelegationRoute,
  validateDelegationSettings,
  withDelegationConcurrency,
} from '../config/delegationRouting.js';

let workspaceDir: string | undefined;
const scopedWorkspace = new AsyncLocalStorage<string>();
let toolTimeoutConfig: Partial<ToolTimeoutConfig> = {};
let directToolPolicyContext: PolicyContext | (() => PolicyContext) | undefined;
const engineAppRoot = resolve(process.env.REACT_ENGINE_APP_ROOT || cwd());

export interface FileMutationIntent {
  path: string;
  operation: 'create' | 'modify' | 'delete';
  expectedHash?: string;
  allowCreate?: boolean;
  allowOverwrite?: boolean;
  reason: string;
  relatedTaskId: string;
}

interface GuardedReadRecord {
  path: string;
  absolutePath: string;
  hash: string;
  readAt: number;
}

interface FileMutationGuardContext {
  enabled: boolean;
  relatedTaskId: string;
  intents: Map<string, FileMutationIntent>;
  reads: Map<string, GuardedReadRecord>;
  createdFiles: Set<string>;
}

let mutationGuardContext: FileMutationGuardContext | undefined;

export function setWorkspace(dir: string) {
  workspaceDir = resolve(dir);
}

export function getWorkspace(): string {
  return scopedWorkspace.getStore() || workspaceDir || process.cwd();
}

/** Keeps each concurrent agent's tool calls inside its own selected workspace. */
export function runWithWorkspace<T>(dir: string, callback: () => T): T {
  return scopedWorkspace.run(resolve(dir), callback);
}

/** Installs the same policy context for callers that invoke dev tools directly. */
export function setDirectToolPolicy(context?: PolicyContext | (() => PolicyContext)): () => void {
  const previous = directToolPolicyContext;
  directToolPolicyContext = context;
  return () => { directToolPolicyContext = previous; };
}

function directPolicyError(action: string, action_input: Record<string, unknown>): ToolResult | undefined {
  if (!directToolPolicyContext) return undefined;
  const context = typeof directToolPolicyContext === 'function' ? directToolPolicyContext() : directToolPolicyContext;
  const decision = evaluatePolicy({ action, action_input }, context);
  if (decision.allowed) return undefined;
  return { success: false, error: `Policy blocked action: ${decision.reason}`, policy: decision } as ToolResult;
}

export function setToolTimeouts(config: Partial<ToolTimeoutConfig>) {
  toolTimeoutConfig = { ...config };
}

function getActiveToolTimeoutConfig(): ToolTimeoutConfig {
  return { ...getRuntimeToolTimeouts(), ...toolTimeoutConfig };
}

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function toWorkspaceRelativePath(absolutePath: string): string {
  return relative(getWorkspace(), absolutePath).replace(/\\/g, '/');
}

export function enableFileMutationGuard(params: {
  relatedTaskId: string;
  intents?: FileMutationIntent[];
}): () => void {
  const previous = mutationGuardContext;
  const next: FileMutationGuardContext = {
    enabled: true,
    relatedTaskId: params.relatedTaskId,
    intents: new Map((params.intents || []).map((intent) => [intent.path.replace(/\\/g, '/'), intent])),
    reads: new Map(),
    createdFiles: new Set(),
  };
  mutationGuardContext = next;
  return () => {
    if (mutationGuardContext === next) mutationGuardContext = previous;
  };
}

export function disableFileMutationGuard(): void {
  mutationGuardContext = undefined;
}

export function getReadFileHash(filePath: string): string | undefined {
  if (!mutationGuardContext?.enabled) return undefined;
  const resolved = resolvePath(filePath);
  const relativePath = toWorkspaceRelativePath(resolved);
  return mutationGuardContext.reads.get(relativePath)?.hash;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getPlannedIntent(relativePath: string): FileMutationIntent | undefined {
  return mutationGuardContext?.intents.get(relativePath);
}

async function validateGuardedWrite(
  resolved: string,
  params: WriteFileParams
): Promise<ToolResult | null> {
  if (!mutationGuardContext?.enabled) return null;

  const relativePath = toWorkspaceRelativePath(resolved);
  const exists = await pathExists(resolved);
  const intent = getPlannedIntent(relativePath);
  const createdInRun = mutationGuardContext.createdFiles.has(relativePath);

  if (!exists) {
    if (params.allowCreate !== true && intent?.operation !== 'create' && intent?.allowCreate !== true) {
      return {
        success: false,
        error: `Guarded mutation rejected: creating ${relativePath} requires allowCreate or a create plan intent.`,
      };
    }
    return null;
  }

  if (createdInRun && params.append) {
    return null;
  }

  if (!params.append && params.allowOverwrite !== true && intent?.allowOverwrite !== true) {
    return {
      success: false,
      error: `Guarded mutation rejected: overwriting existing file ${relativePath} requires allowOverwrite.`,
    };
  }

  const readRecord = mutationGuardContext.reads.get(relativePath);
  if (!readRecord) {
    return {
      success: false,
      error: `Guarded mutation rejected: ${relativePath} must be read before modification.`,
    };
  }

  if (!params.expectedHash) {
    return {
      success: false,
      error: `Guarded mutation rejected: ${relativePath} requires expectedHash from a prior read.`,
    };
  }

  const currentHash = hashContent(await fs.readFile(resolved, 'utf-8'));
  if (params.expectedHash !== readRecord.hash || currentHash !== readRecord.hash) {
    return {
      success: false,
      error: `Guarded mutation rejected: ${relativePath} changed since it was read.`,
    };
  }

  return null;
}

async function validateGuardedEdit(
  resolved: string,
  params: EditFileParams
): Promise<ToolResult | null> {
  if (!mutationGuardContext?.enabled) return null;

  const relativePath = toWorkspaceRelativePath(resolved);
  const intent = getPlannedIntent(relativePath);
  if (intent && intent.operation !== 'modify') {
    return {
      success: false,
      error: `Guarded mutation rejected: planned operation for ${relativePath} is ${intent.operation}, not modify.`,
    };
  }

  const readRecord = mutationGuardContext.reads.get(relativePath);
  if (!readRecord) {
    return {
      success: false,
      error: `Guarded mutation rejected: ${relativePath} must be read before edit.`,
    };
  }

  if (!params.expectedHash) {
    return {
      success: false,
      error: `Guarded mutation rejected: ${relativePath} requires expectedHash from a prior read.`,
    };
  }

  const currentHash = hashContent(await fs.readFile(resolved, 'utf-8'));
  if (params.expectedHash !== readRecord.hash || currentHash !== readRecord.hash) {
    return {
      success: false,
      error: `Guarded mutation rejected: ${relativePath} changed since it was read.`,
    };
  }

  return null;
}

/**
 * Validates and resolves a path to ensure it stays within the workspace.
 * 
 * Security features:
 * - Blocks directory traversal (../)
 * - Ensures path stays within workspace root
 * - Rejects absolute paths outside workspace
 * - Handles common LLM path hallucinations
 * 
 * @throws PathValidationError if path validation fails
 */
function resolvePath(p: string): string {
  const workspaceRoot = getWorkspace();
  return validateAndResolvePath(p, workspaceRoot);
}

const WORKSPACE_CHANGE_IGNORES = new Set([
  '.git',
  '.react-engine',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
]);

interface WorkspaceChangeRecord {
  path: string;
  modifiedAt: number;
  size: number;
  hash?: string;
}

async function collectWorkspaceChanges(
  directory: string,
  relativeDepth: number,
  maxDepth: number,
  since: number | undefined,
  includeHash: boolean,
  output: WorkspaceChangeRecord[],
): Promise<void> {
  if (relativeDepth > maxDepth) return;

  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && WORKSPACE_CHANGE_IGNORES.has(entry.name)) continue;
    if (WORKSPACE_CHANGE_IGNORES.has(entry.name)) continue;

    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectWorkspaceChanges(absolutePath, relativeDepth + 1, maxDepth, since, includeHash, output);
      continue;
    }
    if (!entry.isFile()) continue;

    try {
      const stats = await fs.stat(absolutePath);
      if (since !== undefined && stats.mtimeMs <= since) continue;
      const record: WorkspaceChangeRecord = {
        path: toWorkspaceRelativePath(absolutePath) || '.',
        modifiedAt: stats.mtimeMs,
        size: stats.size,
      };
      if (includeHash) {
        record.hash = createHash('sha256').update(await fs.readFile(absolutePath)).digest('hex');
      }
      output.push(record);
    } catch {
      // Files can disappear while the agent is scanning; keep the scan useful.
    }
  }
}

export async function workspaceChangesTool(params: WorkspaceChangesParams): Promise<ToolResult> {
  const scanRoot = resolvePath(params.path || '.');
  const stats = await fs.stat(scanRoot).catch(() => undefined);
  if (!stats) return { success: false, error: `Workspace path does not exist: ${params.path || '.'}` };

  const files: WorkspaceChangeRecord[] = [];
  if (stats.isFile()) {
    const record: WorkspaceChangeRecord = {
      path: toWorkspaceRelativePath(scanRoot) || '.',
      modifiedAt: stats.mtimeMs,
      size: stats.size,
    };
    if (params.since === undefined || stats.mtimeMs > params.since) {
      if (params.include_hash) record.hash = createHash('sha256').update(await fs.readFile(scanRoot)).digest('hex');
      files.push(record);
    }
  } else {
    await collectWorkspaceChanges(scanRoot, 0, params.max_depth, params.since, params.include_hash, files);
  }

  files.sort((left, right) => right.modifiedAt - left.modifiedAt || left.path.localeCompare(right.path));
  const limited = files.slice(0, params.max_files);
  return {
    success: true,
    output: JSON.stringify({
      workspace: getWorkspace(),
      scannedPath: toWorkspaceRelativePath(scanRoot) || '.',
      scannedAt: Date.now(),
      since: params.since,
      latestUpdateAt: limited[0]?.modifiedAt || null,
      returned: limited.length,
      truncated: files.length > limited.length,
      note: 'Filesystem timestamps show recent updates but do not prove which actor made them. Read a candidate file before editing it.',
      files: limited,
    }, null, 2),
  };
}

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  truncated?: boolean;
  hash?: string;
  status?: 'passed' | 'failed' | 'unavailable' | 'skipped' | 'cancelled' | 'timed_out';
  document?: { format: string; pages?: number; originalCharacters: number; warnings: string[] };
  command?: {
    operation: string;
    executable?: string;
    args: string[];
    cwd: string;
    exitCode?: number;
    durationMs: number;
    outputArtifact?: { path: string; sha256: string; bytes: number; redacted: boolean };
  };
  packageInstall?: {
    manager: string;
    dev: boolean;
    requestedPackages: string[];
    verifiedPackages: string[];
    missingPackages: string[];
    verified: boolean;
  };
}

function isGitRepositoryProbe(command: string): boolean {
  return /\bgit\s+(?:status|log|diff|rev-parse|branch|ls-files)\b/i.test(command);
}

function formatGitRepositoryPrompt(workingDir: string): string {
  return [
    `No Git repository was detected in ${workingDir}.`,
    'Before initializing Git here, ask the user for confirmation.',
    'If the user approves, run `git init` in this workspace, then continue with the dirty-tree check.',
  ].join('\n');
}

function normalizeForPathSearch(value: string): string {
  return resolve(value).replace(/\\/g, '/').toLowerCase();
}

function commandReferencesPath(command: string, targetPath: string): boolean {
  const normalizedCommand = command
    .replace(/\\\\/g, '\\')
    .replace(/\\/g, '/')
    .toLowerCase();
  const normalizedTarget = normalizeForPathSearch(targetPath);
  return normalizedCommand.includes(normalizedTarget);
}

function normalizeCommandPathToken(value: string): string {
  return value
    .trim()
    .replace(/^["'`]+|["'`.,;:]+$/g, '')
    .replace(/[)>]+$/g, '');
}

function extractExplicitCommandPaths(command: string): string[] {
  const paths = new Set<string>();
  const quotedPathPattern = /(["'`])([A-Za-z]:[\\/][\s\S]*?|\/(?:Users|home|tmp|var|etc|mnt|workspace|app|projects?)[\s\S]*?)\1/g;
  const unquotedPathPattern = /(?:^|[\s=])([A-Za-z]:[\\/][^\s"'`|&;<>]*|\/(?:Users|home|tmp|var|etc|mnt|workspace|app|projects?)[^\s"'`|&;<>]*)/g;

  for (const match of command.matchAll(quotedPathPattern)) {
    paths.add(normalizeCommandPathToken(match[2]));
  }
  for (const match of command.matchAll(unquotedPathPattern)) {
    paths.add(normalizeCommandPathToken(match[1]));
  }

  return Array.from(paths).filter(Boolean);
}

function isPathInsideWorkspace(candidatePath: string, workspaceRoot: string): boolean {
  const resolvedCandidate = resolve(candidatePath);
  const resolvedWorkspace = resolve(workspaceRoot);
  const relativePath = relative(resolvedWorkspace, resolvedCandidate);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function validateCommandWorkspaceIsolation(command: string): string | null {
  const workspaceRoot = getWorkspace();
  const normalizedWorkspace = normalizeForPathSearch(workspaceRoot);
  const normalizedEngineRoot = normalizeForPathSearch(engineAppRoot);

  if (/(^|[\s"'`])\.\.(?:[\\/]|$|[\s"'`])/.test(command)) {
    return `Workspace isolation rejected this Bash command because parent-directory traversal is not allowed from the active target workspace (${workspaceRoot}).`;
  }

  const outsidePath = extractExplicitCommandPaths(command).find((candidatePath) => !isPathInsideWorkspace(candidatePath, workspaceRoot));
  if (outsidePath) {
    return `Workspace isolation rejected this Bash command because it references ${outsidePath}, which is outside the active target workspace (${workspaceRoot}).`;
  }

  if (normalizedWorkspace === normalizedEngineRoot || normalizedWorkspace.startsWith(`${normalizedEngineRoot}/`)) {
    return null;
  }

  if (commandReferencesPath(command, engineAppRoot)) {
    return `Workspace isolation rejected this Bash command because it explicitly references the React engine repo (${engineAppRoot}) while the active target workspace is ${workspaceRoot}.`;
  }

  return null;
}

// ============================================================================
// FILE TOOLS
// ============================================================================

async function suggestLeadingNPathCorrection(resolvedPath: string): Promise<string | null> {
  const requestedName = basename(resolvedPath);
  if (!/^n.+/i.test(requestedName)) return null;

  const correctedName = requestedName.slice(1);
  try {
    const siblings = await fs.readdir(dirname(resolvedPath), { withFileTypes: true });
    const match = siblings.find(
      (entry) => entry.isFile() && entry.name.toLowerCase() === correctedName.toLowerCase()
    );
    if (!match) return null;

    return relative(getWorkspace(), join(dirname(resolvedPath), match.name)).replace(/\\/g, '/');
  } catch {
    return null;
  }
}

export async function readFileTool(params: ReadFileParams): Promise<ToolResult> {
  let resolved: string | null = null;
  try {
    if (!params || typeof params.file_path !== 'string' || !params.file_path) {
      return {
        success: false,
        error: `Invalid arguments for tool Read. The "file_path" parameter must be a non-empty string. Got: ${JSON.stringify(params)}`,
      };
    }
    resolved = resolvePath(params.file_path);
    if (isStructuredDocumentPath(resolved)) {
      return {
        success: false,
        error: `Binary document ${basename(resolved)} cannot be read as UTF-8 text. Use DocumentRead for PDF or DOCX extraction.`,
      };
    }
    const content = await fs.readFile(resolved, 'utf-8');
    const guardedHash = hashContent(content);
    if (mutationGuardContext?.enabled) {
      const relativePath = toWorkspaceRelativePath(resolved);
      mutationGuardContext.reads.set(relativePath, {
        path: relativePath,
        absolutePath: resolved,
        hash: guardedHash,
        readAt: Date.now(),
      });
    }
    const lines = content.split('\n');

    let start = params.offset || 1;
    let end = lines.length;
    if (params.limit) {
      end = Math.min(start + params.limit - 1, lines.length);
    }

    const truncated = end < lines.length;
    const output = lines.slice(start - 1, end).join('\n');

    return {
      success: true,
      output: mutationGuardContext?.enabled ? `${output}\n\n[guarded-read-hash: ${guardedHash}]` : output,
      truncated,
      // Transactional edits use this concurrency token even in full-access
      // mode. Permission enforcement and stale-write protection are separate
      // concerns, so disabling the mutation policy guard must not remove it.
      hash: guardedHash,
    };
  } catch (error: unknown) {
    if (error instanceof PathValidationError) {
      return {
        success: false,
        error: `Security: Path access denied - ${error.reason}`,
      };
    }
    if (
      resolved &&
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      const suggestion = await suggestLeadingNPathCorrection(resolved);
      if (suggestion) {
        return {
          success: false,
          error: `${error instanceof Error ? error.message : 'File not found'}. Did you mean "${suggestion}"? Retry Read with that file_path.`,
        };
      }
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function documentReadTool(params: DocumentReadParams): Promise<ToolResult> {
  try {
    if (!params?.file_path) return { success: false, error: 'DocumentRead requires file_path.' };
    const resolved = resolvePath(params.file_path);
    const document = await extractDocumentText(resolved);
    return {
      success: true,
      output: document.text,
      truncated: document.truncated,
      document: {
        format: document.format,
        pages: document.pages,
        originalCharacters: document.originalCharacters,
        warnings: document.warnings,
      },
    };
  } catch (error) {
    if (error instanceof PathValidationError) {
      return { success: false, error: `Security: Path access denied - ${error.reason}` };
    }
    return { success: false, error: error instanceof Error ? error.message : 'Document extraction failed.' };
  }
}

export async function writeFileTool(params: WriteFileParams): Promise<ToolResult> {
  try {
    const policyError = directPolicyError('Write', params as unknown as Record<string, unknown>);
    if (policyError) return policyError;
    if (
      !params ||
      typeof params.file_path !== 'string' ||
      !params.file_path ||
      (typeof params.content !== 'string' && typeof params.content_base64 !== 'string')
    ) {
      return {
        success: false,
        error: `Invalid arguments for tool Write. Parameter "file_path" must be a string, and either "content" or "content_base64" must be provided. Got: ${JSON.stringify(params)}`,
      };
    }
    const targetPath = params.file_path;
    if (!targetPath) {
      return {
        success: false,
        error: `Missing file path in Write.`,
      };
    }
    let content = params.content;
    if (typeof content !== 'string') {
      const encoded = params.content_base64!.trim();
      const decoded = decodeBase64Utf8(encoded);
      if (!decoded.content && decoded.content !== '') {
        return {
          success: false,
          error: `Invalid arguments for tool Write. ${decoded.error}`,
        };
      }
      content = decoded.content;
    }
    const integrity = validateTextIntegrity(content, targetPath);
    if (!integrity.valid) {
      return { success: false, error: integrity.error };
    }
    const resolved = resolvePath(targetPath);
    const guardResult = await validateGuardedWrite(resolved, params);
    if (guardResult) return guardResult;
    const existedBeforeWrite = await pathExists(resolved);
    await fs.mkdir(dirname(resolved), { recursive: true });
    if (params.append) {
      await fs.appendFile(resolved, content, 'utf-8');
    } else {
      await fs.writeFile(resolved, content, 'utf-8');
    }
    if (mutationGuardContext?.enabled) {
      const relativePath = toWorkspaceRelativePath(resolved);
      if (!existedBeforeWrite) {
        mutationGuardContext.createdFiles.add(relativePath);
      }
    }

    return {
      success: true,
      output: `${params.append ? 'Appended' : 'Written'} ${content.length} characters to ${resolved}`,
    };
  } catch (error: unknown) {
    if (error instanceof PathValidationError) {
      return {
        success: false,
        error: `Security: Path access denied - ${error.reason}`,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function editFileTool(params: EditFileParams): Promise<ToolResult> {
  try {
    const policyError = directPolicyError('Edit', params as unknown as Record<string, unknown>);
    if (policyError) return policyError;
    if (!params || typeof params.file_path !== 'string' || !params.file_path || typeof params.old_string !== 'string' || typeof params.new_string !== 'string') {
      return {
        success: false,
        error: `Invalid arguments for tool Edit. Parameters "file_path", "old_string", and "new_string" must be strings. Got: ${JSON.stringify(params)}`,
      };
    }
    const resolved = resolvePath(params.file_path);
    const guardResult = await validateGuardedEdit(resolved, params);
    if (guardResult) return guardResult;
    const content = await fs.readFile(resolved, 'utf-8');

    if (!content.includes(params.old_string)) {
      return {
        success: false,
        error: `Pattern not found in file. The string to replace does not exist exactly as provided.`,
      };
    }

    const newContent = content.replace(params.old_string, params.new_string);
    const integrity = validateTextIntegrity(newContent, params.file_path);
    if (!integrity.valid) {
      return { success: false, error: integrity.error };
    }
    await fs.writeFile(resolved, newContent, 'utf-8');

    return {
      success: true,
      output: `Replaced 1 occurrence in ${resolved}`,
    };
  } catch (error: unknown) {
    if (error instanceof PathValidationError) {
      return {
        success: false,
        error: `Security: Path access denied - ${error.reason}`,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// SHELL TOOLS
// ============================================================================

export async function bashTool(params: BashParams, signal?: AbortSignal): Promise<ToolResult> {
  let workingDir = getWorkspace();
  try {
    const policyError = directPolicyError('Bash', params as unknown as Record<string, unknown>);
    if (policyError) return policyError;
    if (!params || typeof params.command !== 'string' || !params.command.trim()) {
      return {
        success: false,
        error: `Invalid arguments for tool Bash. The "command" parameter must be a non-empty string. Got: ${JSON.stringify(params)}`,
      };
    }
    const isolationError = validateCommandWorkspaceIsolation(params.command);
    if (isolationError) {
      return {
        success: false,
        error: isolationError,
      };
    }
    workingDir = params.cwd ? resolvePath(params.cwd) : getWorkspace();
    const timeoutMs = params.timeout ?? getToolTimeout('bash', getActiveToolTimeoutConfig());

    const command = await normalizeVerificationShellCommand(params.command, workingDir);
    const result = await executeLegacyShell(command, workingDir, timeoutMs, signal);
    const output = result.stdout || result.stderr;
    if (result.status === 'passed') return { success: true, output, truncated: result.outputTruncated };

    const combinedOutput = `${result.stdout}\n${result.stderr}\n${result.error || ''}`;
    if (isGitRepositoryProbe(params.command) && /not a git repository/i.test(combinedOutput)) {
      return { success: true, output: formatGitRepositoryPrompt(workingDir) };
    }
    if (result.status === 'timed_out') {
      return { success: false, error: `Command execution timed out after ${timeoutMs}ms`, output, truncated: result.outputTruncated };
    }
    if (result.status === 'cancelled') {
      return { success: false, error: 'Command execution cancelled by user.', output, truncated: result.outputTruncated };
    }
    return { success: false, error: result.error || result.stderr || 'Command execution failed', output, truncated: result.outputTruncated };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : 'Command execution failed' };
  }
}

/** Executes a structured repository operation through the platform-aware runtime. */
export async function commandTool(params: CommandParams, signal?: AbortSignal): Promise<ToolResult> {
  const policyError = directPolicyError('Command', params as unknown as Record<string, unknown>);
  if (policyError) return policyError;
  const workingDir = params.cwd ? resolvePath(params.cwd) : getWorkspace();
  const resolved = await resolveCommandOperation({
    operation: params.operation,
    workspace: workingDir,
    args: params.args,
    timeoutMs: params.timeout,
  });
  if ('status' in resolved) {
    return { success: false, status: resolved.status, error: resolved.error, output: resolved.stdout || resolved.stderr };
  }
  const result = await executeCommandInvocation(resolved, params.operation, params.timeout, signal);
  return {
    success: result.status === 'passed',
    status: result.status,
    output: result.stdout || result.stderr,
    error: result.error || (result.status === 'passed' ? undefined : result.stderr || `Command ${result.status}`),
    truncated: result.outputTruncated,
    command: {
      operation: result.operation,
      executable: result.executable,
      args: result.args,
      cwd: result.cwd,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      outputArtifact: result.outputArtifact,
    },
  };
}

// ============================================================================
// SEARCH TOOLS
// ============================================================================

export async function globTool(params: GlobParams, signal?: AbortSignal): Promise<ToolResult> {
  const normalizedPattern = params.pattern.replace(/\\/g, '/');
  if (isAbsolute(params.pattern) || /^[a-zA-Z]:\//.test(normalizedPattern) ||
      normalizedPattern.split('/').some((segment) => segment === '..') ||
      /%(?:TEMP|TMP)%(?:\/|$)/i.test(normalizedPattern) || /^\$(?:TMPDIR|TEMP|TMP)(?:\/|$)/i.test(normalizedPattern)) {
    return { success: false, error: 'Security: Glob patterns must stay relative to the active workspace.' };
  }

  const timeoutMs = getToolTimeout('glob', getActiveToolTimeoutConfig());

  const result = await executeWithTimeout(
    async (signal) => {
      const { glob } = await import('glob');

      // Create AbortController for glob cancellation
      const controller = new AbortController();
      const abortHandler = () => controller.abort();
      signal.addEventListener('abort', abortHandler);

      try {
        const files = await glob(params.pattern, {
          nodir: true,
          absolute: true,
          cwd: getWorkspace(),
          signal: controller.signal as any,
        });

        return {
          success: true,
          output: files.join('\n'),
        };
      } finally {
        signal.removeEventListener('abort', abortHandler);
      }
    },
    'Glob',
    timeoutMs,
    signal,
  );

  if (!result.success) {
    const errorMsg = result.error instanceof Error
      ? result.error.message
      : String(result.error);
    return {
      success: false,
      error: errorMsg,
    };
  }

  return result.data || { success: false, error: 'Unknown error' };
}

export async function grepTool(params: GrepParams, signal?: AbortSignal): Promise<ToolResult> {
  const includePattern = (params.includePattern || '**/*').replace(/\\/g, '/');
  if (isAbsolute(params.includePattern || '') || /^[a-zA-Z]:\//.test(includePattern) ||
      includePattern.split('/').some((segment) => segment === '..') ||
      /%(?:TEMP|TMP|TEMPORARY)%(?:\/|$)/i.test(includePattern) ||
      /^\$(?:TMPDIR|TEMP|TMP)(?:\/|$)/i.test(includePattern)) {
    return { success: false, error: 'Security: Grep patterns must stay relative to the active workspace.' };
  }

  const timeoutMs = getToolTimeout('grep', getActiveToolTimeoutConfig());

  const result = await executeWithTimeout(
    async (signal) => {
      // Check for cancellation before starting
      if (signal.aborted) {
        throw new ToolCancellationError('Grep', 'Cancelled before execution');
      }

      const { glob } = await import('glob');
    
      // Determine search path
      const searchPath = params.path ? resolvePath(params.path) : getWorkspace();
      const stat = await fs.stat(searchPath);
      const filePattern = includePattern;
      const files = stat.isFile()
        ? [searchPath]
        : await glob(filePattern, {
            cwd: searchPath,
            nodir: true,
            absolute: true,
            follow: false, // Don't follow symlinks for security
          });
      
      // Compile regex if needed
      let regex: RegExp | null = null;
      if (params.isRegex !== false) {
        try {
          regex = new RegExp(params.pattern, 'gm');
        } catch (e) {
          return {
            success: false,
            error: `Invalid regex pattern: ${e instanceof Error ? e.message : 'Unknown error'}`,
          };
        }
      }
      
      const results: string[] = [];
      const matchedFiles = new Set<string>();
      let totalMatches = 0;
      
      // Search through files
      for (const file of files) {
        // Check for cancellation during loop
        if (signal.aborted) {
          throw new ToolCancellationError('Grep', 'Cancelled during search');
        }

        if (params.limit && totalMatches >= params.limit) {
          break;
        }
        
        try {
          const content = await fs.readFile(file, 'utf-8');
          const lines = content.split('\n');
          let hasMatch = false;
          
          for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            let isMatch = false;
            
            // Check for match (regex or literal)
            if (regex !== null) {
              regex.lastIndex = 0;
              isMatch = regex.test(line);
            } else {
              isMatch = line.includes(params.pattern);
            }
            
            if (isMatch) {
              totalMatches++;
              hasMatch = true;
              
              if (params.type === 'content') {
                // Return content with line context
                const matchContext = `${file}:${lineNum + 1}:${line}`;
                results.push(matchContext);
              }
              
              if (params.limit && totalMatches >= params.limit) {
                break;
              }
            }
          }
          
          if (hasMatch && params.type === 'files_with_matches') {
            matchedFiles.add(file);
          }
        } catch (fileError) {
          // Skip files that can't be read (binary files, permission issues, etc.)
          continue;
        }
      }
      
      // Format output
      let output = '';
      if (params.type === 'files_with_matches') {
        output = Array.from(matchedFiles).join('\n');
      } else {
        output = results.join('\n');
      }
      
      return {
        success: true,
        output: output || '(no matches found)',
        truncated: Boolean(params.limit && totalMatches >= params.limit),
      };
    },
    'Grep',
    timeoutMs,
    signal,
  );

  if (!result.success) {
    const errorMsg = result.error instanceof Error
      ? result.error.message
      : String(result.error);
    return {
      success: false,
      error: errorMsg,
    };
  }

  return result.data || { success: false, error: 'Unknown error' };
}

// ============================================================================
// AGENT / TASK TOOLS
// ============================================================================

export interface Task {
  id: string;
  subject: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  owner?: string;
  blockedBy?: string[];
}

class TaskManager {
  private tasks: Map<string, Task> = new Map();
  private counter = 0;

  create(params: { subject: string; description: string }): Task {
    this.counter++;
    const task: Task = {
      id: String(this.counter),
      subject: params.subject,
      description: params.description,
      status: 'pending',
    };
    this.tasks.set(task.id, task);
    return task;
  }

  list(): Task[] {
    return Array.from(this.tasks.values());
  }

  update(id: string, params: Partial<Omit<Task, 'id'>>): Task | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    const updated = { ...task, ...params };
    this.tasks.set(id, updated);
    return updated;
  }

  get(id: string): Task | null {
    return this.tasks.get(id) || null;
  }
}

export const taskManager = new TaskManager();

export async function taskCreateTool(params: TaskCreateParams): Promise<ToolResult> {
  const task = taskManager.create({
    subject: params.subject,
    description: params.description || '',
  });

  return {
    success: true,
    output: JSON.stringify(task, null, 2),
  };
}

export function packageNameFromSpecifier(specifier: string): string | undefined {
  const trimmed = specifier.trim();
  if (!trimmed || /^(?:https?:|git\+|file:|\.\.?[\\/])/.test(trimmed)) return undefined;
  if (trimmed.startsWith('@')) {
    const slash = trimmed.indexOf('/');
    if (slash < 2) return undefined;
    const versionAt = trimmed.indexOf('@', slash);
    return versionAt > slash ? trimmed.slice(0, versionAt) : trimmed;
  }
  return trimmed.split('@', 1)[0] || undefined;
}

export function buildPackageInstallArgs(params: PackageInstallParams): string[] {
  const packages = Array.from(new Set(params.packages.map((item) => item.trim()).filter(Boolean)));
  if (packages.length === 0) return ['install'];
  if (params.manager === 'npm') return ['install', ...(params.dev ? ['--save-dev'] : []), ...packages];
  return ['add', ...(params.dev ? [params.manager === 'yarn' || params.manager === 'bun' ? '--dev' : '-D'] : []), ...packages];
}

/** Structured, shell-free package installation with bounded post-install verification. */
export async function packageInstallTool(params: PackageInstallParams, signal?: AbortSignal): Promise<ToolResult> {
  const policyError = directPolicyError('PackageInstall', params as unknown as Record<string, unknown>);
  if (policyError) return policyError;
  const workingDir = params.cwd ? resolvePath(params.cwd) : getWorkspace();
  const environment = detectCommandEnvironment();
  const executable = environment.platform === 'win32' ? `${params.manager}.cmd` : params.manager;
  const args = buildPackageInstallArgs(params);
  const result = await executeCommandInvocation({ executable, args, cwd: workingDir, environment }, 'shell', params.timeout, signal);
  const requestedPackages = params.packages
    .map(packageNameFromSpecifier)
    .filter((item): item is string => Boolean(item));
  const verifiedPackages: string[] = [];
  const missingPackages: string[] = [];

  if (result.status === 'passed') {
    for (const packageName of requestedPackages) {
      try {
        await fs.access(join(workingDir, 'node_modules', ...packageName.split('/'), 'package.json'));
        verifiedPackages.push(packageName);
      } catch {
        missingPackages.push(packageName);
      }
    }
  }

  const success = result.status === 'passed' && missingPackages.length === 0;
  const output = result.stdout || result.stderr;
  return {
    success,
    status: success ? 'passed' : result.status === 'passed' ? 'failed' : result.status,
    output,
    error: result.error || (missingPackages.length
      ? `Package installation exited successfully, but verification could not find: ${missingPackages.join(', ')}`
      : result.status === 'passed' ? undefined : result.stderr || `Package installation ${result.status}`),
    truncated: result.outputTruncated,
    command: {
      operation: 'package_install',
      executable: result.executable,
      args: result.args,
      cwd: result.cwd,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      outputArtifact: result.outputArtifact,
    },
    packageInstall: {
      manager: params.manager,
      dev: params.dev,
      requestedPackages,
      verifiedPackages,
      missingPackages,
      verified: success,
    },
  };
}

export async function noteTool(params: NoteParams): Promise<ToolResult> {
  const policyError = directPolicyError('Note', params as unknown as Record<string, unknown>);
  if (policyError) return policyError;
  return projectNoteTool(getWorkspace(), params);
}

export async function sampleTool(params: SampleParams): Promise<ToolResult> {
  const policyError = directPolicyError('Sample', params as unknown as Record<string, unknown>);
  if (policyError) return policyError;
  return projectSampleTool(getWorkspace(), params);
}

export async function wikiTool(params: WikiParams): Promise<ToolResult> {
  const policyError = directPolicyError('Wiki', params as unknown as Record<string, unknown>);
  if (policyError) return policyError;
  return projectWikiTool(getWorkspace(), params);
}

export async function configuredWebSearchTool(
  params: WebSearchParams,
  signal?: AbortSignal
): Promise<ToolResult> {
  const settings = await loadKnowledgeSettings(getWorkspace());
  if (!settings.webSearchEnabled) {
    return {
      success: false,
      error: 'WebSearch is disabled for this workspace. Enable it in Settings > Agent Resources.',
    };
  }
  return webSearchTool(params, signal);
}

export async function taskListTool(): Promise<ToolResult> {
  const tasks = taskManager.list();
  return {
    success: true,
    output: tasks.map(t => `${t.id}. [${t.status}] ${t.subject}${t.owner ? ` (owner: ${t.owner})` : ''}`).join('\n'),
  };
}

export async function taskUpdateTool(params: TaskUpdateParams): Promise<ToolResult> {
  // Only pass Task-related fields to the manager, ignore agent-related fields (role, fallback)
  const { id, status, owner } = params;
  const task = taskManager.update(id, { 
    status: status as 'pending' | 'in_progress' | 'completed' | undefined, 
    owner 
  });
  if (!task) {
    return { success: false, error: `Task ${params.id} not found` };
  }
  return {
    success: true,
    output: JSON.stringify(task, null, 2),
  };
}

export async function subAgentTool(params: SubAgentParams): Promise<ToolResult> {
  try {
    const settings = getDelegationSettings();
    const validation = validateDelegationSettings(settings);
    if (!settings.enabled) {
      throw new Error('Delegation is disabled. Configure and enable it in Settings > Agent delegation before using SubAgent.');
    }
    if (!validation.valid) {
      throw new Error(`Delegation settings are incomplete: ${validation.errors.join(' ')}`);
    }

    const selected = selectDelegationRoute(settings, params.slot);
    const [
      { SubAgentPool },
      { GeminiLLMProvider, NvidiaLLMProvider },
      { GeminiProfileRegistry, getGeminiProfileRegistry },
      { resolveGeminiModelTarget },
    ] = await Promise.all([
      import('../agents/subagents.js'),
      import('../di/providers/llmProvider.js'),
      import('../config/geminiProfiles.js'),
      import('../config/geminiTargets.js'),
    ]);

    let llmProvider;
    let geminiProfileId: string | undefined;
    if (selected.route.provider === 'nvidia') {
      llmProvider = new NvidiaLLMProvider();
    } else {
      const target = resolveGeminiModelTarget(selected.route.model);
      const allProfiles = getGeminiProfileRegistry();
      const selectedProfile = target?.profileId
        ? allProfiles.get(target.profileId)
        : target
          ? allProfiles.list()[target.apiKeyIndex]
          : undefined;
      if (!selectedProfile) {
        throw new Error(`Gemini profile for delegate task ${selected.slot} is not configured or enabled.`);
      }
      geminiProfileId = selectedProfile.id;
      // Keep exactly one profile in this provider. The selected Gemini target
      // and its account cannot change while the child run is active.
      llmProvider = new GeminiLLMProvider(
        undefined,
        undefined,
        new GeminiProfileRegistry([selectedProfile]),
      );
    }

    const pool = new SubAgentPool({
      model: selected.route.model,
      workspace: getWorkspace(),
      llmProvider,
      allowPollinationsFallback: false,
      allowNvidiaModelFallback: false,
      geminiProfileId,
    });
    
    type SubAgentType = 'code' | 'research' | 'tool' | 'reviewer' | 'documentation';
    const roleMap: Record<string, SubAgentType> = {
      coder: 'code',
      researcher: 'research',
      tester: 'reviewer',
      reviewer: 'reviewer',
      planner: 'research',
      documenter: 'documentation',
      specialist: 'tool',
    };
    const requestedRole = params.role ? params.role.toLowerCase().trim() : 'coder';
    assertDelegationRoleAllowed(settings, requestedRole);
    const assignedTo = roleMap[requestedRole];
    if (!assignedTo) {
      throw new Error(`Unknown sub-agent role: ${params.role}`);
    }

    const fallbackRole = params.fallback ? params.fallback.toLowerCase().trim() : undefined;
    if (fallbackRole) assertDelegationRoleAllowed(settings, fallbackRole);
    const fallbackTo = fallbackRole ? roleMap[fallbackRole] : undefined;
    if (params.fallback && !fallbackTo) {
      throw new Error(`Unknown fallback sub-agent role: ${params.fallback}`);
    }

    return await withDelegationConcurrency(settings, async () => {
      let result = await pool.executeWithAgent(assignedTo, params.task, settings.roleRules[requestedRole as keyof typeof settings.roleRules]);
      // A fallback role is still executed on the same explicitly selected
      // provider target. It never changes API key, profile, or provider.
      if (!result.success && fallbackTo && fallbackTo !== assignedTo) {
        result = await pool.executeWithAgent(fallbackTo, params.task, fallbackRole ? settings.roleRules[fallbackRole as keyof typeof settings.roleRules] : undefined);
      }

      return {
        success: result.success,
        output: result.output || 'Task completed with no output',
        error: result.success ? undefined : result.output,
      };
    });
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error in sub-agent',
    };
  }
}

// ============================================================================
// TOOL REGISTRY
// ============================================================================

export type DevTool =
  | 'Bash'
  | 'PackageInstall'
  | 'Command'
  | 'Read'
  | 'DocumentRead'
  | 'Write'
  | 'Edit'
  | 'Glob'
  | 'Grep'
  | 'WorkspaceChanges'
  | 'WebSearch'
  | 'Note'
  | 'Sample'
  | 'Wiki'
  | 'TaskCreate'
  | 'TaskList'
  | 'TaskUpdate'
  | 'SubAgent';

export interface ToolDefinition {
  name: DevTool;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (params: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult>;
  /** Engine-owned execution contract used by routing, policy, and scheduling. */
  capabilities?: ToolCapabilities;
  /** Optional override for the shared executor timeout boundary. */
  timeoutMs?: number;
}

export const DEV_TOOLS: Record<DevTool, ToolDefinition> = {
  Bash: {
    name: 'Bash',
    description: 'Execute a shell command in the terminal',
    inputSchema: BashSchema.export(),
    handler: (params, signal) => {
      const parsed = BashParamsSchema.parse(params);
      return bashTool(parsed, signal);
    },
  },

  Command: {
    name: 'Command',
    description: 'Run one platform-aware Git, verification, filesystem, or process operation. Use Read for file contents, not Command. Command.args must be an array of literal strings (for example {"operation":"list_directory","args":["."]}). Prefer this over Bash for ordinary repository work.',
    inputSchema: CommandSchema.export(),
    handler: (params, signal) => commandTool(CommandParamsSchema.parse(params), signal),
  },

  Read: {
    name: 'Read',
    description: 'Read contents of a file',
    inputSchema: ReadFileSchema.export(),
    handler: (params) => {
      const parsed = ReadFileParamsSchema.parse(params);
      return readFileTool(parsed);
    },
  },

  DocumentRead: {
    name: 'DocumentRead',
    description: 'Extract text from a PDF or DOCX source document. Use this instead of Read or Bash for resumes and attached documents.',
    inputSchema: DocumentReadSchema.export(),
    handler: (params) => documentReadTool(DocumentReadParamsSchema.parse(params)),
  },

  Write: {
    name: 'Write',
    description: 'Write content to a file',
    inputSchema: WriteFileSchema.export(),
    handler: (params) => {
      const parsed = WriteFileParamsSchema.parse(params);
      return writeFileTool(parsed);
    },
  },

  Edit: {
    name: 'Edit',
    description: 'Perform exact string replacement in a file',
    inputSchema: EditFileSchema.export(),
    handler: (params) => {
      const parsed = EditFileParamsSchema.parse(params);
      return editFileTool(parsed);
    },
  },

  Glob: {
    name: 'Glob',
    description: 'Find files matching a glob pattern',
    inputSchema: GlobSchema.export(),
    handler: (params, signal) => {
      const parsed = GlobParamsSchema.parse(params);
      return globTool(parsed, signal);
    },
  },

  Grep: {
    name: 'Grep',
    description: 'Search file contents using regex',
    inputSchema: GrepSchema.export(),
    handler: (params, signal) => {
      const parsed = GrepParamsSchema.parse(params);
      return grepTool(parsed, signal);
    },
  },

  WorkspaceChanges: {
    name: 'WorkspaceChanges',
    description: 'Inspect recently modified files in the workspace. Use this before editing when the target file is not yet known; it is read-only and does not authorize a mutation.',
    inputSchema: WorkspaceChangesSchema.export(),
    handler: (params) => workspaceChangesTool(WorkspaceChangesParamsSchema.parse(params)),
  },

  WebSearch: {
    name: 'WebSearch',
    description: 'Search the current public web with Tavily. Use for recent facts, external documentation, news, and source URLs. Requires TAVILY_API_KEY on the server.',
    inputSchema: WebSearchSchema.export(),
    handler: (params, signal) => {
      const parsed = WebSearchParamsSchema.parse(params);
      return configuredWebSearchTool(parsed, signal);
    },
  },

  PackageInstall: {
    name: 'PackageInstall',
    description: 'Install project dependencies with a structured package-manager command. Use this instead of Bash for npm, pnpm, yarn, or bun installs. Named packages are verified after installation. This action always requires explicit approval.',
    inputSchema: PackageInstallSchema.export(),
    handler: (params, signal) => packageInstallTool(PackageInstallParamsSchema.parse(params), signal),
  },

  Note: {
    name: 'Note',
    description: 'Store durable project notes under .react-engine/notes and retrieve them later by a stable note:<id> reference. Use operation add, get, or list.',
    inputSchema: NoteSchema.export(),
    handler: (params) => noteTool(NoteParamsSchema.parse(params)),
  },

  Sample: {
    name: 'Sample',
    description: 'Maintain a reusable project sample repository. It defaults to .react-engine/samples, or the user can choose a workspace-relative location with set_folder. Add examples and retrieve them later with stable sample:<id> references; list or search by title, description, language, tags, and content.',
    inputSchema: SampleSchema.export(),
    handler: (params) => sampleTool(SampleParamsSchema.parse(params)),
  },

  Wiki: {
    name: 'Wiki',
    description: 'Look up user-created Markdown wiki pages from the project folder configured in Settings > Knowledge Lookup. Supports list, search, and get with stable wiki:<page-path> references. For specification-driven work, check wiki:project-specification when it is available and enabled, and treat it as user-maintained project guidance.',
    inputSchema: WikiSchema.export(),
    handler: (params) => wikiTool(WikiParamsSchema.parse(params)),
  },

  TaskCreate: {
    name: 'TaskCreate',
    description: 'Create a new task in the task list',
    inputSchema: { type: 'object', properties: { subject: { type: 'string' }, description: { type: 'string' } } },
    handler: (params) => {
      const parsed = TaskCreateParamsSchema.parse(params);
      return taskCreateTool(parsed);
    },
  },

  TaskList: {
    name: 'TaskList',
    description: 'List all tasks',
    inputSchema: { type: 'object' },
    handler: () => taskListTool(),
  },

  TaskUpdate: {
    name: 'TaskUpdate',
    description: 'Update a task status/owner',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' }, owner: { type: 'string' } } },
    handler: (params) => {
      const parsed = TaskUpdateParamsSchema.parse(params);
      return taskUpdateTool(parsed);
    },
  },

  SubAgent: {
    name: 'SubAgent',
    description: 'Delegate a complex sub-task to a configured model target. Settings > Agent delegation must be enabled first; routes are pinned to their saved NVIDIA API key or Gemini profile. Each call pauses the parent until its worker finishes, and workers run one at a time. Omit slot for round-robin assignment, or provide a 1-based configured slot.',
    inputSchema: { 
      type: 'object', 
      properties: { 
        task: { type: 'string', description: 'The task description for the sub-agent to execute.' }, 
        role: { type: 'string', description: 'Optional. The role of the agent: coder, researcher, tester, reviewer, planner, documenter, specialist. Defaults to matching based on task.' },
        fallback: { type: 'string', description: 'Optional. Fallback role if primary agent fails. Defaults to specialist.' },
        slot: { type: 'integer', minimum: 1, maximum: 16, description: 'Optional 1-based configured delegate task slot. Omit to use round-robin routing; for multiple tasks, make the next call only after the previous worker result returns.' },
      },
      required: ['task']
    },
    handler: (params) => {
      const parsed = SubAgentParamsSchema.parse(params);
      return subAgentTool(parsed);
    },
  },
};

export function getToolDefinition(name: string): ToolDefinition | undefined {
  const tool = DEV_TOOLS[name as DevTool];
  return tool ? { ...tool, capabilities: tool.capabilities || getToolCapabilities(tool.name) } : undefined;
}

export function getAllToolDefinitions(): ToolDefinition[] {
  return Object.values(DEV_TOOLS).map((tool) => ({
    ...tool,
    capabilities: tool.capabilities || getToolCapabilities(tool.name),
  }));
}

// Export timeout configuration utilities
export { 
  DEFAULT_TOOL_TIMEOUTS,
  ToolTimeoutError,
  ToolCancellationError,
  getToolTimeout,
  executeWithTimeout,
  createCancellationToken,
  isSignalAborted,
  formatTimeoutError,
  type ToolTimeoutConfig,
  type TimeoutProtectedResult,
} from './executionTimeout.js';
