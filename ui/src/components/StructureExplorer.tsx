import React, { useState, useEffect } from "react";
import { Folder, File, RefreshCw, ChevronDown, ChevronRight, Eye, Save, Code, Download } from "lucide-react";

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  size?: number;
}

interface StructureExplorerProps {
  selectedFilePath: string | null;
  onFileSelect: (filePath: string) => void;
  refreshTrigger: number;
  workspace?: string;
}

export default function StructureExplorer({ selectedFilePath, onFileSelect, refreshTrigger, workspace }: StructureExplorerProps) {
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [treeTruncated, setTreeTruncated] = useState(false);
  const [rootPath, setRootPath] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    "src": true,
  });
  const [activeFileContent, setActiveFileContent] = useState<string>("");
  const [activeFileHash, setActiveFileHash] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizeTree = (nodes: unknown): FileNode[] => {
    if (!Array.isArray(nodes)) return [];
    return nodes.flatMap((rawNode): FileNode[] => {
      if (!rawNode || typeof rawNode !== "object") return [];
      const node = rawNode as { name?: unknown; path?: unknown; type?: unknown; children?: unknown[]; size?: unknown };
      if (typeof node.name !== "string" || typeof node.path !== "string") return [];
      return [{
        name: node.name,
        path: node.path,
        isDirectory: node.type === "directory",
        ...(node.type === "directory" ? { children: normalizeTree(node.children) } : {}),
        ...(typeof node.size === "number" ? { size: node.size } : {}),
      }];
    });
  };

  const fetchStructure = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (workspace) params.append("workspace", workspace);
      const response = await fetch(`/api/workspace/tree?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load workspace structure");
      setFileTree(normalizeTree(Array.isArray(data) ? data : data?.tree));
      setTreeTruncated(data?.truncated === true);
      setRootPath(workspace || "target");
    } catch (err) {
      console.error("Failed to fetch structure:", err);
      setError(err instanceof Error ? err.message : "Failed to load workspace structure");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStructure();
  }, [refreshTrigger]);

  useEffect(() => {
    if (selectedFilePath) {
      loadFileContent(selectedFilePath);
    }
  }, [selectedFilePath]);

  const loadFileContent = async (path: string) => {
    try {
      const response = await fetch(`/api/workspace/file?path=${encodeURIComponent(path)}&workspace=${encodeURIComponent(workspace || "")}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to read file");
      setActiveFileContent(typeof data.content === "string" ? data.content : "");
      setActiveFileHash(typeof data.hash === "string" ? data.hash : "");
      setIsEditing(false);
    } catch (err) {
      console.error("Failed to read file:", err);
      setError(err instanceof Error ? err.message : "Failed to read file");
    }
  };

  const handleSaveFile = async () => {
    if (!selectedFilePath || !activeFileHash) return;
    setIsSaving(true);
    try {
      const response = await fetch("/api/workspace/file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: selectedFilePath,
          content: activeFileContent,
          workspace,
          expectedHash: activeFileHash,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save file");
      setActiveFileHash(typeof data.hash === "string" ? data.hash : activeFileHash);
      setIsEditing(false);
      setError(null);
      alert("File modifications persisted successfully.");
      fetchStructure();
    } catch (err) {
      console.error("Failed to write file:", err);
      setError(err instanceof Error ? err.message : "Failed to save file");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownloadFile = () => {
    if (!selectedFilePath) return;
    const url = `/api/workspace/download-file?path=${encodeURIComponent(selectedFilePath)}&workspace=${encodeURIComponent(workspace || '')}`;
    window.open(url, '_blank');
  };

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders(prev => ({
      ...prev,
      [folderPath]: !prev[folderPath]
    }));
  };

  const handleDownloadFromTree = (path: string, filename: string) => {
    const url = `/api/workspace/download-file?path=${encodeURIComponent(path)}&workspace=${encodeURIComponent(workspace || '')}`;
    window.open(url, '_blank');
  };

  const renderTreeNodes = (nodes: FileNode[], depth = 0) => {
    return nodes.map((node) => {
      const indentClass = depth === 0 ? "" : "pl-4";
      if (node.isDirectory) {
        const isExpanded = !!expandedFolders[node.path];
        return (
          <div key={node.path} className={indentClass}>
            <button
              onClick={() => toggleFolder(node.path)}
              className="w-full flex items-center gap-2 py-1.5 px-2 hover:bg-bg-active text-text-dim hover:text-white rounded transition text-xs font-medium"
            >
              {isExpanded ? <ChevronDown className="w-3 h-3 text-text-dark" /> : <ChevronRight className="w-3 h-3 text-text-dark" />}
              <Folder className="w-3.5 h-3.5 text-cyan-400" />
              <span className="truncate">{node.name}</span>
            </button>
            {isExpanded && node.children && (
              <div className="border-l border-border-main ml-3.5 mt-0.5">
                {renderTreeNodes(node.children, depth + 1)}
              </div>
            )}
          </div>
        );
      } else {
        const isSelected = selectedFilePath === node.path;
        return (
          <div key={node.path} className={indentClass}>
            <button
              onClick={() => onFileSelect(node.path)}
              className={`group w-full flex items-center justify-between py-1.5 px-2 text-xs font-mono transition ${
                isSelected 
                  ? "bg-bg-active text-cyan-400 font-bold border-l-2 border-cyan-400" 
                  : "text-text-dim hover:bg-bg-active/50 hover:text-white"
              }`}
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <File className="w-3.5 h-3.5 text-text-dim flex-shrink-0" />
                <span className="truncate">{node.name}</span>
              </div>
              <Download 
                className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-cyan-400 flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownloadFromTree(node.path, node.name);
                }}
                title={`Download ${node.name}`}
              />
            </button>
          </div>
        );
      }
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 min-h-[580px]">
      {/* LEFT: FILE TREE EXPLORER */}
      <div className="lg:col-span-1 bg-bg-panel border border-border-main rounded-xl p-4 flex flex-col h-full justify-between">
        <div>
          <div className="flex items-center justify-between mb-4 border-b border-border-main pb-3">
            <span className="text-[10px] font-bold text-text-dim tracking-wider uppercase flex items-center gap-2">
              <Code className="w-3.5 h-3.5 text-cyan-400" />
              Directory Tree
            </span>
            
            <button
              onClick={async () => {
                setIsLoading(true);
                try {
                  const res = await fetch('/api/workspace/restore-points', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace }) });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error || 'Failed to create restore point');
                  alert(data.restorePoint ? `Restore point ${data.restorePoint.id} created.` : 'Restore point created.');
                } finally { setIsLoading(false); }
              }}
              disabled={isLoading}
              className="p-1.5 bg-bg-active hover:bg-[#252528] border border-border-main rounded text-cyan-400 hover:text-cyan-300 transition"
              title="Create Restore Point"
            >
              <Save className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={async () => {
                if (!confirm('Are you sure you want to restore? This will discard current changes.')) return;
                setIsLoading(true);
                try {
                  const res = await fetch('/api/workspace/restore-points', { method: 'GET', headers: { 'Content-Type': 'application/json' } });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error || 'Failed to load restore points');
                  const restorePoint = data.restorePoints?.[0];
                  if (!restorePoint?.id) throw new Error('No restore points are available for this workspace.');
                  const restoreRes = await fetch(`/api/workspace/restore-points/${encodeURIComponent(restorePoint.id)}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace }) });
                  const restoreData = await restoreRes.json();
                  if (!restoreRes.ok) throw new Error(restoreData.error || 'Failed to restore workspace');
                  alert(`Restored ${restorePoint.id}.`);
                  await fetchStructure();
                } finally { setIsLoading(false); }
              }}
              disabled={isLoading}
              className="p-1.5 bg-bg-active hover:bg-[#252528] border border-border-main rounded text-amber-400 hover:text-amber-300 transition"
              title="Restore to Point"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={fetchStructure}
              disabled={isLoading}
              className="p-1.5 bg-bg-active hover:bg-[#252528] border border-border-main rounded text-text-dim hover:text-white transition"
              title="Refresh tree"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          </div>

          <div className="overflow-y-auto max-h-[440px] pr-1 space-y-1">
            {error && <div className="mb-3 rounded border border-rose-500/30 bg-rose-950/20 p-2 text-[10px] text-rose-300">{error}</div>}
            {treeTruncated && <div className="mb-3 rounded border border-amber-500/30 bg-amber-950/20 p-2 text-[10px] text-amber-200">Tree depth limit reached; some nested files are not shown.</div>}
            {fileTree.length === 0 ? (
              <div className="text-center py-10 text-text-dark text-[10px] font-mono uppercase tracking-wider">
                // Loading workspace nodes
              </div>
            ) : (
              renderTreeNodes(fileTree)
            )}
          </div>
        </div>

        <div className="border-t border-border-main pt-4 mt-4 text-[10px] text-text-dark font-mono truncate">
          <span>Target: {rootPath || "C:\\Workspace\\"}</span>
        </div>
      </div>

      {/* RIGHT: LIVE EDITOR/PREVIEW */}
      <div className="lg:col-span-3 bg-bg-panel border border-border-main rounded-xl flex flex-col justify-between overflow-hidden">
        {selectedFilePath ? (
          <div className="flex-1 flex flex-col h-full">
            {/* Editor Header */}
            <div className="bg-bg-panel px-6 py-3 border-b border-border-main flex items-center justify-between select-none">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-medium text-slate-200">{selectedFilePath}</span>
                <span className="px-1.5 py-0.5 bg-bg-main border border-border-main text-[9px] font-mono rounded text-text-dark uppercase font-bold tracking-wider">
                  {isEditing ? "Editable Buffer" : "Read-only View"}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {isEditing ? (
                  <>
                    <button
                      onClick={() => setIsEditing(false)}
                      className="px-3 py-1.5 bg-bg-active hover:bg-[#252528] border border-border-main rounded text-xs font-bold uppercase tracking-wider text-text-dim transition"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveFile}
                      disabled={isSaving}
                      className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-black rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition"
                    >
                      <Save className="w-3.5 h-3.5" />
                      Save File
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={handleDownloadFile}
                      className="px-3 py-1.5 bg-bg-active hover:bg-[#252528] border border-border-main text-slate-300 rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition"
                      title="Download File"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download
                    </button>
                    <button
                      onClick={() => setIsEditing(true)}
                      className="px-3 py-1.5 bg-bg-active hover:bg-[#252528] border border-border-main text-cyan-400 rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition"
                    >
                      Edit Code
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Code text container */}
            <div className="flex-1 p-1 bg-bg-main font-mono text-xs flex">
              <textarea
                value={activeFileContent}
                onChange={(e) => {
                  if (isEditing) {
                    setActiveFileContent(e.target.value);
                  }
                }}
                readOnly={!isEditing}
                className={`w-full h-[400px] outline-none font-mono text-[11px] p-4 bg-transparent resize-none leading-relaxed text-slate-300 border-none focus:ring-0 ${
                  isEditing ? "caret-cyan-400" : "cursor-default"
                }`}
                style={{ tabSize: 2 }}
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-text-dark">
            <Eye className="w-12 h-12 text-border-main mb-4 animate-pulse" />
            <h3 className="text-text-dim font-bold uppercase tracking-wider mb-1.5 text-xs">No File Selected</h3>
            <p className="text-[11px] max-w-sm lowercase">Select a file from the workspace directory tree on the left to review code structure and modify content.</p>
          </div>
        )}
      </div>
    </div>
  );
}
