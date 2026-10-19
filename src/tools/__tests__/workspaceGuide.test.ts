import { describe, expect, it } from '@jest/globals';
import * as fs from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadKnowledgeSettings, saveKnowledgeSettings } from '../knowledgeSettings';
import {
  MAX_WORKSPACE_GUIDE_CHARACTERS,
  loadWorkspaceGuide,
  saveWorkspaceGuide,
} from '../workspaceGuide';

describe('workspace project guide', () => {
  it('reports the configured workspace path before a guide exists', async () => {
    const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-guide-empty-'));
    await saveKnowledgeSettings(workspace, { wikiFolder: 'docs/reference' });

    await expect(loadWorkspaceGuide(workspace)).resolves.toMatchObject({
      reference: 'wiki:project-specification',
      projectPath: 'docs/reference/project-specification.md',
      content: '',
      exists: false,
      enabled: false,
    });
  });

  it('persists Markdown in the configured wiki and enables agent lookup', async () => {
    const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-guide-save-'));
    await saveKnowledgeSettings(workspace, {
      wikiLookupEnabled: false,
      wikiFolder: 'product/wiki',
    });
    const content = '# Arcade specification\n\n- Move left and right.\n';

    const saved = await saveWorkspaceGuide(workspace, content, true);

    expect(saved.guide).toMatchObject({
      reference: 'wiki:project-specification',
      projectPath: 'product/wiki/project-specification.md',
      content,
      exists: true,
      enabled: true,
    });
    await expect(fs.readFile(
      join(workspace, 'product', 'wiki', 'project-specification.md'),
      'utf8'
    )).resolves.toBe(content);
    await expect(loadKnowledgeSettings(workspace)).resolves.toMatchObject({
      wikiLookupEnabled: true,
      wikiFolder: 'product/wiki',
    });
  });

  it('persists the project guide toggle without deleting its Markdown', async () => {
    const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-guide-toggle-'));
    const content = '# Keep this guide on disk\n';

    const saved = await saveWorkspaceGuide(workspace, content, false);

    expect(saved.guide.enabled).toBe(false);
    expect(saved.settings.projectGuideEnabled).toBe(false);
    await expect(fs.readFile(
      join(workspace, 'wiki', 'project-specification.md'),
      'utf8'
    )).resolves.toBe(content);
    await expect(loadWorkspaceGuide(workspace)).resolves.toMatchObject({
      enabled: false,
      content,
      exists: true,
    });
  });

  it('rejects non-text and oversized guide payloads', async () => {
    const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-guide-limit-'));
    await expect(saveWorkspaceGuide(workspace, { markdown: '# Invalid' })).rejects.toThrow(
      'must be a string'
    );
    await expect(saveWorkspaceGuide(
      workspace,
      'x'.repeat(MAX_WORKSPACE_GUIDE_CHARACTERS + 1)
    )).rejects.toThrow('must not exceed');
  });
});
