import { existsSync } from 'fs';
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import path from 'path';

export type CommandStatus = 'passed' | 'failed' | 'unavailable' | 'skipped' | 'cancelled' | 'timed_out';
export type CommandOperation =
  | 'git_status'
  | 'git_diff'
  | 'git_log'
  | 'verify'
  | 'smoke'
  | 'test'
  | 'build'
  | 'lint'
  | 'typecheck'
  | 'file_exists'
  | 'list_directory'
  | 'process_inspect';
export type CommandEnvironmentKind = 'windows' | 'powershell' | 'cmd' | 'bash' | 'wsl' | 'macos' | 'linux' | 'unknown';

export interface CommandEnvironment {
  platform: NodeJS.Platform;
  kind: CommandEnvironmentKind;
  shell: string;
  npmExecutable: string;
  evidence: string[];
  availableShells: { cmd: boolean; powershell: boolean; bash: boolean; wsl: boolean };
}

export interface CommandPlatformProfile {
  kind: CommandEnvironmentKind;
  shell: string;
  npmExecutable: string;
  requiredExecutables: string[];
  available: Record<string, boolean>;
  evidence: string[];
}

export interface CommandRequest {
  operation: CommandOperation;
  workspace: string;
  args?: string[];
  timeoutMs?: number;
  environment?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  processEnv?: NodeJS.ProcessEnv;
}

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

export interface PackageManagerResolution {
  manager: PackageManager;
  executable: string;
  evidence: string;
}

export interface DiscoveredProjectCommand {
  operation: Extract<CommandOperation, 'smoke' | 'test' | 'build' | 'lint' | 'typecheck'>;
  script: string;
  scriptCommand: string;
  manager: PackageManagerResolution;
  source: 'package.json';
  cwd: string;
}

export interface CommandInvocation {
  executable: string;
  args: string[];
  cwd: string;
  environment: CommandEnvironment;
}

export interface CommandResult {
  status: CommandStatus;
  operation: CommandOperation | 'shell';
  executable?: string;
  args: string[];
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode?: number;
  durationMs: number;
  outputTruncated: boolean;
  outputBytes: number;
  error?: string;
  outputArtifact?: { path: string; sha256: string; bytes: number; redacted: boolean };
  termination?: { requested: boolean; tree: boolean; confirmed: boolean };
}

const OUTPUT_PREVIEW_BYTES = 64 * 1024;

