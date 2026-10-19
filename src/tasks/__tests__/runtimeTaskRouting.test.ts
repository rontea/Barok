import { createRuntimeTaskRouting } from '../runtimeTaskRouting.js';

describe('runtime task routing', () => {
  it('produces the bounded typed decision used by server runs', () => {
    const routing = createRuntimeTaskRouting(
      'Fix the backend API bug and add test coverage',
      ['src/server.ts', 'src/server.ts', 'src/__tests__/server.test.ts'],
    );

    expect(routing.classification).toBe('bug_fix');
    expect(routing.touchedLayers).toContain('backend');
    expect(routing.touchedLayers).toContain('tests');
    expect(routing.primaryAgents).toContain('backend');
    expect(routing.verificationAgents).toContain('reviewer');
    expect(routing.affectedFiles).toEqual([
      'src/server.ts',
      'src/__tests__/server.test.ts',
    ]);
    expect(routing).not.toHaveProperty('description');
    expect(routing).not.toHaveProperty('verificationPlan');
  });

  it('bounds and normalizes file metadata', () => {
    const files = Array.from({ length: 60 }, (_, index) => ` src/file-${index}.ts `);
    const routing = createRuntimeTaskRouting('Inspect the project', files);

    expect(routing.affectedFiles).toHaveLength(50);
    expect(routing.affectedFiles[0]).toBe('src/file-0.ts');
    expect(routing.affectedFiles.at(-1)).toBe('src/file-49.ts');
  });

  it('splits adjacent filenames from compact prompt text before routing', () => {
    const routing = createRuntimeTaskRouting(
      'Build a browser app in index.htmlstyles.cssscript.js',
      ['index.htmlstyles.cssscript.js'],
    );

    expect(routing.classification).toBe('generated_app');
    expect(routing.affectedFiles).toEqual(['index.html', 'styles.css', 'script.js']);
    expect(routing.primaryAgents).toContain('frontend');
  });
});
