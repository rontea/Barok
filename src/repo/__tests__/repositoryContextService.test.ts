import { describe, expect, it } from '@jest/globals';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { RepositoryContextService } from '../repositoryContextService.js';

async function createFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'repository-context-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'ui', 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'context-fixture',
    version: '1.0.0',
    main: 'server.ts',
    scripts: { test: 'vitest run', build: 'vite build', lint: 'eslint .' },
  }));
  await writeFile(path.join(root, 'server.ts'), "app.get('/api/health', healthHandler);\n");
  await writeFile(path.join(root, 'src', 'service.ts'), "export function healthHandler() { return true; }\n");
  await writeFile(path.join(root, 'src', 'consumer.ts'), "import { healthHandler } from './service';\nexport const run = healthHandler;\n");
  await writeFile(path.join(root, 'ui', 'src', 'App.tsx'), 'export function App() { return null; }\n');
  return root;
}

describe('RepositoryContextService', () => {
  it('composes repository, file, command, surface, and dependency discovery', async () => {
    const root = await createFixture();
    try {
      const service = new RepositoryContextService(root);
      const snapshot = await service.getWorkspaceSummary();

      expect(snapshot.repositoryMap.repositoryName).toBe('context-fixture');
      expect(snapshot.fileMap.files.map((file) => file.path)).toEqual(
        expect.arrayContaining(['src/service.ts', 'src/consumer.ts', 'ui/src/App.tsx'])
      );
      expect(snapshot.scripts.test).toHaveLength(1);
      expect(snapshot.apiRoutes.map((route) => route.route)).toContain('/api/health');
      expect(snapshot.uiComponents.map((component) => component.name)).toContain('App');
      expect(snapshot.dependencyGraph.getSignalsFrom('src/consumer.ts').map((signal) => signal.target)).toContain('src/service');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('ranks relevant files using path and dependency evidence', async () => {
    const root = await createFixture();
    try {
      const service = new RepositoryContextService(root);
      const relevant = await service.rankRelevantFiles('health handler', 5);

      expect(relevant[0].path).toBe('src/service.ts');
      expect(relevant[0].reasons.join(' ')).toMatch(/path|referenced|role/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('supports bounded reads and tracks inspected files', async () => {
    const root = await createFixture();
    try {
      const service = new RepositoryContextService(root, { maxBytesPerFile: 10 });
      const results = await service.readFiles(['src/service.ts', '../outside.ts', 'src/consumer.ts'], { maxFiles: 2 });

      expect(results).toHaveLength(2);
      expect(results[0].truncated).toBe(true);
      expect(service.getInspectedFiles()).toEqual(['src/consumer.ts', 'src/service.ts']);
      service.clearInspectedFiles();
      expect(service.getInspectedFiles()).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('finds symbols and references through bounded source reads', async () => {
    const root = await createFixture();
    try {
      const service = new RepositoryContextService(root);
      const definitions = await service.lookupSymbols('healthHandler');
      const references = await service.findReferences('healthHandler');

      expect(definitions.some((match) => match.kind === 'definition' && match.path === 'src/service.ts')).toBe(true);
      expect(references.some((match) => match.path === 'src/consumer.ts')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('invalidates changed file reads and snapshots explicitly', async () => {
    const root = await createFixture();
    try {
      const service = new RepositoryContextService(root);
      const first = await service.readFiles(['src/service.ts']);
      await writeFile(path.join(root, 'src', 'service.ts'), 'export function changed() { return false; }\n');
      const second = await service.readFiles(['src/service.ts']);
      expect(first[0].content).not.toBe(second[0].content);

      const snapshot = await service.getWorkspaceSummary();
      service.invalidate(['src/service.ts']);
      const refreshed = await service.getWorkspaceSummary();
      expect(refreshed.generatedAt).toBeGreaterThanOrEqual(snapshot.generatedAt);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
