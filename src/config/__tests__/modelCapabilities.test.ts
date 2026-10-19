import {
  formatModelCapabilityInstruction,
  getAllModelCapabilityProfiles,
  getModelCapabilityProfile,
} from '../modelCapabilities.js';

describe('model capability profiles', () => {
  it('describes the default NVIDIA reasoning and tool route', () => {
    const profile = getModelCapabilityProfile('z-ai/glm-5.2');

    expect(profile.provider).toBe('nvidia');
    expect(profile.capabilities.reasoning).toBe('yes');
    expect(profile.capabilities.toolCalling).toBe('yes');
    expect(profile.contextWindow).toBe(1_000_000);
    expect(profile.engineUsage.reasoning).toBe('react-planner');
    expect(profile.engineUsage.toolCalling).toBe('native');
  });

  it('resolves readable saved target values back to their catalog model', () => {
    const profile = getModelCapabilityProfile('nvidia-target:key-1-deepseek-ai-deepseek-v4-flash');

    expect(profile.modelId).toBe('deepseek-ai/deepseek-v4-flash-0731');
    expect(profile.architecture).toBe('MoE');
  });

  it('keeps custom route claims unknown while preserving the ReAct wiring', () => {
    const profile = getModelCapabilityProfile('local-target:custom-model');
    const instruction = formatModelCapabilityInstruction(profile);

    expect(profile.capabilities.toolCalling).toBe('unknown');
    expect(profile.engineUsage.reasoning).toBe('react-planner');
    expect(instruction).toContain('ReAct planner');
    expect(instruction).toContain('do not assume native tools');
  });

  it('lists selectable catalog models for the Settings overview', () => {
    const profiles = getAllModelCapabilityProfiles();

    expect(profiles.some((profile) => profile.modelId === 'z-ai/glm-5.2')).toBe(true);
    expect(profiles.some((profile) => profile.architecture === 'MoE')).toBe(true);
    expect(profiles.some((profile) => profile.modelId === 'baai/bge-m3')).toBe(false);
  });
});
