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

  it('attaches models.json name and baseURL so Settings can edit custom providers', () => {
    const providers = mapPiModelsToProviders(
      [{ id: 'grok-4.6', name: 'Grok 4.6', provider: 'grok' }],
      {
        configs: {
          grok: {
            name: 'Grok',
            baseUrl: 'https://ai.example.test/v1',
            headers: { 'X-Test': '1' },
            models: [{ id: 'grok-4.6', name: 'Grok 4.6' }],
          },
        },
      },
    );
    expect(providers[0].name).toBe('Grok');
    expect(providers[0].options).toEqual({
      baseURL: 'https://ai.example.test/v1',
      headers: { 'X-Test': '1' },
    });
  });

  it('exposes $VAR providers as env so Settings can edit without a pasted key', () => {
    const providers = mapPiModelsToProviders([], {
      configs: {
        grok: {
          name: 'Grok',
          baseUrl: 'https://ai.example.test/v1',
          env: ['GROK_KEY'],
          models: [{ id: 'grok-4.6', name: 'Grok 4.6' }],
        },
      },
    });
    expect(providers[0].env).toEqual(['GROK_KEY']);
    expect(providers[0].options.baseURL).toBe('https://ai.example.test/v1');
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
      const saved = host.setDefaults({ thinking: 'high', defaultModel: 'example-provider/example-model' });
      expect(saved.thinking).toBe('high');
      expect(saved.model).toBe('example-provider/example-model');
      expect(host.getDefaults()).toMatchObject({ thinking: 'high', model: 'example-provider/example-model' });
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('forkSession copies messages up to the chosen user message', async () => {
    const host = createPiHost({ mock: true, defaultDirectory: '/tmp/project' });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Source' });
    await host.promptAsync(record.id, { messageID: 'msg_a', parts: [{ type: 'text', text: 'first' }] });
    await new Promise((resolve) => setTimeout(resolve, 40));
    await host.promptAsync(record.id, { messageID: 'msg_b', parts: [{ type: 'text', text: 'second' }] });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const sourceMessages = host.getMessages(record.id);
    expect(sourceMessages.some((entry) => entry.info.id === 'msg_a')).toBe(true);
    expect(sourceMessages.some((entry) => entry.info.id === 'msg_b')).toBe(true);
    const forked = await host.forkSession(record.id, 'msg_a');
    const forkedMessages = host.getMessages(forked.id);
    expect(forkedMessages.map((entry) => entry.info.id)).toContain('msg_a');
    expect(forkedMessages.map((entry) => entry.info.id)).not.toContain('msg_b');
    expect(forkedMessages.every((entry) => entry.info.sessionID === forked.id)).toBe(true);
    const texts = forkedMessages.flatMap((entry) => (entry.parts || []).map((part) => part.text).filter(Boolean));
    expect(texts.join(' ')).toContain('first');
    expect(texts.join(' ')).not.toContain('second');
    const tree = host.getSessionTree(record.id);
    expect(tree.some((node) => node.id === 'msg_a' && node.role === 'user')).toBe(true);
    host.dispose();
  });
});
