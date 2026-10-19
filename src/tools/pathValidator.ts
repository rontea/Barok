/** Compatibility facade for the Node adapter's canonical workspace path checks. */
export {
  PathValidationError,
  getValidationErrorDetails,
  getWorkspaceRelativePath,
  isPathWithinWorkspace,
  validateAndResolvePath,
} from '@barok/adapter-node';
