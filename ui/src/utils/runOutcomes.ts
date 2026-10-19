export const auditStepFailed = (value?: string) => {
  if (!value) return false;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && 'success' in parsed) {
      return (parsed as { success?: unknown }).success === false;
    }
  } catch {
    // Legacy audit observations are plain text.
  }
  return /success"\s*:\s*false|mutation rejected|guarded mutation rejected|error executing|tool execution failed|\bfailed\b|\berror\b/i.test(value);
};
