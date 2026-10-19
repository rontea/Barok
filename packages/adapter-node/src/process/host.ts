/** Read one host environment setting without exposing process to shared code. */
export function getEnvironmentVariable(name: string): string | undefined {
  return process.env[name];
}

/** Return the current process working directory. */
export function getWorkingDirectory(): string {
  return process.cwd();
}
