import * as fs from 'fs/promises';
import { randomBytes } from 'crypto';
import { join, relative } from 'path';
import {
  loadKnowledgeSettings,
  resolveSampleFolder,
  saveKnowledgeSettings,
} from './knowledgeSettings.js';

export interface SampleParams {
  operation: 'add' | 'get' | 'list' | 'search' | 'set_folder' | 'get_folder';
  title?: string;
  description?: string;
  content?: string;
  language?: string;
  tags?: string[];
  sample_id?: string;
  query?: string;
  folder?: string;
}

export interface SampleToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

interface StoredSample {
  id: string;
  title: string;
  description: string;
  content: string;
  language?: string;
  tags: string[];
  createdAt: string;
  path: string;
}

const SAMPLE_HEADER_PREFIX = '<!-- react-engine-sample:';
const SAMPLE_HEADER_SUFFIX = ' -->';
const SAMPLE_CONTENT_MARKER = '<!-- sample-content -->';
const SAMPLE_REFERENCE_PREFIX = 'sample:';

async function samplesDirectory(workspace: string): Promise<string> {
  return resolveSampleFolder(workspace);
}

async function setSampleFolder(workspace: string, folder: string): Promise<SampleToolResult> {
  const settings = await saveKnowledgeSettings(workspace, { sampleFolder: folder });
  return {
    success: true,
    output: `Sample repository folder set to ${settings.sampleFolder}.`,
  };
}

async function getSampleFolder(workspace: string): Promise<SampleToolResult> {
  const settings = await loadKnowledgeSettings(workspace);
  return {
    success: true,
    output: `Sample repository folder: ${settings.sampleFolder}`,
  };
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'sample';
}

function normalizeSampleId(reference: string): string | null {
  const id = reference.trim().toLowerCase().replace(/^sample:/, '');
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(id) ? id : null;
}

function serializeSample(sample: Omit<StoredSample, 'path'>): string {
  const metadata = JSON.stringify({
    id: sample.id,
    title: sample.title,
    description: sample.description,
    language: sample.language,
    tags: sample.tags,
    createdAt: sample.createdAt,
  });
  const description = sample.description ? `\n${sample.description}\n` : '';
  return [
    `${SAMPLE_HEADER_PREFIX}${metadata}${SAMPLE_HEADER_SUFFIX}`,
    '',
    `# ${sample.title}`,
    description,
    SAMPLE_CONTENT_MARKER,
    sample.content,
    '',
  ].join('\n');
}

function parseSample(source: string, path: string): StoredSample | null {
  const firstLineEnd = source.indexOf('\n');
  const firstLine = (firstLineEnd >= 0 ? source.slice(0, firstLineEnd) : source).replace(/\r$/, '');
  if (!firstLine.startsWith(SAMPLE_HEADER_PREFIX) || !firstLine.endsWith(SAMPLE_HEADER_SUFFIX)) {
    return null;
  }

  try {
    const metadata = JSON.parse(
      firstLine.slice(SAMPLE_HEADER_PREFIX.length, -SAMPLE_HEADER_SUFFIX.length)
    ) as Record<string, unknown>;
    if (
      typeof metadata.id !== 'string' ||
      typeof metadata.title !== 'string' ||
      typeof metadata.description !== 'string' ||
      typeof metadata.createdAt !== 'string' ||
      !Array.isArray(metadata.tags) ||
      !metadata.tags.every((tag) => typeof tag === 'string') ||
      (metadata.language !== undefined && typeof metadata.language !== 'string')
    ) {
      return null;
    }

    const markerIndex = source.indexOf(SAMPLE_CONTENT_MARKER, firstLineEnd);
    if (markerIndex < 0) return null;
    return {
      id: metadata.id,
      title: metadata.title,
      description: metadata.description,
      language: metadata.language,
      tags: metadata.tags,
      createdAt: metadata.createdAt,
      content: source
        .slice(markerIndex + SAMPLE_CONTENT_MARKER.length)
        .replace(/^\r?\n/, '')
        .replace(/\r?\n$/, ''),
      path,
    };
  } catch {
    return null;
  }
}

