import React, { useState, useEffect, useRef } from "react";
import { Folder, File, ChevronRight, ChevronDown, FileCode, AlertCircle, Trash2, RefreshCw, CheckCircle2, Code, Eye, Maximize2, X, History, GitCompare, Download, Save, RotateCcw, ShieldCheck } from "lucide-react";

interface TreeNode {
  name: string;
  type: "directory" | "file";
  path?: string;
  children?: TreeNode[];
}

export interface StructureFileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  summary?: string;
  diff?: string;
  changedAt: number;
  runId?: string;
  changeCount?: number;
}

interface StructureExplorerProps {
  refreshTrigger?: number;
  workspace?: string;
  focusRequest?: { path: string; requestId: number } | null;
  fileChanges?: StructureFileChange[];
  onFileChange?: (change: Omit<StructureFileChange, 'changeCount'>) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

type DiffLineKind = 'added' | 'removed' | 'hunk' | 'header' | 'context';

interface ParsedDiffLine {
  kind: DiffLineKind;
  prefix: string;
  text: string;
}

interface WorkspaceFileMetadata {
  hash: string;
  modifiedAt?: number;
  size?: number;
}

interface WorkspaceFileConflict extends WorkspaceFileMetadata {
  content: string;
}

interface RestorePointSummary {
  id: string;
  label: string;
  source: 'manual' | 'pre-restore';
  createdAt: number;
  workspace: string;
  fileCount: number;
  totalBytes: number;
}

interface ChangeStats {
  total: number;
  added: number;
  modified: number;
  deleted: number;
  linesAdded: number;
  linesRemoved: number;
}

function normalizeStructurePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '').toLowerCase();
}

function parseDiffLines(diff: string): ParsedDiffLine[] {
  return diff.split(/\r?\n/).map((line): ParsedDiffLine => {
    if (line.startsWith('@@')) return { kind: 'hunk', prefix: '', text: line };
    if (line.startsWith('+++ ') || line.startsWith('--- ') || line.startsWith('diff ') || line.startsWith('index ')) {
      return { kind: 'header', prefix: '', text: line };
    }
    if (line.startsWith('+')) return { kind: 'added', prefix: '+', text: line.slice(1) };
    if (line.startsWith('-')) return { kind: 'removed', prefix: '-', text: line.slice(1) };
    return { kind: 'context', prefix: ' ', text: line };
  });
}

function getDiffStats(diff?: string): Pick<ChangeStats, 'linesAdded' | 'linesRemoved'> {
  if (!diff) return { linesAdded: 0, linesRemoved: 0 };
  return parseDiffLines(diff).reduce(
    (stats, line) => {
      if (line.kind === 'added') stats.linesAdded += 1;
      if (line.kind === 'removed') stats.linesRemoved += 1;
      return stats;
    },
    { linesAdded: 0, linesRemoved: 0 },
  );
}

function emptyChangeStats(): ChangeStats {
  return { total: 0, added: 0, modified: 0, deleted: 0, linesAdded: 0, linesRemoved: 0 };
}

function changeStatsClass(stats: ChangeStats): string {
  if (stats.deleted > 0 && stats.added === 0 && stats.modified === 0) {
    return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
  }
  if (stats.added > 0 && stats.modified === 0 && stats.deleted === 0) {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  }
  return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
}

function HighlightedDiff({ diff, compact = false }: { diff: string; compact?: boolean }) {
  const lines = parseDiffLines(diff);
  const lineClasses: Record<DiffLineKind, string> = {
    added: 'bg-emerald-500/15 text-emerald-200',
    removed: 'bg-rose-500/15 text-rose-200',
    hunk: 'bg-cyan-500/10 text-cyan-300',
    header: 'text-slate-500',
    context: 'text-slate-400',
  };

  return (
    <pre className={`${compact ? 'max-h-64 text-[10px]' : 'text-xs'} custom-scrollbar overflow-auto rounded bg-black/30 p-2 font-mono leading-relaxed`}>
      <code>
        {lines.map((line, index) => (
          <span key={`${index}-${line.kind}`} className={`block min-w-max px-1 ${lineClasses[line.kind]}`}>
            <span className="mr-2 inline-block w-3 select-none text-center opacity-70">{line.prefix}</span>
            {line.text}
          </span>
        ))}
      </code>
    </pre>
  );
}

function changeLabel(change: StructureFileChange): string {
  if (change.status === 'added') return 'Added';
  if (change.status === 'deleted') return 'Deleted';
  return 'Modified';
}

function changeClass(change: StructureFileChange): string {
  if (change.status === 'added') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (change.status === 'deleted') return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
  return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
}

