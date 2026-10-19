/** Structural token for a host-provided workspace scoped to one task run. */
export interface RunScopedWorkspaceCapability {
  readonly runId: string;
  readonly root: string;
  readonly taskScoped: true;
}
