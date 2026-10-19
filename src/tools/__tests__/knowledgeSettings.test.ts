import { describe, expect, it } from '@jest/globals';
import * as fs from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadKnowledgeSettings,
  saveKnowledgeSettings,
} from '../knowledgeSettings';

describe('knowledge lookup settings', () => {
  it('uses safe project defaults', async () => {
    const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-knowledge-defaults-'));
    await expect(loadKnowledgeSettings(workspace)).resolves.toEqual({
      sampleLookupEnabled: false,
      sampleFolder: '.react-engine/samples',
      wikiLookupEnabled: false,
      projectGuideEnabled: false,
      wikiFolder: 'wiki',
      webSearchEnabled: true,
    });
  });

  it('persists workspace-specific folders and feature toggles', async () => {
    const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-knowledge-save-'));
    const saved = await saveKnowledgeSettings(workspace, {
      sampleLookupEnabled: false,
      sampleFolder: 'examples/samples',
      wikiLookupEnabled: true,
      projectGuideEnabled: false,
      wikiFolder: 'docs/wiki',
      webSearchEnabled: false,
    });

    expect(saved).toMatchObject({
      sampleLookupEnabled: false,
      sampleFolder: 'examples/samples',
      wikiLookupEnabled: true,
      wikiFolder: 'docs/wiki',
      webSearchEnabled: false,
    });
    await expect(fs.stat(join(workspace, 'docs', 'wiki'))).resolves.toMatchObject({});
    await expect(loadKnowledgeSettings(workspace)).resolves.toEqual(saved);
  });

  it('rejects folders outside the workspace', async () => {
    const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-knowledge-safe-'));
    await expect(saveKnowledgeSettings(workspace, {
      wikiFolder: '../outside',
    })).rejects.toThrow('Directory traversal');
  });

  it('preserves existing values when an API-style partial update omits them', async () => {
    const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-knowledge-partial-'));
    await saveKnowledgeSettings(workspace, {
      sampleFolder: 'examples/team-samples',
      wikiFolder: 'docs/team-wiki',
      projectGuideEnabled: false,
    });
    await saveKnowledgeSettings(workspace, { webSearchEnabled: false });
    const updated = await saveKnowledgeSettings(workspace, { wikiLookupEnabled: true });
    expect(updated.sampleFolder).toBe('examples/team-samples');
    expect(updated.wikiFolder).toBe('docs/team-wiki');
    expect(updated.wikiLookupEnabled).toBe(true);
    expect(updated.projectGuideEnabled).toBe(false);
    expect(updated.webSearchEnabled).toBe(false);
  });
});
