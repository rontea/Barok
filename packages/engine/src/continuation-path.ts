/**
 * Resolve a path lexically against a workspace root without consulting the
 * filesystem. This is shared with the browser continuation UI; filesystem
 * mutations still use pathValidator's canonical and symlink-aware checks.
 */
export function getContinuationWorkspaceRelativePath(userPath: string, workspaceRoot: string): string {
  if (typeof userPath !== 'string' || !userPath.trim()) {
    throw new Error('Path must be a non-empty string');
  }
  if (typeof workspaceRoot !== 'string' || !workspaceRoot.trim()) {
    throw new Error('Workspace root must be a non-empty string');
  }

  const cleanPath = userPath.trim();
  if (/[\u0000-\u001f]/.test(cleanPath)) throw new Error('Path contains control characters');
  if (/%(?:TEMP|TMP|TEMPORARY)%(?:[\\/]|$)/i.test(cleanPath) || /^\$(?:TMPDIR|TEMP|TMP)(?:[\\/]|$)/i.test(cleanPath)) {
    throw new Error('Temporary environment paths are not valid workspace paths');
  }

  const workspace = parsePath(workspaceRoot);
  const candidate = parsePath(cleanPath);
  if (candidate.root !== undefined) {
    if (workspace.root !== undefined && sameRoot(candidate.root, workspace.root) &&
      startsWithSegments(candidate.segments, workspace.segments, candidate.root === 'posix')) {
      return candidate.segments.slice(workspace.segments.length).join('/') || '.';
    }

    // Match pathValidator's known fictional roots used by model-generated
    // commands, while keeping actual absolute paths constrained to the root.
    const virtualRelative = fictionalWorkspaceRelativePath(cleanPath);
    if (virtualRelative !== undefined) return virtualRelative;
    throw new Error('Path is outside the workspace');
  }

  // A relative path is rooted at the workspace. Reject any traversal that
  // would leave that root, while allowing harmless internal ./ and a/../b.
  const relativeSegments = normalizeSegments(candidate.segments, []);
  return relativeSegments.join('/') || '.';
}

interface ParsedPath {
  /** Undefined means the input is relative; otherwise this is "posix" or a drive letter. */
  root?: string;
  segments: string[];
}

function parsePath(value: string): ParsedPath {
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('//')) {
    const [server, share, ...rest] = normalized.slice(2).split('/');
    if (!server || !share) throw new Error('UNC path is missing a server or share');
    return {
      root: `unc:${server.toLowerCase()}/${share.toLowerCase()}`,
      segments: normalizeSegments(rest, []),
    };
  }

  const drive = /^([a-z]):(?:\/(.*))?$/i.exec(normalized);
  if (drive) {
    return {
      root: drive[1].toLowerCase(),
      segments: normalizeSegments((drive[2] || '').split('/'), []),
    };
  }
  if (/^[a-z]:/i.test(normalized)) throw new Error('Drive-relative paths are not supported');

  if (normalized.startsWith('/')) {
    return {
      root: 'posix',
      segments: normalizeSegments(normalized.slice(1).split('/'), []),
    };
  }
  return { segments: normalizeSegments(normalized.split('/'), []) };
}

function normalizeSegments(segments: string[], initial: string[]): string[] {
  const result = [...initial];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (result.length === 0) throw new Error('Path escapes the workspace');
      result.pop();
      continue;
    }
    result.push(segment);
  }
  return result;
}

function sameRoot(left: string, right: string): boolean {
  if (left === 'posix' || right === 'posix') return left === right;
  return left.toLowerCase() === right.toLowerCase();
}

function startsWithSegments(path: string[], root: string[], caseSensitive: boolean): boolean {
  if (path.length < root.length) return false;
  return root.every((segment, index) => caseSensitive
    ? path[index] === segment
    : path[index].toLowerCase() === segment.toLowerCase());
}

function fictionalWorkspaceRelativePath(value: string): string | undefined {
  const normalized = value.replace(/\\/g, '/');
  const prefixes = [
    /^\/home\/user\//i,
    /^\/workspace\//i,
    /^\/app\//i,
    /^[a-z]:\/(?:workspace|app)\//i,
  ];
  const prefix = prefixes.find((candidate) => candidate.test(normalized));
  if (!prefix) return undefined;
  return normalizeSegments(normalized.replace(prefix, '').split('/'), []).join('/') || '.';
}
