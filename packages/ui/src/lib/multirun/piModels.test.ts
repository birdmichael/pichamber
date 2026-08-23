import { describe, expect, test } from 'bun:test';
import {
  isPiEnabledModelRowChecked,
  listPiEnabledModelRows,
  loadPiRuntimeModels,
  nextPiEnabledModels,
  toPiRuntimeModelProviders,
} from './piModels';

describe('toPiRuntimeModelProviders', () => {
  test('maps a live Pi catalog without inventing providers', () => {
    expect(toPiRuntimeModelProviders({
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4-5': { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
          },
        },
      ],
    })).toEqual([
      {
        id: 'anthropic',
        name: 'Anthropic',
        models: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }],
      },
    ]);
  });

  test('filters to enabled Pi models and drops empty providers', () => {
    expect(toPiRuntimeModelProviders({
      providers: [
        {
          id: 'anthropic',
          models: {
            sonnet: { id: 'sonnet', name: 'Sonnet' },
            opus: { id: 'opus', name: 'Opus' },
          },
        },
        {
          id: 'openai',
          models: { gpt: { id: 'gpt', name: 'GPT' } },
        },
      ],
    }, ['anthropic/sonnet'])).toEqual([
      {
        id: 'anthropic',
        name: 'anthropic',
        models: [{ id: 'sonnet', name: 'Sonnet' }],
      },
    ]);
  });

  test('does not invent providers from missing or malformed catalogs', () => {
    expect(toPiRuntimeModelProviders(null)).toEqual([]);
    expect(toPiRuntimeModelProviders({})).toEqual([]);
    expect(toPiRuntimeModelProviders({ providers: [{ name: 'orphan' }] })).toEqual([]);
  });

  test('dedupes a display-name key and an id key for the same model', () => {
    expect(toPiRuntimeModelProviders({
      providers: [{
        id: 'live-provider',
        name: 'Live',
        models: {
          'Example Model': { id: 'example-model', name: 'Example Model' },
          'example-model': { id: 'example-model' },
        },
      }],
    })).toEqual([{
      id: 'live-provider',
      name: 'Live',
      models: [{ id: 'example-model', name: 'Example Model' }],
    }]);
  });
});

describe('listPiEnabledModelRows', () => {
  test('lists one row when the catalog keys the same model by display name and id', () => {
    expect(listPiEnabledModelRows({
      providers: [{
        id: 'live-provider',
        models: {
          'Example Model': { id: 'example-model', name: 'Example Model' },
          'example-model': { id: 'example-model' },
        },
      }],
    })).toEqual([{
      key: 'live-provider/example-model',
      label: 'Example Model',
      providerId: 'live-provider',
      modelId: 'example-model',
      aliases: ['Example Model', 'example-model', 'live-provider/Example Model'],
    }]);
  });

  test('collapses a display-name id onto the real model id and keeps the display name', () => {
    const rows = listPiEnabledModelRows({
      providers: [{
        id: 'live-provider',
        models: {
          'example-model': { id: 'example-model', name: 'Example Model' },
          'Example Model': { id: 'Example Model', name: 'Example Model' },
        },
      }],
    });
    expect(rows).toEqual([{
      key: 'live-provider/example-model',
      label: 'Example Model',
      providerId: 'live-provider',
      modelId: 'example-model',
      aliases: ['Example Model', 'example-model', 'live-provider/Example Model'],
    }]);
  });

  test('keeps two real models that only look similar', () => {
    expect(listPiEnabledModelRows({
      providers: [{
        id: 'live-provider',
        models: {
          alpha: { id: 'alpha', name: 'Alpha' },
          'alpha-fast': { id: 'alpha-fast', name: 'Alpha Fast' },
        },
      }],
    })).toEqual([
      {
        key: 'live-provider/alpha',
        label: 'Alpha',
        providerId: 'live-provider',
        modelId: 'alpha',
        aliases: ['alpha'],
      },
      {
        key: 'live-provider/alpha-fast',
        label: 'Alpha Fast',
        providerId: 'live-provider',
        modelId: 'alpha-fast',
        aliases: ['alpha-fast'],
      },
    ]);
  });

  test('does not merge models just because one id matches another display name with a distinct identity', () => {
    expect(listPiEnabledModelRows({
      providers: [{
        id: 'live-provider',
        models: {
          flash: { id: 'flash', name: 'Gemini' },
          Gemini: { id: 'Gemini', name: 'Gemini 2.5' },
        },
      }],
    })).toHaveLength(2);
  });

  test('treats a stored display-name key as the same enabled model', () => {
    const [row] = listPiEnabledModelRows({
      providers: [{
        id: 'live-provider',
        models: {
          'Example Model': { id: 'example-model', name: 'Example Model' },
          'example-model': { id: 'example-model' },
        },
      }],
    });
    expect(isPiEnabledModelRowChecked(row, ['live-provider/Example Model'])).toBe(true);
    expect(nextPiEnabledModels([row], ['live-provider/Example Model'], row, false)).toEqual([]);
    expect(nextPiEnabledModels([row], [], row, false)).toEqual([]);
  });

  test('toggling one of two models persists the other canonical key', () => {
    const rows = listPiEnabledModelRows({
      providers: [{
        id: 'live-provider',
        models: {
          alpha: { id: 'alpha', name: 'Alpha' },
          beta: { id: 'beta', name: 'Beta' },
        },
      }],
    });
    expect(nextPiEnabledModels(rows, [], rows[0], false)).toEqual(['live-provider/beta']);
    expect(nextPiEnabledModels(rows, ['live-provider/beta'], rows[0], true)).toEqual([]);
  });
});

describe('loadPiRuntimeModels', () => {
  test('loads GET /api/pi/models and applies enabledModels from defaults', async () => {
    const result = await loadPiRuntimeModels(async (path) => {
      if (path === '/api/pi/models') {
        return new Response(JSON.stringify({
          providers: [{
            id: 'pi-live',
            name: 'Pi Live',
            models: {
              alpha: { id: 'alpha', name: 'Alpha' },
              beta: { id: 'beta', name: 'Beta' },
            },
          }],
        }), { status: 200 });
      }
      if (path === '/api/pi/defaults') {
        return new Response(JSON.stringify({ enabledModels: ['pi-live/beta'] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    expect(result).toEqual({
      ok: true,
      enabledModels: ['pi-live/beta'],
      providers: [{
        id: 'pi-live',
        name: 'Pi Live',
        models: [{ id: 'beta', name: 'Beta' }],
      }],
    });
  });

  test('treats catalog fetch failure as failure, not empty success', async () => {
    const result = await loadPiRuntimeModels(async () => new Response('nope', { status: 500 }));
    expect(result).toEqual({ ok: false });
  });
});
