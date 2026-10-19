import { existsSync } from 'fs';
import { mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  detectCommandEnvironment,
  detectPackageManager,
  discoverProjectCommand,
  executeCommandInvocation,
  executeLegacyShell,
  normalizeNonInteractiveVerificationCommand,
  normalizeLegacyShellCommand,
  normalizeVerificationShellCommand,
  normalizeWindowsShellCommand,
  probeCommandPlatformProfile,
  parseDirectWindowsPowerShellCommand,
  rejectNativeWindowsUnixSyntax,
  resolveCommandOperation,
  rewriteWindowsShellIdioms,
  stripRedundantWindowsCwdPrefix,
} from '../commandRuntime';

describe('commandRuntime', () => {
  it.each([
    ['win32' as NodeJS.Platform, { ComSpec: 'cmd.exe' }, 'windows'],
    ['win32' as NodeJS.Platform, { ComSpec: 'cmd.exe', WSL_DISTRO_NAME: 'Ubuntu' }, 'wsl'],
    ['darwin' as NodeJS.Platform, { SHELL: '/bin/zsh' }, 'macos'],
    ['linux' as NodeJS.Platform, { SHELL: '/bin/bash' }, 'linux'],
  ])('builds an explicit executable profile for %s/%s', async (platform, env, kind) => {
    const environment = detectCommandEnvironment(platform, env);
    const profile = await probeCommandPlatformProfile(environment, async (executable) => executable !== 'bash');
    expect(profile.kind).toBe(kind);
    expect(profile.requiredExecutables.length).toBeGreaterThan(0);
    expect(profile.evidence.some((line) => /=(available|unavailable)$/.test(line))).toBe(true);
  });
  it('selects Windows launchers without assuming Bash', () => {
    const environment = detectCommandEnvironment('win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' });

    expect(environment.kind).toBe('windows');
    expect(environment.npmExecutable).toBe('npm.cmd');
    expect(environment.shell).toContain('cmd.exe');
  });

  it('rewrites common Unix shell idioms to native Windows syntax', () => {
    const environment = detectCommandEnvironment('win32', { ComSpec: 'cmd.exe' });
    expect(rewriteWindowsShellIdioms('npm test > /dev/null 2>&1', environment)).toBe('npm test > NUL 2>&1');
    expect(rewriteWindowsShellIdioms('git status >/dev/null', environment)).toBe('git status > NUL');
    expect(rewriteWindowsShellIdioms('cat file 2>/dev/null', environment)).toBe('cat file 2> NUL');
    expect(rewriteWindowsShellIdioms('echo hi > /dev/null', environment)).toBe('echo hi > NUL');
    expect(rewriteWindowsShellIdioms('ls -la', environment)).toBe('dir /a');
    expect(rewriteWindowsShellIdioms('npm test && ls -al src', environment)).toBe('npm test && dir /a src');
    expect(rewriteWindowsShellIdioms('echo "ls -la"', environment)).toBe('echo "ls -la"');
  });

  it('rewrites redirected commands before native Windows syntax rejection', () => {
    const environment = detectCommandEnvironment('win32', { ComSpec: 'cmd.exe' });
    const normalized = normalizeLegacyShellCommand('npm test > /dev/null 2>&1', 'C:\\workspace', environment);
    const directoryListing = normalizeLegacyShellCommand('ls -la', 'C:\\workspace', environment);

    expect(normalized).toBe('npm test > NUL 2>&1');
    expect(rejectNativeWindowsUnixSyntax(normalized, environment)).toBeUndefined();
    expect(directoryListing).toBe('dir /a');
    expect(rejectNativeWindowsUnixSyntax(directoryListing, environment)).toBeUndefined();
  });

  it('leaves Unix and WSL shell idioms unchanged', () => {
    const linux = detectCommandEnvironment('linux', { SHELL: '/bin/bash' });
    const wsl = detectCommandEnvironment('win32', { ComSpec: 'cmd.exe', WSL_DISTRO_NAME: 'Ubuntu' });

    expect(rewriteWindowsShellIdioms('ls -la && echo > /dev/null', linux)).toBe('ls -la && echo > /dev/null');
    expect(rewriteWindowsShellIdioms('ls -la && echo > /dev/null', wsl)).toBe('ls -la && echo > /dev/null');
  });

  it.each(['bash -lc "echo hi"', 'echo $(whoami)', 'head -n 1 file.txt', 'test -f package.json', 'echo > /dev/null'])(
    'rejects native Windows Unix-only syntax: %s',
    (command) => {
      const environment = detectCommandEnvironment('win32', { ComSpec: 'cmd.exe' });
      expect(rejectNativeWindowsUnixSyntax(command, environment)).toContain('Native Windows command rejected');
    },
  );

  it('keeps Git invocations as executable plus argv', async () => {
    const result = await resolveCommandOperation({ operation: 'git_status', workspace: process.cwd() });

    expect('executable' in result && result.executable).toBe('git');
    expect('args' in result && result.args).toEqual(['status', '--short']);
  });

  it('treats Git inspection as a successful no-op outside a repository', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'command-runtime-gitless-'));
    const result = await resolveCommandOperation({ operation: 'git_status', workspace });

    expect('status' in result && result.status).toBe('passed');
    expect('stdout' in result && result.stdout).toContain('No Git repository was detected');
  });

  it('removes a redundant Windows cd prefix when cwd already selects the workspace', () => {
    const cwd = 'C:\\MPC Project Test\\test 2';
    const environment = detectCommandEnvironment('win32', { ComSpec: 'cmd.exe' });
    const command = `cd /d "${cwd}" && node extract.js`;

    expect(stripRedundantWindowsCwdPrefix(command, cwd, environment)).toBe('node extract.js');
  });

  it('repairs one accidental trailing quote in native Windows shell commands', () => {
    const windows = detectCommandEnvironment('win32', { ComSpec: 'cmd.exe' });
    const linux = detectCommandEnvironment('linux', { SHELL: '/bin/bash' });

    expect(normalizeWindowsShellCommand('dir"', windows)).toBe('dir');
    expect(normalizeWindowsShellCommand('dir "src folder"', windows)).toBe('dir "src folder"');
    expect(normalizeWindowsShellCommand('dir', windows)).toBe('dir');
    expect(normalizeWindowsShellCommand('dir"', linux)).toBe('dir"');
  });

  it('executes a directory probe after repairing a trailing quote on Windows', async () => {
    if (process.platform !== 'win32') return;

    const result = await executeLegacyShell('dir"', process.cwd(), 10_000);

    expect(result.status).toBe('passed');
  });

  (process.platform === 'win32' ? it : it.skip)('executes rewritten Unix shell idioms on native Windows', async () => {
    const listing = await executeLegacyShell('ls -la', process.cwd(), 10_000);
    const redirected = await executeLegacyShell('echo ok > /dev/null 2>&1', process.cwd(), 10_000);

    expect(listing.status).toBe('passed');
    expect(redirected.status).toBe('passed');
  });

  it('routes nested PowerShell directly so dollar-prefixed variables are preserved', () => {
    const environment = detectCommandEnvironment('win32', { ComSpec: 'cmd.exe' });
    const parsed = parseDirectWindowsPowerShellCommand(
      'powershell -NoProfile -Command "$s = Get-Content -Raw -LiteralPath \'index.html\'; Write-Output $s.Length"',
      environment,
    );

    expect(parsed).toEqual({
      executable: 'powershell',
      args: ['-NoProfile', '-Command', "$s = Get-Content -Raw -LiteralPath 'index.html'; Write-Output $s.Length"],
    });
  });

  it('executes nested PowerShell without stripping variables on Windows', async () => {
    if (process.platform !== 'win32') return;

    const result = await executeLegacyShell(
      'powershell -NoProfile -Command "$s = \'preserved\'; Write-Output $s"',
      process.cwd(),
      10_000,
    );

    expect(result.status).toBe('passed');
    expect(result.stdout.trim()).toBe('preserved');
  });

  it('rejects commands accidentally routed through Windows process inspection', async () => {
    const result = await resolveCommandOperation({
      operation: 'process_inspect',
      workspace: process.cwd(),
      platform: 'win32',
      processEnv: { ComSpec: 'cmd.exe' },
      args: ['python', '--version'],
    });

    expect('status' in result && result.status).toBe('unavailable');
    expect('error' in result && result.error).toContain('cannot execute a command');
  });

  it('keeps native tasklist filters for Windows process inspection', async () => {
    const result = await resolveCommandOperation({
      operation: 'process_inspect',
      workspace: process.cwd(),
      platform: 'win32',
      processEnv: { ComSpec: 'cmd.exe' },
      args: ['/FI', 'IMAGENAME eq node.exe'],
    });

    expect('executable' in result && result.executable).toBe('tasklist.exe');
    expect('args' in result && result.args).toEqual(['/FI', 'IMAGENAME eq node.exe']);
  });

  it('reports a missing package file as unavailable', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'command-runtime-no-package-'));
    const result = await resolveCommandOperation({ operation: 'test', workspace });

    expect('status' in result && result.status).toBe('unavailable');
    expect('error' in result && result.error).toContain('package.json not found');
  });

  it('verifies a plain static HTML workspace without npm', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'command-runtime-static-html-'));
    await writeFile(path.join(workspace, 'index.html'), '<!doctype html><html><body>Hello</body></html>');

    const resolved = await resolveCommandOperation({ operation: 'verify', workspace });

    expect('executable' in resolved && resolved.executable).toBe(process.execPath);
    expect('args' in resolved && resolved.args[0]).toBe('-e');
    const result = 'executable' in resolved
      ? await executeCommandInvocation(resolved, 'verify')
      : resolved;
    expect(result.status).toBe('passed');
    expect(result.stdout).toContain('Static HTML verification passed: index.html');
  });

  it('accepts HTML5 documents that omit the optional closing html tag', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'command-runtime-static-html5-'));
    await writeFile(path.join(workspace, 'index.html'), '<!doctype html><html><head><title>Hello</title></head><body><canvas></canvas></body>');

    const resolved = await resolveCommandOperation({ operation: 'verify', workspace });
    const result = 'executable' in resolved
      ? await executeCommandInvocation(resolved, 'verify')
      : resolved;

    expect(result.status).toBe('passed');
    expect(result.stdout).toContain('Static HTML verification passed: index.html');
  });

  it('rejects a root file that has no HTML document markers', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'command-runtime-invalid-html-'));
    await writeFile(path.join(workspace, 'index.html'), 'This is not an HTML document.');

    const resolved = await resolveCommandOperation({ operation: 'verify', workspace });
    const result = 'executable' in resolved
      ? await executeCommandInvocation(resolved, 'verify')
      : resolved;

    expect(result.status).toBe('failed');
    expect(result.stderr).toContain('Invalid HTML document: index.html');
  });

  it('does not forward acceptance-criterion prose to the discovered verify script', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'command-runtime-verify-args-'));
    await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'tsc' } }));

    const resolved = await resolveCommandOperation({
      operation: 'verify',
      workspace,
      args: ['README.md contains documentation on how to run the application'],
    });

    expect('args' in resolved && resolved.args).toEqual(['run', 'build']);
  });

  (process.platform === 'win32' ? it : it.skip)('executes Windows package-manager launchers through cmd.exe', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'command-runtime-windows-launcher-'));
    const environment = detectCommandEnvironment();
    const result = await executeCommandInvocation({
      executable: 'npm.cmd',
      args: ['--version'],
      cwd: workspace,
      environment,
    }, 'verify');

    expect(result.status).toBe('passed');
    expect(result.stdout.trim()).toMatch(/^\d+\./);
  });

  it('uses the declared package manager and its native Windows launcher', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'command-runtime-pnpm-'));
    await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ packageManager: 'pnpm@9.0.0' }));
    const environment = detectCommandEnvironment('win32', { ComSpec: 'cmd.exe' });

    const manager = await detectPackageManager(workspace, environment);

    expect(manager.manager).toBe('pnpm');
    expect(manager.executable).toBe('pnpm.cmd');
    expect(manager.evidence).toContain('packageManager');
  });

  it('uses lockfile discovery and resolves the actual project script', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'command-runtime-script-'));
    await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { 'test:unit': 'jest' } }));
    await writeFile(path.join(workspace, 'yarn.lock'), 'lockfile v1');

    const command = await discoverProjectCommand('test', workspace);
    const resolved = await resolveCommandOperation({ operation: 'test', workspace });

    expect(command?.script).toBe('test:unit');
    expect(command?.manager.manager).toBe('yarn');
    expect('executable' in resolved && resolved.executable).toBe(process.platform === 'win32' ? 'yarn.cmd' : 'yarn');
    expect('args' in resolved && resolved.args).toEqual(['run', 'test:unit']);
  });

  it('resolves the target workspace smoke script without using a repository-level path', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'command-runtime-smoke-'));
    await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { smoke: 'node smoke.mjs' } }));

    const command = await discoverProjectCommand('smoke', workspace);
    const resolved = await resolveCommandOperation({ operation: 'smoke', workspace });

    expect(command?.script).toBe('smoke');
    expect('executable' in resolved && resolved.executable).toBe(process.platform === 'win32' ? 'npm.cmd' : 'npm');
    expect('args' in resolved && resolved.args).toEqual(['run', 'smoke']);
  });

  it('forces Vitest verification into non-watch run mode', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'command-runtime-vitest-run-'));
    await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }));

    const resolved = await resolveCommandOperation({ operation: 'verify', workspace });

    expect('args' in resolved && resolved.args).toEqual(['run', 'test', '--', '--run']);
  });

  it('normalizes raw Vitest and package-script verification commands', async () => {
    expect(normalizeNonInteractiveVerificationCommand('vitest --watch')).toBe('vitest --run');
    expect(normalizeNonInteractiveVerificationCommand('npm test', 'vitest')).toBe('npm test -- --run');

    const workspace = await mkdtemp(path.join(tmpdir(), 'command-runtime-shell-vitest-'));
    await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }));
    await expect(normalizeVerificationShellCommand('npm test', workspace)).resolves.toBe('npm test -- --run');
  });

  it('forwards explicit test arguments after the package script separator', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'command-runtime-test-args-'));
    await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));

    const resolved = await resolveCommandOperation({ operation: 'test', workspace, args: ['--runInBand'] });

    expect('args' in resolved && resolved.args).toEqual(['run', 'test', '--', '--runInBand']);
  });

  it('marks a missing requested script unavailable instead of running a no-op', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'command-runtime-no-script-'));
    await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .' } }));

    const result = await resolveCommandOperation({ operation: 'build', workspace });

    expect('status' in result && result.status).toBe('unavailable');
    expect('error' in result && result.error).toContain('No build script');
  });

  it('reports malformed package metadata instead of mislabeling scripts as missing', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'command-runtime-invalid-package-'));
    await writeFile(path.join(workspace, 'package.json'), '{\\n  "scripts": { "build": "vite build" }\\n}');

    const result = await resolveCommandOperation({ operation: 'build', workspace });

    expect('status' in result && result.status).toBe('unavailable');
    expect('error' in result && result.error).toMatch(/Invalid package\.json/);
  });

  it('returns separate stdout, stderr, and a passed status', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'command-runtime-output-'));
    const environment = detectCommandEnvironment();
    const result = await executeCommandInvocation({
      executable: process.execPath,
      args: ['-e', "console.log('out'); console.error('err')"],
      cwd: workspace,
      environment,
    }, 'shell');

    expect(result.status).toBe('passed');
    expect(result.stdout).toContain('out');
    expect(result.stderr).toContain('err');
    expect(result.exitCode).toBe(0);
  });

  it('returns timed_out rather than failed when the deadline expires', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'command-runtime-timeout-'));
    const environment = detectCommandEnvironment();
    const result = await executeCommandInvocation({
      executable: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: workspace,
      environment,
    }, 'shell', 50);

    expect(result.status).toBe('timed_out');
    expect(result.termination).toEqual({ requested: true, tree: true, confirmed: expect.any(Boolean) });
  });

  it('externalizes and redacts large command output', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'command-runtime-artifact-'));
    const environment = detectCommandEnvironment();
    const result = await executeCommandInvocation({
      executable: process.execPath,
      args: ['-e', "process.stdout.write('token=sk_abcdefghijklmnop '.repeat(5000))"],
      cwd: workspace,
      environment,
    }, 'shell');

    expect(result.status).toBe('passed');
    expect(result.outputTruncated).toBe(true);
    expect(result.outputArtifact?.path).toContain('.react-engine');
    const stored = await readFile(result.outputArtifact!.path, 'utf8');
    expect(stored).toContain('[REDACTED]');
    expect(stored).not.toContain('sk_abcdefghijklmnop');
  });

  it('returns cancelled when an abort signal terminates the command', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'command-runtime-cancel-'));
    const environment = detectCommandEnvironment();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const result = await executeCommandInvocation({
      executable: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: workspace,
      environment,
    }, 'shell', 5_000, controller.signal);

    expect(result.status).toBe('cancelled');
  });

  it.each(['timed_out', 'cancelled'] as const)('cleans up a spawned child process on %s', async (mode) => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'command-runtime-tree-'));
    const pidPath = path.join(workspace, 'child.pid');
    const parentScript = [
      "const { spawn } = require('child_process');",
      "const fs = require('fs');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      'child.unref();',
      'fs.writeFileSync(process.argv[1], String(child.pid));',
      'setInterval(() => {}, 1000);',
    ].join(' ');
    const controller = new AbortController();
    if (mode === 'cancelled') setTimeout(() => controller.abort(), 150);
    const result = await executeCommandInvocation({
      executable: process.execPath,
      args: ['-e', parentScript, pidPath],
      cwd: workspace,
      environment: detectCommandEnvironment(),
    }, 'shell', mode === 'timed_out' ? 150 : 5_000, controller.signal);

    for (let index = 0; index < 30 && !existsSync(pidPath); index += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    const pid = Number(await readFile(pidPath, 'utf8'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    if (alive) process.kill(pid, 'SIGKILL');
    expect(result.status).toBe(mode);
    expect(result.termination).toMatchObject({ requested: true, tree: true });
    expect(alive).toBe(false);
  });
});
