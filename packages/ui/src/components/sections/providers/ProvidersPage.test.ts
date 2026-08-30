import { describe, expect, test } from 'bun:test';
import {
  mergeAddCatalogProviders,
  parseConnectedProviderIds,
  providerHasConnectedModels,
  requiresProviderAuth,
  selectAddCatalogProviders,
  selectSidebarProviders,
  selectUnconnectedProviders,
  shouldAutoSelectBuiltinAddProvider,
  shouldAutoSelectCustomProvider,
  shouldLoadAvailableProviders,
} from './providerAvailability';
import {
  getOAuthAuthMethods,
  normalizeAuthType,
  parseAuthPayload,
  requiresOpenCodeRestartAfterOAuth,
  shouldShowApiKeyAuth,
} from './providerAuth';

describe('ProvidersPage available provider loading', () => {
  test('loads available providers only in add-provider mode', () => {
    expect(shouldLoadAvailableProviders(false)).toBe(false);
    expect(shouldLoadAvailableProviders(true)).toBe(true);
  });

  test('keeps xAI in Add when the live list already treated the stub as connected', () => {
    expect(providerHasConnectedModels({ models: {} })).toBe(false);
    expect(providerHasConnectedModels({ models: [] })).toBe(false);
    expect(providerHasConnectedModels({ models: [{ id: 'grok-4.6' }] })).toBe(true);
    expect(parseConnectedProviderIds({ all: [{ id: 'xai' }], connected: ['xai'], default: {} })).toEqual(['xai']);
    expect(parseConnectedProviderIds([{ id: 'xai' }])).toEqual([]);
    const catalog = mergeAddCatalogProviders([{ id: 'bmlab', name: 'bmlab' }]);
    expect(catalog.map((provider) => provider.id)).toEqual(['bmlab', 'xai']);
    expect(catalog.find((provider) => provider.id === 'xai')?.name).toBe('xAI / Grok');
    expect(selectUnconnectedProviders(catalog, new Set(['bmlab'])).map((provider) => provider.id)).toEqual(['xai']);
    expect(selectUnconnectedProviders(catalog, new Set(['bmlab', 'xai']))).toEqual([]);
    expect(selectAddCatalogProviders(
      [{ id: 'bmlab', name: 'bmlab' }, { id: 'xai', name: 'xai' }],
      new Set(['bmlab', 'xai']),
    )).toEqual([{ id: 'xai', name: 'xAI / Grok' }]);
    expect(shouldAutoSelectBuiltinAddProvider(true, false, [{ id: 'xai', name: 'xAI / Grok' }], '')).toBe('xai');
    expect(shouldAutoSelectBuiltinAddProvider(true, false, [{ id: 'xai' }], 'xai')).toBe(null);
    expect(shouldAutoSelectBuiltinAddProvider(true, false, [{ id: 'xai' }], '', 'xai', true)).toBe(null);
    expect(selectSidebarProviders([
      { id: 'xai', models: {} },
      { id: 'bmlab', models: [{ id: 'grok-4.6' }] },
    ]).map((provider) => provider.id)).toEqual(['bmlab']);
    expect(selectSidebarProviders([
      { id: 'anthropic', models: [{ id: 'claude-sonnet-4-5' }] },
      { id: 'bmlab', models: [{ id: 'grok-4.6' }] },
    ]).map((provider) => provider.id)).toEqual(['anthropic', 'bmlab']);
    expect(selectSidebarProviders([
      { id: 'anthropic', models: [{ id: 'claude-sonnet-4-5' }] },
      { id: 'xai', models: { 'grok-4.6': { id: 'grok-4.6' } } },
      { id: 'bmlab', models: [{ id: 'grok-4.6' }] },
    ], {
      sourcesById: {
        anthropic: { auth: { exists: false }, user: { exists: false }, project: { exists: false } },
        xai: { auth: { exists: false }, user: { exists: false }, project: { exists: false } },
      },
    }).map((provider) => provider.id)).toEqual(['bmlab']);
    expect(selectSidebarProviders([
      { id: 'anthropic', models: [{ id: 'claude-sonnet-4-5' }] },
    ], {
      sourcesById: {
        anthropic: { auth: { exists: true }, user: { exists: false }, project: { exists: false } },
      },
    }).map((provider) => provider.id)).toEqual(['anthropic']);
    expect(shouldAutoSelectCustomProvider(true, false, 0, '')).toBe(true);
    expect(shouldAutoSelectCustomProvider(true, false, 0, '', true)).toBe(false);
    expect(shouldAutoSelectCustomProvider(true, true, 0, '')).toBe(false);
    expect(shouldAutoSelectCustomProvider(true, false, 1, '')).toBe(false);
    expect(shouldAutoSelectCustomProvider(true, false, 0, 'xai')).toBe(false);
  });

  test('skips the standalone auth panel for config-defined custom providers', () => {
    expect(requiresProviderAuth(true, false, false)).toBe(true);
    expect(requiresProviderAuth(true, true, false)).toBe(false);
    expect(requiresProviderAuth(true, false, true)).toBe(false);
    expect(requiresProviderAuth(false, false, false)).toBe(false);
  });
});

describe('provider auth method helpers', () => {
  test('normalizeAuthType recognizes oauth and api labels', () => {
    expect(normalizeAuthType({ type: 'oauth', label: 'Login with Cursor' })).toBe('oauth');
    expect(normalizeAuthType({ type: 'api', label: 'API Key' })).toBe('api');
    expect(normalizeAuthType({ label: 'OAuth browser login' })).toBe('oauth');
    expect(normalizeAuthType({ name: 'API key' })).toBe('api');
  });

  test('parseAuthPayload keeps only object auth method entries', () => {
    expect(parseAuthPayload({
      cursor: [{ type: 'oauth', label: 'Cursor' }, 'skip'],
      openai: null,
    })).toEqual({
      cursor: [{ type: 'oauth', label: 'Cursor' }],
    });
    expect(parseAuthPayload(null)).toEqual({});
  });

  test('shouldShowApiKeyAuth hides API key for oauth-only providers', () => {
    expect(shouldShowApiKeyAuth([{ type: 'oauth', label: 'Cursor OAuth' }])).toBe(false);
    expect(shouldShowApiKeyAuth([
      { type: 'api', label: 'API Key' },
      { type: 'oauth', label: 'ChatGPT' },
    ])).toBe(true);
    expect(shouldShowApiKeyAuth([{ type: 'api', label: 'API Key' }])).toBe(true);
    // Unknown / unloaded methods keep the legacy API key fallback.
    expect(shouldShowApiKeyAuth([])).toBe(true);
  });

  test('getOAuthAuthMethods preserves original method indexes', () => {
    const methods = [
      { type: 'api', label: 'API Key' },
      { type: 'oauth', label: 'OAuth' },
      { type: 'oauth', label: 'Device' },
    ];
    expect(getOAuthAuthMethods(methods)).toEqual([
      { method: methods[1], methodIndex: 1 },
      { method: methods[2], methodIndex: 2 },
    ]);
    expect(getOAuthAuthMethods([{ type: 'oauth', label: 'Cursor' }])).toEqual([
      { method: { type: 'oauth', label: 'Cursor' }, methodIndex: 0 },
    ]);
  });

  test('Claude CLI OAuth does not require an OpenCode restart', () => {
    expect(requiresOpenCodeRestartAfterOAuth('claude-code')).toBe(false);
    expect(requiresOpenCodeRestartAfterOAuth('github-copilot')).toBe(true);
  });
});
