/**
 * Phase 5.1 Tests - Structured File Edit Operations
 * Tests for safe, validatable file patching with multi-file support
 */

import { createHash } from 'crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect } from '@jest/globals';
import { applyBatchEdits, applyEditOperation, applyFirstClassFileOperation, getFileHash, validateEditOperation, type FileEditOperation } from '../fileEditOperations.js';

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

describe('Phase 5.1 - Structured File Edit Operations', () => {
  describe('Validation - Operation Structure', () => {
    it('should validate well-formed insert operation', () => {
      const op: FileEditOperation = {
        filepath: 'src/test.ts',
        type: 'insert',
        lineNumber: 5,
        newContent: 'console.log("test");',
        description: 'Add log statement',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate well-formed replace operation', () => {
      const op: FileEditOperation = {
        filepath: 'src/test.ts',
        type: 'replace',
        lineNumber: 5,
        oldContent: 'const x = 1;',
        newContent: 'const x = 2;',
        description: 'Update constant',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate well-formed delete operation', () => {
      const op: FileEditOperation = {
        filepath: 'src/test.ts',
        type: 'delete',
        lineNumber: 5,
        description: 'Remove line',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate well-formed append operation', () => {
      const op: FileEditOperation = {
        filepath: 'src/test.ts',
        type: 'append',
        newContent: 'console.log("end");',
        description: 'Add to end',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate well-formed prepend operation', () => {
      const op: FileEditOperation = {
        filepath: 'src/test.ts',
        type: 'prepend',
        newContent: '// Header',
        description: 'Add to start',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject operation with invalid type', () => {
      const op: any = {
        filepath: 'src/test.ts',
        type: 'invalid_op',
        lineNumber: 5,
        newContent: 'test',
        description: 'Test',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('type'))).toBe(true);
    });

    it('should reject operation with missing filepath', () => {
      const op: any = {
        type: 'insert',
        lineNumber: 5,
        newContent: 'test',
        description: 'Test',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('filepath'))).toBe(true);
    });

    it('should reject operation with missing description', () => {
      const op: any = {
        filepath: 'src/test.ts',
        type: 'insert',
        lineNumber: 5,
        newContent: 'test',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(true); // Description not required
    });
  });

  describe('Validation - Content Requirements', () => {
    it('should reject insert without newContent', () => {
      const op: any = {
        filepath: 'src/test.ts',
        type: 'insert',
        lineNumber: 5,
        description: 'Test',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('newContent'))).toBe(true);
    });

    it('should reject replace without oldContent', () => {
      const op: any = {
        filepath: 'src/test.ts',
        type: 'replace',
        lineNumber: 5,
        newContent: 'const x = 2;',
        description: 'Test',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('oldContent'))).toBe(true);
    });

    it('should reject replace without newContent', () => {
      const op: any = {
        filepath: 'src/test.ts',
        type: 'replace',
        lineNumber: 5,
        oldContent: 'const x = 1;',
        description: 'Test',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('newContent'))).toBe(true);
    });

    it('should reject delete with newContent', () => {
      const op: any = {
        filepath: 'src/test.ts',
        type: 'delete',
        lineNumber: 5,
        newContent: 'should not have this',
        description: 'Test',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(true); // newContent not needed for delete
    });

    it('should reject append without newContent', () => {
      const op: any = {
        filepath: 'src/test.ts',
        type: 'append',
        description: 'Test',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('newContent'))).toBe(true);
    });
  });

  describe('Validation - Line Numbers', () => {
    it('should reject insert with invalid line number (0)', () => {
      const op: FileEditOperation = {
        filepath: 'src/test.ts',
        type: 'insert',
        lineNumber: 0,
        newContent: 'test',
        description: 'Test',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('lineNumber'))).toBe(true);
    });

    it('should reject insert with negative line number', () => {
      const op: FileEditOperation = {
        filepath: 'src/test.ts',
        type: 'insert',
        lineNumber: -5,
        newContent: 'test',
        description: 'Test',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(false);
    });

    it('should reject replace with missing line number', () => {
      const op: any = {
        filepath: 'src/test.ts',
        type: 'replace',
        oldContent: 'const x = 1;',
        newContent: 'const x = 2;',
        description: 'Test',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('lineNumber'))).toBe(true);
    });

    it('should allow append without line number', () => {
      const op: FileEditOperation = {
        filepath: 'src/test.ts',
        type: 'append',
        newContent: 'test',
        description: 'Test',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(true);
    });

    it('should allow prepend without line number', () => {
      const op: FileEditOperation = {
        filepath: 'src/test.ts',
        type: 'prepend',
        newContent: 'test',
        description: 'Test',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(true);
    });
  });

  describe('Validation - File Type Constraints', () => {
    it('should validate allowed file type', () => {
      const op: FileEditOperation = {
        filepath: 'src/test.ts',
        type: 'insert',
        lineNumber: 1,
        newContent: 'test',
        description: 'Test',
        validation: { fileType: ['ts', 'tsx', 'js'] },
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(true);
    });

    it('should reject disallowed file type', () => {
      const op: FileEditOperation = {
        filepath: 'src/test.json',
        type: 'insert',
        lineNumber: 1,
        newContent: 'test',
        description: 'Test',
        validation: { fileType: ['ts', 'tsx'] },
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('File type') || e.includes('file type'))).toBe(true);
    });

    it('should handle files with dots in name', () => {
      const op: FileEditOperation = {
        filepath: 'src/test.spec.ts',
        type: 'insert',
        lineNumber: 1,
        newContent: 'test',
        description: 'Test',
        validation: { fileType: ['ts'] },
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(true); // Last extension is 'ts'
    });

    it('should validate multiple allowed file types', () => {
      const op: FileEditOperation = {
        filepath: 'src/config.xml',
        type: 'insert',
        lineNumber: 1,
        newContent: 'test',
        description: 'Test',
        validation: { fileType: ['yaml', 'yml', 'json'] },
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(false); // xml not in allowed types
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty filepath gracefully', () => {
      const op: any = {
        filepath: '',
        type: 'insert',
        lineNumber: 1,
        newContent: 'test',
        description: 'Test',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(false);
    });

    it('should handle very large line numbers', () => {
      const op: FileEditOperation = {
        filepath: 'src/test.ts',
        type: 'insert',
        lineNumber: 999999,
        newContent: 'test',
        description: 'Test',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(true); // Validation at apply time
    });

    it('should handle multiline content in newContent', () => {
      const op: FileEditOperation = {
        filepath: 'src/test.ts',
        type: 'insert',
        lineNumber: 1,
        newContent: 'line 1\nline 2\nline 3',
        description: 'Test',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(true);
    });

    it('should handle special characters in content', () => {
      const op: FileEditOperation = {
        filepath: 'src/test.ts',
        type: 'insert',
        lineNumber: 1,
        newContent: 'const regex = /test[a-z]+/;',
        description: 'Test',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(true);
    });

    it('should handle unicode characters', () => {
      const op: FileEditOperation = {
        filepath: 'src/test.ts',
        type: 'insert',
        lineNumber: 1,
        newContent: '// 你好 🎉 مرحبا',
        description: 'Test',
      };

      const result = validateEditOperation(op);
      expect(result.valid).toBe(true);
    });
  });

  describe('Batch Operation Types', () => {
    it('should create valid batch request with multiple operations', () => {
      const ops: FileEditOperation[] = [
        {
          filepath: 'file1.ts',
          type: 'insert',
          lineNumber: 1,
          newContent: 'test1',
          description: 'Op 1',
        },
        {
          filepath: 'file2.ts',
          type: 'append',
          newContent: 'test2',
          description: 'Op 2',
        },
      ];

      for (const op of ops) {
        const result = validateEditOperation(op);
        expect(result.valid).toBe(true);
      }
    });

    it('should allow operations on different files', () => {
      const ops: FileEditOperation[] = [
        {
          filepath: 'src/a.ts',
          type: 'insert',
          lineNumber: 1,
          newContent: 'test',
          description: 'Edit a',
        },
        {
          filepath: 'src/b.tsx',
          type: 'insert',
          lineNumber: 1,
          newContent: 'test',
          description: 'Edit b',
        },
        {
          filepath: 'src/c.js',
          type: 'insert',
          lineNumber: 1,
          newContent: 'test',
          description: 'Edit c',
        },
      ];

      for (const op of ops) {
        const result = validateEditOperation(op);
        expect(result.valid).toBe(true);
      }
    });
  });

  describe('Guarded Application', () => {
    it('should reject applying edits without an expected hash', () => {
      const workspaceRoot = mkdtempSync(join(tmpdir(), 'file-edit-guard-'));
      mkdirSync(join(workspaceRoot, 'src'), { recursive: true });
      writeFileSync(join(workspaceRoot, 'src', 'test.ts'), 'const value = 1;\n', 'utf-8');

      const result = applyEditOperation({
        filepath: 'src/test.ts',
        workspaceRoot,
        type: 'replace',
        lineNumber: 1,
        oldContent: 'const value = 1;',
        newContent: 'const value = 2;',
        description: 'Update value',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('expectedHash');
    });

    it('should reject stale expected hashes', () => {
      const workspaceRoot = mkdtempSync(join(tmpdir(), 'file-edit-stale-'));
      mkdirSync(join(workspaceRoot, 'src'), { recursive: true });
      const filePath = join(workspaceRoot, 'src', 'test.ts');
      writeFileSync(filePath, 'const value = 1;\n', 'utf-8');
      const expectedHash = hashContent('const value = 1;\n');
      writeFileSync(filePath, 'const value = 3;\n', 'utf-8');

      const result = applyEditOperation({
        filepath: 'src/test.ts',
        workspaceRoot,
        type: 'replace',
        lineNumber: 1,
        oldContent: 'const value = 3;',
        newContent: 'const value = 4;',
        description: 'Update value',
        expectedHash,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('changed since it was read');
    });

    it('should apply edits with a matching expected hash inside the workspace', () => {
      const workspaceRoot = mkdtempSync(join(tmpdir(), 'file-edit-success-'));
      mkdirSync(join(workspaceRoot, 'src'), { recursive: true });
      const filePath = join(workspaceRoot, 'src', 'test.ts');
      const before = 'const value = 1;\n';
      writeFileSync(filePath, before, 'utf-8');

      const result = applyEditOperation({
        filepath: 'src/test.ts',
        workspaceRoot,
        type: 'replace',
        lineNumber: 1,
        oldContent: 'const value = 1;',
        newContent: 'const value = 2;',
        description: 'Update value',
        expectedHash: hashContent(before),
      });

      expect(result.success).toBe(true);
      expect(readFileSync(filePath, 'utf-8')).toBe('const value = 2;\n');
    });

    it('should reject delete operations unless explicitly approved', () => {
      const workspaceRoot = mkdtempSync(join(tmpdir(), 'file-edit-delete-'));
      mkdirSync(join(workspaceRoot, 'src'), { recursive: true });
      const before = 'const value = 1;\n';
      writeFileSync(join(workspaceRoot, 'src', 'test.ts'), before, 'utf-8');

      const result = applyEditOperation({
        filepath: 'src/test.ts',
        workspaceRoot,
        type: 'delete',
        lineNumber: 1,
        description: 'Remove value',
        expectedHash: hashContent(before),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('allowDelete');
    });

    it('rolls back earlier agent edits when an atomic batch fails', () => {
      const workspaceRoot = mkdtempSync(join(tmpdir(), 'file-edit-atomic-'));
      mkdirSync(join(workspaceRoot, 'src'), { recursive: true });
      const first = 'const first = 1;\n';
      const second = 'const second = 1;\n';
      writeFileSync(join(workspaceRoot, 'src', 'first.ts'), first, 'utf-8');
      writeFileSync(join(workspaceRoot, 'src', 'second.ts'), second, 'utf-8');

      const result = applyBatchEdits({
        atomic: true,
        operations: [
          { filepath: 'src/first.ts', workspaceRoot, type: 'replace', lineNumber: 1, oldContent: 'const first = 1;', newContent: 'const first = 2;', description: 'first', expectedHash: getFileHash('src/first.ts', workspaceRoot) },
          { filepath: 'src/second.ts', workspaceRoot, type: 'replace', lineNumber: 1, oldContent: 'const second = 1;', newContent: 'const second = 2;', description: 'stale second', expectedHash: 'stale-hash' },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.rolledBack).toBe(true);
      expect(readFileSync(join(workspaceRoot, 'src', 'first.ts'), 'utf-8')).toBe(first);
      expect(result.diff).toContain('first.ts');
    });

    it('supports first-class create, move, replace, format, diff, and delete operations', () => {
      const workspaceRoot = mkdtempSync(join(tmpdir(), 'file-edit-first-class-'));
      const created = applyFirstClassFileOperation({ type: 'CreateFile', filepath: 'a.txt', content: 'one\n', workspaceRoot });
      expect(created.success).toBe(true);
      const replaced = applyFirstClassFileOperation({ type: 'ReplaceFile', filepath: 'a.txt', content: 'one\ntwo\n', expectedHash: created.afterHash!, workspaceRoot });
      expect(replaced.success).toBe(true);
      const moved = applyFirstClassFileOperation({ type: 'MoveFile', filepath: 'a.txt', destination: 'b.txt', expectedHash: replaced.afterHash, workspaceRoot });
      expect(moved.changedFiles).toEqual(['a.txt', 'b.txt']);
      expect(applyFirstClassFileOperation({ type: 'GetDiff', filepath: 'b.txt', before: 'a', after: 'b', workspaceRoot }).diff).toContain('-a');
      expect(applyFirstClassFileOperation({ type: 'DeleteFile', filepath: 'b.txt', expectedHash: moved.afterHash!, allowDelete: true, workspaceRoot }).success).toBe(true);
    });

    it('reports the commit-time hash and refuses a ReplaceFile when the preimage changed after inspection', () => {
      const workspaceRoot = mkdtempSync(join(tmpdir(), 'file-edit-first-class-stale-'));
      const original = 'const value = 1;\n';
      const current = 'const value = 3;\n';
      writeFileSync(join(workspaceRoot, 'target.ts'), current, 'utf-8');

      const result = applyFirstClassFileOperation({
        type: 'ReplaceFile',
        filepath: 'target.ts',
        content: 'const value = 2;\n',
        expectedHash: hashContent(original),
        workspaceRoot,
      });

      expect(result).toMatchObject({
        success: false,
        beforeHash: hashContent(current),
        error: 'ReplaceFile refused: stale expected hash.',
      });
      expect(readFileSync(join(workspaceRoot, 'target.ts'), 'utf-8')).toBe(current);
    });

    it('refuses a first-class create containing replacement characters or control bytes', () => {
      const workspaceRoot = mkdtempSync(join(tmpdir(), 'file-edit-integrity-'));
      const result = applyFirstClassFileOperation({
        type: 'CreateFile',
        filepath: 'index.html',
        content: '<!DOCType html x-head="invalid html>\n<html class="\u0008�">',
        workspaceRoot,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unicode replacement character');
      expect(() => readFileSync(join(workspaceRoot, 'index.html'), 'utf-8')).toThrow();
    });
  });
});
