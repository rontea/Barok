import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { CrewCoordinator } from '../../src/agents/crew.ts';

async function runCrewTest() {
  console.log("=== Starting Offline Crew Verification ===");

  const testTask = `Create a temporary folder named "crew_temp_test" if it does not exist. Inside it, assign a coder agent to write a file named "crew_offline.txt" with the content "Crew offline test working". Finally, verify using bash that the file exists and its contents are correct.`;

  console.log(`Complex Task: ${testTask}`);

  const workspace = await mkdtemp(join(tmpdir(), 'react-engine-crew-smoke-'));
  try {
    await mkdir(join(workspace, 'crew_temp_test'));
    await writeFile(join(workspace, 'package.json'), JSON.stringify({
      name: 'crew-offline-smoke',
      scripts: { test: 'node verify.mjs' },
      type: 'module',
    }));
    await writeFile(join(workspace, 'verify.mjs'), [
      "import { readFile } from 'node:fs/promises';",
      "const expected = 'Crew offline test working';",
      "const actual = await readFile('crew_temp_test/crew_offline.txt', 'utf8');",
      "if (actual !== expected) process.exit(1);",
      'console.log(actual);',
    ].join('\n'));

    const actions = [
      { tool: 'Write', arguments: { file_path: 'crew_temp_test/crew_offline.txt', content: 'Crew offline test working', allowCreate: true } },
      { tool: 'Read', arguments: { file_path: 'crew_temp_test/crew_offline.txt' } },
      { tool: 'Bash', arguments: { command: 'npm test' } },
    ];
    let actionIndex = 0;
    const llmProvider = {
      createChatCompletion: async (messages) => {
        const prompt = messages.map((message) => message.content).join('\n');
        if (/tool planner/i.test(prompt)) return JSON.stringify(actions[Math.min(actionIndex++, actions.length - 1)]);
        if (/evaluating whether a task has been completed/i.test(prompt)) return actionIndex >= actions.length ? 'YES' : 'NO';
        if (/summarizing the result/i.test(prompt)) return 'Created and verified the crew smoke file.';
        if (/Create the execution plan/i.test(prompt)) return JSON.stringify([{ step: 'Execute the deterministic crew smoke actions', status: 'pending' }]);
        return 'Continue with the assigned smoke task.';
      },
      estimateStepCost: () => 0,
      getProviderName: () => 'deterministic-crew-smoke',
      isAvailable: () => true,
    };
    const llm = {
      chatCompletion: async ({ messages }) => {
        const prompt = messages[0]?.content || '';
        if (/Break this task into/i.test(prompt)) return { content: JSON.stringify(['Write and verify the crew smoke file']) };
        return { content: 'Crew smoke completed.' };
      },
    };
    const crew = new CrewCoordinator(llm, 'deterministic-crew-smoke', workspace, llmProvider);
    const result = await crew.orchestrateComplexTask(testTask);

    if (!result || actionIndex < actions.length) {
      throw new Error('The deterministic crew smoke scenario did not complete all actions.');
    }
    console.log("\n=== Crew Test Completed ===");
    console.log(`Final Result: ${result}`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

runCrewTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
