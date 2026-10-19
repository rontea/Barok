import { describe, expect, it } from '@jest/globals';
import {
  buildFallbackAppSpec,
  createAppSpec,
  formatAppSpec,
  isAppBuildRequest,
  selectOutputMode,
} from '../app-spec';
import type { LLMProvider } from '../../di/types';
import { createAppSpec as createEngineAppSpec } from '@barok/engine';

function createMockLlm(response: string): LLMProvider {
  return {
    createChatCompletion: async () => response,
    estimateStepCost: () => 0,
    getProviderName: () => 'mock',
    isAvailable: () => true,
  };
}

describe('app spec contract', () => {
  it('exposes model-assisted app spec creation through the Engine public entry', async () => {
    const spec = await createEngineAppSpec(
      'Create a Vite React timer app',
      { createChatCompletion: async () => JSON.stringify({ appName: 'Focus Timer', outputMode: 'vite-react' }) },
      'mock',
    );

    expect(spec?.appName).toBe('Focus Timer');
    expect(spec?.outputMode).toBe('vite-react');
  });

  it('detects app-building requests without matching normal code maintenance tasks', () => {
    expect(isAppBuildRequest('Create a standalone todo app with localStorage')).toBe(true);
    expect(isAppBuildRequest('Build a neon snake game in a single HTML file')).toBe(true);
    expect(isAppBuildRequest('Refactor the retry policy helper')).toBe(false);
  });

  it('selects single HTML by default and Vite React when requested', () => {
    expect(selectOutputMode('Create a standalone paint app')).toBe('single-html');
    expect(selectOutputMode('Create a multi-file vanilla HTML/CSS/JavaScript app')).toBe('vanilla-web');
    expect(selectOutputMode('Build a three-file Kanban app')).toBe('vanilla-web');
    expect(selectOutputMode('Create a React app with multiple files')).toBe('vite-react');
    expect(selectOutputMode('Create a Vite React project with components')).toBe('vite-react');
  });

  it('uses index.html and static verification checks for vanilla multi-file apps', () => {
    const spec = buildFallbackAppSpec('Create a multi-file vanilla HTML/CSS/JavaScript timer tool');

    expect(spec.outputMode).toBe('vanilla-web');
    expect(spec.entryPoint).toBe('index.html');
    expect(spec.verificationChecks).toContain('entry HTML file exists');
    expect(spec.verificationChecks).not.toContain('project builds successfully');
  });

  it('keeps an explicitly vanilla multi-file request out of the Vite mode if the model over-classifies it', async () => {
    const spec = await createAppSpec(
      'Create a multi-file vanilla HTML/CSS/JavaScript timer app',
      createMockLlm(JSON.stringify({
        outputMode: 'vite-react',
        entryPoint: 'src/App.tsx',
        verificationChecks: ['project builds successfully'],
      })),
      'mock'
    );

    expect(spec?.outputMode).toBe('vanilla-web');
    expect(spec?.entryPoint).toBe('index.html');
    expect(spec?.verificationChecks).toContain('entry HTML file exists');
    expect(spec?.verificationChecks).not.toContain('project builds successfully');
  });

  it('keeps required persistence checks when the model omits them', async () => {
    const spec = await createAppSpec(
      'Build a three-file Kanban app that preserves tasks after reload',
      createMockLlm(JSON.stringify({
        outputMode: 'vanilla-web',
        dataPersistence: false,
        verificationChecks: ['primary controls respond'],
      })),
      'mock'
    );

    expect(spec?.dataPersistence).toBe(true);
  });

  it('builds a deterministic fallback app spec with useful checks', () => {
    const spec = buildFallbackAppSpec(
      'Build a standalone arcade snake game with keyboard controls and high-score localStorage'
    );

    expect(spec.appType).toBe('game');
    expect(spec.outputMode).toBe('single-html');
    expect(spec.dataPersistence).toBe(true);
    expect(spec.requiredFeatures).toEqual(
      expect.arrayContaining(['playable game loop', 'keyboard interaction support'])
    );
    expect(spec.verificationChecks).toEqual(
      expect.arrayContaining(['entry HTML file exists', 'game can start or restart'])
    );
  });

  it('normalizes LLM-generated app specs against allowed contract values', async () => {
    const spec = await createAppSpec(
      'Create a Vite React todo dashboard app',
      createMockLlm(
        JSON.stringify({
          appType: 'dashboard',
          outputMode: 'vite-react',
          appName: 'Todo Operations',
          entryPoint: 'src/App.tsx',
          requiredFeatures: ['create tasks', 'move task status'],
          designDirection: 'dense and calm',
          dataPersistence: true,
          verificationChecks: ['project builds successfully', 'task controls respond'],
        })
      ),
      'mock'
    );

    expect(spec).toEqual({
      appType: 'dashboard',
      outputMode: 'vite-react',
      appName: 'Todo Operations',
      entryPoint: 'src/App.tsx',
      requiredFeatures: ['create tasks', 'move task status'],
      designDirection: 'dense and calm',
      dataPersistence: true,
      verificationChecks: ['project builds successfully', 'task controls respond'],
    });
  });

  it('formats app specs for planner prompts', () => {
    const text = formatAppSpec(buildFallbackAppSpec('Create a standalone timer tool'));

    expect(text).toContain('App contract:');
    expect(text).toContain('- Type: tool');
    expect(text).toContain('- Verification:');
  });
});
