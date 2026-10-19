import { readFile } from 'fs/promises';
import path from 'path';
import { describe, expect, it } from '@jest/globals';
import { loadProjectFixture } from '../evaluationRunner';
import { runProductionEngineFixture, type ProductionEngineFixtureScenario } from '../productionEngineAdapter';

const fixturesRoot = path.join(process.cwd(), 'tests', 'evals', 'fixtures');

describe('production engine fixture adapter', () => {
  it('runs a disposable fixture through the actual ReAct engine, edits files, and verifies them', async () => {
    const project = await loadProjectFixture(path.join(fixturesRoot, 'projects', 'vanilla-js.json'));
    const scenario = JSON.parse(await readFile(path.join(fixturesRoot, 'production', 'engine-bug-fix.json'), 'utf8')) as ProductionEngineFixtureScenario;
    const result = await runProductionEngineFixture(project, scenario);

    expect(result.success).toBe(true);
    expect(result.steps.map((step) => step.action)).toEqual(['Read', 'Write', 'Read', 'Write', 'Bash']);
    expect(JSON.parse(result.steps[4]?.observation || '{}')).toMatchObject({ success: true, status: 'success' });
    expect(result.finalAnswer).toContain('empty-name fallback');
  });
});
