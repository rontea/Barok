/** Structural action contract shared by the ReAct loop and host tool adapters. */
export interface ToolAction {
  action: string;
  action_input: Record<string, unknown>;
}

/** Source documents are readable with DocumentRead, but text editors must not mutate them. */
export function isReadOnlySourceDocumentMutation(
  action: Pick<ToolAction, 'action' | 'action_input'>,
): boolean {
  if (action.action !== 'Write' && action.action !== 'Edit') return false;
  const filePath = action.action_input?.file_path ?? action.action_input?.path ??
    action.action_input?.filename ?? action.action_input?.file;
  if (typeof filePath !== 'string') return false;

  const fileName = filePath.trim().replace(/\\/g, '/').split('/').pop() || '';
  return /.+\.(?:pdf|docx)$/i.test(fileName);
}
