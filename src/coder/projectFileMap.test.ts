import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it, afterEach } from '@jest/globals';
import { buildProjectFileMap, saveProjectFileMap } from './projectFileMap';

describe('projectFileMap performance caching', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function createWorkspace(): Promise<string> {
    const workspace = await mkdtemp(path.join(tmpdir(), 'react-engine-file-map-'));
    tempDirs.push(workspace);
    await mkdir(path.join(workspace, 'src'), { recursive: true });
    await mkdir(path.join(workspace, 'ui', 'src'), { recursive: true });
    await writeFile(path.join(workspace, 'package.json'), '{"name":"test-workspace"}', 'utf-8');
    await writeFile(path.join(workspace, 'tsconfig.json'), '{}', 'utf-8');
    await writeFile(path.join(workspace, 'src', 'server.ts'), 'export const ok = true;', 'utf-8');
    await writeFile(path.join(workspace, 'ui', 'src', 'App.tsx'), 'export function App() { return null; }', 'utf-8');
    return workspace;
  }

  it('returns cloned maps from cache so callers cannot mutate cache contents', async () => {
    const workspace = await createWorkspace();

    const first = await buildProjectFileMap(workspace);
    first.files.length = 0;
    const second = await buildProjectFileMap(workspace);

    expect(second.files.length).toBeGreaterThan(0);
    expect(second.generatedAt).toBeGreaterThanOrEqual(first.generatedAt);
  });

  it('always includes focus files even when missing', async () => {
    const workspace = await createWorkspace();

    const map = await buildProjectFileMap(workspace, ['src/missing.ts']);

    expect(map.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'src/missing.ts', exists: false }),
      ])
    );
  });

  it('discovers root static-site files without a package manifest', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'react-engine-static-map-'));
    tempDirs.push(workspace);
    await writeFile(path.join(workspace, 'index.html'), '<html></html>', 'utf-8');
    await writeFile(path.join(workspace, 'resume_text.txt'), 'Resume', 'utf-8');

    const map = await buildProjectFileMap(workspace);

    expect(map.totalFiles).toBe(2);
    expect(map.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'index.html', layer: 'ui' }),
      expect.objectContaining({ path: 'resume_text.txt', layer: 'docs' }),
    ]));
  });

  it('persists the project file map as JSON', async () => {
    const workspace = await createWorkspace();
    const map = await buildProjectFileMap(workspace);

    const targetPath = await saveProjectFileMap(map);
    const saved = JSON.parse(await readFile(targetPath, 'utf-8'));

    expect(saved.workspace).toBe(path.resolve(workspace));
    expect(saved.files.length).toBe(map.files.length);
  });
});
