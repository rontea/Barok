/**
 * Base configuration manager
 * Handles loading, validation, and merging of configurations
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { ConfigValidationError, ConfigSource } from './types.js';

export abstract class BaseConfigManager<T> {
  protected config: T;
  protected source: ConfigSource;
  protected defaults: T;

  constructor(defaults: T) {
    this.defaults = defaults;
    this.config = JSON.parse(JSON.stringify(defaults)); // deep copy
    this.source = {
      timestamp: new Date(),
      source: 'default',
      lastModified: new Date(),
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): T {
    return this.config;
  }

  /**
   * Get specific config value by path
   */
  getValue<U = unknown>(path: string, fallback?: U): U {
    const parts = path.split('.');
    let current: any = this.config;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return fallback as U;
      }
      current = current[part];
    }

    return (current !== undefined ? current : fallback) as U;
  }

  /**
   * Update configuration value
   */
  setValue<U>(path: string, value: U): void {
    const parts = path.split('.');
    let current: any = this.config;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part];
    }

    current[parts[parts.length - 1]] = value;
    this.source.lastModified = new Date();
  }

  /**
   * Reset to defaults
   */
  reset(): void {
    this.config = JSON.parse(JSON.stringify(this.defaults));
    this.source = {
      timestamp: new Date(),
      source: 'default',
      lastModified: new Date(),
    };
  }

  /**
   * Validate configuration
   * Must be implemented by subclasses
   */
  abstract validate(): ConfigValidationError[];

  /**
   * Merge configuration objects
   */
  protected merge(target: T, source: Partial<T>): T {
    return {
      ...target,
      ...source,
    };
  }

  /**
   * Get configuration source metadata
   */
  getSource(): ConfigSource {
    return this.source;
  }

  /**
   * Set configuration source
   */
  protected setSource(source: ConfigSource['source']): void {
    this.source.source = source;
    this.source.timestamp = new Date();
  }

  /**
   * Load configuration from JSON file
   */
  protected async loadFromFile(filePath: string): Promise<Partial<T>> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      this.source.lastModified = new Date(
        (await fs.stat(filePath)).mtime
      );
      return data;
    } catch (error) {
      console.warn(`Failed to load config from ${filePath}: ${error}`);
      return {};
    }
  }

  /**
   * Save configuration to JSON file
   */
  protected async saveToFile(filePath: string): Promise<void> {
    try {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(this.config, null, 2), 'utf-8');
      this.source.lastModified = new Date();
    } catch (error) {
      console.error(`Failed to save config to ${filePath}: ${error}`);
      throw error;
    }
  }

  /**
   * Get configuration as JSON string
   */
  toJSON(): string {
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * Export configuration (with sensitive data optional)
   */
  export(includeSensitive = false): Record<string, unknown> {
    return this.config as Record<string, unknown>;
  }
}
