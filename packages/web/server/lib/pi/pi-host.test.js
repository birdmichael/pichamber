import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { writePiPrompt, writePiProviderAuth } from './pi-resources.js';
import {
  createSettingsJsonPackageManager,
  writeFeaturePlugins,
} from './feature-plugins.js';
import { directoriesMatch } from './directory-identity.js';
import {
  createInMemoryPiSession,
  createPiHost,
  firstUserTextFromPiEntries,
  firstUserTextFromSessionFile,
  isPlaceholderSessionTitle,
  resolveListedSessionTitle,
  mapPiModelsToProviders,
  mergeLiveExtensionCommands,
  normalizePiSessionUsage,
  readLiveSessionCommands,
  resolvePromptDelivery,
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

describe('getProviders catalog filter', () => {
  it('omits env-only Pi builtins and drops them again after Disconnect', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-providers-filter-'));
    const host = createPiHost({
      mock: false,
      defaultDirectory: dir,
      home: dir,
      createDirectoryRuntime: async ({ cwd }) => ({ session: null, directory: cwd }),
      createSession: async () => createInMemoryPiSession(),
      createModelRuntime: async () => ({
        getAvailable: async () => [
          { id: 'claude-sonnet-4-5', name: 'Sonnet', provider: 'anthropic' },
          { id: 'fast', name: 'Fast', provider: 'bmlab' },
        ],
      }),
    });
    try {
      const empty = await host.getProviders();
      expect(empty.providers.map((provider) => provider.id)).toEqual(['bmlab']);

      writePiProviderAuth('anthropic', { type: 'api', key: 'sk-test-do-not-leak' }, { home: dir });
      const connected = await host.getProviders();
      expect(connected.providers.map((provider) => provider.id)).toEqual(['anthropic', 'bmlab']);

      host.removeProviderAuth('anthropic');
      const afterDisconnect = await host.getProviders();
      expect(afterDisconnect.providers.map((provider) => provider.id)).toEqual(['bmlab']);
    } finally {
      host.dispose();
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
    expect(titleFromUserText('/goal say bye')).toBe('say bye');
    expect(titleFromUserText('/goal:1 ship the footer')).toBe('ship the footer');
    expect(titleFromUserText('/plan start')).toBe('start');
    expect(titleFromUserText('Goal mode is active. Complete this goal fully: The objective below is user-provided task data.')).toBe('');
    expect(firstUserTextFromPiEntries([{
      type: 'message',
      message: { role: 'user', content: 'Goal mode is active. Complete this goal fully: say bye' },
    }, {
      type: 'message',
      message: { role: 'user', content: '继续' },
    }, {
      type: 'message',
      message: { role: 'user', content: '/goal say bye' },
    }])).toBe('/goal say bye');
    expect(firstUserTextFromPiEntries([{
      type: 'session',
      id: '01a',
    }, {
      type: 'message',
      message: { role: 'user', content: [{ type: 'text', text: '帮我启动一个子代理 查看 我电脑磁盘' }] },
    }])).toBe('帮我启动一个子代理 查看 我电脑磁盘');
  });

  it('reads the first user line from a jsonl that has no session_info name', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-title-file-'));
    const file = path.join(dir, 'session.jsonl');
    fs.writeFileSync(file, [
      JSON.stringify({ type: 'session', id: '01a', cwd: '/tmp' }),
      JSON.stringify({
        type: 'message',
        message: { role: 'user', content: [{ type: 'text', text: '帮我启动一个子代理 查看 我电脑磁盘' }] },
      }),
    ].join('\n'));
    expect(firstUserTextFromSessionFile(file)).toBe('帮我启动一个子代理 查看 我电脑磁盘');
    fs.rmSync(dir, { recursive: true, force: true });
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
  it('returns a persisted shell session without waiting for live AgentSession bind', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-shell-session-'));
    let liveBound = false;
    const host = createPiHost({
      mock: false,
      defaultDirectory: dir,
      home: dir,
      createDirectoryRuntime: async ({ cwd }) => ({ session: null, directory: cwd }),
      createSession: async () => {
        liveBound = true;
        return createInMemoryPiSession();
      },
    });
    const record = await host.createSession({ directory: dir, title: 'Shell' });
    expect(record.info.title).toBe('Shell');
    expect(record.id).toBeTruthy();
    expect(host.getMessages(record.id)).toEqual([]);
    expect(host.listSessions(dir)).toHaveLength(1);
    await host.promptAsync(record.id, { parts: [{ type: 'text', text: 'hi' }] });
    expect(liveBound).toBe(true);
    host.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const testSessionManager = (dir) => ({
    getSessionId: () => `ses_shell_${path.basename(dir)}`,
    getSessionFile: () => path.join(dir, 'session.jsonl'),
    getEntries: () => [],
  });

  it('does not keep a user message when live bind fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-shell-bind-fail-'));
    const host = createPiHost({
      mock: false,
      defaultDirectory: dir,
      home: dir,
      createDirectoryRuntime: async ({ cwd }) => ({ session: null, directory: cwd }),
      createSessionManager: () => testSessionManager(dir),
      createSession: async () => {
        throw new Error('bind failed');
      },
    });
    const record = await host.createSession({ directory: dir, title: 'Shell' });
    await expect(host.promptAsync(record.id, { parts: [{ type: 'text', text: 'hi' }] })).rejects.toThrow('bind failed');
    expect(host.getMessages(record.id)).toEqual([]);
    host.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reuses an in-flight live bind when reload runs during shell bind', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-shell-reload-'));
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let factoryCalls = 0;
    const host = createPiHost({
      mock: false,
      defaultDirectory: dir,
      home: dir,
      createDirectoryRuntime: async ({ cwd }) => ({ session: null, directory: cwd }),
      createSessionManager: () => testSessionManager(dir),
      createSession: async () => {
        factoryCalls += 1;
        await gate;
        const session = createInMemoryPiSession();
        session.reload = async () => {};
        return session;
      },
    });
    const record = await host.createSession({ directory: dir, title: 'Shell' });
    for (let i = 0; i < 50 && factoryCalls === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(factoryCalls).toBe(1);
    const reloading = host.reload({ sessionID: record.id });
    expect(factoryCalls).toBe(1);
    release();
    await reloading;
    expect(factoryCalls).toBe(1);
    host.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('does not attach a live session after the shell record is deleted', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-shell-delete-'));
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const host = createPiHost({
      mock: false,
      defaultDirectory: dir,
      home: dir,
      createDirectoryRuntime: async ({ cwd }) => ({ session: null, directory: cwd }),
      createSessionManager: () => testSessionManager(dir),
      createSession: async () => {
        await gate;
        return createInMemoryPiSession();
      },
    });
    const record = await host.createSession({ directory: dir, title: 'Shell' });
    const deleting = host.deleteSession(record.id);
    release();
    await deleting;
    expect(() => host.getSession(record.id)).toThrow(/not found/i);
    host.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('applies setSessionModel after a delayed shell bind', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-shell-model-'));
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const host = createPiHost({
      mock: false,
      defaultDirectory: dir,
      home: dir,
      createDirectoryRuntime: async ({ cwd }) => ({ session: null, directory: cwd }),
      createSessionManager: () => testSessionManager(dir),
      createModelRuntime: async () => ({
        getAvailable: async () => [{ id: 'claude-sonnet-4-5', provider: 'anthropic' }],
      }),
      createSession: async () => {
        await gate;
        return createInMemoryPiSession();
      },
    });
    const record = await host.createSession({ directory: dir, title: 'Shell' });
    const applying = host.setSessionModel(record.id, 'anthropic/claude-sonnet-4-5');
    release();
    const result = await applying;
    expect(result.applied).toBe(true);
    expect(host.getSession(record.id).piSession.currentModel).toEqual({
      id: 'claude-sonnet-4-5',
      provider: 'anthropic',
    });
    host.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('does not emit a user message when live bind fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-shell-bind-events-'));
    const events = [];
    const host = createPiHost({
      mock: false,
      defaultDirectory: dir,
      home: dir,
      createDirectoryRuntime: async ({ cwd }) => ({ session: null, directory: cwd }),
      createSessionManager: () => testSessionManager(dir),
      createSession: async () => {
        throw new Error('bind failed');
      },
      onEvent: (_directory, event) => events.push(event),
    });
    const record = await host.createSession({ directory: dir, title: 'Shell' });
    await expect(host.promptAsync(record.id, { parts: [{ type: 'text', text: 'hi' }] })).rejects.toThrow('bind failed');
    expect(events.some((event) => event.type === 'message.updated')).toBe(false);
    host.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });

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

  it('updatePiPackages reloads idle sessions outside the default directory', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-pkg-update-dirs-'));
    const host = createPiHost({
      mock: true,
      home,
      defaultDirectory: '/tmp/project',
    });
    await createSettingsJsonPackageManager({ home }).installAndPersist('npm:pi-question-tool');
    const defaultSession = await host.createSession({ directory: '/tmp/project' });
    const otherSession = await host.createSession({ directory: '/tmp/other-box' });
    const result = await host.updatePiPackages({ source: 'npm:pi-question-tool' });
    expect(result.reload.reloaded).toEqual(expect.arrayContaining([
      defaultSession.id,
      otherSession.id,
    ]));
    expect(defaultSession.piSession.reloadCount).toBe(1);
    expect(otherSession.piSession.reloadCount).toBe(1);
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

  it('lists /goal from the Goal slot before any session exists', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-goal-slot-cmd-'));
    try {
      await createSettingsJsonPackageManager({ home }).installAndPersist('npm:@narumitw/pi-goal');
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/empty-project',
      });
      expect(host.listCommands('/tmp/empty-project').some((command) => (
        command.name === 'goal' && command.source === 'extension'
      ))).toBe(true);
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

  it('installs a feature plugin when the package manager only exposes install', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-xai-install-'));
    const installed = [];
    try {
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/project',
        createPackageManager: async () => ({
          install: async (source) => {
            installed.push(source);
          },
        }),
      });
      const result = await host.installFeaturePlugin('xai', {});
      expect(installed).toEqual(['npm:pi-xai']);
      expect(result.slots.xai.source).toBe('npm:pi-xai');
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
    expect(host.getSessionUsage(record.id)).toEqual({ available: false });
    await expect.poll(() => host.getSessionUsage(record.id)).toEqual({
      available: true,
      tokens: 2560,
      contextLimit: 128000,
      contextWindow: 128000,
      percent: 2,
    });
    host.dispose();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('reload({ sessionID }) 409s while first-send bind is in flight', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-first-send-reload-'));
    let releaseBind;
    const bindGate = new Promise((resolve) => {
      releaseBind = resolve;
    });
    let enteredBind;
    const bindEntered = new Promise((resolve) => {
      enteredBind = resolve;
    });
    const host = createPiHost({
      home,
      defaultDirectory: '/tmp/project',
      createModelRuntime: async () => ({ getAvailable: async () => [] }),
      createDirectoryRuntime: async ({ cwd }) => ({ session: null, directory: cwd }),
      createSession: async () => {
        enteredBind();
        await bindGate;
        return {
          isStreaming: false,
          subscribe() { return () => {}; },
          async prompt() {},
        };
      },
    });
    const record = await host.createSession({ directory: '/tmp/project' });
    await bindEntered;
    const prompt = host.promptAsync(record.id, { parts: [{ type: 'text', text: 'stream' }] });
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline && host.getStatus()[record.id]?.type !== 'busy') {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(host.getStatus()[record.id]).toEqual({ type: 'busy' });
    await expect(host.reload({ sessionID: record.id })).rejects.toMatchObject({
      status: 409,
      message: 'Wait for the current response to finish before reloading.',
    });
    releaseBind();
    await prompt;
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

  it('promptAsync keeps synthetic instructions for Pi but not the user bubble or title', async () => {
    const host = createPiHost({ mock: true, defaultDirectory: '/tmp/project' });
    const record = await host.createSession({ directory: '/tmp/project' });
    let forwarded;
    const originalPrompt = record.piSession.prompt.bind(record.piSession);
    record.piSession.prompt = async (text, options) => {
      forwarded = { text, options };
      return originalPrompt(text, options);
    };

    const visible = 'Help me set up a scheduled task.';
    const instructions = 'The user wants to set up a scheduled task: a saved prompt that Pichamber runs automatically.';
    await host.promptAsync(record.id, {
      parts: [
        { type: 'text', text: visible },
        { type: 'text', text: instructions, synthetic: true },
      ],
    });

    const user = host.getMessages(record.id).find((entry) => entry.info.role === 'user');
    expect(user.parts[0].text).toBe(visible);
    expect(user.parts[0].text).not.toContain('Pichamber runs automatically');
    expect(host.getSession(record.id).info.title).toBe(visible);
    expect(forwarded.text).toContain(visible);
    expect(forwarded.text).toContain(instructions);
    host.dispose();
  });

  it('promptAsync keeps structured context parts on the user bubble', async () => {
    const host = createPiHost({ mock: true, defaultDirectory: '/tmp/project' });
    const record = await host.createSession({ directory: '/tmp/project' });
    let forwarded;
    const originalPrompt = record.piSession.prompt.bind(record.piSession);
    record.piSession.prompt = async (text, options) => {
      forwarded = { text, options };
      return originalPrompt(text, options);
    };

    const contextText = 'Comment on `src/app.ts` lines 3-5:\n```ts\nconst x = 1;\n```\n\nfix this';
    await host.promptAsync(record.id, {
      parts: [
        { type: 'text', text: 'please fix' },
        {
          type: 'text',
          text: contextText,
          synthetic: true,
          metadata: {
            pichamberContext: {
              kind: 'code-comment',
              source: 'file',
              fileLabel: 'src/app.ts',
              startLine: 3,
              endLine: 5,
              language: 'ts',
              code: 'const x = 1;',
              text: 'fix this',
            },
          },
        },
      ],
    });

    const user = host.getMessages(record.id).find((entry) => entry.info.role === 'user');
    expect(user.parts.map((part) => part.type)).toEqual(['text', 'text']);
    expect(user.parts[0].text).toBe('please fix');
    expect(user.parts[1]).toMatchObject({
      type: 'text',
      synthetic: true,
      text: contextText,
      metadata: {
        pichamberContext: {
          kind: 'code-comment',
          fileLabel: 'src/app.ts',
        },
      },
    });
    expect(host.getSession(record.id).info.title).toBe('please fix');
    expect(forwarded.text).toContain('please fix');
    expect(forwarded.text).toContain(contextText);
    const persisted = host.getSession(record.id).info.metadata?.pichamber?.userContext;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      messageID: user.info.id,
      authoredText: 'please fix',
    });
    const entries = record.piSession.sessionManager.getEntries();
    expect(entries.some((entry) => (
      entry?.customType === 'pichamber.metadata'
      && entry?.data?.pichamber?.userContext?.[0]?.authoredText === 'please fix'
    ))).toBe(true);
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
      expect(record.piSession.reloadCount).toBe(0);

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

  it('starts /goal on a live session after refreshing a stale command snapshot', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-goal-refresh-'));
    try {
      await createSettingsJsonPackageManager({ home }).installAndPersist('npm:@narumitw/pi-goal');
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/project',
      });
      const record = await host.createSession({ directory: '/tmp/project' });
      record.piSession.registerCommand('goal', async () => {}, { description: 'Set a goal' });
      const originalGetCommands = record.piSession.getCommands.bind(record.piSession);
      let hidden = true;
      record.piSession.getCommands = () => (hidden ? [] : originalGetCommands());
      record.piSession.refreshSnapshot = async () => {
        hidden = false;
        return originalGetCommands();
      };
      const prompted = [];
      const originalPrompt = record.piSession.prompt.bind(record.piSession);
      record.piSession.prompt = async (text, options) => {
        prompted.push(text);
        return originalPrompt(text, options);
      };
      let promptAsyncCalls = 0;
      const originalPromptAsync = host.promptAsync.bind(host);
      host.promptAsync = async (...args) => {
        promptAsyncCalls += 1;
        return originalPromptAsync(...args);
      };

      await host.runCommand(record.id, { command: 'goal', arguments: 'implement snake game' });
      expect(prompted).toEqual(['/goal implement snake game']);
      expect(promptAsyncCalls).toBe(0);
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('reloads once to attach /goal when refresh still sees no live command', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-goal-reload-'));
    try {
      await createSettingsJsonPackageManager({ home }).installAndPersist('npm:@narumitw/pi-goal');
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/project',
      });
      const record = await host.createSession({ directory: '/tmp/project' });
      const originalGetCommands = record.piSession.getCommands.bind(record.piSession);
      let attached = false;
      record.piSession.getCommands = () => (attached ? originalGetCommands() : []);
      record.piSession.refreshSnapshot = async () => [];
      const originalReload = record.piSession.reload.bind(record.piSession);
      record.piSession.reload = async () => {
        record.piSession.registerCommand('goal', async () => {}, { description: 'Set a goal' });
        attached = true;
        return originalReload();
      };
      const prompted = [];
      const originalPrompt = record.piSession.prompt.bind(record.piSession);
      record.piSession.prompt = async (text, options) => {
        prompted.push(text);
        return originalPrompt(text, options);
      };

      await host.runCommand(record.id, { command: 'goal', arguments: 'ship the footer' });
      expect(prompted).toEqual(['/goal ship the footer']);
      expect(record.piSession.reloadCount).toBe(1);
      record.piSession.getCommands = () => [];
      await expect(host.runCommand(record.id, { command: 'goal', arguments: 'again' }))
        .rejects.toMatchObject({ status: 404 });
      expect(record.piSession.reloadCount).toBe(1);
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('clears the plugin-command reload memo on session reload', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-goal-reload-memo-'));
    try {
      await createSettingsJsonPackageManager({ home }).installAndPersist('npm:@narumitw/pi-goal');
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/project',
      });
      const record = await host.createSession({ directory: '/tmp/project' });
      record.piSession.getCommands = () => [];
      record.piSession.refreshSnapshot = async () => [];
      const originalReload = record.piSession.reload.bind(record.piSession);
      record.piSession.reload = async () => originalReload();

      await expect(host.runCommand(record.id, { command: 'goal', arguments: 'first' }))
        .rejects.toMatchObject({ status: 404 });
      expect(record.piSession.reloadCount).toBe(1);
      await expect(host.runCommand(record.id, { command: 'goal', arguments: 'memo' }))
        .rejects.toMatchObject({ status: 404 });
      expect(record.piSession.reloadCount).toBe(1);

      await host.reload({ sessionID: record.id });
      expect(record.piSession.reloadCount).toBe(2);
      record.piSession.getCommands = () => [];
      record.piSession.refreshSnapshot = async () => [];
      await expect(host.runCommand(record.id, { command: 'goal', arguments: 'after reload' }))
        .rejects.toMatchObject({ status: 404 });
      expect(record.piSession.reloadCount).toBe(3);
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('dispatches /goal from extensionRunner when getCommands is missing', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-goal-runner-'));
    try {
      await createSettingsJsonPackageManager({ home }).installAndPersist('npm:@narumitw/pi-goal');
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/project',
      });
      const record = await host.createSession({ directory: '/tmp/project' });
      delete record.piSession.getCommands;
      record.piSession.extensionRunner = {
        getRegisteredCommands: () => [{ name: 'goal', invocationName: 'goal:1', description: 'Set a goal' }],
      };
      const prompted = [];
      const originalPrompt = record.piSession.prompt.bind(record.piSession);
      record.piSession.prompt = async (text, options) => {
        prompted.push(text);
        return originalPrompt(text, options);
      };
      await host.runCommand(record.id, { command: 'goal', arguments: 'from runner' });
      expect(prompted).toEqual(['/goal:1 from runner']);
      expect(record.piSession.reloadCount).toBe(0);
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('dispatches /goal when getCommands() only has invocationName', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-goal-inv-'));
    try {
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/project',
      });
      const record = await host.createSession({ directory: '/tmp/project' });
      record.piSession.getCommands = () => [{
        invocationName: 'goal',
        source: 'extension',
        description: 'Set a goal',
      }];
      const prompted = [];
      const originalPrompt = record.piSession.prompt.bind(record.piSession);
      record.piSession.prompt = async (text, options) => {
        prompted.push(text);
        return originalPrompt(text, options);
      };
      await host.runCommand(record.id, { command: 'goal', arguments: 'named' });
      expect(prompted).toEqual(['/goal named']);
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('dispatches /goal when the live list overlays a prompt source', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-goal-overlay-'));
    try {
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/project',
      });
      const record = await host.createSession({ directory: '/tmp/project' });
      record.piSession.getCommands = () => [{ name: 'goal', source: 'prompt', description: 'Goal' }];
      const prompted = [];
      const originalPrompt = record.piSession.prompt.bind(record.piSession);
      record.piSession.prompt = async (text, options) => {
        prompted.push(text);
        return originalPrompt(text, options);
      };
      await host.runCommand(record.id, { command: 'goal', arguments: 'keep going' });
      expect(prompted).toEqual(['/goal keep going']);
      expect(record.messages.some((entry) => (
        entry?.info?.role === 'user'
        && entry.parts?.some((part) => part?.text === '/goal keep going')
      ))).toBe(true);
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('starts /goal on a session that already replied without creating another chat', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-goal-existing-'));
    try {
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/project',
      });
      const record = await host.createSession({ directory: '/tmp/project' });
      record.piSession.registerCommand('goal', async () => {}, { description: 'Set a goal' });
      record.info.title = 'ok';
      record.messages.push(
        {
          info: { id: 'msg_ok', sessionID: record.id, role: 'user', time: { created: Date.now() } },
          parts: [{ id: 'prt_ok', sessionID: record.id, messageID: 'msg_ok', type: 'text', text: 'ok' }],
        },
        {
          info: { id: 'msg_reply', sessionID: record.id, role: 'assistant', time: { created: Date.now() } },
          parts: [{ id: 'prt_reply', sessionID: record.id, messageID: 'msg_reply', type: 'text', text: 'ok' }],
        },
      );
      const beforeIds = host.listSessions().map((item) => item.id);

      const originalPrompt = record.piSession.prompt.bind(record.piSession);
      record.piSession.prompt = async (text) => {
        record.messages.push({
          info: {
            id: 'msg_early',
            sessionID: record.id,
            role: 'assistant',
            time: { created: 1 },
          },
          parts: [{ id: 'prt_early', sessionID: record.id, messageID: 'msg_early', type: 'text', text: 'hi' }],
        });
        return originalPrompt(text);
      };

      await host.runCommand(record.id, { command: 'goal', arguments: 'say bye' });

      expect(host.listSessions().map((item) => item.id)).toEqual(beforeIds);
      const messages = host.getMessages(record.id);
      const texts = messages.flatMap((entry) => (
        (entry.parts || []).map((part) => part?.text).filter(Boolean)
      ));
      expect(texts).toContain('ok');
      expect(texts).toContain('/goal say bye');
      expect(texts.indexOf('/goal say bye')).toBeLessThan(texts.indexOf('hi'));
      const goal = messages.find((entry) => (
        (entry.parts || []).some((part) => part?.text === '/goal say bye')
      ));
      const hi = messages.find((entry) => entry.info.id === 'msg_early');
      expect(hi.info.time.created).toBeGreaterThan(goal.info.time.created);
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('binds empty-draft /goal before prompt and persists the target mark after', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-goal-empty-'));
    try {
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/project',
      });
      const record = await host.createSession({ directory: '/tmp/project' });
      record.piSession.registerCommand('goal', async () => {}, { description: 'Set a goal' });
      record.sessionManager = record.piSession.sessionManager;
      const order = [];
      const originalAppend = record.sessionManager.appendCustomEntry.bind(record.sessionManager);
      record.sessionManager.appendCustomEntry = (type, data) => {
        order.push(`custom:${type}`);
        return originalAppend(type, data);
      };
      const originalPrompt = record.piSession.prompt.bind(record.piSession);
      record.piSession.prompt = async (text) => {
        order.push('prompt');
        expect(record.translator.userMessageID).toBeTruthy();
        expect(record.messages.some((entry) => entry?.info?.id === record.translator.userMessageID)).toBe(true);
        expect(order.filter((item) => item.startsWith('custom:'))).toEqual([]);
        return originalPrompt(text);
      };

      await host.runCommand(record.id, { command: 'goal', arguments: 'name one file' });

      expect(order[0]).toBe('prompt');
      expect(order).toContain('custom:pichamber.metadata');
      expect(record.info.metadata?.pichamber?.piGoal).toEqual({ active: false });
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('clears the Goal target mark when goal-state is no longer in-flight', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-goal-mark-'));
    try {
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/project',
      });
      const record = await host.createSession({ directory: '/tmp/project' });
      record.sessionManager = record.piSession.sessionManager;
      record.info.metadata = { pichamber: { piGoal: { active: true } } };
      record.sessionManager.appendCustomEntry('goal-state', { goal: { status: 'active' } });
      record.status = { type: 'busy' };
      await host.abort(record.id);
      expect(record.info.metadata?.pichamber?.piGoal).toEqual({ active: true });

      record.sessionManager.appendCustomEntry('goal-state', { goal: { status: 'complete' } });
      record.status = { type: 'busy' };
      await host.abort(record.id);
      expect(record.info.metadata?.pichamber?.piGoal).toEqual({ active: false });
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('clears a leftover live Goal mark on list when goal-state is not in-flight', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-goal-list-'));
    try {
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/project',
      });
      const record = await host.createSession({ directory: '/tmp/project' });
      record.sessionManager = record.piSession.sessionManager;
      record.info.metadata = { pichamber: { piGoal: { active: true } } };

      const listed = await host.listSessionInfos('/tmp/project');
      expect(listed.find((info) => info.id === record.id)?.metadata?.pichamber?.piGoal)
        .toEqual({ active: false });
      expect(record.info.metadata?.pichamber?.piGoal).toEqual({ active: false });
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('returns 409 when /goal needs a reload while the session is busy', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-goal-busy-'));
    try {
      await createSettingsJsonPackageManager({ home }).installAndPersist('npm:@narumitw/pi-goal');
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/project',
      });
      const record = await host.createSession({ directory: '/tmp/project' });
      record.piSession.getCommands = () => [];
      record.piSession.refreshSnapshot = async () => [];
      record.status = { type: 'busy' };
      await expect(host.runCommand(record.id, { command: 'goal', arguments: 'wait' }))
        .rejects.toMatchObject({ status: 409 });
      expect(record.piSession.reloadCount).toBe(0);
      host.dispose();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('does not promptAsync /plan when the Plan slot is on and the live command is missing', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-plan-missing-'));
    try {
      await createSettingsJsonPackageManager({ home }).installAndPersist('npm:@narumitw/pi-plan-mode');
      writePiPrompt({
        home,
        name: 'plan',
        template: 'Do not send this as chat: $ARGUMENTS',
      });
      const host = createPiHost({
        mock: true,
        home,
        defaultDirectory: '/tmp/project',
      });
      const record = await host.createSession({ directory: '/tmp/project' });
      record.piSession.getCommands = () => [];
      record.piSession.refreshSnapshot = async () => [];
      let promptAsyncCalls = 0;
      const originalPromptAsync = host.promptAsync.bind(host);
      host.promptAsync = async (...args) => {
        promptAsyncCalls += 1;
        return originalPromptAsync(...args);
      };
      const reloadCountBefore = record.piSession.reloadCount;
      await expect(host.runPlanAction(record.id, { action: 'start' }))
        .rejects.toMatchObject({ status: 404 });
      expect(promptAsyncCalls).toBe(0);
      expect(record.piSession.reloadCount).toBe(reloadCountBefore + 1);
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
      getCommands: () => [{ invocationName: 'goal', source: 'extension', description: 'Set a goal' }],
    })).toEqual([{ invocationName: 'goal', source: 'extension', description: 'Set a goal' }]);
    expect(readLiveSessionCommands({
      extensionRunner: {
        getRegisteredCommands: () => [{ invocationName: 'goal', description: 'Set a goal' }],
      },
    })).toEqual([{ name: 'goal', description: 'Set a goal', source: 'extension' }]);
    expect(readLiveSessionCommands({
      getCommands: () => [],
      extensionRunner: {
        getRegisteredCommands: () => [{ name: 'goal', invocationName: 'goal:1', description: 'Set a goal' }],
      },
    })).toEqual([{ name: 'goal', invocationName: 'goal:1', description: 'Set a goal', source: 'extension' }]);
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

    expect(await host.getSessionThinking(record.id)).toEqual({
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

  it('widens child thinking levels from the jsonl model catalog when live only lists off', async () => {
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      createModelRuntime: async () => ({
        getAvailable: async () => [{
          id: 'gpt-5.6-terra',
          provider: 'bmlab',
          thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
        }],
      }),
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Child think' });
    record.sessionManager = record.piSession.sessionManager;
    record.sessionManager.appendEntry({ type: 'model_change', provider: 'bmlab', modelId: 'gpt-5.6-terra' });
    record.sessionManager.appendEntry({ type: 'thinking_level_change', thinkingLevel: 'off' });
    record.piSession.getAvailableThinkingLevels = () => ['off'];

    expect(await host.getSessionThinking(record.id)).toEqual({
      thinking: 'off',
      available: ['low', 'medium', 'high', 'xhigh', 'max'],
    });

    const applied = await host.setSessionThinking(record.id, 'high');
    expect(applied).toEqual({
      applied: true,
      thinking: 'high',
      available: ['low', 'medium', 'high', 'xhigh', 'max'],
    });
    host.dispose();
  });

  it('reads model and thinking from jsonl entries when currentModel is missing', async () => {
    const host = createPiHost({ mock: true, defaultDirectory: '/tmp/project' });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Child runtime' });
    record.sessionManager = record.piSession.sessionManager;
    record.sessionManager.appendEntry({ type: 'model_change', provider: 'cc', modelId: 'claude-opus-5' });
    record.sessionManager.appendEntry({ type: 'thinking_level_change', thinkingLevel: 'high' });
    record.piSession.currentModel = null;
    record.piSession.thinkingLevel = undefined;

    expect(await host.getSessionModel(record.id)).toEqual({
      model: 'cc/claude-opus-5',
      providerID: 'cc',
      modelID: 'claude-opus-5',
    });
    expect(await host.getSessionThinking(record.id)).toMatchObject({ thinking: 'high' });
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

    const stubHost = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
    });
    const stub = await stubHost.createSession({ directory: '/tmp/project', title: 'Plan stub' });
    stub.piSession.prompt = async () => {};
    stub.piSession.getPlanModeState = () => null;
    await expect(stubHost.runPlanAction(stub.id, { action: 'start' })).rejects.toMatchObject({
      status: 500,
    });
    expect(await stubHost.getSessionPlan(stub.id)).toEqual({ status: 'off', planMarkdown: '' });
    stubHost.dispose();

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

  it('answers a pending plan-ready select instead of prompting /plan implement', async () => {
    const host = createPiHost({ mock: true, defaultDirectory: '/tmp/project' });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Plan ready card' });
    record.piSession.setPlanModeState({
      enabled: true,
      latestPlan: '# Ready plan\n\nDo the work.',
      awaitingAction: true,
    });
    const prompted = [];
    record.piSession.prompt = async (text) => {
      prompted.push(text);
    };
    const replies = [];
    record.extensionUI = {
      list: () => [{
        id: 'pui_ready',
        kind: 'select',
        status: 'pending',
        title: 'Proposed plan ready. What next?',
        options: ['Implement here', 'Start fresh and implement', 'Save for later'],
      }],
      reply: (id, value) => {
        replies.push([id, value]);
        return true;
      },
    };

    const plan = await host.runPlanAction(record.id, { action: 'implement' });
    expect(replies).toEqual([['pui_ready', 'Implement here']]);
    expect(prompted).toEqual([]);
    expect(plan.status).toBe('ready');
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

  it('reads plan from jsonl entries when getPlanModeState is empty', async () => {
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Plan entries' });
    let setPlanModeStateCalls = 0;
    record.piSession.getPlanModeState = () => null;
    record.piSession.setPlanModeState = () => {
      setPlanModeStateCalls += 1;
      throw new Error('must not IPC setPlanModeState');
    };
    record.piSession.sessionManager.appendCustomEntry('plan-mode-state', {
      enabled: true,
      awaitingAction: false,
    });
    expect(await host.getSessionPlan(record.id)).toEqual({ status: 'active', planMarkdown: '' });

    record.piSession.sessionManager.appendCustomEntry('plan-mode-state', {
      enabled: false,
      savedPlan: { plan: '# Saved from disk\n\nKeep this.', source: 'plan_mode_complete' },
    });
    const resumed = await host.runPlanAction(record.id, { action: 'resume' });
    expect(resumed).toMatchObject({
      status: 'ready',
      planMarkdown: '# Saved from disk\n\nKeep this.',
    });
    expect(setPlanModeStateCalls).toBe(0);
    host.dispose();
  });

  it('reads plan-mode-state from the session file when memory entries are empty', async () => {
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Stale entries' });
    const file = path.join(os.tmpdir(), `pichamber-plan-${record.id}.jsonl`);
    fs.writeFileSync(file, `${JSON.stringify({
      type: 'custom',
      customType: 'plan-mode-state',
      timestamp: '2026-08-28T16:00:00.000Z',
      data: { enabled: true, awaitingAction: false },
    })}\n`);
    record.sessionFile = file;
    record.piSession.getPlanModeState = () => null;
    record.piSession.sessionManager.getEntries = () => [];
    expect(await host.getSessionPlan(record.id)).toEqual({ status: 'active', planMarkdown: '' });
    expect(await host.runPlanAction(record.id, { action: 'start' })).toEqual({
      status: 'active',
      planMarkdown: '',
    });
    fs.unlinkSync(file);
    host.dispose();
  });

  it('returns 409 when Goal starts while Plan is on, or Plan starts while Goal is on', async () => {
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
    });
    const planHeld = await host.createSession({ directory: '/tmp/project', title: 'Plan holds' });
    await host.runPlanAction(planHeld.id, { action: 'start' });
    await expect(host.runCommand(planHeld.id, {
      command: 'goal',
      arguments: 'say hi',
    })).rejects.toMatchObject({
      status: 409,
      message: 'Plan mode is active. Exit Plan before starting a Goal.',
    });

    const goalHeld = await host.createSession({ directory: '/tmp/project', title: 'Goal holds' });
    goalHeld.piSession.sessionManager.appendCustomEntry('goal-state', {
      goal: { status: 'active', text: 'say hi' },
    });
    await expect(host.runPlanAction(goalHeld.id, { action: 'start' })).rejects.toMatchObject({
      status: 409,
      message: 'A Goal is active. Finish or stop it before starting Plan.',
    });
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

  it('refuses plan actions while the session is compacting', async () => {
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

  it('starts Plan on a live /plan session even when isStreaming is leftover', async () => {
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Stale stream' });
    record.piSession.getCommands = () => [
      { name: 'plan', source: 'extension', description: 'Plan' },
    ];
    Object.defineProperty(record.piSession, 'isStreaming', { get: () => true });
    record.status = { type: 'busy' };
    expect(await host.runPlanAction(record.id, { action: 'start' })).toEqual({
      status: 'active',
      planMarkdown: '',
    });
    host.dispose();
  });

  it('starts Plan on a leftover busy flag after shell bind', async () => {
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Leftover busy' });
    record.status = { type: 'busy' };
    const prompted = [];
    const originalPrompt = record.piSession.prompt.bind(record.piSession);
    record.piSession.prompt = async (text, options) => {
      prompted.push(text);
      return originalPrompt(text, options);
    };

    await expect(host.runPlanAction(record.id, { action: 'start' })).resolves.toEqual({
      status: 'active',
      planMarkdown: '',
    });
    expect(prompted).toEqual(['/plan start']);
    host.dispose();
  });

  it('keeps Plan active when leftover streaming throws from /plan start', async () => {
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Leftover stream' });
    record.piSession.prompt = async () => {
      throw new Error('Already streaming; use steer or followUp');
    };

    await expect(host.runPlanAction(record.id, { action: 'start' })).resolves.toEqual({
      status: 'active',
      planMarkdown: '',
    });
    host.dispose();
  });
});

describe('resolvePromptDelivery', () => {
  it('uses prompt for an idle send even with followUp delivery', () => {
    expect(resolvePromptDelivery({ delivery: 'followUp', isStreaming: false, statusType: 'idle' })).toBe('prompt');
    expect(resolvePromptDelivery({ delivery: 'steer', isStreaming: false })).toBe('prompt');
    expect(resolvePromptDelivery({})).toBe('prompt');
  });

  it('maps busy followUp/steer and defaults busy with no delivery to steer', () => {
    expect(resolvePromptDelivery({ delivery: 'followUp', isStreaming: true })).toBe('followUp');
    expect(resolvePromptDelivery({ delivery: 'follow_up', statusType: 'busy' })).toBe('followUp');
    expect(resolvePromptDelivery({ delivery: 'queue', statusType: 'retry' })).toBe('followUp');
    expect(resolvePromptDelivery({ delivery: 'steer', isStreaming: false, statusType: 'busy' })).toBe('steer');
    expect(resolvePromptDelivery({ isStreaming: false, statusType: 'busy' })).toBe('steer');
  });
});

describe('promptAsync busy delivery', () => {
  const wait = () => new Promise((resolve) => setTimeout(resolve, 40));

  it('idle first send still calls prompt, not steer', async () => {
    const host = createPiHost({ mock: true, defaultDirectory: '/tmp/project' });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Idle send' });
    const promptCalls = [];
    const steerCalls = [];
    const followUpCalls = [];
    const originalPrompt = record.piSession.prompt.bind(record.piSession);
    record.piSession.prompt = async (text, options) => {
      promptCalls.push(text);
      return originalPrompt(text, options);
    };
    record.piSession.steer = async (text) => { steerCalls.push(text); };
    record.piSession.followUp = async (text) => { followUpCalls.push(text); };
    await host.promptAsync(record.id, { parts: [{ type: 'text', text: 'hello' }] });
    await wait();
    expect(promptCalls).toEqual(['hello']);
    expect(steerCalls).toEqual([]);
    expect(followUpCalls).toEqual([]);
    host.dispose();
  });

  it('leftover status=busy without a live turn still inserts the user prompt', async () => {
    const host = createPiHost({ mock: true, defaultDirectory: '/tmp/project' });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Leftover busy' });
    record.status = { type: 'busy' };
    await host.promptAsync(record.id, { parts: [{ type: 'text', text: 'INSERT-OK' }] });
    expect(host.getMessages(record.id).some((entry) => (
      entry.parts?.some((part) => part.text === 'INSERT-OK')
    ))).toBe(true);
    host.dispose();
  });

  it('busy followUp calls session.followUp even when isStreaming is stale false', async () => {
    const host = createPiHost({ mock: true, defaultDirectory: '/tmp/project' });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Follow-up' });
    const promptCalls = [];
    const followUpCalls = [];
    const steerCalls = [];
    record.status = { type: 'busy' };
    record.turnActive = true;
    record.piSession.prompt = async (text) => {
      promptCalls.push(text);
      throw new Error('Already streaming; use steer or followUp');
    };
    record.piSession.followUp = async (text) => { followUpCalls.push(text); };
    record.piSession.steer = async (text) => { steerCalls.push(text); };
    await host.promptAsync(record.id, {
      delivery: 'followUp',
      parts: [{ type: 'text', text: 'FOLLOWUP-OK' }],
    });
    await wait();
    expect(followUpCalls).toEqual(['FOLLOWUP-OK']);
    expect(promptCalls).toEqual([]);
    expect(steerCalls).toEqual([]);
    host.dispose();
  });

  it('busy steer calls session.steer instead of prompt', async () => {
    const host = createPiHost({ mock: true, defaultDirectory: '/tmp/project' });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Steer' });
    const promptCalls = [];
    const followUpCalls = [];
    const steerCalls = [];
    record.status = { type: 'busy' };
    record.turnActive = true;
    record.piSession.prompt = async (text) => {
      promptCalls.push(text);
      throw new Error('Already streaming; use steer or followUp');
    };
    record.piSession.followUp = async (text) => { followUpCalls.push(text); };
    record.piSession.steer = async (text) => { steerCalls.push(text); };
    await host.promptAsync(record.id, {
      delivery: 'steer',
      parts: [{ type: 'text', text: 'STEER-OK' }],
    });
    await wait();
    expect(steerCalls).toEqual(['STEER-OK']);
    expect(promptCalls).toEqual([]);
    expect(followUpCalls).toEqual([]);
    expect(host.getMessages(record.id).some((entry) => (
      entry.parts?.some((part) => part.text === 'STEER-OK')
    ))).toBe(true);
    host.dispose();
  });

  it('busy send with no delivery does not call prompt when prompt would throw', async () => {
    const host = createPiHost({ mock: true, defaultDirectory: '/tmp/project' });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Default steer' });
    const promptCalls = [];
    const steerCalls = [];
    record.status = { type: 'busy' };
    record.turnActive = true;
    record.piSession.prompt = async (text) => {
      promptCalls.push(text);
      throw new Error('Already streaming; use steer or followUp');
    };
    record.piSession.steer = async (text) => { steerCalls.push(text); };
    await host.promptAsync(record.id, { parts: [{ type: 'text', text: 'course correct' }] });
    await wait();
    expect(steerCalls).toEqual(['course correct']);
    expect(promptCalls).toEqual([]);
    host.dispose();
  });
});

describe('promptAsync live follow-up (#369)', () => {
  const wait = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

  const createHangingSession = ({ onPrompt, onSteer, onFollowUp, onSetModel } = {}) => {
    let streaming = false;
    let release = () => {};
    const hang = new Promise((resolve) => {
      release = resolve;
    });
    const listeners = new Set();
    const emit = (event) => {
      for (const listener of Array.from(listeners)) listener(event);
    };
    const session = {
      get isStreaming() {
        return streaming;
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async prompt(text, options) {
        onPrompt?.(text, options);
        streaming = true;
        emit({ type: 'agent_start' });
        await hang;
        streaming = false;
        emit({ type: 'agent_settled' });
      },
      async steer(text, images) {
        onSteer?.(text, images);
      },
      async followUp(text, images) {
        onFollowUp?.(text, images);
      },
      async abort() {
        streaming = false;
        release();
        emit({ type: 'agent_settled' });
      },
      setModel(model) {
        onSetModel?.(model);
        session.currentModel = model;
      },
      setThinkingLevel() {},
      dispose() {
        listeners.clear();
        release();
      },
    };
    session.release = release;
    return session;
  };

  it('overlapping promptAsync coalesces into steer and inserts the second user bubble', async () => {
    const promptCalls = [];
    const steerCalls = [];
    const session = createHangingSession({
      onPrompt: (text, options) => promptCalls.push({ text, options }),
      onSteer: (text) => steerCalls.push(text),
    });
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      createSession: async () => session,
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Overlap' });
    const first = host.promptAsync(record.id, {
      messageID: 'msg_first',
      parts: [{ type: 'text', text: 'first' }],
    });
    await wait(20);
    const second = host.promptAsync(record.id, {
      messageID: 'msg_second',
      delivery: 'steer',
      parts: [{ type: 'text', text: 'second' }],
    });
    await second;
    expect(steerCalls).toEqual(['second']);
    expect(promptCalls).toHaveLength(1);
    expect(promptCalls[0].text).toBe('first');
    expect(promptCalls[0].options?.streamingBehavior).toBeUndefined();
    const users = host.getMessages(record.id).filter((entry) => entry.info.role === 'user');
    expect(users.map((entry) => entry.info.id)).toEqual(['msg_first', 'msg_second']);
    session.release();
    await first;
    host.dispose();
  });

  it('overlapping idle prompt without delivery still coalesces into one user bubble', async () => {
    const promptCalls = [];
    const steerCalls = [];
    const session = createHangingSession({
      onPrompt: (text, options) => promptCalls.push({ text, options }),
      onSteer: (text) => steerCalls.push(text),
    });
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      createSession: async () => session,
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Overlap idle' });
    const first = host.promptAsync(record.id, {
      messageID: 'msg_first',
      parts: [{ type: 'text', text: 'first' }],
    });
    await wait(20);
    await host.promptAsync(record.id, {
      messageID: 'msg_second',
      parts: [{ type: 'text', text: 'second' }],
    });
    expect(steerCalls).toEqual(['second']);
    const users = host.getMessages(record.id).filter((entry) => entry.info.role === 'user');
    expect(users.map((entry) => entry.info.id)).toEqual(['msg_first']);
    session.release();
    await first;
    host.dispose();
  });

  it('skips setSessionModel during a live prompt', async () => {
    const setModelCalls = [];
    const session = createHangingSession({
      onSetModel: (model) => setModelCalls.push(model),
    });
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      createSession: async () => session,
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Live model' });
    const first = host.promptAsync(record.id, {
      parts: [{ type: 'text', text: 'first' }],
    });
    await wait(20);
    expect(setModelCalls).toEqual([]);
    await host.promptAsync(record.id, {
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
      delivery: 'steer',
      parts: [{ type: 'text', text: 'second' }],
    });
    expect(setModelCalls).toEqual([]);
    session.release();
    await first;
    host.dispose();
  });

  it('stays busy after the first assistant message_end while tools still run', async () => {
    const listeners = new Set();
    const emit = (event) => {
      for (const listener of Array.from(listeners)) listener(event);
    };
    let streaming = false;
    let release = () => {};
    const hang = new Promise((resolve) => {
      release = resolve;
    });
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      createSession: async () => ({
        get isStreaming() {
          return streaming;
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async prompt() {
          streaming = true;
          emit({ type: 'agent_start' });
          emit({ type: 'message_start', message: { role: 'assistant', content: [] } });
          emit({
            type: 'message_end',
            message: { role: 'assistant', content: [{ type: 'text', text: 'working' }] },
          });
          emit({
            type: 'tool_execution_start',
            toolCallId: 'call_1',
            toolName: 'bash',
            args: { command: 'sleep 1' },
          });
          await hang;
          emit({
            type: 'tool_execution_end',
            toolCallId: 'call_1',
            toolName: 'bash',
            isError: false,
            result: { content: [{ type: 'text', text: 'ok' }] },
          });
          streaming = false;
          emit({ type: 'agent_settled' });
        },
        async abort() {
          streaming = false;
          release();
        },
        dispose() {
          listeners.clear();
          release();
        },
      }),
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Tools' });
    const prompt = host.promptAsync(record.id, { parts: [{ type: 'text', text: 'go' }] });
    await wait(30);
    expect(host.getStatus()[record.id]?.type).toBe('busy');
    const assistant = host.getMessages(record.id).find((entry) => entry.info.role === 'assistant');
    expect(assistant?.info?.time?.completed).toBeGreaterThan(0);
    expect(assistant.parts.some((part) => part.type === 'tool' && part.state?.status === 'running')).toBe(true);
    release();
    await prompt;
    expect(host.getStatus()[record.id]).toBeUndefined();
    host.dispose();
  });

  it('Stop then immediate send starts a new prompt, not a live steer', async () => {
    const promptCalls = [];
    const steerCalls = [];
    const session = createHangingSession({
      onPrompt: (text) => promptCalls.push(text),
      onSteer: (text) => steerCalls.push(text),
    });
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      createSession: async () => session,
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Abort then send' });
    const first = host.promptAsync(record.id, { parts: [{ type: 'text', text: 'first' }] });
    await wait(20);
    await host.abort(record.id);
    await first;
    expect(host.getStatus()[record.id]).toBeUndefined();
    await host.promptAsync(record.id, { parts: [{ type: 'text', text: 'after-stop' }] });
    await wait(20);
    expect(promptCalls).toEqual(['first', 'after-stop']);
    expect(steerCalls).toEqual([]);
    session.release();
    await wait(20);
    host.dispose();
  });

  it('queue followUp does not insert a user bubble until the next turn starts', async () => {
    const followUpCalls = [];
    const session = createHangingSession({
      onFollowUp: (text) => followUpCalls.push(text),
    });
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      createSession: async () => session,
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Queue' });
    const first = host.promptAsync(record.id, {
      messageID: 'msg_first',
      parts: [{ type: 'text', text: 'first' }],
    });
    await wait(20);
    await host.promptAsync(record.id, {
      messageID: 'msg_queued',
      delivery: 'followUp',
      parts: [{ type: 'text', text: 'queued' }],
    });
    expect(followUpCalls).toEqual(['queued']);
    const users = host.getMessages(record.id).filter((entry) => entry.info.role === 'user');
    expect(users.map((entry) => entry.info.id)).toEqual(['msg_first']);
    session.release();
    await first;
    host.dispose();
  });

  it('prompt() throw does not force idle while the child is still running', async () => {
    const events = [];
    let streaming = false;
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      onEvent(_directory, event) {
        events.push(event.type);
      },
      createSession: async () => ({
        get isStreaming() {
          return streaming;
        },
        subscribe() {
          return () => {};
        },
        async prompt() {
          streaming = true;
          throw new Error("Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.");
        },
        async abort() {
          streaming = false;
        },
        dispose() {},
      }),
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Throw' });
    await host.promptAsync(record.id, { messageID: 'msg_ghost', parts: [{ type: 'text', text: 'ghost' }] });
    await wait(30);
    expect(host.getStatus()[record.id]?.type).toBe('busy');
    expect(events).not.toContain('session.idle');
    expect(host.getMessages(record.id).some((entry) => entry.info.id === 'msg_ghost')).toBe(false);
    host.dispose();
  });
});

describe('directory identity for session status', () => {
  it('matches trailing-slash and case aliases', () => {
    expect(directoriesMatch('/tmp/project', '/tmp/project/')).toBe(true);
    expect(directoriesMatch('/tmp/Project', '/tmp/project')).toBe(true);
    expect(directoriesMatch('/tmp/wooly', '/tmp/other')).toBe(false);
  });

  it('getStatus includes busy sessions for a trailing-slash directory alias', async () => {
    const host = createPiHost({ mock: true, defaultDirectory: '/tmp/project' });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Alias' });
    let release = () => {};
    const hang = new Promise((resolve) => { release = resolve; });
    record.piSession.prompt = async () => { await hang; };
    const prompt = host.promptAsync(record.id, { parts: [{ type: 'text', text: 'go' }] });
    await new Promise((r) => setTimeout(r, 20));
    expect(host.getStatus('/tmp/project/')[record.id]).toEqual({ type: 'busy' });
    expect(host.listSessions('/tmp/project/').some((item) => item.id === record.id)).toBe(true);
    release();
    await prompt;
    host.dispose();
  });
});

describe('settleRecordIfStuck vs live tools', () => {
  const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

  it('no-ops when tools are still running even if isStreaming is stale false', async () => {
    const listeners = new Set();
    const emit = (event) => {
      for (const listener of Array.from(listeners)) listener(event);
    };
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      createSession: async () => ({
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
            type: 'message_end',
            message: { role: 'assistant', content: [{ type: 'text', text: 'working' }] },
          });
          emit({
            type: 'tool_execution_start',
            toolCallId: 'call_live',
            toolName: 'bash',
            args: { command: 'sleep 1' },
          });
        },
        async abort() {},
        dispose() { listeners.clear(); },
      }),
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Stuck' });
    await host.promptAsync(record.id, { parts: [{ type: 'text', text: 'go' }] });
    await wait();
    expect(host.getStatus()[record.id]?.type).toBe('busy');
    const assistant = host.getMessages(record.id).find((entry) => entry.info.role === 'assistant');
    expect(assistant?.info?.time?.completed).toBeGreaterThan(0);
    expect(assistant.parts.some((part) => part.type === 'tool' && part.state?.status === 'running')).toBe(true);
    host.dispose();
  });

  it('revives sidebar busy on tool_execution after a false settle', async () => {
    const listeners = new Set();
    const emit = (event) => {
      for (const listener of Array.from(listeners)) listener(event);
    };
    const host = createPiHost({
      mock: true,
      defaultDirectory: '/tmp/project',
      createSession: async () => ({
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
            type: 'message_end',
            message: { role: 'assistant', content: [{ type: 'text', text: 'working' }] },
          });
        },
        async abort() {},
        dispose() { listeners.clear(); },
      }),
    });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Revive' });
    await host.promptAsync(record.id, { parts: [{ type: 'text', text: 'go' }] });
    await wait();
    expect(host.getStatus()[record.id]).toBeUndefined();
    emit({
      type: 'tool_execution_start',
      toolCallId: 'call_late',
      toolName: 'read',
      args: { path: 'a.ts' },
    });
    expect(host.getStatus()[record.id]?.type).toBe('busy');
    host.dispose();
  });

  it('completed injected tools do not block idle reload', async () => {
    const host = createPiHost({ mock: true, defaultDirectory: '/tmp/project' });
    const record = await host.createSession({ directory: '/tmp/project', title: 'Idle reload' });
    record.piSession.emitEvent({
      type: 'tool_execution_start',
      toolCallId: 'todo_1',
      toolName: 'todo',
      args: { action: 'create' },
    });
    record.piSession.emitEvent({
      type: 'tool_execution_end',
      toolCallId: 'todo_1',
      toolName: 'todo',
      isError: false,
      result: { details: { action: 'create', tasks: [] } },
    });
    await host.reload({ sessionID: record.id });
    expect(host.getStatus()[record.id]).toBeUndefined();
    host.dispose();
  });
});
