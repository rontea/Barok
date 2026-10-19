export type VerificationCheck = 'project-verification' | 'unit-tests' | 'typescript' | 'lint' | 'build';

const COMMAND_OPERATIONS: Record<string, VerificationCheck> = {
  verify: 'project-verification',
  smoke: 'project-verification',
  test: 'unit-tests',
  typecheck: 'typescript',
  lint: 'lint',
  build: 'build',
};

function shellSegment(pattern: string): RegExp {
  return new RegExp(`(?:^|(?:&&|\\|\\||;|&)\\s*)${pattern}(?:\\s|$)`, 'i');
}

export function verificationCheckForAction(
  action: string,
  input: Record<string, unknown> | undefined,
): VerificationCheck | undefined {
  if (action === 'Command') return COMMAND_OPERATIONS[String(input?.operation || '').toLowerCase()];
  if (action !== 'Bash') return undefined;

  const command = String(input?.command || '').trim();
  if (!command) return undefined;
  const packageManager = '(?:npm|pnpm|yarn|bun)(?:\\.cmd)?';
  if (shellSegment(`${packageManager}(?:\\s+run)?\\s+(?:smoke|test:smoke(?:[:\\w.-]*)?)`).test(command)) return 'project-verification';
  if (shellSegment(`${packageManager}(?:\\s+run)?\\s+(?:test(?::[\\w.-]+)?|vitest|jest)`).test(command) ||
      shellSegment('(?:npx\\s+)?(?:jest|vitest|playwright)(?:\\.cmd)?').test(command) ||
      shellSegment('(?:cargo|go|dotnet|mvn|gradle|gradlew(?:\\.bat)?)\\s+test').test(command) ||
      shellSegment('(?:python(?:3|\\.exe)?\\s+-m\\s+pytest|pytest)').test(command)) return 'unit-tests';
  if (shellSegment(`${packageManager}\\s+run\\s+typecheck`).test(command) ||
      shellSegment('(?:npx\\s+)?tsc(?:\\.cmd)?').test(command)) return 'typescript';
  if (shellSegment(`${packageManager}\\s+run\\s+lint`).test(command) ||
      shellSegment('(?:npx\\s+)?eslint(?:\\.cmd)?').test(command)) return 'lint';
  if (shellSegment(`${packageManager}\\s+run\\s+build`).test(command) ||
      shellSegment('(?:npx\\s+)?vite(?:\\.cmd)?\\s+build').test(command) ||
      shellSegment('(?:cargo|go|dotnet|mvn|gradle|gradlew(?:\\.bat)?)\\s+build').test(command)) return 'build';
  // Small static projects commonly use a temporary smoke script instead of a
  // package-manager test script. Treat that script as project verification so
  // its output can satisfy completion.
  if (shellSegment('node(?:\\.exe)?(?:\\s+--[\\w-]+)*\\s+(?:[^\\s]*[\\\\/])?(?:smoke[-_.]?test|test[-_.]?smoke)[\\w.-]*\\.(?:js|mjs|cjs|ts)').test(command)) return 'project-verification';
  return undefined;
}

export function isVerificationAction(action: string, input: Record<string, unknown> | undefined): boolean {
  return verificationCheckForAction(action, input) !== undefined;
}

const VERIFICATION_ARTIFACT_RE = /(?:^|[\\/])(?:smoke[-_.]?test|test[-_.]?smoke)(?:[-_.][\w-]+)?\.(?:js|mjs|cjs|ts)$/i;

export function isVerificationArtifactPath(filePath: string): boolean {
  return VERIFICATION_ARTIFACT_RE.test(filePath.trim());
}

/** Returns true when a verification command explicitly references a smoke-test artifact. */
export function verificationCommandReferencesFile(
  action: string,
  input: Record<string, unknown> | undefined,
  filePath: string,
): boolean {
  if (!isVerificationAction(action, input) || !isVerificationArtifactPath(filePath)) return false;
  const command = action === 'Bash'
    ? String(input?.command || '')
    : [input?.operation, ...(Array.isArray(input?.args) ? input.args : [])].filter(Boolean).join(' ');
  const normalizedCommand = command.replace(/\\/g, '/').toLowerCase();
  const normalizedFile = filePath.replace(/\\/g, '/').toLowerCase();
  const basename = normalizedFile.slice(normalizedFile.lastIndexOf('/') + 1);
  return normalizedCommand.includes(normalizedFile) || normalizedCommand.includes(basename);
}
