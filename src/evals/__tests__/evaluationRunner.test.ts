import { existsSync } from 'fs';
import { mkdtemp, readFile, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from '@jest/globals';
import {
  assessEvaluation,
  createEvaluationSummary,
  loadProjectFixture,
  loadTaskFixture,
  materializeProjectFixture,
  runScriptedEvaluation,
  writeEvaluationSummary,
} from '../evaluationRunner';
import { parseProjectFixture, parseTaskFixture } from '../fixtureSchema';

const fixturesRoot = path.join(process.cwd(), 'tests', 'evals', 'fixtures');
const projectsRoot = path.join(fixturesRoot, 'projects');
const tasksRoot = path.join(fixturesRoot, 'tasks');
const incidentsRoot = path.join(fixturesRoot, 'incidents');

async function jsonFiles(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => path.join(directory, file));
}

async function loadFixtureCatalog() {
  const projectFiles = await jsonFiles(projectsRoot);
  const taskFiles = [...await jsonFiles(tasksRoot), ...await jsonFiles(incidentsRoot)];
  const projects = await Promise.all(projectFiles.map(loadProjectFixture));
  const tasks = await Promise.all(taskFiles.map(loadTaskFixture));
  return { projects, tasks };
}

describe('evaluation fixture catalog', () => {
  it('loads every required project, task, and incident fixture', async () => {
    const { projects, tasks } = await loadFixtureCatalog();

    expect(projects.map((item) => item.projectType).sort()).toEqual([
      'dirty_git',
      'missing_package_manager',
      'no_git',
      'node_typescript',
      'python',
      'react_vite',
      'vanilla_js',
      'windows_paths',
    ]);
    expect(Array.from(new Set(tasks.filter((item) => item.kind !== 'incident').map((item) => item.kind))).sort()).toEqual([
      'ambiguous',
      'bug_fix',
      'continuation',
      'feature',
      'read_only',
      'refactor',
      'todo_phase',
    ]);
    expect(tasks.filter((item) => item.kind === 'incident').map((item) => item.incident?.auditId).sort()).toEqual([
      '5WQJA4',
      'NO-WRITE-EDIT-RECOVERY',
      'YIMW6E',
    ]);
    expect(tasks.filter((item) => item.continuationCase).map((item) => item.id).sort()).toEqual([
      'continuation-ambiguous-confirmation',
      'continuation-max-steps',
      'continuation-unrelated-new-work',
    ]);
  });

  it('rejects unsafe paths and invalid cross-record fixture references', () => {
    expect(() => parseProjectFixture({
      schemaVersion: 1,
      id: 'unsafe',
      title: 'Unsafe',
      description: 'Unsafe path fixture',
      projectType: 'no_git',
      packageManager: 'none',
      gitMode: 'none',
      files: { '../escape.txt': 'nope' },
    })).toThrow('must stay relative');

    expect(() => parseTaskFixture({
      schemaVersion: 1,
      id: 'bad-task',
      title: 'Bad task',
      description: 'Missing requirement reference',
      projectFixtureId: 'no-git',
      kind: 'bug_fix',
      request: 'Fix it',
      requirements: [],
      expectations: {
        expectedStatus: 'completed',
        requiresMutation: false,
      },
      scriptedRun: {
        status: 'completed',
        durationMs: 1,
        verificationChecks: [{
          requirementIds: ['missing'],
          name: 'check',
          outcome: 'passed',
          atMs: 1,
        }],
      },
    })).toThrow('missing requirement');
  });
});

describe('disposable project materialization', () => {
  it('normalizes Windows fixture paths and removes only its owned workspace', async () => {
    const project = await loadProjectFixture(path.join(projectsRoot, 'windows-paths.json'));
    const root = await mkdtemp(path.join(tmpdir(), 'react-engine-eval-test-'));
    const workspace = await materializeProjectFixture(project, { root });
    const expectedFile = path.join(workspace.path, 'src', 'nested', 'value.js');

    expect(existsSync(expectedFile)).toBe(true);
    expect(await readFile(expectedFile, 'utf8')).toContain('value: 7');
    expect(workspace.fingerprint).toMatch(/^[a-f0-9]{64}$/);

    await workspace.cleanup();
    expect(existsSync(workspace.path)).toBe(false);
    expect(existsSync(root)).toBe(true);
  });

  it('materializes the declared dirty content without requiring Git in offline mode', async () => {
    const project = await loadProjectFixture(path.join(projectsRoot, 'dirty-git.json'));
    const workspace = await materializeProjectFixture(project);
    try {
      expect(workspace.gitInitialized).toBe(false);
      expect(await readFile(path.join(workspace.path, 'src', 'config.js'), 'utf8')).toContain('pre-existing user change');
    } finally {
      await workspace.cleanup();
    }
  });
});