function formatChangeTime(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatRestorePointBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function StructureExplorer({
  refreshTrigger = 0,
  workspace = "",
  focusRequest = null,
  fileChanges = [],
  onFileChange,
  onDirtyChange,
}: StructureExplorerProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeTruncated, setTreeTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [openFilePaths, setOpenFilePaths] = useState<string[]>([]);
  
  const [fileContent, setFileContent] = useState<string>("");
  const [fileBaseline, setFileBaseline] = useState<string>("");
  const [fileMetadata, setFileMetadata] = useState<WorkspaceFileMetadata | null>(null);
  const [fileConflict, setFileConflict] = useState<WorkspaceFileConflict | null>(null);
  const [fileSaving, setFileSaving] = useState(false);
  const [fileSaveMessage, setFileSaveMessage] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [expandedFileModalOpen, setExpandedFileModalOpen] = useState(false);
  const [showChangeHistory, setShowChangeHistory] = useState(true);
  const [restorePoints, setRestorePoints] = useState<RestorePointSummary[]>([]);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const fileRequestRef = useRef(0);
  const lastFocusRequestRef = useRef<number | null>(null);

  const fileDirty = selectedFilePath !== null && fileContent !== fileBaseline;

  useEffect(() => {
    onDirtyChange?.(fileDirty);
  }, [fileDirty, onDirtyChange]);

  const normalizedWorkspace = normalizeStructurePath(workspace);
  const toWorkspaceRelativePath = (value: string): string => {
    const normalized = normalizeStructurePath(value);
    if (normalizedWorkspace && normalized.startsWith(`${normalizedWorkspace}/`)) {
      return normalized.slice(normalizedWorkspace.length + 1);
    }
    return normalized;
  };

  const toSafeWorkspacePath = (value: string): string => {
    const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
    const workspacePath = workspace.replace(/\\/g, '/').replace(/\/$/, '');
    if (workspacePath && normalized.toLowerCase().startsWith(`${workspacePath.toLowerCase()}/`)) {
      return normalized.slice(workspacePath.length + 1);
    }
    if (workspacePath && normalized.toLowerCase() === workspacePath.toLowerCase()) return '';
    return normalized;
  };

  const displayWorkspacePath = (value: string): string => {
    const relativePath = toSafeWorkspacePath(value);
    return relativePath || '(workspace root)';
  };

  const getFileChange = (filePath: string): StructureFileChange | undefined => {
    const relativePath = toWorkspaceRelativePath(filePath);
    return fileChanges
      .slice()
      .reverse()
      .find((change) => {
        const normalizedChange = toWorkspaceRelativePath(change.path);
        return normalizedChange === relativePath || normalizedChange.endsWith(`/${relativePath}`);
      });
  };

  const getChangeStatsForPath = (path: string): ChangeStats => {
    const relativePath = toWorkspaceRelativePath(path);
    return fileChanges.reduce((stats, change) => {
      const changedPath = toWorkspaceRelativePath(change.path);
      const isMatch = !relativePath || changedPath === relativePath || changedPath.startsWith(`${relativePath}/`);
      if (!isMatch) return stats;

      stats.total += 1;
      stats[change.status] += 1;
      const diffStats = getDiffStats(change.diff);
      stats.linesAdded += diffStats.linesAdded;
      stats.linesRemoved += diffStats.linesRemoved;
      return stats;
    }, emptyChangeStats());
  };

  const sortedChanges = fileChanges
    .slice()
    .sort((a, b) => b.changedAt - a.changedAt);
  const selectedFileChange = selectedFilePath ? getFileChange(selectedFilePath) : undefined;
  const workspaceLabel = workspace.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || 'workspace';
  const breadcrumbPath = selectedFilePath ? toSafeWorkspacePath(selectedFilePath) : '';
  const breadcrumbParts = breadcrumbPath.split('/').filter(Boolean);
  const expandTreePath = (path: string) => {
    const parts = path.split('/').filter(Boolean);
    let prefix = '';
    const ancestors = parts.map((part) => {
      prefix = prefix ? `${prefix}/${part}` : part;
      return prefix;
    });
    setExpandedDirs((current) => new Set([...current, ...ancestors]));
    window.requestAnimationFrame(() => {
      document.getElementById(`workspace-tree-item-${encodeURIComponent(path)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const fetchTree = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/workspace/tree?workspace=${encodeURIComponent(workspace)}`);
      if (!res.ok) throw new Error("Failed to fetch workspace tree");
      const data = await res.json();
      setTree(Array.isArray(data) ? data : Array.isArray(data?.tree) ? data.tree : []);
      setTreeTruncated(data?.truncated === true);
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const fetchRestorePoints = async () => {
    try {
      const response = await fetch(`/api/workspace/restore-points?workspace=${encodeURIComponent(workspace)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to load restore points');
      setRestorePoints(Array.isArray(data.restorePoints) ? data.restorePoints : []);
      setRestoreError(null);
    } catch (err: any) {
      setRestoreError(err.message || 'Cannot load restore points');
    }
  };

  useEffect(() => {
    fetchTree();
    void fetchRestorePoints();
  }, [refreshTrigger, workspace]);

  useEffect(() => {
    fileRequestRef.current += 1;
    setSelectedFilePath(null);
    setOpenFilePaths([]);
    setFileContent("");
    setFileBaseline("");
    setFileMetadata(null);
    setFileConflict(null);
    setFileSaveMessage(null);
    setFileError(null);
    setExpandedFileModalOpen(false);
  }, [workspace]);

  const handleDownloadFile = (e: React.MouseEvent | null, filePath: string) => {
    if (e) e.stopPropagation();
    const filename = filePath.split(/[\\/]/).pop() || 'file';
    const url = `/api/workspace/download-file?path=${encodeURIComponent(filePath)}&workspace=${encodeURIComponent(workspace)}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadZip = (e: React.MouseEvent | null, folderPath: string = '') => {
    if (e) e.stopPropagation();
    const zipName = folderPath
      ? (folderPath.split(/[\\/]/).pop() || 'folder')
      : (workspace ? workspace.split(/[\\/]/).pop() || 'workspace' : 'workspace');
    const url = `/api/workspace/download-zip?path=${encodeURIComponent(folderPath)}&workspace=${encodeURIComponent(workspace)}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = `${zipName}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSaveToLocalDisk = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (!('showDirectoryPicker' in window)) {
        alert("Your browser doesn't support the File System Access API. Please use Chrome or Edge.");
        return;
      }

      setLoading(true);
      const res = await fetch(`/api/workspace/tree?workspace=${encodeURIComponent(workspace)}`);
      if (!res.ok) throw new Error("Failed to fetch workspace tree");
      const data = await res.json();

      const flattenTree = (nodes: TreeNode[], parentPath: string = ""): string[] => {
        let files: string[] = [];
        for (const node of nodes) {
          const currentPath = parentPath ? `${parentPath}/${node.name}` : node.name;
          if (node.type === 'file') {
            files.push(currentPath);
          } else if (node.type === 'directory' && node.children) {
            files.push(...flattenTree(node.children, currentPath));
          }
        }
        return files;
      };

      const allFiles = flattenTree(data);
      if (allFiles.length === 0) {
        alert("Workspace is empty.");
        setLoading(false);
        return;
      }

      // @ts-ignore File System Access API is not included in every TypeScript lib.
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });

      let savedCount = 0;
      for (const filePath of allFiles) {
        const fileRes = await fetch(`/api/workspace/file?path=${encodeURIComponent(filePath)}&workspace=${encodeURIComponent(workspace)}`);
        if (!fileRes.ok) continue;

        const content = await fileRes.blob();
        const pathParts = filePath.split(/[\\/]/);
        const fileName = pathParts.pop();
        if (!fileName) continue;

        let currentDir = dirHandle;
        for (const part of pathParts) {
          currentDir = await currentDir.getDirectoryHandle(part, { create: true });
        }

        const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
        savedCount++;
      }

      alert(`Workspace successfully saved to disk! (${savedCount} files)`);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error(err);
      alert(err.message || "Cannot save to disk");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteItem = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete ${path.split(/[\\/]/).pop()}?`)) return;
    try {
      const res = await fetch(
        `/api/workspace/item?path=${encodeURIComponent(path)}&workspace=${encodeURIComponent(workspace)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error("Failed to delete item");
      if (selectedFilePath === path || selectedFilePath?.startsWith(path + '/')) {
        setSelectedFilePath(null);
        setFileContent("");
        setFileBaseline("");
        setFileMetadata(null);
        setFileConflict(null);
        setExpandedFileModalOpen(false);
      }
      setOpenFilePaths((current) => current.filter((openPath) => openPath !== path && !openPath.startsWith(path + '/')));
      onFileChange?.({
        path,
        status: 'deleted',
        summary: 'Deleted from Structure',
        changedAt: Date.now(),
      });
      fetchTree(); // Refresh tree
    } catch (err: any) {
      alert(err.message || "Cannot delete item");
    }
  };

  const handleToggleDir = (dirName: string, pathObj?: string) => {
    // Basic unique key for dirs can just be their relative path, but since tree has nested objects, 
    // let's construct a path string if available, else just use name (assuming unique enough for simple depth)
    const key = pathObj || dirName;
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedDirs(newExpanded);
  };

  const handleSelectFile = async (filePath: string, options: { confirmDirty?: boolean } = {}) => {
    const safeFilePath = toSafeWorkspacePath(filePath);
    if (!safeFilePath) return;
    if (fileDirty && options.confirmDirty !== false) {
      const shouldDiscard = window.confirm(
        `The local draft for ${displayWorkspacePath(selectedFilePath || safeFilePath)} has unsaved changes. Reload it and discard this draft?`,
      );
      if (!shouldDiscard) return;
    }

    const requestId = ++fileRequestRef.current;
    setSelectedFilePath(safeFilePath);
    setOpenFilePaths((current) => current.includes(safeFilePath) ? current : [...current, safeFilePath]);
    try {
      setFileLoading(true);
      setFileError(null);
      setFileSaveMessage(null);
      setFileConflict(null);
      const res = await fetch(
        `/api/workspace/file?path=${encodeURIComponent(safeFilePath)}&workspace=${encodeURIComponent(workspace)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load file content");
      if (requestId !== fileRequestRef.current) return;
      if (typeof data.content !== 'string' || typeof data.hash !== 'string') {
        throw new Error('The workspace file response is missing guarded revision metadata. Reload and try again.');
      }
      setFileContent(data.content);
      setFileBaseline(data.content);
      setFileMetadata({ hash: data.hash, modifiedAt: data.modifiedAt, size: data.size });
    } catch (err: any) {
      if (requestId !== fileRequestRef.current) return;
      setFileError(err.message || "Cannot read file");
      setFileContent("");
      setFileBaseline("");
      setFileMetadata(null);
    } finally {
      if (requestId === fileRequestRef.current) setFileLoading(false);
    }
  };

  useEffect(() => {
    if (!focusRequest?.path || loading || lastFocusRequestRef.current === focusRequest.requestId) return;
    const safePath = toSafeWorkspacePath(focusRequest.path);
    if (!safePath) return;
    lastFocusRequestRef.current = focusRequest.requestId;
    void handleSelectFile(safePath);
  }, [focusRequest?.path, focusRequest?.requestId, loading]);

  const handleSaveFile = async () => {
    if (!selectedFilePath || !fileMetadata || !fileDirty || fileSaving) return;
    setFileSaving(true);
    setFileError(null);
    setFileSaveMessage(null);
    try {
      const response = await fetch('/api/workspace/file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace,
          path: selectedFilePath,
          content: fileContent,
          expectedHash: fileMetadata.hash,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409 && data.conflict && typeof data.content === 'string' && typeof data.hash === 'string') {
        setFileConflict({
          content: data.content,
          hash: data.hash,
          modifiedAt: data.modifiedAt,
          size: data.size,
        });
        setFileError(data.error || 'The file changed on disk. Review the remote version before saving.');
        return;
      }
      if (!response.ok) throw new Error(data.error || 'Failed to save file');
      setFileBaseline(fileContent);
      setFileMetadata({ hash: data.hash, modifiedAt: data.modifiedAt, size: data.size });
      setFileConflict(null);
      setFileSaveMessage(`Saved ${displayWorkspacePath(selectedFilePath)}`);
      onFileChange?.({
        path: selectedFilePath,
        status: 'modified',
        summary: 'Saved from Structure editor',
        changedAt: Date.now(),
      });
      await fetchTree();
    } catch (err: any) {
      setFileError(err.message || 'Cannot save file');
    } finally {
      setFileSaving(false);
    }
  };

  const handleReloadRemoteFile = () => {
    if (!selectedFilePath || !fileConflict) return;
    setFileContent(fileConflict.content);
    setFileBaseline(fileConflict.content);
    setFileMetadata({
      hash: fileConflict.hash,
      modifiedAt: fileConflict.modifiedAt,
      size: fileConflict.size,
    });
    setFileConflict(null);
    setFileError(null);
    setFileSaveMessage(`Reloaded ${displayWorkspacePath(selectedFilePath)} from disk`);
  };

  const handleRefreshWorkspace = async () => {
    if (fileDirty) {
      const shouldReload = window.confirm(
        `The local draft for ${displayWorkspacePath(selectedFilePath || '')} has unsaved changes. Refreshing will reload the file and discard this draft. Continue?`,
      );
      if (!shouldReload) return;
    }
    await fetchTree();
    await fetchRestorePoints();
    if (selectedFilePath) await handleSelectFile(selectedFilePath, { confirmDirty: false });
  };

  const handleCreateRestorePoint = async () => {
    if (restoreLoading) return;
    setRestoreLoading(true);
    setRestoreMessage(null);
    setRestoreError(null);
    try {
      const response = await fetch('/api/workspace/restore-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace, label: 'Manual workspace restore point' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to create restore point');
      const point = data.restorePoint as RestorePointSummary | undefined;
      setRestoreMessage(point ? `Restore point created with ${point.fileCount} files (${formatRestorePointBytes(point.totalBytes)}).` : 'Restore point created.');
      await fetchRestorePoints();
    } catch (err: any) {
      setRestoreError(err.message || 'Cannot create restore point');
    } finally {
      setRestoreLoading(false);
    }
  };

  const handleRestorePoint = async (point: RestorePointSummary) => {
    if (restoreLoading) return;
    const confirmed = window.confirm(`Restore the workspace to “${point.label}”? An automatic rollback point will be created first.`);
    if (!confirmed) return;
    setRestoreLoading(true);
    setRestoreMessage(null);
    setRestoreError(null);
    try {
      const response = await fetch(`/api/workspace/restore-points/${encodeURIComponent(point.id)}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to restore workspace');
      setRestoreMessage(`Restored ${point.label}. Automatic rollback point ${data.rollback?.id ? 'is available' : 'was created'}.`);
      onDirtyChange?.(false);
      await fetchTree();
      await fetchRestorePoints();
      if (selectedFilePath) await handleSelectFile(selectedFilePath, { confirmDirty: false });
    } catch (err: any) {
      setRestoreError(err.message || 'Cannot restore workspace');
    } finally {
      setRestoreLoading(false);
    }
  };

  const handleCloseFile = (event: React.SyntheticEvent, filePath: string) => {
    event.stopPropagation();
    const tabIndex = openFilePaths.indexOf(filePath);
    const remaining = openFilePaths.filter((path) => path !== filePath);
    setOpenFilePaths(remaining);
    if (selectedFilePath !== filePath) return;
    const nextPath = remaining[Math.min(tabIndex, remaining.length - 1)];
    if (nextPath) {
      void handleSelectFile(nextPath);
    } else {
      fileRequestRef.current += 1;
      setSelectedFilePath(null);
      setFileContent("");
      setFileBaseline("");
      setFileMetadata(null);
      setFileConflict(null);
      setFileError(null);
      setFileSaveMessage(null);
      setExpandedFileModalOpen(false);
    }
  };

  useEffect(() => {
    fileRequestRef.current += 1;
    setOpenFilePaths([]);
    setSelectedFilePath(null);
    setFileContent("");
    setFileBaseline("");
    setFileMetadata(null);
    setFileConflict(null);
    setFileError(null);
    setFileSaveMessage(null);
    setExpandedFileModalOpen(false);
  }, [workspace]);

  useEffect(() => {
    if (!expandedFileModalOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpandedFileModalOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [expandedFileModalOpen]);

  const renderTree = (nodes: TreeNode[], parentPath: string = "") => {
    return (
      <ul className="space-y-1">
        {nodes.map((node, i) => {
          const currentPath = node.path || (parentPath ? `${parentPath}/${node.name}` : node.name);
          if (node.type === "directory") {
            const isExpanded = expandedDirs.has(currentPath);
            const directoryChanges = getChangeStatsForPath(currentPath);
            return (
              <li id={`workspace-tree-item-${encodeURIComponent(currentPath)}`} key={currentPath || i} className="text-text-dim">
                <div 
                  className={`group flex cursor-pointer select-none items-center justify-between rounded px-2 py-1.5 text-xs font-medium transition hover:bg-bg-active hover:text-white ${directoryChanges.total > 0 ? 'bg-amber-500/5' : ''}`}
                  onClick={() => handleToggleDir(node.name, currentPath)}
                  title={directoryChanges.total > 0 ? `${directoryChanges.total} changed file${directoryChanges.total === 1 ? '' : 's'} in this folder` : undefined}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-text-dark transition-colors group-hover:text-white">
                      {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    </span>
                    <Folder className={`h-3.5 w-3.5 shrink-0 ${directoryChanges.total > 0 ? 'text-amber-300' : 'text-cyan-400'}`} />
                    <span className="truncate pr-2">{node.name}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {directoryChanges.total > 0 && (
                      <span className={`rounded border px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider ${changeStatsClass(directoryChanges)}`}>
                        {directoryChanges.total} changed
                        {(directoryChanges.linesAdded > 0 || directoryChanges.linesRemoved > 0) && ` Â· +${directoryChanges.linesAdded}/-${directoryChanges.linesRemoved}`}
                      </span>
                    )}
                    <button
                      className="rounded p-1 text-text-dark opacity-0 transition-all hover:bg-bg-main hover:text-cyan-400 group-hover:opacity-100"
                      onClick={(e) => handleDownloadZip(e, currentPath)}
                      title="Download folder as ZIP"
                    >
                      <Download className="h-3 w-3" />
                    </button>
                    <button
                      className="rounded p-1 text-text-dark opacity-0 transition-all hover:bg-bg-main hover:text-rose-400 group-hover:opacity-100"
                      onClick={(e) => handleDeleteItem(e, currentPath)}
                      title="Delete folder"
                    >
                       <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                {isExpanded && node.children && (
                  <div className="ml-3.5 border-l border-border-main pl-3">
                    {renderTree(node.children, currentPath)}
                  </div>
                )}
              </li>
            );
          } else {
            const isSelected = selectedFilePath === node.path;
            const fullPath = node.path!;
            const fileChange = getFileChange(fullPath);
            const fileDiffStats = getDiffStats(fileChange?.diff);
            return (
              <li id={`workspace-tree-item-${encodeURIComponent(fullPath)}`} key={fullPath || i}>
                <div 
                  className={`group flex cursor-pointer select-none items-center justify-between rounded py-1.5 pl-6 pr-2 text-xs font-mono transition-colors ${isSelected ? 'border-l-2 border-cyan-400 bg-bg-active text-cyan-400 font-bold' : 'text-text-dim hover:bg-bg-active/50 hover:text-white'}`}
                  onClick={() => handleSelectFile(fullPath)}
                  title={fileChange ? `${changeLabel(fileChange)}: ${fileChange.summary || 'File changed'}` : undefined}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <File className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-cyan-400' : 'text-text-dim'}`} />
                    <span className="truncate">{node.name}</span>
                    {fileChange && (
                      <span className={`shrink-0 rounded border px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider ${changeClass(fileChange)}`}>
                        {fileChange.status === 'modified' ? 'M' : fileChange.status === 'added' ? 'A' : 'D'}
                        {(fileChange.changeCount || 1) > 1 ? ` Ã—${fileChange.changeCount}` : ''}
                      </span>
                    )}
                  {fileChange && (fileDiffStats.linesAdded > 0 || fileDiffStats.linesRemoved > 0) && (
                    <span className="shrink-0 font-mono text-[8px] font-bold tracking-tight">
                      <span className="text-emerald-400">+{fileDiffStats.linesAdded}</span>
                      <span className="text-text-dark">/</span>
                      <span className="text-rose-400">-{fileDiffStats.linesRemoved}</span>
                    </span>
                  )}
                  </div>
                  <button
                    className="rounded p-1 text-text-dark opacity-0 transition-all hover:bg-bg-main hover:text-cyan-400 group-hover:opacity-100"
                    onClick={(e) => handleDownloadFile(e, fullPath)}
                    title="Download file"
                  >
                    <Download className="h-3 w-3" />
                  </button>
                  <button 
                    className="rounded p-1 text-text-dark opacity-0 transition-all hover:bg-bg-main hover:text-rose-400 group-hover:opacity-100"
                    onClick={(e) => handleDeleteItem(e, fullPath)}
                    title="Delete file"
                  >
                     <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </li>
            );
          }
        })}
      </ul>
    );
  };

  return (
    <div className="grid min-h-[620px] grid-cols-1 gap-6 lg:grid-cols-4">
      <aside className="flex h-full flex-col justify-between rounded-xl border border-border-main bg-bg-panel p-4 lg:col-span-1">
        <div className="min-h-0">
          <div className="mb-4 flex items-center justify-between border-b border-border-main pb-3">
            <div className="min-w-0">
              <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-text-dim">
                <Code className="h-3.5 w-3.5 text-cyan-400" />
                Directory Tree
              </span>
              <div className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[10px] text-text-dark">
                <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                <span className="truncate">{workspace || "Loading target..."}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {('showDirectoryPicker' in window) && (
                <button
                  type="button"
                  onClick={handleSaveToLocalDisk}
                  className="flex items-center gap-1 rounded border border-border-main bg-bg-active px-2 py-1.5 text-[10px] font-bold text-text-dim transition hover:bg-[#252528] hover:text-emerald-400"
                  title="Save workspace to local disk folder"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>SAVE LOCAL</span>
                </button>
              )}
              <button
                type="button"
                onClick={(e) => handleDownloadZip(e, '')}
                className="flex items-center gap-1 rounded border border-border-main bg-bg-active px-2 py-1.5 text-[10px] font-bold text-text-dim transition hover:bg-[#252528] hover:text-cyan-400"
                title="Download workspace as ZIP archive"
              >
                <Download className="h-3.5 w-3.5" />
                <span>ZIP</span>
              </button>
              <button
                onClick={() => void handleRefreshWorkspace()}
                disabled={loading}
                className="rounded border border-border-main bg-bg-active p-1.5 text-text-dim transition hover:bg-[#252528] hover:text-white disabled:opacity-60"
                title="Refresh workspace"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          <nav aria-label="Workspace breadcrumb" className="mb-3 flex min-w-0 items-center gap-1 overflow-x-auto rounded border border-border-main bg-bg-main/60 px-2 py-1.5 font-mono text-[9px]">
            <button
              type="button"
              title={workspace || 'Workspace root'}
              onClick={() => document.getElementById('workspace-directory-tree')?.scrollTo({ top: 0, behavior: 'smooth' })}
              className="shrink-0 truncate font-semibold text-cyan-300 hover:text-white"
            >
              {workspaceLabel}
            </button>
            {breadcrumbParts.map((part, index) => {
              const path = breadcrumbParts.slice(0, index + 1).join('/');
              const isFile = index === breadcrumbParts.length - 1;
              return (
                <React.Fragment key={path}>
                  <ChevronRight className="h-3 w-3 shrink-0 text-text-dark" />
                  <button
                    type="button"
                    title={path}
                    onClick={() => isFile ? void handleSelectFile(path) : expandTreePath(path)}
                    className={`shrink-0 truncate ${isFile ? 'max-w-36 text-text-dim hover:text-white' : 'text-cyan-300 hover:text-white'}`}
                  >
                    {part}
                  </button>
                </React.Fragment>
              );
            })}
          </nav>

          <div className="mb-4 rounded border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                  Recoverable workspace state
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-text-dark">Snapshot validated files before risky edits or restore an earlier point. Generated and dependency folders are excluded.</p>
              </div>
              <button
                type="button"
                data-testid="create-restore-point"
                onClick={() => void handleCreateRestorePoint()}
                disabled={restoreLoading}
                className="flex shrink-0 items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                title="Create a validated workspace restore point"
              >
                <RotateCcw className={`h-3 w-3 ${restoreLoading ? 'animate-spin' : ''}`} />
                Snapshot
              </button>
            </div>
            {restoreMessage && <div className="mt-2 text-[10px] text-emerald-200" role="status">{restoreMessage}</div>}
            {restoreError && <div className="mt-2 text-[10px] text-rose-300" role="alert">{restoreError}</div>}
            {restorePoints.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-emerald-500/15 pt-2">
                <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-text-dark">
                  <span>Available restore points</span>
                  <span>{restorePoints.length}</span>
                </div>
                {restorePoints.slice(0, 6).map((point) => (
                  <div key={point.id} className="flex items-center gap-2 rounded bg-black/15 px-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[10px] text-text-dim">{point.label}</div>
                      <div className="font-mono text-[9px] text-text-dark">{point.source === 'pre-restore' ? 'Automatic rollback' : 'Manual'} · {point.fileCount} files · {formatRestorePointBytes(point.totalBytes)}</div>
                    </div>
                    <button
                      type="button"
                      data-testid={`restore-point-${point.id}`}
                      onClick={() => void handleRestorePoint(point)}
                      disabled={restoreLoading}
                      className="shrink-0 rounded border border-amber-500/30 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-amber-300 transition hover:bg-amber-500/10 disabled:opacity-40"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div id="workspace-directory-tree" className="custom-scrollbar max-h-[500px] overflow-y-auto pr-1">
            {treeTruncated && <div className="mb-2 rounded border border-amber-500/30 bg-amber-950/20 p-2 text-[10px] text-amber-200">Tree depth limit reached; some nested files are not shown.</div>}
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 font-mono text-[10px] uppercase tracking-wider text-text-dark">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
                Loading workspace nodes
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10 text-center text-rose-400">
                <AlertCircle className="h-8 w-8 opacity-80" />
                <p className="text-xs">{error}</p>
              </div>
            ) : tree.length === 0 ? (
              <div className="py-10 text-center font-mono text-[10px] uppercase tracking-wider text-text-dark">
                No workspace nodes
              </div>
            ) : (
              renderTree(tree)
            )}
          </div>

          {sortedChanges.length > 0 && (
            <div className="mt-4 border-t border-border-main pt-3">
              <button
                type="button"
                onClick={() => setShowChangeHistory((current) => !current)}
                className="flex w-full items-center justify-between text-left text-[10px] font-bold uppercase tracking-wider text-text-dim hover:text-white"
              >
                <span className="flex items-center gap-2">
                  <History className="h-3.5 w-3.5 text-amber-400" />
                  Change history
                </span>
                <span className="font-mono text-text-dark">{sortedChanges.length}</span>
              </button>
              {showChangeHistory && (
                <div className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
                  {sortedChanges.slice(0, 12).map((change) => {
                    const canOpen = change.status !== 'deleted';
                    return (
                      <button
                        key={`${change.path}-${change.changedAt}`}
                        type="button"
                        disabled={!canOpen}
                        onClick={() => canOpen && void handleSelectFile(change.path)}
                        className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-[10px] transition ${canOpen ? 'hover:bg-bg-active' : 'cursor-default opacity-70'}`}
                        title={change.summary || changeLabel(change)}
                      >
                        <span className={`mt-0.5 shrink-0 rounded border px-1 py-0.5 text-[8px] font-bold uppercase ${changeClass(change)}`}>
                          {change.status === 'modified' ? 'M' : change.status === 'added' ? 'A' : 'D'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-text-dim">{change.path.split(/[\\/]/).pop()}</span>
                          <span className="block truncate text-text-dark">{change.summary || changeLabel(change)}</span>
                        </span>
                        <span className="shrink-0 font-mono text-[9px] text-text-dark">{formatChangeTime(change.changedAt)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-2 border-t border-border-main pt-4 font-mono text-[10px] text-text-dark">
          <span className="truncate">Target: {workspace || "Not selected"}</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={(e) => handleDownloadZip(e, '')}
              className="flex shrink-0 items-center gap-1 rounded text-cyan-400 transition hover:text-cyan-300 hover:underline"
              title="Download entire workspace as ZIP"
            >
              <Download className="h-3 w-3" />
              <span>Download ZIP</span>
            </button>
            {('showDirectoryPicker' in window) && (
              <button
                type="button"
                onClick={handleSaveToLocalDisk}
                className="flex shrink-0 items-center gap-1 rounded text-emerald-400 transition hover:text-emerald-300 hover:underline"
                title="Save entire workspace to local disk folder"
              >
                <Save className="h-3 w-3" />
                <span>Save Local</span>
              </button>
            )}
          </div>
        </div>
      </aside>

      <section className="flex min-h-[620px] flex-col overflow-hidden rounded-xl border border-border-main bg-bg-panel lg:col-span-3">
        {openFilePaths.length > 0 && (
          <div className="custom-scrollbar flex overflow-x-auto border-b border-border-main bg-[#111]">
            {openFilePaths.map((path) => {
              const active = selectedFilePath === path;
              return (
                <button
                  key={path}
                  type="button"
                  onClick={() => {
                    if (!active) void handleSelectFile(path);
                  }}
                  className={`group/tab flex min-w-[140px] max-w-[240px] shrink-0 items-center gap-2 border-r border-border-main px-3 py-2.5 text-left font-mono text-[10px] transition ${
                    active
                      ? "border-t-2 border-t-cyan-400 bg-bg-main text-slate-100"
                      : "border-t-2 border-t-transparent bg-bg-card text-text-dim hover:bg-bg-active hover:text-white"
                  }`}
                  title={path}
                >
                  <FileCode className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                  <span className="min-w-0 flex-1 truncate">{path.split(/[\\/]/).pop()}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(event) => handleCloseFile(event, path)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        handleCloseFile(event, path);
                      }
                    }}
                    className="rounded p-0.5 text-text-dark opacity-60 hover:bg-neutral-700 hover:text-white group-hover/tab:opacity-100"
                    aria-label={`Close ${path}`}
                  >
                    <X className="h-3 w-3" />
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {selectedFilePath ? (
          <>
            <div className="flex select-none items-center justify-between border-b border-border-main bg-bg-panel px-6 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <FileCode className="h-4 w-4 shrink-0 text-cyan-400" />
                <span className="truncate font-mono text-xs font-medium text-slate-200">
                  {displayWorkspacePath(selectedFilePath)}
                </span>
                <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${fileDirty ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-border-main bg-bg-main text-text-dark'}`}>
                  {fileDirty ? 'Unsaved Draft' : 'Synced'}
                </span>
                {selectedFileChange && (
                  <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${changeClass(selectedFileChange)}`}>
                    {changeLabel(selectedFileChange)}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveFile()}
                  disabled={!fileDirty || !fileMetadata || fileSaving}
                  className="flex items-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-300 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                  title={fileDirty ? 'Save guarded file draft' : 'No unsaved changes'}
                  aria-label="Save file"
                >
                  <Save className={`h-3.5 w-3.5 ${fileSaving ? 'animate-pulse' : ''}`} />
                  <span className="text-[10px] font-bold uppercase tracking-wider">{fileSaving ? 'Saving' : 'Save'}</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => handleDownloadFile(e, selectedFilePath)}
                  className="flex items-center gap-1.5 rounded border border-border-main bg-bg-active px-2.5 py-1 text-xs text-text-dim transition hover:bg-[#252528] hover:text-cyan-400"
                  title="Download this file"
                  aria-label="Download file"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Download</span>
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedFileModalOpen(true)}
                  className="shrink-0 rounded border border-border-main bg-bg-active p-1.5 text-text-dim transition hover:text-cyan-400"
                  title="Open larger read-only view"
                  aria-label="Open file in larger view"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="custom-scrollbar flex-1 overflow-auto bg-bg-main p-4">
              {fileConflict && (
                <div className="mb-4 rounded border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-100" role="alert">
                  <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider text-rose-300">
                    <AlertCircle className="h-3.5 w-3.5" />
                    File changed on disk
                  </div>
                  <p className="mt-1 text-rose-200/80">Your local draft is preserved. Reload the remote file to discard it, or keep the draft and merge manually before trying again.</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={handleReloadRemoteFile} className="rounded border border-rose-400/40 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-rose-200 transition hover:bg-rose-500/20">Reload remote</button>
                    <button type="button" onClick={() => setFileConflict(null)} className="rounded border border-border-main px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-text-dim transition hover:bg-bg-active hover:text-white">Keep my draft</button>
                  </div>
                </div>
              )}
              {fileSaveMessage && (
                <div className="mb-4 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200" role="status">
                  {fileSaveMessage}
                </div>
              )}
              {fileError && !fileLoading && (
                <div className="mb-4 flex items-center gap-2 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300" role="alert">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {fileError}
                </div>
              )}
              {selectedFileChange && (
                <div className={`mb-4 rounded border p-3 text-xs ${changeClass(selectedFileChange)}`}>
                  <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider">
                    <GitCompare className="h-3.5 w-3.5" />
                    {changeLabel(selectedFileChange)} {selectedFileChange.changeCount && selectedFileChange.changeCount > 1 ? `(${selectedFileChange.changeCount} updates)` : ''}
                  </div>
                  <p className="mt-1 opacity-80">{selectedFileChange.summary || 'This file changed during the current session.'}</p>
                  {selectedFileChange.diff && (
                    <details className="mt-2" open>
                      <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wider">Highlighted diff</summary>
                      <div className="mt-2">
                        <HighlightedDiff diff={selectedFileChange.diff} compact />
                      </div>
                    </details>
                  )}
                </div>
              )}
              {fileLoading ? (
                <div className="flex items-center gap-2 text-sm text-text-dim">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400" />
                  Reading file...
                </div>
              ) : (
                <textarea
                  data-testid="structure-file-editor"
                  value={fileContent}
                  onChange={(event) => {
                    setFileContent(event.target.value);
                    setFileSaveMessage(null);
                    setFileError(null);
                  }}
                  spellCheck={false}
                  aria-label={`Edit ${displayWorkspacePath(selectedFilePath)}`}
                  className="min-h-[520px] w-full resize-none whitespace-pre rounded border border-border-main bg-black/20 p-3 font-mono text-xs leading-relaxed text-slate-300 outline-none transition focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20"
                  style={{ tabSize: 2 }}
                />
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-text-dark">
            <Eye className="mb-4 h-12 w-12 text-border-main" />
            <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-text-dim">
              No File Selected
            </h3>
            <p className="max-w-sm text-[11px]">
              Select a file from the workspace directory tree to review code structure.
            </p>
          </div>
        )}
      </section>

      {expandedFileModalOpen && selectedFilePath && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`Read-only file ${selectedFilePath}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setExpandedFileModalOpen(false);
          }}
        >
          <section className="flex h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl border border-cyan-500/30 bg-neutral-950 shadow-[0_24px_80px_rgba(0,0,0,0.7)]">
            <header className="flex items-center justify-between gap-4 border-b border-neutral-800 bg-neutral-900 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <FileCode className="h-4 w-4 shrink-0 text-cyan-400" />
              <span className="truncate font-mono text-xs text-neutral-100">{displayWorkspacePath(selectedFilePath)}</span>
                <span className="shrink-0 rounded border border-neutral-700 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-neutral-400">
                  Read only
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => handleDownloadFile(e, selectedFilePath)}
                  className="flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 transition hover:bg-neutral-700 hover:text-cyan-400"
                  title="Download file"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download File</span>
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedFileModalOpen(false)}
                  className="rounded-lg p-2 text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
                  aria-label="Close larger file view"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>
            <div className="custom-scrollbar min-h-0 flex-1 overflow-auto bg-[#090909] p-4 sm:p-6">
              {fileLoading ? (
                <div className="flex items-center gap-2 font-mono text-xs text-neutral-400">
                  Reading file...
                </div>
              ) : fileError ? (
                <div className="rounded border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-200">{fileError}</div>
              ) : (
                <pre className="min-h-full whitespace-pre font-mono text-xs leading-relaxed text-slate-300" style={{ tabSize: 2 }}>
                  <code>{fileContent}</code>
                </pre>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
