/**
 * Phase 5.4: API/UI Surface Discovery
 * Detect backend API routes and React components/routes
 */

/**
 * Represents an API route/endpoint
 */
export interface APISurface {
  route: string; // e.g., '/api/users'
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'; // HTTP method
  description?: string; // Human-readable description
  parameters?: APIParameter[]; // Route/query parameters
  requestBody?: APISchema; // Request body schema
  responseBody?: APISchema; // Response body schema
  statusCodes?: number[]; // Expected HTTP status codes
  middleware?: string[]; // Middleware used
  controller?: string; // Handler function/controller name
  filePath?: string; // File path where route is defined
  lineNumber?: number; // Line number in file
}

/**
 * API parameter definition
 */
export interface APIParameter {
  name: string;
  type: string; // e.g., 'string', 'number', 'boolean'
  required: boolean;
  description?: string;
  example?: string;
}

/**
 * Schema definition for request/response bodies
 */
export interface APISchema {
  type: string; // 'object', 'array', 'string', etc.
  properties?: Record<string, APISchema>;
  required?: string[];
  example?: any;
  description?: string;
}

/**
 * Represents a React UI component or route
 */
export interface UISurface {
  type: 'component' | 'route' | 'hook' | 'context'; // Type of UI element
  name: string; // Component/route name
  path?: string; // Path for routes or file path for components
  exports: string[]; // Named exports from the component
  props?: Record<string, UIPropDefinition>; // Props definition
  children?: boolean; // Accepts children prop
  description?: string; // Component description
  filePath?: string; // Source file path
  lineNumber?: number; // Line number in file
  dependencies?: string[]; // Component dependencies
  isPrivate?: boolean; // Private/internal component
  isPage?: boolean; // Is this a page component
}

/**
 * UI prop definition
 */
export interface UIPropDefinition {
  type: string; // TypeScript type as string
  required: boolean;
  default?: any;
  description?: string;
}

/**
 * Result of discovering API surfaces
 */
export interface DiscoverAPIRoutesResult {
  success: boolean;
  routes: APISurface[];
  errors: string[];
  filePath?: string;
  totalRoutes: number;
}

/**
 * Result of discovering UI components
 */
export interface DiscoverUIComponentsResult {
  success: boolean;
  components: UISurface[];
  errors: string[];
  filePath?: string;
  totalComponents: number;
}

/**
 * Result of discovering UI routes
 */
export interface DiscoverUIRoutesResult {
  success: boolean;
  routes: UISurface[];
  errors: string[];
  filePath?: string;
  totalRoutes: number;
}

/**
 * Configuration for surface discovery
 */
export interface SurfaceDiscoveryConfig {
  projectRoot?: string;
  includePrivate?: boolean;
  includeDeprecated?: boolean;
  maxDepth?: number; // Max file traversal depth
  excludePatterns?: string[]; // Patterns to exclude
}

/**
 * Discover API routes from Express/server code
 */
export function discoverAPIRoutes(
  serverPath: string,
  config?: SurfaceDiscoveryConfig
): DiscoverAPIRoutesResult {
  const routes: APISurface[] = [];
  const errors: string[] = [];

  try {
    // Read server file
    let serverContent = '';
    try {
      const { readFileSync } = require('fs');
      serverContent = readFileSync(serverPath, 'utf-8');
    } catch (e) {
      return {
        success: false,
        routes: [],
        errors: [`Failed to read server file: ${e instanceof Error ? e.message : String(e)}`],
        filePath: serverPath,
        totalRoutes: 0,
      };
    }

    // Parse routes using regex patterns
    const routePatterns = [
      // Express app.get, post, etc.
      /app\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
      // Express router
      /router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
    ];

    const methods = new Map<string, string>([
      ['get', 'GET'],
      ['post', 'POST'],
      ['put', 'PUT'],
      ['delete', 'DELETE'],
      ['patch', 'PATCH'],
    ]);

    for (const pattern of routePatterns) {
      let match;
      while ((match = pattern.exec(serverContent)) !== null) {
        const method = methods.get(match[1]);
        const route = match[2];

        if (method) {
          routes.push({
            route,
            method: method as any,
            description: `${method} ${route}`,
            filePath: serverPath,
          });
        }
      }
    }

    // Deduplicate routes
    const uniqueRoutes = Array.from(
      new Map(routes.map((r) => [`${r.method}:${r.route}`, r])).values()
    );

    return {
      success: errors.length === 0,
      routes: uniqueRoutes,
      errors,
      filePath: serverPath,
      totalRoutes: uniqueRoutes.length,
    };
  } catch (e) {
    return {
      success: false,
      routes: [],
      errors: [String(e)],
      filePath: serverPath,
      totalRoutes: 0,
    };
  }
}

