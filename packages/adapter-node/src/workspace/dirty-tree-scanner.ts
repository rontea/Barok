import { execSync } from 'node:child_process';

/** Change status types for files. */
export type FileChangeStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';

/** Simplified diff hunk. */
export interface ChangeHunk {
  startLine: number;
  endLine: number;
  changeType: 'added' | 'removed' | 'modified';
  content?: string;
}

/** Dirty file status entry with a path relative to the repository root. */
export interface DirtyFileStatus {
  path: string;
  status: FileChangeStatus;
  hunks: ChangeHunk[];
  lastModified: number;
  diffPreview?: string;
}

/** Dirty tree snapshot returned by the Node Git scanner. */
export interface DirtyTreeState {
  isDirty: boolean;
  files: DirtyFileStatus[];
  modifiedCount: number;
  addedCount: number;
  deletedCount: number;
  untrackedCount: number;
  totalChanges: number;
  lastScanned: number;
}

/** Gets Git status for a repository (modified, added, deleted files). */
export function getGitStatus(repoRoot: string): DirtyFileStatus[] {
  try {
    const statusOutput = execSync('git status -s', {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const files: DirtyFileStatus[] = [];
    const lines = statusOutput.split('\n').filter((line) => line.trim());

    for (const line of lines) {
      const status = line.substring(0, 2);
      const filePath = line.substring(3);
      let fileStatus: FileChangeStatus;

      if (status[0] === 'M' || status[1] === 'M') {
        fileStatus = 'modified';
      } else if (status[0] === 'A' || status[1] === 'A') {
        fileStatus = 'added';
      } else if (status[0] === 'D' || status[1] === 'D') {
        fileStatus = 'deleted';
      } else if (status[0] === 'R' || status[1] === 'R') {
        fileStatus = 'renamed';
      } else {
        fileStatus = 'untracked';
      }

      files.push({ path: filePath, status: fileStatus, hunks: [], lastModified: Date.now() });
    }

    return files;
  } catch {
    return [];
  }
}

/** Gets changed line ranges for one file. */
export function getFileDiff(repoRoot: string, filePath: string): ChangeHunk[] {
  try {
    const diffOutput = execSync(`git diff --unified=0 "${filePath}"`, {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const hunks: ChangeHunk[] = [];
    const hunkRegex = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/g;
    let match: RegExpExecArray | null;

    while ((match = hunkRegex.exec(diffOutput)) !== null) {
      const startLine = parseInt(match[3], 10);
      const count = parseInt(match[4] || '1', 10);
      hunks.push({ startLine, endLine: startLine + count - 1, changeType: 'modified' });
    }

    return hunks;
  } catch {
    return [];
  }
}

/** Gets untracked files that are not ignored by Git. */
export function getUntrackedFiles(repoRoot: string): string[] {
  try {
    const output = execSync('git ls-files --others --exclude-standard', {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    return output
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => line.trim());
  } catch {
    return [];
  }
}

/** Scans Git status and untracked paths into a dirty-tree snapshot. */
export function scanDirtyTree(repoRoot: string): DirtyTreeState {
  const files = getGitStatus(repoRoot);
  for (const file of getUntrackedFiles(repoRoot)) {
    if (!files.some((entry) => entry.path === file)) {
      files.push({ path: file, status: 'untracked', hunks: [], lastModified: Date.now() });
    }
  }

  for (const file of files) {
    if (file.status === 'modified') file.hunks = getFileDiff(repoRoot, file.path);
  }

  const modifiedCount = files.filter((file) => file.status === 'modified').length;
  const addedCount = files.filter((file) => file.status === 'added').length;
  const deletedCount = files.filter((file) => file.status === 'deleted').length;
  const untrackedCount = files.filter((file) => file.status === 'untracked').length;

  return {
    isDirty: files.length > 0,
    files,
    modifiedCount,
    addedCount,
    deletedCount,
    untrackedCount,
    totalChanges: files.length,
    lastScanned: Date.now(),
  };
}
