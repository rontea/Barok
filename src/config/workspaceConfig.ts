/**
 * Workspace configuration manager
 * Manages workspace paths and security settings
 */

import { BaseConfigManager } from './baseManager.js';
import { WorkspaceConfig, ConfigValidationError } from './types.js';
import * as path from 'path';
import * as os from 'os';

const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  // Paths
  rootPath: process.cwd(),
  logsPath: path.join(process.cwd(), 'logs'),
  cachePath: path.join(os.tmpdir(), 'react-engine-cache'),
  tempPath: path.join(os.tmpdir(), 'react-engine-temp'),

  // Workspace properties
  name: 'default',
  description: 'Default workspace',

  // Security
  allowedPaths: [process.cwd()],
  blockedPaths: ['/etc', '/sys', '/proc', 'C:\\Windows\\System32', 'C:\\Windows\\SysWOW64'],
  enforcePathValidation: true,

  // Performance
  maxFileSize: 100 * 1024 * 1024, // 100 MB
  indexingEnabled: false,
};

export class WorkspaceConfigManager extends BaseConfigManager<WorkspaceConfig> {
  constructor(rootPath?: string, overrides?: Partial<WorkspaceConfig>) {
    const config = { ...DEFAULT_WORKSPACE_CONFIG };

    if (rootPath) {
      config.rootPath = rootPath;
      config.logsPath = path.join(rootPath, 'logs');
      config.allowedPaths = [rootPath];
    }

    super(config);

    if (overrides) {
      this.config = this.merge(this.config, overrides);
    }

    this.setSource('default');
  }

  /**
   * Set workspace root path
   */
  setRootPath(rootPath: string): void {
    this.config.rootPath = rootPath;
    this.config.logsPath = path.join(rootPath, 'logs');
    this.config.allowedPaths = [rootPath];
    this.source.lastModified = new Date();
  }

  /**
   * Get full path for a relative path
   */
  getFullPath(relativePath: string): string {
    return path.join(this.config.rootPath, relativePath);
  }

  /**
   * Get logs directory
   */
  getLogsPath(): string {
    return this.config.logsPath;
  }

  /**
   * Get cache directory
   */
  getCachePath(): string {
    return this.config.cachePath;
  }

  /**
   * Get temp directory
   */
  getTempPath(): string {
    return this.config.tempPath;
  }

  /**
   * Add allowed path
   */
  addAllowedPath(pathStr: string): void {
    if (!this.config.allowedPaths.includes(pathStr)) {
      this.config.allowedPaths.push(pathStr);
      this.source.lastModified = new Date();
    }
  }

  /**
   * Remove allowed path
   */
  removeAllowedPath(pathStr: string): void {
    const index = this.config.allowedPaths.indexOf(pathStr);
    if (index > -1) {
      this.config.allowedPaths.splice(index, 1);
      this.source.lastModified = new Date();
    }
  }

  /**
   * Add blocked path
   */
  addBlockedPath(pathStr: string): void {
    if (!this.config.blockedPaths.includes(pathStr)) {
      this.config.blockedPaths.push(pathStr);
      this.source.lastModified = new Date();
    }
  }

  /**
   * Remove blocked path
   */
  removeBlockedPath(pathStr: string): void {
    const index = this.config.blockedPaths.indexOf(pathStr);
    if (index > -1) {
      this.config.blockedPaths.splice(index, 1);
      this.source.lastModified = new Date();
    }
  }

  /**
   * Check if path is allowed
   */
  isPathAllowed(filePath: string): boolean {
    if (!this.config.enforcePathValidation) {
      return true;
    }

    const normalizedPath = path.normalize(filePath);

    // Check blocked paths first
    for (const blocked of this.config.blockedPaths) {
      if (normalizedPath.startsWith(path.normalize(blocked))) {
        return false;
      }
    }

    // Check allowed paths
    for (const allowed of this.config.allowedPaths) {
      if (normalizedPath.startsWith(path.normalize(allowed))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validate workspace configuration
   */
  validate(): ConfigValidationError[] {
    const errors: ConfigValidationError[] = [];

    // Validate root path exists and is absolute
    if (!path.isAbsolute(this.config.rootPath)) {
      errors.push({
        section: 'workspace',
        field: 'rootPath',
        value: this.config.rootPath,
        error: 'rootPath must be an absolute path',
      });
    }

    // Validate at least one allowed path
    if (this.config.allowedPaths.length === 0) {
      errors.push({
        section: 'workspace',
        field: 'allowedPaths',
        value: this.config.allowedPaths.length,
        error: 'At least one allowed path must be configured',
      });
    }

    // Validate max file size
    if (this.config.maxFileSize < 1024) {
      // 1 KB minimum
      errors.push({
        section: 'workspace',
        field: 'maxFileSize',
        value: this.config.maxFileSize,
        error: 'maxFileSize must be at least 1024 bytes',
      });
    }

    if (this.config.maxFileSize > 1024 * 1024 * 1024) {
      // 1 GB maximum
      errors.push({
        section: 'workspace',
        field: 'maxFileSize',
        value: this.config.maxFileSize,
        error: 'maxFileSize cannot exceed 1 GB',
      });
    }

    return errors;
  }

  /**
   * Get workspace summary
   */
  getSummary(): Record<string, unknown> {
    return {
      name: this.config.name,
      rootPath: this.config.rootPath,
      logsPath: this.config.logsPath,
      allowedPaths: this.config.allowedPaths,
      pathValidationEnabled: this.config.enforcePathValidation,
      maxFileSize: this.config.maxFileSize,
    };
  }
}
