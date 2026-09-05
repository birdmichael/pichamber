import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildRemoteModelListUrls,
  fetchRemoteProviderModels,
  mergeRemoteModelsIntoCatalog,
  parseRemoteModelsPayload,
  syncCustomProviderRemoteModels,
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

  it('keeps a provider-reported context and ignores non-positive values', () => {
    expect(parseRemoteModelsPayload({
      data: [
        { id: 'gpt-4o', name: 'GPT-4o', context_length: 64000 },
        { id: 'local-llm', max_model_len: '8192' },
        { id: 'other', context_window: 256000 },
        { id: 'zeroed', context_length: 0 },
      ],
    })).toEqual([
      { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 64000 },
      { id: 'local-llm', name: 'local-llm', contextWindow: 8192 },
      { id: 'other', name: 'other', contextWindow: 256000 },
      { id: 'zeroed', name: 'zeroed' },
    ]);
  });

  it('keeps a provider-reported input and ignores invalid values', () => {
    expect(parseRemoteModelsPayload({
      data: [
        { id: 'grok-4.6', name: 'Grok 4.6', input: ['text', 'image'] },
        { id: 'local-llm', input: ['TEXT', 'image', 'audio'] },
        { id: 'empty', input: [] },
        { id: 'plain' },
        {
          id: 'openrouter-vision',
          architecture: { input_modalities: ['text', 'image'] },
          supported_parameters: ['reasoning'],
        },
      ],
    })).toEqual([
      { id: 'grok-4.6', name: 'Grok 4.6', input: ['text', 'image'] },
      { id: 'local-llm', name: 'local-llm', input: ['text', 'image'] },
      { id: 'empty', name: 'empty' },
      { id: 'plain', name: 'plain' },
      { id: 'openrouter-vision', name: 'openrouter-vision', input: ['text', 'image'], reasoning: true },
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

  it('merges remote catalog without overwriting local overrides or deleting local-only ids', () => {
    const merged = mergeRemoteModelsIntoCatalog(
      [
        { id: 'local-only', name: 'Local', contextWindow: 8_000, compat: { thinking: true } },
        { id: 'shared', name: 'User Name', contextWindow: 32_000, input: ['text'], reasoning: true },
      ],
      [
        { id: 'shared', name: 'Upstream Name', contextWindow: 64_000, input: ['text', 'image'] },
        { id: 'new-remote', name: 'New Remote', contextWindow: 16_000 },
      ],
    );
    expect(merged.added).toBe(1);
    expect(merged.changed).toBe(true);
    expect(merged.models).toEqual([
      { id: 'local-only', name: 'Local', contextWindow: 8_000, compat: { thinking: true } },
      { id: 'shared', name: 'User Name', contextWindow: 32_000, input: ['text'], reasoning: true },
      { id: 'new-remote', name: 'New Remote', contextWindow: 16_000 },
    ]);
  });

  it('keeps the previous catalog when the remote list is empty', () => {
    const local = [{ id: 'kept', name: 'Kept' }];
    expect(mergeRemoteModelsIntoCatalog(local, [])).toEqual({
      models: local,
      added: 0,
      changed: false,
    });
  });

  it('syncs upstream models into models.json and preserves hide-state fields on existing rows', async () => {
    const home = makeTemp();
    fs.mkdirSync(path.join(home, '.pi', 'agent'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.pi', 'agent', 'auth.json'),
      JSON.stringify({ relay: { type: 'api_key', key: 'sk-sync-do-not-leak' } }),
    );
    fs.writeFileSync(
      path.join(home, '.pi', 'agent', 'models.json'),
      JSON.stringify({
        providers: {
          relay: {
            name: 'Relay',
            baseUrl: 'https://ai.example.test/v1',
            api: 'anthropic-messages',
            models: [
              { id: 'claude-opus-5', name: 'Opus Override', contextWindow: 200_000 },
            ],
          },
        },
      }),
    );

    const result = await syncCustomProviderRemoteModels({
      home,
      providerId: 'relay',
      scope: 'user',
    }, {
      fetchImpl: async (url, init) => {
        expect(url).toBe('https://ai.example.test/v1/models');
        expect(init.headers.Authorization).toBe('Bearer sk-sync-do-not-leak');
        return jsonResponse(200, {
          data: [
            { id: 'claude-opus-5', name: 'Upstream Opus' },
            { id: 'gpt-junk', name: 'GPT Junk' },
            { id: 'grok-extra', name: 'Grok Extra' },
          ],
        });
      },
    });

    expect(result.synced).toBe(true);
    expect(result.added).toBe(2);
    expect(JSON.stringify(result)).not.toContain('sk-sync');
    const stored = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'models.json'), 'utf8'));
    expect(stored.providers.relay.models).toEqual([
      { id: 'claude-opus-5', name: 'Opus Override', contextWindow: 200_000 },
      { id: 'gpt-junk', name: 'GPT Junk' },
      { id: 'grok-extra', name: 'Grok Extra' },
    ]);
  });

  it('skips builtin provider ids and leaves models.json untouched on fetch failure', async () => {
    const home = makeTemp();
    fs.mkdirSync(path.join(home, '.pi', 'agent'), { recursive: true });
    const modelsPath = path.join(home, '.pi', 'agent', 'models.json');
    const before = {
      providers: {
        relay: {
          name: 'Relay',
          baseUrl: 'https://ai.example.test/v1',
          models: [{ id: 'only-local', name: 'Only Local' }],
        },
      },
    };
    fs.writeFileSync(modelsPath, JSON.stringify(before));
    fs.writeFileSync(
      path.join(home, '.pi', 'agent', 'auth.json'),
      JSON.stringify({ relay: { type: 'api_key', key: 'sk-bad' } }),
    );

    const skipped = await syncCustomProviderRemoteModels({
      home,
      providerId: 'xai',
      scope: 'user',
    });
    expect(skipped).toMatchObject({ synced: false, skipped: true, reason: 'builtin' });

    await expect(syncCustomProviderRemoteModels({
      home,
      providerId: 'relay',
      scope: 'user',
    }, {
      fetchImpl: async () => jsonResponse(401, { error: { message: 'unauthorized' } }),
    })).rejects.toMatchObject({ status: 401, code: 'unauthorized' });

    expect(JSON.parse(fs.readFileSync(modelsPath, 'utf8'))).toEqual(before);
  });

  it('does not wipe local models when upstream returns an empty list', async () => {
    const home = makeTemp();
    fs.mkdirSync(path.join(home, '.pi', 'agent'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.pi', 'agent', 'auth.json'),
      JSON.stringify({ relay: { type: 'api_key', key: 'sk-ok' } }),
    );
    fs.writeFileSync(
      path.join(home, '.pi', 'agent', 'models.json'),
      JSON.stringify({
        providers: {
          relay: {
            name: 'Relay',
            baseUrl: 'https://ai.example.test/v1',
            models: [{ id: 'kept', name: 'Kept' }],
          },
        },
      }),
    );
    const result = await syncCustomProviderRemoteModels({
      home,
      providerId: 'relay',
      scope: 'user',
    }, {
      fetchImpl: async () => jsonResponse(200, { data: [] }),
    });
    expect(result).toMatchObject({ synced: false, reason: 'empty' });
    expect(result.models).toEqual([{ id: 'kept', name: 'Kept' }]);
    const stored = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'models.json'), 'utf8'));
    expect(stored.providers.relay.models).toEqual([{ id: 'kept', name: 'Kept' }]);
  });


  it('syncs an env-backed custom provider using models.json $VAR without auth.json', async () => {
    const home = makeTemp();
    fs.mkdirSync(path.join(home, '.pi', 'agent'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.pi', 'agent', 'models.json'),
      JSON.stringify({
        providers: {
          relay: {
            name: 'Relay',
            baseUrl: 'https://ai.example.test/v1',
            apiKey: '$RELAY_KEY',
            models: [{ id: 'seed', name: 'Seed' }],
          },
        },
      }),
    );
    const result = await syncCustomProviderRemoteModels({
      home,
      providerId: 'relay',
      scope: 'user',
      env: { RELAY_KEY: 'sk-env-sync-do-not-leak' },
    }, {
      fetchImpl: async (_url, init) => {
        expect(init.headers.Authorization).toBe('Bearer sk-env-sync-do-not-leak');
        return jsonResponse(200, { data: [{ id: 'seed' }, { id: 'extra' }] });
      },
    });
    expect(result.added).toBe(1);
    expect(JSON.stringify(result)).not.toContain('sk-env');
  });

});