/**
 * Discover React components from source files
 */
export function discoverUIComponents(
  componentsPath: string,
  config?: SurfaceDiscoveryConfig
): DiscoverUIComponentsResult {
  const components: UISurface[] = [];
  const errors: string[] = [];

  try {
    // Read component file
    let componentContent = '';
    try {
      const { readFileSync } = require('fs');
      componentContent = readFileSync(componentsPath, 'utf-8');
    } catch (e) {
      return {
        success: false,
        components: [],
        errors: [`Failed to read component file: ${e instanceof Error ? e.message : String(e)}`],
        filePath: componentsPath,
        totalComponents: 0,
      };
    }

    // Extract component names and exports
    const componentPatterns = [
      // export function Component
      /export\s+(?:default\s+)?(?:function|const)\s+(\w+)/g,
      // export const Component =
      /export\s+const\s+(\w+)\s*=/g,
      // export default
      /export\s+default\s+(\w+)/g,
    ];

    const foundComponents = new Set<string>();

    for (const pattern of componentPatterns) {
      let match;
      while ((match = pattern.exec(componentContent)) !== null) {
        if (match[1]) {
          foundComponents.add(match[1]);
        }
      }
    }

    // Create component metadata
    for (const componentName of foundComponents) {
      // Check if it looks like a React component (PascalCase)
      if (/^[A-Z]/.test(componentName)) {
        components.push({
          type: 'component',
          name: componentName,
          exports: [componentName],
          filePath: componentsPath,
          isPrivate: componentName.startsWith('_'),
          dependencies: extractDependencies(componentContent),
        });
      } else if (componentName.toLowerCase().includes('use')) {
        // Looks like a hook
        components.push({
          type: 'hook',
          name: componentName,
          exports: [componentName],
          filePath: componentsPath,
          isPrivate: componentName.startsWith('_'),
        });
      }
    }

    return {
      success: errors.length === 0,
      components,
      errors,
      filePath: componentsPath,
      totalComponents: components.length,
    };
  } catch (e) {
    return {
      success: false,
      components: [],
      errors: [String(e)],
      filePath: componentsPath,
      totalComponents: 0,
    };
  }
}

/**
 * Discover UI routes from React Router configuration
 */
