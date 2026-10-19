import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from '@jest/globals';
import { evaluatePolicy, redactPolicyText } from '../permissionPolicy';

function context(mode: 'read_only' | 'ask' | 'scoped_auto_approve' | 'full_workspace', overrides: Record<string, unknown> = {}) {
  const workspace = mkdtempSync(path.join(tmpdir(), 'react-policy-'));
  return { workspace, mode, ...overrides } as any;
}

describe('permission policy', () => {
  it('treats DocumentRead as low-risk inspection in read-only mode', () => {
    const decision = evaluatePolicy(
      { action: 'DocumentRead', action_input: { file_path: 'resume.pdf' } },
      context('read_only'),
    );
    expect(decision).toMatchObject({ allowed: true, category: 'read', risk: 'low' });
  });

  it.each(['list_directory', 'file_exists', 'git_status', 'git_diff', 'git_log', 'process_inspect'])(
    'treats the built-in Command %s operation as read-only inspection',
    (operation) => {
      const decision = evaluatePolicy(
        { action: 'Command', action_input: { operation } },
        context('read_only'),
      );
      expect(decision).toMatchObject({ allowed: true, category: 'read', risk: 'low' });
    },
  );

  it('still blocks executable Command operations in read-only mode', () => {
    const decision = evaluatePolicy(
      { action: 'Command', action_input: { operation: 'test' } },
      context('read_only'),
    );
    expect(decision).toMatchObject({ allowed: false, category: 'command' });
  });

  it('allows note lookup but blocks adding a note in read-only mode', () => {
    const policy = context('read_only');
    const list = evaluatePolicy({ action: 'Note', action_input: { operation: 'list' } }, policy);
    const get = evaluatePolicy(
      { action: 'Note', action_input: { operation: 'get', note_id: 'note:decision-a1b2c3d4' } },
      policy,
    );
    const add = evaluatePolicy(
      { action: 'Note', action_input: { operation: 'add', title: 'Decision', content: 'Use SQLite.' } },
      policy,
    );

    expect(list).toMatchObject({ allowed: true, category: 'read', risk: 'low' });
    expect(get).toMatchObject({ allowed: true, category: 'read', risk: 'low' });
    expect(add).toMatchObject({ allowed: false, category: 'write', risk: 'medium' });
  });

  it('allows sample lookup but blocks adding a sample in read-only mode', () => {
    const policy = context('read_only');
    const search = evaluatePolicy(
      { action: 'Sample', action_input: { operation: 'search', query: 'express' } },
      policy,
    );
    const add = evaluatePolicy(
      { action: 'Sample', action_input: { operation: 'add', title: 'Route', content: 'example' } },
      policy,
    );
    const setFolder = evaluatePolicy(
      { action: 'Sample', action_input: { operation: 'set_folder', folder: 'examples/samples' } },
      policy,
    );

    expect(search).toMatchObject({ allowed: true, category: 'read', risk: 'low' });
    expect(add).toMatchObject({ allowed: false, category: 'write', risk: 'medium' });
    expect(setFolder).toMatchObject({ allowed: false, category: 'write', risk: 'medium' });
  });

  it('treats wiki lookup as read-only inspection', () => {
    const decision = evaluatePolicy(
      { action: 'Wiki', action_input: { operation: 'get', page: 'wiki:setup' } },
      context('read_only'),
    );
    expect(decision).toMatchObject({ allowed: true, category: 'read', risk: 'low' });
  });

  it.each([
    ['read_only', false],
    ['ask', false],
    ['scoped_auto_approve', true],
    ['full_workspace', true],
  ] as const)('applies the mode matrix to normal writes: %s', (mode, allowed) => {
    const decision = evaluatePolicy({ action: 'Write', action_input: { file_path: 'src/app.ts' } }, context(mode));
    expect(decision.allowed).toBe(allowed);
  });

  it('requires reusable explicit approval for destructive actions even in full-workspace mode', () => {
    const base = context('full_workspace');
    const action = { action: 'Bash', action_input: { command: 'git reset --hard' } };
    const denied = evaluatePolicy(action, base);
    expect(denied).toMatchObject({ allowed: false, requiresApproval: true, category: 'destructive', risk: 'critical' });

    const approved = evaluatePolicy(action, { ...base, approvedScopes: [denied.scope] });
    expect(approved).toMatchObject({ allowed: true, requiresApproval: false });
  });

  it('does not confuse PowerShell Format-Table with the destructive disk format command', () => {
    const listing = evaluatePolicy({
      action: 'Bash',
      action_input: { command: 'Get-ChildItem -Force | Format-Table -AutoSize | Out-String' },
    }, context('full_workspace'));
    expect(listing).toMatchObject({ allowed: true, category: 'command', risk: 'medium' });

    const diskFormat = evaluatePolicy(
      { action: 'Bash', action_input: { command: 'format C: /q' } },
      context('full_workspace'),
    );
    expect(diskFormat).toMatchObject({ allowed: false, category: 'destructive', risk: 'critical' });
  });

  it('never permits path traversal or an existing symlink escape', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'react-policy-workspace-'));
    const outside = mkdtempSync(path.join(tmpdir(), 'react-policy-outside-'));
    mkdirSync(path.join(workspace, 'src'));
    writeFileSync(path.join(outside, 'secret.txt'), 'outside');
    symlinkSync(outside, path.join(workspace, 'src', 'linked-outside'), 'junction');
    const policy = { workspace, mode: 'full_workspace' as const };

    expect(evaluatePolicy({ action: 'Write', action_input: { file_path: '../outside.txt' } }, policy).allowed).toBe(false);
    expect(evaluatePolicy({ action: 'Write', action_input: { file_path: 'src/linked-outside/secret.txt' } }, policy).allowed).toBe(false);
  });

  it('requires ownership before a process stop can be approved', () => {
    const action = { action: 'Bash', action_input: { command: 'taskkill /pid 4242 /f' } };
    expect(evaluatePolicy(action, context('full_workspace', { approvedScopes: ['*'] })).reason).toContain('not owned');
    expect(evaluatePolicy(action, context('full_workspace', { approvedScopes: ['*'], ownedProcessIds: [4242] })).allowed).toBe(true);
  });

  it('redacts secrets from policy summaries', () => {
    expect(redactPolicyText('curl https://example.test -H "Authorization: sk_live_123456789" --token=abc')).not.toContain('sk_live_123456789');
  });

  it('uses active persisted grants and honors an explicit deny over permissive mode', () => {
    const action = { action: 'Bash', action_input: { command: 'npm install example-package' } };
    const base = context('full_workspace');
    const requested = evaluatePolicy(action, base);
    const allowed = evaluatePolicy(action, { ...base, approvalGrants: [{ scope: requested.scope, decision: 'allow', createdAt: Date.now() }] });
    expect(allowed.allowed).toBe(true);
    const denied = evaluatePolicy(action, { ...base, approvalGrants: [{ scope: requested.scope, decision: 'deny', createdAt: Date.now() }] });
    expect(denied).toMatchObject({ allowed: false, requiresApproval: false });
    const expired = evaluatePolicy(action, { ...base, approvalGrants: [{ scope: requested.scope, decision: 'allow', createdAt: 1, expiresAt: 2 }] });
    expect(expired.allowed).toBe(false);
  });

  it('canonicalizes equivalent package installs into one reusable approval scope', () => {
    const base = context('full_workspace');
    const shortFlag = evaluatePolicy({
      action: 'Bash',
      action_input: { command: 'npm install -D globals @eslint/js' },
    }, base);
    const longFlag = evaluatePolicy({
      action: 'Bash',
      action_input: { command: 'npm.cmd i --save-dev @eslint/js globals' },
    }, base);
    const structured = evaluatePolicy({
      action: 'PackageInstall',
      action_input: { manager: 'npm', packages: ['@eslint/js', 'globals'], dev: true },
    }, base);

    expect(shortFlag.scope).toBe('install:npm:dev:@eslint/js,globals:cwd=.');
    expect(longFlag.scope).toBe(shortFlag.scope);
    expect(structured.scope).toBe(shortFlag.scope);
    expect(evaluatePolicy({
      action: 'PackageInstall',
      action_input: { manager: 'npm', packages: ['globals', '@eslint/js'], dev: true },
    }, {
      ...base,
      approvalGrants: [{ scope: shortFlag.scope, decision: 'allow', createdAt: Date.now() }],
    })).toMatchObject({ allowed: true, reason: 'Allowed by reusable approval scope.' });
  });
});
