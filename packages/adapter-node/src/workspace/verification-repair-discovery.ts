import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppManifest } from '@barok/engine';

const REPAIRABLE_RUNTIME_FILE_RE = /\.(?:html?|css|js|jsx|ts|tsx|mjs|cjs)$/i;

/**
 * Find existing runtime files that a browser verification repair may need to
 * inspect. The initial task's writes are not a complete dependency graph: an
 * existing script referenced by an HTML page may never have been written in
 * the current run, but it is still a valid repair target.
 */
export async function discoverVerificationRepairFiles(
  manifest: Pick<AppManifest, 'workspace' | 'entryPoint' | 'outputFiles'>,
): Promise<string[]> {
  const workspace = path.resolve(manifest.workspace);
  const discovered = new Set<string>();
  const htmlQueue: string[] = [];

  const addCandidate = async (value: unknown, baseDirectory: string): Promise<void> => {
    if (typeof value !== 'string' || !value.trim()) return;
    let resource = value.trim().split(/[?#]/, 1)[0];
    if (!resource || /^(?:[a-z]+:|data:|#|mailto:)/i.test(resource)) return;
    resource = resource.replace(/^\/+/, '');
    const absolute = path.resolve(baseDirectory, resource);
    const relative = path.relative(workspace, absolute);
    if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) return;

    const normalized = relative.replace(/\\/g, '/');
    if (!REPAIRABLE_RUNTIME_FILE_RE.test(normalized)) return;
    try {
      const stats = await fs.stat(absolute);
      if (!stats.isFile() || discovered.has(normalized)) return;
      discovered.add(normalized);
      if (/\.html?$/i.test(normalized)) htmlQueue.push(absolute);
    } catch {
      // Broken references are evidence, but there is no existing file to inspect or add to scope.
    }
  };

  await addCandidate(manifest.entryPoint, workspace);
  for (const outputFile of manifest.outputFiles || []) await addCandidate(outputFile, workspace);

  const referencePatterns = [
    /<script\b[^>]*\bsrc=["']([^"']+)["']/gi,
    /<link\b[^>]*\bhref=["']([^"']+)["']/gi,
  ];
  for (let index = 0; index < htmlQueue.length; index += 1) {
    const htmlPath = htmlQueue[index];
    let html = '';
    try {
      html = await fs.readFile(htmlPath, 'utf8');
    } catch {
      continue;
    }
    for (const pattern of referencePatterns) {
      pattern.lastIndex = 0;
      for (const match of html.matchAll(pattern)) await addCandidate(match[1], path.dirname(htmlPath));
    }
  }

  return [...discovered].sort((left, right) => left.localeCompare(right));
}
