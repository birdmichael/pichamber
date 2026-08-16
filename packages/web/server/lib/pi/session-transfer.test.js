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

  it('maps Pi toolCall and toolResult onto one assistant tool part', () => {
    const messages = facadeMessagesFromPiEntries([
      {
        type: 'message',
        id: 'u1',
        message: { role: 'user', content: [{ type: 'text', text: 'read the skill' }] },
      },
      {
        type: 'message',
        id: 'a1',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'load skills' },
            { type: 'text', text: '先按仓库规则加载相关技能。' },
            { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'SKILL.md' } },
          ],
        },
      },
      {
        type: 'message',
        id: 't1',
        message: {
          role: 'toolResult',
          toolName: 'read',
          toolCallId: 'c1',
          content: [{
            type: 'text',
            text: '---\nname: using-superpowers\ndescription: Use when starting any conversation\n---\n',
          }],
        },
      },
    ], 'ses_repro');

    expect(messages.map((entry) => ({
      role: entry.info.role,
      types: entry.parts.map((part) => part.type),
    }))).toEqual([
      { role: 'user', types: ['text'] },
      { role: 'assistant', types: ['reasoning', 'text', 'tool'] },
    ]);
    expect(messages[0].parts[0].text).toBe('read the skill');
    expect(messages[1].parts[2]).toMatchObject({
      type: 'tool',
      tool: 'read',
      callID: 'c1',
      state: expect.objectContaining({
        status: 'completed',
        input: { path: 'SKILL.md' },
        output: expect.stringContaining('name: using-superpowers'),
      }),
    });
  });

  it('round-trips live tool parts through Pi-native JSONL without flattening them to user text', () => {
    const record = {
      id: 'ses_tools',
      directory: '/tmp/project',
      info: { id: 'ses_tools', title: 'Tool chat', time: { created: 1_700_000_000_000 } },
      messages: [
        {
          info: { id: 'msg_user', role: 'user', time: { created: 1_700_000_000_100 } },
          parts: [{ id: 'prt_1', type: 'text', text: 'read the skill' }],
        },
        {
          info: { id: 'msg_asst', role: 'assistant', parentID: 'msg_user', time: { created: 1_700_000_000_200 } },
          parts: [
            { id: 'prt_2', type: 'reasoning', text: 'load skills' },
            { id: 'prt_3', type: 'text', text: '先按仓库规则加载相关技能。' },
            {
              id: 'prt_4',
              type: 'tool',
              callID: 'c1',
              tool: 'read',
              state: {
                status: 'completed',
                input: { path: 'SKILL.md' },
                output: '---\nname: using-superpowers\n---\n',
              },
            },
          ],
        },
      ],
    };

    const jsonl = buildSessionJsonl(record);
    expect(jsonl).toContain('"type":"toolCall"');
    expect(jsonl).toContain('"role":"toolResult"');
    expect(jsonl).toContain('using-superpowers');

    const parsed = parseSessionImport(jsonl);
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0].info.role).toBe('user');
    expect(parsed.messages[1].info.role).toBe('assistant');
    expect(parsed.messages[1].parts.map((part) => part.type)).toEqual(['reasoning', 'text', 'tool']);
    expect(parsed.messages[1].parts[2]).toMatchObject({
      type: 'tool',
      tool: 'read',
      callID: 'c1',
      state: expect.objectContaining({
        output: expect.stringContaining('using-superpowers'),
      }),
    });
  });

  it('rejects empty or message-less imports', () => {
    expect(() => parseSessionImport('')).toThrow(/empty/i);
    expect(() => parseSessionImport('{"type":"session","id":"ses_x","cwd":"/tmp"}\n')).toThrow(/messages/i);
  });
});
