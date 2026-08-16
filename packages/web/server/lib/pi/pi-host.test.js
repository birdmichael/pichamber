import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { writePiPrompt } from './pi-resources.js';
import {
  createInMemoryPiSession,
  createPiHost,
  isPlaceholderSessionTitle,
  mapPiModelsToProviders,
  mergeLiveExtensionCommands,
  normalizePiSessionUsage,
  readLiveSessionCommands,
  resolvePromptModelRef,
  titleFromUserText,
} from './pi-host.js';

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

  it('exposes limit.context from Pi contextWindow', () => {
    const providers = mapPiModelsToProviders([
      { id: 'example-model', name: 'Example', provider: 'example', contextWindow: 200000, maxTokens: 8192 },
    ]);
    expect(providers[0].models['example-model'].limit).toEqual({ context: 200000, output: 8192 });
  });
});

describe('normalizePiSessionUsage', () => {
  it('aliases Pi contextWindow for the composer chip and context panel', () => {
    expect(normalizePiSessionUsage({ tokens: 4000, contextWindow: 200000, percent: 2 })).toEqual({
      available: true,
      tokens: 4000,
      contextLimit: 200000,
      contextWindow: 200000,
      percent: 2,
    });
  });

  it('falls back to session stats contextUsage when getContextUsage is missing', () => {
    expect(normalizePiSessionUsage(undefined, {
      tokens: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
      contextUsage: { tokens: 1500, contextWindow: 128000, percent: 1.171875 },
    })).toMatchObject({
      available: true,
      tokens: 1500,
      contextLimit: 128000,
      percent: 1.171875,
    });
  });

  it('does not invent token counts when Pi reports unknown usage', () => {
    expect(normalizePiSessionUsage({ tokens: null, contextWindow: 200000, percent: null })).toEqual({
      available: true,
      tokens: null,
      contextLimit: 200000,
      contextWindow: 200000,
      percent: null,
    });
  });
});

