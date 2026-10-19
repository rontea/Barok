import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { jsonParse, jsonStringify, measureSlowOperationAsync } from '../utils/slowOperations.js';

export const TOOL_RESULT_STORAGE_DIR = 'tool-results';
export const DEFAULT_TOOL_RESULT_INLINE_LIMIT = 20_000;
export const TOOL_RESULT_PREVIEW_LIMIT = 4_000;

export interface PersistedObservationMetadata {
  persisted: true;
  originalLength: number;
  previewLength: number;
  path: string;
}

function getInlineLimit(): number {
  const fromEnv = Number(process.env.REACT_ENGINE_TOOL_RESULT_INLINE_LIMIT);
  return Number.isFinite(fromEnv) && fromEnv > 0
    ? fromEnv
    : DEFAULT_TOOL_RESULT_INLINE_LIMIT;
}

function getGuardedReadHash(value: string): string | undefined {
  return value.match(/\[guarded-read-hash:\s*([a-f0-9]{64})\]/i)?.[1];
}

function previewText(value: string): string {
  if (value.length <= TOOL_RESULT_PREVIEW_LIMIT) return value;
  const candidate = value.slice(0, TOOL_RESULT_PREVIEW_LIMIT);
  const lastNewline = candidate.lastIndexOf('\n');
  const cutPoint = lastNewline > TOOL_RESULT_PREVIEW_LIMIT / 2 ? lastNewline : TOOL_RESULT_PREVIEW_LIMIT;
  const preview = `${value.slice(0, cutPoint)}\n...[persisted ${value.length - cutPoint} chars]`;
  const guardedReadHash = getGuardedReadHash(value);
  return guardedReadHash && !preview.includes(guardedReadHash)
    ? `${preview}\n\n[guarded-read-hash: ${guardedReadHash}]`
    : preview;
}

async function persistObservation(workspace: string, observation: string): Promise<string> {
  const targetDir = path.join(workspace, '.react-engine', TOOL_RESULT_STORAGE_DIR);
  await mkdir(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, `${Date.now()}-${randomUUID()}.txt`);
  await measureSlowOperationAsync(`write tool result ${targetPath}`, () =>
    writeFile(targetPath, observation, 'utf-8')
  );
  return targetPath;
}

function replaceLargeOutput(
  observation: string,
  persistedPath: string
): string {
  try {
    const parsed = jsonParse<Record<string, unknown>>(observation);
    const output = parsed.output;
    if (typeof output !== 'string' || output.length <= TOOL_RESULT_PREVIEW_LIMIT) {
      return observation;
    }

    const metadata: PersistedObservationMetadata = {
      persisted: true,
      originalLength: output.length,
      previewLength: Math.min(output.length, TOOL_RESULT_PREVIEW_LIMIT),
      path: persistedPath,
    };

    return jsonStringify({
      ...parsed,
      output: previewText(output),
      fullOutput: metadata,
    });
  } catch {
    return jsonStringify({
      success: true,
      output: previewText(observation),
      fullOutput: {
        persisted: true,
        originalLength: observation.length,
        previewLength: Math.min(observation.length, TOOL_RESULT_PREVIEW_LIMIT),
        path: persistedPath,
      } satisfies PersistedObservationMetadata,
    });
  }
}

export async function persistLargeObservationIfNeeded(
  observation: string,
  workspace?: string
): Promise<string> {
  if (!workspace || observation.length <= getInlineLimit()) {
    return observation;
  }

  try {
    const persistedPath = await persistObservation(workspace, observation);
    return replaceLargeOutput(observation, persistedPath);
  } catch {
    return observation;
  }
}
