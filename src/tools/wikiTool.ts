import * as fs from 'fs/promises';
import { basename, extname, join, relative } from 'path';
import { loadKnowledgeSettings, resolveWikiFolder } from './knowledgeSettings.js';
import { validateAndResolvePath } from '@barok/adapter-node';
import { WORKSPACE_GUIDE_FILE } from './workspaceGuide.js';

export interface WikiParams {
  operation: 'list' | 'get' | 'search';
  page?: string;
  query?: string;
}

export interface WikiToolResult {
  success: boolean;
  output?: string;
  error?: string;
  truncated?: boolean;
}

interface WikiPage {
  reference: string;
  title: string;
  absolutePath: string;
  projectPath: string;
}

const MAX_WIKI_PAGES = 500;
const MAX_SEARCH_FILE_BYTES = 1_000_000;
const MAX_SEARCH_RESULTS = 50;

function titleFromMarkdown(content: string, path: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || basename(path, extname(path)).replace(/[-_]+/g, ' ');
}

function wikiReference(wikiRoot: string, path: string): string {
  return `wiki:${relative(wikiRoot, path).replace(/\\/g, '/').replace(/\.md$/i, '')}`;
}

async function collectMarkdownFiles(root: string, excludedPath?: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    if (files.length >= MAX_WIKI_PAGES) return;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_WIKI_PAGES) break;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (
        entry.isFile()
        && entry.name.toLowerCase().endsWith('.md')
        && path !== excludedPath
      ) files.push(path);
    }
  };

  try {
    await visit(root);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  return files.sort();
}

async function describePage(workspace: string, wikiRoot: string, path: string): Promise<WikiPage> {
  const content = await fs.readFile(path, 'utf8');
  return {
    reference: wikiReference(wikiRoot, path),
    title: titleFromMarkdown(content, path),
    absolutePath: path,
    projectPath: relative(workspace, path).replace(/\\/g, '/'),
  };
}

async function listWiki(
  workspace: string,
  wikiRoot: string,
  excludedPath?: string,
): Promise<WikiToolResult> {
  const paths = await collectMarkdownFiles(wikiRoot, excludedPath);
  if (paths.length === 0) {
    return { success: true, output: 'No Markdown wiki pages were found.' };
  }
  const pages = await Promise.all(paths.map((path) => describePage(workspace, wikiRoot, path)));
  return {
    success: true,
    output: pages.map((page) => `${page.reference} — ${page.title} (${page.projectPath})`).join('\n'),
    truncated: paths.length >= MAX_WIKI_PAGES,
  };
}

function normalizePageReference(reference: string): string | null {
  const page = reference.trim().replace(/^wiki:/i, '').replace(/\\/g, '/').replace(/\.md$/i, '');
  if (!page || page.startsWith('/') || /^[A-Za-z]:/.test(page)) return null;
  if (page.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return null;
  return page;
}

function isProjectGuideReference(reference: string | undefined): boolean {
  return normalizePageReference(reference || '')?.toLowerCase() === 'project-specification';
}

function projectGuideDisabledError(): WikiToolResult {
  return {
    success: false,
    error: 'Project guide is disabled for this project. Enable it in the Project guide settings.',
  };
}

async function getWikiPage(
  workspace: string,
  wikiRoot: string,
  reference: string
): Promise<WikiToolResult> {
  const page = normalizePageReference(reference);
  if (!page) {
    return { success: false, error: `Invalid wiki reference "${reference}". Expected wiki:<page-path>.` };
  }
  const path = validateAndResolvePath(`${page}.md`, wikiRoot);
  try {
    const content = await fs.readFile(path, 'utf8');
    return {
      success: true,
      output: [
        `Reference: ${wikiReference(wikiRoot, path)}`,
        `Title: ${titleFromMarkdown(content, path)}`,
        `Path: ${relative(workspace, path).replace(/\\/g, '/')}`,
        '',
        content,
      ].join('\n'),
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { success: false, error: `Wiki page wiki:${page} was not found.` };
    }
    throw error;
  }
}

function excerpt(content: string, query: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  const index = normalized.toLowerCase().indexOf(query.toLowerCase());
  const start = Math.max(0, index - 80);
  const end = Math.min(normalized.length, (index < 0 ? 0 : index) + query.length + 140);
  return `${start > 0 ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`;
}

async function searchWiki(
  workspace: string,
  wikiRoot: string,
  query: string,
  excludedPath?: string,
): Promise<WikiToolResult> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches: Array<WikiPage & { excerpt: string }> = [];
  for (const path of await collectMarkdownFiles(wikiRoot, excludedPath)) {
    if (matches.length >= MAX_SEARCH_RESULTS) break;
    const stat = await fs.stat(path);
    if (stat.size > MAX_SEARCH_FILE_BYTES) continue;
    const content = await fs.readFile(path, 'utf8');
    const page = await describePage(workspace, wikiRoot, path);
    const haystack = `${page.title}\n${content}`.toLowerCase();
    if (terms.every((term) => haystack.includes(term))) {
      matches.push({ ...page, excerpt: excerpt(content, terms[0]) });
    }
  }

  return matches.length
    ? {
        success: true,
        output: matches
          .map((page) => `${page.reference} — ${page.title}\n  ${page.excerpt}`)
          .join('\n'),
        truncated: matches.length >= MAX_SEARCH_RESULTS,
      }
    : { success: true, output: `No wiki pages matched "${query}".` };
}

/** Reads user-authored Markdown wiki pages from the configured project folder. */
export async function projectWikiTool(
  workspace: string,
  params: WikiParams
): Promise<WikiToolResult> {
  try {
    const settings = await loadKnowledgeSettings(workspace);
    if (!settings.wikiLookupEnabled) {
      return {
        success: false,
        error: 'Wiki lookup is disabled for this project. Enable it in Settings > Knowledge Lookup.',
      };
    }
    const wikiRoot = await resolveWikiFolder(workspace);
    const projectGuidePath = join(wikiRoot, WORKSPACE_GUIDE_FILE);
    if (params.operation === 'get') {
      if (!settings.projectGuideEnabled && isProjectGuideReference(params.page)) {
        return projectGuideDisabledError();
      }
      return await getWikiPage(workspace, wikiRoot, params.page!);
    }
    if (params.operation === 'search') {
      return await searchWiki(
        workspace,
        wikiRoot,
        params.query!,
        settings.projectGuideEnabled ? undefined : projectGuidePath,
      );
    }
    return await listWiki(
      workspace,
      wikiRoot,
      settings.projectGuideEnabled ? undefined : projectGuidePath,
    );
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown project wiki error',
    };
  }
}