describe('offline evaluation runner', () => {
  it('runs the complete scripted fixture catalog deterministically', async () => {
    const { projects, tasks } = await loadFixtureCatalog();
    const byId = new Map(projects.map((item) => [item.id, item]));
    const outcomes = [];

    for (const task of tasks) {
      const project = byId.get(task.projectFixtureId);
      expect(project).toBeDefined();
      outcomes.push(await runScriptedEvaluation(project!, task, {
        startedAt: 1_000,
        randomSeed: 11,
        runtimeVersion: 'test',
      }));
    }

    expect(outcomes).toHaveLength(tasks.length);
    expect(outcomes.every((item) => item.assessment.passed)).toBe(true);
    expect(outcomes.map((item) => item.record.runId).every((id) => id.endsWith('-11'))).toBe(true);
  });

  it('reproduces checklist-only false completion and malformed-action recovery', async () => {
    const dirtyProject = await loadProjectFixture(path.join(projectsRoot, 'dirty-git.json'));
    const windowsProject = await loadProjectFixture(path.join(projectsRoot, 'windows-paths.json'));
    const checklistTask = await loadTaskFixture(path.join(incidentsRoot, '5wqja4.json'));
    const malformedTask = await loadTaskFixture(path.join(incidentsRoot, 'yimw6e.json'));

    const checklist = await runScriptedEvaluation(dirtyProject, checklistTask, { startedAt: 100 });
    const malformed = await runScriptedEvaluation(windowsProject, malformedTask, { startedAt: 100 });

    expect(checklist.record.metrics).toMatchObject({
      taskSuccess: false,
      falseCompletion: true,
      verificationCoverage: 0,
    });
    expect(malformed.record.metrics).toMatchObject({
      taskSuccess: true,
      falseCompletion: false,
      validToolCallRate: 0.5,
      verificationCoverage: 1,
    });
    expect(malformed.record.actions.map((item) => item.status)).toEqual(['rejected', 'recovery']);
  });

  it('saves machine-readable run records and aggregate summaries', async () => {
    const project = await loadProjectFixture(path.join(projectsRoot, 'vanilla-js.json'));
    const task = await loadTaskFixture(path.join(tasksRoot, 'bug-fix.json'));
    const outputDirectory = await mkdtemp(path.join(tmpdir(), 'react-engine-eval-results-'));
    const outcome = await runScriptedEvaluation(project, task, {
      outputDirectory,
      startedAt: 500,
      randomSeed: 3,
    });
    const summaryPath = await writeEvaluationSummary([outcome], outputDirectory, 900);
    const storedRecord = JSON.parse(await readFile(outcome.resultPath!, 'utf8'));
    const storedSummary = JSON.parse(await readFile(summaryPath, 'utf8'));

    expect(storedRecord.schemaVersion).toBe(1);
    expect(storedRecord.metrics.taskSuccess).toBe(true);
    expect(storedSummary).toMatchObject({
      schemaVersion: 1,
      generatedAt: 900,
      totalRuns: 1,
      passedRuns: 1,
      failedRuns: 0,
    });
  });

  it('reports expectation failures independently from model-written text', async () => {
    const project = await loadProjectFixture(path.join(projectsRoot, 'vanilla-js.json'));
    const task = await loadTaskFixture(path.join(tasksRoot, 'bug-fix.json'));
    const outcome = await runScriptedEvaluation(project, task, { startedAt: 100 });
    const incompatibleTask = parseTaskFixture({
      ...task,
      expectations: { ...task.expectations, expectedStatus: 'failed' },
    });

    expect(assessEvaluation(outcome.record, incompatibleTask)).toEqual({
      passed: false,
      problems: ['Expected status failed, received completed.'],
    });
    expect(createEvaluationSummary([outcome], 200).runs[0].passed).toBe(true);
  });
});
