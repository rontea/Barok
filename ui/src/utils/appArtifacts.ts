export function getWorkspaceFileUrl(filePath?: string, workspace?: string): string {
  if (!filePath) return '';

  if (/^(https?:|blob:|data:)/i.test(filePath)) {
    return filePath;
  }

  const params = new URLSearchParams({ path: filePath });
  if (workspace?.trim()) {
    params.set('workspace', workspace.trim());
  }

  return `/workspace-file?${params.toString()}`;
}

export function getDisplayPath(filePath?: string): string {
  return filePath || '';
}
