import { describe, expect, test } from 'bun:test';
import {
  addRemoteModelsToForm,
  applyModelContextChange,
  applyModelIdChange,
  buildAuthSetRequest,
  buildFetchRemoteModelsRequest,
  buildProviderUpsertRequest,
  classifyRemoteModelFamily,
  collapseRemoteModels,
  fetchRemoteModelsErrorKey,
  filterRemoteModels,
  isInferredModelContext,
  parseRemoteProviderModelsPayload,
  prepareRemoteModelPicker,
  remoteModelAlreadyAdded,
  isConfigDefinedCustomProvider,
  isCustomOpenAICompatibleProvider,
  providerToCustomFormState,
  resolveProviderConfigScope,
  validateCustomProvider,
  type CustomProviderConfig,
  type CustomProviderFormState,
} from './custom-provider-form';

const t = (key: string) => key;

const baseForm = (overrides: Partial<CustomProviderFormState> = {}): CustomProviderFormState => ({
  providerID: 'custom-provider',
  name: 'Custom Provider',
  baseURL: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  models: [{ row: 'm0', id: 'model-a', name: 'Model A' }],
  headers: [{ row: 'h0', key: '', value: '' }],
  ...overrides,
});

/** Mirrors server upsert semantics for request-construction tests. */
function mergeProviderConfig(
  existing: Record<string, unknown>,
  providerID: string,
  config: CustomProviderConfig,
): Record<string, unknown> {
  const providerSection = (
    typeof existing.provider === 'object' && existing.provider !== null && !Array.isArray(existing.provider)
      ? { ...(existing.provider as Record<string, unknown>) }
      : {}
  );
  providerSection[providerID] = config;
  const next: Record<string, unknown> = {
    ...existing,
    provider: providerSection,
  };
  if (Array.isArray(existing.disabled_providers)) {
    next.disabled_providers = existing.disabled_providers.filter((entry) => entry !== providerID);
  }
  return next;
}

