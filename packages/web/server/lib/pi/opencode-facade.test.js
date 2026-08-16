import express from 'express';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createPiKernel } from './index.js';
import { registerPiFacade } from './opencode-facade.js';

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

const startFacade = async ({ directory = '/tmp/project' } = {}) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-facade-home-'));
  tempHomes.push(home);
  const previousDataDir = process.env.OPENCHAMBER_DATA_DIR;
  process.env.OPENCHAMBER_DATA_DIR = home;
  const kernel = createPiKernel({
    mock: true,
    defaultDirectory: directory,
    home,
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

describe('OpenCode facade HTTP/SSE', () => {
  it('bootstraps path/providers/session and streams a mock prompt', async () => {
    const { url, close, kernel } = await startFacade();
    try {
      const pathRes = await fetch(`${url}/api/path`);
      const pathBody = await pathRes.json();
      expect(pathRes.status).toBe(200);
      expect(pathBody.directory).toBe('/tmp/project');
      expect(pathBody.config).toContain('.pi/agent');

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

  it('runs /reload as a Pi command and persists thinking defaults', async () => {
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
      expect(command.status).toBe(200);
      const body = await command.json();
      expect(body.info.role).toBe('assistant');
      expect(body.parts[0].text).toMatch(/Reloaded Pi/);
      expect(reloads).toBe(1);

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
});
