import { describe, expect, it } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { SQLiteAppStore } from '../sqliteStore.js';
import { FileExecutionLogger } from '../../di/providers/logger.js';

const audit = {
  type: 'malformed_provider_response' as const,
  protocolVersion: 1 as const,
  provider: 'openai' as const,
  errors: ['Provider response was not valid JSON.'],
  recoverable: true,
  rawRedacted: '{"apiKey":"[REDACTED]"}',
  model: 'nvidia-target:glm-workhorse',
  attempt: 1,
  parsedKeys: ['name', 'version'],
  recoveryOutcome: 'correcting' as const,
};

describe('protocol audit persistence', () => {
  it('persists redacted malformed responses in SQLite', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'protocol-audit-'));
    try {
      const store = new SQLiteAppStore(path.join(root, 'audit.sqlite'));
      store.recordProtocolAudit({ id: 'audit-1', auditType: audit.type, provider: audit.provider, errors: audit.errors, recoverable: audit.recoverable, rawRedacted: audit.rawRedacted, context: { model: audit.model, attempt: audit.attempt, parsedKeys: audit.parsedKeys, recoveryOutcome: audit.recoveryOutcome } });
      expect(store.listProtocolAudits()).toEqual([
        expect.objectContaining({ id: 'audit-1', provider: 'openai', recoverable: true, rawRedacted: audit.rawRedacted, context: expect.objectContaining({ attempt: 1, recoveryOutcome: 'correcting' }) }),
      ]);
      store.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('persists redacted malformed responses in the file audit stream', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'protocol-file-audit-'));
    try {
      const logger = new FileExecutionLogger(root);
      await logger.recordProtocolAudit(audit, 'run-1');
      const records = JSON.parse(readFileSync(path.join(root, 'protocol_audits.json'), 'utf8'));
      expect(records[0]).toMatchObject({ runId: 'run-1', provider: 'openai', rawRedacted: audit.rawRedacted, attempt: 1, recoveryOutcome: 'correcting' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
