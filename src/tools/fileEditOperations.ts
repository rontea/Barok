/**
 * Phase 5.1 - Structured File Edit Operations
 * Provides safe, validatable file patching with multi-file support
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { renameSync } from 'fs';
import { validateAndResolvePath, PathValidationError } from '@barok/adapter-node';
import { validateTextIntegrity } from './textIntegrity.js';

/**
 * Represents a structured edit operation on a file
 */
export interface FileEditOperation {
  filepath: string;
  type: 'insert' | 'replace' | 'delete' | 'append' | 'prepend';
  lineNumber?: number; // 1-indexed for insert/replace/delete
  oldContent?: string; // For replace operations
  newContent?: string; // For insert/replace/append/prepend
  description: string; // Human-readable reason
  workspaceRoot?: string; // Defaults to process.cwd()
  expectedHash?: string; // Required when applying an existing-file mutation
  allowDelete?: boolean; // Required for delete operations
  validation?: {
    shouldContain?: string[]; // Content that must exist before edit
    mustNotContain?: string[]; // Content that must not exist
    fileType?: string[]; // Allowed file types (ts, tsx, js, json, etc.)
  };
}

/**
 * Result of applying an edit operation
 */
export interface EditOperationResult {
  success: boolean;
  filepath: string;
  operation: FileEditOperation;
  error?: string;
  appliedAt?: number; // Timestamp
  linesChanged?: number;
}

export type FirstClassFileOperation =
  | { type: 'CreateFile'; filepath: string; content: string; workspaceRoot?: string }
  | { type: 'ReplaceFile'; filepath: string; content: string; expectedHash: string; workspaceRoot?: string }
  | { type: 'MoveFile'; filepath: string; destination: string; expectedHash?: string; workspaceRoot?: string }
  | { type: 'DeleteFile'; filepath: string; expectedHash: string; allowDelete: true; workspaceRoot?: string }
  | { type: 'FormatFiles'; filepath: string; workspaceRoot?: string; lineEnding?: 'lf' | 'crlf' }
  | { type: 'GetDiff'; filepath: string; before: string; after: string; workspaceRoot?: string };

export interface FirstClassFileOperationResult {
  success: boolean;
  type: FirstClassFileOperation['type'];
  filepath: string;
  changedFiles: string[];
  beforeHash?: string;
  afterHash?: string;
  diff?: string;
  error?: string;
}

