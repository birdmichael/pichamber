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

const startFacade = async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-facade-home-'));
  tempHomes.push(home);
  const kernel = createPiKernel({
    mock: true,
    defaultDirectory: '/tmp/project',
    home,
  });
  const app = express();
  app.use(express.json());
  registerPiFacade(app, { host: kernel.host, bus: kernel.bus, defaultDirectory: '/tmp/project' });
  const http = await listen(app);
  return { kernel, ...http };
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
      const sdkCommands = await (await fetch(`${url}/command`)).json();
      expect(sdkCommands.some((command) => command.name === 'compact')).toBe(true);

      const skills = await (await fetch(`${url}/api/config/skills`)).json();
      expect(Array.isArray(skills.skills)).toBe(true);
      const sdkSkills = await (await fetch(`${url}/skill`)).json();
      expect(Array.isArray(sdkSkills)).toBe(true);

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
});
