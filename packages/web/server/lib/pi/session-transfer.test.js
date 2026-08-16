import { describe, expect, it } from 'vitest';

import {
  buildSessionJsonl,
  cloneImportedMessages,
  facadeMessagesFromPiEntries,
  parseSessionImport,
  persistFacadeMessages,
  piMessagesFromFacadeEntry,
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

  it('hydrates a skill-reading turn as one user and one assistant with a tool part', () => {
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

    expect(messages).toHaveLength(2);
    expect(messages.map((entry) => entry.info.role)).toEqual(['user', 'assistant']);
    expect(messages[0].parts.map((part) => part.type)).toEqual(['text']);
    expect(messages[0].parts[0].text).toBe('read the skill');
    expect(messages[1].parts.map((part) => part.type)).toEqual(['reasoning', 'text', 'tool']);
    expect(messages[1].parts[2]).toMatchObject({
      type: 'tool',
      callID: 'c1',
      tool: 'read',
      state: {
        status: 'completed',
        input: { path: 'SKILL.md' },
        output: '---\nname: using-superpowers\ndescription: Use when starting any conversation\n---\n',
      },
    });
    expect(messages.filter((entry) => entry.info.role === 'user')).toHaveLength(1);
    expect(messages.some((entry) => entry.parts.some((part) => String(part.text || '').includes('using-superpowers')))).toBe(false);
  });

  it('pairs read and bash toolCalls with later toolResults on the same assistant', () => {
    const messages = facadeMessagesFromPiEntries([
      {
        type: 'message',
        id: 'u1',
        message: { role: 'user', content: [{ type: 'text', text: 'inspect then list' }] },
      },
      {
        type: 'message',
        id: 'a1',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'reading and listing' },
            { type: 'toolCall', id: 'c_read', name: 'read', arguments: { path: 'AGENTS.md' } },
            { type: 'toolCall', id: 'c_bash', name: 'bash', arguments: { command: 'ls' } },
          ],
        },
      },
      {
        type: 'message',
        id: 't_read',
        message: {
          role: 'toolResult',
          toolName: 'read',
          toolCallId: 'c_read',
          content: [{ type: 'text', text: '# Pichamber Agent Guide\n' }],
        },
      },
      {
        type: 'message',
        id: 't_bash',
        message: {
          role: 'toolResult',
          toolName: 'bash',
          toolCallId: 'c_bash',
          content: [{ type: 'text', text: 'CHANGELOG.md:10\n' }],
        },
      },
    ], 'ses_tools');

    expect(messages).toHaveLength(2);
    expect(messages.map((entry) => entry.info.role)).toEqual(['user', 'assistant']);
    const toolParts = messages[1].parts.filter((part) => part.type === 'tool');
    expect(toolParts).toHaveLength(2);
    expect(toolParts[0]).toMatchObject({
      callID: 'c_read',
      tool: 'read',
      state: { status: 'completed', input: { path: 'AGENTS.md' }, output: '# Pichamber Agent Guide\n' },
    });
    expect(toolParts[1]).toMatchObject({
      callID: 'c_bash',
      tool: 'bash',
      state: { status: 'completed', input: { command: 'ls' }, output: 'CHANGELOG.md:10\n' },
    });
    expect(messages.filter((entry) => entry.info.role === 'user')).toHaveLength(1);
  });

  it('hydrates user text plus a Pi image block as text and file parts', () => {
    const messages = facadeMessagesFromPiEntries([
      {
        type: 'message',
        id: 'u1',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'see this' },
            { type: 'image', mimeType: 'image/png', data: 'AAAA' },
          ],
        },
      },
    ], 'ses_images');

    expect(messages).toHaveLength(1);
    expect(messages[0].info.role).toBe('user');
    expect(messages[0].parts.map((part) => part.type)).toEqual(['text', 'file']);
    expect(messages[0].parts[0].text).toBe('see this');
    expect(messages[0].parts[1]).toMatchObject({
      type: 'file',
      mime: 'image/png',
      url: 'data:image/png;base64,AAAA',
    });
    expect(messages[0].parts.some((part) => part.type === 'text' && !part.text)).toBe(false);
  });

  it('hydrates a source-shaped image block as a file part', () => {
    const messages = facadeMessagesFromPiEntries([
      {
        type: 'message',
        id: 'u1',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'look' },
            {
              type: 'image',
              source: { type: 'base64', mediaType: 'image/jpeg', data: 'BBBB' },
            },
          ],
        },
      },
    ], 'ses_source_image');

    expect(messages[0].parts.map((part) => part.type)).toEqual(['text', 'file']);
    expect(messages[0].parts[1]).toMatchObject({
      type: 'file',
      mime: 'image/jpeg',
      url: 'data:image/jpeg;base64,BBBB',
    });
  });

  it('drops unmatched toolResults and hydrates image blocks as file parts', () => {
    const messages = facadeMessagesFromPiEntries([
      {
        type: 'message',
        id: 'u1',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'see this' },
            { type: 'image', mimeType: 'image/png', data: 'AAAA' },
          ],
        },
      },
      {
        type: 'message',
        id: 'a1',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'reading' },
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
          content: [{ type: 'text', text: '---\nname: using-superpowers\n---\n' }],
        },
      },
      {
        type: 'message',
        id: 't_orphan',
        message: {
          role: 'toolResult',
          toolName: 'bash',
          toolCallId: 'missing',
          content: [{ type: 'text', text: 'orphan dump' }],
        },
      },
    ], 'ses_repro');

    expect(messages.map((entry) => ({
      role: entry.info.role,
      types: entry.parts.map((part) => part.type),
    }))).toEqual([
      { role: 'user', types: ['text', 'file'] },
      { role: 'assistant', types: ['text', 'tool'] },
    ]);
    expect(messages[0].parts[1]).toMatchObject({
      type: 'file',
      mime: 'image/png',
      url: 'data:image/png;base64,AAAA',
    });
    expect(messages.some((entry) => entry.parts.some((part) => String(part.text || '').includes('orphan dump')))).toBe(false);
  });

  it('maps facade text, tool, and image parts to Pi appendMessage payloads', () => {
    const messages = piMessagesFromFacadeEntry({
      info: { id: 'a1', role: 'assistant', time: { created: 1_700_000_000_200 } },
      parts: [
        { type: 'text', text: 'reading' },
        {
          type: 'tool',
          callID: 'c1',
          tool: 'read',
          state: { status: 'completed', input: { path: 'SKILL.md' }, output: 'skill body' },
        },
      ],
    });
    expect(messages).toEqual([
      {
        role: 'assistant',
        timestamp: 1_700_000_000_200,
        content: [
          { type: 'text', text: 'reading' },
          { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'SKILL.md' } },
        ],
      },
      {
        role: 'toolResult',
        toolName: 'read',
        toolCallId: 'c1',
        content: [{ type: 'text', text: 'skill body' }],
        timestamp: 1_700_000_000_200,
      },
    ]);

    const user = piMessagesFromFacadeEntry({
      info: { role: 'user', time: { created: 1_700_000_000_100 } },
      parts: [
        { type: 'text', text: 'see this' },
        { type: 'file', mime: 'image/png', url: 'data:image/png;base64,AAAA' },
      ],
    });
    expect(user).toEqual([{
      role: 'user',
      timestamp: 1_700_000_000_100,
      content: [
        { type: 'text', text: 'see this' },
        { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      ],
    }]);
  });

  it('appends mapped Pi messages through SessionManager.appendMessage', () => {
    const appended = [];
    const ok = persistFacadeMessages({
      appendMessage(message) {
        appended.push(message);
      },
    }, [{
      info: { role: 'user', time: { created: 1 } },
      parts: [{ type: 'text', text: 'hello persist' }],
    }]);
    expect(ok).toBe(true);
    expect(appended).toEqual([{
      role: 'user',
      timestamp: 1,
      content: [{ type: 'text', text: 'hello persist' }],
    }]);
    expect(persistFacadeMessages({}, [{ info: { role: 'user' }, parts: [{ type: 'text', text: 'x' }] }])).toBe(false);
  });

  it('imports a Pi jsonl skill-reading turn as one user and one assistant with a tool part', () => {
    const jsonl = [
      JSON.stringify({ type: 'session', cwd: '/tmp/project' }),
      JSON.stringify({
        type: 'message',
        id: 'u1',
        message: { role: 'user', content: [{ type: 'text', text: 'read the skill' }] },
      }),
      JSON.stringify({
        type: 'message',
        id: 'a1',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'reading' },
            { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'SKILL.md' } },
          ],
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 't1',
        message: {
          role: 'toolResult',
          toolName: 'read',
          toolCallId: 'c1',
          content: [{ type: 'text', text: '---\nname: using-superpowers\n---\n' }],
        },
      }),
    ].join('\n');
    const parsed = parseSessionImport(jsonl);
    expect(parsed.messages.map((entry) => entry.info.role)).toEqual(['user', 'assistant']);
    expect(parsed.messages[1].parts.map((part) => part.type)).toEqual(['text', 'tool']);
    expect(parsed.messages[1].parts[1]).toMatchObject({
      type: 'tool',
      callID: 'c1',
      tool: 'read',
      state: { status: 'completed', output: '---\nname: using-superpowers\n---\n' },
    });
  });
});
