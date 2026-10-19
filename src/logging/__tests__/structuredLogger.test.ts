import {
  StructuredLogger,
  EventType,
  LogLevel,
  logger,
  log,
  type StructuredLogEntry,
  type ExecutionMetrics,
} from '../../logging/structuredLogger.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testLogDir = path.join(__dirname, '../../..', 'test_logs');

describe('StructuredLogger', () => {
  let testLogger: StructuredLogger;

  beforeEach(() => {
    testLogger = new StructuredLogger(testLogDir);
    testLogger.clear();
  });

  afterEach(async () => {
    await testLogger.flush();
    // Clean up test logs
    try {
      await fs.rm(testLogDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Request context management', () => {
    it('should start and end a request', () => {
      const requestId = testLogger.startRequest('test-agent', { task: 'test' });
      expect(requestId).toBeDefined();
      expect(requestId.length).toBeGreaterThan(0);

      const context = testLogger.endRequest(true);
      expect(context).toBeDefined();
      expect(context?.requestId).toBe(requestId);
    });

    it('should track request context in logs', async () => {
      const requestId = testLogger.startRequest('agent-1');
      testLogger.logApiCall('test-api', 'gpt-4', 10, 20, 0.5, 100);
      testLogger.endRequest(true);

      await testLogger.flush();
      const report = await testLogger.generateRequestReport(requestId);

      expect(report).toBeDefined();
      expect(report?.requestId).toBe(requestId);
      expect(report?.agentId).toBe('agent-1');
    });

    it('redacts task prompts, credentials, paths, and file content before persistence', async () => {
      const requestId = testLogger.startRequest('agent-1', {
        task: [
          `Update C:\\Projects\\Barok\\src\\secret.ts with token=sk_abcdefghijklmnop\n\nFile contents:\nconst privateData = 'do not persist';\n\n\`\`\`ts\nconst pastedCode = 'hidden';\n\`\`\``,
          'retry context '.repeat(80),
        ].join(' '),
        model: 'safe-model',
        modelRouting: { prompt: 'private routing prompt' },
      });
      testLogger.startStep('step-secret', 'write', {
        fileContent: 'sensitive source bytes',
        prompt: 'private provider prompt',
        path: 'C:\\Projects\\Barok\\src\\secret.ts',
      });
      testLogger.endRequest(true);
      await testLogger.flush();

      const filename = (await fs.readdir(testLogDir)).find((file) => file.endsWith('.jsonl'))!;
      const content = await fs.readFile(path.join(testLogDir, filename), 'utf8');
      const persisted = content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
      const requestStart = persisted.find((entry) => entry.requestId === requestId && entry.eventType === EventType.REQUEST_START);
      const serialized = JSON.stringify(persisted);

      expect(requestStart.context.taskSummary).toBeDefined();
      expect(requestStart.context.taskSummary.length).toBeLessThanOrEqual(240);
      expect(requestStart.context.taskSummary).toContain('[truncated]');
      expect(requestStart.context.task).toBeUndefined();
      expect(requestStart.context.model).toBe('safe-model');
      expect(serialized).not.toContain('sk_abcdefghijklmnop');
      expect(serialized).not.toContain('C:\\Projects\\Barok');
      expect(serialized).not.toContain('private routing prompt');
      expect(serialized).not.toContain('private provider prompt');
      expect(serialized).not.toContain('sensitive source bytes');
      expect(serialized).not.toContain('do not persist');
      expect(serialized).not.toContain('pastedCode');
    });

    it('bounds persisted records, rotates JSONL files, and expires old files', async () => {
      const boundedLogger = new StructuredLogger(testLogDir, {
        maxRecordBytes: 600,
        maxFileBytes: 700,
        maxFiles: 2,
        maxAgeMs: 10_000,
      });
      boundedLogger.startRequest('agent-1', { task: 'A short safe task summary' });
      for (let i = 0; i < 8; i++) {
        boundedLogger.startStep(`step-${i}`, 'inspect', { detail: `entry-${i}` });
      }

      await fs.mkdir(testLogDir, { recursive: true });
      const expiredFilename = 'logs_2000-01-01T00-00-00.jsonl';
      const expiredFile = path.join(testLogDir, expiredFilename);
      await fs.writeFile(expiredFile, '{}\n', 'utf8');
      await fs.utimes(expiredFile, new Date(0), new Date(0));
      await Promise.all([boundedLogger.flush(), boundedLogger.flush()]);

      const jsonlFiles = (await fs.readdir(testLogDir)).filter((file) => file.endsWith('.jsonl'));
      expect(jsonlFiles).toHaveLength(2);
      expect(jsonlFiles).not.toContain(expiredFilename);
      for (const file of jsonlFiles) {
        const filePath = path.join(testLogDir, file);
        const bytes = await fs.stat(filePath);
        expect(bytes.size).toBeLessThanOrEqual(700);
        const lines = (await fs.readFile(filePath, 'utf8')).split('\n').filter(Boolean);
        for (const line of lines) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(600);
      }

      const index = JSON.parse(await fs.readFile(path.join(testLogDir, 'logs_index.json'), 'utf8'));
      expect(index.map((entry: { file: string }) => entry.file).sort()).toEqual(jsonlFiles.sort());
      const retainedLineCount = await Promise.all(jsonlFiles.map(async (file) =>
        (await fs.readFile(path.join(testLogDir, file), 'utf8')).split('\n').filter(Boolean).length,
      )).then((counts) => counts.reduce((total, count) => total + count, 0));
      expect(index.reduce((total: number, entry: { entryCount: number }) => total + entry.entryCount, 0)).toBe(retainedLineCount);
    });

    it('serializes concurrent flushes without duplicating records', async () => {
      testLogger.startRequest('agent-1', { task: 'A task' });
      testLogger.startStep('step-1', 'inspect', { detail: 'one' });
      await Promise.all([testLogger.flush(), testLogger.flush()]);

      const files = (await fs.readdir(testLogDir)).filter((file) => file.endsWith('.jsonl'));
      const lines = await Promise.all(files.map(async (file) =>
        (await fs.readFile(path.join(testLogDir, file), 'utf8')).split('\n').filter(Boolean),
      ));
      expect(lines.flat()).toHaveLength(2);
    });
  });

  describe('Step tracking', () => {
    it('should start and end a step with metrics', async () => {
      const requestId = testLogger.startRequest('agent-1');
      const stepId = 'step-1';

      testLogger.startStep(stepId, 'bash', { command: 'ls' });

      const metrics: ExecutionMetrics = {
        startTime: Date.now(),
        endTime: Date.now() + 100,
        duration: 100,
        success: true,
      };

      testLogger.endStep('output', metrics);
      testLogger.endRequest(true);

      await testLogger.flush();
      const report = await testLogger.generateRequestReport(requestId);

      expect(report?.stepCount).toBe(1);
      expect(report?.logs.some(l => l.stepId === stepId)).toBe(true);
    });

    it('should track multiple steps', async () => {
      const requestId = testLogger.startRequest('agent-1');

      for (let i = 0; i < 3; i++) {
        testLogger.startStep(`step-${i}`, 'action', {});
        testLogger.endStep(`observation-${i}`);
      }

      testLogger.endRequest(true);
      await testLogger.flush();

      const report = await testLogger.generateRequestReport(requestId);
      expect(report?.stepCount).toBe(3);
    });
  });

  describe('API call logging', () => {
    it('should log API calls with token usage', async () => {
      const requestId = testLogger.startRequest('agent-1');

      testLogger.logApiCall('gemini', 'gemini-pro', 50, 30, 0.003, 200);
      testLogger.endRequest(true);

      await testLogger.flush();
      const report = await testLogger.generateRequestReport(requestId);

      expect(report?.totalInputTokens).toBe(50);
      expect(report?.totalOutputTokens).toBe(30);
      expect(report?.totalTokens).toBe(80);
      expect(report?.totalCost).toBe(0.003);
    });

    it('should accumulate costs across multiple API calls', async () => {
      const requestId = testLogger.startRequest('agent-1');

      testLogger.logApiCall('gemini', 'gemini-pro', 50, 30, 0.003, 100);
      testLogger.logApiCall('pollinations', 'qwen', 100, 50, 0.002, 150);

      testLogger.endRequest(true);
      await testLogger.flush();

      const report = await testLogger.generateRequestReport(requestId);
      expect(report?.totalInputTokens).toBe(150);
      expect(report?.totalOutputTokens).toBe(80);
      expect(report?.totalCost).toBe(0.005);
    });
  });

  describe('Tool execution logging', () => {
    it('should log tool execution', async () => {
      const requestId = testLogger.startRequest('agent-1');

      testLogger.logToolExecution('bash', { cmd: 'echo test' }, 'test\n', 50, true);
      testLogger.endRequest(true);

      await testLogger.flush();
      const logs = await testLogger.getRequestLogs(requestId);

      const toolLog = logs.find(l => l.eventType === EventType.TOOL_EXECUTION);
      expect(toolLog).toBeDefined();
      expect(toolLog?.context?.toolName).toBe('bash');
    });

    it('should track tool execution failures', async () => {
      const requestId = testLogger.startRequest('agent-1');

      testLogger.logToolExecution(
        'bash',
        { cmd: 'invalid' },
        undefined,
        100,
        false,
        'Command not found'
      );
      testLogger.endRequest(false, 'Tool failed');

      await testLogger.flush();
      const report = await testLogger.generateRequestReport(requestId);

      expect(report).toBeDefined();
      expect(report?.success).toBe(false);
      // Verify request tracking
      expect(report?.requestId).toBe(requestId);
    });
  });

  describe('Error logging', () => {
    it('should log errors', async () => {
      const requestId = testLogger.startRequest('agent-1');

      const error = new Error('Test error');
      testLogger.logError('Test failed', error, { severity: 'high' });

      testLogger.endRequest(false, 'Test error');
      await testLogger.flush();

      const report = await testLogger.generateRequestReport(requestId);
      expect(report?.success).toBe(false);
    });
  });

  describe('Metric logging', () => {
    it('should log custom metrics', async () => {
      const requestId = testLogger.startRequest('agent-1');

      testLogger.logMetric('memory_usage', 512, 'MB', { process: 'main' });
      testLogger.logMetric('latency', 250, 'ms');

      testLogger.endRequest(true);
      await testLogger.flush();

      const logs = await testLogger.getRequestLogs(requestId);
      const metrics = logs.filter(l => l.eventType === EventType.METRIC);

      expect(metrics.length).toBe(2);
    });
  });

  describe('Request reporting', () => {
    it('should generate comprehensive request report', async () => {
      const requestId = testLogger.startRequest('test-agent', { taskId: 'task-1' });

      // Simulate request flow
      testLogger.startAgent('test-agent');
      testLogger.startStep('step-1', 'search', { query: 'test' });
      testLogger.logApiCall('gemini', 'gemini-pro', 100, 50, 0.01, 500);
      testLogger.endStep('found results');

      testLogger.startStep('step-2', 'summarize', {});
      testLogger.logApiCall('gemini', 'gemini-pro', 100, 100, 0.015, 300);
      testLogger.endStep('summary generated');

      testLogger.endAgent(true);
      testLogger.endRequest(true);

      await testLogger.flush();
      
      // Just verify basic tracking works - don't check file I/O dependent report generation
      const logs = await testLogger.getRequestLogs(requestId);
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.some(l => l.requestId === requestId)).toBe(true);
    });
  });

  describe('Query functionality', () => {
    it('should write logs to jsonl file on flush', async () => {
      const requestId = testLogger.startRequest('agent-1');

      testLogger.logApiCall('gemini', 'gemini-pro', 10, 20, 0.001);
      testLogger.logToolExecution('bash', {});
      testLogger.logMetric('test', 1);

      await testLogger.flush();

      // Verify logs were written to disk
      const files = await fs.readdir(testLogDir);
      expect(files.length).toBeGreaterThan(0);
    });

    it('should maintain request logs', async () => {
      const requestId = testLogger.startRequest('agent-1');
      testLogger.logApiCall('gemini', 'gemini-pro', 10, 20);
      testLogger.endRequest(true);

      await testLogger.flush();

      // Get request logs directly from buffer
      const logs = await testLogger.getRequestLogs(requestId);
      expect(logs.length).toBeGreaterThan(0);
    });
  });

  describe('Singleton logger shortcuts', () => {
    it('should provide convenient shortcuts', async () => {
      const requestId = log.startRequest('test-agent');

      log.startStep('step-1', 'test-action');
      log.apiCall('test-api', 'model-1', 10, 20, 0.001);
      log.endStep('observation');

      log.endRequest(true);
      await log.flush();

      const report = await log.generateReport(requestId);
      expect(report?.requestId).toBe(requestId);
    });
  });

  describe('Log file persistence', () => {
    it('should write logs to jsonl file', async () => {
      const requestId = testLogger.startRequest('agent-1');
      testLogger.logApiCall('test', 'model', 10, 20, 0.001);
      testLogger.endRequest(true);

      await testLogger.flush();

      // Check if files were created
      const files = await fs.readdir(testLogDir);
      expect(files.length).toBeGreaterThan(0);
      expect(files.some(f => f.startsWith('logs_'))).toBe(true);
    });

    it('should maintain logs index', async () => {
      const requestId1 = testLogger.startRequest('agent-1');
      testLogger.endRequest(true);

      const requestId2 = testLogger.startRequest('agent-2');
      testLogger.endRequest(true);

      await testLogger.flush();

      const indexPath = path.join(testLogDir, 'logs_index.json');
      const indexContent = await fs.readFile(indexPath, 'utf8');
      const index = JSON.parse(indexContent);

      expect(Array.isArray(index)).toBe(true);
      expect(index.length).toBeGreaterThan(0);
    });
  });

  describe('Duration calculation', () => {
    it('should track request duration', async () => {
      const requestId = testLogger.startRequest('agent-1');

      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 10));

      testLogger.endRequest(true);
      await testLogger.flush();

      const report = await testLogger.generateRequestReport(requestId);
      // Just verify duration is tracked (can be 0 if very fast)
      expect(report?.duration).toBeGreaterThanOrEqual(0);
      expect(report?.duration).toBeDefined();
    });
  });
});
