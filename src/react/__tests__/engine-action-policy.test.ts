import { classifyPolicyAction } from '@barok/engine';

describe('Engine public action policy', () => {
  it.each([
    [{ action: 'Read' }, { category: 'read', risk: 'low' }],
    [{ action: 'Write' }, { category: 'write', risk: 'medium' }],
    [{ action: 'PackageInstall', action_input: { packages: ['typescript'] } }, { category: 'install', risk: 'high' }],
    [{ action: 'Bash', action_input: { command: 'rm -rf target' } }, { category: 'destructive', risk: 'critical' }],
    [{ action: 'Command', action_input: { operation: 'git_status' } }, { category: 'read', risk: 'low' }],
  ])('classifies %j', (action, expected) => {
    expect(classifyPolicyAction(action)).toEqual(expected);
  });
});
