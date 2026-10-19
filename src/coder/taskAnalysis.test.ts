import { describe, expect, it } from '@jest/globals';
import {
  analyzeCoderTask,
  applyCoderTaskWorkspaceGuard,
  extendCoderTaskAnalysisForRepair,
  extractMentionedFiles,
  normalizeCoderRequest,
  responseModeForAnalysis,
} from './taskAnalysis';

describe('Coder task analysis', () => {
  it.each([
    ['I would like to know why the run is failing', 'why the run is failing', 'polite'],
    ["I'd like to know why the run is failing", 'why the run is failing', 'polite'],
    ['The user is asking about how model targets are selected', 'how model targets are selected', 'embedded_user'],
    ['The user would like to update the Gemini model targets', 'update the Gemini model targets', 'embedded_user'],
  ])('normalizes request frames: %s', (message, normalized, frame) => {
    expect(normalizeCoderRequest(message)).toMatchObject({ normalized, frame });
  });

  it('classifies an indirect information request as read-only', () => {
    const analysis = analyzeCoderTask({
      message: 'The user is asking about why the run is failing',
      workspace: 'C:/Projects/react-engine-077',
    });

    expect(analysis.userRequest).toBe('why the run is failing');
    expect(analysis.taskKind).toBe('question');
    expect(analysis.expectedChangeIntent).toBe('read_only');
    expect(analysis.contract?.originalRequest).toBe('The user is asking about why the run is failing');
  });

  it('keeps diagnostic checks read-only when an absolute Windows target contains Test', () => {
    const message = 'please check it continue on happening: Run blocked: The model could not produce a valid Write or Edit action after repeated inspection. Target: C:\\MPC Project Test\\Pacman\\game.js.';
    const analysis = analyzeCoderTask({
      message,
      workspace: 'C:\\MPC Project Test\\Pacman',
    });

    expect(extractMentionedFiles(message)).toEqual(['C:/MPC Project Test/Pacman/game.js']);
    expect(analysis.taskKind).toBe('investigation');
    expect(analysis.expectedChangeIntent).toBe('read_only');
    expect(responseModeForAnalysis(analysis)).toBe('chat');
  });

  it('treats a direct check of a source file as investigation', () => {
    const analysis = analyzeCoderTask({
      message: 'please check game.js',
      workspace: 'C:/MPC Project Test/Pacman',
    });

    expect(analysis.taskKind).toBe('investigation');
    expect(analysis.expectedChangeIntent).toBe('read_only');
  });

  it('classifies harness implementation feedback as a mutating task', () => {
    const analysis = analyzeCoderTask({
      message: 'I think our harness should be checking phrases like user is asking about and user would like to so the agent can progress.',
      workspace: 'C:/Projects/react-engine-077',
      projectFileMap: {
        workspace: 'C:/Projects/react-engine-077',
        generatedAt: Date.now(),
        totalFiles: 2,
        omittedCount: 0,
        files: [
          { path: 'src/coder/intent.ts', layer: 'shared', role: 'intent router', exists: true },
          { path: 'src/coder/taskAnalysis.ts', layer: 'shared', role: 'task analyzer', exists: true },
        ],
      },
    });

    expect(analysis.taskKind).toBe('new_feature');
    expect(analysis.expectedChangeIntent).toBe('modify');
    expect(analysis.affectedFiles.map((file) => file.path)).toEqual(
      expect.arrayContaining(['src/coder/intent.ts', 'src/coder/taskAnalysis.ts'])
    );
  });

  it('expands repair scope to an existing runtime file discovered by app verification', () => {
    const analysis = analyzeCoderTask({
      message: 'fix the website style and behavior',
      workspace: 'C:/MPC Project Test/website test 1',
      projectFileMap: {
        workspace: 'C:/MPC Project Test/website test 1',
        generatedAt: Date.now(),
        totalFiles: 2,
        omittedCount: 0,
        files: [
          { path: 'index.html', layer: 'ui', role: 'entry point', exists: true },
          { path: 'style.css', layer: 'ui', role: 'stylesheet', exists: true },
        ],
      },
    });

    const repaired = extendCoderTaskAnalysisForRepair(analysis, ['script.js']);

    expect(repaired?.affectedFiles).toContainEqual(expect.objectContaining({
      path: 'script.js',
      intent: 'modify',
      mustReadBeforeEdit: true,
    }));
    expect(repaired?.requiredInspections).toContain('Read script.js');
    expect(repaired?.contract?.candidateFiles).toContain('script.js');
  });

  it('does not treat a Node.js runtime banner as a source file', () => {
    const analysis = analyzeCoderTask({
      message: [
        'fix error when running node index.js',
        "Error: Cannot find module 'C:\\MPC Project Test\\game 1\\src\\index.js'",
        'Node.js v24.12.0',
      ].join('\n'),
      workspace: 'C:\\MPC Project Test\\game 1',
      projectFileMap: {
        workspace: 'C:\\MPC Project Test\\game 1',
        generatedAt: Date.now(),
        totalFiles: 1,
        omittedCount: 0,
        files: [{ path: 'index.js', layer: 'unknown', role: 'project file', exists: true }],
      },
    });

    expect(analysis.mentionedFiles).toContain('index.js');
    expect(analysis.mentionedFiles).not.toContain('Node.js');
    expect(analysis.contract?.candidateFiles).not.toContain('Node.js');
  });

  it('splits adjacent frontend filenames from a compact handoff', () => {
    expect(extractMentionedFiles('Build the browser app in index.htmlstyles.cssscript.js')).toEqual([
      'index.html',
      'styles.css',
      'script.js',
    ]);
  });

  it('drops unmapped file candidates from a complete project map unless creation is explicit', () => {
    const analysis = analyzeCoderTask({
      message: 'update Rulesindex.html and create script.js for the browser app',
      workspace: 'C:/Projects/web-app',
      projectFileMap: {
        workspace: 'C:/Projects/web-app',
        generatedAt: Date.now(),
        totalFiles: 2,
        omittedCount: 0,
        files: [
          { path: 'index.html', layer: 'ui', role: 'entry point', exists: true },
          { path: 'styles.css', layer: 'ui', role: 'stylesheet', exists: true },
        ],
      },
    });

    expect(analysis.mentionedFiles).not.toContain('Rulesindex.html');
    expect(analysis.affectedFiles).toContainEqual(expect.objectContaining({
      path: 'script.js',
      intent: 'create',
    }));
    expect(analysis.validationRequirements.join('\n')).toMatch(/unmapped file candidates/i);
  });

  it('blocks execution when the project map belongs to a different workspace', () => {
    const analysis = analyzeCoderTask({
      message: 'update the browser app in index.html',
      workspace: 'C:/Projects/Barok',
      projectFileMap: {
        workspace: 'C:/MPC Project Test/BAROKt2',
        generatedAt: Date.now(),
        totalFiles: 1,
        omittedCount: 0,
        files: [{ path: 'index.html', layer: 'ui', role: 'entry point', exists: true }],
      },
    });

    expect(analysis.contract?.blocker).toMatchObject({ code: 'workspace_mismatch' });
    expect(responseModeForAnalysis(analysis, 'agent')).toBe('clarify');
    expect(analysis.contract?.blocker?.resolution).toContain('Requested workspace: C:\\Projects\\Barok');
  });

  it('blocks persisted analysis when its workspace differs from the active run workspace', () => {
    const analysis = analyzeCoderTask({
      message: 'update index.html',
      workspace: 'C:/Projects/Barok',
      projectFileMap: {
        workspace: 'C:/Projects/Barok',
        generatedAt: Date.now(),
        totalFiles: 1,
        omittedCount: 0,
        files: [{ path: 'index.html', layer: 'ui', role: 'entry point', exists: true }],
      },
    });
    const guarded = applyCoderTaskWorkspaceGuard(analysis, 'C:/MPC Project Test/BAROKt2');

    expect(guarded?.contract?.blocker).toMatchObject({ code: 'workspace_mismatch' });
    expect(guarded?.validationRequirements.join('\n')).toMatch(/active run workspace/i);
  });

  it('resolves a relative import target against its mentioned source file', () => {
    const analysis = analyzeCoderTask({
      message: 'Failed to resolve import "./styles/index.css" from "src\\main.tsx".',
      workspace: 'C:/MPC Project Test/galagav',
      projectFileMap: {
        workspace: 'C:/MPC Project Test/galagav',
        generatedAt: Date.now(),
        totalFiles: 1,
        omittedCount: 0,
        files: [{ path: 'src/main.tsx', layer: 'ui', role: 'entry point', exists: true }],
      },
    });

    expect(analysis.mentionedFiles).toContain('src/styles/index.css');
    expect(analysis.contract?.candidateFiles).toContain('src/styles/index.css');
  });

  it('classifies bug fixes as modify intent', () => {
    const analysis = analyzeCoderTask({
      message: 'fix the send button',
      workspace: 'C:/Projects/react-engine-077',
    });

    expect(analysis.taskKind).toBe('bug_fix');
    expect(analysis.expectedChangeIntent).toBe('modify');
    expect(analysis.behaviorScope).toBe('existing_behavior_fix');
    expect(analysis.targetLayer).toBe('ui');
    expect(analysis.requiresApproval).toBe(true);
    expect(analysis.contract?.contractVersion).toBe(1);
    expect(analysis.contract?.behaviorIntent).toBe('fix_existing_behavior');
    expect(analysis.contract?.permissions.canMutate).toBe(true);
    expect(analysis.validationRequirements).toEqual(expect.arrayContaining([
      expect.stringMatching(/smallest targeted patch/i),
      expect.stringMatching(/do not rewrite unrelated files/i),
    ]));
  });

  it('does not mistake product movement language for a file rename', () => {
    const analysis = analyzeCoderTask({
      message: 'Can you make the player move faster in an acceptable way?',
      workspace: 'C:/MPC Project Test/galagav',
    });

    expect(analysis.expectedChangeIntent).toBe('modify');
    expect(analysis.riskFactors).not.toContain('Destructive file operation requested.');
  });

  it('keeps explicit file moves as rename intent', () => {
    const analysis = analyzeCoderTask({
      message: 'Move the old GameCanvas.tsx file into the game/components folder.',
      workspace: 'C:/MPC Project Test/galagav',
    });

    expect(analysis.expectedChangeIntent).toBe('rename');
  });

  it('classifies new feature requests as create intent', () => {
    const analysis = analyzeCoderTask({
      message: 'add a new settings page',
      workspace: 'C:/Projects/react-engine-077',
    });

    expect(analysis.taskKind).toBe('new_feature');
    expect(analysis.expectedChangeIntent).toBe('create');
    expect(analysis.behaviorScope).toBe('new_behavior');
    expect(analysis.affectedFiles.map((file) => file.path)).toContain('ui/src/components/SettingsPanel.tsx');
  });

  it('classifies explicit file update requests as mutable', () => {
    const analysis = analyzeCoderTask({
      message: 'edit and update index include the link of the new created page on index',
      workspace: 'C:/MPC Project Test/test 3',
    });

    expect(analysis.taskKind).toBe('refactor');
    expect(analysis.expectedChangeIntent).toBe('modify');
    expect(analysis.contract?.permissions.canMutate).toBe(true);
    expect(analysis.contract?.permissions.canRunCommands).toBe(true);
  });

  it('classifies requests to remove or delete in-file code as modify intent', () => {
    const analysis = analyzeCoderTask({
      message: 'remove the sound effects and delete unused code in C:/MPC Project Test/pacman 2/index.html',
      workspace: 'C:/MPC Project Test/pacman 2',
    });

    expect(analysis.expectedChangeIntent).toBe('modify');
    expect(analysis.affectedFiles).toContainEqual(expect.objectContaining({
      path: expect.stringMatching(/index\.html$/),
      intent: 'modify',
    }));
  });

  it('distinguishes explicit file deletion from in-file content removal', () => {
    const fileDeletion = analyzeCoderTask({
      message: 'delete the file old_sound.js from the project',
      workspace: 'C:/MPC Project Test/pacman 2',
    });
    expect(fileDeletion.expectedChangeIntent).toBe('delete');

    const contentRemoval = analyzeCoderTask({
      message: 'delete the sound effects from index.html',
      workspace: 'C:/MPC Project Test/pacman 2',
    });
    expect(contentRemoval.expectedChangeIntent).toBe('modify');
    expect(contentRemoval.affectedFiles).toContainEqual(expect.objectContaining({
      path: expect.stringMatching(/index\.html$/),
      intent: 'modify',
    }));
  });

  it('blocks a broad mutation request before tool execution', () => {
    const analysis = analyzeCoderTask({
      message: 'fix the website with your thinking ability',
      workspace: 'C:/Projects/react-engine-077',
    });

    expect(analysis.specificity).toMatchObject({
      targetClarity: 0.12,
      acceptanceClarity: 0,
      score: 0.28,
    });
    expect(analysis.specificity?.missing).toEqual(expect.arrayContaining([
      expect.stringMatching(/concrete target/i),
      expect.stringMatching(/success condition/i),
    ]));
    expect(analysis.contract?.blocker).toMatchObject({ code: 'missing_acceptance_criteria' });
    expect(responseModeForAnalysis(analysis, 'agent')).toBe('clarify');
  });

  it('does not block a scoped mutation with a concrete target', () => {
    const analysis = analyzeCoderTask({
      message: 'fix the send button',
      workspace: 'C:/Projects/react-engine-077',
    });

    expect(analysis.specificity?.targetClarity).toBe(1);
    expect(analysis.contract?.blocker).toBeUndefined();
    expect(responseModeForAnalysis(analysis, 'agent')).toBe('execute');
  });

  it('allows broad mutations to discover scope when a workspace map is available', () => {
    const analysis = analyzeCoderTask({
      message: 'Fix the website to run it',
      workspace: 'C:/Projects/react-engine-077',
      projectFileMap: {
        workspace: 'C:/Projects/react-engine-077',
        generatedAt: Date.now(),
        totalFiles: 2,
        omittedCount: 0,
        files: [
          { path: 'ui/src/App.tsx', layer: 'ui', role: 'frontend surface', exists: true },
          { path: 'server.ts', layer: 'backend', role: 'server endpoint', exists: true },
        ],
      },
    });

    expect(analysis.contract?.blocker).toBeUndefined();
    expect(analysis.affectedFiles).toHaveLength(0);
    expect(responseModeForAnalysis(analysis, 'agent')).toBe('execute');
  });

  it('treats a build request in an existing source workspace as a modification', () => {
    const analysis = analyzeCoderTask({
      message: 'build a nice looking portfolio site',
      workspace: 'C:/MPC Project Test/test 3',
      projectFileMap: {
        workspace: 'C:/MPC Project Test/test 3', generatedAt: Date.now(), totalFiles: 2, omittedCount: 0,
        files: [
          { path: 'index.html', layer: 'ui', role: 'page', exists: true },
          { path: 'style.css', layer: 'ui', role: 'styles', exists: true },
        ],
      },
    });

    expect(analysis.expectedChangeIntent).toBe('modify');
  });

  it('treats completing an existing website as a mutating feature task', () => {
    const analysis = analyzeCoderTask({
      message: 'complete the whole website',
      workspace: 'C:/MPC Project Test/test 3',
    });

    expect(analysis.taskKind).toBe('new_feature');
    expect(analysis.expectedChangeIntent).toBe('modify');
    expect(analysis.behaviorScope).toBe('new_behavior');
    expect(analysis.contract?.completionEvidenceRequirements.requireSourceMutationForFeatureCompletion).toBe(true);
    expect(analysis.contract?.completionEvidenceRequirements.requireVerificationForCompletion).toBe(true);
  });

  it.each([
    'the game should play in browser',
    'make it playable in browser',
  ])('treats "%s" as a browser implementation task', (message) => {
    const analysis = analyzeCoderTask({
      message,
      workspace: 'C:/MPC Project Test/game 1',
    });

    expect(analysis.taskKind).toBe('new_feature');
    expect(analysis.expectedChangeIntent).not.toBe('read_only');
    expect(analysis.targetLayer).toBe('ui');
    expect(analysis.contract?.permissions.canMutate).toBe(true);
    expect(analysis.contract?.completionEvidenceRequirements.requireSourceMutationForFeatureCompletion).toBe(true);
    expect(analysis.contract?.completionEvidenceRequirements.requireVerificationForCompletion).toBe(true);
    expect(analysis.validationRequirements.join('\n')).toMatch(/browser entry point.*smoke check/i);
  });

  it('treats a resume PDF as a source document for a new portfolio site', () => {
    const resume = '2026_Ronryan_Teano_Resume July_CS_SEBA.pdf';
    const analysis = analyzeCoderTask({
      message: `I added my resume ${resume}. Create a vanilla portfolio website based on it.`,
      workspace: 'C:/MPC Project Test/test 2',
      projectFileMap: {
        workspace: 'C:/MPC Project Test/test 2',
        generatedAt: Date.now(),
        totalFiles: 1,
        omittedCount: 0,
        files: [{ path: resume, layer: 'docs', role: 'documentation', exists: true }],
      },
    });

    expect(analysis.taskKind).toBe('new_feature');
    expect(analysis.instanceMode).toBe('unknown');
    expect(analysis.expectedChangeIntent).toBe('create');
    expect(analysis.targetLayer).toBe('ui');
    expect(analysis.sourceFiles).toEqual([resume]);
    expect(analysis.affectedFiles).toEqual([]);
    expect(analysis.requiredInspections).toContain(`DocumentRead ${resume}`);
    expect(analysis.requiredInspections.join('\n')).not.toContain('[object Object]');
    expect(analysis.contract?.requirementSources).toEqual([resume]);
    expect(analysis.contract?.candidateFiles).toEqual([]);
  });

  it('detects backend update targets from server and persistence language', () => {
    const analysis = analyzeCoderTask({
      message: 'fix the backend persistence endpoint in server.ts',
      workspace: 'C:/Projects/react-engine-077',
    });

    expect(analysis.taskKind).toBe('bug_fix');
    expect(analysis.targetLayer).toBe('backend');
    expect(analysis.validationRequirements.join('\n')).toMatch(/backend|unit|targeted/i);
  });

  it('flags broad refactors as risky', () => {
    const analysis = analyzeCoderTask({
      message: 'refactor the frontend and backend architecture without changing behavior',
      workspace: 'C:/Projects/react-engine-077',
    });

    expect(analysis.taskKind).toBe('refactor');
    expect(analysis.targetLayer).toBe('full_stack');
    expect(analysis.refactorRisk).toBe('risky_refactor');
    expect(analysis.riskLevel).toBe('high');
    expect(analysis.riskFactors.length).toBeGreaterThan(0);
  });

  it('uses project file map entries to infer affected files', () => {
    const analysis = analyzeCoderTask({
      message: 'fix the run manager streaming behavior',
      workspace: 'C:/Projects/react-engine-077',
      projectFileMap: {
        workspace: 'C:/Projects/react-engine-077',
        generatedAt: Date.now(),
        totalFiles: 1,
        omittedCount: 0,
        files: [
          {
            path: 'src/react/run-manager.ts',
            layer: 'backend',
            role: 'agent/runtime module',
            exists: true,
          },
        ],
      },
    });

    expect(analysis.inferredFiles).toContain('src/react/run-manager.ts');
    expect(analysis.projectFileMap?.files[0].path).toBe('src/react/run-manager.ts');
  });

  it('uses semantic project-map signals for cart workflows', () => {
    const analysis = analyzeCoderTask({
      message: 'update add to cart to next page prototype',
      workspace: 'C:/MPC Project Test/website test 1',
      projectFileMap: {
        workspace: 'C:/MPC Project Test/website test 1',
        generatedAt: Date.now(),
        totalFiles: 8,
        omittedCount: 0,
        files: [
          { path: 'about.html', layer: 'ui', role: 'frontend surface', exists: true },
          { path: 'cart.html', layer: 'ui', role: 'frontend surface', exists: true },
          { path: 'implementation_plan.txt', layer: 'docs', role: 'documentation', exists: true },
          { path: 'index.html', layer: 'ui', role: 'frontend surface', exists: true },
          { path: 'products.html', layer: 'ui', role: 'frontend surface', exists: true },
          { path: 'script.js', layer: 'ui', role: 'frontend surface', exists: true },
          { path: 'style.css', layer: 'ui', role: 'frontend surface', exists: true },
          { path: 'contact.html', layer: 'ui', role: 'frontend surface', exists: true },
        ],
      },
    });

    expect(analysis.affectedFiles.map((file) => file.path)).toEqual(
      expect.arrayContaining(['cart.html', 'products.html', 'script.js', 'index.html'])
    );
    expect(analysis.contract?.candidateFiles).not.toContain('implementation_plan.txt');
  });

  it('maps site and portfolio requests to UI source files even when a planning document is mentioned', () => {
    const analysis = analyzeCoderTask({
      message: 'update the site structure and improve the portfolio layout; keep the site_structure.md notes aligned',
      workspace: 'C:/MPC Project Test/portfolio',
      projectFileMap: {
        workspace: 'C:/MPC Project Test/portfolio',
        generatedAt: Date.now(),
        totalFiles: 5,
        omittedCount: 0,
        files: [
          { path: 'site_structure.md', layer: 'docs', role: 'documentation', exists: true },
          { path: 'index.html', layer: 'ui', role: 'frontend surface', exists: true },
          { path: 'script.js', layer: 'ui', role: 'frontend surface', exists: true },
          { path: 'style.css', layer: 'ui', role: 'frontend surface', exists: true },
          { path: 'README.md', layer: 'docs', role: 'documentation', exists: true },
        ],
      },
    });

    expect(analysis.affectedFiles.map((file) => file.path)).toEqual(
      expect.arrayContaining(['site_structure.md', 'index.html', 'script.js', 'style.css'])
    );
  });

  it('classifies TODO completion updates as modify intent', () => {
    const analysis = analyzeCoderTask({
      message: 'can you also make sure that you mark todo as completed? add check mark on what was done.',
      workspace: 'C:/Projects/react-engine-077',
    });

    expect(analysis.taskKind).toBe('docs_only');
    expect(analysis.expectedChangeIntent).toBe('modify');
    expect(analysis.contract?.todoAction).toBe('documentation_only');
  });

  it('keeps an app build with an acceptance checklist scoped to app outputs', () => {
    const analysis = analyzeCoderTask({
      message: 'Build a Kanban web app in three separate files: index.html, styles.css, and script.js. Acceptance checklist: create tasks, move them between columns, and preserve them after reload. Mark the checklist complete once the app works.',
      workspace: 'C:/Projects/Barok',
      projectFileMap: {
        workspace: 'C:/Projects/Barok',
        generatedAt: Date.now(),
        totalFiles: 4,
        omittedCount: 0,
        files: [
          { path: 'src/react/engine.ts', layer: 'backend', role: 'agent runtime', exists: true },
          { path: 'ui/src/App.tsx', layer: 'ui', role: 'Barok web client', exists: true },
          { path: 'todo/SERVER_IMPROVEMENTS_TODO.md', layer: 'docs', role: 'repository checklist', exists: true },
          { path: 'README.md', layer: 'docs', role: 'repository documentation', exists: true },
        ],
      },
    });

    expect(analysis.taskKind).toBe('new_feature');
    expect(analysis.expectedChangeIntent).not.toBe('read_only');
    expect(analysis.affectedFiles.map((file) => file.path)).toEqual(['index.html', 'styles.css', 'script.js']);
    expect(analysis.contract?.candidateFiles).not.toContain('todo/SERVER_IMPROVEMENTS_TODO.md');
    expect(analysis.validationRequirements.join('\n')).toMatch(/underlying feature.*checklist-only/i);

    const newWorkspace = analyzeCoderTask({
      message: 'Build a Kanban web app in three separate files: index.html, styles.css, and script.js. Acceptance checklist: create and move tasks. Mark the checklist complete after implementation.',
      workspace: 'C:/MPC Project Test/Kanban',
    });
    expect(newWorkspace.taskKind).toBe('new_feature');
    expect(newWorkspace.expectedChangeIntent).toBe('create');
    expect(newWorkspace.affectedFiles.map((file) => file.intent)).toEqual(['create', 'create', 'create']);
    expect(newWorkspace.affectedFiles.map((file) => file.path)).not.toContain('TODO.md');

    const namedByShape = analyzeCoderTask({
      message: 'Build a three-file Kanban app. Acceptance checklist: create tasks, move them between columns, and retain them after reload.',
      workspace: 'C:/MPC Project Test/Kanban',
    });
    expect(namedByShape.affectedFiles.map((file) => file.path)).toEqual(['index.html', 'style.css', 'script.js']);
  });

  it('classifies working on a named TODO implementation as a mutating task', () => {
    const analysis = analyzeCoderTask({
      message: 'lets start working on LUNA_TOKEN_LIGHT_HELPER_TODO.md',
      workspace: 'C:/Projects/react-engine-077',
    });

    expect(analysis.taskKind).toBe('new_feature');
    expect(analysis.expectedChangeIntent).not.toBe('read_only');
    expect(analysis.contract?.permissions.canMutate).toBe(true);
  });

  it('classifies working on a named task such as Shared Types as implementation work', () => {
    const analysis = analyzeCoderTask({
      message: 'work on ## Shared Types and complete once done',
      workspace: 'C:/MPC Project Test/Pacman',
    });

    expect(analysis.taskKind).toBe('new_feature');
    expect(analysis.expectedChangeIntent).not.toBe('read_only');
    expect(analysis.contract?.permissions.canMutate).toBe(true);
  });

  it('classifies TODO tracker creation as docs-only modify intent', () => {
    const analysis = analyzeCoderTask({
      message: 'create the performance hardening TODO tracker and add checkboxes',
      workspace: 'C:/Projects/react-engine-077',
    });

    expect(analysis.taskKind).toBe('docs_only');
    expect(analysis.expectedChangeIntent).toBe('modify');
    expect(analysis.affectedFiles.map((file) => file.path)).toContain('todo/PERFORMANCE_AND_AGENT_HARDENING_TODO.md');
    expect(analysis.validationRequirements.join('\n')).toMatch(/documentation|checklist/i);
  });

  it('allows an explicitly requested TODO file to be created in an existing workspace', () => {
    const analysis = analyzeCoderTask({
      message: 'Continuation handoff. Current request: check and create todo on how we can make it beautiful',
      workspace: 'C:/MPC Project Test/test 3',
      projectFileMap: {
        workspace: 'C:/MPC Project Test/test 3',
        generatedAt: Date.now(),
        totalFiles: 2,
        omittedCount: 0,
        files: [
          { path: 'index.html', layer: 'ui', role: 'page', exists: true },
          { path: 'style.css', layer: 'ui', role: 'styles', exists: true },
        ],
      },
    });

    expect(analysis.expectedChangeIntent).toBe('modify');
    expect(analysis.affectedFiles).toContainEqual(
      expect.objectContaining({ path: 'TODO.md', intent: 'create', mustReadBeforeEdit: false })
    );
  });

  it('does not infer the agent performance tracker for unrelated project TODO requests', () => {
    const analysis = analyzeCoderTask({
      message: 'lets work on ## Phase 2: Maze & Pellets for pacman app, update todo once done.',
      workspace: 'C:/MPC Project Test/Pacman',
    });

    expect(analysis.taskKind).toBe('new_feature');
    expect(analysis.expectedChangeIntent).toBe('modify');
    expect(analysis.affectedFiles.map((file) => file.path)).toContain('TODO.md');
    expect(analysis.affectedFiles.map((file) => file.path)).not.toContain('todo/PERFORMANCE_AND_AGENT_HARDENING_TODO.md');
    expect(analysis.validationRequirements.join('\n')).toMatch(/underlying feature.*checklist-only/i);
  });

  it('treats affirmative replies as continuation of the prior actionable goal', () => {
    const analysis = analyzeCoderTask({
      message: 'yes please',
      workspace: 'C:/MPC Project Test/Pacman',
      thread: [
        {
          role: 'user',
          content: '## Phase 2: Maze & Pellets - lets work on it and once done mark it complete?',
        },
        {
          role: 'assistant',
          content: 'Shall I go ahead and implement all four Phase 2 items?',
          status: 'success',
        },
      ],
    });

    expect(analysis.taskKind).toBe('continuation');
    expect(analysis.instanceMode).toBe('continuation');
    expect(analysis.expectedChangeIntent).toBe('modify');
    expect(analysis.userRequest).toContain('Phase 2: Maze & Pellets');
    expect(analysis.contract?.behaviorIntent).toBe('continue_prior_work');
    expect(analysis.contract?.originalRequest).toBe('yes please');
    expect(responseModeForAnalysis(analysis)).toBe('execute');
  });

  it('classifies performance optimization as refactor without new public behavior', () => {
    const analysis = analyzeCoderTask({
      message: 'optimize the agent streaming UI so it is faster',
      workspace: 'C:/Projects/react-engine-077',
    });

    expect(analysis.taskKind).toBe('refactor');
    expect(analysis.expectedChangeIntent).toBe('modify');
    expect(analysis.affectedFiles.map((file) => file.path)).toEqual(
      expect.arrayContaining(['ui/src/App.tsx', 'ui/src/components/CoderChatPanel.tsx'])
    );
  });

  it('adds file-map guardrails for workspace tree scanning optimization', () => {
    const analysis = analyzeCoderTask({
      message: 'reduce project file map and workspace tree scanning without changing response shape',
      workspace: 'C:/Projects/react-engine-077',
    });

    expect(analysis.affectedFiles.map((file) => file.path)).toEqual(
      expect.arrayContaining(['src/coder/projectFileMap.ts', 'server.ts'])
    );
    expect(analysis.validationRequirements.join('\n')).toMatch(/ProjectFileMap response shape/i);
  });

  it('detects continuation instance mode', () => {
    const analysis = analyzeCoderTask({
      message: 'continue the last task',
      workspace: 'C:/Projects/react-engine-077',
    });

    expect(analysis.instanceMode).toBe('continuation');
    expect(analysis.taskKind).toBe('continuation');
  });

  it('detects new instance mode', () => {
    const analysis = analyzeCoderTask({
      message: 'start a new agent instance',
      workspace: 'C:/Projects/react-engine-077',
    });

    expect(analysis.instanceMode).toBe('new_instance');
    expect(analysis.taskKind).toBe('new_instance');
  });

  it('classifies app reviews as read-only investigations', () => {
    const analysis = analyzeCoderTask({
      message: 'review the current app',
      workspace: 'C:/Projects/react-engine-077',
    });

    expect(analysis.taskKind).toBe('investigation');
    expect(analysis.expectedChangeIntent).toBe('read_only');
    expect(analysis.requiresApproval).toBe(false);
  });

  it('classifies explain-file requests as read-only', () => {
    const analysis = analyzeCoderTask({
      message: 'explain this file ui/src/App.tsx',
      workspace: 'C:/Projects/react-engine-077',
    });

    expect(['question', 'investigation']).toContain(analysis.taskKind);
    expect(analysis.expectedChangeIntent).toBe('read_only');
    expect(analysis.mentionedFiles).toContain('ui/src/App.tsx');
  });

  it('returns plan response mode for mutating tasks', () => {
    const analysis = analyzeCoderTask({
      message: 'fix ui/src/App.tsx',
      workspace: 'C:/Projects/react-engine-077',
    });

    expect(responseModeForAnalysis(analysis)).toBe('plan');
  });

  it('returns execute response mode when agent mode is selected', () => {
    const analysis = analyzeCoderTask({
      message: 'fix ui/src/App.tsx',
      workspace: 'C:/Projects/react-engine-077',
    });

    expect(responseModeForAnalysis(analysis, 'agent')).toBe('execute');
  });

  it('auto-approves mutating tasks when approval policy allows it', () => {
    const analysis = analyzeCoderTask({
      message: 'fix ui/src/App.tsx',
      workspace: 'C:/Projects/react-engine-077',
      approvalPolicy: 'auto_approve',
    });

    expect(analysis.requiresApproval).toBe(false);
    expect(analysis.approvalPolicy).toBe('auto_approve');
    expect(responseModeForAnalysis(analysis)).toBe('execute');
  });

  it('uses full access as an execute policy for mutating tasks', () => {
    const analysis = analyzeCoderTask({
      message: 'fix ui/src/App.tsx',
      workspace: 'C:/Projects/react-engine-077',
      approvalPolicy: 'full_access',
    });

    expect(analysis.requiresApproval).toBe(false);
    expect(analysis.approvalPolicy).toBe('full_access');
    expect(responseModeForAnalysis(analysis)).toBe('execute');
  });

  it('keeps read-only investigations in chat mode', () => {
    const analysis = analyzeCoderTask({
      message: 'review the current app',
      workspace: 'C:/Projects/react-engine-077',
    });

    expect(responseModeForAnalysis(analysis)).toBe('chat');
  });
});