describe('validateCustomProvider', () => {
  test('builds trimmed config and auth payloads', () => {
    const result = validateCustomProvider({
      form: baseForm({
        providerID: ' custom-provider ',
        name: ' Custom Provider ',
        baseURL: ' https://api.example.com/v1 ',
        apiKey: ' sk-secret ',
        models: [{ row: 'm0', id: ' model-a ', name: ' Model A ' }],
        headers: [
          { row: 'h0', key: ' X-Test ', value: ' enabled ' },
          { row: 'h1', key: '', value: '' },
        ],
      }),
      t,
      existingProviderIDs: new Set(),
    });

    expect(result.result).toEqual({
      providerID: 'custom-provider',
      name: 'Custom Provider',
      apiKey: 'sk-secret',
      config: {
        npm: '@ai-sdk/openai-compatible',
        name: 'Custom Provider',
        options: {
          baseURL: 'https://api.example.com/v1',
          headers: {
            'X-Test': 'enabled',
          },
        },
        models: {
          'model-a': { name: 'Model A' },
        },
      },
    });
  });

  test('supports {env:VAR} credentials without writing an auth key', () => {
    const result = validateCustomProvider({
      form: baseForm({
        apiKey: '{env: CUSTOM_PROVIDER_KEY}',
      }),
      t,
      existingProviderIDs: new Set(),
    });

    expect(result.result?.apiKey).toEqual(undefined);
    expect(result.result?.config.env).toEqual(['CUSTOM_PROVIDER_KEY']);
  });

  test('rejects missing credentials', () => {
    const result = validateCustomProvider({
      form: baseForm({ apiKey: '   ' }),
      t,
      existingProviderIDs: new Set(),
    });

    expect(result.result).toEqual(undefined);
    expect(result.err.apiKey).toBe('settings.providers.page.custom.error.apiKey.required');
  });

  test('allows empty api key when editing with existing auth', () => {
    const result = validateCustomProvider({
      form: baseForm({ apiKey: '' }),
      t,
      existingProviderIDs: new Set(['custom-provider']),
      editingProviderID: 'custom-provider',
      allowExistingAuth: true,
    });

    expect(result.result?.providerID).toBe('custom-provider');
    expect(result.err.apiKey).toEqual(undefined);
    expect(result.result?.apiKey).toEqual(undefined);
  });

  test('rejects invalid provider id, base URL, and duplicate rows', () => {
    const result = validateCustomProvider({
      form: baseForm({
        providerID: 'Bad ID',
        baseURL: 'ftp://example.com',
        models: [
          { row: 'm0', id: 'model-a', name: 'Model A' },
          { row: 'm1', id: 'model-a', name: 'Model A 2' },
        ],
        headers: [
          { row: 'h0', key: 'Authorization', value: 'one' },
          { row: 'h1', key: 'authorization', value: 'two' },
        ],
      }),
      t,
      existingProviderIDs: new Set(),
    });

    expect(result.result).toEqual(undefined);
    expect(result.err.providerID).toBe('settings.providers.page.custom.error.providerID.format');
    expect(result.err.baseURL).toBe('settings.providers.page.custom.error.baseURL.format');
    expect(result.models[1]).toEqual({
      id: 'settings.providers.page.custom.error.duplicate',
      name: undefined,
    });
    expect(result.headers[1]).toEqual({
      key: 'settings.providers.page.custom.error.duplicate',
      value: undefined,
    });
  });

  test('allows reconnecting a disabled provider id', () => {
    const result = validateCustomProvider({
      form: baseForm(),
      t,
      existingProviderIDs: new Set(['custom-provider']),
      disabledProviders: ['custom-provider'],
    });

    expect(result.result?.providerID).toBe('custom-provider');
    expect(result.err.providerID).toEqual(undefined);
  });

  test('rejects an already-connected provider id on create', () => {
    const result = validateCustomProvider({
      form: baseForm(),
      t,
      existingProviderIDs: new Set(['custom-provider']),
    });

    expect(result.result).toEqual(undefined);
    expect(result.err.providerID).toBe('settings.providers.page.custom.error.providerID.exists');
  });

  test('allows updating the same provider id while editing', () => {
    const result = validateCustomProvider({
      form: baseForm({ apiKey: 'sk-updated' }),
      t,
      existingProviderIDs: new Set(['custom-provider']),
      editingProviderID: 'custom-provider',
    });

    expect(result.result?.providerID).toBe('custom-provider');
    expect(result.err.providerID).toEqual(undefined);
  });

  test('writes a user-set contextWindow and the published window for a known empty id', () => {
    const withContext = validateCustomProvider({
      form: baseForm({
        models: [{ row: 'm0', id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000 }],
      }),
      t,
      existingProviderIDs: new Set(),
    });
    expect(withContext.result?.config.models).toEqual({
      'gpt-4o': { name: 'GPT-4o', contextWindow: 128000, input: ['text', 'image'] },
    });

    const knownEmpty = validateCustomProvider({
      form: baseForm({
        models: [{
          row: 'm0',
          id: 'grok-4.6',
          name: 'Grok 4.6',
          contextTouched: true,
        }],
      }),
      t,
      existingProviderIDs: new Set(),
    });
    expect(knownEmpty.result?.config.models).toEqual({
      'grok-4.6': { name: 'Grok 4.6', contextWindow: 500000, input: ['text', 'image'], reasoning: true },
    });

    const unknownEmpty = validateCustomProvider({
      form: baseForm({
        models: [{ row: 'm0', id: 'mystery', name: 'Mystery' }],
      }),
      t,
      existingProviderIDs: new Set(),
    });
    expect(unknownEmpty.result?.config.models).toEqual({
      mystery: { name: 'Mystery' },
    });

    const clearedFamily = validateCustomProvider({
      form: baseForm({
        models: [{
          row: 'm0',
          id: 'claude-unknown-99',
          name: 'Unknown Claude',
          contextTouched: true,
        }],
      }),
      t,
      existingProviderIDs: new Set(),
    });
    expect(clearedFamily.result?.config.models).toEqual({
      'claude-unknown-99': { name: 'Unknown Claude' },
    });

    const userOverride = validateCustomProvider({
      form: baseForm({
        models: [{
          row: 'm0',
          id: 'grok-4.6',
          name: 'Grok 4.6',
          contextWindow: 64000,
          contextTouched: true,
        }],
      }),
      t,
      existingProviderIDs: new Set(),
    });
    expect(userOverride.result?.config.models).toEqual({
      'grok-4.6': { name: 'Grok 4.6', contextWindow: 64000, input: ['text', 'image'], reasoning: true },
    });
  });

  test('writes input for a known vision id and does not invent or overwrite it', () => {
    const knownVision = validateCustomProvider({
      form: baseForm({
        models: [{ row: 'm0', id: 'grok-4.6', name: 'Grok 4.6' }],
      }),
      t,
      existingProviderIDs: new Set(),
    });
    expect(knownVision.result?.config.models).toEqual({
      'grok-4.6': { name: 'Grok 4.6', contextWindow: 500000, input: ['text', 'image'], reasoning: true },
    });

    const defaultText = validateCustomProvider({
      form: baseForm({
        models: [{
          row: 'm0',
          id: 'grok-4.6',
          name: 'Grok 4.6',
          input: ['text'],
        }],
      }),
      t,
      existingProviderIDs: new Set(),
    });
    expect(defaultText.result?.config.models).toEqual({
      'grok-4.6': { name: 'Grok 4.6', contextWindow: 500000, input: ['text', 'image'], reasoning: true },
    });

    const storedVision = validateCustomProvider({
      form: baseForm({
        models: [{
          row: 'm0',
          id: 'grok-4.6',
          name: 'Grok 4.6',
          input: ['text', 'image'],
        }],
      }),
      t,
      existingProviderIDs: new Set(),
    });
    expect(storedVision.result?.config.models).toEqual({
      'grok-4.6': { name: 'Grok 4.6', contextWindow: 500000, input: ['text', 'image'], reasoning: true },
    });

    const unknown = validateCustomProvider({
      form: baseForm({
        models: [{ row: 'm0', id: 'mystery-model', name: 'Mystery' }],
      }),
      t,
      existingProviderIDs: new Set(),
    });
    expect(unknown.result?.config.models).toEqual({
      'mystery-model': { name: 'Mystery' },
    });
  });

  test('re-saves a known vision id when the live facade only has Pi-default text input', () => {
    const state = providerToCustomFormState({
      id: 'bmlab',
      name: 'bmlab',
      options: { baseURL: 'https://ai.example.test/v1' },
      models: [{
        id: 'grok-4.6',
        name: 'Grok 4.6',
        contextWindow: 500000,
        input: ['text'],
        capabilities: {
          input: { text: true, image: false, audio: false, video: false, pdf: false },
        },
      }],
    });
    expect(state.models[0]?.input).toEqual(undefined);

    const saved = validateCustomProvider({
      form: {
        providerID: 'bmlab',
        name: 'bmlab',
        baseURL: 'https://ai.example.test/v1',
        apiKey: 'sk-test',
        models: state.models,
        headers: [{ row: 'h0', key: '', value: '' }],
      },
      t,
      existingProviderIDs: new Set(['bmlab']),
      editingProviderID: 'bmlab',
      allowExistingAuth: true,
    });
    expect(saved.result?.config.models).toEqual({
      'grok-4.6': { name: 'Grok 4.6', contextWindow: 500000, input: ['text', 'image'], reasoning: true },
    });

    const unknownLive = providerToCustomFormState({
      id: 'bmlab',
      options: { baseURL: 'https://ai.example.test/v1' },
      models: [{
        id: 'mystery-model',
        name: 'Mystery',
        input: ['text'],
        capabilities: { input: { text: true, image: false } },
      }],
    });
    const unknownSaved = validateCustomProvider({
      form: {
        providerID: 'bmlab',
        name: 'bmlab',
        baseURL: 'https://ai.example.test/v1',
        apiKey: 'sk-test',
        models: unknownLive.models,
        headers: [{ row: 'h0', key: '', value: '' }],
      },
      t,
      existingProviderIDs: new Set(['bmlab']),
      editingProviderID: 'bmlab',
      allowExistingAuth: true,
    });
    expect(unknownSaved.result?.config.models).toEqual({
      'mystery-model': { name: 'Mystery' },
    });
  });
});

