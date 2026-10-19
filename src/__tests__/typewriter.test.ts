import { describe, expect, it, jest } from '@jest/globals';
import { createTypewriterController } from '../../ui/src/utils/typewriter';

function createManualScheduler() {
  const pending: Array<() => void> = [];
  return {
    pending,
    schedule: (callback: () => void) => {
      pending.push(callback);
      return callback;
    },
    cancel: (handle: unknown) => {
      const index = pending.indexOf(handle as () => void);
      if (index >= 0) pending.splice(index, 1);
    },
    tick: () => pending.shift()?.(),
  };
}

describe('free-tier typewriter controller', () => {
  it('reveals exactly one Unicode character per tick', () => {
    const scheduler = createManualScheduler();
    const onText = jest.fn();
    const controller = createTypewriterController({
      onText,
      schedule: scheduler.schedule,
      cancelScheduled: scheduler.cancel,
    });

    controller.setTarget('A🤖B');
    scheduler.tick();
    scheduler.tick();
    scheduler.tick();

    expect(onText.mock.calls.map(([text]) => text)).toEqual(['A', 'A🤖', 'A🤖B']);
    expect(controller.getText()).toBe('A🤖B');
  });

  it('replaces an unfinished stale update instead of queueing it', () => {
    const scheduler = createManualScheduler();
    const updates: string[] = [];
    const controller = createTypewriterController({
      onText: (text) => updates.push(text),
      schedule: scheduler.schedule,
      cancelScheduled: scheduler.cancel,
    });

    controller.setTarget('Planning');
    scheduler.tick();
    controller.setTarget('Reading files');
    scheduler.tick();

    expect(updates).toEqual(['P', '', 'R']);
    expect(scheduler.pending).toHaveLength(1);
  });

  it('flushes terminal text immediately and cancels pending animation', () => {
    const scheduler = createManualScheduler();
    const updates: string[] = [];
    const controller = createTypewriterController({
      onText: (text) => updates.push(text),
      schedule: scheduler.schedule,
      cancelScheduled: scheduler.cancel,
    });

    controller.setTarget('Working');
    scheduler.tick();
    controller.flush('Task completed.');

    expect(controller.getText()).toBe('Task completed.');
    expect(updates.at(-1)).toBe('Task completed.');
    expect(scheduler.pending).toHaveLength(0);
  });

  it('supports bounded multi-character file previews and reports completion', () => {
    const scheduler = createManualScheduler();
    const updates: string[] = [];
    const onComplete = jest.fn();
    const controller = createTypewriterController({
      charactersPerTick: 3,
      onText: (text) => updates.push(text),
      onComplete,
      schedule: scheduler.schedule,
      cancelScheduled: scheduler.cancel,
    });

    controller.setTarget('abcdef');
    scheduler.tick();
    scheduler.tick();

    expect(updates).toEqual(['abc', 'abcdef']);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('finishes the current safe summary before showing the next free-tier update', () => {
    const scheduler = createManualScheduler();
    const updates: string[] = [];
    const controller = createTypewriterController({
      queueUpdates: true,
      onText: (text) => updates.push(text),
      schedule: scheduler.schedule,
      cancelScheduled: scheduler.cancel,
    });

    controller.setTarget('Full safe summary');
    scheduler.tick();
    controller.setTarget('Tool started');

    expect(updates).toEqual(['F']);
    while (scheduler.pending.length > 0) scheduler.tick();

    expect(updates.at(-1)).toBe('Tool started');
    expect(updates).toContain('Full safe summary');
  });
});
