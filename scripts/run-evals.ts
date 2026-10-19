import { readFile, readdir } from 'fs/promises';
import path from 'path';
import {
  loadProjectFixture,
  loadTaskFixture,
  runScriptedEvaluation,
  writeEvaluationSummary,
} from '../src/evals/evaluationRunner.js';

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function jsonFiles(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => path.join(directory, file));
}

async function run(): Promise<void> {
  const root = process.cwd();
  const fixturesRoot = path.join(root, 'tests', 'evals', 'fixtures');
  const projectsDirectory = path.join(fixturesRoot, 'projects');
  const tasksDirectory = path.join(fixturesRoot, 'tasks');
  const incidentsDirectory = path.join(fixturesRoot, 'incidents');
  const outputDirectory = path.resolve(argumentValue('--output') || path.join(root, 'tests', 'evals', 'results'));
  const randomSeed = Number.parseInt(argumentValue('--seed') || '1', 10);
  if (!Number.isInteger(randomSeed)) throw new Error('--seed must be an integer.');

  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { version?: unknown };
  const runtimeVersion = typeof packageJson.version === 'string' ? packageJson.version : 'development';
  const projects = await Promise.all((await jsonFiles(projectsDirectory)).map(loadProjectFixture));
  const tasks = await Promise.all([
    ...(await jsonFiles(tasksDirectory)),
    ...(await jsonFiles(incidentsDirectory)),
  ].map(loadTaskFixture));
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const outcomes = [];

  for (const task of tasks) {
    const project = projectsById.get(task.projectFixtureId);
    if (!project) throw new Error(`Task ${task.id} references missing project ${task.projectFixtureId}.`);
    const outcome = await runScriptedEvaluation(project, task, {
      outputDirectory,
      runtimeVersion,
      providerAdapter: 'scripted-offline-v1',
      randomSeed,
      startedAt: 1_000,
    });
    outcomes.push(outcome);
    const marker = outcome.assessment.passed ? 'PASS' : 'FAIL';
    process.stdout.write(`${marker} ${task.id} (${outcome.record.status})\n`);
    for (const problem of outcome.assessment.problems) process.stdout.write(`  - ${problem}\n`);
  }

  const summaryPath = await writeEvaluationSummary(outcomes, outputDirectory);
  const failed = outcomes.filter((outcome) => !outcome.assessment.passed).length;
  process.stdout.write(`\n${outcomes.length - failed}/${outcomes.length} evaluation fixtures passed.\n`);
  process.stdout.write(`Results: ${outputDirectory}\nSummary: ${summaryPath}\n`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  process.stderr.write(`Offline evaluation runner failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
