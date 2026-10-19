import { lstatSync, realpathSync } from 'fs';
import { basename, dirname, resolve, isAbsolute, normalize, relative } from 'path';

/**
 * Custom error class for path validation failures.
 * Provides clear information about why a path was rejected.
 */
export class PathValidationError extends Error {
  constructor(
    public readonly reason: string,
    public readonly attemptedPath: string,
    public readonly workspaceRoot: string
  ) {
    super(
      `Error: Invalid path provided\n` +
      `Cause: ${reason}\n` +
      `Suggested Fix: Ensure the path is within the workspace and doesn't contain traversal attempts\n` +
      `Context: Workspace root: ${workspaceRoot}, Attempted: ${attemptedPath}`
    );
    this.name = 'PathValidationError';
  }
}

function containsControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) <= 0x1f) {
      return true;
    }
  }

  return false;
}

function canonicalPathWithMissingTail(value: string): string {
  let current = resolve(value);
  const missingTail: string[] = [];

  while (true) {
    let stat: ReturnType<typeof lstatSync> | undefined;
    try {
      stat = lstatSync(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      missingTail.push(basename(current));
      current = parent;
      continue;
    }

    // A dangling link is still an existing link. If it cannot be resolved,
    // fail closed rather than treating it as an ordinary missing path.
    if (!stat) throw new Error(`Unable to inspect path ${current}`);
    return resolve(realpathSync(current), ...missingTail.reverse());
  }
}

function pathIsWithin(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot));
}

/**
 * Validates and resolves a filesystem path to ensure it stays within the workspace.
 * 
 * Security checks:
 * - Blocks directory traversal attacks (../)
 * - Ensures resolved path stays within workspace root
 * - Rejects absolute paths outside workspace
 * - Normalizes path to prevent bypasses
 * - Validates against null bytes and other dangerous characters
 * 
 * @param userPath - The path provided by the user or LLM
 * @param workspaceRoot - The workspace root directory (must be absolute)
 * @returns The validated, resolved absolute path
 * @throws PathValidationError if the path fails validation
 */
