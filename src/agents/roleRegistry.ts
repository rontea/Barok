/**
 * Agent Role Registry and Validation System
 * Manages role registration, path ownership validation, and conflict detection
 */

import type { AgentRoleMetadata } from './roleMetadata.js';
import { ALL_ROLE_METADATA, getAllRoles } from './roleMetadata.js';
import { minimatch } from 'minimatch';

/**
 * Path ownership conflict
 */
export interface PathOwnershipConflict {
  /** Path pattern that has conflict */
  path: string;
  /** Roles that claim ownership */
  roles: string[];
  /** Severity level */
  severity: 'error' | 'warning';
}

/**
 * Role registry validation result
 */
export interface RegistryValidationResult {
  /** Is registry valid? */
  valid: boolean;
  /** Path ownership conflicts */
  conflicts: PathOwnershipConflict[];
  /** Issues found */
  issues: string[];
}

/**
 * Agent Role Registry
 * Central registry for managing agent roles and validating ownership
 */
export class AgentRoleRegistry {
  private roles: Map<string, AgentRoleMetadata> = new Map();

  constructor(roles: AgentRoleMetadata[] = []) {
    // Initialize with provided roles or defaults
    const rolesToRegister = roles.length > 0 ? roles : getAllRoles();
    rolesToRegister.forEach((role) => {
      this.registerRole(role);
    });
  }

  /**
   * Register a new role
   */
  registerRole(metadata: AgentRoleMetadata): void {
    if (!metadata.id) {
      throw new Error('Role metadata must have an id');
    }
    if (!metadata.name) {
      throw new Error('Role metadata must have a name');
    }
    this.roles.set(metadata.id, metadata);
  }

  /**
   * Get a registered role
   */
  getRole(roleId: string): AgentRoleMetadata | undefined {
    return this.roles.get(roleId);
  }

  /**
   * Get all registered roles
   */
  getAllRoles(): AgentRoleMetadata[] {
    return Array.from(this.roles.values());
  }

  /**
   * Get all role IDs
   */
  getRoleIds(): string[] {
    return Array.from(this.roles.keys());
  }

  /**
   * Check if role exists
   */
  hasRole(roleId: string): boolean {
    return this.roles.has(roleId);
  }

  /**
   * Get roles by expertise area
   */
  getRolesByExpertise(area: string): AgentRoleMetadata[] {
    return Array.from(this.roles.values()).filter((role) =>
      role.expertiseAreas.includes(area)
    );
  }

  /**
   * Get roles that collaborate with a given role
   */
  getCollaborators(roleId: string): AgentRoleMetadata[] {
    const role = this.getRole(roleId);
    if (!role) return [];

    return role.collaboratesWith
      .map((id) => this.getRole(id))
      .filter((r): r is AgentRoleMetadata => r !== undefined);
  }