export function applyFirstClassFileOperation(operation: FirstClassFileOperation): FirstClassFileOperationResult {
  const base = { success: false, type: operation.type, filepath: operation.filepath, changedFiles: [] as string[] };
  try {
    const resolved = resolveOperationPath(operation);
    const exists = existsSync(resolved);
    const before = exists ? readFileSync(resolved, 'utf-8') : '';
    const beforeHash = exists ? hashContent(before) : undefined;
    if (operation.type === 'GetDiff') {
      return { ...base, success: true, diff: buildBoundedDiff(operation.before, operation.after), beforeHash, changedFiles: [] };
    }
    if (operation.type === 'CreateFile') {
      if (exists) return { ...base, error: 'CreateFile refused: file already exists.' };
      const integrity = validateTextIntegrity(operation.content, operation.filepath);
      if (!integrity.valid) return { ...base, error: integrity.error };
      mkdirSync(dirname(resolved), { recursive: true });
      writeFileSync(resolved, operation.content, 'utf-8');
    } else if (operation.type === 'ReplaceFile') {
      if (!exists) return { ...base, error: 'ReplaceFile refused: file does not exist.' };
      if (beforeHash !== operation.expectedHash) return { ...base, beforeHash, error: 'ReplaceFile refused: stale expected hash.' };
      const integrity = validateTextIntegrity(operation.content, operation.filepath);
      if (!integrity.valid) return { ...base, error: integrity.error };
      const commitHash = hashContent(readFileSync(resolved, 'utf-8'));
      if (commitHash !== operation.expectedHash) return { ...base, beforeHash: commitHash, error: 'ReplaceFile refused: stale expected hash.' };
      writeFileSync(resolved, operation.content, 'utf-8');
    } else if (operation.type === 'DeleteFile') {
      if (!exists) return { ...base, error: 'DeleteFile refused: file does not exist.' };
      if (beforeHash !== operation.expectedHash) return { ...base, error: 'DeleteFile refused: stale expected hash.' };
      unlinkSync(resolved);
    } else if (operation.type === 'MoveFile') {
      if (!exists) return { ...base, error: 'MoveFile refused: source does not exist.' };
      if (operation.expectedHash && beforeHash !== operation.expectedHash) return { ...base, error: 'MoveFile refused: stale expected hash.' };
      const destination = resolveOperationPath({ filepath: operation.destination, workspaceRoot: operation.workspaceRoot });
      if (existsSync(destination)) return { ...base, error: 'MoveFile refused: destination already exists.' };
      mkdirSync(dirname(destination), { recursive: true });
      renameSync(resolved, destination);
      const afterHash = getFileHash(operation.destination, operation.workspaceRoot);
      return { ...base, success: true, changedFiles: [operation.filepath, operation.destination], beforeHash, afterHash, diff: buildBoundedDiff(before, readFileSync(destination, 'utf-8')) };
    } else if (operation.type === 'FormatFiles') {
      if (!exists) return { ...base, error: 'FormatFiles refused: file does not exist.' };
      const lineEnding = operation.lineEnding === 'crlf' ? '\r\n' : '\n';
      writeFileSync(resolved, before.replace(/\r?\n/g, lineEnding), 'utf-8');
    }
    const after = existsSync(resolved) ? readFileSync(resolved, 'utf-8') : '';
    return { ...base, success: true, changedFiles: [operation.filepath], beforeHash, afterHash: existsSync(resolved) ? hashContent(after) : undefined, diff: buildBoundedDiff(before, after) };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }
}

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function resolveOperationPath(operation: Pick<FileEditOperation, 'filepath' | 'workspaceRoot'>): string {
  return validateAndResolvePath(operation.filepath, operation.workspaceRoot || process.cwd());
}

/**
 * Batch edit request and results
 */
export interface BatchEditRequest {
  operations: FileEditOperation[];
  atomic: boolean; // All-or-nothing execution
  dryRun?: boolean; // Preview changes without applying
}

export interface BatchEditResult {
  success: boolean;
  totalOperations: number;
  successful: number;
  failed: number;
  results: EditOperationResult[];
  rollbackNeeded?: boolean;
  rolledBack?: boolean;
  changedFiles?: string[];
  beforeHashes?: Record<string, string | undefined>;
  afterHashes?: Record<string, string | undefined>;
  diff?: string;
}

export function getFileHash(filepath: string, workspaceRoot?: string): string | undefined {
  try {
    return hashContent(readFileSync(resolveOperationPath({ filepath, workspaceRoot }), 'utf-8'));
  } catch {
    return undefined;
  }
}

export function buildBoundedDiff(before: string, after: string, maxChars = 12_000): string {
  if (before === after) return '';
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  const lines = [`--- before`, `+++ after`];
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max && lines.join('\n').length < maxChars; i++) {
    if (oldLines[i] !== newLines[i]) {
      if (oldLines[i] !== undefined) lines.push(`-${oldLines[i]}`);
      if (newLines[i] !== undefined) lines.push(`+${newLines[i]}`);
    }
  }
  const diff = lines.join('\n');
  return diff.length <= maxChars ? diff : `${diff.slice(0, maxChars)}\n...[diff truncated]`;
}

/**
 * Read file content safely
 */
export function readFile(filepath: string): string {
  try {
    const resolved = validateAndResolvePath(filepath, process.cwd());
    return readFileSync(resolved, 'utf-8');
  } catch (error) {
    if (error instanceof PathValidationError) {
      throw error;
    }
    throw new Error(`Failed to read file: ${filepath}`);
  }
}