export function validateAndResolvePath(userPath: string, workspaceRoot: string): string {
  if (!userPath || typeof userPath !== 'string') {
    throw new PathValidationError(
      'Path must be a non-empty string',
      userPath || '(empty)',
      workspaceRoot
    );
  }

  // Check for null bytes and other dangerous characters
  if (containsControlCharacter(userPath)) {
    throw new PathValidationError(
      'Path contains null bytes or control characters',
      userPath,
      workspaceRoot
    );
  }

  let cleanPath = userPath.trim();

  if (/%(?:TEMP|TMP|TEMPORARY)%(?:[\\/]|$)/i.test(cleanPath) || /^\$(?:TMPDIR|TEMP|TMP)(?:[\\/]|$)/i.test(cleanPath)) {
    throw new PathValidationError(
      'Unexpanded temporary-directory variables are not valid workspace paths',
      userPath,
      workspaceRoot
    );
  }

  // Decode percent-encoded URI characters if present (e.g. %20 -> space).
  if (/%[0-9a-fA-F]{2}/.test(cleanPath)) {
    try {
      cleanPath = decodeURIComponent(cleanPath);
    } catch {
      // Keep original path if malformed percent-encoding
    }
  }

  // Strip file URI prefixes emitted by LLMs, editors, or markdown link extractors.
  // Handles standard "file:///", "file://", or truncated variants like "e:///C:/..."
  // where the leading "fil" was sliced off before a Windows drive letter or POSIX root.
  if (/^file:\/\//i.test(cleanPath)) {
    cleanPath = cleanPath.replace(/^file:\/\/\/?/i, '');
  } else if (/^[a-z]:\/{3}(?=[a-zA-Z]:[\\/])/i.test(cleanPath)) {
    cleanPath = cleanPath.replace(/^[a-z]:\/{3}/i, '');
  }

  // Handle absolute paths deliberately. LLMs sometimes emit a valid absolute
  // path to the configured workspace, or a fictional container prefix such as
  // /workspace/ or C:\\app\\. Preserve the first case as a workspace-relative
  // path and only strip known fictional prefixes in the second case.
  const isPosixAbsolute = isAbsolute(cleanPath);
  const isWinAbsolute = /^[a-zA-Z]:[\\/]/.test(cleanPath);
  const isAbs = isPosixAbsolute || isWinAbsolute;

  if (isAbs) {
    const normalizedUser = normalize(cleanPath.replace(/\\/g, '/'));
    const normalizedWs = normalize(workspaceRoot.replace(/\\/g, '/'));
    const wsPrefixWithSlash = normalizedWs.endsWith('/') ? normalizedWs : `${normalizedWs}/`;

    if (
      normalizedUser.toLowerCase().startsWith(wsPrefixWithSlash.toLowerCase()) ||
      normalizedUser.toLowerCase() === normalizedWs.toLowerCase()
    ) {
      cleanPath = relative(normalizedWs, normalizedUser) || '.';
    } else {
      const falsePrefixes = [
        /^\/home\/user\//,
        /^\/workspace\//,
        /^\/app\//,
        /^[A-Z]:\\workspace\\/i,
        /^[A-Z]:\\app\\/i,
        /^[A-Z]:\/workspace\//i,
        /^[A-Z]:\/app\//i,
      ];

      let stripped = false;
      for (const prefix of falsePrefixes) {
        if (prefix.test(cleanPath)) {
          cleanPath = cleanPath.replace(prefix, '');
          stripped = true;
          break;
        }
      }

      if (!stripped && isWinAbsolute && !normalizedUser.toLowerCase().startsWith(normalizedWs.toLowerCase())) {
        throw new PathValidationError(
          `Resolved path escapes workspace root. Path: ${userPath}, Workspace: ${workspaceRoot}`,
          userPath,
          workspaceRoot,
        );
      }
    }
  }

  // Normalize the path to resolve . and .. components
  const normalizedPath = normalize(cleanPath);

  // Check for directory traversal in normalized path
  // After normalization, parent directory references should be handled,
  // but we want to ensure they don't escape the workspace
  const pathSegments = normalizedPath.split(/[\\/]/);
  
  for (const segment of pathSegments) {
    if (segment === '..' || segment === '...') {
      throw new PathValidationError(
        'Directory traversal (..) is not allowed',
        userPath,
        workspaceRoot
      );
    }
  }

  // Resolve the path relative to workspace root
  const resolvedPath = resolve(workspaceRoot, normalizedPath);

  // Ensure the resolved path starts with workspace root
  // This prevents symlink attacks and other escape mechanisms
  const normalizedWorkspace = normalize(workspaceRoot);
  const normalizedResolved = normalize(resolvedPath);

  if (!pathIsWithin(normalizedWorkspace, normalizedResolved)) {
    throw new PathValidationError(
      `Resolved path escapes workspace root. Path: ${normalizedResolved}, Workspace: ${normalizedWorkspace}`,
      userPath,
      workspaceRoot
    );
  }

  // Lexical containment is not enough when the workspace contains a symlink
  // to an external location. Resolve the deepest existing path (and any
  // missing tail) before returning a path to a file operation.
  try {
    const canonicalWorkspace = canonicalPathWithMissingTail(workspaceRoot);
    const canonicalResolved = canonicalPathWithMissingTail(resolvedPath);
    if (!pathIsWithin(canonicalWorkspace, canonicalResolved)) {
      throw new PathValidationError(
        `Resolved path escapes workspace root through a symbolic link. Path: ${canonicalResolved}, Workspace: ${canonicalWorkspace}`,
        userPath,
        workspaceRoot
      );
    }
    return canonicalResolved;
  } catch (error) {
    if (error instanceof PathValidationError) throw error;
    throw new PathValidationError(
      'Path could not be resolved safely through existing workspace entries',
      userPath,
      workspaceRoot
    );
  }
}

/** Return a validated, canonical workspace-relative path for evidence and manifests. */
export function getWorkspaceRelativePath(userPath: string, workspaceRoot: string): string {
  const canonicalWorkspace = canonicalPathWithMissingTail(workspaceRoot);
  const canonicalTarget = validateAndResolvePath(userPath, workspaceRoot);
  const relativePath = relative(canonicalWorkspace, canonicalTarget);
  if (relativePath === '..' || relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(relativePath)) {
    throw new PathValidationError(
      'Resolved path escapes workspace root',
      userPath,
      workspaceRoot
    );
  }
  return relativePath.replace(/\\/g, '/');
}

/**
 * Validates a path is within the workspace without resolving it.
 * Useful for checking paths before operations.
 * 
 * @param path - The path to validate
 * @param workspaceRoot - The workspace root directory
 * @returns true if the path is valid, false otherwise
 */
export function isPathWithinWorkspace(path: string, workspaceRoot: string): boolean {
  try {
    validateAndResolvePath(path, workspaceRoot);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets detailed validation error information for logging/debugging.
 * 
 * @param error - The error to inspect
 * @returns Object with error details
 */
export function getValidationErrorDetails(error: unknown): {
  isPathError: boolean;
  message: string;
  reason?: string;
  attemptedPath?: string;
  workspaceRoot?: string;
} {
  if (error instanceof PathValidationError) {
    return {
      isPathError: true,
      message: error.message,
      reason: error.reason,
      attemptedPath: error.attemptedPath,
      workspaceRoot: error.workspaceRoot,
    };
  }

  return {
    isPathError: false,
    message: error instanceof Error ? error.message : String(error),
  };
}
