/**
 * Tool Registry Implementation
 * Manages available tools and their handlers
 */

import type { ToolDefinition, ToolRegistry } from '../types.js';
import { getAllToolDefinitions } from '../../tools/devTools.js';

/**
 * Default Tool Registry
 * Wraps the existing tool system
 */
export class DefaultToolRegistry implements ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private enabledTools: Set<string> = new Set();

  constructor(tools?: ToolDefinition[]) {
    if (tools) {
      tools.forEach((tool) => {
        this.register(tool);
        this.setEnabled(tool.name, true);
      });
    } else {
      // Load default tools from existing system
      const defaultTools = getAllToolDefinitions() as unknown as ToolDefinition[];
      defaultTools.forEach((tool) => {
        this.register(tool);
        this.setEnabled(tool.name, true);
      });
    }
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getEnabled(): ToolDefinition[] {
    return Array.from(this.tools.values()).filter((tool) => this.enabledTools.has(tool.name));
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  setEnabled(name: string, enabled: boolean): void {
    if (this.tools.has(name)) {
      if (enabled) {
        this.enabledTools.add(name);
      } else {
        this.enabledTools.delete(name);
      }
    }
  }

  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  size(): number {
    return this.tools.size;
  }
}

/**
 * Filtered Tool Registry
 * Wraps another registry and filters/customizes tools
 */
export class FilteredToolRegistry implements ToolRegistry {
  private baseRegistry: ToolRegistry;
  private allowlist: Set<string> | null = null;
  private denylist: Set<string> = new Set();

  constructor(baseRegistry: ToolRegistry, allowlist?: string[], denylist?: string[]) {
    this.baseRegistry = baseRegistry;
    if (allowlist) {
      this.allowlist = new Set(allowlist);
    }
    if (denylist) {
      this.denylist = new Set(denylist);
    }
  }

  private isAllowed(name: string): boolean {
    if (this.denylist.has(name)) {
      return false;
    }
    if (this.allowlist) {
      return this.allowlist.has(name);
    }
    return true;
  }

  getAll(): ToolDefinition[] {
    return this.baseRegistry.getAll().filter((tool) => this.isAllowed(tool.name));
  }

  get(name: string): ToolDefinition | undefined {
    if (this.isAllowed(name)) {
      return this.baseRegistry.get(name);
    }
    return undefined;
  }

  getEnabled(): ToolDefinition[] {
    return this.baseRegistry.getEnabled().filter((tool) => this.isAllowed(tool.name));
  }

  has(name: string): boolean {
    return this.isAllowed(name) && this.baseRegistry.has(name);
  }

  register(tool: ToolDefinition): void {
    this.baseRegistry.register(tool);
  }

  setEnabled(name: string, enabled: boolean): void {
    if (this.isAllowed(name)) {
      this.baseRegistry.setEnabled(name, enabled);
    }
  }

  getNames(): string[] {
    return this.baseRegistry.getNames().filter((name) => this.isAllowed(name));
  }

  size(): number {
    return this.getAll().length;
  }
}

/**
 * Mock Tool Registry (for testing)
 */
export class MockToolRegistry implements ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private enabledTools: Set<string> = new Set();

  addTool(name: string, handler: (params: unknown) => Promise<unknown>): void {
    const tool: ToolDefinition = {
      name,
      description: `Mock tool: ${name}`,
      handler,
    };
    this.tools.set(name, tool);
    this.enabledTools.add(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getEnabled(): ToolDefinition[] {
    return Array.from(this.tools.values()).filter((tool) => this.enabledTools.has(tool.name));
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
    this.enabledTools.add(tool.name);
  }

  setEnabled(name: string, enabled: boolean): void {
    if (this.tools.has(name)) {
      if (enabled) {
        this.enabledTools.add(name);
      } else {
        this.enabledTools.delete(name);
      }
    }
  }

  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  size(): number {
    return this.tools.size;
  }
}