describe('request construction', () => {
  test('builds auth.set and provider upsert requests', () => {
    const validated = validateCustomProvider({
      form: baseForm(),
      t,
      existingProviderIDs: new Set(),
    });
    const plan = validated.result!;

    expect(buildAuthSetRequest(plan)).toEqual({
      providerID: 'custom-provider',
      auth: { type: 'api', key: 'sk-test' },
    });
    expect(buildProviderUpsertRequest(plan)).toEqual({
      providerID: 'custom-provider',
      config: plan.config,
      scope: 'user',
    });
  });

  test('includes explicit project/custom scope on upsert requests', () => {
    const validated = validateCustomProvider({
      form: baseForm(),
      t,
      existingProviderIDs: new Set(),
    });
    const plan = validated.result!;

    expect(buildProviderUpsertRequest(plan, { scope: 'project' }).scope).toBe('project');
    expect(buildProviderUpsertRequest(plan, { scope: 'custom' }).scope).toBe('custom');
  });

  test('omits auth.set when using env credentials', () => {
    const validated = validateCustomProvider({
      form: baseForm({ apiKey: '{env:MY_KEY}' }),
      t,
      existingProviderIDs: new Set(),
    });

    expect(buildAuthSetRequest(validated.result!)).toBeNull();
  });
});

