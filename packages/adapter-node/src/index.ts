export { hashSerializedRequestValue } from './request-envelope-hash.js';
export { createId } from './ids.js';
export {
  discoverManifests,
  getLatestManifest,
  loadManifest,
  saveManifest,
  updateManifestWithVerification,
  type StoredAppManifest,
} from './workspace/app-manifest-storage.js';
export {
  verifyApp,
  verifyHtmlApp,
  verifyViteApp,
  type VerificationOptions,
  type VerificationStrategy,
} from './workspace/app-verifier.js';
export { discoverVerificationRepairFiles } from './workspace/verification-repair-discovery.js';
export {
  getFileDiff,
  getGitStatus,
  getUntrackedFiles,
  scanDirtyTree,
  type ChangeHunk,
  type DirtyFileStatus,
  type DirtyTreeState,
  type FileChangeStatus,
} from './workspace/dirty-tree-scanner.js';
export {
  getDirtyTreeState,
  invalidateDirtyTreeCache,
  type DirtyTreeCacheEntry,
} from './workspace/dirty-tree-cache.js';
export { fingerprintWorkspace } from './workspace/workspace-fingerprint.js';
export {
  createRunScopedWorkspace,
  disposeRunScopedWorkspace,
  isManagedTemporaryWorkspacePath,
  isRunScopedWorkspaceAuthorized,
  managedTemporaryWorkspaceRoot,
} from './workspace/run-scoped-workspace.js';
export * from './process/command-runtime.js';
export { getPlatform } from './process/platform.js';
export { getEnvironmentVariable, getWorkingDirectory } from './process/host.js';
export {
  PathValidationError,
  getValidationErrorDetails,
  getWorkspaceRelativePath,
  isPathWithinWorkspace,
  validateAndResolvePath,
} from './workspace/path-validator.js';
export { normalizeWorkspacePathKey } from './workspace/path-key.js';
export { normalizePathIdentity } from './workspace/path-identity.js';
