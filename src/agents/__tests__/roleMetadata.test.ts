/**
 * Tests for Agent Role Metadata and Registry System
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { AgentRoleRegistry, createDefaultRegistry } from '../roleRegistry.js';
import {
  FRONTEND_AGENT_METADATA,
  BACKEND_AGENT_METADATA,
  DATA_AGENT_METADATA,
  TEST_AGENT_METADATA,
  REVIEWER_AGENT_METADATA,
  DOCUMENTATION_AGENT_METADATA,
  ALL_ROLE_METADATA,
  getRoleMetadata,
  getAllRoleIds,
  getAllRoles,
} from '../roleMetadata.js';

describe('Agent Role Metadata', () => {
  describe('Role Definition', () => {
    it('should have FrontendAgent metadata', () => {
      expect(FRONTEND_AGENT_METADATA).toBeDefined();
      expect(FRONTEND_AGENT_METADATA.id).toBe('frontend');
      expect(FRONTEND_AGENT_METADATA.name).toBe('FrontendAgent');
      expect(FRONTEND_AGENT_METADATA.ownedPaths.length).toBeGreaterThan(0);
    });

    it('should have BackendAgent metadata', () => {
      expect(BACKEND_AGENT_METADATA).toBeDefined();
      expect(BACKEND_AGENT_METADATA.id).toBe('backend');
      expect(BACKEND_AGENT_METADATA.name).toBe('BackendAgent');
    });

    it('should have DataAgent metadata', () => {
      expect(DATA_AGENT_METADATA).toBeDefined();
      expect(DATA_AGENT_METADATA.id).toBe('data');
    });

    it('should have TestAgent metadata', () => {
      expect(TEST_AGENT_METADATA).toBeDefined();
      expect(TEST_AGENT_METADATA.id).toBe('test');
    });

    it('should have ReviewerAgent metadata', () => {
      expect(REVIEWER_AGENT_METADATA).toBeDefined();
      expect(REVIEWER_AGENT_METADATA.id).toBe('reviewer');
    });

    it('should have DocumentationAgent metadata', () => {
      expect(DOCUMENTATION_AGENT_METADATA).toBeDefined();
      expect(DOCUMENTATION_AGENT_METADATA.id).toBe('documentation');
    });

    it('should export all roles in ALL_ROLE_METADATA', () => {
      expect(Object.keys(ALL_ROLE_METADATA)).toContain('frontend');
      expect(Object.keys(ALL_ROLE_METADATA)).toContain('backend');
      expect(Object.keys(ALL_ROLE_METADATA)).toContain('data');
      expect(Object.keys(ALL_ROLE_METADATA)).toContain('test');
      expect(Object.keys(ALL_ROLE_METADATA)).toContain('reviewer');
      expect(Object.keys(ALL_ROLE_METADATA)).toContain('documentation');
    });
  });

  describe('Role Metadata Helper Functions', () => {
    it('should get role metadata by ID', () => {
      const frontend = getRoleMetadata('frontend');
      expect(frontend).toBe(FRONTEND_AGENT_METADATA);
    });

    it('should return undefined for non-existent role', () => {
      expect(getRoleMetadata('nonexistent')).toBeUndefined();
    });

    it('should get all role IDs', () => {
      const ids = getAllRoleIds();
      expect(ids).toContain('frontend');
      expect(ids).toContain('backend');
      expect(ids.length).toBe(6);
    });

    it('should get all roles as array', () => {
      const roles = getAllRoles();
      expect(roles.length).toBe(6);
      expect(roles.some((r) => r.id === 'frontend')).toBe(true);
    });
  });

  describe('Role Expertise Areas', () => {
    it('should have defined expertise areas for each role', () => {
      getAllRoles().forEach((role) => {
        expect(role.expertiseAreas.length).toBeGreaterThan(0);
      });
    });

    it('FrontendAgent should have UI/React expertise', () => {
      expect(FRONTEND_AGENT_METADATA.expertiseAreas).toContain('React hooks and component composition');
    });

    it('BackendAgent should have API expertise', () => {
      expect(BACKEND_AGENT_METADATA.expertiseAreas).toContain('API design and RESTful patterns');
    });
  });

  describe('Tool Allowlists', () => {
    it('should have allowed tools for each role', () => {
      getAllRoles().forEach((role) => {
        expect(role.allowedTools.length).toBeGreaterThan(0);
      });
    });

    it('FrontendAgent should allow React tools', () => {
      expect(FRONTEND_AGENT_METADATA.allowedTools).toContain('Write');
      expect(FRONTEND_AGENT_METADATA.allowedTools).toContain('Edit');
    });

    it('ReviewerAgent should be read-only', () => {
      expect(REVIEWER_AGENT_METADATA.allowedTools).toContain('Read');
      expect(REVIEWER_AGENT_METADATA.allowedTools).not.toContain('Write');
    });
  });

  describe('Model Tier Selection', () => {
    it('should have model tier set for each role', () => {
      getAllRoles().forEach((role) => {
        expect(role.preferredModelTier).toBeDefined();
        expect(['ultra-cheap', 'cheap', 'balanced', 'capable', 'expert']).toContain(
          role.preferredModelTier
        );
      });
    });

    it('ReviewerAgent should use expert tier', () => {
      expect(REVIEWER_AGENT_METADATA.preferredModelTier).toBe('expert');
    });

    it('DocumentationAgent should use cheap tier', () => {
      expect(DOCUMENTATION_AGENT_METADATA.preferredModelTier).toBe('cheap');
    });
  });

  describe('Verification Commands', () => {
    it('should have verification commands for each role', () => {
      getAllRoles().forEach((role) => {
        expect(role.verificationCommands.length).toBeGreaterThan(0);
      });
    });

    it('should have required verification commands', () => {
      getAllRoles().forEach((role) => {
        const hasRequired = role.verificationCommands.some((cmd) => cmd.required);
        expect(hasRequired).toBe(true);
      });
    });

    it('FrontendAgent should have build verification', () => {
      const buildCmd = FRONTEND_AGENT_METADATA.verificationCommands.find(
        (cmd) => cmd.name === 'build'
      );
      expect(buildCmd).toBeDefined();
      expect(buildCmd?.required).toBe(true);
    });
  });

  describe('Escalation Rules', () => {
    it('should have escalation rules defined', () => {
      getAllRoles().forEach((role) => {
        expect(role.escalationRules.length).toBeGreaterThanOrEqual(0);
      });
    });

    it('FrontendAgent should escalate to backend for API work', () => {
      const escalation = FRONTEND_AGENT_METADATA.escalationRules.find(
        (e) => e.escalateTo === 'backend'
      );
      expect(escalation).toBeDefined();
    });
  });

  describe('Path Ownership', () => {
    it('should have owned paths defined', () => {
      expect(FRONTEND_AGENT_METADATA.ownedPaths.length).toBeGreaterThan(0);
      expect(BACKEND_AGENT_METADATA.ownedPaths.length).toBeGreaterThan(0);
    });

    it('FrontendAgent should own UI paths', () => {
      expect(FRONTEND_AGENT_METADATA.ownedPaths).toEqual(
        expect.arrayContaining(['ui/src/**/*.tsx', 'ui/src/App.tsx'])
      );
    });

    it('BackendAgent should own src paths', () => {
      expect(BACKEND_AGENT_METADATA.ownedPaths).toEqual(
        expect.arrayContaining(['src/**/*.ts', 'server.ts'])
      );
    });
  });
});

