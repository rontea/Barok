import { describe, expect, it } from '@jest/globals';
import {
  isVerificationArtifactPath,
  verificationCheckForAction,
  verificationCommandReferencesFile,
} from '../verification-action';

describe('verification actions', () => {
  it('recognizes a Node smoke-test script as project verification', () => {
    expect(verificationCheckForAction('Bash', { command: 'node smoke-test.js' })).toBe('project-verification');
    expect(verificationCheckForAction('Bash', { command: 'node .\\smoke-test.js' })).toBe('project-verification');
  });

  it('allows only referenced smoke-test artifacts as runtime candidates', () => {
    const artifact = 'C:\\MPC Project Test\\Pacman\\smoke-test.js';

    expect(isVerificationArtifactPath(artifact)).toBe(true);
    expect(verificationCommandReferencesFile('Bash', { command: 'node smoke-test.js' }, artifact)).toBe(true);
    expect(verificationCommandReferencesFile('Bash', { command: 'node unrelated.js' }, artifact)).toBe(false);
    expect(isVerificationArtifactPath('C:\\MPC Project Test\\Pacman\\game.js')).toBe(false);
  });
});
