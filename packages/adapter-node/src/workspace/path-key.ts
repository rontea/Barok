import { posix, win32 } from 'node:path';

/** Normalize paths for matching task evidence and mutation targets. */
export function normalizeWorkspacePathKey(workspace: string, value: string): string {
  const windowsStyle = /^[A-Za-z]:[\\/]/.test(workspace) || /^[A-Za-z]:[\\/]/.test(value);
  const pathApi = windowsStyle ? win32 : posix;
  const normalizedWorkspace = workspace ? pathApi.normalize(workspace) : '';
  let normalized = pathApi.normalize(value.trim());

  if (normalizedWorkspace && pathApi.isAbsolute(normalized)) {
    const relativePath = pathApi.relative(normalizedWorkspace, normalized);
    if (relativePath && relativePath !== '..' && !relativePath.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relativePath)) {
      normalized = relativePath;
    }
  }

  normalized = normalized.replace(/\\/g, '/').replace(/^\.\//, '');
  return windowsStyle ? normalized.toLowerCase() : normalized;
}