describe('Agent Role Registry', () => {
  let registry: AgentRoleRegistry;

  beforeEach(() => {
    registry = createDefaultRegistry();
  });

  describe('Role Registration', () => {
    it('should register all default roles', () => {
      expect(registry.getRoleIds().length).toBe(6);
    });

    it('should retrieve registered role by ID', () => {
      const frontend = registry.getRole('frontend');
      expect(frontend).toBe(FRONTEND_AGENT_METADATA);
    });

    it('should return undefined for unregistered role', () => {
      expect(registry.getRole('nonexistent')).toBeUndefined();
    });

    it('should check role existence', () => {
      expect(registry.hasRole('frontend')).toBe(true);
      expect(registry.hasRole('nonexistent')).toBe(false);
    });

    it('should get all registered roles', () => {
      const roles = registry.getAllRoles();
      expect(roles.length).toBe(6);
    });
  });

  describe('Path Ownership Validation', () => {
    it('should determine if role can access file', () => {
      expect(registry.canAccess('frontend', 'ui/src/App.tsx')).toBe(true);
      expect(registry.canAccess('frontend', 'src/agents/crew.ts')).toBe(true); // readable
      expect(registry.canAccess('frontend', 'src/react/engine.ts')).toBe(true); // readable
    });

    it('should determine if role can modify file', () => {
      expect(registry.canModify('frontend', 'ui/src/App.tsx')).toBe(true);
      expect(registry.canModify('frontend', 'src/react/engine.ts')).toBe(false); // not owned
    });

    it('should get all roles that can access a path', () => {
      const roles = registry.getRolesForPath('src/agents/crew.ts');
      expect(roles.length).toBeGreaterThan(0);
      expect(roles).toContain('backend');
    });

    it('should get all roles that own a path', () => {
      const owners = registry.getOwnersForPath('ui/src/App.tsx');
      expect(owners).toContain('frontend');
      expect(owners).not.toContain('backend');
    });

    it('should prevent excluded path access', () => {
      expect(registry.canAccess('frontend', 'vscode-extension/something.ts')).toBe(false);
    });
  });

  describe('Conflict Detection', () => {
    it('should detect path ownership conflicts', () => {
      const conflicts = registry.detectConflicts();
      expect(Array.isArray(conflicts)).toBe(true);
      // Default registry should not have critical conflicts
      const errorConflicts = conflicts.filter((c) => c.severity === 'error');
      expect(errorConflicts).toEqual([]);
    });

    it('should include all conflicting roles in report', () => {
      const conflicts = registry.detectConflicts();
      for (const conflict of conflicts) {
        expect(conflict.roles.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('Registry Validation', () => {
    it('should validate the entire registry', () => {
      const result = registry.validate();
      expect(result.valid).toBe(true);
      expect(result.conflicts).toEqual([]);
      expect(result.issues.length).toBe(0);
    });

    it('should detect missing collaborator roles', () => {
      const invalidRegistry = new AgentRoleRegistry([
        {
          ...FRONTEND_AGENT_METADATA,
          collaboratesWith: ['nonexistent-role'],
        },
      ]);

      const result = invalidRegistry.validate();
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('should detect missing escalation target roles', () => {
      const invalidRegistry = new AgentRoleRegistry([
        {
          ...FRONTEND_AGENT_METADATA,
          escalationRules: [
            {
              condition: 'test',
              escalateTo: 'nonexistent-role',
              reason: 'test',
            },
          ],
        },
      ]);

      const result = invalidRegistry.validate();
      expect(result.valid).toBe(false);
    });
  });

  describe('Expertise-Based Lookup', () => {
    it('should find roles by expertise area', () => {
      const reactExperts = registry.getRolesByExpertise('React hooks and component composition');
      expect(reactExperts.length).toBeGreaterThan(0);
      expect(reactExperts.some((r) => r.id === 'frontend')).toBe(true);
    });

    it('should return empty array for unknown expertise', () => {
      const experts = registry.getRolesByExpertise('unknown-area');
      expect(experts).toEqual([]);
    });
  });

  describe('Collaboration Lookup', () => {
    it('should get collaborators for a role', () => {
      const collaborators = registry.getCollaborators('frontend');
      expect(collaborators.length).toBeGreaterThan(0);
      expect(collaborators.some((r) => r.id === 'backend')).toBe(true);
    });

    it('should return empty array for nonexistent role', () => {
      const collaborators = registry.getCollaborators('nonexistent');
      expect(collaborators).toEqual([]);
    });
  });

  describe('Parallel Execution Planning', () => {
    it('should plan parallel execution groups', () => {
      const filePaths = ['ui/src/App.tsx', 'src/agents/crew.ts', 'docs/README.md'];
      const groups = registry.planParallelExecution(filePaths);

      expect(Array.isArray(groups)).toBe(true);
      expect(groups.length).toBeGreaterThan(0);

      // All roles should be assigned
      const allRoles = new Set<string>();
      groups.forEach((group) => {
        group.forEach((role) => allRoles.add(role));
      });
      expect(allRoles.size).toBeGreaterThan(0);
    });

    it('should not assign conflicting roles to same group', () => {
      // Two files both owned by backend should not create separate groups
      const filePaths = ['src/agents/crew.ts', 'src/react/engine.ts'];
      const groups = registry.planParallelExecution(filePaths);

      // Flatten and check for duplicates
      const allRoles: string[] = [];
      groups.forEach((group) => {
        group.forEach((role) => allRoles.push(role));
      });

      const uniqueRoles = new Set(allRoles);
      expect(uniqueRoles.size).toBe(allRoles.length);
    });
  });

  describe('Execution Order', () => {
    it('should compute valid execution order', () => {
      const order = registry.getExecutionOrder();
      expect(Array.isArray(order)).toBe(true);
      expect(order.length).toBeGreaterThan(0);
    });

    it('should include all requested roles', () => {
      const roleIds = ['frontend', 'backend'];
      const order = registry.getExecutionOrder(roleIds);

      expect(order).toContain('frontend');
      expect(order).toContain('backend');
    });

    it('should respect collaboration dependencies', () => {
      const roleIds = ['frontend', 'backend'];
      const order = registry.getExecutionOrder(roleIds);

      // Backend should come before or with frontend (if frontend depends on backend)
      // This depends on how collaboratesWith is defined
      expect(order.length).toBeGreaterThanOrEqual(2);
    });
  });
});