async function loadSamples(workspace: string): Promise<StoredSample[]> {
  const directory = await samplesDirectory(workspace);
  let entries: string[];
  try {
    entries = (await fs.readdir(directory)).filter((entry) => entry.endsWith('.md')).sort();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  return (
    await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry);
      return parseSample(await fs.readFile(path, 'utf8'), path);
    }))
  )
    .filter((sample): sample is StoredSample => sample !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function formatSampleSummary(sample: StoredSample): string {
  const metadata = [
    sample.language ? `language: ${sample.language}` : '',
    sample.tags.length ? `tags: ${sample.tags.join(', ')}` : '',
  ].filter(Boolean);
  return `${SAMPLE_REFERENCE_PREFIX}${sample.id} — ${sample.title}${metadata.length ? ` [${metadata.join('; ')}]` : ''}`;
}

async function addSample(
  workspace: string,
  params: Required<Pick<SampleParams, 'title' | 'content'>> & SampleParams
): Promise<SampleToolResult> {
  const directory = await samplesDirectory(workspace);
  await fs.mkdir(directory, { recursive: true });

  for (let attempt = 0; attempt < 5; attempt++) {
    const id = `${slugify(params.title)}-${randomBytes(4).toString('hex')}`;
    const path = join(directory, `${id}.md`);
    const createdAt = new Date().toISOString();
    try {
      await fs.writeFile(path, serializeSample({
        id,
        title: params.title,
        description: params.description || '',
        content: params.content,
        language: params.language,
        tags: params.tags || [],
        createdAt,
      }), { encoding: 'utf8', flag: 'wx' });
      return {
        success: true,
        output: [
          `Saved sample "${params.title}".`,
          `Reference: ${SAMPLE_REFERENCE_PREFIX}${id}`,
          `Path: ${relative(workspace, path).replace(/\\/g, '/')}`,
        ].join('\n'),
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
        continue;
      }
      throw error;
    }
  }

  return { success: false, error: 'Could not allocate a unique sample ID. Please try again.' };
}

async function getSample(workspace: string, reference: string): Promise<SampleToolResult> {
  const id = normalizeSampleId(reference);
  if (!id) {
    return { success: false, error: `Invalid sample reference "${reference}". Expected sample:<id> or <id>.` };
  }

  const path = join(await samplesDirectory(workspace), `${id}.md`);
  let sample: StoredSample | null;
  try {
    sample = parseSample(await fs.readFile(path, 'utf8'), path);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      sample = null;
    } else {
      throw error;
    }
  }
  if (!sample) {
    return { success: false, error: `Sample ${SAMPLE_REFERENCE_PREFIX}${id} was not found in this project.` };
  }

  return {
    success: true,
    output: [
      `Reference: ${SAMPLE_REFERENCE_PREFIX}${sample.id}`,
      `Title: ${sample.title}`,
      sample.description ? `Description: ${sample.description}` : '',
      sample.language ? `Language: ${sample.language}` : '',
      sample.tags.length ? `Tags: ${sample.tags.join(', ')}` : '',
      `Created: ${sample.createdAt}`,
      `Path: ${relative(workspace, sample.path).replace(/\\/g, '/')}`,
      '',
      sample.content,
    ].filter((line, index) => line !== '' || index >= 7).join('\n'),
  };
}

async function listSamples(workspace: string): Promise<SampleToolResult> {
  const samples = await loadSamples(workspace);
  return samples.length
    ? { success: true, output: samples.map(formatSampleSummary).join('\n') }
    : { success: true, output: 'No project samples have been saved.' };
}

async function searchSamples(workspace: string, query: string): Promise<SampleToolResult> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (await loadSamples(workspace)).filter((sample) => {
    const haystack = [
      sample.title,
      sample.description,
      sample.language || '',
      sample.tags.join(' '),
      sample.content,
    ].join('\n').toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });

  return matches.length
    ? { success: true, output: matches.map(formatSampleSummary).join('\n') }
    : { success: true, output: `No project samples matched "${query}".` };
}

/** Stores and retrieves reusable examples scoped to the active project workspace. */
export async function projectSampleTool(
  workspace: string,
  params: SampleParams
): Promise<SampleToolResult> {
  try {
    if (params.operation === 'set_folder') {
      return await setSampleFolder(workspace, params.folder!);
    }
    if (params.operation === 'get_folder') {
      return await getSampleFolder(workspace);
    }
    const settings = await loadKnowledgeSettings(workspace);
    if (!settings.sampleLookupEnabled) {
      return {
        success: false,
        error: 'Sample lookup is disabled for this project. Enable it in Settings > Knowledge Lookup.',
      };
    }
    if (params.operation === 'add') {
      return await addSample(workspace, params as Required<Pick<SampleParams, 'title' | 'content'>> & SampleParams);
    }
    if (params.operation === 'get') {
      return await getSample(workspace, params.sample_id!);
    }
    if (params.operation === 'search') {
      return await searchSamples(workspace, params.query!);
    }
    return await listSamples(workspace);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown project sample error',
    };
  }
}