/**
 * Validate file edit operation before applying
 */
export function validateEditOperation(operation: FileEditOperation): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate filepath
  if (!operation.filepath || typeof operation.filepath !== 'string') {
    errors.push('Invalid filepath');
  }

  // Validate type
  if (!['insert', 'replace', 'delete', 'append', 'prepend'].includes(operation.type)) {
    errors.push(`Invalid operation type: ${operation.type}`);
  }

  // Validate content requirements
  if (['insert', 'replace', 'append', 'prepend'].includes(operation.type)) {
    if (!operation.newContent) {
      errors.push(`Operation ${operation.type} requires newContent`);
    }
  }

  if (operation.type === 'replace' && !operation.oldContent) {
    errors.push('Replace operation requires oldContent');
  }

  // Validate line numbers
  if (['insert', 'replace', 'delete'].includes(operation.type)) {
    if (!operation.lineNumber || operation.lineNumber < 1) {
      errors.push(`Invalid lineNumber for ${operation.type} operation`);
    }
  }

  // Validate file constraints
  if (operation.validation?.fileType) {
    const ext = operation.filepath.split('.').pop();
    if (!operation.validation.fileType.includes(ext || '')) {
      errors.push(`File type .${ext} not allowed for this operation`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate file content against constraints
 */
export function validateFileContent(
  filepath: string,
  validation: FileEditOperation['validation'] | undefined,
  workspaceRoot?: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!validation) return { valid: true, errors: [] };

  try {
    const content = readFileSync(validateAndResolvePath(filepath, workspaceRoot || process.cwd()), 'utf-8');

    // Check required content
    if (validation.shouldContain) {
      for (const required of validation.shouldContain) {
        if (!content.includes(required)) {
          errors.push(`File must contain: ${required.substring(0, 50)}...`);
        }
      }
    }

    // Check forbidden content
    if (validation.mustNotContain) {
      for (const forbidden of validation.mustNotContain) {
        if (content.includes(forbidden)) {
          errors.push(`File must not contain: ${forbidden.substring(0, 50)}...`);
        }
      }
    }
  } catch (err) {
    errors.push(err instanceof PathValidationError ? err.reason : `Failed to validate file content: ${filepath}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Apply a single edit operation
 */
export function applyEditOperation(operation: FileEditOperation): EditOperationResult {
  const startTime = Date.now();

  // Validate operation
  const validation = validateEditOperation(operation);
  if (!validation.valid) {
    return {
      success: false,
      filepath: operation.filepath,
      operation,
      error: validation.errors.join('; '),
    };
  }

  let resolvedPath: string;
  try {
    resolvedPath = resolveOperationPath(operation);
  } catch (error) {
    return {
      success: false,
      filepath: operation.filepath,
      operation,
      error: error instanceof PathValidationError ? `Path rejected: ${error.reason}` : String(error),
    };
  }

  if (operation.type === 'delete' && operation.allowDelete !== true) {
    return {
      success: false,
      filepath: operation.filepath,
      operation,
      error: 'Delete operation requires explicit allowDelete approval.',
    };
  }

  // Validate file content
  const contentValidation = validateFileContent(operation.filepath, operation.validation, operation.workspaceRoot);
  if (!contentValidation.valid) {
    return {
      success: false,
      filepath: operation.filepath,
      operation,
      error: contentValidation.errors.join('; '),
    };
  }

  try {
    const content = readFileSync(resolvedPath, 'utf-8');
    if (!operation.expectedHash) {
      return {
        success: false,
        filepath: operation.filepath,
        operation,
        error: 'Applying a file edit requires expectedHash from a prior read.',
      };
    }
    if (operation.expectedHash !== hashContent(content)) {
      return {
        success: false,
        filepath: operation.filepath,
        operation,
        error: 'File changed since it was read.',
      };
    }
    const lines = content.split('\n');
    let newContent: string;
    let linesChanged = 0;

    switch (operation.type) {
      case 'insert': {
        if (!operation.lineNumber || operation.lineNumber < 1 || operation.lineNumber > lines.length + 1) {
          return {
            success: false,
            filepath: operation.filepath,
            operation,
            error: `Invalid line number ${operation.lineNumber} for file with ${lines.length} lines`,
          };
        }
        lines.splice(operation.lineNumber - 1, 0, operation.newContent!);
        newContent = lines.join('\n');
        linesChanged = 1;
        break;
      }

      case 'replace': {
        if (!operation.lineNumber || operation.lineNumber < 1 || operation.lineNumber > lines.length) {
          return {
            success: false,
            filepath: operation.filepath,
            operation,
            error: `Invalid line number ${operation.lineNumber}`,
          };
        }
        if (lines[operation.lineNumber - 1] !== operation.oldContent) {
          return {
            success: false,
            filepath: operation.filepath,
            operation,
            error: `Line ${operation.lineNumber} content does not match oldContent`,
          };
        }
        lines[operation.lineNumber - 1] = operation.newContent!;
        newContent = lines.join('\n');
        linesChanged = 1;
        break;
      }

      case 'delete': {
        if (!operation.lineNumber || operation.lineNumber < 1 || operation.lineNumber > lines.length) {
          return {
            success: false,
            filepath: operation.filepath,
            operation,
            error: `Invalid line number ${operation.lineNumber}`,
          };
        }
        lines.splice(operation.lineNumber - 1, 1);
        newContent = lines.join('\n');
        linesChanged = 1;
        break;
      }

      case 'append': {
        if (content.endsWith('\n')) {
          newContent = content + operation.newContent!;
        } else {
          newContent = content + '\n' + operation.newContent!;
        }
        linesChanged = operation.newContent!.split('\n').length;
        break;
      }

      case 'prepend': {
        newContent = operation.newContent! + '\n' + content;
        linesChanged = operation.newContent!.split('\n').length;
        break;
      }

      default:
        return {
          success: false,
          filepath: operation.filepath,
          operation,
          error: `Unknown operation type: ${operation.type}`,
        };
    }

    const integrity = validateTextIntegrity(newContent!, operation.filepath);
    if (!integrity.valid) {
      return {
        success: false,
        filepath: operation.filepath,
        operation,
        error: integrity.error,
      };
    }

    mkdirSync(dirname(resolvedPath), { recursive: true });
    writeFileSync(resolvedPath, newContent, 'utf-8');

    return {
      success: true,
      filepath: operation.filepath,
      operation,
      appliedAt: startTime,
      linesChanged,
    };
  } catch (error) {
    return {
      success: false,
      filepath: operation.filepath,
      operation,
      error: `Failed to apply edit: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Apply batch edit operations
 */
export function applyBatchEdits(request: BatchEditRequest): BatchEditResult {
  const results: EditOperationResult[] = [];
  const snapshots = new Map<string, { path: string; content?: string }>();
  const beforeHashes: Record<string, string | undefined> = {};
  const afterHashes: Record<string, string | undefined> = {};
  let successful = 0;
  let failed = 0;

  for (const operation of request.operations) {
    try {
      const resolved = resolveOperationPath(operation);
      if (!snapshots.has(resolved)) {
        snapshots.set(resolved, { path: resolved, content: existsSync(resolved) ? readFileSync(resolved, 'utf-8') : undefined });
        beforeHashes[operation.filepath] = getFileHash(operation.filepath, operation.workspaceRoot);
      }
    } catch {
      // Validation below reports the actionable path error.
    }
  }

  // Validate all operations first if atomic
  if (request.atomic) {
    for (const op of request.operations) {
      const validation = validateEditOperation(op);
      if (!validation.valid) {
        return {
          success: false,
          totalOperations: request.operations.length,
          successful: 0,
          failed: request.operations.length,
          results: request.operations.map((operation) => ({
            success: false,
            filepath: operation.filepath,
            operation,
            error: 'Batch validation failed - no operations applied',
          })),
          rollbackNeeded: false,
        };
      }
    }
  }

  // Apply each operation
  for (const operation of request.operations) {
    if (request.dryRun) {
      // In dry-run, just validate
      const validation = validateEditOperation(operation);
      results.push({
        success: validation.valid,
        filepath: operation.filepath,
        operation,
        error: validation.valid ? undefined : validation.errors.join('; '),
      });
      if (validation.valid) successful++;
      else failed++;
    } else {
      const result = applyEditOperation(operation);
      results.push(result);
      if (result.success) successful++;
      else {
        failed++;
        if (request.atomic) {
          // Stop on first failure in atomic mode
          break;
        }
      }
    }
  }

  let rolledBack = false;
  if (request.atomic && failed > 0 && !request.dryRun) {
    for (const snapshot of snapshots.values()) {
      if (snapshot.content === undefined) {
        if (existsSync(snapshot.path)) unlinkSync(snapshot.path);
      } else {
        mkdirSync(dirname(snapshot.path), { recursive: true });
        writeFileSync(snapshot.path, snapshot.content, 'utf-8');
      }
    }
    rolledBack = true;
  }

  const changedFiles = results.filter((result) => result.success).map((result) => result.filepath);
  for (const filepath of changedFiles) {
    const operation = results.find((result) => result.filepath === filepath)?.operation;
    afterHashes[filepath] = getFileHash(filepath, operation?.workspaceRoot);
  }
  const diffParts = changedFiles.map((filepath) => {
    const snapshot = snapshots.get(resolveOperationPath({ filepath, workspaceRoot: results.find((result) => result.filepath === filepath)?.operation.workspaceRoot }));
    const operation = results.find((result) => result.filepath === filepath)?.operation;
    const after = operation ? (readFileSync(resolveOperationPath(operation), 'utf-8')) : '';
    return snapshot ? `${filepath}\n${buildBoundedDiff(snapshot.content || '', after)}` : '';
  }).filter(Boolean);

  return {
    success: failed === 0,
    totalOperations: request.operations.length,
    successful,
    failed,
    results,
    rollbackNeeded: request.atomic && failed > 0,
    rolledBack,
    changedFiles,
    beforeHashes,
    afterHashes,
    diff: diffParts.join('\n'),
  };
}

/**
 * Create a file edit operation from old and new content
 */
export function createReplaceOperation(
  filepath: string,
  oldContent: string,
  newContent: string,
  description: string
): FileEditOperation {
  // Find the line number of oldContent
  try {
    const fileContent = readFile(filepath);
    const lines = fileContent.split('\n');
    const lineNumber = lines.findIndex((line) => line === oldContent) + 1;

    if (lineNumber === 0) {
      throw new Error(`Content not found in file: ${oldContent.substring(0, 50)}...`);
    }

    return {
      filepath,
      type: 'replace',
      lineNumber,
      oldContent,
      newContent,
      description,
    };
  } catch (error) {
    throw new Error(`Failed to create replace operation: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Create multiple edit operations from a patch format
 */
export function createOperationsFromPatch(
  filepath: string,
  patch: string,
  description: string
): FileEditOperation[] {
  const operations: FileEditOperation[] = [];
  const lines = patch.split('\n');

  // Simple patch parser (supports +/- format)
  let currentLine = 1;
  for (const line of lines) {
    if (line.startsWith('+ ')) {
      operations.push({
        filepath,
        type: 'insert',
        lineNumber: currentLine,
        newContent: line.substring(2),
        description,
      });
      currentLine++;
    } else if (line.startsWith('- ')) {
      operations.push({
        filepath,
        type: 'delete',
        lineNumber: currentLine,
        description,
      });
    } else if (!line.startsWith('~')) {
      currentLine++;
    }
  }

  return operations;
}