  /**
   * Check if a role can access a file path
   */
  canAccess(roleId: string, filePath: string): boolean {
    const role = this.getRole(roleId);
    if (!role) return false;

    // Check excluded paths first
    for (const pattern of role.excludedPaths) {
      if (minimatch(filePath, pattern)) {
        return false;
      }
    }

    // Check owned paths
    for (const pattern of role.ownedPaths) {
      if (minimatch(filePath, pattern)) {
        return true;
      }
    }

    // Check readable paths
    for (const pattern of role.readablePaths) {
      if (minimatch(filePath, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a role can modify a file path (owned only)
   */
  canModify(roleId: string, filePath: string): boolean {
    const role = this.getRole(roleId);
    if (!role) return false;

    // Check excluded paths
    for (const pattern of role.excludedPaths) {
      if (minimatch(filePath, pattern)) {
        return false;
      }
    }

    // Check owned paths only
    for (const pattern of role.ownedPaths) {
      if (minimatch(filePath, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get all roles that can access a file
   */
  getRolesForPath(filePath: string): string[] {
    return Array.from(this.roles.keys()).filter((roleId) => this.canAccess(roleId, filePath));
  }

  /**
   * Get all roles that own a file
   */
  getOwnersForPath(filePath: string): string[] {
    return Array.from(this.roles.keys()).filter((roleId) => this.canModify(roleId, filePath));
  }

  /**
   * Detect path ownership conflicts
   */
  detectConflicts(): PathOwnershipConflict[] {
    const conflicts: Map<string, Set<string>> = new Map();

    // Check all owned paths
    for (const [roleId, role] of this.roles.entries()) {
      for (const pattern of role.ownedPaths) {
        if (!conflicts.has(pattern)) {
          conflicts.set(pattern, new Set());
        }
        conflicts.get(pattern)!.add(roleId);
      }
    }

    // Extract conflicts (multiple owners)
    const result: PathOwnershipConflict[] = [];
    for (const [path, owners] of conflicts.entries()) {
      if (owners.size > 1) {
        result.push({
          path,
          roles: Array.from(owners),
          severity: 'error',
        });
      }
    }

    return result;
  }

  /**
   * Validate the entire registry
   */
  validate(): RegistryValidationResult {
    const issues: string[] = [];
    const conflicts = this.detectConflicts();

    // Check for missing roles in collaborations
    for (const role of this.roles.values()) {
      for (const collaborator of role.collaboratesWith) {
        if (!this.hasRole(collaborator)) {
          issues.push(
            `Role "${role.id}" references unknown collaborator "${collaborator}"`
          );
        }
      }
    }

    // Check for missing roles in escalation
    for (const role of this.roles.values()) {
      for (const escalation of role.escalationRules) {
        if (!this.hasRole(escalation.escalateTo)) {
          issues.push(
            `Role "${role.id}" escalates to unknown role "${escalation.escalateTo}"`
          );
        }
      }
    }

    // Check for missing verification commands
    for (const role of this.roles.values()) {
      if (role.verificationCommands.length === 0) {
        issues.push(`Role "${role.id}" has no verification commands defined`);
      }
    }

    // Check for empty expertise areas
    for (const role of this.roles.values()) {
      if (role.expertiseAreas.length === 0) {
        issues.push(`Role "${role.id}" has no expertise areas defined`);
      }
    }

    return {
      valid: conflicts.length === 0 && issues.length === 0,
      conflicts,
      issues,
    };
  }

  /**
   * Plan parallel execution based on path ownership
   * Returns task groups that can safely run in parallel
   */
  planParallelExecution(filePaths: string[]): string[][] {
    const roleOwnership = new Map<string, Set<string>>();

    // Map each file to its owners
    for (const filePath of filePaths) {
      const owners = this.getOwnersForPath(filePath);
      for (const owner of owners) {
        if (!roleOwnership.has(owner)) {
          roleOwnership.set(owner, new Set());
        }
        roleOwnership.get(owner)!.add(filePath);
      }
    }

    // Group roles that don't overlap
    const groups: string[][] = [];
    const assigned = new Set<string>();
    const roleIds = Array.from(roleOwnership.keys());

    for (let i = 0; i < roleIds.length; i++) {
      if (assigned.has(roleIds[i])) continue;

      const group: string[] = [roleIds[i]];
      assigned.add(roleIds[i]);
      const groupFiles = roleOwnership.get(roleIds[i])!;

      // Find other roles that don't conflict
      for (let j = i + 1; j < roleIds.length; j++) {
        if (assigned.has(roleIds[j])) continue;

        const otherFiles = roleOwnership.get(roleIds[j])!;
        const hasConflict = Array.from(groupFiles).some((f) => otherFiles.has(f));

        if (!hasConflict) {
          group.push(roleIds[j]);
          assigned.add(roleIds[j]);
          groupFiles.forEach((f) => otherFiles.delete(f));
        }
      }

      groups.push(group);
    }

    return groups;
  }

  /**
   * Get execution order for sequential task lists
   * Returns roles sorted by dependencies
   */
  getExecutionOrder(roleIds?: string[]): string[] {
    const roles = roleIds ? roleIds.map((id) => this.getRole(id)).filter(Boolean) : this.getAllRoles();
    const visited = new Set<string>();
    const result: string[] = [];

    const visit = (roleId: string) => {
      if (visited.has(roleId)) return;
      visited.add(roleId);

      const role = this.getRole(roleId);
      if (!role) return;

      // Visit collaborators first (they should run before this role)
      for (const collab of role.collaboratesWith) {
        visit(collab);
      }

      result.push(roleId);
    };

    for (const role of roles) {
      if (role) visit(role.id);
    }

    return result;
  }
}

/**
 * Create a default registry with all standard roles
 */
export function createDefaultRegistry(): AgentRoleRegistry {
  return new AgentRoleRegistry(getAllRoles());
}
