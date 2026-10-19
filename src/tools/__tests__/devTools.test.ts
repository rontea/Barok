/**
 * Dev Tools Handler Tests (Simplified)
 * 
 * Tests cover:
 * - Task management operations
 */

import { jest, describe, it, beforeEach, expect } from '@jest/globals';
import * as fs from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  DEV_TOOLS,
  buildPackageInstallArgs,
  bashTool,
  commandTool,
  documentReadTool,
  disableFileMutationGuard,
  editFileTool,
  enableFileMutationGuard,
  getReadFileHash,
  globTool,
  grepTool,
  noteTool,
  packageNameFromSpecifier,
  readFileTool,
  runWithWorkspace,
  sampleTool,
  wikiTool,
  setWorkspace,
  taskCreateTool,
  taskListTool,
  taskUpdateTool,
  workspaceChangesTool,
  writeFileTool,
} from '../../tools/devTools';
import { saveKnowledgeSettings } from '../knowledgeSettings';

describe('Dev Tools Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    disableFileMutationGuard();
    setWorkspace(process.cwd());
  });

  it('rejects arbitrary temporary paths in search patterns', async () => {
    const staleTempPattern = '%TEMP%\\react-engine\\workspaces\\task-not-created\\**\\*';
    const glob = await globTool({ pattern: staleTempPattern });
    const grep = await grepTool({
      pattern: 'task',
      includePattern: staleTempPattern,
      type: 'files_with_matches',
      isRegex: true,
    });

    expect(glob.success).toBe(false);
    expect(grep.success).toBe(false);
    expect(glob.error).toMatch(/active workspace/i);
    expect(grep.error).toMatch(/active workspace/i);
  });

  describe('Task Management', () => {
    it('should create a task', async () => {
      const result = await taskCreateTool({
        subject: 'Test task',
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should list tasks', async () => {
      const result = await taskListTool();

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });
  });

  describe('Package installation', () => {
    it('registers a structured install tool with safe literal inputs', () => {
      expect(DEV_TOOLS.PackageInstall).toBeDefined();
      expect(DEV_TOOLS.PackageInstall.description).toContain('instead of Bash');
      expect(DEV_TOOLS.PackageInstall.inputSchema.properties).toEqual(expect.objectContaining({
        manager: expect.any(Object),
        packages: expect.any(Object),
        dev: expect.any(Object),
      }));
    });

    it('builds canonical manager arguments without shell composition', () => {
      expect(buildPackageInstallArgs({ manager: 'npm', packages: ['globals', '@eslint/js', 'globals'], dev: true, timeout: 300000 }))
        .toEqual(['install', '--save-dev', 'globals', '@eslint/js']);
      expect(buildPackageInstallArgs({ manager: 'pnpm', packages: ['vitest'], dev: true, timeout: 300000 }))
        .toEqual(['add', '-D', 'vitest']);
      expect(buildPackageInstallArgs({ manager: 'yarn', packages: [], dev: false, timeout: 300000 }))
        .toEqual(['install']);
      expect(packageNameFromSpecifier('@eslint/js@^9.0.0')).toBe('@eslint/js');
      expect(packageNameFromSpecifier('vitest@latest')).toBe('vitest');
      expect(packageNameFromSpecifier('https://example.test/package.tgz')).toBeUndefined();
    });
  });

  describe('Project Notes', () => {
    it('adds, lists, and retrieves a note by its stable reference', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-notes-'));

      const added = await runWithWorkspace(workspace, () => noteTool({
        operation: 'add',
        title: 'Architecture decision',
        content: 'Keep the API boundary explicit.',
      }));

      expect(added.success).toBe(true);
      expect(added.output).toContain('Reference: note:architecture-decision-');
      expect(added.output).toContain('Path: .react-engine/notes/');

      const reference = added.output!.match(/Reference: (note:[a-z0-9-]+)/)![1];
      const listed = await runWithWorkspace(workspace, () => noteTool({ operation: 'list' }));
      const retrieved = await runWithWorkspace(workspace, () => noteTool({
        operation: 'get',
        note_id: reference,
      }));

      expect(listed.success).toBe(true);
      expect(listed.output).toContain(`${reference} — Architecture decision`);
      expect(retrieved.success).toBe(true);
      expect(retrieved.output).toContain('Keep the API boundary explicit.');
    });

    it('keeps notes isolated to the active project workspace', async () => {
      const firstWorkspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-notes-one-'));
      const secondWorkspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-notes-two-'));

      await runWithWorkspace(firstWorkspace, () => noteTool({
        operation: 'add',
        title: 'First project',
        content: 'Only visible in the first project.',
      }));

      const secondList = await runWithWorkspace(
        secondWorkspace,
        () => noteTool({ operation: 'list' })
      );
      expect(secondList.output).toBe('No project notes have been saved.');
    });

    it('registers the Note tool with an explicit operation schema', () => {
      expect(DEV_TOOLS.Note).toBeDefined();
      expect(DEV_TOOLS.Note.inputSchema.required).toContain('operation');
    });
  });

  describe('Project Samples', () => {
    it('adds, searches, lists, and retrieves a reusable sample', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-samples-'));
      await saveKnowledgeSettings(workspace, { sampleLookupEnabled: true });
      const added = await runWithWorkspace(workspace, () => sampleTool({
        operation: 'add',
        title: 'Express health route',
        description: 'A minimal health-check endpoint.',
        content: "app.get('/health', (_request, response) => response.json({ ok: true }));",
        language: 'typescript',
        tags: ['express', 'api'],
      }));

      expect(added.success).toBe(true);
      expect(added.output).toContain('Reference: sample:express-health-route-');
      expect(added.output).toContain('Path: .react-engine/samples/');
      const reference = added.output!.match(/Reference: (sample:[a-z0-9-]+)/)![1];

      const listed = await runWithWorkspace(workspace, () => sampleTool({ operation: 'list' }));
      const searched = await runWithWorkspace(workspace, () => sampleTool({
        operation: 'search',
        query: 'express health',
      }));
      const retrieved = await runWithWorkspace(workspace, () => sampleTool({
        operation: 'get',
        sample_id: reference,
      }));

      expect(listed.output).toContain(`${reference} — Express health route`);
      expect(listed.output).toContain('language: typescript');
      expect(searched.output).toContain(reference);
      expect(retrieved.output).toContain("app.get('/health'");
      expect(retrieved.output).toContain('Tags: express, api');
    });

    it('keeps the sample repository isolated to its project', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-empty-samples-'));
      await saveKnowledgeSettings(workspace, { sampleLookupEnabled: true });
      const listed = await runWithWorkspace(workspace, () => sampleTool({ operation: 'list' }));
      expect(listed.output).toBe('No project samples have been saved.');
    });

    it('lets the user configure a workspace-relative sample folder', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-custom-samples-'));
      await saveKnowledgeSettings(workspace, { sampleLookupEnabled: true });
      const configured = await runWithWorkspace(workspace, () => sampleTool({
        operation: 'set_folder',
        folder: 'examples/agent-samples',
      }));
      const currentFolder = await runWithWorkspace(
        workspace,
        () => sampleTool({ operation: 'get_folder' })
      );
      const added = await runWithWorkspace(workspace, () => sampleTool({
        operation: 'add',
        title: 'Custom location',
        content: 'Stored outside the default hidden folder.',
      }));

      expect(configured.output).toBe('Sample repository folder set to examples/agent-samples.');
      expect(currentFolder.output).toBe('Sample repository folder: examples/agent-samples');
      expect(added.output).toContain('Path: examples/agent-samples/');
    });

    it('rejects sample folders outside the active project', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-safe-samples-'));
      const configured = await runWithWorkspace(workspace, () => sampleTool({
        operation: 'set_folder',
        folder: '../outside-samples',
      }));
      expect(configured.success).toBe(false);
      expect(configured.error).toContain('Directory traversal');
    });

    it('registers the Sample tool', () => {
      expect(DEV_TOOLS.Sample).toBeDefined();
      expect(DEV_TOOLS.Sample.inputSchema.required).toContain('operation');
    });

    it('enforces the project sample lookup toggle', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-disabled-samples-'));
      await saveKnowledgeSettings(workspace, { sampleLookupEnabled: false });
      const listed = await runWithWorkspace(workspace, () => sampleTool({ operation: 'list' }));
      expect(listed.success).toBe(false);
      expect(listed.error).toContain('disabled');
    });
  });

  describe('Project Wiki', () => {
    it('lists, searches, and reads user-authored Markdown pages when enabled', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-wiki-'));
      await saveKnowledgeSettings(workspace, {
        wikiLookupEnabled: true,
        wikiFolder: 'docs/wiki',
      });
      await fs.mkdir(join(workspace, 'docs', 'wiki', 'guides'), { recursive: true });
      await fs.writeFile(
        join(workspace, 'docs', 'wiki', 'guides', 'setup.md'),
        '# Local setup\n\nInstall dependencies before running the development server.',
        'utf8',
      );

      const listed = await runWithWorkspace(workspace, () => wikiTool({ operation: 'list' }));
      const searched = await runWithWorkspace(workspace, () => wikiTool({
        operation: 'search',
        query: 'development server',
      }));
      const retrieved = await runWithWorkspace(workspace, () => wikiTool({
        operation: 'get',
        page: 'wiki:guides/setup',
      }));

      expect(listed.output).toContain('wiki:guides/setup — Local setup');
      expect(searched.output).toContain('wiki:guides/setup');
      expect(retrieved.output).toContain('Install dependencies');
      expect(retrieved.output).toContain('Path: docs/wiki/guides/setup.md');
    });

    it('does not expose wiki pages while wiki lookup is disabled', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-disabled-wiki-'));
      await fs.mkdir(join(workspace, 'wiki'), { recursive: true });
      await fs.writeFile(join(workspace, 'wiki', 'private.md'), '# Private');
      const listed = await runWithWorkspace(workspace, () => wikiTool({ operation: 'list' }));
      expect(listed.success).toBe(false);
      expect(listed.error).toContain('disabled');
    });

    it('hides only the project guide while its dedicated toggle is disabled', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-disabled-project-guide-'));
      await saveKnowledgeSettings(workspace, {
        wikiLookupEnabled: true,
        projectGuideEnabled: false,
      });
      await fs.writeFile(join(workspace, 'wiki', 'project-specification.md'), '# Private guide');
      await fs.writeFile(join(workspace, 'wiki', 'public.md'), '# Public page');

      const listed = await runWithWorkspace(workspace, () => wikiTool({ operation: 'list' }));
      const retrieved = await runWithWorkspace(workspace, () => wikiTool({
        operation: 'get',
        page: 'wiki:project-specification',
      }));

      expect(listed.output).not.toContain('wiki:project-specification');
      expect(listed.output).toContain('wiki:public');
      expect(retrieved.success).toBe(false);
      expect(retrieved.error).toContain('Project guide is disabled');
    });

    it('registers Wiki as a read-only lookup tool', () => {
      expect(DEV_TOOLS.Wiki).toBeDefined();
      expect(DEV_TOOLS.Wiki.inputSchema.required).toContain('operation');
    });
  });

  describe('Read', () => {
    it('suggests an existing sibling when a stray leading n makes the path missing', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-read-suggestion-'));
      await fs.writeFile(join(workspace, 'style.css'), 'body {}', 'utf8');

      const result = await runWithWorkspace(
        workspace,
        async () => readFileTool({ file_path: 'nstyle.css' })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Did you mean "style.css"?');
    });
  });

  describe('Bash', () => {
    it('rejects commands that explicitly inspect a path outside the target workspace', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-isolated-target-'));
      setWorkspace(workspace);
      const enginePath = process.cwd().replace(/\\/g, '/');

      const result = await bashTool({
        command: `echo ${enginePath}`,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Workspace isolation rejected');
      expect(result.error).toContain('outside the active target workspace');
    });

    it('rejects parent-directory traversal from the target workspace', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-no-parent-scan-'));
      setWorkspace(workspace);

      const result = await bashTool({
        command: 'dir ..',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('parent-directory traversal');
    });

    it('allows engine repo commands when the engine repo is the active workspace', async () => {
      setWorkspace(process.cwd());
      const enginePath = process.cwd().replace(/\\/g, '/');

      const result = await bashTool({
        command: `echo ${enginePath}`,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain(enginePath);
    });

    it('asks for confirmation before initializing Git in a non-repository workspace', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-gitless-'));
      setWorkspace(workspace);

      const result = await bashTool({
        command: 'git status --short',
        cwd: workspace,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('No Git repository was detected');
      expect(result.output).toContain('ask the user for confirmation');
      expect(result.output).toContain('git init');
    });
  });

  describe('Command', () => {
    it('returns typed unavailable status when a project command has no package file', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-commandless-'));
      setWorkspace(workspace);

      const result = await commandTool({ operation: 'test', timeout: 1000 });

      expect(result.success).toBe(false);
      expect(result.status).toBe('unavailable');
      expect(result.error).toContain('package.json not found');
    });

    it('registers the structured Command tool', () => {
      expect(DEV_TOOLS.Command).toBeDefined();
      expect(DEV_TOOLS.Command.description).toContain('platform-aware');
    });
  });

  describe('WorkspaceChanges', () => {
    it('reports recent files with hashes and ignores generated dependency folders', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-workspace-changes-'));
      await fs.mkdir(join(workspace, 'node_modules'), { recursive: true });
      await fs.writeFile(join(workspace, 'node_modules', 'ignored.js'), 'ignored');
      await fs.writeFile(join(workspace, 'products.html'), '<button>Add to cart</button>');

      const result = await runWithWorkspace(workspace, () => workspaceChangesTool({
        max_files: 10,
        max_depth: 3,
        include_hash: true,
      }));

      expect(result.success).toBe(true);
      const payload = JSON.parse(result.output || '{}');
      expect(payload.files).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'products.html', hash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      ]));
      expect(payload.files.map((file: { path: string }) => file.path)).not.toContain('node_modules/ignored.js');
      expect(payload.latestUpdateAt).toEqual(expect.any(Number));
    });

    it('is exposed as a read-only agent tool', () => {
      expect(DEV_TOOLS.WorkspaceChanges).toBeDefined();
      expect(DEV_TOOLS.WorkspaceChanges.description).toContain('read-only');
    });
  });

  describe('File Writes', () => {
    it('isolates concurrent agents with the same relative file path to their own workspaces', async () => {
      const firstWorkspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-agent-one-'));
      const secondWorkspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-agent-two-'));
      await fs.writeFile(join(firstWorkspace, 'target.txt'), 'first workspace');
      await fs.writeFile(join(secondWorkspace, 'target.txt'), 'second workspace');

      const [first, second] = await Promise.all([
        runWithWorkspace(firstWorkspace, async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return readFileTool({ file_path: 'target.txt' });
        }),
        runWithWorkspace(secondWorkspace, async () => readFileTool({ file_path: 'target.txt' })),
      ]);

      expect(first.output).toBe('first workspace');
      expect(second.output).toBe('second workspace');
    });

    it('rejects raw PDF reads and directs the agent to DocumentRead', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-document-read-'));
      await fs.writeFile(join(workspace, 'resume.pdf'), '%PDF-1.4 binary payload');
      setWorkspace(workspace);

      const result = await readFileTool({ file_path: 'resume.pdf' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Use DocumentRead');
      expect(DEV_TOOLS.DocumentRead).toBeDefined();
    });

    it('rejects unsupported DocumentRead file types without returning raw content', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-document-type-'));
      await fs.writeFile(join(workspace, 'resume.txt'), 'plain text');
      setWorkspace(workspace);

      const result = await documentReadTool({ file_path: 'resume.txt' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('supports PDF and DOCX');
    });

    it('should write base64-encoded UTF-8 content', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-base64-write-'));
      const content = '<!DOCTYPE html>\n<div data-note="C4">{ sound: "piano" }</div>\n';
      const result = await runWithWorkspace(workspace, () => writeFileTool({
          file_path: 'base64-write-test.html',
          content_base64: Buffer.from(content, 'utf-8').toString('base64'),
        }));

      expect(result.success).toBe(true);

      const readResult = await runWithWorkspace(workspace, () => readFileTool({ file_path: 'base64-write-test.html' }));
      expect(readResult.success).toBe(true);
      expect(readResult.output).toBe(content);
      expect(readResult.hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('rejects replacement characters and control bytes instead of persisting corrupt text', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-text-integrity-'));
      setWorkspace(workspace);

      const result = await writeFileTool({
        file_path: 'index.html',
        content: '<!DOCTYPE html>\n<html class="\u0008�">',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('content contains the Unicode replacement character');
      await expect(fs.access(join(workspace, 'index.html'))).rejects.toBeDefined();
    });

    it('rejects invalid UTF-8 bytes supplied through content_base64', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-invalid-utf8-'));
      setWorkspace(workspace);

      const result = await writeFileTool({
        file_path: 'index.html',
        content_base64: Buffer.from([0xC3, 0x28]).toString('base64'),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid UTF-8 bytes');
      await expect(fs.access(join(workspace, 'index.html'))).rejects.toBeDefined();
    });

    it('should append content when requested', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-append-write-'));
      const file_path = 'append-write-test.txt';

      const first = await runWithWorkspace(workspace, () => writeFileTool({ file_path, content: 'first\n' }));
      const second = await runWithWorkspace(workspace, () => writeFileTool({ file_path, content: 'second\n', append: true }));

      expect(first.success).toBe(true);
      expect(second.success).toBe(true);

      const readResult = await runWithWorkspace(workspace, () => readFileTool({ file_path }));
      expect(readResult.success).toBe(true);
      expect(readResult.output).toBe('first\nsecond\n');
    });

    it('should accept common LLM aliases for file path arguments', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-path-alias-'));
      const writeResult = await runWithWorkspace(workspace, () => DEV_TOOLS.Write.handler({
          path: 'path-alias-write-test.txt',
          content: 'alias-ok',
        }));

      expect((writeResult as any).success).toBe(true);

      const readResult = await runWithWorkspace(workspace, () => DEV_TOOLS.Read.handler({ filename: 'path-alias-write-test.txt' }));
      expect((readResult as any).success).toBe(true);
      expect((readResult as any).output).toBe('alias-ok');
    });

    it('should accept common LLM aliases for edit arguments', async () => {
      const workspace = await fs.mkdtemp(join(tmpdir(), 'react-engine-edit-alias-'));
      const file_path = 'edit-alias-test.txt';
      await runWithWorkspace(workspace, () => writeFileTool({ file_path, content: 'before' }));

      const editResult = await runWithWorkspace(workspace, () => DEV_TOOLS.Edit.handler({
          file: file_path,
          search: 'before',
          replace: 'after',
        }));

      expect((editResult as any).success).toBe(true);

      const readResult = await runWithWorkspace(workspace, () => readFileTool({ file_path }));
      expect(readResult.success).toBe(true);
      expect(readResult.output).toBe('after');
    });
  });

  describe('Guarded File Mutation', () => {
    it('should reject writing an existing file without allowOverwrite', async () => {
      const file_path = 'react_temp_test/guard-overwrite-test.txt';
      await writeFileTool({ file_path, content: 'original' });
      enableFileMutationGuard({
        relatedTaskId: 'guard-test',
        intents: [{ path: file_path, operation: 'modify', reason: 'test', relatedTaskId: 'guard-test' }],
      });

      const result = await writeFileTool({ file_path, content: 'overwrite' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('allowOverwrite');
    });

    it('should reject editing without prior read', async () => {
      const file_path = 'react_temp_test/guard-edit-without-read.txt';
      await writeFileTool({ file_path, content: 'before' });
      enableFileMutationGuard({
        relatedTaskId: 'guard-test',
        intents: [{ path: file_path, operation: 'modify', reason: 'test', relatedTaskId: 'guard-test' }],
      });

      const result = await editFileTool({
        file_path,
        old_string: 'before',
        new_string: 'after',
        expectedHash: 'not-a-real-hash',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('must be read before edit');
    });

    it('should reject editing a stale file hash', async () => {
      const file_path = 'react_temp_test/guard-stale-edit.txt';
      await writeFileTool({ file_path, content: 'before' });
      enableFileMutationGuard({
        relatedTaskId: 'guard-test',
        intents: [{ path: file_path, operation: 'modify', reason: 'test', relatedTaskId: 'guard-test' }],
      });

      await readFileTool({ file_path });
      const hash = getReadFileHash(file_path);
      await fs.writeFile(file_path, 'changed outside guard', 'utf-8');

      const result = await editFileTool({
        file_path,
        old_string: 'changed',
        new_string: 'updated',
        expectedHash: hash,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('changed since it was read');
    });

    it('should reject creating a file that already exists', async () => {
      const file_path = 'react_temp_test/guard-create-existing.txt';
      await writeFileTool({ file_path, content: 'already here' });
      enableFileMutationGuard({
        relatedTaskId: 'guard-test',
        intents: [{ path: file_path, operation: 'create', allowCreate: true, reason: 'test', relatedTaskId: 'guard-test' }],
      });

      const result = await writeFileTool({ file_path, content: 'new content', allowCreate: true });

      expect(result.success).toBe(false);
      expect(result.error).toContain('allowOverwrite');
    });

    it('should edit successfully with prior read and matching expected hash', async () => {
      const file_path = 'react_temp_test/guard-successful-edit.txt';
      await writeFileTool({ file_path, content: 'before' });
      enableFileMutationGuard({
        relatedTaskId: 'guard-test',
        intents: [{ path: file_path, operation: 'modify', reason: 'test', relatedTaskId: 'guard-test' }],
      });

      await readFileTool({ file_path });
      const hash = getReadFileHash(file_path);
      const result = await editFileTool({
        file_path,
        old_string: 'before',
        new_string: 'after',
        expectedHash: hash,
      });

      expect(result.success).toBe(true);
      const readResult = await readFileTool({ file_path });
      expect(readResult.output).toContain('after');
      expect(readResult.output).toContain('guarded-read-hash');
    });
  });
});
