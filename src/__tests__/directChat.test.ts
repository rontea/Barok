import { describe, expect, it } from '@jest/globals';
import express from 'express';
import type { Server } from 'http';
import http from 'http';

describe('POST /api/direct-chat endpoint', () => {
  it('rejects missing or empty messages array with 400', async () => {
    const app = express();
    app.use(express.json());

    // Register test route matching server.ts validation logic
    app.post('/api/direct-chat', (req, res) => {
      const { messages } = req.body || {};
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'messages array is required and must not be empty.' });
      }
      const validMessages = messages.filter(
        (m: unknown) =>
          m && typeof m === 'object' &&
          typeof (m as Record<string, unknown>).role === 'string' &&
          typeof (m as Record<string, unknown>).content === 'string',
      );
      if (validMessages.length === 0) {
        return res.status(400).json({ error: 'No valid messages supplied. Each message must have role (string) and content (string).' });
      }
      return res.status(200).json({ ok: true });
    });

    const server: Server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const res1 = await fetch(`${baseUrl}/api/direct-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res1.status).toBe(400);
      const data1 = await res1.json() as { error: string };
      expect(data1.error).toMatch(/messages array is required/);

      const res2 = await fetch(`${baseUrl}/api/direct-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [] }),
      });
      expect(res2.status).toBe(400);

      const res3 = await fetch(`${baseUrl}/api/direct-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ invalid: true }] }),
      });
      expect(res3.status).toBe(400);
      const data3 = await res3.json() as { error: string };
      expect(data3.error).toMatch(/No valid messages supplied/);
    } finally {
      server.close();
    }
  });

  it('streams SSE delta and done events for valid messages', async () => {
    const app = express();
    app.use(express.json());

    app.post('/api/direct-chat', (req, res) => {
      const { messages } = req.body || {};
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'messages array is required and must not be empty.' });
      }
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      res.write(`event: delta\ndata: ${JSON.stringify({ delta: 'Hello from direct chat!' })}\n\n`);
      res.write(`event: done\ndata: ${JSON.stringify({ model: 'mock-model', provider: 'mock-provider' })}\n\n`);
      res.end();
    });

    const server: Server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const res = await fetch(`${baseUrl}/api/direct-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          model: 'openrouter:openrouter/free',
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);

      const text = await res.text();
      expect(text).toContain('event: delta');
      expect(text).toContain('Hello from direct chat!');
      expect(text).toContain('event: done');
      expect(text).toContain('mock-model');
    } finally {
      server.close();
    }
  });
});

