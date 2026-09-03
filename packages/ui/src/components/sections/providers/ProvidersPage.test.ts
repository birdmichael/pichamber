import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  dualAuthCatalogId,
  dualAuthSiblingId,
  getOAuthAuthMethods,
  isDualAuthApiSiblingId,
  isDualAuthCatalogId,
  normalizeAuthType,
  parseAuthPayload,
  providerHasCredentials,
  requiresOpenCodeRestartAfterOAuth,
  shouldAutoOpenAuthPanel,
  shouldShowApiKeyAuth,
  shouldShowModelsSection,
} from './providerAuth';
import { isConfigDefinedCustomProvider } from './custom-provider-form';

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
    expect(catalog.map((provider) => provider.id)).toEqual(['bmlab', 'xai', 'kimi-coding']);
    expect(catalog.find((provider) => provider.id === 'xai')?.name).toBe('xAI / Grok');
    expect(catalog.find((provider) => provider.id === 'kimi-coding')?.name).toBe('Kimi Code');
    expect(selectUnconnectedProviders(catalog, new Set(['bmlab'])).map((provider) => provider.id)).toEqual(['kimi-coding', 'xai']);
    expect(selectUnconnectedProviders(catalog, new Set(['bmlab', 'xai', 'kimi-coding']))).toEqual([]);
    expect(selectAddCatalogProviders(
      [{ id: 'bmlab', name: 'bmlab' }, { id: 'xai', name: 'xai' }],
      new Set(['bmlab', 'xai']),
    )).toEqual([
      { id: 'kimi-coding', name: 'Kimi Code' },
      { id: 'xai', name: 'xAI / Grok' },
    ]);
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
    expect(selectAddCatalogProviders(
      [{ id: 'kimi-coding-api', name: 'Kimi Code API' }, { id: 'xai-api', name: 'xAI API' }],
      new Set(['kimi-coding', 'kimi-coding-api']),
    ).map((provider) => provider.id)).toEqual(['kimi-coding', 'xai']);
    expect(shouldAutoSelectCustomProvider(
      true,
      false,
      selectAddCatalogProviders(
        [{ id: 'kimi-coding-api', name: 'Kimi Code API' }],
        new Set(['kimi-coding', 'kimi-coding-api', 'xai']),
      ).length,
      '',
    )).toBe(false);
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

