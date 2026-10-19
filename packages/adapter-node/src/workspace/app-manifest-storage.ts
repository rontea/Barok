import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Minimum fields used to persist and select an app manifest. */
export interface StoredAppManifest {
  id: string;
  timestamp: string;
  appName: string;
}

const manifestDirectory = (workspace: string) => path.join(workspace, '.react-engine', 'manifests');

/** Persist a generated-app manifest in a Node workspace. */
export async function saveManifest<TManifest extends StoredAppManifest>(
  manifest: TManifest,
  workspace: string,
): Promise<string> {
  const directory = manifestDirectory(workspace);
  await fs.mkdir(directory, { recursive: true });

  const manifestPath = path.join(directory, `${manifest.id}.json`);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  return manifestPath;
}

/** Load one manifest from a Node workspace. */
export async function loadManifest<TManifest extends StoredAppManifest = StoredAppManifest>(
  manifestPath: string,
): Promise<TManifest | null> {
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    return JSON.parse(content) as TManifest;
  } catch {
    return null;
  }
}

/** Discover readable manifests in a Node workspace. */
export async function discoverManifests<TManifest extends StoredAppManifest = StoredAppManifest>(
  workspace: string,
): Promise<TManifest[]> {
  const directory = manifestDirectory(workspace);
  try {
    const files = await fs.readdir(directory);
    const manifests: TManifest[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const manifest = await loadManifest<TManifest>(path.join(directory, file));
      if (manifest) manifests.push(manifest);
    }
    return manifests;
  } catch {
    return [];
  }
}

/** Persist verification results alongside an existing manifest. */
export async function updateManifestWithVerification<
  TManifest extends StoredAppManifest,
  TVerificationResult,
>(
  manifest: TManifest,
  result: TVerificationResult,
  workspace: string,
): Promise<TManifest & { verificationResults: TVerificationResult }> {
  const updated = { ...manifest, verificationResults: result };
  const manifestPath = path.join(manifestDirectory(workspace), `${manifest.id}.json`);
  await fs.writeFile(manifestPath, JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}

/** Return the most recently saved manifest for an app. */
export async function getLatestManifest<TManifest extends StoredAppManifest = StoredAppManifest>(
  workspace: string,
  appName: string,
): Promise<TManifest | null> {
  const matching = (await discoverManifests<TManifest>(workspace))
    .filter((manifest) => manifest.appName === appName);
  if (matching.length === 0) return null;
  return matching.sort((left, right) =>
    new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
  )[0] ?? null;
}