describe('mergeProviderConfig persistence shape', () => {
  test('merges provider block and clears disabled_providers entry', () => {
    const validated = validateCustomProvider({
      form: baseForm(),
      t,
      existingProviderIDs: new Set(),
    });
    const plan = validated.result!;

    const next = mergeProviderConfig(
      {
        model: 'openai/gpt-4o',
        provider: {
          openai: { name: 'OpenAI' },
        },
        disabled_providers: ['custom-provider', 'other'],
      },
      plan.providerID,
      plan.config,
    );

    expect(next).toEqual({
      model: 'openai/gpt-4o',
      provider: {
        openai: { name: 'OpenAI' },
        'custom-provider': plan.config,
      },
      disabled_providers: ['other'],
    });
  });

  test('creates provider section when missing', () => {
    const validated = validateCustomProvider({
      form: baseForm(),
      t,
      existingProviderIDs: new Set(),
    });
    const plan = validated.result!;

    const next = mergeProviderConfig({}, plan.providerID, plan.config);
    expect(next.provider).toEqual({
      'custom-provider': plan.config,
    });
  });
});

describe('provider edit helpers', () => {
  test('detects openai-compatible custom providers and prefills form state', () => {
    expect(isCustomOpenAICompatibleProvider({
      id: 'campus-llm',
      options: { baseURL: 'https://llm.example.edu/v1' },
      models: [],
    })).toBe(true);

    const state = providerToCustomFormState({
      id: 'campus-llm',
      name: 'Campus LLM',
      env: ['CAMPUS_KEY'],
      options: {
        baseURL: 'https://llm.example.edu/v1',
        headers: { 'X-Campus': '1' },
      },
      models: [{ id: 'fast', name: 'Fast' }],
    });

    expect(state.providerID).toBe('campus-llm');
    expect(state.name).toBe('Campus LLM');
    expect(state.baseURL).toBe('https://llm.example.edu/v1');
    expect(state.apiKey).toBe('{env:CAMPUS_KEY}');
    expect(state.models[0]).toEqual({ row: state.models[0].row, id: 'fast', name: 'Fast' });
    expect(state.headers[0]).toEqual({ row: state.headers[0].row, key: 'X-Campus', value: '1' });
  });

  test('round-trips a saved contextWindow on edit', () => {
    const state = providerToCustomFormState({
      id: 'campus-llm',
      name: 'Campus LLM',
      options: { baseURL: 'https://llm.example.edu/v1' },
      models: [{
        id: 'gpt-4.1',
        name: 'GPT-4.1',
        contextWindow: 1047576,
        input: ['text', 'image'],
        limit: { context: 1047576 },
      }],
    });
    expect(state.models[0]?.contextWindow).toBe(1047576);
    expect(state.models[0]?.input).toEqual(['text', 'image']);

    const fromLimitOnly = providerToCustomFormState({
      id: 'campus-llm',
      options: { baseURL: 'https://llm.example.edu/v1' },
      models: { 'gpt-4o': { name: 'GPT-4o', limit: { context: 128000 } } },
    });
    expect(fromLimitOnly.models[0]).toEqual({
      row: fromLimitOnly.models[0]!.row,
      id: 'gpt-4o',
      name: 'GPT-4o',
      contextWindow: 128000,
    });
  });

  test('requires a config-layer source before treating a provider as editable custom', () => {
    const catalogLike = {
      id: 'openai',
      options: { baseURL: 'https://api.openai.com/v1' },
      models: [{ id: 'gpt-4o', name: 'GPT-4o', api: { npm: '@ai-sdk/openai-compatible' } }],
    };

    expect(isCustomOpenAICompatibleProvider(catalogLike)).toBe(true);
    expect(isConfigDefinedCustomProvider(catalogLike, undefined)).toBe(false);
    expect(isConfigDefinedCustomProvider(catalogLike, {
      user: { exists: false },
      project: { exists: false },
      custom: { exists: false },
    })).toBe(false);
    expect(isConfigDefinedCustomProvider(catalogLike, {
      user: { exists: true },
      project: { exists: false },
    })).toBe(true);
  });

  test('resolveProviderConfigScope follows custom > project > user precedence', () => {
    expect(resolveProviderConfigScope(undefined)).toBe('user');
    expect(resolveProviderConfigScope({
      user: { exists: true },
      project: { exists: false },
      custom: { exists: false },
    })).toBe('user');
    expect(resolveProviderConfigScope({
      user: { exists: true },
      project: { exists: true },
      custom: { exists: false },
    })).toBe('project');
    expect(resolveProviderConfigScope({
      user: { exists: true },
      project: { exists: true },
      custom: { exists: true },
    })).toBe('custom');
    expect(resolveProviderConfigScope({
      user: { exists: false },
      project: { exists: false },
      custom: { exists: true },
    })).toBe('custom');
  });
});

