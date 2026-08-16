import { describe, expect, it } from 'vitest';

import {
  buildSessionJsonl,
  cloneImportedMessages,
  facadeMessagesFromPiEntries,
  parseSessionImport,
} from './session-transfer.js';

describe('session-transfer', () => {
  it('round-trips facade messages through Pi-compatible JSONL', () => {
    const record = {
      id: 'ses_export',
      directory: '/tmp/project',
      info: { id: 'ses_export', title: 'Demo chat', time: { created: 1_700_000_000_000 } },
      messages: [
        {
          info: { id: 'msg_user', role: 'user', time: { created: 1_700_000_000_100 } },
          parts: [{ id: 'prt_1', type: 'text', text: 'hello import' }],
        },
        {
          info: { id: 'msg_asst', role: 'assistant', parentID: 'msg_user', time: { created: 1_700_000_000_200 } },
          parts: [{ id: 'prt_2', type: 'text', text: 'hello back' }],
        },
      ],
    };

    const jsonl = buildSessionJsonl(record);
    expect(jsonl).toContain('"type":"session"');
    expect(jsonl).toContain('"type":"message"');
    expect(jsonl).toContain('hello import');

    const parsed = parseSessionImport(jsonl);
    expect(parsed.title).toBe('Demo chat');
    expect(parsed.cwd).toBe('/tmp/project');
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0].info.role).toBe('user');
    expect(parsed.messages[0].parts[0].text).toBe('hello import');
    expect(parsed.messages[1].info.role).toBe('assistant');
    expect(parsed.messages[1].parts[0].text).toBe('hello back');

    const cloned = cloneImportedMessages(parsed.messages, 'ses_imported');
    expect(cloned[0].info.sessionID).toBe('ses_imported');
    expect(cloned[0].parts[0].sessionID).toBe('ses_imported');
  });

  it('maps Pi session entries onto facade messages', () => {
    const messages = facadeMessagesFromPiEntries([
      { type: 'session_info', name: 'skip me' },
      {
        type: 'message',
        id: 'msg_disk',
        parentId: null,
        timestamp: '2026-08-16T00:00:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'from disk' }] },
      },
    ], '01a0097f-07d8-70de-9253-bc848d86f3b0');
    expect(messages).toHaveLength(1);
    expect(messages[0].info).toMatchObject({
      id: 'msg_disk',
      sessionID: '01a0097f-07d8-70de-9253-bc848d86f3b0',
      role: 'user',
    });
    expect(messages[0].parts[0]).toMatchObject({
      type: 'text',
      text: 'from disk',
      sessionID: '01a0097f-07d8-70de-9253-bc848d86f3b0',
    });
  });

  it('rejects empty or message-less imports', () => {
    expect(() => parseSessionImport('')).toThrow(/empty/i);
    expect(() => parseSessionImport('{"type":"session","id":"ses_x","cwd":"/tmp"}\n')).toThrow(/messages/i);
  });
});
