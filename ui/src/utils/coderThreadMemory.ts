import type { AgentStreamEvent, CoderThreadMessage } from '../components/CoderChatPanel';

const CODER_CHAT_MEMORY_ITEM_LIMIT = 240;

const MEMORY_STOP_WORDS = new Set(['about', 'after', 'agent', 'and', 'before', 'build', 'change', 'code', 'current', 'file', 'for', 'from', 'have', 'implement', 'into', 'make', 'next', 'please', 'project', 'request', 'that', 'the', 'then', 'this', 'update', 'use', 'with', 'work']);

const textValue = (value: unknown): string => typeof value === 'string' ? value : '';

const messageContent = (message?: Pick<CoderThreadMessage, 'content'> | null): string => textValue(message?.content);

const extractMemoryFilePaths = (...values: Array<string | undefined>) => {
  const matches = values.flatMap(
    (value) => textValue(value).match(/[A-Za-z0-9_.@/-]+\.(?:tsx|ts|jsx|js|json|md|css|html|cjs|mjs|yml|yaml)/g) || []
  );
  return Array.from(new Set(matches.map((match) => match.replace(/^["'`]+|["'`,.]+$/g, ''))));
};

const compactMemoryText = (value: string, limit = CODER_CHAT_MEMORY_ITEM_LIMIT) => {
  const compacted = textValue(value).replace(/\s+/g, ' ').trim();
  return compacted.length > limit ? `${compacted.slice(0, limit - 3)}...` : compacted;
};

const shouldKeepMemoryFilePath = (filePath: string, currentRequest: string) => {
  if (filePath !== 'todo/PERFORMANCE_AND_AGENT_HARDENING_TODO.md') return true;
  return /\b(performance_and_agent_hardening_todo|performance hardening|agent hardening|speed|faster|slow)\b/i.test(currentRequest);
};

const normalizeMemoryPath = (value: string) =>
  value.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();

const isAbsoluteMemoryPath = (value: string) =>
  /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/');

const isMemoryPathInWorkspace = (filePath: string, workspace?: string) => {
  if (!workspace || !isAbsoluteMemoryPath(filePath)) return true;
  const normalizedFile = normalizeMemoryPath(filePath);
  const normalizedWorkspace = normalizeMemoryPath(workspace);
  return normalizedFile === normalizedWorkspace || normalizedFile.startsWith(`${normalizedWorkspace}/`);
};

const scrubOutsideWorkspacePaths = (value: string, workspace?: string) => {
  if (!workspace) return value;
  return value.replace(/[A-Za-z]:\\[^,;\r\n`]+/g, (match) =>
    isMemoryPathInWorkspace(match, workspace) ? match : '[outside-workspace path omitted]'
  );
};

const scrubMemoryText = (value: string, currentRequest: string, workspace?: string) => {
  const workspaceScrubbed = scrubOutsideWorkspacePaths(value, workspace);
  if (shouldKeepMemoryFilePath('todo/PERFORMANCE_AND_AGENT_HARDENING_TODO.md', currentRequest)) return workspaceScrubbed;
  return workspaceScrubbed.replace(/\btodo\/PERFORMANCE_AND_AGENT_HARDENING_TODO\.md\b/g, '[stale performance tracker path omitted]');
};

const significantWords = (value: string) => new Set(
  (value.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [])
    .filter((word) => !MEMORY_STOP_WORDS.has(word))
);

const isContinuationRequest = (value: string) => /\b(continue|resume|same|previous|prior|recent context|this thread|it|that|the (?:app|application|codebase|project|repository|workspace))\b/i.test(value);
const ACTIONABLE_MEMORY_RE = /\b(work on|complete|finish|implement|build|add|create|fix|repair|update|modify|change|edit|write|mark|check|run|verify|inspect|investigate|analy[sz]e)\b/i;
const REPAIR_REQUEST_RE = /\b(?:fix|repair|bug|broken|error|failing|failure|regression|not working|doesn't work|does not work|correct)\b/i;

interface IncrementalRepairEvidence {
  status?: string;
  files: string[];
  failures: string[];
}

const eventFailureText = (event: AgentStreamEvent): string | undefined => {
  switch (event.type) {
    case 'verification_result':
      return event.success ? undefined : event.output || 'verification failed';
    case 'package_install_result':
      return event.success ? undefined : event.output || 'package installation failed';
    case 'command_output':
      return /\b(?:error|failed|failure|exception|traceback|not found|cannot find|does not exist)\b/i.test(event.output)
        ? event.output
        : undefined;
    case 'execution_failed':
    case 'provider_attempt_failed':
    case 'error':
    case 'stopped':
    case 'interrupted':
    case 'killed':
      return event.message;
    case 'tool_result': {
      if (typeof event.result === 'string') {
        return /\b(?:error|failed|failure|exception|not found|does not exist)\b/i.test(event.result)
          ? event.result
          : undefined;
      }
      if (!event.result || typeof event.result !== 'object') return undefined;
      const result = event.result as Record<string, unknown>;
      const status = String(result.status || '').toLowerCase();
      if (result.success === false || /^(?:failed|error|cancelled|timed_out)$/.test(status)) {
        const detail = result.error ?? result.message ?? result.output;
        return typeof detail === 'string' ? detail : `${event.tool} failed`;
      }
      return undefined;
    }
    default:
      return undefined;
  }
};

const incrementalRepairEvidence = (
  thread: CoderThreadMessage[],
  currentRequest: string,
  workspace?: string,
): IncrementalRepairEvidence => {
  const latestRun = [...thread]
    .reverse()
    .find((message) => message.role === 'assistant' && (
      Boolean(message.runId) || Boolean(message.agentEvents?.length) || Boolean(message.filesChanged?.length)
    ));
  if (!latestRun) return { files: [], failures: [] };

  const events = latestRun.agentEvents || [];
  const eventFiles = events.flatMap((event) => {
    if (event.type === 'file_changed') return [event.path];
    if (event.type === 'final') return event.filesChanged || [];
    return [];
  });
  const files = Array.from(new Set([
    ...(latestRun.filesChanged || []),
    ...eventFiles,
  ]))
    .filter((file) => typeof file === 'string' && file.trim())
    .filter((file) => isMemoryPathInWorkspace(file, workspace))
    .map((file) => scrubMemoryText(file, currentRequest, workspace))
    .slice(0, 12);
  const failures = events
    .map(eventFailureText)
    .filter((failure): failure is string => Boolean(failure && failure.trim()))
    .map((failure) => compactMemoryText(scrubMemoryText(failure, currentRequest, workspace), 520))
    .slice(-4);

  return {
    status: latestRun.status,
    files,
    failures,
  };
};

const isRelatedToThread = (currentRequest: string, thread: CoderThreadMessage[]) => {
  if (isContinuationRequest(currentRequest)) return true;
  const currentWords = significantWords(currentRequest);
  const priorWords = significantWords(thread.map(messageContent).join(' '));
  let shared = 0;
  for (const word of currentWords) if (priorWords.has(word)) shared += 1;
  return shared >= 2;
};

/** Explicit user preferences may cross task boundaries; execution history may not. */
export const extractCoderThreadPreferences = (thread: CoderThreadMessage[]) => Array.from(new Set(
  thread
    .filter((message) => message.role === 'user')
    .flatMap((message) => messageContent(message).split(/(?<=[.!?])\s+/))
    .filter((sentence) => /\b(prefer|always|never|avoid|please use|use typescript|use javascript)\b/i.test(sentence))
    .map((sentence) => compactMemoryText(sentence))
)).slice(-6);

export const buildCoderThreadMemoryPrompt = (
  currentRequest: string,
  thread: CoderThreadMessage[],
  workspace?: string,
  relevanceRequest = currentRequest,
) => {
  const safeRequest = textValue(currentRequest);
  const safeRelevanceRequest = textValue(relevanceRequest);
  const trimmedRequest = safeRequest.trim();
  const trimmedRelevanceRequest = safeRelevanceRequest.trim() || trimmedRequest;
  if (!trimmedRequest) return safeRequest;

  const usableThread = thread
    .filter((message) => messageContent(message).trim())
    .filter((message, index, messages) => {
      const isLastMessage = index === messages.length - 1;
      return !(isLastMessage && message.role === 'user' && messageContent(message).trim() === trimmedRequest);
    });

  if (usableThread.length === 0) return safeRequest;

  const preferences = extractCoderThreadPreferences(usableThread);
  if (!isRelatedToThread(trimmedRelevanceRequest, usableThread)) {
    return `New task. Ignore prior execution history and preserve only explicit user preferences.\n\nPreferences:\n${preferences.length ? preferences.map((preference) => `- ${preference}`).join('\n') : '- None'}\n\nCurrent request:\n${trimmedRequest}`;
  }

  const priorUserMessages = [...usableThread].reverse().filter((message) => message.role === 'user');
  const priorGoalMessage = priorUserMessages.find((message) => ACTIONABLE_MEMORY_RE.test(messageContent(message))) ||
    (isContinuationRequest(trimmedRelevanceRequest) ? priorUserMessages[0] : undefined);
  const priorGoal = priorGoalMessage
    ? compactMemoryText(scrubMemoryText(messageContent(priorGoalMessage), trimmedRelevanceRequest, workspace))
    : undefined;
  const latestStatusMessage = [...usableThread]
    .reverse()
    .find((message) => message.role === 'assistant' && messageContent(message).trim());
  const latestStatus = latestStatusMessage
    ? compactMemoryText(scrubMemoryText(messageContent(latestStatusMessage), trimmedRelevanceRequest, workspace))
    : undefined;
  const referencedFiles = extractMemoryFilePaths(
    ...usableThread.map(messageContent),
    ...usableThread.flatMap((message) => message.filesChanged || []),
    trimmedRelevanceRequest
  )
    .filter((file) => shouldKeepMemoryFilePath(file, trimmedRelevanceRequest))
    .filter((file) => isMemoryPathInWorkspace(file, workspace))
    .slice(0, 8);
  const changedFiles = Array.from(new Set(usableThread.flatMap((message) => message.filesChanged || [])))
    .filter((file) => isMemoryPathInWorkspace(file, workspace))
    .slice(0, 8);
  const repairEvidence = REPAIR_REQUEST_RE.test(trimmedRelevanceRequest)
    ? incrementalRepairEvidence(usableThread, trimmedRelevanceRequest, workspace)
    : { files: [], failures: [] };
  const relevantFiles = Array.from(new Set([
    ...changedFiles,
    ...repairEvidence.files,
    ...referencedFiles,
  ])).slice(0, 8);
  const goalAlreadyIncluded = priorGoal && trimmedRelevanceRequest.toLowerCase().includes(priorGoal.toLowerCase());
  const repairContext = REPAIR_REQUEST_RE.test(trimmedRelevanceRequest)
    ? `

Incremental repair handoff:
- Treat the current workspace as authoritative and preserve existing behavior and unrelated user changes.
- Inspect the current target and current diff first, locate the smallest cause, and use a focused Edit/minimal patch.
- Do not regenerate or rewrite an existing file wholesale unless it is missing or a whole-file replacement is explicitly required.
- Prior execution status: ${repairEvidence.status || 'not recorded'}.
- Files touched by the prior run: ${repairEvidence.files.length ? repairEvidence.files.join(', ') : 'none recorded'}.
- Bounded failure evidence from the prior run (a lead, not proof): ${repairEvidence.failures.length ? repairEvidence.failures.join(' | ') : 'none recorded; reproduce or inspect the current behavior'}.
- If a prior side-effecting action may have had an uncertain outcome, verify the workspace before retrying it.`
    : '';

  return `Continuation handoff. The current request is authoritative. Use this handoff only to locate remaining work; inspect the workspace before relying on prior status.

Goal:
${priorGoal && !goalAlreadyIncluded ? `- ${priorGoal}` : '- Included in the current request'}

Latest status (unverified):
${latestStatus ? `- ${latestStatusMessage?.status || 'assistant'}: ${latestStatus}` : '- None'}

Relevant files:
${relevantFiles.length ? relevantFiles.map((file) => `- ${file}`).join('\n') : '- None'}

Preferences:
${preferences.length ? preferences.map((preference) => `- ${preference}`).join('\n') : '- None'}
${repairContext}

Current request:
${trimmedRequest}`;
};

/**
 * Build the task sent to a resumed checkpoint from the newest user turn.
 * Checkpoints retain execution evidence, but their original task text may be
 * older than refinements made later in the same Coder Chat thread.
 */
export const getLatestCoderUserRequest = (thread: CoderThreadMessage[]) => [...thread]
  .reverse()
  .map((message) => ({ message, content: messageContent(message) }))
  .find(({ message, content }) => message.role === 'user' && content.trim())
  ?.content
  .trim();

export const buildLatestCoderContinuationPrompt = (
  fallbackTask: string,
  thread: CoderThreadMessage[],
  workspace?: string,
) => {
  const latestUserRequest = getLatestCoderUserRequest(thread);

  if (!latestUserRequest) return fallbackTask;
  return buildCoderThreadMemoryPrompt(latestUserRequest, thread, workspace, latestUserRequest);
};