function shellAvailability(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): CommandEnvironment['availableShells'] {
  return {
    cmd: platform === 'win32' && Boolean(env.ComSpec || true),
    powershell: platform === 'win32' && Boolean(env.PSModulePath || env.ProgramW6432 || env.SystemRoot),
    bash: platform !== 'win32' ? Boolean(env.SHELL || true) : Boolean(env.BASH || env.MSYS || env.CYGWIN),
    wsl: Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP),
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function detectCommandEnvironment(platform: NodeJS.Platform = process.platform, env = process.env): CommandEnvironment {
  if (platform === 'win32') {
    const isWsl = Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
    const shell = env.ComSpec || 'cmd.exe';
    return {
      platform,
      kind: isWsl ? 'wsl' : 'windows',
      shell,
      npmExecutable: 'npm.cmd',
      evidence: [isWsl ? 'WSL environment variables detected' : 'native Windows platform detected', `shell=${shell}`],
      availableShells: shellAvailability(platform, env),
    };
  }
  const resolvedShell = resolveUnixShell(env);
  if (platform === 'darwin') {
    return { platform, kind: 'macos', shell: resolvedShell, npmExecutable: 'npm', evidence: ['darwin platform detected'], availableShells: shellAvailability(platform, env) };
  }
  if (platform === 'linux') {
    const isWsl = Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
    return { platform, kind: isWsl ? 'wsl' : 'linux', shell: resolvedShell, npmExecutable: 'npm', evidence: [isWsl ? 'WSL environment variables detected' : 'linux platform detected'], availableShells: shellAvailability(platform, env) };
  }
  return { platform, kind: 'unknown', shell: '', npmExecutable: 'npm', evidence: [`unsupported platform: ${platform}`], availableShells: shellAvailability(platform, env) };
}

/**
 * Performs executable availability checks without guessing that a platform's
 * conventional shell is installed. The probe is injectable for deterministic
 * Windows/WSL/macOS/Linux profile fixtures.
 */
export async function probeCommandPlatformProfile(
  environment = detectCommandEnvironment(),
  probe: (executable: string) => Promise<boolean> = async (executable) => new Promise((resolve) => {
    const child = spawn(executable, ['--version'], { stdio: 'ignore', shell: false, windowsHide: true });
    child.once('error', () => resolve(false));
    child.once('close', () => resolve(true));
  }),
): Promise<CommandPlatformProfile> {
  const requiredExecutables = environment.kind === 'windows'
    ? [environment.shell, 'powershell.exe', 'cmd.exe', environment.npmExecutable]
    : environment.kind === 'wsl'
      ? [environment.shell || '/bin/sh', 'bash', 'npm']
      : environment.kind === 'macos' || environment.kind === 'linux'
        ? [environment.shell || '/bin/sh', 'sh', 'bash', 'npm']
        : [];
  const unique = [...new Set(requiredExecutables.filter(Boolean))];
  const available = Object.fromEntries(await Promise.all(unique.map(async (executable) => [executable, await probe(executable)])));
  return {
    kind: environment.kind,
    shell: environment.shell,
    npmExecutable: environment.npmExecutable,
    requiredExecutables: unique,
    available,
    evidence: [...environment.evidence, ...unique.map((executable) => `${executable}=${available[executable] ? 'available' : 'unavailable'}`)],
  };
}

/** Rewrite only common, unambiguous Unix shell idioms to native Windows equivalents. */
export function rewriteWindowsShellIdioms(command: string, environment = detectCommandEnvironment()): string {
  if (environment.platform !== 'win32' || environment.kind === 'wsl') return command;

  return command
    .replace(/(^\s*|(?:&&|\|\||[&|])\s*)ls\s+-(?:la|al)(?=\s|$)/gim, '$1dir /a')
    .replace(/>\s*\/dev\/null\s*2>&1/gi, '> NUL 2>&1')
    .replace(/>\s*\/dev\/null/gi, '> NUL')
    .replace(/2>\s*\/dev\/null/gi, '2> NUL')
    .replace(/\/dev\/null\b/gi, 'NUL');
}

/** Normalize the narrow set of Windows shell idioms before applying syntax rejection. */
export function normalizeLegacyShellCommand(
  command: string,
  cwd: string,
  environment = detectCommandEnvironment(),
): string {
  const withoutRedundantCwd = stripRedundantWindowsCwdPrefix(command, cwd, environment);
  const normalized = normalizeWindowsShellCommand(withoutRedundantCwd, environment);
  return rewriteWindowsShellIdioms(normalized, environment);
}

export function rejectNativeWindowsUnixSyntax(command: string, environment = detectCommandEnvironment()): string | undefined {
  if (environment.platform !== 'win32' || environment.kind === 'wsl') return undefined;
  const forbidden = [/(?:^|\s)bash\s+-lc\b/i, /\$\(/, /\/dev\/null\b/i, /(?:^|\s)head(?:\s|$)/i, /(?:^|\s)test\s+-f\b/i];
  const match = forbidden.find((pattern) => pattern.test(command));
  return match ? `Native Windows command rejected: Unix-only syntax "${match.source}" requires an explicitly available Bash or WSL profile.` : undefined;
}

export function stripRedundantWindowsCwdPrefix(command: string, cwd: string, environment = detectCommandEnvironment()): string {
  if (environment.platform !== 'win32' || environment.kind === 'wsl') return command;
  const match = command.match(/^\s*cd(?:\s+\/d)?\s+(?:"([^"]+)"|([^&]+?))\s*&&\s*/i);
  if (!match) return command;
  const requested = (match[1] || match[2] || '').trim();
  if (!requested) return command;
  const requestedPath = path.resolve(cwd, requested).toLowerCase();
  if (requestedPath !== path.resolve(cwd).toLowerCase()) return command;
  return command.slice(match[0].length).trimStart();
}

/**
 * LLM-generated legacy shell commands can occasionally contain one accidental
 * quote at the very end (for example `dir"`). Native cmd.exe treats that as
 * part of the command name, so repair only this unambiguous Windows typo.
 */
export function normalizeWindowsShellCommand(command: string, environment = detectCommandEnvironment()): string {
  if (environment.platform !== 'win32' || environment.kind === 'wsl') return command;

  const trimmed = command.trim();
  const trailing = trimmed.at(-1);
  if (!trailing || !['"', "'", '`'].includes(trailing)) return command;

  const quoteCount = [...trimmed].filter((character) => character === trailing).length;
  if (quoteCount % 2 === 0) return command;

  const repaired = trimmed.slice(0, -1).trimEnd();
  return repaired || command;
}

export function parseDirectWindowsPowerShellCommand(
  command: string,
  environment = detectCommandEnvironment()
): { executable: string; args: string[] } | undefined {
  if (environment.platform !== 'win32' || environment.kind === 'wsl') return undefined;
  const match = command.match(/^\s*(powershell(?:\.exe)?|pwsh(?:\.exe)?)\s+([\s\S]+)$/i);
  if (!match) return undefined;
  const commandIndex = match[2].search(/(?:^|\s)-Command(?:\s|$)/i);
  if (commandIndex < 0) return undefined;
  const before = match[2].slice(0, commandIndex).trim();
  const commandToken = match[2].slice(commandIndex).trimStart().match(/^-Command\s+([\s\S]+)$/i);
  if (!commandToken) return undefined;
  let script = commandToken[1].trim();
  if (script.length >= 2 && script.startsWith('"') && script.endsWith('"')) {
    script = script.slice(1, -1);
  }
  if (!script) return undefined;
  const prefixArgs = before ? before.split(/\s+/).filter(Boolean) : [];
  return {
    executable: match[1],
    args: [...prefixArgs, '-Command', script],
  };
}

function redactCommandOutput(value: string): string {
  return value
    .replace(/((?:api[_-]?key|authorization|token|password|secret)\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/\b(?:sk|pk)_[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]');
}

async function persistLargeCommandOutput(workspace: string, stdout: string, stderr: string): Promise<CommandResult['outputArtifact']> {
  const raw = `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`;
  if (Buffer.byteLength(raw) <= OUTPUT_PREVIEW_BYTES) return undefined;
  const redacted = redactCommandOutput(raw);
  const dir = path.join(workspace, '.react-engine', 'command-output');
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, `${Date.now()}-${randomUUID()}.log`);
  await writeFile(target, redacted, 'utf8');
  return { path: target, sha256: createHash('sha256').update(redacted).digest('hex'), bytes: Buffer.byteLength(redacted), redacted: redacted !== raw };
}

export async function detectPackageManager(workspace: string, environment = detectCommandEnvironment()): Promise<PackageManagerResolution> {
  const root = path.resolve(workspace);
  let packageManagerField = '';
  try {
    const parsed = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { packageManager?: unknown };
    packageManagerField = typeof parsed.packageManager === 'string' ? parsed.packageManager : '';
  } catch { /* caller reports a missing package file where required */ }
  const declared = packageManagerField.split('@', 1)[0];
  const fromDeclaration = declared === 'npm' || declared === 'yarn' || declared === 'pnpm' || declared === 'bun' ? declared : undefined;
  const lockfiles: Array<[PackageManager, string]> = [
    ['bun', 'bun.lockb'], ['bun', 'bun.lock'], ['pnpm', 'pnpm-lock.yaml'], ['yarn', 'yarn.lock'], ['npm', 'package-lock.json'],
  ];
  const manager = fromDeclaration || (await (async () => {
    for (const [candidate, lockfile] of lockfiles) if (await exists(path.join(root, lockfile))) return candidate;
    return 'npm' as PackageManager;
  })());
  const executable = environment.platform === 'win32' && (manager === 'npm' || manager === 'yarn' || manager === 'pnpm')
    ? `${manager}.cmd`
    : manager;
  return {
    manager,
    executable,
    evidence: fromDeclaration
      ? `package.json packageManager=${packageManagerField}`
      : `detected ${manager} from ${lockfiles.find(([candidate]) => candidate === manager)?.[1] || 'default fallback'}`,
  };
}

export async function discoverProjectCommand(
  operation: Extract<CommandOperation, 'smoke' | 'test' | 'build' | 'lint' | 'typecheck'>,
  workspace: string,
  environment = detectCommandEnvironment(),
): Promise<DiscoveredProjectCommand | undefined> {
  const cwd = path.resolve(workspace);
  try {
    const parsed = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> };
    const scripts = parsed.scripts || {};
    const candidates = operation === 'test'
      ? ['test', 'test:unit']
      : operation === 'smoke'
      ? ['smoke', 'test:smoke', 'smoke:test']
      : [operation];
    const script = candidates.find((name) => typeof scripts[name] === 'string');
    if (!script) return undefined;
    return { operation, script, scriptCommand: scripts[script] as string, manager: await detectPackageManager(cwd, environment), source: 'package.json', cwd };
  } catch {
    return undefined;
  }
}

async function packageJsonParseError(packagePath: string): Promise<string | undefined> {
  try {
    JSON.parse(await readFile(packagePath, 'utf8'));
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function resolveUnixShell(env = process.env): string {
  if (env.SHELL && env.SHELL.startsWith('/') && existsSync(env.SHELL)) return env.SHELL;
  for (const candidate of ['/bin/sh', '/bin/bash', '/usr/bin/sh', '/usr/bin/bash']) {
    if (existsSync(candidate)) return candidate;
  }
  return '/bin/sh';
}

function verificationArgsForCommand(command: DiscoveredProjectCommand, args: string[] = []): string[] {
  if (command.operation !== 'test' && command.operation !== 'smoke') return args;

  const forwarded = [...args];
  if (/\bvitest(?:\.cmd)?\b/i.test(command.scriptCommand) && !forwarded.some((arg) => /^--run(?:=true)?$/i.test(arg))) {
    return [...forwarded.filter((arg) => !/^--watch(?:=true)?$/i.test(arg)), '--run'];
  }
  if (/\bjest(?:\.cmd)?\b/i.test(command.scriptCommand) && /\s--watch(?:All)?(?:=true)?(?:\s|$)/i.test(command.scriptCommand) &&
      !forwarded.some((arg) => /^--watch=false$/i.test(arg))) {
    return [...forwarded, '--watch=false'];
  }
  return forwarded;
}

function packageScriptArgs(command: DiscoveredProjectCommand, args: string[] = []): string[] {
  const forwarded = verificationArgsForCommand(command, args);
  return forwarded.length ? ['--', ...forwarded] : [];
}

export function normalizeNonInteractiveVerificationCommand(command: string, scriptCommand?: string): string {
  const isVitest = /\bvitest(?:\.cmd)?\b/i.test(command) || /\bvitest(?:\.cmd)?\b/i.test(scriptCommand || '');
  if (!isVitest || /(?:^|\s)--run(?:=true)?(?:\s|$)/i.test(command)) return command;

  const withoutWatch = command.replace(/\s--watch(?:=true)?(?=\s|$)/gi, '').trimEnd();
  const isPackageScriptInvocation = /\b(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?(?:test(?::[\w.-]+)?|smoke)(?:\s|$)/i.test(command);
  return `${withoutWatch}${isPackageScriptInvocation ? ' -- --run' : ' --run'}`;
}

export async function normalizeVerificationShellCommand(command: string, workspace: string): Promise<string> {
  const direct = normalizeNonInteractiveVerificationCommand(command);
  if (direct !== command) return direct;

  const match = command.match(/\b(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?((?:test(?::[\w.-]+)?)|smoke)(?:\s|$)/i);
  if (!match) return command;
  try {
    const parsed = JSON.parse(await readFile(path.join(path.resolve(workspace), 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> };
    const scriptCommand = parsed.scripts?.[match[1]];
    return typeof scriptCommand === 'string'
      ? normalizeNonInteractiveVerificationCommand(command, scriptCommand)
      : command;
  } catch {
    return command;
  }
}

export async function resolveCommandOperation(request: CommandRequest): Promise<CommandInvocation | CommandResult> {
  const environment = detectCommandEnvironment(request.platform, request.processEnv);
  const cwd = path.resolve(request.workspace);
  const packagePath = path.join(cwd, 'package.json');
  const unavailable = (error: string): CommandResult => ({
    status: 'unavailable', operation: request.operation, args: [], cwd, stdout: '', stderr: '', durationMs: 0,
    outputTruncated: false, outputBytes: 0, error,
  });
  const noGitRepository = (): CommandResult => ({
    status: 'passed', operation: request.operation, args: [], cwd,
    stdout: `No Git repository was detected in ${cwd}. Continuing without Git dirty-state evidence.`,
    stderr: '', durationMs: 0, outputTruncated: false, outputBytes: 0,
  });

  if (environment.kind === 'unknown') return unavailable(environment.evidence[0]);
  const args = request.args || [];
  switch (request.operation) {
    case 'git_status':
      return await exists(path.join(cwd, '.git')) ? { executable: 'git', args: ['status', '--short', ...args], cwd, environment } : noGitRepository();
    case 'git_diff':
      return await exists(path.join(cwd, '.git')) ? { executable: 'git', args: ['diff', '--', ...args], cwd, environment } : noGitRepository();
    case 'git_log':
      return await exists(path.join(cwd, '.git')) ? { executable: 'git', args: ['log', '--oneline', '-n', '20', ...args], cwd, environment } : noGitRepository();
    case 'file_exists':
      if (!args[0]) return unavailable('file_exists requires a relative path argument');
      return { executable: process.execPath, args: ['-e', `require('fs').accessSync(${JSON.stringify(args[0])})`], cwd, environment };
    case 'list_directory':
      return { executable: process.execPath, args: ['-e', `require('fs').readdirSync(${JSON.stringify(args[0] || '.')}).forEach(x => console.log(x))`], cwd, environment };
    case 'process_inspect':
      if (environment.platform === 'win32' && args.length > 0 && !args[0].startsWith('/')) {
        return unavailable(
          'process_inspect accepts only tasklist.exe options on Windows; it cannot execute a command. Use the shell tool for commands such as "python --version".'
        );
      }
      return environment.platform === 'win32'
        ? { executable: 'tasklist.exe', args, cwd, environment }
        : { executable: 'ps', args: args.length ? args : ['-eo', 'pid,ppid,command'], cwd, environment };
    case 'verify': {
      if (await exists(packagePath)) {
        const packageError = await packageJsonParseError(packagePath);
        if (packageError) return unavailable(`Invalid package.json in ${cwd}: ${packageError}`);
        for (const operation of ['test', 'smoke', 'build', 'typecheck', 'lint'] as const) {
          const command = await discoverProjectCommand(operation, cwd, environment);
          // `verify` selects the project's own verification command. Planner-supplied
          // prose is not a CLI argument (for example, an acceptance criterion such as
          // "README contains run instructions"). Targeted CLI arguments belong on the
          // explicit test/build/lint/typecheck operations instead.
          if (command) return {
            executable: command.manager.executable,
            args: ['run', command.script, ...packageScriptArgs(command)],
            cwd,
            environment,
          };
        }
        return unavailable(`No verification script found in ${packagePath}`);
      }
      if (await exists(path.join(cwd, 'Cargo.toml'))) return { executable: 'cargo', args: ['test', ...args], cwd, environment };
      if (await exists(path.join(cwd, 'go.mod'))) return { executable: 'go', args: ['test', './...', ...args], cwd, environment };
      if (await exists(path.join(cwd, 'pyproject.toml')) || await exists(path.join(cwd, 'pytest.ini')) || await exists(path.join(cwd, 'setup.py'))) {
        return { executable: environment.platform === 'win32' ? 'python.exe' : 'python3', args: ['-m', 'pytest', ...args], cwd, environment };
      }
      if (await exists(path.join(cwd, 'pom.xml'))) return { executable: environment.platform === 'win32' ? 'mvn.cmd' : 'mvn', args: ['test', ...args], cwd, environment };
      if (await exists(path.join(cwd, 'gradlew')) || await exists(path.join(cwd, 'gradlew.bat'))) {
        return { executable: environment.platform === 'win32' ? path.join(cwd, 'gradlew.bat') : path.join(cwd, 'gradlew'), args: ['test', ...args], cwd, environment };
      }
      const rootFiles = await import('fs/promises').then(({ readdir }) => readdir(cwd)).catch(() => [] as string[]);
      if (rootFiles.some((file) => /\.(sln|csproj)$/i.test(file))) return { executable: 'dotnet', args: ['test', ...args], cwd, environment };
      if (rootFiles.some((file) => /\.html?$/i.test(file))) {
        const script = [
          "const fs=require('fs')",
          "const files=fs.readdirSync('.').filter(f=>/\\.html?$/i.test(f))",
          "const bad=[]",
          // HTML5 permits the html/head/body end tags to be omitted. Use the
          // browser-compatible document markers here and leave full parsing
          // to the browser verification stage.
          "for(const f of files){const s=fs.readFileSync(f,'utf8');if(!/<!doctype\\s+html\\b|<html(?:\\s|>)|<(?:head|body|title|meta|script|style|canvas)(?:\\s|>)/i.test(s))bad.push(f)}",
          "if(bad.length){console.error('Invalid HTML document: '+bad.join(', ')+' (expected an HTML doctype or document element)');process.exit(1)}",
          "console.log('Static HTML verification passed: '+files.join(', '))",
        ].join(';');
        return { executable: process.execPath, args: ['-e', script, ...args], cwd, environment };
      }
      return unavailable(`No supported project manifest or root HTML file found in ${cwd}`);
    }
    case 'smoke': case 'test': case 'build': case 'lint': case 'typecheck': {
      if (!await exists(packagePath)) return unavailable(`package.json not found in ${cwd}`);
      const packageError = await packageJsonParseError(packagePath);
      if (packageError) return unavailable(`Invalid package.json in ${cwd}: ${packageError}`);
      const command = await discoverProjectCommand(request.operation, cwd, environment);
      if (!command) return unavailable(`No ${request.operation} script found in ${packagePath}`);
      return {
        executable: command.manager.executable,
        args: ['run', command.script, ...packageScriptArgs(command, args)],
        cwd,
        environment,
      };
    }
  }
}

function truncate(value: string): { value: string; truncated: boolean } {
  const bytes = Buffer.byteLength(value);
  if (bytes <= OUTPUT_PREVIEW_BYTES) return { value, truncated: false };
  return { value: Buffer.from(value).subarray(0, OUTPUT_PREVIEW_BYTES).toString('utf8'), truncated: true };
}

function terminateProcessTree(child: ChildProcessWithoutNullStreams, platform: NodeJS.Platform): Promise<boolean> {
  if (!child.pid) return Promise.resolve(false);
  if (platform === 'win32') {
    return new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.once('error', () => { child.kill(); resolve(false); });
      killer.once('close', (code) => { if (code !== 0) child.kill(); resolve(code === 0); });
    });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); return Promise.resolve(true); } catch { child.kill('SIGTERM'); return Promise.resolve(false); }
  }
}

export async function executeCommandInvocation(
  invocation: CommandInvocation,
  operation: CommandOperation | 'shell',
  timeoutMs = 30_000,
  signal?: AbortSignal,
): Promise<CommandResult> {
  const started = Date.now();
  if (signal?.aborted) return { status: 'cancelled', operation, executable: invocation.executable, args: invocation.args, cwd: invocation.cwd, stdout: '', stderr: '', durationMs: 0, outputTruncated: false, outputBytes: 0, error: 'Cancelled before process start' };

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let terminalStatus: CommandStatus | undefined;
    let terminationRequested = false;
    let terminationPromise: Promise<boolean> | undefined;
    const isWindowsScript = invocation.environment.platform === 'win32' && /\.(?:cmd|bat)$/i.test(invocation.executable);
    const cmdQuote = (value: string) => /^[A-Za-z0-9_./:\\=@+-]+$/.test(value)
      ? value
      : `"${value.replace(/"/g, '""')}"`;
    const spawnExecutable = isWindowsScript ? invocation.environment.shell : invocation.executable;
    const spawnArgs = isWindowsScript
      ? ['/d', '/s', '/c', [invocation.executable, ...invocation.args].map(cmdQuote).join(' ')]
      : invocation.args;
    const child = spawn(spawnExecutable, spawnArgs, {
      cwd: invocation.cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
      shell: false,
      windowsVerbatimArguments: isWindowsScript,
      detached: invocation.environment.platform !== 'win32',
      windowsHide: true,
    });
    const finish = async (status: CommandStatus, exitCode?: number, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      const rawBytes = Buffer.byteLength(stdout) + Buffer.byteLength(stderr);
      const out = truncate(stdout);
      const err = truncate(stderr);
      let outputArtifact: CommandResult['outputArtifact'];
      try { outputArtifact = await persistLargeCommandOutput(invocation.cwd, stdout, stderr); } catch { /* artifact persistence must not change command status */ }
      const terminationConfirmed = terminationPromise ? await terminationPromise : false;
      resolve({ status, operation, executable: invocation.executable, args: invocation.args, cwd: invocation.cwd, stdout: out.value, stderr: err.value, exitCode, durationMs: Date.now() - started, outputTruncated: out.truncated || err.truncated, outputBytes: rawBytes, error, outputArtifact, termination: terminationRequested ? { requested: true, tree: true, confirmed: terminationConfirmed } : undefined });
    };
    const terminate = (status: 'cancelled' | 'timed_out') => {
      if (terminationRequested) return;
      terminalStatus = status;
      terminationRequested = true;
      terminationPromise = terminateProcessTree(child, invocation.environment.platform);
    };
    const abort = () => terminate('cancelled');
    const timer = setTimeout(() => terminate('timed_out'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' && invocation.environment.platform !== 'win32' && spawnExecutable !== '/bin/sh') {
        try {
          const fallbackChild = spawn('/bin/sh', spawnArgs, {
            cwd: invocation.cwd,
            env: { ...process.env, TERM: 'xterm-256color' },
            shell: false,
            detached: true,
            windowsHide: true,
          });
          fallbackChild.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
          fallbackChild.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
          fallbackChild.on('error', (fallbackError) => finish('unavailable', undefined, fallbackError.message));
          fallbackChild.on('close', (code) => finish(terminalStatus || (code === 0 ? 'passed' : 'failed'), code ?? undefined));
          return;
        } catch {
          // Fall through to the standard error result.
        }
      }
      finish(error.code === 'ENOENT' ? 'unavailable' : 'failed', undefined, error.message);
    });
    child.on('close', (exitCode) => finish(terminalStatus || (exitCode === 0 ? 'passed' : 'failed'), exitCode ?? undefined));
  });
}

/** Legacy free-form shell compatibility. Structured operations should use resolveCommandOperation instead. */
export async function executeLegacyShell(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<CommandResult> {
  const environment = detectCommandEnvironment();
  if (environment.kind === 'unknown') return { status: 'unavailable', operation: 'shell', args: [], cwd, stdout: '', stderr: '', durationMs: 0, outputTruncated: false, outputBytes: 0, error: environment.evidence[0] };
  const normalizedCommand = normalizeLegacyShellCommand(command, cwd, environment);
  const rejection = rejectNativeWindowsUnixSyntax(normalizedCommand, environment);
  if (rejection) return { status: 'unavailable', operation: 'shell', args: [], cwd, stdout: '', stderr: '', durationMs: 0, outputTruncated: false, outputBytes: 0, error: rejection };
  const directPowerShell = parseDirectWindowsPowerShellCommand(normalizedCommand, environment);
  if (directPowerShell) {
    return executeCommandInvocation({
      executable: directPowerShell.executable,
      args: directPowerShell.args,
      cwd,
      environment,
    }, 'shell', timeoutMs, signal);
  }
  const shellArgs = environment.platform === 'win32' ? ['/d', '/c', normalizedCommand] : ['-c', normalizedCommand];
  return executeCommandInvocation({ executable: environment.shell, args: shellArgs, cwd, environment }, 'shell', timeoutMs, signal);
}
