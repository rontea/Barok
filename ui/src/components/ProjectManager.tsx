import React, { useState, useRef } from "react";
import { FolderOpen, Loader2, RefreshCw, Edit3 } from "lucide-react";

interface ProjectManagerProps {
  workspace: string;
  updateWorkspace: (workspace: string) => void;
  handleLoadRepoMap: () => void | Promise<void>;
  repoMap?: unknown;
  onOpenFolderModal?: () => void;
  triggerRefresh?: () => void;
}

export default function ProjectManager({ workspace, updateWorkspace, handleLoadRepoMap, repoMap: _repoMap, onOpenFolderModal, triggerRefresh }: ProjectManagerProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadWorkspace = async (name: string) => {
    setIsLoading(true);
    updateWorkspace(name);
    // Give it a moment to update state, then load repo map
    setTimeout(() => {
      handleLoadRepoMap();
      if (triggerRefresh) triggerRefresh();
      setIsLoading(false);
    }, 200);
  };

  const uploadFilesToServer = async (filesArray: File[], rootFolderName: string) => {
    const uploadableFiles = filesArray.filter((file) => {
      const relativePath = (file as any).webkitRelativePath || file.name;
      return !relativePath.includes('node_modules/') && !relativePath.includes('.git/');
    });
    if (uploadableFiles.length === 0) {
      alert("The selected folder contains no uploadable files. To switch the active workspace, use Browse Server Folders or Enter Folder Path.");
      return;
    }

    setIsLoading(true);
    try {
      const destinationWorkspace = workspace.trim();
      const folderName = rootFolderName.trim();
      if (!destinationWorkspace) throw new Error("Select an approved server workspace before uploading a folder.");
      if (!folderName || folderName === "." || folderName === ".." || /[\\/]/.test(folderName)) {
        throw new Error("The selected folder has an invalid name.");
      }

      const fileData = await Promise.all(
        uploadableFiles.map(async (f) => {
          // The browser exposes the selected directory's name, not its absolute
          // path. Keep that name as a child folder under the approved server
          // workspace instead of treating it as a server-side workspace path.
          const relativePath = (f as any).webkitRelativePath || f.name;
          const rootPrefix = `${folderName}/`;
          const relPath = relativePath.startsWith(rootPrefix)
            ? relativePath
            : `${rootPrefix}${relativePath}`;
          
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              // result is Data URL: data:text/plain;base64,....
              const base64Content = result.split(',')[1];
              resolve({
                path: relPath,
                content: base64Content || '',
                encoding: 'base64'
              });
            };
            reader.onerror = reject;
            reader.readAsDataURL(f);
          });
        })
      );
      
      const response = await fetch('/api/workspaces/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace: destinationWorkspace,
          files: fileData
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'The workspace upload was rejected.');
      loadWorkspace(result.workspace || destinationWorkspace);
    } catch (e) {
      console.error("Error uploading folder to server:", e);
      alert("Failed to upload folder: " + String(e));
      setIsLoading(false);
    }
  };

  const getFilesFromDirHandle = async (dirHandle: any, path = '') => {
    const files: File[] = [];
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        Object.defineProperty(file, 'webkitRelativePath', {
          value: path + file.name
        });
        files.push(file);
      } else if (entry.kind === 'directory') {
        if (!['node_modules', '.git'].includes(entry.name)) {
          files.push(...await getFilesFromDirHandle(entry, path + entry.name + '/'));
        }
      }
    }
    return files;
  };

  const handleFolderSelect = async () => {
    try {
      if (typeof window !== "undefined" && (window as any).showDirectoryPicker) {
        const dirHandle = await (window as any).showDirectoryPicker();
        if (dirHandle && dirHandle.name) {
          const files = await getFilesFromDirHandle(dirHandle, dirHandle.name + '/');
          if (files.length > 0) {
            setIsDropdownOpen(false);
            await uploadFilesToServer(files, dirHandle.name);
            return;
          }
          // Some browser implementations grant the folder handle but do not
          // enumerate its contents. Let the directory input try its native
          // webkitdirectory path before reporting an empty selection.
          console.warn("Folder picker returned no entries; falling back to the directory input.");
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setIsDropdownOpen(false);
        return;
      }
      console.warn("showDirectoryPicker failed or was blocked, falling back to input element:", err);
    }

    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const files = Array.from(input.files || []);
    input.value = "";
    if (files.length > 0) {
      const firstPath = files[0].webkitRelativePath || "";
      const rootFolder = firstPath.split("/")[0] || "selected-project";
      setIsDropdownOpen(false);
      uploadFilesToServer(files, rootFolder);
    } else {
      setIsDropdownOpen(false);
      alert("The selected folder contains no uploadable files. To switch the active workspace, use Browse Server Folders or Enter Folder Path.");
    }
  };

  return (
    <div className="relative">
      {/* Hidden inputs for folder selector (triggers native Windows Explorer) */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleInputChange}
        onCancel={() => setIsDropdownOpen(false)}
        className="hidden"
        {...({
          webkitdirectory: "true",
          directory: "true"
        } as any)}
      />

      <button
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        disabled={isLoading}
        className="flex max-w-[160px] items-center gap-1.5 rounded border border-border-main bg-bg-active px-2 py-1.5 font-mono text-[10px] text-text-dim transition-colors hover:text-white sm:max-w-[240px] sm:gap-2 sm:px-3"
        title="Click to manage or select a project folder"
      >
        {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />}
        <span className="hidden xs:inline text-text-dim">WORKSPACE:</span>
        <span className="truncate font-semibold text-white">{workspace || "TARGET"}</span>
      </button>

      {isDropdownOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-bg-panel border border-border-main rounded-md shadow-lg z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="px-3 py-2 border-b border-border-main bg-bg-active">
            <p className="text-[10px] font-semibold text-text-dim uppercase tracking-wider">Project Folder Settings</p>
            <p className="text-[11px] text-zinc-400 truncate mt-0.5">Current: {workspace || "None"}</p>
          </div>
          <div className="flex flex-col p-1 gap-0.5">
            <button
              onClick={handleFolderSelect}
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-white hover:bg-cyan-500/10 hover:text-cyan-400 rounded-md transition text-left cursor-pointer"
            >
              <FolderOpen className="w-4 h-4 text-cyan-400 shrink-0" />
              <div>
                <div className="font-semibold">Select Local Folder</div>
                <div className="text-[10px] text-zinc-400 font-normal">Uploads its files into the current server workspace</div>
              </div>
            </button>

            <button
              onClick={() => {
                if (onOpenFolderModal) onOpenFolderModal();
                setIsDropdownOpen(false);
              }}
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-white hover:bg-cyan-500/10 hover:text-cyan-400 rounded-md transition text-left cursor-pointer"
            >
              <FolderOpen className="w-4 h-4 text-cyan-400 shrink-0" />
              <div>
                <div className="font-semibold">Browse Server Folders</div>
                <div className="text-[10px] text-zinc-400 font-normal">Switch to a folder already on the server</div>
              </div>
            </button>

            <button
              onClick={() => { 
                const name = prompt("Enter the name or path of the project folder to load:", workspace);
                if (name) loadWorkspace(name);
                setIsDropdownOpen(false); 
              }}
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500/10 hover:text-indigo-400 rounded-md transition text-left cursor-pointer"
            >
              <Edit3 className="w-4 h-4 text-indigo-400 shrink-0" />
              <div>
                <div className="font-semibold">Enter Folder Path</div>
                <div className="text-[10px] text-zinc-400 font-normal">Manually specify folder name</div>
              </div>
            </button>

            <div className="h-[1px] bg-border-main my-1 mx-2" />

            <button
              onClick={() => { 
                handleLoadRepoMap();
                setIsDropdownOpen(false); 
              }}
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500/10 hover:text-emerald-400 rounded-md transition text-left cursor-pointer"
            >
              <RefreshCw className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <div className="font-semibold">Refresh Repo Map</div>
                <div className="text-[10px] text-zinc-400 font-normal">Re-scan project structure</div>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
