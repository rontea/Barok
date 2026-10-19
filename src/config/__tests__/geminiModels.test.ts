import {
  getGeminiFreeChatModelIds,
  getGeminiModelMigration,
  getGeminiSameProviderFallbackModelIds,
  isRetiredGeminiModel,
  supportsGeminiSamplingParameters,
} from '../geminiModels.js';
import { bindGeminiTargetsToConfiguredProfiles, getGeminiTargetBindingIssue, normalizeGeminiModelTargets, synchronizeGeminiModelTargets } from '../geminiTargets.js';

describe('Gemini model catalog', () => {
  it('lists current GA Flash targets and excludes the shut-down preview', () => {
    const models = getGeminiFreeChatModelIds();

    expect(models).toEqual(expect.arrayContaining([
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite',
    ]));
    expect(models).not.toContain('gemini-2.5-flash-lite-preview-09-2025');
    expect(models).not.toContain('gemini-2.5-flash-lite');
    expect(isRetiredGeminiModel('gemini-2.5-flash-lite-preview-09-2025')).toBe(true);
    expect(isRetiredGeminiModel('gemini-2.5-pro')).toBe(true);
    expect(isRetiredGeminiModel('gemini-2.5-flash')).toBe(true);
    expect(isRetiredGeminiModel('gemini-2.5-flash-lite')).toBe(true);
    expect(isRetiredGeminiModel('gemini-3-flash-preview')).toBe(true);
    expect(getGeminiModelMigration('gemini-2.5-flash-lite')).toBe('gemini-3.5-flash-lite');
  });

  it('marks current models that reject legacy sampling controls', () => {
    expect(supportsGeminiSamplingParameters('gemini-3.6-flash')).toBe(false);
    expect(supportsGeminiSamplingParameters('gemini-3.5-flash-lite')).toBe(false);
    expect(supportsGeminiSamplingParameters('gemini-3.5-flash')).toBe(true);
  });

  it('supplies a compatible ordered same-provider recovery chain without repeating the selected model', () => {
    expect(getGeminiSameProviderFallbackModelIds('gemini-3.5-flash')).toEqual([
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
    ]);
    expect(getGeminiSameProviderFallbackModelIds('gemini-3.6-flash')).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
    ]);
  });

  it('removes saved targets bound to missing Gemini accounts or key slots', () => {
    const profiles = [{
      id: 'default', label: 'Default', purpose: 'general', apiKey: 'test-key', enabled: true, envVar: 'GEMINI_API_KEY',
    }];
    const targets = bindGeminiTargetsToConfiguredProfiles([
      { id: 'default-target', title: 'Default', modelId: 'gemini-3.6-flash', apiKeyIndex: 0, profileId: 'default', createdAt: 1, updatedAt: 1 },
      { id: 'stale-profile', title: 'Stale profile', modelId: 'gemini-3.6-flash', apiKeyIndex: 1, profileId: 'removed', createdAt: 1, updatedAt: 1 },
      { id: 'stale-slot', title: 'Stale slot', modelId: 'gemini-3.6-flash', apiKeyIndex: 1, createdAt: 1, updatedAt: 1 },
    ], profiles);

    expect(targets).toEqual([expect.objectContaining({ id: 'default-target', profileId: 'default', apiKeyIndex: 0 })]);
  });

  it('reports the precise stale-account condition and discards unsupported custom models', () => {
    const profiles = [{
      id: 'default', label: 'Default', purpose: 'general', apiKey: 'test-key', enabled: true, envVar: 'GEMINI_API_KEY',
    }];
    const missingProfile = {
      id: 'missing-profile', title: 'Missing profile', modelId: 'gemini-3.6-flash', apiKeyIndex: 0, profileId: 'removed', createdAt: 1, updatedAt: 1,
    };
    const missingSlot = {
      id: 'missing-slot', title: 'Missing slot', modelId: 'gemini-3.6-flash', apiKeyIndex: 4, createdAt: 1, updatedAt: 1,
    };

    expect(getGeminiTargetBindingIssue(missingProfile, profiles)).toBe('missing_profile');
    expect(getGeminiTargetBindingIssue(missingSlot, profiles)).toBe('invalid_key_slot');
    expect(normalizeGeminiModelTargets([{
      id: 'ambiguous-custom', title: 'Unknown custom model', modelId: 'gemini-unlisted-model', apiKeyIndex: 0,
    }])).toEqual([]);
  });

  it('synchronizes every current model across every configured profile and migrates retired targets', () => {
    const profiles = [
      { id: 'account-a', label: 'Account A', purpose: 'general', apiKey: 'key-a', enabled: true, envVar: 'A' },
      { id: 'account-b', label: 'Account B', purpose: 'general', apiKey: 'key-b', enabled: true, envVar: 'B' },
    ];
    const targets = synchronizeGeminiModelTargets([{
      id: 'legacy-account-b-target',
      title: 'Legacy account B target',
      modelId: 'gemini-2.5-flash-lite',
      apiKeyIndex: 1,
      profileId: 'account-b',
      createdAt: 1,
      updatedAt: 1,
    }], profiles);
    const models = getGeminiFreeChatModelIds();

    expect(targets).toHaveLength(models.length * profiles.length);
    expect(targets.some((target) => target.modelId === 'gemini-2.5-flash-lite')).toBe(false);
    for (const profile of profiles) {
      expect(targets.filter((target) => target.profileId === profile.id).map((target) => target.modelId).sort())
        .toEqual([...models].sort());
    }
    expect(targets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'legacy-account-b-target',
        profileId: 'account-b',
        modelId: 'gemini-3.5-flash-lite',
      }),
    ]));
  });
});