describe('provider credential state helpers', () => {
  test('providerHasCredentials requires key, options.apiKey, declared env, or auth source', () => {
    expect(providerHasCredentials({ key: undefined, authSourceExists: false })).toBe(false);
    expect(providerHasCredentials({ key: '', authSourceExists: false })).toBe(false);
    expect(providerHasCredentials({ key: '   ', authSourceExists: false })).toBe(false);

    expect(providerHasCredentials({ key: 'sk-...', authSourceExists: false })).toBe(true);
    expect(providerHasCredentials({ key: undefined, authSourceExists: true })).toBe(true);
  });

  test('providerHasCredentials counts declared env vars for multi-variable providers', () => {
    expect(providerHasCredentials({ key: undefined, authSourceExists: false, envDeclared: true })).toBe(true);
    expect(providerHasCredentials({ key: undefined, authSourceExists: false, envDeclared: false })).toBe(false);
  });

  test('providerHasCredentials treats options.apiKey as a usable credential', () => {
    expect(providerHasCredentials({ key: undefined, authSourceExists: false, optionsApiKey: 'sk-config' })).toBe(true);
    expect(providerHasCredentials({ key: undefined, authSourceExists: false, optionsApiKey: '' })).toBe(false);
    expect(providerHasCredentials({ key: undefined, authSourceExists: false, optionsApiKey: '   ' })).toBe(false);
    expect(providerHasCredentials({ key: undefined, authSourceExists: false, optionsApiKey: null })).toBe(false);
  });

  test('env-less OAuth-only provider without credentials opens panel and hides models', () => {
    const hasCredentials = providerHasCredentials({
      key: undefined,
      authSourceExists: false,
    });
    expect(hasCredentials).toBe(false);
    expect(shouldAutoOpenAuthPanel({
      sourcesLoaded: true,
      hasCredentials,
      userDismissed: false,
    })).toBe(true);
    expect(shouldShowModelsSection({
      modelCount: 1,
      sourcesLoaded: true,
      hasCredentials,
    })).toBe(false);
  });

  test('provider with stored auth or key shows Connected and models', () => {
    const fromKey = providerHasCredentials({ key: 'sk-live', authSourceExists: false });
    const fromAuth = providerHasCredentials({ key: undefined, authSourceExists: true });
    expect(fromKey).toBe(true);
    expect(fromAuth).toBe(true);
    expect(shouldAutoOpenAuthPanel({
      sourcesLoaded: true,
      hasCredentials: fromKey,
      userDismissed: false,
    })).toBe(false);
    expect(shouldShowModelsSection({
      modelCount: 3,
      sourcesLoaded: true,
      hasCredentials: fromAuth,
    })).toBe(true);
  });

  test('editable custom provider keeps models visible even with no credentials signal', () => {
    const hasCredentials = providerHasCredentials({
      key: undefined,
      authSourceExists: false,
      optionsApiKey: null,
    });
    expect(hasCredentials).toBe(false);
    expect(shouldShowModelsSection({
      modelCount: 1,
      sourcesLoaded: true,
      hasCredentials: false,
      isEditableCustomProvider: true,
    })).toBe(true);
    expect(shouldShowModelsSection({
      modelCount: 1,
      sourcesLoaded: true,
      hasCredentials: false,
      isEditableCustomProvider: false,
    })).toBe(false);
  });

  test('auth save followed by providers refresh recognizes credentials without stale missing state', () => {
    const before = providerHasCredentials({
      key: undefined,
      authSourceExists: false,
    });
    expect(before).toBe(false);
    expect(shouldShowModelsSection({
      modelCount: 2,
      sourcesLoaded: true,
      hasCredentials: before,
    })).toBe(false);

    const afterProvidersRefresh = providerHasCredentials({
      key: 'oauth-token-present',
      authSourceExists: false,
    });
    expect(afterProvidersRefresh).toBe(true);
    expect(shouldAutoOpenAuthPanel({
      sourcesLoaded: true,
      hasCredentials: afterProvidersRefresh,
      userDismissed: false,
    })).toBe(false);
    expect(shouldShowModelsSection({
      modelCount: 2,
      sourcesLoaded: true,
      hasCredentials: afterProvidersRefresh,
    })).toBe(true);

    expect(providerHasCredentials({
      key: 'oauth-token-present',
      authSourceExists: true,
    })).toBe(true);
  });

  test('explicit hide keeps the auth panel closed while credentials are still missing', () => {
    expect(shouldAutoOpenAuthPanel({
      sourcesLoaded: true,
      hasCredentials: false,
      userDismissed: true,
    })).toBe(false);
  });

  test('dual-auth catalog stays open until OAuth and API key are both connected', () => {
    expect(isDualAuthCatalogId('kimi-coding')).toBe(true);
    expect(dualAuthSiblingId('kimi-coding')).toBe('kimi-coding-api');
    expect(dualAuthCatalogId('kimi-coding-api')).toBe('kimi-coding');
    expect(isDualAuthApiSiblingId('kimi-coding-api')).toBe(true);
    expect(shouldAutoOpenAuthPanel({
      sourcesLoaded: true,
      hasCredentials: true,
      userDismissed: false,
      dualAuthIncomplete: true,
    })).toBe(true);
    expect(shouldAutoOpenAuthPanel({
      sourcesLoaded: true,
      hasCredentials: true,
      userDismissed: false,
      dualAuthIncomplete: false,
    })).toBe(false);
    expect(isConfigDefinedCustomProvider(
      { id: 'kimi-coding-api', options: { baseURL: 'https://api.moonshot.ai/v1' } },
      { user: { exists: true }, project: { exists: false }, custom: { exists: false } },
    )).toBe(false);
  });

  test('models stay visible while sources are still loading', () => {
    expect(shouldShowModelsSection({
      modelCount: 4,
      sourcesLoaded: false,
      hasCredentials: false,
    })).toBe(true);
  });
});

const providersPageSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'ProvidersPage.tsx'),
  'utf8',
);

describe('ProvidersPage Kimi Usage mount', () => {
  test('shows the usage block only when the Kimi slot is on and kimi-coding is connected', () => {
    expect(providersPageSource).toContain("useFeaturePluginSlotActive('kimi'");
    expect(providersPageSource).toContain("selectedProvider.id === 'kimi-coding' && hasCredentials");
    expect(providersPageSource).toContain('<ProviderKimiUsage />');
    expect(providersPageSource).not.toContain('/api/quota');
  });

  test('dual-auth catalog can disconnect OAuth and API key separately', () => {
    expect(providersPageSource).toContain("t('settings.providers.page.actions.disconnectOAuth')");
    expect(providersPageSource).toContain("t('settings.providers.page.actions.disconnectApiKey')");
    expect(providersPageSource).toContain('dualAuthSiblingId');
  });
});

