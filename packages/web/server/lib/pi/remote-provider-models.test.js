import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildRemoteModelListUrls,
  fetchRemoteProviderModels,
  parseRemoteModelsPayload,
} from './remote-provider-models.js';

const tempDirs = [];

const makeTemp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-remote-models-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const jsonResponse = (status, body, contentType = 'application/json') => ({
  ok: status >= 200 && status < 300,
  status,
  headers: {
    get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null),
  },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

describe('remote-provider-models', () => {
  it('builds CC Switch-style candidates, including Anthropic-compat suffix stripping', () => {
    expect(buildRemoteModelListUrls('https://ai.example.test/v1/')).toEqual([
      'https://ai.example.test/v1/models',
    ]);
    expect(buildRemoteModelListUrls('https://ai.example.test')).toEqual([
      'https://ai.example.test/v1/models',
    ]);
    expect(buildRemoteModelListUrls('https://open.bigmodel.cn/api/coding/paas/v4')).toEqual([
      'https://open.bigmodel.cn/api/coding/paas/v4/models',
      'https://open.bigmodel.cn/api/coding/paas/v4/v1/models',
    ]);
    expect(buildRemoteModelListUrls('https://api.deepseek.com/anthropic')).toEqual([
      'https://api.deepseek.com/anthropic/v1/models',
      'https://api.deepseek.com/v1/models',
      'https://api.deepseek.com/models',
    ]);
    expect(buildRemoteModelListUrls('https://api.z.ai/api/anthropic')).toEqual([
      'https://api.z.ai/api/anthropic/v1/models',
      'https://api.z.ai/v1/models',
      'https://api.z.ai/models',
    ]);
  });

  it('parses OpenAI data arrays and skips blank or duplicate ids', () => {
    expect(parseRemoteModelsPayload({
      data: [
        { id: 'grok-4.6', name: 'Grok 4.6' },
        { id: 'grok-4.6' },
        { id: '  ' },
        'plain-id',
      ],
    })).toEqual([
      { id: 'grok-4.6', name: 'Grok 4.6' },
      { id: 'plain-id', name: 'plain-id' },
    ]);
  });

  it('fetches models with a bearer key and never returns the key', async () => {
    const calls = [];
    const result = await fetchRemoteProviderModels({
      baseURL: 'https://ai.example.test/v1',
      apiKey: 'sk-test-do-not-leak',
    }, {
      fetchImpl: async (url, init) => {
        calls.push({ url, auth: init.headers.Authorization });
        return jsonResponse(200, { data: [{ id: 'grok-4.6', name: 'Grok 4.6' }] });
      },
    });

    expect(calls).toEqual([{
      url: 'https://ai.example.test/v1/models',
      auth: 'Bearer sk-test-do-not-leak',
    }]);
    expect(result).toEqual({ models: [{ id: 'grok-4.6', name: 'Grok 4.6' }] });
    expect(JSON.stringify(result)).not.toContain('sk-test');
  });

  it('uses a stored Pi key only when the form URL matches the saved provider origin', async () => {
    const home = makeTemp();
    fs.mkdirSync(path.join(home, '.pi', 'agent'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.pi', 'agent', 'auth.json'),
      JSON.stringify({ grok: { type: 'api_key', key: 'sk-stored-do-not-leak' } }),
    );
    fs.writeFileSync(
      path.join(home, '.pi', 'agent', 'models.json'),
      JSON.stringify({
        providers: { grok: { name: 'Grok', baseUrl: 'https://ai.example.test/v1' } },
      }),
    );
    const result = await fetchRemoteProviderModels({
      home,
      baseURL: 'https://ai.example.test/v1',
      providerID: 'grok',
    }, {
      fetchImpl: async (_url, init) => {
        expect(init.redirect).toBe('manual');
        expect(init.headers.Authorization).toBe('Bearer sk-stored-do-not-leak');
        return jsonResponse(200, { data: [{ id: 'grok-4.6' }] });
      },
    });
    expect(result.models).toEqual([{ id: 'grok-4.6', name: 'grok-4.6' }]);
    expect(JSON.stringify(result)).not.toContain('sk-stored');

    const calls = [];
    await expect(fetchRemoteProviderModels({
      home,
      baseURL: 'https://evil.example.test/v1',
      providerID: 'grok',
    }, {
      fetchImpl: async (url) => {
        calls.push(url);
        return jsonResponse(200, { data: [{ id: 'stolen' }] });
      },
    })).rejects.toMatchObject({ status: 400, code: 'invalid' });
    expect(calls).toEqual([]);
  });

  it('resolves {env:VAR} and fails closed when the variable is missing', async () => {
    const result = await fetchRemoteProviderModels({
      baseURL: 'https://ai.example.test/v1',
      apiKey: '{env:EXAMPLE_PROVIDER_KEY}',
      env: { EXAMPLE_PROVIDER_KEY: 'sk-env-do-not-leak' },
    }, {
      fetchImpl: async (_url, init) => {
        expect(init.headers.Authorization).toBe('Bearer sk-env-do-not-leak');
        return jsonResponse(200, { data: [{ id: 'grok-4.6' }] });
      },
    });
    expect(result.models[0].id).toBe('grok-4.6');

    await expect(fetchRemoteProviderModels({
      baseURL: 'https://ai.example.test/v1',
      apiKey: '{env:MISSING_PROVIDER_KEY}',
      env: {},
    })).rejects.toMatchObject({ status: 400, code: 'invalid' });
  });

  it('fails distinctly for rejected keys, missing lists, and empty success', async () => {
    await expect(fetchRemoteProviderModels({
      baseURL: 'https://ai.example.test/v1',
      apiKey: 'sk-bad',
    }, {
      fetchImpl: async () => jsonResponse(401, { error: { message: 'unauthorized' } }),
    })).rejects.toMatchObject({ status: 401, code: 'unauthorized' });

    await expect(fetchRemoteProviderModels({
      baseURL: 'https://ai.example.test',
      apiKey: 'sk-ok',
    }, {
      fetchImpl: async () => jsonResponse(404, 'not found', 'text/plain'),
    })).rejects.toMatchObject({ status: 404, code: 'unsupported' });

    const empty = await fetchRemoteProviderModels({
      baseURL: 'https://ai.example.test/v1',
      apiKey: 'sk-ok',
    }, {
      fetchImpl: async () => jsonResponse(200, { data: [] }),
    });
    expect(empty).toEqual({ models: [] });
  });

  it('tries the next candidate when the first response is HTML', async () => {
    const urls = [];
    const result = await fetchRemoteProviderModels({
      baseURL: 'https://ai.example.test/anthropic',
      apiKey: 'sk-ok',
    }, {
      fetchImpl: async (url) => {
        urls.push(url);
        if (url === 'https://ai.example.test/v1/models') {
          return jsonResponse(200, { data: [{ id: 'grok-4.6' }] });
        }
        return jsonResponse(200, '<!doctype html>', 'text/html');
      },
    });
    expect(urls[0]).toBe('https://ai.example.test/anthropic/v1/models');
    expect(urls).toContain('https://ai.example.test/v1/models');
    expect(result.models[0].id).toBe('grok-4.6');
  });

  it('blocks metadata hosts and does not send a stored key there', async () => {
    const calls = [];
    await expect(fetchRemoteProviderModels({
      baseURL: 'http://169.254.169.254/v1',
      apiKey: 'sk-ok',
    }, {
      fetchImpl: async (url) => {
        calls.push(url);
        return jsonResponse(200, { data: [{ id: 'nope' }] });
      },
    })).rejects.toMatchObject({ status: 400, code: 'invalid' });
    expect(calls).toEqual([]);
  });

  it('allows localhost when the user supplied a key', async () => {
    const result = await fetchRemoteProviderModels({
      baseURL: 'http://127.0.0.1:11434/v1',
      apiKey: 'sk-local',
    }, {
      fetchImpl: async (url, init) => {
        expect(url).toBe('http://127.0.0.1:11434/v1/models');
        expect(init.headers.Authorization).toBe('Bearer sk-local');
        expect(init.headers.Cookie).toBeUndefined();
        return jsonResponse(200, { data: [{ id: 'llama3' }] });
      },
    });
    expect(result.models[0].id).toBe('llama3');
  });

  it('strips Cookie and Host from extra headers and keeps Authorization last', async () => {
    const result = await fetchRemoteProviderModels({
      baseURL: 'https://ai.example.test/v1',
      apiKey: 'sk-form',
      headers: {
        Cookie: 'session=1',
        Host: 'evil.example.test',
        Authorization: 'Bearer other',
        'X-Test': '1',
      },
    }, {
      fetchImpl: async (_url, init) => {
        expect(init.headers.Cookie).toBeUndefined();
        expect(init.headers.Host).toBeUndefined();
        expect(init.headers.Authorization).toBe('Bearer sk-form');
        expect(init.headers['X-Test']).toBe('1');
        return jsonResponse(200, { data: [{ id: 'grok-4.6' }] });
      },
    });
    expect(result.models[0].id).toBe('grok-4.6');
  });

  it('fails fast on a JSON 401 and keeps trying after a non-JSON 401', async () => {
    await expect(fetchRemoteProviderModels({
      baseURL: 'https://ai.example.test/anthropic',
      apiKey: 'sk-bad',
    }, {
      fetchImpl: async () => jsonResponse(401, { error: { message: 'unauthorized' } }),
    })).rejects.toMatchObject({ status: 401, code: 'unauthorized' });

    const urls = [];
    const result = await fetchRemoteProviderModels({
      baseURL: 'https://ai.example.test/anthropic',
      apiKey: 'sk-ok',
    }, {
      fetchImpl: async (url) => {
        urls.push(url);
        if (url === 'https://ai.example.test/v1/models') {
          return jsonResponse(200, { data: [{ id: 'grok-4.6' }] });
        }
        return jsonResponse(401, '<html>login</html>', 'text/html');
      },
    });
    expect(urls[0]).toBe('https://ai.example.test/anthropic/v1/models');
    expect(result.models[0].id).toBe('grok-4.6');
  });
});