describe('session conversation titles', () => {
  it('treats empty and default labels as placeholders', () => {
    expect(isPlaceholderSessionTitle('')).toBe(true);
    expect(isPlaceholderSessionTitle('New session')).toBe(true);
    expect(isPlaceholderSessionTitle('Pi session')).toBe(true);
    expect(isPlaceholderSessionTitle('nihao')).toBe(false);
  });

  it('uses the first line of the user message as the title', () => {
    expect(titleFromUserText('  nihao\nsecond line  ')).toBe('nihao second line');
    expect(titleFromUserText('x'.repeat(80))).toBe(`${'x'.repeat(57)}...`);
  });

  it('renames a placeholder session from the first prompt and keeps a custom title', async () => {
    const host = createPiHost({ mock: true, defaultDirectory: '/tmp/project' });
    const untitled = await host.createSession({ directory: '/tmp/project' });
    expect(untitled.info.title).toBe('New session');

    await host.promptAsync(untitled.id, { parts: [{ type: 'text', text: 'nihao' }] });
    expect(host.getSession(untitled.id).info.title).toBe('nihao');

    await host.promptAsync(untitled.id, { parts: [{ type: 'text', text: 'yuedu wo diannao de mulu' }] });
    expect(host.getSession(untitled.id).info.title).toBe('nihao');

    const named = await host.createSession({ directory: '/tmp/project', title: 'Keep me' });
    await host.promptAsync(named.id, { parts: [{ type: 'text', text: 'should not replace' }] });
    expect(host.getSession(named.id).info.title).toBe('Keep me');
    host.dispose();
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
      const events = [];
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/project',
        onEvent(_directory, event) {
          events.push(event);
        },
      });
      const record = await host.createSession({ directory: '/tmp/project', title: 'Keep me' });
      events.length = 0;
      const result = await host.reload();
      expect(result.reloaded).toBe(true);
      expect(result.kernel).toBe('pi');
      expect(host.getSession(record.id).info.title).toBe('Keep me');
      expect(host.listSessions()).toHaveLength(1);
      expect(events.some((event) => event.type === 'server.connected')).toBe(false);
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('host.reload() does not emit type: server.connected', async () => {
    const events = [];
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      onEvent(_directory, event) {
        events.push(event);
      },
    });
    await host.createSession({ directory: '/tmp/project', title: 'Stay' });
    events.length = 0;
    const result = await host.reload();
    expect(result).toMatchObject({ reloaded: true, kernel: 'pi' });
    expect(result.skills).toBeDefined();
    expect(result.commands).toBeDefined();
    expect(events.map((event) => event.type)).not.toContain('server.connected');
    expect(events.some((event) => event.type === 'session.updated')).toBe(true);
    host.dispose();
  });

  it('reload({ sessionID }) only reloads that session and ignores a busy sibling', async () => {
    const idleSession = createInMemoryPiSession();
    const busySession = createInMemoryPiSession({ compacting: true });
    const created = [];
    const host = createPiHost({
      mock: true,
      createSession: async () => {
        const next = created.length === 0 ? idleSession : busySession;
        created.push(next);
        return next;
      },
    });
    const idle = await host.createSession({ directory: '/tmp/project', title: 'Idle' });
    const busy = await host.createSession({ directory: '/tmp/project', title: 'Busy' });
    const result = await host.reload({ sessionID: idle.id });
    expect(result).toMatchObject({
      reloaded: true,
      kernel: 'pi',
      sessionID: idle.id,
    });
    expect(idleSession.reloadCount).toBe(1);
    expect(busySession.reloadCount).toBe(0);
    await expect(host.reload({ sessionID: busy.id })).rejects.toMatchObject({
      status: 409,
      message: 'Wait for compaction to finish before reloading.',
    });
    expect(busySession.reloadCount).toBe(0);
    host.dispose();
  });

  it('reload refuses while a session is streaming', async () => {
    const host = createPiHost({
      mock: true,
      createSession: async () => createInMemoryPiSession({
        chunks: ['one ', 'two ', 'three'],
        chunkDelayMs: 40,
      }),
    });
    const record = await host.createSession({ directory: '/tmp/project' });
    const prompt = host.promptAsync(record.id, { parts: [{ type: 'text', text: 'go' }] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(host.reload()).rejects.toMatchObject({
      status: 409,
      message: 'Wait for the current response to finish before reloading.',
    });
    await host.abort(record.id);
    await prompt;
    host.dispose();
  });

  it('reload refuses while a session is compacting', async () => {
    const host = createPiHost({
      mock: true,
      createSession: async () => createInMemoryPiSession({ compacting: true }),
    });
    await host.createSession({ directory: '/tmp/project' });
    await expect(host.reload()).rejects.toMatchObject({
      status: 409,
      message: 'Wait for compaction to finish before reloading.',
    });
    host.dispose();
  });

  it('runCommand /reload is not a user command and does not reload', async () => {
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
      await expect(host.runCommand(record.id, { command: 'reload', messageID: 'msg_reload' })).rejects.toMatchObject({
        status: 400,
        message: 'reload is not a user command',
      });
      expect(reloads).toBe(0);
      expect(host.getMessages(record.id)).toEqual([]);
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('dispatches live extension commands through session.prompt, not promptAsync', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-ext-cmd-'));
    try {
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/project',
      });
      const record = await host.createSession({ directory: '/tmp/project' });
      let promptAsyncCalls = 0;
      const originalPromptAsync = host.promptAsync.bind(host);
      host.promptAsync = async (...args) => {
        promptAsyncCalls += 1;
        return originalPromptAsync(...args);
      };
      const prompted = [];
      const originalPrompt = record.piSession.prompt.bind(record.piSession);
      record.piSession.prompt = async (text, options) => {
        prompted.push(text);
        return originalPrompt(text, options);
      };
      let receivedArgs = null;
      record.piSession.registerCommand('plan', async (args) => {
        receivedArgs = args;
      }, { description: 'Enter plan mode' });

      const before = host.getMessages(record.id);
      const result = await host.runCommand(record.id, { command: 'plan', arguments: 'start' });
      expect(receivedArgs).toBe('start');
      expect(prompted).toEqual(['/plan start']);
      expect(promptAsyncCalls).toBe(0);
      expect(result.info.role).toBe('assistant');
      expect(result.parts).toEqual([]);
      const texts = host.getMessages(record.id).flatMap((entry) => (
        (entry.parts || []).map((part) => part.text).filter(Boolean)
      ));
      expect(texts).not.toContain('/plan start');
      expect(host.getMessages(record.id)).toHaveLength(before.length);
      expect(host.listCommands('/tmp/project').some((command) => (
        command.name === 'plan' && command.source === 'extension'
      ))).toBe(true);
      expect(host.listCommands('/tmp/project').some((command) => command.name === 'reload')).toBe(false);
      await host.reload();
      expect(host.listCommands('/tmp/project').some((command) => (
        command.name === 'plan' && command.source === 'extension'
      ))).toBe(true);
      expect(host.listCommands('/tmp/project').some((command) => command.name === 'reload')).toBe(false);
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('rejects unknown slash names instead of sending them as chat', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-unknown-cmd-'));
    try {
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/project',
      });
      const record = await host.createSession({ directory: '/tmp/project' });
      let promptAsyncCalls = 0;
      const originalPromptAsync = host.promptAsync.bind(host);
      host.promptAsync = async (...args) => {
        promptAsyncCalls += 1;
        return originalPromptAsync(...args);
      };
      await expect(host.runCommand(record.id, { command: 'not-a-command', arguments: 'please' }))
        .rejects.toMatchObject({ status: 404, message: 'Unknown command: /not-a-command' });
      expect(promptAsyncCalls).toBe(0);
      expect(host.getMessages(record.id)).toEqual([]);
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('still expands markdown prompt commands through promptAsync', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-prompt-cmd-'));
    try {
      writePiPrompt({
        home,
        name: 'ship',
        description: 'Ship it',
        template: 'Prepare the change: $ARGUMENTS',
      });
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/project',
      });
      const record = await host.createSession({ directory: '/tmp/project' });
      const result = await host.runCommand(record.id, { command: 'ship', arguments: 'the docs' });
      expect(result.info.role).toBe('user');
      expect(result.parts[0].text).toBe('Prepare the change: the docs');
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('reloadIdleSessions reloads idle sessions and skips a busy sibling', async () => {
    const idleSession = createInMemoryPiSession();
    const busySession = createInMemoryPiSession({ compacting: true });
    const created = [];
    const events = [];
    const host = createPiHost({
      mock: true,
      createSession: async () => {
        const next = created.length === 0 ? idleSession : busySession;
        created.push(next);
        return next;
      },
      onEvent(_directory, event) {
        events.push(event);
      },
    });
    const idle = await host.createSession({ directory: '/tmp/project', title: 'Idle' });
    await host.createSession({ directory: '/tmp/project', title: 'Busy' });
    events.length = 0;
    const result = await host.reloadIdleSessions();
    expect(result.reloaded).toEqual([idle.id]);
    expect(result.skipped).toHaveLength(1);
    expect(idleSession.reloadCount).toBe(1);
    expect(busySession.reloadCount).toBe(0);
    expect(events.map((event) => event.type)).not.toContain('server.connected');
    host.dispose();
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

  it('persists Pi message.usage onto stored assistant tokens', async () => {
    const createUsageSession = () => {
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
        async prompt() {
          emit({ type: 'agent_start' });
          emit({ type: 'message_start', message: { role: 'assistant', content: [] } });
          emit({
            type: 'message_end',
            message: {
              role: 'assistant',
              usage: {
                input: 2100,
                output: 60,
                cacheRead: 80,
                cacheWrite: 0,
                reasoning: 10,
                cost: { total: 0.003 },
              },
            },
          });
          emit({ type: 'agent_settled' });
        },
        getContextUsage() {
          return { tokens: 2240, contextWindow: 128000, percent: 1.75 };
        },
      };
    };
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-usage-'));
    const host = createPiHost({
      home,
      defaultDirectory: '/tmp/project',
      createModelRuntime: async () => ({ getAvailable: async () => [] }),
      createDirectoryRuntime: async ({ cwd }) => ({ session: null, directory: cwd }),
      createSession: async () => createUsageSession(),
    });
    const record = await host.createSession({ directory: '/tmp/project' });
    await host.promptAsync(record.id, { messageID: 'msg_user', parts: [{ type: 'text', text: 'hi' }] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const assistant = host.getMessages(record.id).find((entry) => entry.info.role === 'assistant');
    expect(assistant.info.tokens).toEqual({
      input: 2100,
      output: 60,
      reasoning: 10,
      cache: { read: 80, write: 0 },
    });
    expect(assistant.info.cost).toBe(0.003);
    expect(host.getSessionUsage(record.id).percent).toBe(1.75);
    host.dispose();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('getSessionUsage returns normalized Pi context usage', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-usage2-'));
    const host = createPiHost({
      home,
      defaultDirectory: '/tmp/project',
      createModelRuntime: async () => ({ getAvailable: async () => [] }),
      createDirectoryRuntime: async ({ cwd }) => ({ session: null, directory: cwd }),
      createSession: async () => ({
        isStreaming: false,
        subscribe() { return () => {}; },
        async prompt() {},
        getContextUsage() {
          return { tokens: 2560, contextWindow: 128000, percent: 2 };
        },
      }),
    });
    const record = await host.createSession({ directory: '/tmp/project' });
    expect(host.getSessionUsage(record.id)).toEqual({
      available: true,
      tokens: 2560,
      contextLimit: 128000,
      contextWindow: 128000,
      percent: 2,
    });
    host.dispose();
    fs.rmSync(home, { recursive: true, force: true });
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

  it('promptAsync applies the requested Pi model before sending the prompt', async () => {
    const host = createPiHost({ mock: true, defaultDirectory: '/tmp/project' });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Multi-run' });
    await host.promptAsync(record.id, {
      messageID: 'msg_model',
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
      parts: [{ type: 'text', text: 'run this model' }],
    });
    expect(record.piSession.currentModel).toEqual({
      id: 'claude-sonnet-4-5',
      provider: 'anthropic',
    });
    host.dispose();
  });

  it('binds Desktop ctx.ui on every live session and resolves a fake select', async () => {
    const events = [];
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      onEvent: (directory, event) => events.push({ directory, event }),
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'UI bind' });
    expect(record.piSession.extensionBindings?.mode).toBe('rpc');
    expect(record.piSession.extensionBindings?.uiContext).toBeTruthy();
    expect(host.getExtensionUI(record.id)).toBeTruthy();

    const choice = host.getExtensionUI(record.id).context.select('Header: Ship now?', [
      '1. Yes — smallest change',
      '2. Other (free-form)',
    ]);
    const [prompt] = host.listExtensionUIPrompts(record.id);
    expect(prompt.kind).toBe('select');
    expect(events.some((item) => item.event.type === 'pi.ui.asked')).toBe(true);
    expect(events.some((item) => String(item.event.type).startsWith('question.'))).toBe(false);

    expect(host.replyExtensionUI(record.id, prompt.id, '1. Yes — smallest change')).toBe(true);
    await expect(choice).resolves.toBe('1. Yes — smallest change');
    host.dispose();
  });

  it('reload({ sessionID }) re-binds Desktop ctx.ui after piSession.reload()', async () => {
    const piSession = createInMemoryPiSession();
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      createSession: async () => piSession,
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Title refresh' });
    expect(piSession.bindCount).toBe(1);
    expect(piSession.extensionBindings?.mode).toBe('rpc');
    const firstContext = host.getExtensionUI(record.id).context;

    const result = await host.reload({ sessionID: record.id });
    expect(result).toMatchObject({ reloaded: true, kernel: 'pi', sessionID: record.id });
    expect(piSession.reloadCount).toBe(1);
    expect(piSession.bindCount).toBe(2);
    expect(piSession.extensionBindings?.mode).toBe('rpc');
    expect(piSession.extensionBindings?.uiContext).toBeTruthy();
    expect(host.getExtensionUI(record.id).context).not.toBe(firstContext);

    const choice = host.getExtensionUI(record.id).context.select('Header: After reload?', [
      '1. Yes — still bound',
    ]);
    const [prompt] = host.listExtensionUIPrompts(record.id);
    expect(prompt.kind).toBe('select');
    expect(host.replyExtensionUI(record.id, prompt.id, '1. Yes — still bound')).toBe(true);
    await expect(choice).resolves.toBe('1. Yes — still bound');
    host.dispose();
  });

  it('cancels a waiting confirm without disposing the session', async () => {
    const host = createPiHost({ mock: true, defaultDirectory: '/tmp/project' });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Goal confirm' });
    const confirmed = host.getExtensionUI(record.id).context.confirm('Replace goal?', 'Replace the current goal?');
    const [prompt] = host.listExtensionUIPrompts(record.id);
    expect(host.cancelExtensionUI(record.id, prompt.id)).toBe(true);
    await expect(confirmed).resolves.toBe(false);
    expect(host.getSession(record.id).id).toBe(record.id);
    expect(host.listExtensionUIPrompts(record.id)).toEqual([]);
    host.dispose();
  });
});

describe('live session command helpers', () => {
  it('reads getCommands() and falls back to extensionRunner', () => {
    expect(readLiveSessionCommands({
      getCommands: () => [{ name: 'plan', source: 'extension', description: 'Plan' }],
    })).toEqual([{ name: 'plan', source: 'extension', description: 'Plan' }]);
    expect(readLiveSessionCommands({
      extensionRunner: {
        getRegisteredCommands: () => [{ invocationName: 'goal', description: 'Set a goal' }],
      },
    })).toEqual([{ name: 'goal', description: 'Set a goal', source: 'extension' }]);
    expect(readLiveSessionCommands({})).toEqual([]);
  });

  it('merges live extension commands over prompts without replacing builtins', () => {
    const merged = mergeLiveExtensionCommands(
      [
        { name: 'compact', source: 'builtin', agent: 'pi' },
        { name: 'plan', source: 'prompt', template: 'old', agent: 'pi' },
      ],
      [
        { name: 'compact', source: 'extension', description: 'Nope' },
        { name: 'plan', source: 'extension', description: 'Enter plan mode' },
        { name: 'goal', source: 'extension', description: 'Set a goal' },
        { name: 'reload', source: 'extension', description: 'Host only' },
        { name: 'skill:review', source: 'skill', description: 'Skill' },
      ],
    );
    expect(merged.find((command) => command.name === 'compact').source).toBe('builtin');
    expect(merged.find((command) => command.name === 'plan')).toMatchObject({
      source: 'extension',
      description: 'Enter plan mode',
      agent: 'pi',
    });
    expect(merged.some((command) => command.name === 'goal' && command.source === 'extension')).toBe(true);
    expect(merged.some((command) => command.name === 'reload')).toBe(false);
    expect(merged.some((command) => command.name === 'skill:review')).toBe(false);
  });
});

describe('resolvePromptModelRef', () => {
  it('reads provider/model from the OpenCode prompt body', () => {
    expect(resolvePromptModelRef({ providerID: 'anthropic', modelID: 'claude-sonnet-4-5' }))
      .toBe('anthropic/claude-sonnet-4-5');
    expect(resolvePromptModelRef('openai/gpt-5')).toBe('openai/gpt-5');
    expect(resolvePromptModelRef(null)).toBe('');
  });
});

describe('session plan status and actions', () => {
  it('reads live plan-mode-state and dispatches start/save/implement/exit', async () => {
    const events = [];
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      onEvent(_directory, event) {
        events.push(event);
      },
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Plan' });
    expect(await host.getSessionPlan(record.id)).toEqual({ status: 'off', planMarkdown: '' });

    const prompted = [];
    const originalPrompt = record.piSession.prompt.bind(record.piSession);
    record.piSession.prompt = async (text, options) => {
      prompted.push(text);
      return originalPrompt(text, options);
    };

    expect(await host.runPlanAction(record.id, { action: 'start' })).toEqual({
      status: 'active',
      planMarkdown: '',
    });
    expect(prompted).toEqual(['/plan start']);

    record.piSession.setPlanModeState({
      enabled: true,
      latestPlan: '# Ready plan\n\nDo the work.',
      awaitingAction: true,
    });
    expect(await host.getSessionPlan(record.id)).toMatchObject({
      status: 'ready',
      planMarkdown: '# Ready plan\n\nDo the work.',
      title: 'Ready plan',
    });

    expect(await host.runPlanAction(record.id, { action: 'save' })).toMatchObject({
      status: 'saved',
      planMarkdown: '# Ready plan\n\nDo the work.',
    });
    expect(prompted).toEqual(['/plan start', '/plan save']);

    expect(await host.runPlanAction(record.id, { action: 'implement' })).toMatchObject({
      status: 'implementing',
      planMarkdown: '# Ready plan\n\nDo the work.',
    });
    expect(prompted).toEqual(['/plan start', '/plan save', '/plan implement']);
    expect(events.some((event) => event.type === 'pi.plan.updated')).toBe(true);

    expect(await host.runPlanAction(record.id, { action: 'exit' })).toEqual({
      status: 'off',
      planMarkdown: '',
    });
    expect(prompted.at(-1)).toBe('/plan exit');
    host.dispose();
  });

  it('resumes a saved plan without sending /plan start', async () => {
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Resume' });
    record.piSession.setPlanModeState({
      enabled: false,
      savedPlan: { plan: '# Saved\n\nKeep this.', source: 'plan_mode_complete' },
    });
    const prompted = [];
    const originalPrompt = record.piSession.prompt.bind(record.piSession);
    record.piSession.prompt = async (text, options) => {
      prompted.push(text);
      return originalPrompt(text, options);
    };

    await expect(host.runPlanAction(record.id, { action: 'start' })).rejects.toMatchObject({
      status: 409,
    });
    expect(prompted).toEqual(['/plan start']);

    const plan = await host.runPlanAction(record.id, { action: 'resume' });
    expect(plan).toMatchObject({
      status: 'ready',
      planMarkdown: '# Saved\n\nKeep this.',
    });
    expect(prompted).toEqual(['/plan start']);
    expect(record.piSession.reloadCount).toBe(1);
    expect(record.piSession.bindCount).toBe(2);
    host.dispose();
  });

  it('refuses plan actions while the session is busy', async () => {
    const busy = createInMemoryPiSession({ compacting: true });
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      createSession: async () => busy,
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Busy' });
    await expect(host.runPlanAction(record.id, { action: 'start' })).rejects.toMatchObject({
      status: 409,
    });
    host.dispose();
  });
});

