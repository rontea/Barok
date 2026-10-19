import * as fs from 'fs/promises';
import { isAbsolute, join, relative, resolve } from 'path';
import { validateAndResolvePath } from '@barok/adapter-node';

export interface KnowledgeLookupSettings {
  sampleLookupEnabled: boolean;
  sampleFolder: string;
  wikiLookupEnabled: boolean;
  projectGuideEnabled: boolean;
  wikiFolder: string;
  webSearchEnabled: boolean;
}

export const DEFAULT_KNOWLEDGE_LOOKUP_SETTINGS: KnowledgeLookupSettings = {
  sampleLookupEnabled: false,
  sampleFolder: '.react-engine/samples',
  wikiLookupEnabled: false,
  projectGuideEnabled: false,
  wikiFolder: 'wiki',
  webSearchEnabled: true,
};

const SETTINGS_PATH = join('.react-engine', 'knowledge-settings.json');
const LEGACY_SAMPLE_SETTINGS_PATH = join('.react-engine', 'sample-repository.json');

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value = JSON.parse(await fs.readFile(path, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch (error) {
    if (isMissingFile(error) || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function mergeSettings(value?: Record<string, unknown>): KnowledgeLookupSettings {
  return {
    sampleLookupEnabled: typeof value?.sampleLookupEnabled === 'boolean'
      ? value.sampleLookupEnabled
      : DEFAULT_KNOWLEDGE_LOOKUP_SETTINGS.sampleLookupEnabled,
    sampleFolder: typeof value?.sampleFolder === 'string' && value.sampleFolder.trim()
      ? value.sampleFolder
      : DEFAULT_KNOWLEDGE_LOOKUP_SETTINGS.sampleFolder,
    wikiLookupEnabled: typeof value?.wikiLookupEnabled === 'boolean'
      ? value.wikiLookupEnabled
      : DEFAULT_KNOWLEDGE_LOOKUP_SETTINGS.wikiLookupEnabled,
    projectGuideEnabled: typeof value?.projectGuideEnabled === 'boolean'
      ? value.projectGuideEnabled
      : DEFAULT_KNOWLEDGE_LOOKUP_SETTINGS.projectGuideEnabled,
    wikiFolder: typeof value?.wikiFolder === 'string' && value.wikiFolder.trim()
      ? value.wikiFolder
      : DEFAULT_KNOWLEDGE_LOOKUP_SETTINGS.wikiFolder,
    webSearchEnabled: typeof value?.webSearchEnabled === 'boolean'
      ? value.webSearchEnabled
      : DEFAULT_KNOWLEDGE_LOOKUP_SETTINGS.webSearchEnabled,
  };
}

export async function loadKnowledgeSettings(workspace: string): Promise<KnowledgeLookupSettings> {
  const settings = await readJson(join(workspace, SETTINGS_PATH));
  if (settings) return mergeSettings(settings);

  const legacy = await readJson(join(workspace, LEGACY_SAMPLE_SETTINGS_PATH));
  return mergeSettings(
    typeof legacy?.folder === 'string' ? { sampleFolder: legacy.folder } : undefined
  );
}

async function nearestExistingPath(path: string): Promise<string> {
  let candidate = path;
  while (true) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      const parent = resolve(candidate, '..');
      if (parent === candidate) return candidate;
      candidate = parent;
    }
  }
}

export async function validateKnowledgeFolder(
  workspace: string,
  folder: string,
  label: string
): Promise<{ absolutePath: string; projectPath: string }> {
  const absolutePath = validateAndResolvePath(folder, workspace);
  const projectPath = relative(workspace, absolutePath).replace(/\\/g, '/');
  if (!projectPath || projectPath.startsWith('../') || isAbsolute(projectPath)) {
    throw new Error(`${label} must be a folder inside the project, not the project root.`);
  }
  if (projectPath === '.git' || projectPath.startsWith('.git/')) {
    throw new Error(`${label} cannot use the Git metadata directory.`);
  }

  const [realWorkspace, existingParent] = await Promise.all([
    fs.realpath(resolve(workspace)),
    nearestExistingPath(absolutePath),
  ]);
  const realParent = await fs.realpath(existingParent);
  const parentRelative = relative(realWorkspace, realParent);
  if (parentRelative.startsWith('..') || isAbsolute(parentRelative)) {
    throw new Error(`${label} resolves outside the project workspace.`);
  }

  return { absolutePath, projectPath };
}

export async function resolveSampleFolder(workspace: string): Promise<string> {
  const settings = await loadKnowledgeSettings(workspace);
  return (await validateKnowledgeFolder(workspace, settings.sampleFolder, 'Sample repository folder')).absolutePath;
}

export async function resolveWikiFolder(workspace: string): Promise<string> {
  const settings = await loadKnowledgeSettings(workspace);
  return (await validateKnowledgeFolder(workspace, settings.wikiFolder, 'Wiki folder')).absolutePath;
}

export async function saveKnowledgeSettings(
  workspace: string,
  input: Partial<KnowledgeLookupSettings>
): Promise<KnowledgeLookupSettings> {
  const current = await loadKnowledgeSettings(workspace);
  const candidate: KnowledgeLookupSettings = {
    sampleLookupEnabled: typeof input.sampleLookupEnabled === 'boolean'
      ? input.sampleLookupEnabled
      : current.sampleLookupEnabled,
    sampleFolder: typeof input.sampleFolder === 'string'
      ? input.sampleFolder
      : current.sampleFolder,
    wikiLookupEnabled: typeof input.wikiLookupEnabled === 'boolean'
      ? input.wikiLookupEnabled
      : current.wikiLookupEnabled,
    projectGuideEnabled: typeof input.projectGuideEnabled === 'boolean'
      ? input.projectGuideEnabled
      : current.projectGuideEnabled,
    wikiFolder: typeof input.wikiFolder === 'string'
      ? input.wikiFolder
      : current.wikiFolder,
    webSearchEnabled: typeof input.webSearchEnabled === 'boolean'
      ? input.webSearchEnabled
      : current.webSearchEnabled,
  };
  const [sampleFolder, wikiFolder] = await Promise.all([
    validateKnowledgeFolder(workspace, candidate.sampleFolder, 'Sample repository folder'),
    validateKnowledgeFolder(workspace, candidate.wikiFolder, 'Wiki folder'),
  ]);
  candidate.sampleFolder = sampleFolder.projectPath;
  candidate.wikiFolder = wikiFolder.projectPath;

  await Promise.all([
    candidate.sampleLookupEnabled
      ? fs.mkdir(sampleFolder.absolutePath, { recursive: true })
      : Promise.resolve(),
    candidate.wikiLookupEnabled
      ? fs.mkdir(wikiFolder.absolutePath, { recursive: true })
      : Promise.resolve(),
    fs.mkdir(join(workspace, '.react-engine'), { recursive: true }),
  ]);
  await fs.writeFile(
    join(workspace, SETTINGS_PATH),
    `${JSON.stringify(candidate, null, 2)}\n`,
    'utf8'
  );
  return candidate;
}
