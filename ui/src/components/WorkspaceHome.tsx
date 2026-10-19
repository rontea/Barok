import React from "react";
import { ArrowLeft, ArrowRight, Check, Folder, FolderOpen, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";

interface WorkspaceHomeProps {
  currentWorkspace: string;
  onOpenWorkspace: (workspace: string) => void;
  canRemoveWorkspace: boolean;
}

interface DirectoryResponse {
  path?: string;
  parent?: string | null;
  directories?: string[];
  roots?: string[];
  removableRoots?: string[];
  root?: string;
  added?: boolean;
  error?: string;
}

export function WorkspaceHome({ currentWorkspace, onOpenWorkspace, canRemoveWorkspace }: WorkspaceHomeProps) {
  const [roots, setRoots] = React.useState<string[]>([]);
  const [removableRoots, setRemovableRoots] = React.useState<string[]>([]);
  const [rootsLoading, setRootsLoading] = React.useState(true);
  const [rootsError, setRootsError] = React.useState("");
  const [rootsRefreshKey, setRootsRefreshKey] = React.useState(0);
  const [currentPath, setCurrentPath] = React.useState("");
  const [parentPath, setParentPath] = React.useState<string | null>(null);
  const [directories, setDirectories] = React.useState<string[]>([]);
  const [pathDraft, setPathDraft] = React.useState(currentWorkspace);
  const [browseLoading, setBrowseLoading] = React.useState(false);
  const [browseError, setBrowseError] = React.useState("");
  const [approvalLoading, setApprovalLoading] = React.useState(false);
  const [approvalError, setApprovalError] = React.useState("");
  const [approvalMessage, setApprovalMessage] = React.useState("");
  const [removingRoot, setRemovingRoot] = React.useState<string | null>(null);
  const [removeError, setRemoveError] = React.useState("");
  const [removeMessage, setRemoveMessage] = React.useState("");

  React.useEffect(() => {
    let active = true;
    const loadRoots = async () => {
      setRootsLoading(true);
      setRootsError("");
      try {
        const response = await fetch("/api/directory-roots");
        const data = (await response.json().catch(() => ({}))) as DirectoryResponse;
        if (!response.ok) throw new Error(data.error || "Could not load approved workspaces.");
        if (active) {
          setRoots(Array.isArray(data.roots) ? data.roots : []);
          setRemovableRoots(Array.isArray(data.removableRoots) ? data.removableRoots : []);
        }
      } catch (error) {
        if (active) setRootsError(error instanceof Error ? error.message : String(error));
      } finally {
        if (active) setRootsLoading(false);
      }
    };

    void loadRoots();
    return () => { active = false; };
  }, [rootsRefreshKey]);

  const browseTo = async (path: string): Promise<string | null> => {
    const requestedPath = path.trim();
    if (!requestedPath) return null;
    setBrowseLoading(true);
    setBrowseError("");
    try {
      const params = new URLSearchParams({ path: requestedPath });
      const response = await fetch(`/api/directories?${params.toString()}`);
      const data = (await response.json().catch(() => ({}))) as DirectoryResponse;
      if (!response.ok) throw new Error(data.error || "Could not open that folder.");
      const resolvedPath = typeof data.path === "string" ? data.path : requestedPath;
      setCurrentPath(resolvedPath);
      setPathDraft(resolvedPath);
      setParentPath(typeof data.parent === "string" ? data.parent : null);
      setDirectories(Array.isArray(data.directories) ? data.directories : []);
      return resolvedPath;
    } catch (error) {
      setBrowseError(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setBrowseLoading(false);
    }
  };

  const isExactApprovedPath = (path: string) => {
    const normalize = (value: string) => value.replace(/[\\/]+$/, "").replace(/\\/g, "/");
    return roots.some((root) => normalize(root) === normalize(path));
  };

  const sameWorkspacePath = (left: string, right: string) => {
    const normalize = (value: string) => value.replace(/[\\/]+$/, "").replace(/\\/g, "/");
    const normalizedLeft = normalize(left);
    const normalizedRight = normalize(right);
    const isWindowsPath = (value: string) => /^[a-z]:\//i.test(value) || value.startsWith("//");
    return isWindowsPath(normalizedLeft) || isWindowsPath(normalizedRight)
      ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
      : normalizedLeft === normalizedRight;
  };

  const openCurrentWorkspace = async () => {
    const path = currentWorkspace.trim();
    if (!path) return;
    const approvedPath = await browseTo(path);
    if (!approvedPath) return;
    if (isExactApprovedPath(approvedPath)) {
      onOpenWorkspace(approvedPath);
    } else {
      setBrowseError("This folder is inside an approved root but needs its own approval before it can be used as a workspace.");
    }
  };

  const approveWorkspace = async (path: string) => {
    const requestedPath = path.trim();
    if (!requestedPath) return;
    setApprovalLoading(true);
    setApprovalError("");
    setApprovalMessage("");
    try {
      const response = await fetch("/api/directory-roots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: requestedPath }),
      });
      const data = (await response.json().catch(() => ({}))) as DirectoryResponse;
      if (!response.ok) throw new Error(data.error || "Could not approve this folder.");
      const approvedPath = typeof data.root === "string" ? data.root : requestedPath;
      setRoots(Array.isArray(data.roots) ? data.roots : [...roots, approvedPath]);
      setRemovableRoots(Array.isArray(data.removableRoots) ? data.removableRoots : [...removableRoots, approvedPath]);
      setApprovalMessage(data.added === false ? "This folder is already approved." : "Folder approved and added to your workspace list.");
      await browseTo(approvedPath);
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : String(error));
    } finally {
      setApprovalLoading(false);
    }
  };

  const removeWorkspace = async (root: string) => {
    if (sameWorkspacePath(root, currentWorkspace)) {
      setRemoveError("Switch to another workspace before removing the current one.");
      return;
    }
    if (!removableRoots.some((candidate) => sameWorkspacePath(candidate, root))) return;
    if (!window.confirm(`Remove ${root} from the approved workspace list? Its files will not be deleted.`)) return;

    setRemovingRoot(root);
    setRemoveError("");
    setRemoveMessage("");
    try {
      const response = await fetch("/api/directory-roots", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: root }),
      });
      const data = (await response.json().catch(() => ({}))) as DirectoryResponse;
      if (!response.ok) throw new Error(data.error || "Could not remove this workspace approval.");
      setRoots(Array.isArray(data.roots) ? data.roots : roots.filter((candidate) => !sameWorkspacePath(candidate, root)));
      setRemovableRoots(Array.isArray(data.removableRoots) ? data.removableRoots : removableRoots.filter((candidate) => !sameWorkspacePath(candidate, root)));
      setCurrentPath("");
      setParentPath(null);
      setDirectories([]);
      setRemoveMessage(`${formatFolderName(root)} was removed from the approved list. Its files were not deleted.`);
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : String(error));
    } finally {
      setRemovingRoot(null);
    }
  };

  const formatFolderName = (folderPath: string) =>
    folderPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || folderPath;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#090b10] text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_18%_0%,rgba(6,182,212,0.12),transparent_40%),radial-gradient(ellipse_at_95%_85%,rgba(99,102,241,0.10),transparent_36%)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-6 sm:px-8 sm:py-9">
        <header className="flex items-center justify-between border-b border-white/10 pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10">
              <FolderOpen className="h-4 w-4 text-cyan-300" />
            </div>
            <div>
              <div className="font-display text-sm font-semibold tracking-wide text-white">ReAct Engine</div>
              <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-slate-500">Workspace launcher</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 font-mono text-[10px] text-slate-400 sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              SERVER FOLDERS
            </div>
            {currentWorkspace.trim() && (
              <button
                type="button"
                onClick={() => void openCurrentWorkspace()}
                disabled={browseLoading}
                className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/15 disabled:cursor-wait disabled:opacity-60"
              >
                {browseLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeft className="h-3.5 w-3.5" />}
                Back to workspace
              </button>
            )}
          </div>
        </header>

        <main className="grid flex-1 gap-8 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.78fr)] lg:gap-12 lg:py-14">
          <section className="flex flex-col">
            <div className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-300/80">Start a session</div>
            <h1 className="max-w-2xl font-display text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl">
              Choose where you want to work.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-slate-400 sm:text-base">
              Select an approved server folder for your project. The workspace is set here before the agent opens, so its files stay in the right place.
            </p>

            {currentWorkspace.trim() && (
              <div className="mt-8 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.055] p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-300/10">
                    <RefreshCw className="h-4 w-4 text-cyan-300" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-cyan-100">Continue with your last workspace</div>
                    <div className="mt-1 break-all font-mono text-[11px] leading-5 text-slate-400">{currentWorkspace}</div>
                    <button
                      type="button"
                      onClick={() => void openCurrentWorkspace()}
                      disabled={browseLoading}
                      className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-lg bg-cyan-300 px-3.5 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-60"
                    >
                      {browseLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                      Open workspace
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-9 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">Approved workspaces</h2>
                <p className="mt-1 text-xs text-slate-500">Pick a server folder or browse inside one. Removing approval never deletes its files.</p>
              </div>
              <button
                type="button"
                onClick={() => setRootsRefreshKey((value) => value + 1)}
                title="Refresh the workspace list"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-slate-400 transition hover:border-white/20 hover:text-white"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span className="sr-only">Refresh workspaces</span>
              </button>
            </div>

            {rootsError && (
              <div role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/5 px-4 py-3 text-xs leading-5 text-rose-200">
                {rootsError}
              </div>
            )}
            {removeError && (
              <div role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/5 px-4 py-3 text-xs leading-5 text-rose-200">
                {removeError}
              </div>
            )}
            {removeMessage && <div role="status" className="mt-4 text-xs leading-5 text-emerald-200">{removeMessage}</div>}

            {rootsLoading ? (
              <div className="mt-4 flex min-h-32 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.025] text-xs text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading approved folders
              </div>
            ) : roots.length > 0 ? (
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {roots.map((root) => (
                  <li key={root} className="rounded-xl border border-white/10 bg-white/[0.025] p-3 transition hover:border-cyan-400/25 hover:bg-white/[0.04]">
                    <div className="flex min-w-0 items-start gap-3">
                      <Folder className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-slate-100" title={root}>{formatFolderName(root)}</div>
                        <div className="mt-1 break-all font-mono text-[9px] leading-4 text-slate-500">{root}</div>
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => onOpenWorkspace(root)}
                            className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-white/10 px-2.5 text-[10px] font-semibold text-slate-100 transition hover:bg-white/15"
                          >
                            <Check className="h-3 w-3" /> Use folder
                          </button>
                          <button
                            type="button"
                            onClick={() => void browseTo(root)}
                            className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-white/10 px-2.5 text-[10px] font-medium text-slate-400 transition hover:border-cyan-300/30 hover:text-cyan-100"
                          >
                            Browse
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeWorkspace(root)}
                            disabled={!removableRoots.some((candidate) => sameWorkspacePath(candidate, root)) || !canRemoveWorkspace || sameWorkspacePath(root, currentWorkspace) || removingRoot !== null}
                            title={sameWorkspacePath(root, currentWorkspace)
                              ? "Switch to another workspace before removing this one"
                              : !canRemoveWorkspace
                                ? "Stop active work before removing a workspace approval"
                                : removableRoots.some((candidate) => sameWorkspacePath(candidate, root))
                                  ? "Remove workspace approval; files will not be deleted"
                                  : "This workspace is configured by the server and cannot be removed here"}
                            aria-label={`Remove ${formatFolderName(root)} from approved workspaces`}
                            className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-rose-300/15 px-2.5 text-[10px] font-medium text-rose-200/80 transition hover:border-rose-300/30 hover:bg-rose-300/[0.06] hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-35"
                          >
                            {removingRoot === root ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : !rootsError ? (
              <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.025] px-4 py-5 text-xs text-slate-500">
                No approved workspace folders are configured on this server.
              </div>
            ) : null}
          </section>

          <aside className="flex flex-col gap-5">
            <section className="rounded-2xl border border-white/10 bg-[#101319]/90 p-4 shadow-2xl shadow-black/20 sm:p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-300/15 bg-indigo-300/10">
                  <FolderOpen className="h-4 w-4 text-indigo-200" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">Set a folder</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">Browse approved folders or approve a full server path as a workspace.</p>
                </div>
              </div>
              <form
                className="mt-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void browseTo(pathDraft);
                }}
              >
                <label htmlFor="workspace-folder-path" className="mb-2 block font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Server folder path
                </label>
                <input
                  id="workspace-folder-path"
                  value={pathDraft}
                  onChange={(event) => setPathDraft(event.target.value)}
                  placeholder="C:\\Projects\\my-app"
                  className="min-h-10 w-full rounded-lg border border-white/10 bg-black/25 px-3 font-mono text-[11px] text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-300/10"
                />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="submit"
                    disabled={browseLoading || approvalLoading || !pathDraft.trim()}
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-indigo-200/20 bg-indigo-300/10 text-xs font-semibold text-indigo-100 transition hover:bg-indigo-300/15 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {browseLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
                    Browse path
                  </button>
                  <button
                    type="button"
                    onClick={() => void approveWorkspace(pathDraft)}
                    disabled={approvalLoading || browseLoading || !pathDraft.trim() || isExactApprovedPath(pathDraft)}
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-cyan-300 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {approvalLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isExactApprovedPath(pathDraft) ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                    {isExactApprovedPath(pathDraft) ? "Approved" : "Approve folder"}
                  </button>
                </div>
                <p className="mt-2 text-[10px] leading-4 text-slate-500">Approval grants the agent access to read and write within this server folder.</p>
                {approvalError && (
                  <div role="alert" className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2 text-[11px] leading-5 text-rose-200">
                    {approvalError}
                  </div>
                )}
                {approvalMessage && <div role="status" className="mt-3 text-[11px] leading-5 text-emerald-200">{approvalMessage}</div>}
                {browseError && (
                  <div role="alert" className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2 text-[11px] leading-5 text-rose-200">
                    {browseError}
                  </div>
                )}
              </form>
            </section>

            {currentPath && (
              <section className="flex min-h-64 flex-1 flex-col rounded-2xl border border-white/10 bg-[#101319]/90 p-4 sm:p-5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => parentPath ? void browseTo(parentPath) : (setCurrentPath(""), setDirectories([]), setBrowseError(""))}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-slate-400 transition hover:text-white"
                    aria-label={parentPath ? "Go to parent folder" : "Back to workspace roots"}
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-white">Browse server folders</div>
                    <div className="mt-1 truncate font-mono text-[9px] text-slate-500" title={currentPath}>{currentPath}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenWorkspace(currentPath)}
                    disabled={!isExactApprovedPath(currentPath) || approvalLoading}
                    title={!isExactApprovedPath(currentPath) ? "Approve this folder before using it as a workspace" : undefined}
                    className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg bg-cyan-300 px-2.5 text-[10px] font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isExactApprovedPath(currentPath) ? "Use folder" : "Approval required"}
                  </button>
                </div>
                {!isExactApprovedPath(currentPath) && (
                  <button
                    type="button"
                    onClick={() => void approveWorkspace(currentPath)}
                    disabled={approvalLoading || browseLoading}
                    className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.07] px-2.5 text-[10px] font-semibold text-cyan-100 transition hover:bg-cyan-300/15 disabled:cursor-wait disabled:opacity-50"
                  >
                    {approvalLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                    Approve this folder as a workspace
                  </button>
                )}

                <div className="mt-4 flex-1 overflow-hidden rounded-xl border border-white/[0.07] bg-black/15">
                  {browseLoading ? (
                    <div className="flex min-h-40 items-center justify-center gap-2 text-xs text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading folders
                    </div>
                  ) : directories.length > 0 ? (
                    <ul className="max-h-[320px] divide-y divide-white/[0.06] overflow-y-auto">
                      {directories.map((directory) => (
                        <li key={directory}>
                          <button
                            type="button"
                            onClick={() => {
                              const separator = currentPath.endsWith("/") || currentPath.endsWith("\\") ? "" : "/";
                              void browseTo(`${currentPath}${separator}${directory}`);
                            }}
                            className="flex min-h-10 w-full items-center gap-2.5 px-3 text-left text-xs text-slate-300 transition hover:bg-white/[0.04] hover:text-white"
                          >
                            <Folder className="h-3.5 w-3.5 shrink-0 text-amber-300/80" />
                            <span className="min-w-0 flex-1 truncate">{directory}</span>
                            <ArrowRight className="h-3 w-3 shrink-0 text-slate-600" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="flex min-h-40 items-center justify-center px-4 text-center text-xs text-slate-500">
                      {browseError ? "Fix the path above or choose another folder." : "No subfolders here. You can use this folder as your workspace."}
                    </div>
                  )}
                </div>
              </section>
            )}
          </aside>
        </main>

        <footer className="flex flex-col gap-2 border-t border-white/10 pt-4 text-[10px] text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <span>Workspace access follows this server’s approved folder policy.</span>
          <span className="font-mono uppercase tracking-[0.14em]">ReAct Engine Explorer</span>
        </footer>
      </div>
    </div>
  );
}
