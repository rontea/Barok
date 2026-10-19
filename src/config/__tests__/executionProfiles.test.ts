import { describe, expect, it } from '@jest/globals';
import {
  EXECUTION_PROFILE_PRESETS,
  normalizeExecutionProfilePresets,
  USER_EXECUTION_PROFILE_IDS,
} from '../executionProfiles.js';

describe('execution pacing profiles', () => {
  it('exposes the four user-facing profiles in speed-to-safety order', () => {
    expect(USER_EXECUTION_PROFILE_IDS).toEqual([
      'fast',
      'automatic',
      'conservative',
      'phased',
    ]);
    expect(USER_EXECUTION_PROFILE_IDS.map((id) => EXECUTION_PROFILE_PRESETS[id].label)).toEqual([
      'Paid',
      'Adaptive',
      'Free',
      'Free Conservative',
    ]);
  });

  it('keeps every profile setting explicit and progressively paced', () => {
    const paid = EXECUTION_PROFILE_PRESETS.fast;
    const adaptive = EXECUTION_PROFILE_PRESETS.automatic;
    const free = EXECUTION_PROFILE_PRESETS.conservative;
    const freeConservative = EXECUTION_PROFILE_PRESETS.phased;

    expect(paid).toMatchObject({
      requestIntervalMs: 0,
      providerRequestIntervalMs: 0,
      toolPresentation: { readMs: 0, writeMs: 0 },
      decisionPresentation: { minMs: 0, maxMs: 0 },
      typewriter: { enabled: false },
      requestTimeoutFloorMs: 0,
    });
    expect(adaptive.requestIntervalMs).toBe(0);
    expect(adaptive.toolPresentation).toEqual({ readMs: 0, writeMs: 0 });
    expect(adaptive.requestIntervalMs).toBeLessThan(free.requestIntervalMs);
    expect(free.requestIntervalMs).toBeLessThan(freeConservative.requestIntervalMs);
    expect(free.providerRequestIntervalMs).toBeLessThan(freeConservative.providerRequestIntervalMs);
    expect(freeConservative.toolPresentation.writeMs).toBeGreaterThan(free.toolPresentation.writeMs);
    expect(freeConservative.decisionPresentation.maxMs).toBeGreaterThan(free.decisionPresentation.maxMs);
    expect(free.typewriter.enabled).toBe(true);
    expect(freeConservative.typewriter.enabled).toBe(true);
    expect(free.requestTimeoutFloorMs).toBe(120_000);
    expect(freeConservative.requestTimeoutFloorMs).toBe(120_000);
  });

  it('fills missing values and bounds saved profile overrides', () => {
    const normalized = normalizeExecutionProfilePresets({
      fast: {
        requestIntervalMs: -50,
        decisionPresentation: { minMs: 20_000, maxMs: 1_000 },
        typewriter: { enabled: true, intervalMs: 5_000 },
      },
    });

    expect(normalized.fast.requestIntervalMs).toBe(0);
    expect(normalized.fast.decisionPresentation.maxMs).toBe(20_000);
    expect(normalized.fast.typewriter).toMatchObject({ enabled: true, intervalMs: 1_000 });
    expect(normalized.automatic.label).toBe('Adaptive');
    expect(normalized.automatic.requestIntervalMs).toBe(0);
    expect(normalized.phased.requestIntervalMs).toBe(10_000);
  });

  it('migrates the previous automatic pacing defaults to response-driven behavior', () => {
    const normalized = normalizeExecutionProfilePresets({
      automatic: {
        requestIntervalMs: 1_500,
        providerRequestIntervalMs: 6_000,
        toolPresentation: { readMs: 1_600, writeMs: 3_200 },
      },
    });

    expect(normalized.automatic).toMatchObject({
      requestIntervalMs: 0,
      toolPresentation: { readMs: 0, writeMs: 0 },
    });
  });
});
