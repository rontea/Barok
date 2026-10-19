import {
  discoverManifests as discoverNodeManifests,
  getLatestManifest as getLatestNodeManifest,
  loadManifest as loadNodeManifest,
  saveManifest as saveNodeManifest,
  updateManifestWithVerification as updateNodeManifestWithVerification,
} from '@barok/adapter-node';
import type { AppManifest, VerificationResult } from '../react/app-manifest.js';

/** Compatibility facade for existing app imports; storage lives in adapter-node. */
export function saveManifest(manifest: AppManifest, workspace: string): Promise<string> {
  return saveNodeManifest(manifest, workspace);
}

export function loadManifest(manifestPath: string): Promise<AppManifest | null> {
  return loadNodeManifest<AppManifest>(manifestPath);
}

export function discoverManifests(workspace: string): Promise<AppManifest[]> {
  return discoverNodeManifests<AppManifest>(workspace);
}

export function updateManifestWithVerification(
  manifest: AppManifest,
  result: VerificationResult,
  workspace: string,
): Promise<AppManifest> {
  return updateNodeManifestWithVerification(manifest, result, workspace);
}

export function getLatestManifest(workspace: string, appName: string): Promise<AppManifest | null> {
  return getLatestNodeManifest<AppManifest>(workspace, appName);
}
