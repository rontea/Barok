/** Prompt guidance for tools that execute commands on the host platform. */
export function formatPlatformShellInstruction(platform: string): string {
  return platform === 'win32'
    ? 'PLATFORM: Windows (win32). Shell commands run under cmd.exe or PowerShell. Do not use Unix-only syntax: in cmd.exe use "NUL" instead of "/dev/null" and "dir /a" instead of "ls -la"; in PowerShell use native cmdlets such as "Get-ChildItem -Force". Do not use "$()", "head", or Bash pipelines. Prefer Command or platform-neutral tools when inspecting files.'
    : '';
}
