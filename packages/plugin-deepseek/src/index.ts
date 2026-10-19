import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-system-prompt';
import { classifyTask, normalizeFilePathCandidates } from '@barok/core';

export const name = 'barok-core-tools';
export const inject = ['tools', 'systemPrompt'];

export const CODING_WORKFLOW_PROMPT_TEXT = [
  'For a clear request to implement, fix, or change code in the active workspace, take only brief planning time and make the first action a necessary workspace file-tool call; do not narrate a plan first.',
  'Use `read` to inspect existing files before changing them, `write` with `file_path` and complete `content` to create a new file, and `edit` with `file_path`, `old_string`, and `new_string` for a focused change.',
  'Keep implementation source out of assistant text, including visible thinking and the final reply; provide source only as arguments to workspace file-tool calls. Do not use chat code drafts as a substitute for editing, and do not wait for the user to repeat an implementation request.',
  'After successful file-tool results, give a concise summary naming the files changed. Never claim a file was written without a successful tool result.',
  'If a required workspace tool is unavailable or a call fails or is denied, stop and state the exact blocker; do not fall back to posting source code in chat.',
  'For requests limited to explanation, review, or a code sample, respond without editing files.',
].join(' ');

export const WINDOWS_ACL_WORKFLOW_PROMPT_TEXT = [
  'On Windows, if a Harness file or folder operation fails with `SetNamedSecurityInfoW failed (Win32 5): grantWrite(...)`, treat it as a sandbox permission failure and stop retrying that operation. If the active session provides the `diagnose-windows-sandbox-acl` skill, load it with the `skill` tool and follow its instructions exactly. Use the reported failing path as `-Path`, the active session workspace root as `-AllowRoot`, and a persistent recovery directory under `$env:LOCALAPPDATA\\Barok\\DeepSeekHarness\\acl-recovery` as `-Out`. Let that skill present its one-time approval request and create its recovery artifacts before changing permissions. Never construct a separate ACL command, elevate, remove deny entries, or widen `-AllowRoot` outside the active workspace. If the skill is unavailable, approval is refused, or it refuses because the blocked object is outside the workspace, stop and report the blocker. After a verified repair, retry the original operation once.',
].join(' ');

const jsonOutput = {
  schema: { type: 'json' } as const,
  render: (_args: unknown, value: unknown) => [{
    type: 'text' as const,
    text: JSON.stringify(value, null, 2),
  }],
};

/** Register read-only Harness tools that delegate directly to Barok Core. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'barok:coding-workflow',
    order: 3150,
    text: CODING_WORKFLOW_PROMPT_TEXT,
  });
  ctx.systemPrompt.section({
    name: 'barok:windows-acl-recovery',
    order: 3140,
    text: WINDOWS_ACL_WORKFLOW_PROMPT_TEXT,
  });

  ctx.effect(function* () {
    yield ctx.tools.register(defineTool({
      name: 'barok_classify_task',
      description: 'Classify a task using Barok Core task policy.',
      parameters: {
        task: { type: 'string', required: true, description: 'Task request to classify.' },
      },
      output: jsonOutput,
      execute: ({ task }) => {
        if (task.trim() === '') throw new Error('task must be a non-empty string.');
        return { classification: classifyTask(task) };
      },
    }));

    yield ctx.tools.register(defineTool({
      name: 'barok_normalize_file_paths',
      description: 'Normalize and deduplicate file path candidates using Barok Core.',
      parameters: {
        paths: {
          type: 'array',
          required: true,
          items: { type: 'string' },
          description: 'Candidate paths to normalize.',
        },
      },
      output: jsonOutput,
      execute: ({ paths }) => ({ paths: normalizeFilePathCandidates(paths) }),
    }));
  }, 'barok-core-tools registration');
}