export function discoverUIRoutes(
  routesPath: string,
  config?: SurfaceDiscoveryConfig
): DiscoverUIRoutesResult {
  const routes: UISurface[] = [];
  const errors: string[] = [];

  try {
    // Read routes file
    let routesContent = '';
    try {
      const { readFileSync } = require('fs');
      routesContent = readFileSync(routesPath, 'utf-8');
    } catch (e) {
      return {
        success: false,
        routes: [],
        errors: [`Failed to read routes file: ${e instanceof Error ? e.message : String(e)}`],
        filePath: routesPath,
        totalRoutes: 0,
      };
    }

    // Extract route paths
    const routePatterns = [
      // React Router: path="/users"
      /path\s*=\s*['"`]([^'"`]+)['"`]/g,
      // Custom: route: '/dashboard'
      /route\s*:\s*['"`]([^'"`]+)['"`]/g,
      // URL pattern
      /(['"`]\/[^'"`]*['"`])/g,
    ];

    const foundRoutes = new Set<string>();

    for (const pattern of routePatterns) {
      let match;
      while ((match = pattern.exec(routesContent)) !== null) {
        let routePath = match[1];
        // Clean up quotes
        routePath = routePath.replace(/^['"`]|['"`]$/g, '');

        if (routePath && routePath.startsWith('/')) {
          foundRoutes.add(routePath);
        }
      }
    }

    // Create route metadata
    for (const routePath of foundRoutes) {
      // Extract route name from path
      const routeName = routePath.split('/').filter((p) => p).pop() || 'root';

      routes.push({
        type: 'route',
        name: routeName,
        path: routePath,
        exports: [routeName],
        filePath: routesPath,
        isPage: true,
      });
    }

    return {
      success: errors.length === 0,
      routes,
      errors,
      filePath: routesPath,
      totalRoutes: routes.length,
    };
  } catch (e) {
    return {
      success: false,
      routes: [],
      errors: [String(e)],
      filePath: routesPath,
      totalRoutes: 0,
    };
  }
}

/**
 * Extract dependencies from component code
 */
export function extractDependencies(code: string): string[] {
  const deps = new Set<string>();

  // Extract import statements
  const importPatterns = [
    /import\s+(?:{[^}]*}|\w+)\s+from\s+['"`]([^'"`]+)['"`]/g,
    /import\s+['"`]([^'"`]+)['"`]/g,
  ];

  for (const pattern of importPatterns) {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      if (match[1] && !match[1].startsWith('.')) {
        // Only external dependencies
        deps.add(match[1]);
      }
    }
  }

  return Array.from(deps).sort();
}

/**
 * Find API routes matching a pattern
 */
export function findAPIRoutes(routes: APISurface[], pattern: string | RegExp): APISurface[] {
  const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
  return routes.filter(
    (r) => regex.test(r.route) || regex.test(r.method) || (r.description && regex.test(r.description))
  );
}

/**
 * Find UI components matching a pattern
 */
export function findUIComponents(components: UISurface[], pattern: string | RegExp): UISurface[] {
  const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
  return components.filter((c) => regex.test(c.name) || (c.description && regex.test(c.description)));
}

/**
 * Get API routes by method
 */
export function getAPIRoutesByMethod(
  routes: APISurface[],
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
): APISurface[] {
  return routes.filter((r) => r.method === method);
}

/**
 * Get public UI components (not private)
 */
export function getPublicUIComponents(components: UISurface[]): UISurface[] {
  return components.filter((c) => !c.isPrivate);
}

/**
 * Generate API documentation
 */
export function generateAPIDocumentation(routes: APISurface[]): string {
  let doc = '# API Routes\n\n';

  // Group by method
  const byMethod: Record<string, APISurface[]> = {};
  for (const route of routes) {
    if (!byMethod[route.method]) {
      byMethod[route.method] = [];
    }
    byMethod[route.method].push(route);
  }

  // Generate documentation
  for (const [method, methodRoutes] of Object.entries(byMethod)) {
    doc += `## ${method}\n\n`;
    for (const route of methodRoutes) {
      doc += `### ${route.route}\n`;
      if (route.description) {
        doc += `${route.description}\n\n`;
      }
      if (route.statusCodes) {
        doc += `Status codes: ${route.statusCodes.join(', ')}\n\n`;
      }
    }
  }

  return doc;
}

/**
 * Generate UI component documentation
 */
export function generateUIDocumentation(components: UISurface[]): string {
  let doc = '# UI Components\n\n';

  // Group by type
  const byType: Record<string, UISurface[]> = {};
  for (const comp of components) {
    if (!byType[comp.type]) {
      byType[comp.type] = [];
    }
    byType[comp.type].push(comp);
  }

  // Generate documentation
  for (const [type, typeComponents] of Object.entries(byType)) {
    doc += `## ${type.charAt(0).toUpperCase() + type.slice(1)}\n\n`;
    for (const comp of typeComponents) {
      doc += `### ${comp.name}\n`;
      if (comp.description) {
        doc += `${comp.description}\n\n`;
      }
      if (comp.exports && comp.exports.length > 0) {
        doc += `Exports: \`${comp.exports.join(', ')}\`\n\n`;
      }
    }
  }

  return doc;
}

/**
 * Check if component is used in any routes
 */
export function isComponentUsedInRoutes(
  componentName: string,
  routes: UISurface[],
  routeContent: string
): boolean {
  // Simple check: look for component name in routes
  return new RegExp(componentName).test(routeContent);
}
