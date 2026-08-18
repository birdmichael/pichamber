import express from 'express';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { SessionManager, CURRENT_SESSION_VERSION } from '@earendil-works/pi-coding-agent';
import { createPiKernel } from './index.js';
import { registerPiFacade } from './opencode-facade.js';
import { createInMemoryPiSession, sessionDirForCwd } from './pi-host.js';
import { sessionArchiveDir } from './session-archive.js';
import {
  PICHAMBER_METADATA_CUSTOM_TYPE,
  readPersistedSessionMetadataFromFileTail,
} from './session-metadata.js';

const tempHomes = [];
afterEach(() => {
  for (const dir of tempHomes.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const listen = (app) => new Promise((resolve) => {
  const server = createServer(app);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({
      server,
      url: `http://127.0.0.1:${port}`,
      close: () => new Promise((done) => server.close(done)),
    });
  });
});

const stubPersistedSession = async ({ sessionManager }) => ({
  sessionId: typeof sessionManager?.getSessionId === 'function'
    ? sessionManager.getSessionId()
    : undefined,
  isStreaming: false,
  subscribe() { return () => {}; },
  async prompt() {},
  async abort() {},
  dispose() {},
});

const writeFacadePersistedSession = ({
  home,
  cwd,
  title,
  userText,
  metadata,
  updated,
  extraLines = [],
  intoArchive = false,
}) => {
  const sessionDir = sessionDirForCwd(cwd, home);
  const manager = SessionManager.create(cwd, sessionDir);
  const file = manager.getSessionFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({
    type: 'session',
    version: CURRENT_SESSION_VERSION,
    id: manager.getSessionId(),
    timestamp: new Date().toISOString(),
    cwd: manager.getCwd(),
  })}\n`);
  const opened = SessionManager.open(file, sessionDir);
  if (title) opened.appendSessionInfo(title);
  if (userText) {
    opened.appendMessage({
      role: 'user',
      content: [{ type: 'text', text: userText }],
      timestamp: Number.isFinite(updated) ? updated : Date.now(),
    });
  }
  if (extraLines.length > 0) {
    fs.appendFileSync(file, `${extraLines.join('\n')}\n`);
  }
  if (metadata) {
    fs.appendFileSync(file, `${JSON.stringify({
      type: 'custom',
      customType: PICHAMBER_METADATA_CUSTOM_TYPE,
      data: metadata,
    })}\n`);
  }
  let sessionFile = opened.getSessionFile();
  if (intoArchive) {
    const dest = path.join(sessionArchiveDir(sessionDir), path.basename(sessionFile));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(sessionFile, dest);
    sessionFile = dest;
  }
  if (Number.isFinite(updated)) {
    fs.utimesSync(sessionFile, new Date(updated), new Date(updated));
  }
  return {
    id: opened.getSessionId(),
    path: sessionFile,
  };
};

const trackSessionFileIo = (files) => {
  const watched = new Set((files || []).map((file) => path.resolve(file)));
  const hits = [];
  const note = (file) => {
    if (typeof file !== 'string' && !Buffer.isBuffer(file)) return;
    const resolved = path.resolve(String(file));
    if (watched.has(resolved)) hits.push(resolved);
  };
  const origCreateReadStream = fs.createReadStream;
  const origReadFileSync = fs.readFileSync;
  const origOpenSync = fs.openSync;
  const origPromisesReadFile = fs.promises.readFile;
  fs.createReadStream = function patchedCreateReadStream(file, options) {
    note(file);
    return origCreateReadStream.call(this, file, options);
  };
  fs.readFileSync = function patchedReadFileSync(file, options) {
    note(file);
    return origReadFileSync.call(this, file, options);
  };
  fs.openSync = function patchedOpenSync(file, flags, mode) {
    note(file);
    return origOpenSync.call(this, file, flags, mode);
  };
  fs.promises.readFile = function patchedPromisesReadFile(file, options) {
    note(file);
    return origPromisesReadFile.call(this, file, options);
  };
  return {
    hits,
    restore() {
      fs.createReadStream = origCreateReadStream;
      fs.readFileSync = origReadFileSync;
      fs.openSync = origOpenSync;
      fs.promises.readFile = origPromisesReadFile;
    },
  };
};

const startFacade = async ({
  directory = '/tmp/project',
  mock = true,
  createSession,
  readListSessionMetadata,
  listPersistedSessionsInDir,
} = {}) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-facade-home-'));
  tempHomes.push(home);
  const previousDataDir = process.env.OPENCHAMBER_DATA_DIR;
  process.env.OPENCHAMBER_DATA_DIR = home;
  const kernel = createPiKernel({
    mock,
    defaultDirectory: directory,
    home,
    ...(createSession ? {
      createSession,
      createModelRuntime: async () => ({ getAvailable: async () => [] }),
      createDirectoryRuntime: async ({ cwd }) => ({ session: null, directory: cwd }),
    } : {}),
    ...(readListSessionMetadata ? { readListSessionMetadata } : {}),
    ...(listPersistedSessionsInDir ? { listPersistedSessionsInDir } : {}),
  });
  const app = express();
  app.use(express.json());
  registerPiFacade(app, { host: kernel.host, bus: kernel.bus, defaultDirectory: directory });
  const http = await listen(app);
  const close = async () => {
    if (previousDataDir === undefined) delete process.env.OPENCHAMBER_DATA_DIR;
    else process.env.OPENCHAMBER_DATA_DIR = previousDataDir;
    await http.close();
  };
  return { kernel, url: http.url, server: http.server, close };
};

const waitForPiUi = async (url, sessionID) => {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const listed = await (await fetch(`${url}/api/pi/ui?session=${sessionID}`)).json();
    if (Array.isArray(listed) && listed.length > 0) return listed;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for /api/pi/ui');
};

describe('OpenCode facade HTTP/SSE', () => {
  it('bootstraps path/providers/session and streams a mock prompt', async () => {
    const { url, close, kernel } = await startFacade();
    try {
      const pathRes = await fetch(`${url}/api/path`);
      const pathBody = await pathRes.json();
      expect(pathRes.status).toBe(200);
      expect(pathBody.directory).toBe('/tmp/project');
      expect(pathBody.config).toContain('.pi/agent');

      const upgradeRes = await fetch(`${url}/api/pi/upgrade-status`);
      const upgrade = await upgradeRes.json();
      expect(upgradeRes.status).toBe(200);
      expect(upgrade.package).toBe('@earendil-works/pi-coding-agent');
      expect(upgrade.upgrade).toEqual({ supported: false, reason: 'bundled' });
      expect(typeof upgrade.available).toBe('boolean');

      const providers = await (await fetch(`${url}/api/config/providers`)).json();
      expect(providers.providers[0].id).toBe('pi-mock');

      expect(await (await fetch(`${url}/api/mcp`)).json()).toEqual({});
      expect(await (await fetch(`${url}/api/lsp`)).json()).toEqual([]);
      expect(await (await fetch(`${url}/api/permission`)).json()).toEqual([]);
      expect(await (await fetch(`${url}/api/question`)).json()).toEqual([]);
      expect((await (await fetch(`${url}/api/command`)).json()).some((command) => command.name === 'compact')).toBe(true);

      const created = await (await fetch(`${url}/api/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Facade session' }),
      })).json();
      expect(created.id).toMatch(/^ses_/);
      expect(created.title).toBe('Facade session');

      const listed = await (await fetch(`${url}/api/session`)).json();
      expect(listed).toHaveLength(1);

      const sseChunks = [];
      const sseAbort = new AbortController();
      const ssePromise = (async () => {
        const response = await fetch(`${url}/api/global/event`, { signal: sseAbort.signal });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseChunks.push(decoder.decode(value));
          if (sseChunks.join('').includes('session.idle')) break;
        }
      })();

      const prompt = await fetch(`${url}/api/session/${created.id}/prompt_async`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messageID: 'msg_user_1',
          parts: [{ type: 'text', text: 'hello facade' }],
        }),
      });
      expect(prompt.status).toBe(200);

      await Promise.race([
        ssePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('SSE timeout')), 2000)),
      ]);
      sseAbort.abort();

      const stream = sseChunks.join('');
      expect(stream).toContain('message.part.delta');
      expect(stream).toContain('"field":"text"');
      expect(stream).toContain('session.idle');

      const messages = await (await fetch(`${url}/api/session/${created.id}/message`)).json();
      expect(messages[0].info.role).toBe('user');
      expect(messages[0].parts.filter((part) => part.type === 'text')).toHaveLength(1);
      const assistant = messages.find((entry) => entry.info.role === 'assistant');
      expect(assistant).toBeTruthy();
      expect(assistant.info.parentID).toBe('msg_user_1');
      expect(assistant.info.finish).toBe('stop');

      const byId = await fetch(`${url}/api/session/${created.id}/message/${assistant.info.id}`);
      expect(byId.status).toBe(200);
      const found = await byId.json();
      expect(found.info.id).toBe(assistant.info.id);
      expect(found.parts.filter((part) => part.type === 'text').map((part) => part.text).join(''))
        .toContain('Pi mock kernel');
      const missing = await fetch(`${url}/api/session/${created.id}/message/msg_missing`);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: 'Message not found' });

      const status = await (await fetch(`${url}/api/session/status`)).json();
      expect(status).toEqual({});
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('aborts a streaming mock session', async () => {
    const { url, close, kernel } = await startFacade();
    try {
      const created = await (await fetch(`${url}/api/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Abort me' }),
      })).json();

      const prompt = fetch(`${url}/api/session/${created.id}/prompt_async`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parts: [{ type: 'text', text: 'long' }] }),
      });
      const aborted = await fetch(`${url}/api/session/${created.id}/abort`, { method: 'POST' });
      expect(aborted.status).toBe(200);
      expect(await aborted.json()).toBe(true);
      await prompt;
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('exposes Pi kernel, skills, commands, defaults, and clone', async () => {
    const { url, close, kernel } = await startFacade();
    try {
      const kernelInfo = await (await fetch(`${url}/api/kernel`)).json();
      expect(kernelInfo.kernel).toBe('pi');
      expect(kernelInfo.product).toBe('Pichamber');
      expect(kernelInfo.thinkingLevels).toContain('high');

      const commands = await (await fetch(`${url}/api/command`)).json();
      expect(commands.some((command) => command.name === 'compact')).toBe(true);
      expect(commands.some((command) => command.name === 'login')).toBe(true);
      expect(commands.some((command) => command.name === 'reload')).toBe(false);
      expect(commands.some((command) => command.name === 'model')).toBe(false);
      expect(commands.some((command) => command.name === 'thinking')).toBe(false);
      const sdkCommands = await (await fetch(`${url}/command`)).json();
      expect(sdkCommands.some((command) => command.name === 'compact')).toBe(true);

      const skills = await (await fetch(`${url}/api/config/skills`)).json();
      expect(Array.isArray(skills.skills)).toBe(true);
      const sdkSkills = await (await fetch(`${url}/skill`)).json();
      expect(Array.isArray(sdkSkills)).toBe(true);

      const auth = await (await fetch(`${url}/api/auth/session`)).json();
      expect(auth.authenticated).toBe(true);
      expect(auth.disabled).toBe(true);

      const emptyDefaults = await (await fetch(`${url}/api/pi/defaults`)).json();
      expect(emptyDefaults.model).toBe('');
      expect(emptyDefaults.resolvedModel).toBe('pi-mock/mock');

      const patched = await (await fetch(`${url}/api/pi/defaults`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ thinking: 'high', compaction: false }),
      })).json();
      expect(patched.thinking).toBe('high');
      expect(patched.compaction).toBe(false);

      const created = await (await fetch(`${url}/api/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Clone source' }),
      })).json();
      const cloned = await (await fetch(`${url}/api/session/${created.id}/clone`, { method: 'POST' })).json();
      expect(cloned.id).not.toBe(created.id);
      expect(cloned.parentID).toBe(created.id);
      expect(cloned.title).toContain('copy');
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('creates and deletes a Pi prompt command', async () => {
    const { url, close, kernel } = await startFacade();
    try {
      const created = await (await fetch(`${url}/api/config/commands/ship`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'Ship it', template: 'Prepare the change.' }),
      })).json();
      expect(created.name).toBe('ship');
      expect(created.source).toBe('prompt');
      const listed = await (await fetch(`${url}/api/command`)).json();
      expect(listed.some((command) => command.name === 'ship')).toBe(true);
      const deleted = await fetch(`${url}/api/config/commands/ship`, { method: 'DELETE' });
      expect(deleted.status).toBe(200);
      const after = await (await fetch(`${url}/api/command`)).json();
      expect(after.some((command) => command.name === 'ship')).toBe(false);
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('serves an OpenCode-shaped user object on /user and /api/user', async () => {
    const { url, close, kernel } = await startFacade();
    try {
      const bare = await fetch(`${url}/user`);
      expect(bare.status).toBe(200);
      const user = await bare.json();
      expect(user).toMatchObject({
        id: expect.any(String),
        email: expect.any(String),
        name: expect.any(String),
      });

      const prefixed = await fetch(`${url}/api/user`);
      expect(prefixed.status).toBe(200);
      expect(await prefixed.json()).toEqual(user);
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('returns provider auth methods from ~/.pi/agent without erroring', async () => {
    const { url, close, kernel } = await startFacade();
    try {
      const home = kernel.host.getPath().home;
      fs.mkdirSync(path.join(home, '.pi', 'agent'), { recursive: true });
      fs.writeFileSync(path.join(home, '.pi', 'agent', 'auth.json'), JSON.stringify({
        'example-provider': { type: 'api', key: 'sk-test-do-not-leak' },
      }));
      fs.writeFileSync(path.join(home, '.pi', 'agent', 'models.json'), JSON.stringify({
        providers: { 'example-provider': { baseUrl: 'https://example.test' } },
      }));
      const prefixed = await fetch(`${url}/api/provider/auth`);
      expect(prefixed.status).toBe(200);
      const methods = await prefixed.json();
      expect(methods['example-provider'][0]).toMatchObject({ type: 'api' });
      expect(JSON.stringify(methods)).not.toContain('sk-test');

      const bare = await fetch(`${url}/provider/auth`);
      expect(bare.status).toBe(200);
      expect(await bare.json()).toEqual(methods);

      const source = await (await fetch(`${url}/api/provider/example-provider/source`)).json();
      expect(source.sources.auth.exists).toBe(true);
      expect(source.sources.user.exists).toBe(true);
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('saves API keys and custom providers to ~/.pi/agent', async () => {
    const { url, close, kernel } = await startFacade();
    try {
      const home = kernel.host.getPath().home;
      const authResponse = await fetch(`${url}/auth/acme`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'api', key: 'sk-test-do-not-leak' }),
      });
      expect(authResponse.status).toBe(200);
      expect(await authResponse.json()).toBe(true);

      const prefixedAuth = await fetch(`${url}/api/auth/acme`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'api', key: 'sk-test-do-not-leak' }),
      });
      expect(prefixedAuth.status).toBe(200);

      const upsert = await fetch(`${url}/api/provider`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerID: 'acme',
          scope: 'user',
          config: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Acme',
            options: { baseURL: 'https://api.acme.test/v1' },
            models: { 'grok-4.6': { name: 'Grok 4.6' } },
          },
        }),
      });
      expect(upsert.status).toBe(200);
      const payload = await upsert.json();
      expect(payload).toMatchObject({
        success: true,
        kernel: 'pi',
        requiresReload: true,
        providerId: 'acme',
      });
      expect(JSON.stringify(payload)).not.toContain('sk-test');

      const storedAuth = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'auth.json'), 'utf8'));
      expect(storedAuth.acme).toEqual({ type: 'api_key', key: 'sk-test-do-not-leak' });
      const storedModels = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'models.json'), 'utf8'));
      expect(storedModels.providers.acme.baseUrl).toBe('https://api.acme.test/v1');
      expect(storedModels.providers.acme.models).toEqual([{ id: 'grok-4.6', name: 'Grok 4.6' }]);

      const methods = await (await fetch(`${url}/api/provider/auth`)).json();
      expect(methods.acme[0]).toMatchObject({ type: 'api' });
      expect(JSON.stringify(methods)).not.toContain('sk-test');

      const disconnected = await fetch(`${url}/api/provider/acme/auth?scope=all`, { method: 'DELETE' });
      expect(disconnected.status).toBe(200);
      expect((await disconnected.json()).removed).toBe(true);
      const afterAuth = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'auth.json'), 'utf8'));
      expect(afterAuth.acme).toBeUndefined();
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('lists remote provider models without echoing the API key', async () => {
    const { url, close, kernel } = await startFacade();
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (requestUrl, init) => {
        const href = String(requestUrl);
        if (href.startsWith('https://ai.example.test')) {
          expect(href).toBe('https://ai.example.test/v1/models');
          expect(init.headers.Authorization).toBe('Bearer sk-test-do-not-leak');
          return {
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            text: async () => JSON.stringify({ data: [{ id: 'grok-4.6', name: 'Grok 4.6' }] }),
          };
        }
        return originalFetch(requestUrl, init);
      };
      const response = await fetch(`${url}/api/provider/models`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseURL: 'https://ai.example.test/v1',
          apiKey: 'sk-test-do-not-leak',
        }),
      });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toEqual({ models: [{ id: 'grok-4.6', name: 'Grok 4.6' }] });
      expect(JSON.stringify(payload)).not.toContain('sk-test');
    } finally {
      globalThis.fetch = originalFetch;
      kernel.dispose();
      await close();
    }
  });

  it('writes and disconnects provider auth for whatever id is in the URL', async () => {
    const { url, close, kernel } = await startFacade();
    try {
      const home = kernel.host.getPath().home;
      const providerId = 'campus-llm';
      const put = await fetch(`${url}/api/auth/${providerId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'api', key: 'sk-test-do-not-leak' }),
      });
      expect(put.status).toBe(200);
      expect(await put.json()).toBe(true);

      const authPath = path.join(home, '.pi', 'agent', 'auth.json');
      const stored = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      expect(stored[providerId]).toEqual({ type: 'api_key', key: 'sk-test-do-not-leak' });

      const methods = await (await fetch(`${url}/api/provider/auth`)).json();
      expect(methods[providerId][0]).toMatchObject({ type: 'api' });
      expect(JSON.stringify(methods)).not.toContain('sk-test');

      const source = await (await fetch(`${url}/api/provider/${providerId}/source`)).json();
      expect(source.sources.auth.exists).toBe(true);

      const barePut = await fetch(`${url}/auth/${providerId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'api', key: 'sk-rotated' }),
      });
      expect(barePut.status).toBe(200);
      expect(JSON.parse(fs.readFileSync(authPath, 'utf8'))[providerId].key).toBe('sk-rotated');

      const disconnect = await fetch(`${url}/api/provider/${providerId}/auth?scope=all`, { method: 'DELETE' });
      expect(disconnect.status).toBe(200);
      expect(await disconnect.json()).toMatchObject({
        success: true,
        removed: true,
        kernel: 'pi',
        requiresReload: false,
      });
      expect(JSON.parse(fs.readFileSync(authPath, 'utf8'))[providerId]).toBeUndefined();
      expect((await (await fetch(`${url}/api/provider/${providerId}/source`)).json()).sources.auth.exists).toBe(false);

      const sdkDelete = await fetch(`${url}/api/auth/other-provider`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'api', key: 'sk-other' }),
      });
      expect(sdkDelete.status).toBe(200);
      const removed = await fetch(`${url}/api/auth/other-provider`, { method: 'DELETE' });
      expect(removed.status).toBe(200);
      expect(await removed.json()).toBe(true);
      expect(JSON.parse(fs.readFileSync(authPath, 'utf8'))['other-provider']).toBeUndefined();
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('reloads the in-process Pi kernel without requiring a window reload', async () => {
    const { url, close, kernel } = await startFacade();
    try {
      const created = await (await fetch(`${url}/api/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Stay alive' }),
      })).json();
      let reloads = 0;
      const original = kernel.host.reload.bind(kernel.host);
      kernel.host.reload = async () => {
        reloads += 1;
        return original();
      };
      const response = await fetch(`${url}/api/config/reload`, { method: 'POST' });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toMatchObject({
        success: true,
        kernel: 'pi',
        requiresReload: false,
      });
      expect(reloads).toBe(1);
      const listed = await (await fetch(`${url}/api/session`)).json();
      expect(listed.some((item) => item.id === created.id)).toBe(true);
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('returns 409 from config reload while a session is streaming', async () => {
    const { url, close, kernel } = await startFacade({
      createSession: async () => createInMemoryPiSession({
        chunks: ['one ', 'two ', 'three'],
        chunkDelayMs: 40,
      }),
    });
    try {
      const created = await (await fetch(`${url}/api/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Busy' }),
      })).json();
      void fetch(`${url}/api/session/${created.id}/prompt_async`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parts: [{ type: 'text', text: 'go' }] }),
      });
      await new Promise((resolve) => setTimeout(resolve, 15));
      const response = await fetch(`${url}/api/config/reload`, { method: 'POST' });
      expect(response.status).toBe(409);
      const payload = await response.json();
      expect(payload.error).toBe('Wait for the current response to finish before reloading.');
      const listed = await (await fetch(`${url}/api/session`)).json();
      expect(listed.some((item) => item.id === created.id)).toBe(true);
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('reloads one session while a sibling is streaming', async () => {
    const idleSession = createInMemoryPiSession();
    const busySession = createInMemoryPiSession({
      chunks: ['one ', 'two ', 'three'],
      chunkDelayMs: 40,
    });
    let createdCount = 0;
    const { url, close, kernel } = await startFacade({
      createSession: async () => {
        createdCount += 1;
        return createdCount === 1 ? idleSession : busySession;
      },
    });
    try {
      const idle = await (await fetch(`${url}/api/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Idle' }),
      })).json();
      const busy = await (await fetch(`${url}/api/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Busy' }),
      })).json();
      void fetch(`${url}/api/session/${busy.id}/prompt_async`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parts: [{ type: 'text', text: 'go' }] }),
      });
      await new Promise((resolve) => setTimeout(resolve, 15));
      const response = await fetch(`${url}/api/session/${idle.id}/reload`, { method: 'POST' });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        success: true,
        reloaded: true,
        sessionID: idle.id,
      });
      expect(idleSession.reloadCount).toBe(1);
      expect(busySession.reloadCount).toBe(0);
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('reloads session records without emitting server.connected', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-facade-records-'));
    tempHomes.push(directory);
    const events = [];
    const { url, close, kernel } = await startFacade({
      directory,
      mock: false,
      createSession: async ({ sessionManager }) => ({
        sessionId: typeof sessionManager?.getSessionId === 'function'
          ? sessionManager.getSessionId()
          : undefined,
        isStreaming: false,
        subscribe() { return () => {}; },
        async prompt() {},
        async abort() {},
        async reload() {},
        dispose() {},
      }),
    });
    kernel.bus.subscribeEvent((event) => events.push(event.payload || event));
    try {
      const created = await (await fetch(`${url}/api/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Open row' }),
      })).json();
      const record = kernel.host.getSession(created.id);
      const opened = SessionManager.open(record.sessionFile, sessionDirForCwd(directory, kernel.host.getPath().home));
      opened.appendMessage({
        role: 'user',
        content: [{ type: 'text', text: 'written after create' }],
        timestamp: Date.now(),
      });
      events.length = 0;
      const response = await fetch(`${url}/api/pi/sessions/reload`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionID: created.id }),
      });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toMatchObject({
        success: true,
        reloaded: true,
        kernel: 'pi',
        sessionID: created.id,
      });
      expect(payload.sessions.map((item) => item.id)).toContain(created.id);
      expect(payload.messages.some((entry) => entry.parts?.[0]?.text === 'written after create')).toBe(true);
      const listed = await (await fetch(`${url}/api/session`)).json();
      expect(listed.some((item) => item.id === created.id)).toBe(true);
      const messages = await (await fetch(`${url}/api/session/${created.id}/message`)).json();
      expect(messages.some((entry) => entry.parts?.[0]?.text === 'written after create')).toBe(true);
      expect(events.map((event) => event.type)).not.toContain('server.connected');
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('returns 409 from session-record reload while the target is streaming', async () => {
    const { url, close, kernel } = await startFacade({
      createSession: async () => createInMemoryPiSession({
        chunks: ['one ', 'two ', 'three'],
        chunkDelayMs: 40,
      }),
    });
    try {
      const created = await (await fetch(`${url}/api/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Busy' }),
      })).json();
      const sibling = await (await fetch(`${url}/api/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Idle sibling' }),
      })).json();
      void fetch(`${url}/api/session/${created.id}/prompt_async`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parts: [{ type: 'text', text: 'go' }] }),
      });
      await new Promise((resolve) => setTimeout(resolve, 15));
      const response = await fetch(`${url}/api/pi/sessions/reload`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionID: created.id }),
      });
      expect(response.status).toBe(409);
      const payload = await response.json();
      expect(payload.error).toBe('Wait for the current response to finish before reloading.');
      const listed = await (await fetch(`${url}/api/session`)).json();
      expect(listed.map((item) => item.id).sort()).toEqual([created.id, sibling.id].sort());
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('rejects /reload as a user command and persists thinking defaults', async () => {
    const { url, close, kernel } = await startFacade();
    try {
      const created = await (await fetch(`${url}/api/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Commands' }),
      })).json();
      let reloads = 0;
      const original = kernel.host.reload.bind(kernel.host);
      kernel.host.reload = async () => {
        reloads += 1;
        return original();
      };
      const command = await fetch(`${url}/api/session/${created.id}/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: 'reload', arguments: '' }),
      });
      expect(command.status).toBe(400);
      const body = await command.json();
      expect(body.error).toMatch(/not a user command/);
      expect(reloads).toBe(0);
      const messages = await (await fetch(`${url}/api/session/${created.id}/message`)).json();
      expect(messages).toEqual([]);

      const thinking = await fetch(`${url}/api/session/${created.id}/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: 'thinking', arguments: 'high' }),
      });
      expect(thinking.status).toBe(200);
      const defaults = await (await fetch(`${url}/api/pi/defaults`)).json();
      expect(defaults.thinking).toBe('high');
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('lists and runs live extension commands without turning them into chat', async () => {
    const { url, close, kernel } = await startFacade();
    try {
      const created = await (await fetch(`${url}/api/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Extension commands' }),
      })).json();
      const record = kernel.host.getSession(created.id);
      const prompted = [];
      const originalPrompt = record.piSession.prompt.bind(record.piSession);
      record.piSession.prompt = async (text, options) => {
        prompted.push(text);
        return originalPrompt(text, options);
      };
      record.piSession.registerCommand('plan', async () => {}, { description: 'Enter plan mode' });

      const listed = await (await fetch(`${url}/api/command`)).json();
      expect(listed.some((command) => command.name === 'plan' && command.source === 'extension')).toBe(true);
      expect(listed.some((command) => command.name === 'reload')).toBe(false);
      const pinned = await (await fetch(`${url}/api/command?session=${encodeURIComponent(created.id)}`)).json();
      expect(pinned.some((command) => command.name === 'plan')).toBe(true);

      const command = await fetch(`${url}/api/session/${created.id}/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: 'plan', arguments: 'start' }),
      });
      expect(command.status).toBe(200);
      expect(prompted).toEqual(['/plan start']);
      const messages = await (await fetch(`${url}/api/session/${created.id}/message`)).json();
      const texts = messages.flatMap((entry) => (entry.parts || []).map((part) => part.text).filter(Boolean));
      expect(texts).not.toContain('/plan start');

      const unknown = await fetch(`${url}/api/session/${created.id}/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: 'not-a-command', arguments: '' }),
      });
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toMatchObject({ error: 'Unknown command: /not-a-command' });
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('searches project files for @ mentions', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-find-files-'));
    tempHomes.push(project);
    fs.mkdirSync(path.join(project, 'src'), { recursive: true });
    fs.writeFileSync(path.join(project, 'src', 'composer.ts'), 'export {}\n');
    fs.writeFileSync(path.join(project, 'README.md'), 'hi\n');
    fs.mkdirSync(path.join(project, 'node_modules', 'skip'), { recursive: true });
    fs.writeFileSync(path.join(project, 'node_modules', 'skip', 'hidden.ts'), 'nope\n');
    const { url, close, kernel } = await startFacade({ directory: project });
    try {
      const dirQ = `directory=${encodeURIComponent(project)}`;
      const all = await (await fetch(`${url}/api/find/files?${dirQ}`)).json();
      expect(all).toEqual(expect.arrayContaining(['README.md', 'src/composer.ts']));
      expect(all.join('|')).not.toContain('node_modules');
      const filtered = await (await fetch(`${url}/api/find/files?query=composer&type=file&${dirQ}`)).json();
      expect(filtered).toEqual(['src/composer.ts']);
      const bare = await fetch(`${url}/find/files?query=README&${dirQ}`);
      expect(bare.status).toBe(200);
      expect(await bare.json()).toEqual(['README.md']);
      const sdkPath = await fetch(`${url}/find/file?query=composer&type=file&${dirQ}`);
      expect(sdkPath.status).toBe(200);
      expect(await sdkPath.json()).toEqual(['src/composer.ts']);
      fs.writeFileSync(path.join(project, 'package.json'), '{}');
      const pack = await (await fetch(`${url}/api/find/files?query=pack&type=file&${dirQ}`)).json();
      expect(pack).toEqual(['package.json']);
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('rejects revert, unrevert, and shell as unsupported instead of empty success', async () => {
    const { url, close, kernel } = await startFacade();
    try {
      for (const action of ['revert', 'unrevert', 'shell']) {
        const response = await fetch(`${url}/api/session/ses_stub/${action}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(response.status).toBe(501);
        expect(await response.json()).toMatchObject({
          error: 'unsupported',
          kernel: 'pi',
        });
      }
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('exports JSONL and imports a session with prefix messages', async () => {
    const { url, close, kernel } = await startFacade();
    try {
      const created = await (await fetch(`${url}/api/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Export source' }),
      })).json();
      await fetch(`${url}/api/session/${created.id}/prompt_async`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messageID: 'msg_export_user',
          parts: [{ type: 'text', text: 'prefix hello' }],
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 40));

      const exported = await fetch(`${url}/api/session/${created.id}/export?format=jsonl`);
      expect(exported.status).toBe(200);
      const jsonl = await exported.text();
      expect(jsonl).toContain('"type":"session"');
      expect(jsonl).toContain('prefix hello');

      const imported = await fetch(`${url}/api/session/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonl }),
      });
      expect(imported.status).toBe(200);
      const info = await imported.json();
      expect(info.id).not.toBe(created.id);
      expect(info.title).toBe('Export source');

      const messages = await (await fetch(`${url}/api/session/${info.id}/message`)).json();
      expect(messages[0].info.role).toBe('user');
      expect(messages[0].parts[0].text).toBe('prefix hello');
      expect(messages[0].info.sessionID).toBe(info.id);
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('loads a persisted Pi session id after a cold start', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-facade-cwd-'));
    tempHomes.push(directory);
    const { url, close, kernel } = await startFacade({
      directory,
      mock: false,
      createSession: async ({ sessionManager }) => ({
        sessionId: typeof sessionManager?.getSessionId === 'function'
          ? sessionManager.getSessionId()
          : undefined,
        isStreaming: false,
        subscribe() { return () => {}; },
        async prompt() {},
        async abort() {},
        dispose() {},
      }),
    });
    try {
      const home = kernel.host.getPath().home;
      const sessionDir = sessionDirForCwd(directory, home);
      const manager = SessionManager.create(directory, sessionDir);
      const file = manager.getSessionFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify({
        type: 'session',
        version: CURRENT_SESSION_VERSION,
        id: manager.getSessionId(),
        timestamp: new Date().toISOString(),
        cwd: manager.getCwd(),
      })}\n`);
      const opened = SessionManager.open(file, sessionDir);
      opened.appendSessionInfo('Cold start row');
      opened.appendMessage({
        role: 'user',
        content: [{ type: 'text', text: 'open me after restart' }],
        timestamp: Date.now(),
      });
      const sessionID = opened.getSessionId();
      const dirQ = `directory=${encodeURIComponent(directory)}`;

      const listed = await (await fetch(`${url}/api/session?${dirQ}`)).json();
      expect(listed.map((item) => item.id)).toContain(sessionID);

      const getRes = await fetch(`${url}/api/session/${sessionID}?${dirQ}`);
      expect(getRes.status).toBe(200);
      expect((await getRes.json()).id).toBe(sessionID);

      const messageRes = await fetch(`${url}/api/session/${sessionID}/message?${dirQ}`);
      expect(messageRes.status).toBe(200);
      const messages = await messageRes.json();
      expect(messages[0].parts[0].text).toBe('open me after restart');
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('keeps archived Pi sessions off archived=false lists and reports time.archived when included', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-facade-archive-'));
    tempHomes.push(directory);
    const { url, close, kernel } = await startFacade({
      directory,
      mock: false,
      createSession: async ({ sessionManager }) => ({
        sessionId: typeof sessionManager?.getSessionId === 'function'
          ? sessionManager.getSessionId()
          : undefined,
        isStreaming: false,
        subscribe() { return () => {}; },
        async prompt() {},
        async abort() {},
        dispose() {},
      }),
    });
    try {
      const created = await (await fetch(`${url}/api/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Archive via HTTP' }),
      })).json();
      const archivedAt = 1_700_000_456_000;
      const patched = await (await fetch(`${url}/api/session/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ time: { archived: archivedAt } }),
      })).json();
      expect(patched.time.archived).toBe(archivedAt);
      const sessionDir = sessionDirForCwd(directory, kernel.host.getPath().home);
      const archivedFile = kernel.host.getSession(created.id).sessionFile;
      expect(path.dirname(archivedFile)).toBe(sessionArchiveDir(sessionDir));
      expect(fs.existsSync(archivedFile)).toBe(true);

      const dirQ = `directory=${encodeURIComponent(directory)}`;
      const active = await (await fetch(`${url}/api/experimental/session?archived=false&${dirQ}`)).json();
      expect(active.map((item) => item.id)).not.toContain(created.id);

      const inclusive = await (await fetch(`${url}/api/experimental/session?archived=true&${dirQ}`)).json();
      expect(inclusive.find((item) => item.id === created.id)?.time.archived).toBe(archivedAt);
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('does not open archived jsonl on archived=false and paginates both session list routes', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-facade-list-io-'));
    tempHomes.push(directory);
    const reads = [];
    const listCalls = [];
    const { url, close, kernel } = await startFacade({
      directory,
      mock: false,
      createSession: stubPersistedSession,
      async listPersistedSessionsInDir(cwd, dir) {
        const items = await SessionManager.list(cwd, dir);
        listCalls.push({
          dir,
          paths: (items || []).map((item) => item.path),
        });
        return items;
      },
      readListSessionMetadata(file) {
        let bytes = 0;
        let size = 0;
        try {
          size = fs.statSync(file).size;
        } catch {
        }
        const metadata = readPersistedSessionMetadataFromFileTail(file, {
          io: {
            readSync(fd, buffer, offset, length, position) {
              const n = fs.readSync(fd, buffer, offset, length, position);
              bytes += n;
              return n;
            },
          },
        });
        reads.push({ file, bytes, size });
        return metadata;
      },
    });
    try {
      const home = kernel.host.getPath().home;
      const sessionDir = sessionDirForCwd(directory, home);
      const archiveDir = sessionArchiveDir(sessionDir);
      const pad = 'x'.repeat(256 * 1024);
      const largeLine = JSON.stringify({
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: pad }] },
      });
      const active = writeFacadePersistedSession({
        home,
        cwd: directory,
        title: 'Active row',
        userText: 'keep me',
        updated: 3_000,
      });
      const restored = writeFacadePersistedSession({
        home,
        cwd: directory,
        title: 'Restored row',
        userText: 'back on the list',
        metadata: { archived: 0 },
        updated: 2_000,
      });
      const archivedLarge = writeFacadePersistedSession({
        home,
        cwd: directory,
        title: 'Archived large',
        userText: 'hide me',
        extraLines: [largeLine],
        metadata: { archived: 1_700_000_000_000 },
        updated: 1_000,
        intoArchive: true,
      });
      const archivedExtra = [
        writeFacadePersistedSession({
          home,
          cwd: directory,
          title: 'Archived large 2',
          userText: 'hide me too',
          extraLines: [largeLine],
          metadata: { archived: 1_700_000_000_001 },
          updated: 900,
          intoArchive: true,
        }),
        writeFacadePersistedSession({
          home,
          cwd: directory,
          title: 'Archived large 3',
          userText: 'hide me three',
          extraLines: [largeLine],
          metadata: { archived: 1_700_000_000_002 },
          updated: 800,
          intoArchive: true,
        }),
      ];
      const child = writeFacadePersistedSession({
        home,
        cwd: directory,
        title: 'Child row',
        userText: 'not a root',
        metadata: { parentID: active.id },
        updated: 4_000,
      });
      const newest = writeFacadePersistedSession({
        home,
        cwd: directory,
        title: 'Newest root',
        userText: 'page one',
        updated: 5_000,
      });
      fs.writeFileSync(path.join(sessionDir, 'broken.jsonl'), '{not-json\n');
      fs.mkdirSync(archiveDir, { recursive: true });
      fs.writeFileSync(path.join(archiveDir, 'broken-archive.jsonl'), '{not-json\n');

      const archivedPaths = [archivedLarge.path, ...archivedExtra.map((item) => item.path)];
      expect(archivedPaths.every((file) => file.startsWith(`${archiveDir}${path.sep}`))).toBe(true);
      expect(fs.statSync(archivedLarge.path).size).toBeGreaterThan(200_000);

      const dirQ = `directory=${encodeURIComponent(directory)}`;
      const io = trackSessionFileIo(archivedPaths);
      listCalls.length = 0;
      reads.length = 0;
      const activeList = await (await fetch(`${url}/api/experimental/session?archived=false&${dirQ}`)).json();
      const activeListCalls = listCalls.filter((call) => call.dir === sessionDir);
      const archiveListCalls = listCalls.filter((call) => call.dir === archiveDir);
      const activeIds = activeList.map((item) => item.id);
      expect(activeIds).toEqual(expect.arrayContaining([
        active.id,
        restored.id,
        child.id,
        newest.id,
      ]));
      expect(activeIds).not.toContain(archivedLarge.id);
      expect(activeIds).not.toEqual(expect.arrayContaining(archivedExtra.map((item) => item.id)));
      expect(activeList.find((item) => item.id === restored.id)?.time.archived).toBe(0);
      expect(archiveListCalls).toEqual([]);
      expect(activeListCalls).toHaveLength(1);
      expect(activeListCalls[0].paths).not.toEqual(expect.arrayContaining(archivedPaths));
      expect(reads.map((item) => item.file)).not.toEqual(expect.arrayContaining(archivedPaths));
      expect(io.hits).toEqual([]);

      const moreArchived = writeFacadePersistedSession({
        home,
        cwd: directory,
        title: 'Archived large 4',
        userText: 'still hidden',
        extraLines: [largeLine],
        metadata: { archived: 1_700_000_000_003 },
        updated: 700,
        intoArchive: true,
      });
      io.restore();
      const afterArchiveIo = trackSessionFileIo([...archivedPaths, moreArchived.path]);
      listCalls.length = 0;
      reads.length = 0;
      const activeAgain = await (await fetch(`${url}/api/session?archived=false&${dirQ}`)).json();
      expect(activeAgain.map((item) => item.id).sort()).toEqual(activeIds.slice().sort());
      expect(listCalls.filter((call) => call.dir === archiveDir)).toEqual([]);
      expect(listCalls.filter((call) => call.dir === sessionDir)[0].paths)
        .toHaveLength(activeListCalls[0].paths.length);
      expect(afterArchiveIo.hits).toEqual([]);
      afterArchiveIo.restore();

      const roots = await (await fetch(`${url}/api/session?archived=false&roots=true&${dirQ}`)).json();
      expect(roots.map((item) => item.id)).toEqual(expect.arrayContaining([
        active.id,
        restored.id,
        newest.id,
      ]));
      expect(roots.map((item) => item.id)).not.toContain(child.id);

      const first = await fetch(`${url}/api/session?archived=false&roots=true&limit=1&${dirQ}`);
      const firstPage = await first.json();
      expect(firstPage.map((item) => item.id)).toEqual([newest.id]);
      expect(first.headers.get('x-next-cursor')).toBe(String(firstPage[0].time.updated));

      const second = await fetch(
        `${url}/api/experimental/session?archived=false&roots=true&limit=1&cursor=${first.headers.get('x-next-cursor')}&${dirQ}`,
      );
      const secondPage = await second.json();
      expect(secondPage).toHaveLength(1);
      expect(secondPage[0].id).not.toBe(newest.id);
      expect(secondPage.map((item) => item.id)).not.toContain(child.id);
      expect(second.headers.get('x-next-cursor')).toBeTruthy();

      const inclusive = await (await fetch(`${url}/api/session?archived=true&${dirQ}`)).json();
      expect(inclusive.map((item) => item.id)).toContain(archivedLarge.id);
      expect(inclusive.map((item) => item.id)).toEqual(expect.arrayContaining([
        active.id,
        restored.id,
        moreArchived.id,
      ]));
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('lists default feature plugin slots without installing', async () => {
    const { url, close, kernel } = await startFacade();
    try {
      const response = await fetch(`${url}/api/pi/feature-plugins`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.slots.goal.source).toBe('npm:@narumitw/pi-goal');
      expect(body.slots.plan.source).toBe('npm:@narumitw/pi-plan-mode');
      expect(body.slots.mcp.source).toBe('npm:pi-mcp-adapter');
      expect(body.slots.subagents.source).toBe('npm:pi-subagents');
      expect(body.slots.goal.command).toBe('goal');
      expect(body.slots.plan.command).toBeUndefined();
      expect(body.slots.goal.installed).toBe(false);
      expect(body.slots.plan.installed).toBe(false);
      expect(body.slots.goal.enabled).toBe(false);
      const home = kernel.host.getPath().home;
      expect(fs.existsSync(path.join(home, '.pi', 'agent', 'settings.json'))).toBe(false);
      expect(fs.existsSync(path.join(home, '.pi', 'agent', 'pichamber.json'))).toBe(false);
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('persists feature plugin enable flags and installs through settings.json packages', async () => {
    const idle = createInMemoryPiSession();
    const { url, close, kernel } = await startFacade({
      createSession: async () => idle,
    });
    try {
      const created = await kernel.host.createSession({ directory: '/tmp/project', title: 'Idle' });
      expect(created.id).toBeTruthy();

      const patched = await fetch(`${url}/api/pi/feature-plugins`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          goal: { enabled: true, command: 'goal' },
          plan: { source: 'npm:@narumitw/pi-plan-mode', enabled: true },
        }),
      });
      expect(patched.status).toBe(200);
      const patchedBody = await patched.json();
      expect(patchedBody.slots.goal.enabled).toBe(true);
      expect(patchedBody.slots.plan.enabled).toBe(true);
      expect(patchedBody.slots.goal.installed).toBe(false);

      const installed = await fetch(`${url}/api/pi/feature-plugins/goal/install`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(installed.status).toBe(200);
      const installedBody = await installed.json();
      expect(installedBody.slots.goal.installed).toBe(true);
      expect(installedBody.reload.reloaded).toContain(created.id);
      expect(idle.reloadCount).toBe(1);

      idle.registerCommand('goal', async () => {}, { description: 'Goal' });
      const listed = await (await fetch(`${url}/api/command?session=${created.id}`)).json();
      expect(listed.some((command) => command.name === 'goal' && command.source === 'extension')).toBe(true);

      const home = kernel.host.getPath().home;
      const settings = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'settings.json'), 'utf8'));
      expect(settings.packages).toContain('npm:@narumitw/pi-goal');
      const chamber = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'pichamber.json'), 'utf8'));
      expect(chamber.featurePlugins.goal.enabled).toBe(true);

      const removed = await fetch(`${url}/api/pi/feature-plugins/goal/uninstall`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(removed.status).toBe(200);
      expect((await removed.json()).slots.goal.installed).toBe(false);
      const after = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'settings.json'), 'utf8'));
      expect(after.packages || []).not.toContain('npm:@narumitw/pi-goal');
      expect(idle.reloadCount).toBe(2);
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('reloads idle sessions when an installed Goal slot is enabled', async () => {
    const idle = createInMemoryPiSession();
    idle.registerCommand('goal', async () => {}, { description: 'Goal' });
    const { url, close, kernel } = await startFacade({
      createSession: async () => idle,
    });
    try {
      const created = await kernel.host.createSession({ directory: '/tmp/project', title: 'Empty' });
      const installed = await fetch(`${url}/api/pi/feature-plugins/goal/install`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(installed.status).toBe(200);
      expect(idle.reloadCount).toBe(1);

      const enabled = await fetch(`${url}/api/pi/feature-plugins`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goal: { enabled: true } }),
      });
      expect(enabled.status).toBe(200);
      const enabledBody = await enabled.json();
      expect(enabledBody.slots.goal.installed).toBe(true);
      expect(enabledBody.slots.goal.enabled).toBe(true);
      expect(enabledBody.reload.reloaded).toContain(created.id);
      expect(idle.reloadCount).toBe(2);

      const listed = await (await fetch(`${url}/api/command?session=${created.id}`)).json();
      expect(listed.some((command) => command.name === 'goal' && command.source === 'extension')).toBe(true);
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('recognizes an existing Pi agent without writing pichamber.json', async () => {
    const { url, close, kernel } = await startFacade();
    try {
      const home = kernel.host.getPath().home;
      const agent = path.join(home, '.pi', 'agent');
      fs.mkdirSync(agent, { recursive: true });
      fs.writeFileSync(path.join(agent, 'settings.json'), `${JSON.stringify({
        packages: ['npm:@narumitw/pi-goal', 'npm:pi-mcp-adapter', 'npm:pi-subagents'],
        defaultProvider: 'bmlab',
        defaultModel: 'grok-4.6',
        defaultThinkingLevel: 'high',
      }, null, 2)}\n`);
      fs.mkdirSync(path.join(agent, 'npm'), { recursive: true });
      fs.writeFileSync(path.join(agent, 'npm', 'package.json'), `${JSON.stringify({ name: 'pi-extensions' }, null, 2)}\n`);

      const plugins = await (await fetch(`${url}/api/pi/feature-plugins`)).json();
      expect(plugins.slots.goal).toMatchObject({ installed: true, enabled: true });
      expect(plugins.slots.mcp).toMatchObject({ installed: true, enabled: true });
      expect(plugins.slots.subagents).toMatchObject({ installed: true, enabled: true });
      expect(plugins.slots.plan).toMatchObject({ installed: false, enabled: false });

      const commands = await (await fetch(`${url}/api/command`)).json();
      expect(commands.some((command) => command.name === 'run' && command.source === 'extension')).toBe(true);
      expect(commands.some((command) => command.name === 'plan')).toBe(false);

      const defaults = await (await fetch(`${url}/api/pi/defaults`)).json();
      expect(defaults.model).toBe('bmlab/grok-4.6');
      expect(defaults.thinking).toBe('high');

      const extensions = await (await fetch(`${url}/api/pi/extensions`)).json();
      expect(extensions.packages.map((item) => item.name)).toEqual([
        '@narumitw/pi-goal',
        'pi-mcp-adapter',
        'pi-subagents',
      ]);
      expect(extensions.packages.some((item) => item.name === 'pi-extensions')).toBe(false);

      const agents = await (await fetch(`${url}/api/agent`)).json();
      expect(agents).toEqual([expect.objectContaining({ name: 'pi' })]);
      expect(fs.existsSync(path.join(agent, 'pichamber.json'))).toBe(false);
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('keeps builtin commands when GET /api/command pins a missing session', async () => {
    const { url, close, kernel } = await startFacade();
    try {
      const listed = await (await fetch(`${url}/api/command?session=ses_missing`)).json();
      expect(listed.some((command) => command.name === 'compact')).toBe(true);
      expect(listed.some((command) => command.name === 'goal')).toBe(false);
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('replies to Desktop ctx.ui over /api/pi/ui and leaves OpenCode /api/question empty', async () => {
    const { url, close, kernel } = await startFacade();
    try {
      const created = await (await fetch(`${url}/api/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Plan question' }),
      })).json();

      const ui = kernel.host.getExtensionUI(created.id);
      const select = ui.context.select('Scope: How wide?', [
        '1. One file — keep the change local',
        '2. Other (free-form)',
      ]);
      const listed = await (await fetch(`${url}/api/pi/ui?session=${created.id}`)).json();
      expect(listed).toHaveLength(1);
      expect(listed[0].kind).toBe('select');
      expect(await (await fetch(`${url}/api/question`)).json()).toEqual([]);

      const reply = await fetch(`${url}/api/pi/ui/${listed[0].id}/reply?session=${created.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: '2. Other (free-form)' }),
      });
      expect(reply.status).toBe(200);
      await expect(select).resolves.toBe('2. Other (free-form)');

      const editor = ui.context.editor('How wide?', '');
      const next = await (await fetch(`${url}/api/pi/ui?session=${created.id}`)).json();
      expect(next[0].kind).toBe('editor');
      const editorReply = await fetch(`${url}/api/pi/ui/${next[0].id}/reply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionID: created.id, value: 'Only the host module' }),
      });
      expect(editorReply.status).toBe(200);
      await expect(editor).resolves.toBe('Only the host module');

      ui.context.notify('Plan mode enabled.', 'info');

      const cancelPrompt = ui.context.confirm('Replace goal?', 'Replace it?');
      const pending = await (await fetch(`${url}/api/pi/ui?session=${created.id}`)).json();
      const cancelled = await fetch(`${url}/api/pi/ui/${pending[0].id}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionID: created.id }),
      });
      expect(cancelled.status).toBe(200);
      await expect(cancelPrompt).resolves.toBe(false);
      expect(await (await fetch(`${url}/api/question`)).json()).toEqual([]);
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('does not reveal leftover MCP files while the adapter slot is off', async () => {
    const { url, close, kernel } = await startFacade();
    try {
      const home = kernel.host.getPath().home;
      const cwd = kernel.host.getPath().directory;
      fs.mkdirSync(path.join(home, '.config', 'mcp'), { recursive: true });
      fs.writeFileSync(path.join(home, '.config', 'mcp', 'mcp.json'), JSON.stringify({
        mcpServers: { leftover: { command: 'npx', args: ['-y', 'demo'] } },
      }));
      fs.mkdirSync(cwd, { recursive: true });
      fs.writeFileSync(path.join(cwd, '.mcp.json'), JSON.stringify({
        mcpServers: { project: { command: 'uvx', args: ['demo'] } },
      }));

      const status = await fetch(`${url}/api/mcp`);
      expect(status.status).toBe(200);
      expect(await status.json()).toEqual({});

      const listed = await fetch(`${url}/api/config/mcp`);
      expect(listed.status).toBe(404);
      const listedBody = await listed.json();
      expect(listedBody.unavailable).toBe(true);

      const named = await fetch(`${url}/api/config/mcp/leftover`);
      expect(named.status).toBe(404);
      expect((await named.json()).unavailable).toBe(true);

      const created = await fetch(`${url}/api/config/mcp/leftover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'user', type: 'local', command: ['npx'] }),
      });
      expect(created.status).toBe(404);
      expect(fs.existsSync(path.join(cwd, '.opencode', 'opencode.json'))).toBe(false);
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('exposes session plan status and dispatches plan actions', async () => {
    const { url, close, kernel } = await startFacade();
    try {
      const created = await (await fetch(`${url}/api/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Plan chrome' }),
      })).json();

      const missing = await fetch(`${url}/api/pi/session/ses_missing/plan`);
      expect(missing.status).toBe(404);

      const off = await (await fetch(`${url}/api/pi/session/${created.id}/plan`)).json();
      expect(off).toEqual({ status: 'off', planMarkdown: '' });

      const started = await fetch(`${url}/api/pi/session/${created.id}/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      expect(started.status).toBe(200);
      expect(await started.json()).toEqual({ status: 'active', planMarkdown: '' });

      kernel.host.getSession(created.id).piSession.setPlanModeState({
        enabled: true,
        latestPlan: '# Build the rail\n\nUse live state.',
        awaitingAction: true,
      });
      const ready = await (await fetch(`${url}/api/pi/session/${created.id}/plan`)).json();
      expect(ready).toMatchObject({
        status: 'ready',
        planMarkdown: '# Build the rail\n\nUse live state.',
        title: 'Build the rail',
      });

      const saved = await (await fetch(`${url}/api/pi/session/${created.id}/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'save' }),
      })).json();
      expect(saved.status).toBe('saved');

      const resumed = await (await fetch(`${url}/api/pi/session/${created.id}/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'resume' }),
      })).json();
      expect(resumed.status).toBe('ready');

      const built = await (await fetch(`${url}/api/pi/session/${created.id}/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'implement' }),
      })).json();
      expect(built.status).toBe('implementing');

      const discarded = await (await fetch(`${url}/api/pi/session/${created.id}/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'exit' }),
      })).json();
      expect(discarded).toEqual({ status: 'off', planMarkdown: '' });
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('keeps /plan start toast-only and queues a select for bare /plan', async () => {
    const { url, close, kernel } = await startFacade();
    try {
      const created = await (await fetch(`${url}/api/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Plan menus' }),
      })).json();

      const started = await fetch(`${url}/api/session/${created.id}/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: 'plan', arguments: 'start' }),
      });
      expect(started.status).toBe(200);
      expect(await (await fetch(`${url}/api/pi/ui?session=${created.id}`)).json()).toEqual([]);
      expect(await (await fetch(`${url}/api/question`)).json()).toEqual([]);

      const chromeStart = await fetch(`${url}/api/pi/session/${created.id}/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      expect(chromeStart.status).toBe(200);
      expect(await (await fetch(`${url}/api/pi/ui?session=${created.id}`)).json()).toEqual([]);

      const launch = fetch(`${url}/api/session/${created.id}/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: 'plan', arguments: '' }),
      });
      const listed = await waitForPiUi(url, created.id);
      expect(listed[0]).toMatchObject({
        kind: 'select',
        title: 'Plan mode\nStatus: Off…',
        options: [
          'Start Plan mode',
          'Choose tools, then start…',
          'Settings',
          'How Plan mode works',
        ],
      });
      const reply = await fetch(`${url}/api/pi/ui/${listed[0].id}/reply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionID: created.id, value: 'Start Plan mode' }),
      });
      expect(reply.status).toBe(200);
      expect((await launch).status).toBe(200);
      expect(await (await fetch(`${url}/api/pi/ui?session=${created.id}`)).json()).toEqual([]);

      const tools = fetch(`${url}/api/session/${created.id}/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: 'plan', arguments: 'tools' }),
      });
      const toolListed = await waitForPiUi(url, created.id);
      expect(toolListed[0]).toMatchObject({
        kind: 'select',
        title: 'Plan-mode tools',
        multiple: true,
      });
      expect(toolListed[0].options).toEqual(expect.arrayContaining([
        'bash',
        'find',
        'grep',
        'ls',
        'read',
        'Done — start Plan mode',
        'Back',
      ]));
      const toolsReply = await fetch(`${url}/api/pi/ui/${toolListed[0].id}/reply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionID: created.id, value: ['bash', 'read'] }),
      });
      expect(toolsReply.status).toBe(200);
      expect((await tools).status).toBe(200);
      expect(await (await fetch(`${url}/api/question`)).json()).toEqual([]);
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('writes adapter MCP files and reloads the session when the slot is on', async () => {
    const idle = createInMemoryPiSession();
    idle.registerCommand('mcp-auth', async () => {}, { description: 'Authorize MCP' });
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-mcp-project-'));
    tempHomes.push(projectDir);
    const { url, close, kernel } = await startFacade({
      directory: projectDir,
      createSession: async () => idle,
    });
    try {
      const home = kernel.host.getPath().home;
      fs.mkdirSync(path.join(home, '.pi', 'agent'), { recursive: true });
      fs.writeFileSync(path.join(home, '.pi', 'agent', 'settings.json'), JSON.stringify({
        packages: ['npm:pi-mcp-adapter'],
      }));
      fs.writeFileSync(path.join(home, '.pi', 'agent', 'pichamber.json'), JSON.stringify({
        featurePlugins: { mcp: { source: 'npm:pi-mcp-adapter', enabled: true } },
      }));
      const createdSession = await kernel.host.createSession({ directory: projectDir, title: 'Idle' });

      const created = await fetch(`${url}/api/config/mcp/docs?directory=${encodeURIComponent(projectDir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'user',
          type: 'local',
          command: ['npx', '-y', 'docs-mcp'],
          enabled: true,
        }),
      });
      expect(created.status).toBe(200);
      const createdBody = await created.json();
      expect(createdBody.reloaded).toBe(true);
      expect(createdBody.reload?.reloaded || createdBody.reloaded).toBeTruthy();
      expect(idle.reloadCount).toBeGreaterThan(0);
      const userFile = JSON.parse(fs.readFileSync(path.join(home, '.config', 'mcp', 'mcp.json'), 'utf8'));
      expect(userFile.mcpServers.docs.command).toBe('npx');
      expect(fs.existsSync(path.join(projectDir, '.opencode', 'opencode.json'))).toBe(false);

      const project = await fetch(`${url}/api/config/mcp/repo?directory=${encodeURIComponent(projectDir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'project',
          type: 'local',
          command: ['uvx', 'repo-mcp'],
          enabled: true,
        }),
      });
      expect(project.status).toBe(200);
      const projectFile = JSON.parse(fs.readFileSync(path.join(projectDir, '.mcp.json'), 'utf8'));
      expect(projectFile.mcpServers.repo.command).toBe('uvx');

      const disabled = await fetch(`${url}/api/mcp/docs/disconnect?directory=${encodeURIComponent(projectDir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(disabled.status).toBe(200);
      const override = JSON.parse(fs.readFileSync(path.join(projectDir, '.pi', 'mcp.json'), 'utf8'));
      expect(override.mcpServers.docs).toEqual({ disabled: true });
      expect(JSON.parse(fs.readFileSync(path.join(home, '.config', 'mcp', 'mcp.json'), 'utf8')).mcpServers.docs.disabled).toBeUndefined();

      idle.events.emit('pi-mcp-adapter/status/v1', {
        version: 1,
        servers: [
          { name: 'docs', status: 'disabled', toolCount: 0, disabled: true },
          { name: 'repo', status: 'cached', toolCount: 2, disabled: false },
        ],
        totalTools: 2,
        totalResources: 0,
        connectedCount: 0,
        disabledCount: 1,
      });
      const status = await (await fetch(`${url}/api/mcp?directory=${encodeURIComponent(projectDir)}`)).json();
      expect(status.docs.status).toBe('disabled');
      expect(status.repo.status).toBe('cached');

      const auth = await fetch(`${url}/api/mcp/repo/auth/authenticate?directory=${encodeURIComponent(projectDir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(auth.status).toBe(200);
      expect((await auth.json()).nativeFlow).toBe(true);
      expect(createdSession.id).toBeTruthy();
    } finally {
      kernel.dispose();
      await close();
    }
  });

  it('rejects bare /goal on the command channel', async () => {
    const { url, close, kernel } = await startFacade();
    try {
      const created = await kernel.host.createSession({ directory: '/tmp/project', title: 'Goal' });
      const response = await fetch(`${url}/api/session/${created.id}/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: 'goal', arguments: '' }),
      });
      expect(response.status).toBe(400);
      expect(kernel.host.getMessages(created.id)).toEqual([]);
    } finally {
      kernel.dispose();
      await close();
    }
  });
});
