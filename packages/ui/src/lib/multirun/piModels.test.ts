import { describe, expect, test } from 'bun:test';
import { loadPiRuntimeModels, toPiRuntimeModelProviders } from './piModels';

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
