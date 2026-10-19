import * as fs from 'fs/promises';
import { join, relative } from 'path';
import {
  loadKnowledgeSettings,
  resolveWikiFolder,
  saveKnowledgeSettings,
  type KnowledgeLookupSettings,
} from './knowledgeSettings.js';

export const WORKSPACE_GUIDE_FILE = 'project-specification.md';
export const WORKSPACE_GUIDE_REFERENCE = 'wiki:project-specification';
export const MAX_WORKSPACE_GUIDE_CHARACTERS = 500_000;

export interface WorkspaceGuide {
  reference: typeof WORKSPACE_GUIDE_REFERENCE;
  projectPath: string;
  content: string;
  exists: boolean;
  enabled: boolean;
  updatedAt?: number;
}

export interface SavedWorkspaceGuide {
  guide: WorkspaceGuide;
  settings: KnowledgeLookupSettings;
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function validateContent(content: unknown): asserts content is string {
  if (typeof content !== 'string') {
    throw new TypeError('Project guide content must be a string.');
  }
  if (content.length > MAX_WORKSPACE_GUIDE_CHARACTERS) {
    throw new TypeError(
      `Project guide content must not exceed ${MAX_WORKSPACE_GUIDE_CHARACTERS.toLocaleString()} characters.`
    );
  }
}

/** Loads the UI-authored project specification from the configured wiki folder. */
export async function loadWorkspaceGuide(workspace: string): Promise<WorkspaceGuide> {
  const settings = await loadKnowledgeSettings(workspace);
  const wikiRoot = await resolveWikiFolder(workspace);
  const absolutePath = join(wikiRoot, WORKSPACE_GUIDE_FILE);
  const projectPath = relative(workspace, absolutePath).replace(/\\/g, '/');
  try {
    const [content, stat] = await Promise.all([
      fs.readFile(absolutePath, 'utf8'),
      fs.stat(absolutePath),
    ]);
    return {
      reference: WORKSPACE_GUIDE_REFERENCE,
      projectPath,
      content,
      exists: true,
      enabled: settings.projectGuideEnabled,
      updatedAt: stat.mtimeMs,
    };
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    return {
      reference: WORKSPACE_GUIDE_REFERENCE,
      projectPath,
      content: '',
      exists: false,
      enabled: settings.projectGuideEnabled,
    };
  }
}

/** Saves the project specification and its dedicated agent-lookup toggle. */
export async function saveWorkspaceGuide(
  workspace: string,
  content: unknown,
  enabled: unknown = false,
): Promise<SavedWorkspaceGuide> {
  validateContent(content);
  if (typeof enabled !== 'boolean') {
    throw new TypeError('Project guide enabled state must be a boolean.');
  }
  const currentSettings = await loadKnowledgeSettings(workspace);
  const settings = await saveKnowledgeSettings(workspace, {
    projectGuideEnabled: enabled,
    // Keep the existing Wiki preference when disabling the guide. Enabling the
    // guide still makes Wiki available, preserving the original save behavior.
    wikiLookupEnabled: enabled ? true : currentSettings.wikiLookupEnabled,
  });
  const wikiRoot = await resolveWikiFolder(workspace);
  await fs.mkdir(wikiRoot, { recursive: true });
  await fs.writeFile(join(wikiRoot, WORKSPACE_GUIDE_FILE), content, 'utf8');
  return {
    guide: await loadWorkspaceGuide(workspace),
    settings: await loadKnowledgeSettings(workspace),
  };
}
