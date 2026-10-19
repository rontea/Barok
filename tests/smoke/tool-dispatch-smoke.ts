import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { disableFileMutationGuard, setWorkspace } from '../../src/tools/devTools.js';
import { dispatchTool } from '../../src/react/tool-router.js';

const root = await mkdtemp(join(tmpdir(), 'react-engine-tool-smoke-'));
setWorkspace(root);
disableFileMutationGuard();

const checks: Array<{ action: string; success: boolean; output: string }> = [];

async function tool(action: string, actionInput: Record<string, unknown>) {
  const raw = await dispatchTool({ action, action_input: actionInput });
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { success: true, output: raw };
  }

  checks.push({
    action,
    success: parsed.success !== false,
    output: String(parsed.output ?? parsed.error ?? '').slice(0, 220),
  });

  if (parsed.success === false) {
    throw new Error(`${action} failed: ${parsed.error}`);
  }

  return parsed;
}

try {
  await tool('Write', {
    file_path: 'src/game.js',
    content: 'const score = 10;\nconsole.log("SMOKE_TOKEN", score);\n',
  });
  await tool('Read', { file_path: 'src/game.js' });
  await tool('Edit', {
    file_path: 'src/game.js',
    old_string: 'score = 10',
    new_string: 'score = 20',
  });

  const edited = await readFile(join(root, 'src/game.js'), 'utf8');
  if (!edited.includes('score = 20')) {
    throw new Error('Edit did not persist to disk.');
  }

  const globResult = await tool('Glob', { pattern: '**/*.js' });
  if (!globResult.output.includes('game.js')) {
    throw new Error('Glob did not find the generated JavaScript file.');
  }

  const grepResult = await tool('Grep', {
    pattern: 'SMOKE_TOKEN',
    path: 'src',
    includePattern: '**/*.js',
  });
  if (!grepResult.output.includes('game.js')) {
    throw new Error('Grep did not find the expected token in the generated JavaScript file.');
  }

  await tool('Bash', {
    command: 'node -e "console.log(process.cwd())"',
    cwd: '.',
    timeout: 10000,
  });

  const created = await tool('TaskCreate', {
    subject: 'smoke task',
    description: 'verify task create',
  });
  const taskId = JSON.parse(created.output).id;
  await tool('TaskUpdate', {
    id: taskId,
    status: 'completed',
    owner: 'smoke',
  });
  await tool('TaskList', {});

  console.table(checks);
} finally {
  await rm(root, { recursive: true, force: true });
}