describe('fetch remote models request', () => {
  test('requires a base URL and credentials unless stored auth is allowed', () => {
    expect(buildFetchRemoteModelsRequest(baseForm({ baseURL: '' }))).toEqual({
      errorKey: 'settings.providers.page.custom.error.fetch.baseURL',
    });
    expect(buildFetchRemoteModelsRequest(baseForm({ apiKey: '' }))).toEqual({
      errorKey: 'settings.providers.page.custom.error.fetch.apiKey',
    });
    expect(buildFetchRemoteModelsRequest(baseForm({ apiKey: '' }), {
      allowExistingAuth: true,
      editingProviderID: 'custom-provider',
    })).toEqual({
      request: {
        baseURL: 'https://api.example.com/v1',
        providerID: 'custom-provider',
      },
    });
  });

  test('includes a literal key and optional headers', () => {
    expect(buildFetchRemoteModelsRequest(baseForm({
      headers: [{ row: 'h0', key: 'X-Test', value: '1' }],
    }))).toEqual({
      request: {
        baseURL: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        headers: { 'X-Test': '1' },
      },
    });
  });

  test('parses a remote list without treating empty as malformed', () => {
    expect(parseRemoteProviderModelsPayload(null)).toBeNull();
    expect(parseRemoteProviderModelsPayload({ models: [] })).toEqual([]);
    expect(parseRemoteProviderModelsPayload({
      models: [
        { id: 'grok-4.6', name: 'Grok 4.6' },
        { id: '  grok-4.6  ', name: 'Duplicate' },
        { id: '  ', name: 'blank' },
        { name: 'missing-id' },
      ],
    })).toEqual([{ id: 'grok-4.6', name: 'Grok 4.6', contextWindow: 500000, input: ['text', 'image'] }]);
  });

  test('keeps a provider-reported context and prefills exact ids when the catalog is silent', () => {
    expect(parseRemoteProviderModelsPayload({
      models: [
        { id: 'gpt-4o', name: 'GPT-4o', context_length: 64000 },
        { id: 'gpt-4.1', name: 'GPT-4.1' },
        { id: 'claude-unknown-99', name: 'Claude mystery' },
        { id: 'mystery-model', name: 'Mystery' },
      ],
    })).toEqual([
      { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 64000, input: ['text', 'image'] },
      { id: 'gpt-4.1', name: 'GPT-4.1', contextWindow: 1047576, input: ['text', 'image'] },
      { id: 'claude-unknown-99', name: 'Claude mystery', contextWindow: 200000 },
      { id: 'mystery-model', name: 'Mystery' },
    ]);
  });

  test('filters remote models by id, name, and family without mutating the source', () => {
    const models = [
      { id: 'grok-4.6', name: 'Grok 4.6' },
      { id: 'x-ai/grok-4.6', name: 'xAI Grok' },
      { id: 'claude-*', name: 'Claude' },
      { id: 'gpt-*', name: 'GPT' },
      { id: 'o3*', name: 'o3' },
      { id: 'deepseek-chat', name: 'DeepSeek' },
      { id: 'composer-2.5', name: 'Composer' },
    ];
    expect(classifyRemoteModelFamily(models[0]!)).toBe('grok');
    expect(classifyRemoteModelFamily(models[1]!)).toBe('grok');
    expect(classifyRemoteModelFamily(models[2]!)).toBe('cc');
    expect(classifyRemoteModelFamily(models[3]!)).toBe('gpt');
    expect(classifyRemoteModelFamily(models[4]!)).toBe('gpt');
    expect(classifyRemoteModelFamily(models[5]!)).toBe('ds');
    expect(classifyRemoteModelFamily(models[6]!)).toBe('other');
    expect(filterRemoteModels(models, '4.6')).toEqual([models[0], models[1]]);
    expect(filterRemoteModels(models, 'CLAUDE')).toEqual([models[2]]);
    expect(filterRemoteModels(models, 'nope')).toEqual([]);
    expect(filterRemoteModels(models, '  ')).toEqual(models);
    expect(filterRemoteModels(models, '', 'grok').map((model) => model.id)).toEqual(['grok-4.6', 'x-ai/grok-4.6']);
    expect(filterRemoteModels(models, '4.6', 'cc')).toEqual([]);
    expect(filterRemoteModels(models, '', 'other').map((model) => model.id)).toEqual(['composer-2.5']);
  });

  test('classifies Claude by role names, not the letters cc', () => {
    expect(classifyRemoteModelFamily({ id: 'claude-opus-4-6', name: 'Claude Opus 4.6' })).toBe('cc');
    expect(classifyRemoteModelFamily({ id: 'opus-4.6', name: 'Opus 4.6' })).toBe('cc');
    expect(classifyRemoteModelFamily({ id: 'sonnet-4.5', name: 'Sonnet 4.5' })).toBe('cc');
    expect(classifyRemoteModelFamily({ id: 'haiku-4.5', name: 'Haiku 4.5' })).toBe('cc');
    expect(classifyRemoteModelFamily({ id: 'anthropic/claude-sonnet-4-6', name: 'Sonnet' })).toBe('cc');
    expect(classifyRemoteModelFamily({ id: 'my-cc-relay', name: 'CC relay' })).toBe('other');
    expect(classifyRemoteModelFamily({ id: 'ds-chat', name: 'DS chat' })).toBe('other');
    expect(classifyRemoteModelFamily({ id: 'deepseek-reasoner', name: 'DeepSeek R1' })).toBe('ds');
    expect(filterRemoteModels(
      [
        { id: 'opus-4.6', name: 'Opus 4.6' },
        { id: 'grok-4.6', name: 'Grok 4.6' },
      ],
      'opus',
      'cc',
    ).map((model) => model.id)).toEqual(['opus-4.6']);
  });

  test('collapses gateway aliases and hides wildcard catalog rows', () => {
    const collapsed = collapseRemoteModels([
      { id: 'claude-*', name: 'claude-*' },
      { id: 'gpt-*', name: 'gpt-*' },
      { id: 'grok-4.6', name: 'Grok 4.6' },
      { id: 'x-ai/grok-4.6', name: 'x-ai/grok-4.6' },
      { id: 'xai/grok-4.6', name: 'xai/grok-4.6' },
      { id: 'grok/grok-4.6', name: 'grok/grok-4.6' },
      { id: 'composer-2.5', name: 'composer-2.5' },
      { id: 'x-ai/composer-2.5', name: 'x-ai/composer-2.5' },
    ]);
    expect(collapsed.map((choice) => choice.id)).toEqual(['composer-2.5', 'grok-4.6']);
    expect(collapsed[1]?.aliases).toEqual(['grok/grok-4.6', 'x-ai/grok-4.6', 'xai/grok-4.6']);
    expect(remoteModelAlreadyAdded([{ row: 'm0', id: 'x-ai/grok-4.6', name: 'Grok' }], 'grok-4.6')).toBe(true);

    const split = collapseRemoteModels([
      { id: 'org-a/llama-3', name: 'Llama A' },
      { id: 'org-b/llama-3', name: 'Llama B' },
    ]);
    expect(split.map((choice) => choice.id).sort()).toEqual(['org-a/llama-3', 'org-b/llama-3']);
    expect(remoteModelAlreadyAdded(
      [{ row: 'm0', id: 'org-a/llama-3', name: 'Llama A' }],
      'org-b/llama-3',
    )).toBe(false);

    const picker = prepareRemoteModelPicker([
      { id: 'claude-*', name: 'claude-*' },
      { id: 'opus-4.6', name: 'Opus 4.6' },
      { id: 'grok-4.6', name: 'Grok 4.6' },
      { id: 'x-ai/grok-4.6', name: 'x-ai/grok-4.6' },
    ], '', 'cc');
    expect(picker.fetchedCount).toBe(4);
    expect(picker.uniqueCount).toBe(2);
    expect(picker.familyCounts).toEqual({ cc: 1, gpt: 0, grok: 1, ds: 0, other: 0 });
    expect(picker.choices.map((choice) => choice.id)).toEqual(['opus-4.6']);
  });

  test('adds only chosen remote models and leaves the current list otherwise unchanged', () => {
    const current = [{ row: 'm0', id: 'old', name: 'Old' }];
    expect(addRemoteModelsToForm(current, [])).toEqual(current);
    expect(remoteModelAlreadyAdded(current, 'old')).toBe(true);
    expect(remoteModelAlreadyAdded(current, 'grok-4.6')).toBe(false);

    const blank = [{ row: 'm1', id: '', name: '' }];
    const first = addRemoteModelsToForm(blank, [{ id: 'grok-4.6', name: 'Grok 4.6' }]);
    expect(first).toHaveLength(1);
    expect(first[0]?.id).toBe('grok-4.6');
    expect(first[0]?.name).toBe('Grok 4.6');
    expect(first[0]?.contextWindow).toBe(500000);
    expect(first[0]?.input).toEqual(['text', 'image']);
    expect(first[0]?.row.startsWith('row-')).toBe(true);

    const appended = addRemoteModelsToForm(first, [
      { id: 'grok-4.6', name: 'Grok 4.6' },
      { id: 'x-ai/grok-4.6', name: 'Grok 4.6' },
      { id: 'grok-4.5', name: 'Grok 4.5' },
    ]);
    expect(appended.map((row) => row.id)).toEqual(['grok-4.6', 'grok-4.5']);
    expect(prepareRemoteModelPicker([
      { id: 'claude-*', name: 'claude-*' },
      { id: 'gpt-*', name: 'gpt-*' },
    ]).uniqueCount).toBe(0);
    expect(fetchRemoteModelsErrorKey(401, 'unauthorized')).toBe(
      'settings.providers.page.custom.error.fetch.unauthorized',
    );
    expect(fetchRemoteModelsErrorKey(404)).toBe(
      'settings.providers.page.custom.error.fetch.unsupported',
    );
  });

  test('prefills published windows on id change and never overwrites a user edit', () => {
    const empty = applyModelIdChange({ row: 'm0', id: '', name: '' }, 'gpt-4o');
    expect(empty.contextWindow).toBe(128000);
    expect(isInferredModelContext(empty)).toBe(false);

    const switched = applyModelIdChange(empty, 'gpt-4.1');
    expect(switched.contextWindow).toBe(1047576);

    const edited = applyModelContextChange(switched, 64000);
    expect(applyModelIdChange(edited, 'gpt-4o').contextWindow).toBe(64000);
    expect(addRemoteModelsToForm([edited], [
      { id: 'gpt-4.1', name: 'GPT-4.1', contextWindow: 1_047_576 },
    ])[0]?.contextWindow).toBe(64000);

    const family = applyModelIdChange({ row: 'm1', id: '', name: '' }, 'claude-unknown-99');
    expect(family.contextWindow).toBe(200000);
    expect(isInferredModelContext(family)).toBe(true);

    const unknown = applyModelIdChange({ row: 'm2', id: '', name: '' }, 'mystery-model');
    expect(unknown.contextWindow).toEqual(undefined);

    const dropped = applyModelIdChange({
      row: 'm3',
      id: 'grok-4.6',
      name: 'Grok 4.6',
      input: ['text'],
    }, 'mystery-model');
    expect(dropped.input).toEqual(undefined);
  });
});
