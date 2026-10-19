import { mkdtemp, readFile, rm, stat } from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  coderTimelineEventsFromRunEvents,
  deleteCoderThreadArtifact,
  loadCoderThreadArtifact,
  saveCoderThreadArtifact,
} from './coderThreadArtifacts.js';

describe('coder thread artifacts', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), 'react-engine-coder-thread-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('stores timelines below the project .react-engine directory', async () => {
    const timelines = {
      'run-1': {
        events: [{ type: 'tool_result', tool: 'Read', result: 'ok' }],
        updatedAt: 123,
      },
    };

    const targetPath = await saveCoderThreadArtifact('thread-1', timelines, projectRoot);

    expect(targetPath).toBe(path.join(projectRoot, '.react-engine', 'coder-threads', 'thread-1.json'));
    await expect(stat(targetPath)).resolves.toBeDefined();
    await expect(readFile(targetPath, 'utf8')).resolves.toContain('"version":1');
    await expect(loadCoderThreadArtifact('thread-1', projectRoot)).resolves.toEqual(expect.objectContaining({
      threadId: 'thread-1',
      timelines,
    }));

    await deleteCoderThreadArtifact('thread-1', projectRoot);
    await expect(loadCoderThreadArtifact('thread-1', projectRoot)).resolves.toBeNull();
  });

  it('projects durable run envelopes into compact Coder timeline events', () => {
    const events = coderTimelineEventsFromRunEvents([
      {
        runId: 'run-1',
        seq: 1,
        eventType: 'tool_result',
        event: {
          schemaVersion: 1,
          eventId: 'event-1',
          runId: 'run-1',
          sessionId: 'run-1',
          seq: 1,
          type: 'tool_result',
          data: { tool: 'Read', result: 'ok' },
          timestamp: 123,
        },
        createdAt: 123,
      },
      {
        runId: 'run-1',
        seq: 2,
        eventType: 'checkpoint',
        event: { data: { version: 1, state: {} } },
        createdAt: 124,
      },
      {
        runId: 'run-1',
        seq: 3,
        eventType: 'reasoning_end',
        event: {
          schemaVersion: 1,
          eventId: 'event-3',
          runId: 'run-1',
          sessionId: 'run-1',
          seq: 3,
          type: 'reasoning_end',
          data: { id: 'reason-1', summary: 'Read the file before editing.', visibility: 'collapsed', source: 'model' },
          timestamp: 125,
        },
        createdAt: 125,
      },
    ]);

    expect(events).toEqual([
      { type: 'tool_result', tool: 'Read', result: 'ok' },
      { type: 'reasoning_end', id: 'reason-1', summary: 'Read the file before editing.', visibility: 'collapsed', source: 'model' },
    ]);
  });
});
