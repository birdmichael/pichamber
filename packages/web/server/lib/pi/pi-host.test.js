import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { writePiPrompt } from './pi-resources.js';
import {
  createSettingsJsonPackageManager,
  writeFeaturePlugins,
} from './feature-plugins.js';
import {
  createInMemoryPiSession,
  createPiHost,
  isPlaceholderSessionTitle,
  resolveListedSessionTitle,
  mapPiModelsToProviders,
  mergeLiveExtensionCommands,
  normalizePiSessionUsage,
  readLiveSessionCommands,
  resolvePromptModelRef,
  titleFromUserText,
} from './pi-host.js';

const waitForExtensionPrompts = async (host, sessionID) => {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const prompts = host.listExtensionUIPrompts(sessionID);
    if (prompts.length > 0) return prompts;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for Desktop ctx.ui prompts');
};

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

  it('exposes models.json api so Settings can prefill the protocol', () => {
    const providers = mapPiModelsToProviders(
      [{ id: 'claude', name: 'Claude', provider: 'claude-proxy' }],
      {
        configs: {
          'claude-proxy': {
            name: 'Claude proxy',
            baseUrl: 'https://api.example.test',
            api: 'anthropic-messages',
            models: [{ id: 'claude', name: 'Claude' }],
          },
        },
      },
    );
    expect(providers[0].api).toBe('anthropic-messages');
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

  it('fills missing live context from models.json without overwriting a live window', () => {
    const providers = mapPiModelsToProviders(
      [{ id: 'gpt-4o', name: 'GPT-4o', provider: 'acme' }],
      {
        configs: {
          acme: {
            name: 'Acme',
            baseUrl: 'https://ai.example.test/v1',
            models: [{ id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000 }],
          },
        },
      },
    );
    expect(providers[0].models['gpt-4o'].contextWindow).toBe(128000);
    expect(providers[0].models['gpt-4o'].limit.context).toBe(128000);

    const kept = mapPiModelsToProviders(
      [{ id: 'gpt-4o', name: 'GPT-4o', provider: 'acme', contextWindow: 64000 }],
      {
        configs: {
          acme: {
            models: [{ id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000 }],
          },
        },
      },
    );
    expect(kept[0].models['gpt-4o'].contextWindow).toBe(64000);
    expect(kept[0].models['gpt-4o'].limit.context).toBe(64000);
  });

  it('exposes Pi input as composer capabilities without inventing vision', () => {
    const providers = mapPiModelsToProviders([
      { id: 'grok-4.6', name: 'Grok 4.6', provider: 'acme', input: ['text', 'image'] },
      { id: 'mystery', name: 'Mystery', provider: 'acme' },
    ]);
    expect(providers[0].models['grok-4.6'].input).toEqual(['text', 'image']);
    expect(providers[0].models['grok-4.6'].reasoning).toBe(true);
    expect(providers[0].models['grok-4.6'].capabilities).toEqual({
      reasoning: true,
      attachment: true,
      input: { text: true, image: true, audio: false, video: false, pdf: false },
    });
    expect(providers[0].models.mystery.input).toBeUndefined();
    expect(providers[0].models.mystery.capabilities).toBeUndefined();

    const filled = mapPiModelsToProviders(
      [{ id: 'grok-4.6', name: 'Grok 4.6', provider: 'acme' }],
      {
        configs: {
          acme: {
            models: [{ id: 'grok-4.6', name: 'Grok 4.6', input: ['text', 'image'] }],
          },
        },
      },
    );
    expect(filled[0].models['grok-4.6'].input).toEqual(['text', 'image']);
    expect(filled[0].models['grok-4.6'].capabilities.input.image).toBe(true);

    const kept = mapPiModelsToProviders(
      [{ id: 'grok-4.6', name: 'Grok 4.6', provider: 'acme', input: ['text'] }],
      {
        configs: {
          acme: {
            models: [{ id: 'grok-4.6', name: 'Grok 4.6', input: ['text', 'image'] }],
          },
        },
      },
    );
    expect(kept[0].models['grok-4.6'].input).toEqual(['text', 'image']);
    expect(kept[0].models['grok-4.6'].capabilities.input.image).toBe(true);
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
    expect(isPlaceholderSessionTitle('Untitled Session')).toBe(true);
    expect(isPlaceholderSessionTitle('(no messages)')).toBe(true);
    expect(isPlaceholderSessionTitle('no messages')).toBe(true);
    expect(isPlaceholderSessionTitle('nihao')).toBe(false);
  });

  it('lists empty sessions as New session instead of first-message placeholders', () => {
    expect(resolveListedSessionTitle({ firstMessage: '(no messages)' })).toBe('New session');
    expect(resolveListedSessionTitle({ name: 'Pi session' })).toBe('New session');
    expect(resolveListedSessionTitle({ name: 'New session', firstMessage: 'hello' })).toBe('hello');
    expect(resolveListedSessionTitle({ name: '195-daily-ping hello' })).toBe('195-daily-ping hello');
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

  it('rejects in-app Pi upgrade because the bundled SDK is not supported', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-upgrade-'));
    const seen = [];
    const host = createPiHost({
      mock: true,
      home,
      defaultDirectory: '/tmp/project',
      runSelfUpdate: async (options) => {
        seen.push(options.agentDir);
        return { ok: true, command: 'pi update' };
      },
    });
    await expect(host.upgradePi()).rejects.toMatchObject({
      status: 403,
      code: 'PI_UPGRADE_UNSUPPORTED',
      message: expect.stringMatching(/bundled Pi SDK cannot be upgraded/i),
    });
    expect(seen).toEqual([]);
    host.dispose();
  });

  it('updates a configured settings.json package and refreshes the list', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-pkg-update-'));
    await createSettingsJsonPackageManager({ home }).installAndPersist('npm:pi-question-tool');
    await createSettingsJsonPackageManager({ home }).installAndPersist('npm:pi-mcp-adapter');
    const host = createPiHost({
      mock: true,
      home,
      defaultDirectory: '/tmp/project',
    });
    const result = await host.updatePiPackages({ source: 'npm:pi-question-tool' });
    expect(result.packages.map((item) => item.name)).toEqual([
      'pi-question-tool',
      'pi-mcp-adapter',
    ]);
    await expect(host.updatePiPackages({ source: 'npm:missing' })).rejects.toMatchObject({
      status: 404,
    });
    host.dispose();
  });

  it('uninstalls one configured settings.json package and leaves siblings', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-pkg-uninstall-'));
    await createSettingsJsonPackageManager({ home }).installAndPersist('npm:pi-question-tool');
    await createSettingsJsonPackageManager({ home }).installAndPersist('npm:pi-mcp-adapter');
    const host = createPiHost({
      mock: true,
      home,
      defaultDirectory: '/tmp/project',
    });
    const result = await host.removePiPackage({ source: 'npm:pi-mcp-adapter' });
    expect(result.packages.map((item) => item.name)).toEqual(['pi-question-tool']);
    await expect(host.removePiPackage({ source: 'npm:missing' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(host.removePiPackage({ source: '' })).rejects.toMatchObject({
      status: 400,
    });
    host.dispose();
  });

  it('re-resolves the agent directory on reload after a settings change', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-agent-dir-'));
    const first = path.join(home, 'first-agent');
    const second = path.join(home, 'second-agent');
    const previousDataDir = process.env.OPENCHAMBER_DATA_DIR;
    delete process.env.OPENCHAMBER_DATA_DIR;
    try {
      fs.mkdirSync(first, { recursive: true });
      fs.mkdirSync(second, { recursive: true });
      fs.mkdirSync(path.join(home, '.config', 'openchamber'), { recursive: true });
      fs.writeFileSync(
        path.join(home, '.config', 'openchamber', 'settings.json'),
        JSON.stringify({ piAgentDir: first }),
      );
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/project',
      });
      expect(host.getPath('/tmp/project').config).toBe(first);
      expect(host.getKernelInfo().paths.agent).toBe(first);
      fs.writeFileSync(
        path.join(home, '.config', 'openchamber', 'settings.json'),
        JSON.stringify({ piAgentDir: second }),
      );
      await host.reload();
      expect(host.getPath('/tmp/project').config).toBe(second);
      expect(host.getKernelInfo().paths.agent).toBe(second);
      expect(host.getKernelInfo().paths.models).toBe(path.join(second, 'models.json'));
      host.dispose();
    } finally {
      if (previousDataDir === undefined) delete process.env.OPENCHAMBER_DATA_DIR;
      else process.env.OPENCHAMBER_DATA_DIR = previousDataDir;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('emits session.compacted after a successful compact so pinned context can reinject', async () => {
    const events = [];
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      onEvent: (directory, event) => events.push({ directory, event }),
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Pin compact' });
    events.length = 0;
    await expect(host.compactSession(record.id)).resolves.toEqual({ compacted: true });
    const types = events.map((item) => item.event.type);
    // Compact also replays the session todo snapshot (todo.updated). That is
    // not the pin-inject contract this test owns.
    expect(types.filter((type) => type !== 'todo.updated')).toEqual([
      'session.status',
      'session.compact',
      'session.compact',
      'session.compacted',
    ]);
    const compactEvents = events.filter((item) => item.event.type !== 'todo.updated');
    expect(compactEvents[1].event.properties).toMatchObject({ sessionID: record.id, status: 'start' });
    expect(compactEvents[2].event.properties).toMatchObject({ sessionID: record.id, status: 'end' });
    expect(compactEvents[3].event).toMatchObject({
      type: 'session.compacted',
      properties: { sessionID: record.id, directory: '/tmp/project' },
    });
    expect(events.some((item) => (
      item.event.type === 'todo.updated' && item.event.properties?.sessionID === record.id
    ))).toBe(true);
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
          emit({ type: 'message_start', message: { role: 'user', id: '5bb000de', content: text } });
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

  it('settles a finished prompt that never emitted agent_settled', async () => {
    const events = [];
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      onEvent(_directory, event) {
        events.push(event);
      },
      createSession: async () => {
        const listeners = new Set();
        const emit = (event) => {
          for (const listener of Array.from(listeners)) listener(event);
        };
        return {
          isStreaming: false,
          isCompacting: false,
          subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          async prompt() {
            emit({ type: 'agent_start' });
            emit({ type: 'message_start', message: { role: 'assistant', content: [] } });
            emit({
              type: 'message_update',
              assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '1' },
            });
            emit({
              type: 'message_end',
              message: { role: 'assistant', content: [{ type: 'text', text: '1' }] },
            });
            emit({ type: 'agent_end', messages: [], willRetry: false });
          },
          async abort() {},
          dispose() { listeners.clear(); },
        };
      },
    });
    const record = await host.createSession({ directory: '/tmp/project' });
    await host.promptAsync(record.id, { parts: [{ type: 'text', text: 'count' }] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(host.getStatus()[record.id]).toBeUndefined();
    expect(events.some((event) => event.type === 'session.idle')).toBe(true);
    host.dispose();
  });

  it('force-idles when abort is a no-op after the turn is already done', async () => {
    const events = [];
    let streaming = true;
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      onEvent(_directory, event) {
        events.push(event);
      },
      createSession: async () => {
        const listeners = new Set();
        const emit = (event) => {
          for (const listener of Array.from(listeners)) listener(event);
        };
        return {
          get isStreaming() {
            return streaming;
          },
          isCompacting: false,
          subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          async prompt() {
            emit({ type: 'agent_start' });
            await new Promise((resolve) => setTimeout(resolve, 40));
          },
          async abort() {},
          dispose() { listeners.clear(); },
        };
      },
    });
    const record = await host.createSession({ directory: '/tmp/project' });
    const prompt = host.promptAsync(record.id, { parts: [{ type: 'text', text: 'go' }] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(host.getStatus()[record.id]).toEqual({ type: 'busy' });
    streaming = false;
    await host.abort(record.id);
    await prompt;
    expect(host.getStatus()[record.id]).toBeUndefined();
    expect(events.filter((event) => event.type === 'session.idle').length).toBeGreaterThan(0);
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

  it('reload interrupts a streaming session instead of hanging', async () => {
    const events = [];
    const host = createPiHost({
      mock: true,
      createSession: async () => createInMemoryPiSession({
        chunks: ['one ', 'two ', 'three'],
        chunkDelayMs: 40,
      }),
      onEvent(_directory, event) {
        events.push(event);
      },
    });
    const record = await host.createSession({ directory: '/tmp/project' });
    const prompt = host.promptAsync(record.id, { parts: [{ type: 'text', text: 'go' }] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const result = await host.reload();
    expect(result).toMatchObject({
      reloaded: true,
      kernel: 'pi',
      interruptedSessionIds: [record.id],
    });
    expect(host.getStatus()[record.id]).toBeUndefined();
    expect(events.some((event) => event.type === 'session.error')).toBe(true);
    expect(events.some((event) => (
      event.type === 'openchamber:notification'
      && event.properties?.kind === 'opencode-restart-interrupted'
      && event.properties?.sessionId === record.id
    ))).toBe(true);
    expect(String(events.find((event) => event.type === 'openchamber:notification')?.properties?.body || ''))
      .not.toMatch(/OpenCode/);
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

  it('reloadSessionRecords does not emit server.connected', async () => {
    const events = [];
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      onEvent(_directory, event) {
        events.push(event);
      },
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Stay' });
    events.length = 0;
    const result = await host.reloadSessionRecords({ sessionID: record.id });
    expect(result).toMatchObject({
      reloaded: true,
      kernel: 'pi',
      sessionID: record.id,
    });
    expect(result.sessions.map((item) => item.id)).toContain(record.id);
    expect(events.map((event) => event.type)).not.toContain('server.connected');
    expect(host.listSessions()).toHaveLength(1);
    host.dispose();
  });

  it('reloadSessionRecords 409s a busy target without clearing siblings', async () => {
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
    await expect(host.reloadSessionRecords({ sessionID: busy.id })).rejects.toMatchObject({
      status: 409,
      message: 'Wait for compaction to finish before reloading.',
    });
    expect(host.listSessions().map((item) => item.id).sort()).toEqual([busy.id, idle.id].sort());
    expect(host.getSession(idle.id).info.title).toBe('Idle');
    expect(busySession.reloadCount).toBe(0);
    expect(idleSession.reloadCount).toBe(0);
    host.dispose();
  });

  it('reloadSessionRecords refreshes an idle session while a sibling is busy', async () => {
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
    const busy = await host.createSession({ directory: '/tmp/project', title: 'Busy' });
    events.length = 0;
    const result = await host.reloadSessionRecords({ sessionID: idle.id });
    expect(result.sessionID).toBe(idle.id);
    expect(result.sessions.map((item) => item.id).sort()).toEqual([busy.id, idle.id].sort());
    expect(idleSession.reloadCount).toBe(1);
    expect(busySession.reloadCount).toBe(0);
    expect(result.skipped.some((item) => item.sessionID === busy.id)).toBe(true);
    expect(events.map((event) => event.type)).not.toContain('server.connected');
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

  it('lists /plan from the Plan slot before any session exists', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-plan-slot-cmd-'));
    try {
      await createSettingsJsonPackageManager({ home }).installAndPersist('npm:@narumitw/pi-plan-mode');
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/empty-project',
      });
      expect(host.listCommands('/tmp/empty-project').some((command) => (
        command.name === 'plan' && command.source === 'extension'
      ))).toBe(true);
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('lists /btw from installed Btw as an extension command and omits it without the package', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-btw-slot-cmd-'));
    try {
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/empty-project',
      });
      expect(host.listCommands('/tmp/empty-project').some((command) => command.name === 'btw')).toBe(false);
      expect(host.getFeaturePlugins().slots.btw).toMatchObject({ installed: false, enabled: false });
      host.dispose();

      await createSettingsJsonPackageManager({ home }).installAndPersist('npm:@narumitw/pi-btw');
      const installed = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/empty-project',
      });
      expect(installed.listCommands('/tmp/empty-project').find((command) => command.name === 'btw')).toMatchObject({
        name: 'btw',
        source: 'extension',
        description: 'Ask a side question in a temporary forked session',
      });
      expect(installed.listCommands('/tmp/empty-project').some((command) => (
        command.name === 'btw' && command.source === 'builtin'
      ))).toBe(false);
      expect(installed.getFeaturePlugins().slots.btw).toMatchObject({
        installed: true,
        enabled: true,
        command: 'btw',
        source: 'npm:@narumitw/pi-btw',
      });
      installed.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('lists /run from installed Subagents without pichamber.json and keeps Plan off', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-recognize-cmd-'));
    try {
      fs.mkdirSync(path.join(home, '.pi', 'agent'), { recursive: true });
      fs.writeFileSync(path.join(home, '.pi', 'agent', 'settings.json'), `${JSON.stringify({
        packages: ['npm:@narumitw/pi-goal', 'npm:pi-mcp-adapter', 'npm:pi-subagents'],
      }, null, 2)}\n`);
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/empty-project',
      });
      const listed = host.listCommands('/tmp/empty-project');
      expect(listed.find((command) => command.name === 'run')).toMatchObject({
        name: 'run',
        source: 'extension',
        description: 'Run a subagent as a one-shot workflow',
      });
      expect(listed.some((command) => command.name === 'plan')).toBe(false);
      expect(listed.some((command) => command.name === 'btw')).toBe(false);
      expect(host.getFeaturePlugins().slots.goal).toMatchObject({ installed: true, enabled: true });
      expect(host.getFeaturePlugins().slots.plan).toMatchObject({ installed: false, enabled: false });
      expect(host.getFeaturePlugins().slots.btw).toMatchObject({ installed: false, enabled: false });
      expect(fs.existsSync(path.join(home, '.pi', 'agent', 'pichamber.json'))).toBe(false);
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

  it('applyFeaturePluginPatch ignores enabled and does not reload from that overlay', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-goal-enable-'));
    const idleSession = createInMemoryPiSession();
    idleSession.registerCommand('goal', async () => {}, { description: 'Goal' });
    try {
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/project',
        createSession: async () => idleSession,
      });
      const idle = await host.createSession({ directory: '/tmp/project', title: 'Idle' });
      const enabledMissing = await host.applyFeaturePluginPatch({ goal: { enabled: true } });
      expect(enabledMissing.slots.goal.enabled).toBe(false);
      expect(enabledMissing.slots.goal.installed).toBe(false);
      expect(enabledMissing.reload).toBeUndefined();
      expect(idleSession.reloadCount).toBe(0);
      expect(fs.existsSync(path.join(home, '.pi', 'agent', 'pichamber.json'))).toBe(false);

      await host.installFeaturePlugin('goal', {});
      expect(idleSession.reloadCount).toBe(1);
      fs.writeFileSync(path.join(home, '.pi', 'agent', 'pichamber.json'), `${JSON.stringify({
        featurePlugins: { goal: { source: 'npm:@narumitw/pi-goal', command: 'goal', enabled: false } },
      }, null, 2)}\n`);
      expect(host.getFeaturePlugins().slots.goal).toMatchObject({ installed: true, enabled: true });
      const ignoredEnabled = await host.applyFeaturePluginPatch({ goal: { enabled: false } });
      expect(ignoredEnabled.slots.goal).toMatchObject({ installed: true, enabled: true });
      expect(ignoredEnabled.reload).toBeUndefined();
      expect(idleSession.reloadCount).toBe(1);
      const chamber = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'pichamber.json'), 'utf8'));
      expect(chamber.featurePlugins.goal.enabled).toBe(false);
      expect(host.listCommands('/tmp/project', { sessionID: idle.id }).some((command) => (
        command.name === 'goal' && command.source === 'extension'
      ))).toBe(true);
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

  it('promptAsync keeps file and image parts on the user message and forwards them to Pi', async () => {
    const host = createPiHost({ mock: true, defaultDirectory: '/tmp/project' });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Image attach' });
    let forwarded;
    const originalPrompt = record.piSession.prompt.bind(record.piSession);
    record.piSession.prompt = async (text, options) => {
      forwarded = { text, options };
      return originalPrompt(text, options);
    };

    const result = await host.promptAsync(record.id, {
      messageID: 'msg_image',
      parts: [
        { type: 'text', text: 'see this' },
        { type: 'file', mime: 'image/png', url: 'data:image/png;base64,AAAA', filename: 'shot.png' },
      ],
    });

    expect(result.parts.map((part) => part.type)).toEqual(['text', 'file']);
    expect(result.parts[1]).toMatchObject({
      type: 'file',
      mime: 'image/png',
      url: 'data:image/png;base64,AAAA',
    });
    const user = host.getMessages(record.id).find((entry) => entry.info.role === 'user');
    expect(user.parts.map((part) => part.type)).toEqual(['text', 'file']);
    expect(user.parts[0].text).toBe('see this');
    expect(user.parts[1]).toMatchObject({
      type: 'file',
      mime: 'image/png',
      url: 'data:image/png;base64,AAAA',
    });
    expect(forwarded.text).toBe('see this');
    expect(forwarded.options.images).toEqual([{
      type: 'image',
      mimeType: 'image/png',
      data: 'AAAA',
    }]);
    host.dispose();
  });

  it('promptAsync persists a Pi-native image part as a facade file part', async () => {
    const host = createPiHost({ mock: true, defaultDirectory: '/tmp/project' });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Native image' });
    let forwarded;
    const originalPrompt = record.piSession.prompt.bind(record.piSession);
    record.piSession.prompt = async (text, options) => {
      forwarded = options;
      return originalPrompt(text, options);
    };

    await host.promptAsync(record.id, {
      parts: [
        { type: 'text', text: 'look' },
        { type: 'image', mimeType: 'image/jpeg', data: 'BBBB' },
      ],
    });

    const user = host.getMessages(record.id).find((entry) => entry.info.role === 'user');
    expect(user.parts.map((part) => part.type)).toEqual(['text', 'file']);
    expect(user.parts[1]).toMatchObject({
      type: 'file',
      mime: 'image/jpeg',
      url: 'data:image/jpeg;base64,BBBB',
    });
    expect(forwarded.images).toEqual([{
      type: 'image',
      mimeType: 'image/jpeg',
      data: 'BBBB',
    }]);
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
    await new Promise((resolve) => setTimeout(resolve, 40));
    const assistant = host.getMessages(record.id).find((entry) => entry.info.role === 'assistant');
    expect(assistant.info).toMatchObject({
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4-5',
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
    });
    expect(assistant.info.providerID).not.toBe('pi');
    expect(assistant.info.modelID).not.toBe('pi');
    host.dispose();
  });

  it('promptAsync stamps Pi defaults on a new-session send when the body has no model', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-default-stamp-'));
    try {
      const host = createPiHost({ mock: true, home, defaultDirectory: '/tmp/project' });
      host.setDefaults({ model: 'example-provider/example-model' });
      const record = await host.createSession({ directory: '/tmp/project', title: 'New session' });
      await host.promptAsync(record.id, {
        messageID: 'msg_user',
        parts: [{ type: 'text', text: '/notacommand' }],
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
      const assistant = host.getMessages(record.id).find((entry) => entry.info.role === 'assistant');
      expect(assistant.info).toMatchObject({
        providerID: 'example-provider',
        modelID: 'example-model',
        model: { providerID: 'example-provider', modelID: 'example-model' },
      });
      expect(assistant.info.providerID).not.toBe('pi');
      expect(assistant.info.modelID).not.toBe('pi');
      expect(assistant.info.cost).toBeUndefined();
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
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

  it('maps an installed question tool onto Desktop select after bind', async () => {
    const definition = {
      name: 'question',
      execute: async () => ({ content: [{ type: 'text', text: 'TUI path' }] }),
    };
    const piSession = createInMemoryPiSession();
    const originalGet = piSession.getToolDefinition.bind(piSession);
    piSession.getToolDefinition = (name) => (
      name === 'question' ? definition : originalGet(name)
    );
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      createSession: async () => piSession,
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Question tool' });
    const pending = definition.execute('call_1', {
      question: 'How wide?',
      options: [{ label: 'One file' }],
    }, undefined, undefined, { ui: host.getExtensionUI(record.id).context, mode: 'rpc' });
    const [prompt] = await waitForExtensionPrompts(host, record.id);
    expect(prompt.kind).toBe('select');
    expect(prompt.options?.at(-1)).toBe('2. Type something.');
    expect(host.replyExtensionUI(record.id, prompt.id, '1. One file')).toBe(true);
    await expect(pending).resolves.toMatchObject({
      content: [{ type: 'text', text: 'User selected: 1. One file' }],
      details: { answer: 'One file', wasCustom: false },
    });
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
    expect(prompt.kind).toBe('confirm');
    expect(host.cancelExtensionUI(record.id, prompt.id)).toBe(true);
    await expect(confirmed).resolves.toBe(false);
    expect(host.getSession(record.id).id).toBe(record.id);
    expect(host.listExtensionUIPrompts(record.id)).toEqual([]);
    host.dispose();
  });
  it('rejects bare /goal and missing live goal without promptAsync', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-goal-cmd-'));
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

      await expect(host.runCommand(record.id, { command: 'goal', arguments: '' }))
        .rejects.toMatchObject({ status: 400 });
      expect(promptAsyncCalls).toBe(0);
      expect(host.getMessages(record.id)).toEqual([]);

      await expect(host.runCommand(record.id, { command: 'goal', arguments: 'implement snake game' }))
        .rejects.toMatchObject({
          status: 404,
          message: 'Command /goal is not available on this session',
        });
      expect(promptAsyncCalls).toBe(0);
      expect(host.getMessages(record.id)).toEqual([]);

      const prompted = [];
      const originalPrompt = record.piSession.prompt.bind(record.piSession);
      record.piSession.prompt = async (text, options) => {
        prompted.push(text);
        return originalPrompt(text, options);
      };
      record.piSession.registerCommand('goal', async () => {}, { description: 'Set a goal' });
      await host.runCommand(record.id, { command: 'goal', arguments: 'implement snake game' });
      expect(prompted).toEqual(['/goal implement snake game']);
      expect(promptAsyncCalls).toBe(0);
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
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
      template: 'old',
    });
    expect(merged.some((command) => command.name === 'goal' && command.source === 'extension')).toBe(true);
    expect(merged.some((command) => command.name === 'reload')).toBe(false);
    expect(merged.some((command) => command.name === 'skill:review')).toBe(false);
  });
});

describe('session thinking levels', () => {
  it('promptAsync applies body.variant as session thinking', async () => {
    const host = createPiHost({ mock: true, defaultDirectory: '/tmp/project' });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Think pin' });
    record.piSession.getAvailableThinkingLevels = () => ['low', 'medium', 'high'];
    record.piSession.thinkingLevel = 'medium';

    await host.promptAsync(record.id, {
      variant: 'high',
      parts: [{ type: 'text', text: 'go' }],
    });

    expect(record.piSession.thinkingLevel).toBe('high');
    host.dispose();
  });

  it('reads live getAvailableThinkingLevels and clamps an unsupported pick', async () => {
    const host = createPiHost({ mock: true, defaultDirectory: '/tmp/project' });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Think' });
    record.piSession.getAvailableThinkingLevels = () => ['low', 'medium', 'high'];
    record.piSession.thinkingLevel = 'medium';

    expect(host.getSessionThinking(record.id)).toEqual({
      thinking: 'medium',
      available: ['low', 'medium', 'high'],
    });

    const applied = await host.setSessionThinking(record.id, 'max');
    expect(applied).toEqual({
      applied: true,
      thinking: 'medium',
      available: ['low', 'medium', 'high'],
    });
    expect(record.piSession.thinkingLevel).toBe('medium');
    host.dispose();
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

  it('treats /plan start as notify-only and queues a select for bare /plan', async () => {
    const events = [];
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      onEvent(_directory, event) {
        events.push(event);
      },
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Plan menus' });

    const started = await host.runCommand(record.id, { command: 'plan', arguments: 'start' });
    expect(started.info.role).toBe('assistant');
    expect(host.listExtensionUIPrompts(record.id)).toEqual([]);
    expect(await host.getSessionPlan(record.id)).toEqual({ status: 'active', planMarkdown: '' });
    expect(events.some((event) => event.type === 'pi.ui.notify')).toBe(true);
    expect(events.some((event) => event.type === 'pi.ui.asked')).toBe(false);

    record.piSession.setPlanModeState({ enabled: false, awaitingAction: false });

    const launch = host.runCommand(record.id, { command: 'plan', arguments: '' });
    const launchPrompts = await waitForExtensionPrompts(host, record.id);
    expect(launchPrompts).toHaveLength(1);
    expect(launchPrompts[0]).toMatchObject({
      kind: 'select',
      title: 'Plan mode\nStatus: Off…',
      options: [
        'Start Plan mode',
        'Choose tools, then start…',
        'Settings',
        'How Plan mode works',
      ],
    });
    expect(host.replyExtensionUI(record.id, launchPrompts[0].id, 'Start Plan mode')).toBe(true);
    await launch;
    expect(host.listExtensionUIPrompts(record.id)).toEqual([]);

    const tools = host.runCommand(record.id, { command: 'plan', arguments: 'tools' });
    const toolPrompts = await waitForExtensionPrompts(host, record.id);
    expect(toolPrompts[0]).toMatchObject({
      kind: 'select',
      title: 'Plan-mode tools',
      multiple: true,
    });
    expect(toolPrompts[0].options).toEqual(expect.arrayContaining([
      'bash',
      'find',
      'grep',
      'ls',
      'read',
      'Done — start Plan mode',
      'Back',
    ]));
    expect(host.replyExtensionUI(record.id, toolPrompts[0].id, ['bash', 'read'])).toBe(true);
    await tools;

    expect(await host.runPlanAction(record.id, { action: 'start' })).toEqual({
      status: 'active',
      planMarkdown: '',
    });
    expect(host.listExtensionUIPrompts(record.id)).toEqual([]);
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

