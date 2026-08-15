import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createInMemoryPiSession, createPiHost, mapPiModelsToProviders } from './pi-host.js';

describe('mapPiModelsToProviders', () => {
  it('groups Pi models by provider id', () => {
    const providers = mapPiModelsToProviders([
      { id: 'claude-sonnet-4-5', name: 'Sonnet', provider: 'anthropic', reasoning: true },
      { id: 'gpt-5', name: 'GPT-5', provider: 'openai' },
    ]);
    expect(providers.map((provider) => provider.id)).toEqual(['anthropic', 'openai']);
    expect(providers[0].models['claude-sonnet-4-5'].name).toBe('Sonnet');
  });
});

describe('createPiHost', () => {
  it('creates sessions, lists them, and returns OpenCode-shaped messages after a mock prompt', async () => {
    const events = [];
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      onEvent: (directory, event) => events.push({ directory, event }),
    });

    const record = await host.createSession({ directory: '/tmp/project', title: 'Demo' });
    expect(record.info.id).toMatch(/^ses_/);
    expect(record.info.title).toBe('Demo');
    expect(host.listSessions('/tmp/project')).toHaveLength(1);

    await host.promptAsync(record.id, {
      messageID: 'msg_user',
      parts: [{ type: 'text', text: 'hi' }],
    });

    await new Promise((resolve) => setTimeout(resolve, 40));

    const messages = host.getMessages(record.id);
    expect(messages[0].info.role).toBe('user');
    expect(messages[0].parts).toHaveLength(1);
    expect(messages[0].parts[0].text).toBe('hi');
    const assistant = messages.find((entry) => entry.info.role === 'assistant');
    expect(assistant).toBeTruthy();
    expect(assistant.info.parentID).toBe('msg_user');
    expect(assistant.info.agent).toBe('pi');
    expect(assistant.info.time.created).toEqual(expect.any(Number));
    expect(assistant.info.time.completed).toEqual(expect.any(Number));
    expect(assistant.info.finish).toBe('stop');
    const text = assistant.parts.filter((part) => part.type === 'text').map((part) => part.text).join('');
    expect(text).toContain('Pi mock kernel');

    expect(events.some((item) => item.event.type === 'session.status' && item.event.properties.status.type === 'busy')).toBe(true);
    expect(events.some((item) => item.event.type === 'session.idle')).toBe(true);
    expect(events.some((item) => item.event.type === 'message.part.delta' && item.event.properties.field === 'text')).toBe(true);

    expect(host.getPath('/tmp/project').config).toContain('.pi/agent');
    host.dispose();
  });


  it('does not duplicate the user text part when Pi emits message_start user echo', async () => {
    const createEchoSession = () => {
      const listeners = new Set();
      const emit = (event) => {
        for (const listener of Array.from(listeners)) listener(event);
      };
      return {
        isStreaming: false,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async prompt(text) {
          emit({ type: 'agent_start' });
          emit({ type: 'message_start', message: { role: 'user', content: text } });
          emit({ type: 'message_start', message: { role: 'assistant', content: [] } });
          emit({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_start', contentIndex: 0 },
          });
          emit({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'pichamber-ui-ok' },
          });
          emit({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'pichamber-ui-ok' },
          });
          emit({
            type: 'message_end',
            message: { role: 'assistant', content: [{ type: 'text', text: 'pichamber-ui-ok' }] },
          });
          emit({ type: 'agent_end', messages: [], willRetry: false });
          emit({ type: 'agent_settled' });
        },
        async abort() {},
        dispose() { listeners.clear(); },
      };
    };

    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      createSession: async () => createEchoSession(),
    });
    const record = await host.createSession({ directory: '/tmp/project' });
    await host.promptAsync(record.id, {
      messageID: 'msg_user',
      parts: [{ type: 'text', text: 'ping' }],
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const messages = host.getMessages(record.id);
    expect(messages.filter((entry) => entry.info.role === 'user')).toHaveLength(1);
    expect(messages[0].parts.filter((part) => part.type === 'text')).toHaveLength(1);
    const assistant = messages.find((entry) => entry.info.role === 'assistant');
    expect(assistant.info.parentID).toBe('msg_user');
    expect(assistant.parts.map((part) => part.text).join('')).toContain('pichamber-ui-ok');
    host.dispose();
  });

  it('aborts an in-flight mock prompt', async () => {
    const host = createPiHost({
      mock: true,
      createSession: async () => createInMemoryPiSession({
        chunks: ['one ', 'two ', 'three'],
        chunkDelayMs: 30,
      }),
    });
    const record = await host.createSession({ directory: '/tmp/project' });
    const prompt = host.promptAsync(record.id, { parts: [{ type: 'text', text: 'go' }] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await host.abort(record.id);
    await prompt;
    expect(host.getStatus()[record.id]).toBeUndefined();
    host.dispose();
  });

  it('reload keeps live sessions and re-reads Pi resources', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-reload-'));
    try {
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/project',
      });
      const record = await host.createSession({ directory: '/tmp/project', title: 'Keep me' });
      const result = await host.reload();
      expect(result.reloaded).toBe(true);
      expect(result.kernel).toBe('pi');
      expect(host.getSession(record.id).info.title).toBe('Keep me');
      expect(host.listSessions()).toHaveLength(1);
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('runCommand /reload invokes reload and replies in-process', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-cmd-'));
    try {
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/project',
      });
      const record = await host.createSession({ directory: '/tmp/project' });
      let reloads = 0;
      const original = host.reload.bind(host);
      host.reload = async () => {
        reloads += 1;
        return original();
      };
      const result = await host.runCommand(record.id, { command: 'reload', messageID: 'msg_reload' });
      expect(reloads).toBe(1);
      expect(result.info.role).toBe('assistant');
      expect(result.parts[0].text).toMatch(/Reloaded Pi/);
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('setDefaults persists thinking for session settings', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-defaults-'));
    try {
      const host = createPiHost({ mock: true, home, defaultDirectory: '/tmp/project' });
      expect(host.getDefaults().thinking).toBe('medium');
      const saved = host.setDefaults({ thinking: 'high', defaultModel: 'bmlab/grok-4.6' });
      expect(saved.thinking).toBe('high');
      expect(saved.model).toBe('bmlab/grok-4.6');
      expect(host.getDefaults()).toMatchObject({ thinking: 'high', model: 'bmlab/grok-4.6' });
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
