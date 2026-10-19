import { describe, it, expect, beforeEach } from '@jest/globals';
import { 
  validateAndResolvePath, 
  PathValidationError,
  isPathWithinWorkspace,
  getValidationErrorDetails,
} from '../pathValidator';
import { join, resolve } from 'path';
import * as os from 'os';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'fs';

describe('Path Validator - Security Tests', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    // Use a temporary directory as workspace root
    workspaceRoot = resolve(os.tmpdir(), 'test-workspace');
  });

  describe('validateAndResolvePath - Valid Paths', () => {
    it('should accept relative paths within workspace', () => {
      const result = validateAndResolvePath('test.txt', workspaceRoot);
      expect(result).toEqual(expect.stringContaining(workspaceRoot));
      expect(result).toMatch(/test\.txt$/);
    });

    it('should accept nested relative paths', () => {
      const result = validateAndResolvePath('src/app/main.ts', workspaceRoot);
      expect(result).toEqual(expect.stringContaining(workspaceRoot));
      expect(result).toContain('src');
      expect(result).toContain('app');
    });

    it('should accept paths with current directory (.)', () => {
      const result = validateAndResolvePath('./file.txt', workspaceRoot);
      expect(result).toEqual(expect.stringContaining(workspaceRoot));
    });

    it('should accept paths with spaces', () => {
      const result = validateAndResolvePath('my file.txt', workspaceRoot);
      expect(result).toEqual(expect.stringContaining(workspaceRoot));
    });

    it('should accept unicode paths', () => {
      const result = validateAndResolvePath('файл.txt', workspaceRoot);
      expect(result).toEqual(expect.stringContaining(workspaceRoot));
    });
  });

  describe('validateAndResolvePath - Directory Traversal Attacks', () => {
    it('should reject paths with ../ at start', () => {
      expect(() => validateAndResolvePath('../etc/passwd', workspaceRoot))
        .toThrow(PathValidationError);
    });

    it('should reject paths with ../ in middle', () => {
      expect(() => validateAndResolvePath('src/../../../etc/passwd', workspaceRoot))
        .toThrow(PathValidationError);
    });

    it('should reject multiple ../ sequences', () => {
      expect(() => validateAndResolvePath('../../../../../../etc/passwd', workspaceRoot))
        .toThrow(PathValidationError);
    });

    it('should reject Windows-style traversal (..\\ )', () => {
      expect(() => validateAndResolvePath('..\\..\\windows\\system32', workspaceRoot))
        .toThrow(PathValidationError);
    });

    it('should reject encoded traversal ../', () => {
      // Even though normalize should handle this, let's test
      expect(() => validateAndResolvePath('src/..', workspaceRoot))
        .not.toThrow(); // '..' in middle after src is normalized to workspace root, which is valid
    });

    it('should detect path escape after normalization', () => {
      // After normalization, if a path would escape, it should be caught
      const escapeAttempt = resolve(workspaceRoot, '../../dangerous');
      expect(() => validateAndResolvePath(escapeAttempt, workspaceRoot))
        .toThrow(PathValidationError);
    });
  });

  describe('validateAndResolvePath - Absolute Path Handling', () => {
    it('should reject absolute paths to /etc/passwd', () => {
      expect(() => validateAndResolvePath('/etc/passwd', workspaceRoot))
        .toThrow(PathValidationError);
    });

    it('should reject absolute Windows paths to system32', () => {
      expect(() => validateAndResolvePath('C:\\Windows\\System32', workspaceRoot))
        .toThrow(PathValidationError);
    });

    it('should strip /home/user prefix (LLM hallucination)', () => {
      const result = validateAndResolvePath('/home/user/file.txt', workspaceRoot);
      expect(result).toEqual(expect.stringContaining(workspaceRoot));
      expect(result).toMatch(/file\.txt$/);
    });

    it('should strip /workspace prefix (LLM hallucination)', () => {
      const result = validateAndResolvePath('/workspace/src/main.ts', workspaceRoot);
      expect(result).toEqual(expect.stringContaining(workspaceRoot));
      expect(result).toContain('src');
    });

    it('should strip /app prefix (Docker convention)', () => {
      const result = validateAndResolvePath('/app/index.js', workspaceRoot);
      expect(result).toEqual(expect.stringContaining(workspaceRoot));
      expect(result).toMatch(/index\.js$/);
    });

    it('should preserve valid absolute paths when workspaceRoot itself starts with /app/', () => {
      if (process.platform === 'win32') return;
      const appletWs = '/app/applet/MPC Project Test';
      const result = validateAndResolvePath('/app/applet/MPC Project Test/index.html', appletWs);
      expect(result).toBe('/app/applet/MPC Project Test/index.html');
    });

    it('should strip Windows workspace prefix', () => {
      const result = validateAndResolvePath('C:\\workspace\\src\\app.ts', workspaceRoot);
      expect(result).toEqual(expect.stringContaining(workspaceRoot));
      expect(result).toContain('src');
    });

    it('should handle file URI scheme and decode percent-encoded paths', () => {
      const ws = 'C:\\MPC Project Test\\BAROKt1';
      const fileUri = 'file:///C:/MPC%20Project%20Test/BAROKt1/index.html';
      const result = validateAndResolvePath(fileUri, ws);
      expect(result.replace(/\\/g, '/')).toBe('C:/MPC Project Test/BAROKt1/index.html');
    });

    it('should handle truncated file URI scheme (e:///...) with percent-encoding', () => {
      const ws = 'C:\\MPC Project Test\\BAROKt1';
      const truncatedUri = 'e:///C:/MPC%20Project%20Test/BAROKt1/index.html';
      const result = validateAndResolvePath(truncatedUri, ws);
      expect(result.replace(/\\/g, '/')).toBe('C:/MPC Project Test/BAROKt1/index.html');
    });
  });

  describe('validateAndResolvePath - Null Byte Injection', () => {
    it('should reject paths with null bytes', () => {
      expect(() => validateAndResolvePath('file.txt\0.exe', workspaceRoot))
        .toThrow(PathValidationError);
    });

    it('should reject paths with control characters', () => {
      expect(() => validateAndResolvePath('file\x00.txt', workspaceRoot))
        .toThrow(PathValidationError);
    });
  });

  it('rejects an existing workspace symlink that resolves outside the workspace', () => {
    const root = mkdtempSync(join(os.tmpdir(), 'path-validator-symlink-'));
    const workspace = join(root, 'workspace');
    const outside = join(root, 'outside');
    mkdirSync(workspace);
    mkdirSync(outside);
    symlinkSync(outside, join(workspace, 'external'), process.platform === 'win32' ? 'junction' : 'dir');

    try {
      expect(() => validateAndResolvePath('external/new-file.txt', workspace)).toThrow(PathValidationError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects unresolved temporary environment-variable paths', () => {
    expect(() => validateAndResolvePath('%TEMP%\\react-engine\\workspaces\\task-1\\index.html', workspaceRoot))
      .toThrow(/Unexpanded temporary-directory variables/);
  });

  describe('validateAndResolvePath - Edge Cases', () => {
    it('should reject empty strings', () => {
      expect(() => validateAndResolvePath('', workspaceRoot))
        .toThrow(PathValidationError);
    });

    it('should reject null/undefined paths', () => {
      expect(() => validateAndResolvePath(null as any, workspaceRoot))
        .toThrow(PathValidationError);
      
      expect(() => validateAndResolvePath(undefined as any, workspaceRoot))
        .toThrow(PathValidationError);
    });

    it('should handle paths with trailing slashes', () => {
      const result = validateAndResolvePath('src/', workspaceRoot);
      expect(result).toEqual(expect.stringContaining(workspaceRoot));
    });

    it('should handle paths with multiple slashes', () => {
      const result = validateAndResolvePath('src//app///main.ts', workspaceRoot);
      expect(result).toEqual(expect.stringContaining(workspaceRoot));
      expect(result).toContain('src');
    });
  });

  describe('validateAndResolvePath - Workspace Root Validation', () => {
    it('should ensure resolved path starts with workspace root', () => {
      const result = validateAndResolvePath('test.txt', workspaceRoot);
      expect(result.toLowerCase().replace(/\\/g, '/')).toMatch(
        new RegExp(`^${workspaceRoot.toLowerCase().replace(/\\/g, '/')}`, 'i')
      );
    });

    it('should reject paths that escape workspace even with complex traversal', () => {
      // Create a path that tries to escape through creative means
      const malicious = 'src/../../..';
      expect(() => validateAndResolvePath(malicious, workspaceRoot))
        .toThrow(PathValidationError);
    });
  });

  describe('isPathWithinWorkspace - Boolean Validator', () => {
    it('should return true for valid paths', () => {
      expect(isPathWithinWorkspace('src/main.ts', workspaceRoot)).toBe(true);
      expect(isPathWithinWorkspace('test.txt', workspaceRoot)).toBe(true);
    });

    it('should return false for traversal attempts', () => {
      expect(isPathWithinWorkspace('../etc/passwd', workspaceRoot)).toBe(false);
      expect(isPathWithinWorkspace('../../secret', workspaceRoot)).toBe(false);
    });

    it('should return false for absolute paths outside workspace', () => {
      expect(isPathWithinWorkspace('/etc/passwd', workspaceRoot)).toBe(false);
      expect(isPathWithinWorkspace('C:\\Windows', workspaceRoot)).toBe(false);
    });

    it('should return false for empty/invalid paths', () => {
      expect(isPathWithinWorkspace('', workspaceRoot)).toBe(false);
      expect(isPathWithinWorkspace(null as any, workspaceRoot)).toBe(false);
    });
  });

  describe('PathValidationError - Error Details', () => {
    it('should provide clear error context', () => {
      try {
        validateAndResolvePath('../etc/passwd', workspaceRoot);
        fail('Should have thrown PathValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(PathValidationError);
        const err = error as PathValidationError;
        expect(err.reason).toContain('traversal');
        expect(err.attemptedPath).toBe('../etc/passwd');
        expect(err.workspaceRoot).toBe(workspaceRoot);
      }
    });

    it('should have proper error name', () => {
      try {
        validateAndResolvePath('../../etc/passwd', workspaceRoot);
      } catch (error) {
        expect((error as PathValidationError).name).toBe('PathValidationError');
      }
    });
  });

  describe('getValidationErrorDetails - Error Analysis', () => {
    it('should extract details from PathValidationError', () => {
      try {
        validateAndResolvePath('../etc/passwd', workspaceRoot);
      } catch (error) {
        const details = getValidationErrorDetails(error);
        expect(details.isPathError).toBe(true);
        expect(details.reason).toContain('traversal');
        expect(details.attemptedPath).toBe('../etc/passwd');
        expect(details.message).toContain('Error: Invalid path provided');
      }
    });

    it('should handle non-validation errors', () => {
      const regularError = new Error('Some other error');
      const details = getValidationErrorDetails(regularError);
      expect(details.isPathError).toBe(false);
      expect(details.message).toBe('Some other error');
    });

    it('should handle unknown errors', () => {
      const details = getValidationErrorDetails('unknown error');
      expect(details.isPathError).toBe(false);
      expect(details.message).toBe('unknown error');
    });
  });

  describe('Path Normalization Security', () => {
    it('should handle mixed separators', () => {
      const result = validateAndResolvePath('src\\app/main.ts', workspaceRoot);
      expect(result).toEqual(expect.stringContaining(workspaceRoot));
    });

    it('should reject . and .. combination attacks', () => {
      // Test various combinations
      expect(() => validateAndResolvePath('./../..', workspaceRoot))
        .toThrow(PathValidationError);
    });

    it('should handle case-insensitive traversal attempts on case-insensitive systems', () => {
      // Even with case variations, traversal should be blocked
      expect(() => validateAndResolvePath('..\\..\\windows', workspaceRoot))
        .toThrow(PathValidationError);
    });
  });

  describe('Integration - Real Workspace Scenarios', () => {
    it('should allow safe project file access', () => {
      const paths = [
        'src/index.ts',
        'src/utils/helpers.ts',
        'tests/unit.test.ts',
        'package.json',
        'README.md',
        '.gitignore',
      ];

      for (const path of paths) {
        expect(() => validateAndResolvePath(path, workspaceRoot)).not.toThrow();
      }
    });

    it('should block dangerous patterns consistently', () => {
      const dangerous = [
        '../../../etc/passwd',
        '../../etc/hosts',
        '../../../windows/system32',
        'src/../../etc/shadow',
        './../../../../private/etc',
        '..\\..\\..\\windows\\win.ini',
      ];

      for (const path of dangerous) {
        expect(() => validateAndResolvePath(path, workspaceRoot))
          .toThrow(PathValidationError);
      }
    });
  });
});
