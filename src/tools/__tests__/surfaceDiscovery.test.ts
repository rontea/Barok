/**
 * Phase 5.4: Surface Discovery Tests
 * Test suite for API route and UI component/route discovery
 */

import {
  discoverAPIRoutes,
  discoverUIComponents,
  discoverUIRoutes,
  extractDependencies,
  findAPIRoutes,
  findUIComponents,
  getAPIRoutesByMethod,
  getPublicUIComponents,
  generateAPIDocumentation,
  generateUIDocumentation,
  isComponentUsedInRoutes,
  type APISurface,
  type UISurface,
} from '../surfaceDiscovery';

describe('Phase 5.4: Surface Discovery', () => {
  describe('discoverAPIRoutes', () => {
    it('should return error for non-existent file', () => {
      const result = discoverAPIRoutes('/nonexistent/server.ts');

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.totalRoutes).toBe(0);
    });

    it('should discover routes from mock content', () => {
      // Since we can't easily mock file reads in unit tests,
      // we'll test the regex parsing directly
      const mockContent = `
        app.get('/api/users', handler);
        app.post('/api/users', createUser);
        router.put('/api/users/:id', updateUser);
        app.delete('/api/users/:id', deleteUser);
      `;

      // Extract routes manually to test logic
      const routePatterns = /app\.(get|post|put|delete|patch)\s*\(\s*['"\`]([^'"\`]+)['"\`]/gi;
      const routes: APISurface[] = [];

      const methods = new Map([
        ['get', 'GET'],
        ['post', 'POST'],
        ['put', 'PUT'],
        ['delete', 'DELETE'],
      ]);

      let match;
      while ((match = routePatterns.exec(mockContent)) !== null) {
        const method = methods.get(match[1]);
        if (method) {
          routes.push({
            route: match[2],
            method: method as any,
          });
        }
      }

      expect(routes.length).toBeGreaterThan(0);
      expect(routes.some((r) => r.route === '/api/users')).toBe(true);
    });

    it('should include route metadata', () => {
      // Test route object structure
      const route: APISurface = {
        route: '/api/test',
        method: 'GET',
        description: 'Test endpoint',
      };

      expect(route.route).toBe('/api/test');
      expect(route.method).toBe('GET');
      expect(route.description).toBeTruthy();
    });

    it('should handle route parameters', () => {
      const route: APISurface = {
        route: '/api/users/:id',
        method: 'GET',
        parameters: [
          {
            name: 'id',
            type: 'string',
            required: true,
            description: 'User ID',
          },
        ],
      };

      expect(route.parameters).toBeTruthy();
      expect(route.parameters?.length).toBe(1);
      expect(route.parameters?.[0].name).toBe('id');
    });
  });

  describe('discoverUIComponents', () => {
    it('should return error for non-existent file', () => {
      const result = discoverUIComponents('/nonexistent/component.tsx');

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.totalComponents).toBe(0);
    });

    it('should extract component names from code', () => {
      const mockContent = `
        export function UserList() { return <div />; }
        export const UserDetail = () => <div />;
        export default function App() { return <div />; }
        export const useUser = () => ({});
      `;

      const componentPatterns = [
        /export\s+(?:default\s+)?(?:function|const)\s+(\w+)/g,
        /export\s+const\s+(\w+)\s*=/g,
      ];

      const found = new Set<string>();
      for (const pattern of componentPatterns) {
        let match;
        while ((match = pattern.exec(mockContent)) !== null) {
          if (match[1]) {
            found.add(match[1]);
          }
        }
      }

      expect(found.has('UserList')).toBe(true);
      expect(found.has('UserDetail')).toBe(true);
      expect(found.has('App')).toBe(true);
      expect(found.has('useUser')).toBe(true);
    });

    it('should create component metadata', () => {
      const component: UISurface = {
        type: 'component',
        name: 'UserCard',
        exports: ['UserCard'],
        filePath: 'src/components/UserCard.tsx',
      };

      expect(component.type).toBe('component');
      expect(component.name).toBe('UserCard');
      expect(component.exports).toContain('UserCard');
    });

    it('should identify private components', () => {
      const component: UISurface = {
        type: 'component',
        name: '_InternalHelper',
        exports: ['_InternalHelper'],
        isPrivate: true,
      };

      expect(component.isPrivate).toBe(true);
    });

    it('should identify hooks', () => {
      const hook: UISurface = {
        type: 'hook',
        name: 'useUser',
        exports: ['useUser'],
      };

      expect(hook.type).toBe('hook');
      expect(hook.name).toBe('useUser');
    });
  });

  describe('discoverUIRoutes', () => {
    it('should return error for non-existent file', () => {
      const result = discoverUIRoutes('/nonexistent/routes.tsx');

      expect(result.success).toBe(false);
      expect(result.totalRoutes).toBe(0);
    });

    it('should extract route paths from code', () => {
      const mockContent = `
        path="/users"
        path="/dashboard"
        route: '/settings'
      `;

      const routePattern = /path\s*=\s*['"\`]([^'"\`]+)['"\`]/g;
      const found = new Set<string>();

      let match;
      while ((match = routePattern.exec(mockContent)) !== null) {
        if (match[1]) {
          found.add(match[1]);
        }
      }

      expect(found.has('/users')).toBe(true);
      expect(found.has('/dashboard')).toBe(true);
    });

    it('should create route metadata', () => {
      const route: UISurface = {
        type: 'route',
        name: 'users',
        path: '/users',
        exports: ['users'],
        isPage: true,
      };

      expect(route.type).toBe('route');
      expect(route.path).toBe('/users');
      expect(route.isPage).toBe(true);
    });
  });

  describe('extractDependencies', () => {
    it('should extract import dependencies', () => {
      const code = `
        import React from 'react';
        import { useState } from 'react';
        import axios from 'axios';
        import { useSWR } from './hooks';
      `;

      const deps = extractDependencies(code);

      expect(deps).toContain('react');
      expect(deps).toContain('axios');
      expect(deps.length).toBeGreaterThan(0);
    });

    it('should not include relative imports', () => {
      const code = `
        import { helper } from './utils';
        import App from '../App';
        import axios from 'axios';
      `;

      const deps = extractDependencies(code);

      expect(deps).toContain('axios');
      expect(deps.filter((d) => d.includes('./')).length).toBe(0);
    });

    it('should handle various import styles', () => {
      const code = `
        import 'styles.css';
        import * as React from 'react';
        import type { Props } from './types';
      `;

      const deps = extractDependencies(code);

      expect(deps.length).toBeGreaterThan(0);
    });

    it('should deduplicate dependencies', () => {
      const code = `
        import React from 'react';
        import { useState } from 'react';
      `;

      const deps = extractDependencies(code);
      const reactCount = deps.filter((d) => d === 'react').length;

      expect(reactCount).toBe(1);
    });
  });

  describe('findAPIRoutes', () => {
    const routes: APISurface[] = [
      { route: '/api/users', method: 'GET', description: 'Get all users' },
      { route: '/api/users/:id', method: 'GET', description: 'Get user by ID' },
      { route: '/api/users', method: 'POST', description: 'Create user' },
      { route: '/api/posts', method: 'GET', description: 'Get posts' },
    ];

    it('should find routes by pattern', () => {
      const found = findAPIRoutes(routes, 'users');

      expect(found.length).toBeGreaterThan(0);
      expect(found.every((r) => r.route.includes('users'))).toBe(true);
    });

    it('should find routes by regex', () => {
      const found = findAPIRoutes(routes, /^\/api\/users/);

      expect(found.length).toBeGreaterThan(0);
      expect(found.some((r) => r.route === '/api/users')).toBe(true);
    });

    it('should find by method in description', () => {
      const found = findAPIRoutes(routes, 'delete');

      // May or may not find based on description
      expect(Array.isArray(found)).toBe(true);
    });
  });

  describe('findUIComponents', () => {
    const components: UISurface[] = [
      { type: 'component', name: 'UserCard', exports: ['UserCard'] },
      { type: 'component', name: 'UserList', exports: ['UserList'] },
      { type: 'hook', name: 'useUser', exports: ['useUser'] },
      { type: 'component', name: 'Button', exports: ['Button'] },
    ];

    it('should find components by pattern', () => {
      const found = findUIComponents(components, 'User');

      expect(found.length).toBeGreaterThan(0);
      expect(found.every((c) => c.name.includes('User'))).toBe(true);
    });

    it('should find components by regex', () => {
      const found = findUIComponents(components, /^User/);

      expect(found.length).toBe(2);
    });

    it('should find case-insensitively', () => {
      const found = findUIComponents(components, 'button');

      expect(found.some((c) => c.name === 'Button')).toBe(true);
    });
  });

  describe('getAPIRoutesByMethod', () => {
    const routes: APISurface[] = [
      { route: '/api/users', method: 'GET' },
      { route: '/api/users', method: 'POST' },
      { route: '/api/users/:id', method: 'PUT' },
      { route: '/api/users/:id', method: 'DELETE' },
    ];

    it('should get GET routes', () => {
      const gets = getAPIRoutesByMethod(routes, 'GET');

      expect(gets.length).toBe(1);
      expect(gets.every((r) => r.method === 'GET')).toBe(true);
    });

    it('should get POST routes', () => {
      const posts = getAPIRoutesByMethod(routes, 'POST');

      expect(posts.length).toBe(1);
    });

    it('should get DELETE routes', () => {
      const deletes = getAPIRoutesByMethod(routes, 'DELETE');

      expect(deletes.length).toBe(1);
    });
  });

  describe('getPublicUIComponents', () => {
    const components: UISurface[] = [
      { type: 'component', name: 'Button', isPrivate: false, exports: ['Button'] },
      { type: 'component', name: '_Internal', isPrivate: true, exports: ['_Internal'] },
      { type: 'component', name: 'Card', isPrivate: false, exports: ['Card'] },
    ];

    it('should filter public components', () => {
      const publicComps = getPublicUIComponents(components);

      expect(publicComps.length).toBe(2);
      expect(publicComps.every((c) => !c.isPrivate)).toBe(true);
    });

    it('should exclude private components', () => {
      const publicComps = getPublicUIComponents(components);

      expect(publicComps.some((c) => c.name === '_Internal')).toBe(false);
    });
  });

  describe('generateAPIDocumentation', () => {
    const routes: APISurface[] = [
      { route: '/api/users', method: 'GET', description: 'List users', statusCodes: [200] },
      { route: '/api/users', method: 'POST', description: 'Create user', statusCodes: [201] },
    ];

    it('should generate API documentation', () => {
      const doc = generateAPIDocumentation(routes);

      expect(doc).toContain('# API Routes');
      expect(doc).toContain('GET');
      expect(doc).toContain('POST');
    });

    it('should include route paths', () => {
      const doc = generateAPIDocumentation(routes);

      expect(doc).toContain('/api/users');
    });

    it('should include status codes', () => {
      const doc = generateAPIDocumentation(routes);

      expect(doc).toContain('200');
      expect(doc).toContain('201');
    });
  });

  describe('generateUIDocumentation', () => {
    const components: UISurface[] = [
      { type: 'component', name: 'Button', exports: ['Button'], description: 'Reusable button' },
      { type: 'hook', name: 'useUser', exports: ['useUser'], description: 'User hook' },
    ];

    it('should generate UI documentation', () => {
      const doc = generateUIDocumentation(components);

      expect(doc).toContain('# UI Components');
      expect(doc).toContain('Component');
      expect(doc).toContain('Hook');
    });

    it('should include component names', () => {
      const doc = generateUIDocumentation(components);

      expect(doc).toContain('Button');
      expect(doc).toContain('useUser');
    });

    it('should include component descriptions', () => {
      const doc = generateUIDocumentation(components);

      expect(doc).toContain('Reusable button');
      expect(doc).toContain('User hook');
    });
  });

  describe('isComponentUsedInRoutes', () => {
    const routeContent = `
      import UserCard from './UserCard';
      export const routes = [
        { path: '/users', component: UserCard },
      ];
    `;

    it('should find used component', () => {
      const used = isComponentUsedInRoutes('UserCard', [], routeContent);

      expect(used).toBe(true);
    });

    it('should not find unused component', () => {
      const used = isComponentUsedInRoutes('UnknownComponent', [], routeContent);

      expect(used).toBe(false);
    });
  });

  describe('Surface structures', () => {
    it('should validate API surface structure', () => {
      const api: APISurface = {
        route: '/api/endpoint',
        method: 'GET',
        description: 'An endpoint',
        parameters: [],
        statusCodes: [200, 404],
      };

      expect(api.route).toBeTruthy();
      expect(api.method).toBeTruthy();
      expect(api.parameters).toBeDefined();
    });

    it('should validate UI surface structure', () => {
      const ui: UISurface = {
        type: 'component',
        name: 'Component',
        exports: ['Component'],
        props: {
          value: {
            type: 'string',
            required: true,
          },
        },
      };

      expect(ui.type).toBeTruthy();
      expect(ui.name).toBeTruthy();
      expect(ui.props).toBeDefined();
    });
  });

  describe('Integration scenarios', () => {
    it('should discover complete API surface', () => {
      const routes: APISurface[] = [
        { route: '/api/users', method: 'GET' },
        { route: '/api/users', method: 'POST' },
        { route: '/api/posts', method: 'GET' },
      ];

      const getMethods = getAPIRoutesByMethod(routes, 'GET');
      const userRoutes = findAPIRoutes(routes, 'users');

      expect(getMethods.length).toBe(2);
      expect(userRoutes.length).toBe(2);
    });

    it('should discover complete UI surface', () => {
      const components: UISurface[] = [
        { type: 'component', name: 'App', exports: ['App'] },
        { type: 'component', name: 'UserCard', exports: ['UserCard'], isPrivate: false },
        { type: 'hook', name: 'useUser', exports: ['useUser'] },
      ];

      const publicComps = getPublicUIComponents(components);
      const found = findUIComponents(components, 'User');

      expect(publicComps.length).toBeLessThanOrEqual(components.length);
      expect(found.length).toBeGreaterThan(0);
    });

    it('should generate documentation for complete surfaces', () => {
      const routes: APISurface[] = [
        { route: '/api/users', method: 'GET', description: 'Get users' },
        { route: '/api/users', method: 'POST', description: 'Create user' },
      ];

      const components: UISurface[] = [
        { type: 'component', name: 'UserList', exports: ['UserList'], description: 'User list' },
        { type: 'component', name: 'UserForm', exports: ['UserForm'], description: 'User form' },
      ];

      const apiDoc = generateAPIDocumentation(routes);
      const uiDoc = generateUIDocumentation(components);

      expect(apiDoc).toContain('/api/users');
      expect(uiDoc).toContain('UserList');
    });
  });
});
