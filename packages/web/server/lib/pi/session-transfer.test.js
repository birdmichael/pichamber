import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildSessionHtml,
  buildSessionJsonl,
  cloneImportedMessages,
  facadeMessagesFromPiEntries,
  parseSessionImport,
  persistFacadeMessages,
  piMessagesFromFacadeEntry,
  readPiCodingAgentVersion,
  resolveUsableFacadeModel,
  transcriptEntriesForHydrate,
} from './session-transfer.js';

const transferTempDirs = [];
afterEach(() => {
  for (const dir of transferTempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const exampleAssistantUsage = {
  input: 1200,
  output: 80,
  cacheRead: 40,
  cacheWrite: 0,
  reasoning: 10,
  cost: { total: 0.002 },
};

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

  it('exports a skill-reading turn and image so import reconstructs tool and file parts', () => {
    const record = {
      id: 'ses_export_rich',
      directory: '/tmp/project',
      info: { id: 'ses_export_rich', title: 'Skill and image', time: { created: 1_700_000_000_000 } },
      messages: [
        {
          info: { id: 'msg_user', role: 'user', time: { created: 1_700_000_000_100 } },
          parts: [
            { id: 'prt_1', type: 'text', text: 'see this' },
            { id: 'prt_img', type: 'file', mime: 'image/png', url: 'data:image/png;base64,AAAA' },
          ],
        },
        {
          info: { id: 'msg_asst', role: 'assistant', parentID: 'msg_user', time: { created: 1_700_000_000_200 } },
          parts: [
            { id: 'prt_think', type: 'reasoning', text: 'load skills' },
            { id: 'prt_text', type: 'text', text: 'reading' },
            {
              id: 'prt_tool',
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
    expect(jsonl).toContain('"type":"session"');
    expect(jsonl).toContain('"type":"toolCall"');
    expect(jsonl).toContain('"role":"toolResult"');
    expect(jsonl).toContain('"type":"image"');
    expect(jsonl).toContain('"type":"thinking"');
    expect(jsonl).toContain('see this');

    const entries = jsonl
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(entries.some((entry) => entry.message?.content?.some((block) => block.type === 'toolCall'))).toBe(true);
    expect(entries.some((entry) => entry.message?.role === 'toolResult')).toBe(true);
    expect(entries.some((entry) => entry.message?.content?.some((block) => block.type === 'image'))).toBe(true);
    expect(entries.some((entry) => entry.message?.content?.some((block) => block.type === 'thinking'))).toBe(true);

    const parsed = parseSessionImport(jsonl);
    expect(parsed.title).toBe('Skill and image');
    expect(parsed.messages.map((entry) => entry.info.role)).toEqual(['user', 'assistant']);
    expect(parsed.messages[0].parts.map((part) => part.type)).toEqual(['text', 'file']);
    expect(parsed.messages[0].parts[0].text).toBe('see this');
    expect(parsed.messages[0].parts[1]).toMatchObject({
      type: 'file',
      mime: 'image/png',
      url: 'data:image/png;base64,AAAA',
    });
    expect(parsed.messages[1].parts.map((part) => part.type)).toEqual(['reasoning', 'text', 'tool']);
    expect(parsed.messages[1].parts[0].text).toBe('load skills');
    expect(parsed.messages[1].parts[1].text).toBe('reading');
    expect(parsed.messages[1].parts[2]).toMatchObject({
      type: 'tool',
      callID: 'c1',
      tool: 'read',
      state: {
        status: 'completed',
        input: { path: 'SKILL.md' },
        output: '---\nname: using-superpowers\n---\n',
      },
    });

    const remapped = facadeMessagesFromPiEntries(entries, 'ses_imported');
    expect(remapped.map((entry) => ({
      role: entry.info.role,
      types: entry.parts.map((part) => part.type),
    }))).toEqual([
      { role: 'user', types: ['text', 'file'] },
      { role: 'assistant', types: ['reasoning', 'text', 'tool'] },
    ]);
  });

  it('exports a skill-reading turn and image as standalone HTML with preview chrome', () => {
    const record = {
      id: 'ses_export_rich',
      directory: '/tmp/project',
      info: { id: 'ses_export_rich', title: 'Skill and image', time: { created: 1_700_000_000_000 } },
      messages: [
        {
          info: { id: 'msg_user', role: 'user', time: { created: 1_700_000_000_100 } },
          parts: [
            { id: 'prt_1', type: 'text', text: 'see this' },
            { id: 'prt_img', type: 'file', mime: 'image/png', url: 'data:image/png;base64,AAAA' },
          ],
        },
        {
          info: {
            id: 'msg_asst',
            role: 'assistant',
            parentID: 'msg_user',
            mode: 'plan',
            time: { created: 1_700_000_000_200, completed: 1_700_000_178_200 },
            providerID: 'example-provider',
            modelID: 'example-model',
            model: { providerID: 'example-provider', modelID: 'example-model' },
            cost: 0.002,
            tokens: { input: 1200, output: 80, reasoning: 10, cache: { read: 40, write: 0 } },
          },
          parts: [
            { id: 'prt_think', type: 'reasoning', text: 'load skills' },
            { id: 'prt_text', type: 'text', text: 'reading' },
            {
              id: 'prt_tool',
              type: 'tool',
              callID: 'c1',
              tool: 'read',
              state: {
                status: 'completed',
                input: { path: 'SKILL.md' },
                output: '---\nname: using-superpowers\n---\n',
              },
            },
            {
              id: 'prt_q',
              type: 'tool',
              callID: 'c_q',
              tool: 'question',
              state: {
                status: 'completed',
                input: {
                  questions: [{ question: 'Which path?', options: [{ label: 'SKILL.md' }] }],
                },
                output: 'User has answered your questions: "Which path?"="SKILL.md". You can now continue.',
                metadata: { answers: [['SKILL.md']] },
              },
            },
          ],
        },
      ],
    };

    const html = buildSessionHtml(record, { locale: 'zh-CN' });
    const version = readPiCodingAgentVersion();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('lang="zh-CN"');
    expect(html).toContain('<h1 class="session-title">Skill and image</h1>');
    expect(html).toContain('class="topbar"');
    expect(html).toContain('class="pichamber-mark"');
    expect(html).toContain('class="pi-mark"');
    expect(html).toContain('data-theme-toggle');
    expect(html).toContain('pichamber-export-theme');
    expect(html).toContain('https://github.com/birdmichael/pichamber');
    expect(html).toContain('class="session-header"');
    expect(html).toContain('class="bubble"');
    expect(html).toContain('class="ticks"');
    expect(html).toContain('href="#turn-1"');
    expect(html).toContain('--background-stronger: #151515');
    expect(html).toContain('--background-stronger: #fcfcfc');
    expect(html).toContain('--background-base: #101010');
    expect(html).toContain('--background-base: #f8f8f8');
    expect(html).not.toContain('--bg-deep:');
    expect(html).toContain('see this');
    expect(html).toContain('<img src="data:image/png;base64,AAAA"');
    expect(html).toContain('class="thinking"');
    expect(html).not.toMatch(/\.thinking \{[^}]*background:/);
    expect(html).not.toMatch(/\.thinking \{[^}]*border:/);
    expect(html).not.toContain('<details class="thinking">');
    expect(html).not.toContain('<summary>Thinking</summary>');
    expect(html).toMatch(/\.ticks a i \{[\s\S]*width: 10px/);
    expect(html).toMatch(/\.ticks a i \{[\s\S]*height: 1px/);
    expect(html).toMatch(/\.ticks a\.current i \{[\s\S]*width: 14px/);
    expect(html).toContain('<i></i>');
    expect(html).toContain('class="chevron"');
    expect(html).toContain('class="toast"');
    expect(html).toMatch(/\.pichamber-mark \{[\s\S]*width: 18px/);
    expect(html).toContain('class="pichamber-mark" viewBox="0 0 100 100" width="18" height="18"');
    expect(html).toContain('class="session-version"');
    expect(html).toContain('class="session-model"');
    expect(html).toContain('class="tool-panel"');
    expect(html).toContain('class="user-meta"');
    expect(html).toContain('load skills');
    expect(html).toContain('reading');
    expect(html).toContain('<details class="tool">');
    expect(html).toContain('<span class="tool-name">read</span>');
    expect(html).toContain('SKILL.md');
    expect(html).toContain('<span class="tool-prompt">$</span>');
    expect(html).toContain('using-superpowers');
    expect(html).toContain('example-model');
    expect(html).not.toContain('example-provider/example-model');
    expect(html).not.toContain('pi/pi');
    expect(html).toContain('Plan · example-model · 2m 58s');
    expect(html).toContain('14 Nov 2023, 22:13');
    expect(html).toContain('class="watermark">pichamber</p>');
    expect(html).toContain('问题');
    expect(html).toContain('已回答 1 个');
    expect(html).toContain('Which path?');
    expect(html).toContain('复制回复');
    expect(html).toContain('data-copy="reading"');
    expect(html).toContain('data-copy="see this"');
    if (version) expect(html).toContain(`v${version}`);
    expect(html).not.toMatch(/<div class="body answer">[\s\S]*load skills/);
    expect(html).not.toMatch(/cdn\.|unpkg\.|jsdelivr|https:\/\/cdn/i);
    expect(html).not.toContain('session.share');
    expect(html).not.toContain('opncd.ai');
    expect(html).not.toContain('opencode');
    expect(html).not.toContain('anomalyco');
    expect(html).not.toContain('discord');
  });

  it('renders Markdown text and labels remote images instead of embedding them', () => {
    const html = buildSessionHtml({
      info: { title: 'Markdown demo' },
      messages: [
        {
          info: { role: 'user', time: { created: 1_700_000_000_100 } },
          parts: [{
            type: 'text',
            text: 'plain user note',
          }, {
            type: 'file',
            mime: 'image/png',
            url: 'https://example.com/remote.png',
          }],
        },
        {
          info: { role: 'assistant', time: { created: 1_700_000_000_200 } },
          parts: [{
            type: 'text',
            text: [
              'See [docs](https://example.com) and `code`.',
              '',
              '- one',
              '- two',
              '',
              '```js',
              'const x = 1;',
              '```',
              '',
              '| a | b |',
              '| --- | --- |',
              '| 1 | 2 |',
              '',
              '![shot](https://example.com/a.png)',
            ].join('\n'),
          }, {
            type: 'tool',
            callID: 'c_err',
            tool: 'bash',
            state: { status: 'error', input: { command: 'ls' }, output: '', error: 'not found' },
          }],
        },
      ],
    });

    expect(html).toContain('<a href="https://example.com">docs</a>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<pre><code class="language-js">const x = 1;</code></pre>');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<td>1</td>');
    expect(html).toContain('Image omitted (remote URL)');
    expect(html).not.toContain('src="https://example.com/remote.png"');
    expect(html).not.toContain('src="https://example.com/a.png"');
    expect(html).toContain('<details class="tool error">');
    expect(html).toContain('<span class="tool-name">bash</span>');
    expect(html).toContain('not found');
    expect(html).toContain('class="bubble"');
    expect(html).toContain('plain user note');
    expect(html).toContain('--background-base: #f8f8f8');
  });

  it('keeps a cancelled ctx.ui question as ignored footer copy and does not empty the file', () => {
    const html = buildSessionHtml({
      info: { title: 'Cancelled question' },
      messages: [{
        info: { role: 'assistant', providerID: 'example-provider', modelID: 'example-model' },
        parts: [{
          type: 'text',
          text: 'still here',
        }, {
          type: 'tool',
          tool: 'question',
          state: {
            status: 'error',
            input: { questions: [{ question: 'Continue?' }] },
            error: 'The user dismissed this question',
          },
        }],
      }],
      settledUi: [{
        kind: 'select',
        title: 'Continue?',
        status: 'cancelled',
      }],
    }, { locale: 'zh-CN' });
    expect(html).toContain('still here');
    expect(html).toContain('问题已忽略');
    expect(html).toContain('example-model');
  });

  it('renders a Desktop Pi question answer on the asking turn', () => {
    const html = buildSessionHtml({
      info: { title: 'Pi question' },
      messages: [{
        info: { role: 'assistant', providerID: 'example-provider', modelID: 'example-model' },
        parts: [{
          type: 'text',
          text: 'need a path',
        }, {
          type: 'tool',
          tool: 'question',
          state: {
            status: 'completed',
            input: { question: 'Which path?', options: ['SKILL.md', 'README.md'] },
            output: 'User selected: 1. SKILL.md',
            metadata: {
              question: 'Which path?',
              options: ['SKILL.md', 'README.md'],
              answer: 'SKILL.md',
              wasCustom: false,
            },
          },
        }],
      }],
    }, { locale: 'zh-CN' });
    expect(html).toContain('need a path');
    expect(html).toContain('Which path?');
    expect(html).toContain('SKILL.md');
    expect(html).toContain('已回答 1 个');
    expect(html).not.toContain('Input needed');
  });

  it('hydrates a pending question toolCall onto the asking turn with question text', () => {
    const messages = facadeMessagesFromPiEntries([
      {
        type: 'message',
        id: 'u1',
        message: { role: 'user', content: [{ type: 'text', text: 'Use the question tool now.' }] },
      },
      {
        type: 'message',
        id: 'a1',
        message: {
          role: 'assistant',
          content: [{
            type: 'toolCall',
            id: 'c_q',
            name: 'question',
            arguments: { question: 'What should we work on next?' },
          }],
        },
      },
    ], 'ses_question');

    expect(messages).toHaveLength(2);
    expect(messages[1].parts).toEqual([expect.objectContaining({
      type: 'tool',
      callID: 'c_q',
      tool: 'question',
      state: {
        status: 'pending',
        input: { question: 'What should we work on next?' },
      },
    })]);
  });

  it('escapes HTML in exported text and rejects javascript links', () => {
    const html = buildSessionHtml({
      info: { title: '<script>alert(1)</script>' },
      messages: [{
        info: { role: 'user' },
        parts: [{
          type: 'text',
          text: 'Hello <script>alert(1)</script> and [x](javascript:alert(1))',
        }],
      }],
    });
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('href="javascript:alert(1)"');
    expect(html).toContain('javascript:alert(1)');
  });

  it('copies Pi assistant model and usage onto facade info', () => {
    const messages = facadeMessagesFromPiEntries([
      {
        type: 'message',
        id: 'u1',
        message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      },
      {
        type: 'message',
        id: 'a1',
        parentId: 'u1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hi' }],
          provider: 'example-provider',
          model: 'example-model',
          usage: exampleAssistantUsage,
        },
      },
    ], 'ses_usage');

    expect(messages).toHaveLength(2);
    expect(messages[1].info).toMatchObject({
      id: 'a1',
      sessionID: 'ses_usage',
      role: 'assistant',
      parentID: 'u1',
      agent: 'pi',
      mode: 'pi',
      modelID: 'example-model',
      providerID: 'example-provider',
      model: { providerID: 'example-provider', modelID: 'example-model' },
      cost: 0.002,
      tokens: {
        input: 1200,
        output: 80,
        reasoning: 10,
        cache: { read: 40, write: 0 },
      },
    });
    expect(messages[0].info.modelID).toBeUndefined();
    expect(messages[0].info.tokens).toBeUndefined();
    expect(messages[0].info.cost).toBeUndefined();
    expect(messages[0].info.time.completed).toBeUndefined();
    expect(messages[0].info.finish).toBeUndefined();
    expect(messages[1].info.time.completed).toBeGreaterThan(0);
    expect(messages[1].info.finish).toBe('stop');
  });

  it('hydrates a finished disk assistant with time.completed and finish stop', () => {
    const created = 1_700_000_000_200;
    const messages = facadeMessagesFromPiEntries([
      {
        type: 'message',
        id: 'u1',
        timestamp: 1_700_000_000_100,
        message: { role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 1_700_000_000_100 },
      },
      {
        type: 'message',
        id: 'a1',
        parentId: 'u1',
        timestamp: created,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
          timestamp: created,
          stopReason: 'stop',
        },
      },
    ], 'ses_done');

    expect(messages[0].info.time).toEqual({ created: 1_700_000_000_100 });
    expect(messages[0].info.finish).toBeUndefined();
    expect(messages[1].info.time).toEqual({ created, completed: created });
    expect(messages[1].info.finish).toBe('stop');
  });

  it('does not invent completed or finish for a still-open assistant', () => {
    const pending = facadeMessagesFromPiEntries([
      {
        type: 'message',
        id: 'a_pending',
        timestamp: 1_700_000_000_200,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'partial' }],
          stopReason: 'pending',
          timestamp: 1_700_000_000_200,
        },
      },
    ], 'ses_open');
    expect(pending[0].info.time).toEqual({ created: 1_700_000_000_200 });
    expect(pending[0].info.time.completed).toBeUndefined();
    expect(pending[0].info.finish).toBeUndefined();

    const streamingStub = facadeMessagesFromPiEntries([
      {
        type: 'message',
        id: 'a_stub',
        timestamp: 1_700_000_000_300,
        message: { role: 'assistant', content: [] },
      },
    ], 'ses_stub');
    expect(streamingStub[0].info.time).toEqual({ created: 1_700_000_000_300 });
    expect(streamingStub[0].info.time.completed).toBeUndefined();
    expect(streamingStub[0].info.finish).toBeUndefined();
  });

  it('omits tokens and cost when the Pi assistant has no usage', () => {
    const messages = facadeMessagesFromPiEntries([
      {
        type: 'message',
        id: 'a1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'no usage' }],
          provider: 'example-provider',
          model: 'example-model',
        },
      },
    ], 'ses_no_usage');

    expect(messages[0].info).toMatchObject({
      modelID: 'example-model',
      providerID: 'example-provider',
      model: { providerID: 'example-provider', modelID: 'example-model' },
    });
    expect(messages[0].info.tokens).toBeUndefined();
    expect(messages[0].info.cost).toBeUndefined();
    expect(messages[0].info.time.completed).toBeGreaterThan(0);
    expect(messages[0].info.finish).toBe('stop');
  });

  it('omits invented model and usage when the Pi assistant has neither', () => {
    const messages = facadeMessagesFromPiEntries([
      {
        type: 'message',
        id: 'a1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'bare' }],
        },
      },
    ], 'ses_bare');

    expect(messages[0].info.modelID).toBeUndefined();
    expect(messages[0].info.providerID).toBeUndefined();
    expect(messages[0].info.model).toBeUndefined();
    expect(messages[0].info.tokens).toBeUndefined();
    expect(messages[0].info.cost).toBeUndefined();
    expect(messages[0].info.agent).toBe('pi');
    expect(messages[0].info.time.completed).toBeGreaterThan(0);
    expect(messages[0].info.finish).toBe('stop');
  });

  it('hydrates leftover pi/pi from defaults or session model instead of keeping the placeholder', () => {
    const leftover = {
      type: 'message',
      id: 'a1',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' }],
        provider: 'pi',
        model: 'pi',
      },
    };
    const stamped = facadeMessagesFromPiEntries([leftover], 'ses_stamp', {
      fallbackModel: { providerID: 'example-provider', modelID: 'example-model' },
    });
    expect(stamped[0].info).toMatchObject({
      providerID: 'example-provider',
      modelID: 'example-model',
      model: { providerID: 'example-provider', modelID: 'example-model' },
    });
    expect(stamped[0].info.providerID).not.toBe('pi');
    expect(stamped[0].info.modelID).not.toBe('pi');
    expect(stamped[0].info.cost).toBeUndefined();

    const missing = facadeMessagesFromPiEntries([
      {
        type: 'message',
        id: 'a2',
        message: { role: 'assistant', content: [{ type: 'text', text: 'bare' }] },
      },
    ], 'ses_defaults', { fallbackModel: 'example-provider/example-model' });
    expect(missing[0].info).toMatchObject({
      providerID: 'example-provider',
      modelID: 'example-model',
    });

    expect(resolveUsableFacadeModel({ providerID: 'pi', modelID: 'pi' })).toBeNull();
    expect(resolveUsableFacadeModel(
      { providerID: 'pi', modelID: 'pi' },
      'example-provider/example-model',
    )).toEqual({
      providerID: 'example-provider',
      modelID: 'example-model',
      model: { providerID: 'example-provider', modelID: 'example-model' },
    });
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

  it('keeps facade model and usage on persist and JSONL export', () => {
    const entry = {
      info: {
        id: 'a1',
        role: 'assistant',
        parentID: 'u1',
        time: { created: 1_700_000_000_200 },
        modelID: 'example-model',
        providerID: 'example-provider',
        model: { providerID: 'example-provider', modelID: 'example-model' },
        cost: 0.002,
        tokens: {
          input: 1200,
          output: 80,
          reasoning: 10,
          cache: { read: 40, write: 0 },
        },
      },
      parts: [{ type: 'text', text: 'hi' }],
    };

    expect(piMessagesFromFacadeEntry(entry)).toEqual([{
      role: 'assistant',
      timestamp: 1_700_000_000_200,
      content: [{ type: 'text', text: 'hi' }],
      provider: 'example-provider',
      model: 'example-model',
      usage: {
        input: 1200,
        output: 80,
        reasoning: 10,
        cacheRead: 40,
        cacheWrite: 0,
        cost: { total: 0.002 },
      },
    }]);

    const jsonl = buildSessionJsonl({
      id: 'ses_export_usage',
      directory: '/tmp/project',
      info: { id: 'ses_export_usage', title: 'Usage', time: { created: 1_700_000_000_000 } },
      messages: [entry],
    });
    const assistant = jsonl
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((row) => row.message?.role === 'assistant');
    expect(assistant.message).toMatchObject({
      provider: 'example-provider',
      model: 'example-model',
      usage: {
        input: 1200,
        output: 80,
        cost: { total: 0.002 },
      },
    });

    const remapped = facadeMessagesFromPiEntries([assistant], 'ses_export_usage');
    expect(remapped[0].info).toMatchObject({
      modelID: 'example-model',
      providerID: 'example-provider',
      finish: 'stop',
      time: { created: 1_700_000_000_200, completed: 1_700_000_000_200 },
      cost: 0.002,
      tokens: {
        input: 1200,
        output: 80,
        reasoning: 10,
        cache: { read: 40, write: 0 },
      },
    });
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

  it('hydrates every jsonl message even when getBranch only has the live leaf', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-transcript-hydrate-'));
    transferTempDirs.push(dir);
    const file = path.join(dir, 'session.jsonl');
    const lines = [
      { type: 'session', id: 'ses_full', cwd: dir },
      {
        type: 'message',
        id: 'u-early',
        parentId: null,
        message: { role: 'user', content: [{ type: 'text', text: 'early turn' }] },
      },
      {
        type: 'compaction',
        id: 'cmp1',
        parentId: 'u-early',
        firstKeptEntryId: 'u-late',
        summary: 'earlier work',
      },
      {
        type: 'message',
        id: 'u-late',
        parentId: 'cmp1',
        message: { role: 'user', content: [{ type: 'text', text: 'late turn' }] },
      },
      {
        type: 'message',
        id: 'u-branch',
        parentId: 'u-late',
        message: { role: 'user', content: [{ type: 'text', text: 'branched continue' }] },
      },
    ];
    fs.writeFileSync(file, `${lines.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
    const leafOnly = [lines[4]];
    const entries = transcriptEntriesForHydrate({
      file,
      manager: {
        getEntries: () => leafOnly,
        getBranch: () => leafOnly,
      },
    });
    const messages = facadeMessagesFromPiEntries(entries, 'ses_full');
    expect(messages.map((entry) => entry.parts[0].text)).toEqual([
      'early turn',
      'late turn',
      'branched continue',
    ]);
  });
});
