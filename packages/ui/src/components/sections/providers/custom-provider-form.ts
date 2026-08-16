/**
 * Custom / Other OpenAI-compatible provider form helpers.
 * Mirrors OpenCode web UI validation and request construction so a provider
 * can be defined from Settings without code changes.
 */

import { readCatalogContextWindow, readPositiveContextWindow, resolveContextWindow } from '@/lib/model-context-windows';

export const CUSTOM_PROVIDER_NPM = '@ai-sdk/openai-compatible';
export const CUSTOM_PROVIDER_ID = '__custom_provider__';
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/;
const BASE_URL_PATTERN = /^https?:\/\//;
const ENV_KEY_PATTERN = /^\{env:([^}]+)\}$/;

export type CustomProviderTranslator = (
  key: string,
  vars?: Record<string, string | number | boolean>,
) => string;

export type ModelRow = {
  row: string;
  id: string;
  name: string;
  contextWindow?: number;
  /** True after the user edits or clears context. Auto-prefill must not overwrite. */
  contextTouched?: boolean;
};

export type HeaderRow = {
  row: string;
  key: string;
  value: string;
};

export type CustomProviderFormState = {
  providerID: string;
  name: string;
  baseURL: string;
  apiKey: string;
  models: ModelRow[];
  headers: HeaderRow[];
};

export type FieldErrors = {
  providerID?: string;
  name?: string;
  baseURL?: string;
  apiKey?: string;
};

export type ModelFieldErrors = {
  id?: string;
  name?: string;
};

export type HeaderFieldErrors = {
  key?: string;
  value?: string;
};

export type CustomProviderModelConfig = {
  name: string;
  contextWindow?: number;
};

export type CustomProviderConfig = {
  npm: typeof CUSTOM_PROVIDER_NPM;
  name: string;
  env?: string[];
  options: {
    baseURL: string;
    headers?: Record<string, string>;
  };
  models: Record<string, CustomProviderModelConfig>;
};

export type CustomProviderPersistPlan = {
  providerID: string;
  name: string;
  /** Literal API key to send via auth.set; omitted when using {env:VAR} or empty. */
  apiKey?: string;
  config: CustomProviderConfig;
};

export type ValidateCustomProviderInput = {
  form: CustomProviderFormState;
  t: CustomProviderTranslator;
  existingProviderIDs: ReadonlySet<string>;
  disabledProviders?: readonly string[];
  /** When editing this provider id, treat it as an allowed update target. */
  editingProviderID?: string;
  /**
   * When true, empty apiKey is allowed because auth.json already has a credential
   * (edit path). Still requires env or key when false.
   */
  allowExistingAuth?: boolean;
};

export type ValidateCustomProviderResult = {
  err: FieldErrors;
  models: ModelFieldErrors[];
  headers: HeaderFieldErrors[];
  result?: CustomProviderPersistPlan;
};

export type ProviderLikeForCustomForm = {
  id: string;
  name?: string;
  env?: string[];
  options?: Record<string, unknown> | null;
  models?: Array<{
    id?: string;
    name?: string;
    contextWindow?: number;
    limit?: { context?: number };
    api?: { npm?: string };
  }> | Record<string, unknown>;
};

let rowCounter = 0;

const nextRow = (): string => `row-${rowCounter++}`;

export const createModelRow = (): ModelRow => ({
  row: nextRow(),
  id: '',
  name: '',
});

const readModelContextWindow = (model: unknown): number | undefined => {
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    return undefined;
  }
  const record = model as Record<string, unknown>;
  return readPositiveContextWindow(record.contextWindow)
    ?? readCatalogContextWindow(record);
};

export const applyModelIdChange = (row: ModelRow, id: string): ModelRow => {
  if (row.contextTouched) {
    return { ...row, id };
  }
  const resolved = resolveContextWindow({ id });
  return {
    ...row,
    id,
    contextWindow: resolved.contextWindow,
  };
};

export const applyModelContextChange = (
  row: ModelRow,
  contextWindow: number | undefined,
): ModelRow => ({
  ...row,
  contextWindow,
  contextTouched: true,
});

export const isInferredModelContext = (row: Pick<ModelRow, 'id' | 'contextWindow'>): boolean => {
  if (row.contextWindow === undefined) {
    return false;
  }
  const resolved = resolveContextWindow({ id: row.id });
  return resolved.source === 'family' && resolved.contextWindow === row.contextWindow;
};

export const createHeaderRow = (): HeaderRow => ({
  row: nextRow(),
  key: '',
  value: '',
});

export const createEmptyCustomProviderForm = (): CustomProviderFormState => ({
  providerID: '',
  name: '',
  baseURL: '',
  apiKey: '',
  models: [createModelRow()],
  headers: [createHeaderRow()],
});

function parseEnvApiKey(apiKey: string): { env?: string; key?: string } {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return {};
  }
  const envMatch = trimmed.match(ENV_KEY_PATTERN);
  const env = envMatch?.[1]?.trim();
  if (env) {
    return { env };
  }
  return { key: trimmed };
}

export function isCustomOpenAICompatibleProvider(provider: ProviderLikeForCustomForm): boolean {
  const options = provider.options && typeof provider.options === 'object' ? provider.options : null;
  const baseURL = typeof options?.baseURL === 'string' ? options.baseURL.trim() : '';
  if (baseURL && BASE_URL_PATTERN.test(baseURL)) {
    return true;
  }

  const models = Array.isArray(provider.models)
    ? provider.models
    : (provider.models && typeof provider.models === 'object'
      ? Object.values(provider.models)
      : []);

  return models.some((model) => {
    if (!model || typeof model !== 'object') {
      return false;
    }
    const api = 'api' in model && model.api && typeof model.api === 'object'
      ? model.api as { npm?: unknown }
      : null;
    return typeof api?.npm === 'string' && api.npm === CUSTOM_PROVIDER_NPM;
  });
}

export type ProviderConfigSourcesLike = {
  user?: { exists?: boolean };
  project?: { exists?: boolean };
  custom?: { exists?: boolean };
};

export type ProviderConfigScope = 'user' | 'project' | 'custom';

/**
 * True when a provider both looks OpenAI-compatible-custom and is defined in a
 * user/project/custom OpenCode config layer. Catalog-only providers often share
 * the same npm/baseURL signals and must not get Edit / config overrides.
 */
export function isConfigDefinedCustomProvider(
  provider: ProviderLikeForCustomForm,
  sources: ProviderConfigSourcesLike | null | undefined,
): boolean {
  if (!sources) {
    return false;
  }
  const inConfigLayer = Boolean(
    sources.user?.exists || sources.project?.exists || sources.custom?.exists,
  );
  return inConfigLayer && isCustomOpenAICompatibleProvider(provider);
}

/**
 * Effective writable config layer for a provider, matching OpenCode merge
 * precedence: custom > project > user.
 */
export function resolveProviderConfigScope(
  sources: ProviderConfigSourcesLike | null | undefined,
): ProviderConfigScope {
  if (sources?.custom?.exists) {
    return 'custom';
  }
  if (sources?.project?.exists) {
    return 'project';
  }
  return 'user';
}

export function providerToCustomFormState(provider: ProviderLikeForCustomForm): CustomProviderFormState {
  const options = provider.options && typeof provider.options === 'object' ? provider.options : {};
  const baseURL = typeof options.baseURL === 'string' ? options.baseURL : '';
  const headersRaw = options.headers && typeof options.headers === 'object' && !Array.isArray(options.headers)
    ? options.headers as Record<string, unknown>
    : {};
  const headerRows = Object.entries(headersRaw)
    .filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string')
    .map(([key, value]) => ({ row: nextRow(), key, value }));

  const modelEntries = Array.isArray(provider.models)
    ? provider.models
    : (provider.models && typeof provider.models === 'object'
      ? Object.entries(provider.models).map(([id, value]) => ({
          id,
          name: value && typeof value === 'object' && 'name' in value && typeof (value as { name?: unknown }).name === 'string'
            ? (value as { name: string }).name
            : id,
          contextWindow: readModelContextWindow(value),
        }))
      : []);

  const models = modelEntries.length > 0
    ? modelEntries.map((model) => ({
        row: nextRow(),
        id: typeof model?.id === 'string' ? model.id : '',
        name: typeof model?.name === 'string' ? model.name : (typeof model?.id === 'string' ? model.id : ''),
        contextWindow: readModelContextWindow(model) ?? (typeof model?.contextWindow === 'number' ? model.contextWindow : undefined),
      }))
    : [createModelRow()];

  const envName = Array.isArray(provider.env)
    ? provider.env.find((entry) => typeof entry === 'string' && entry.trim().length > 0)?.trim()
    : undefined;

  return {
    providerID: provider.id,
    name: typeof provider.name === 'string' && provider.name.trim() ? provider.name : provider.id,
    baseURL,
    apiKey: envName ? `{env:${envName}}` : '',
    models,
    headers: headerRows.length > 0 ? headerRows : [createHeaderRow()],
  };
}

/**
 * Validates form input and builds the auth + OpenCode provider config payloads.
 */
export function validateCustomProvider(input: ValidateCustomProviderInput): ValidateCustomProviderResult {
  const providerID = input.form.providerID.trim();
  const name = input.form.name.trim();
  const baseURL = input.form.baseURL.trim();
  const { env, key } = parseEnvApiKey(input.form.apiKey);
  const disabledProviders = input.disabledProviders ?? [];
  const editingProviderID = input.editingProviderID?.trim();

  const idError = !providerID
    ? input.t('settings.providers.page.custom.error.providerID.required')
    : !PROVIDER_ID_PATTERN.test(providerID)
      ? input.t('settings.providers.page.custom.error.providerID.format')
      : undefined;

  const nameError = !name
    ? input.t('settings.providers.page.custom.error.name.required')
    : undefined;

  const urlError = !baseURL
    ? input.t('settings.providers.page.custom.error.baseURL.required')
    : !BASE_URL_PATTERN.test(baseURL)
      ? input.t('settings.providers.page.custom.error.baseURL.format')
      : undefined;

  const credentialsSatisfied = Boolean(env || key || (editingProviderID && input.allowExistingAuth && editingProviderID === providerID));
  const apiKeyError = credentialsSatisfied
    ? undefined
    : input.t('settings.providers.page.custom.error.apiKey.required');

  const disabled = disabledProviders.includes(providerID);
  const isSelfEdit = Boolean(editingProviderID && editingProviderID === providerID);
  const existsError = idError || isSelfEdit
    ? undefined
    : input.existingProviderIDs.has(providerID) && !disabled
      ? input.t('settings.providers.page.custom.error.providerID.exists')
      : undefined;

  const seenModels = new Set<string>();
  const modelErrors = input.form.models.map((model) => {
    const id = model.id.trim();
    const modelIdError = !id
      ? input.t('settings.providers.page.custom.error.required')
      : seenModels.has(id)
        ? input.t('settings.providers.page.custom.error.duplicate')
        : (() => {
            seenModels.add(id);
            return undefined;
          })();
    const modelNameError = !model.name.trim()
      ? input.t('settings.providers.page.custom.error.required')
      : undefined;
    return { id: modelIdError, name: modelNameError };
  });

  const modelsValid = modelErrors.every((entry) => !entry.id && !entry.name);
  const modelConfig = Object.fromEntries(
    input.form.models.map((model) => {
      const contextWindow = readPositiveContextWindow(model.contextWindow);
      return [
        model.id.trim(),
        {
          name: model.name.trim(),
          ...(contextWindow !== undefined ? { contextWindow } : {}),
        },
      ];
    }),
  );

  const seenHeaders = new Set<string>();
  const headerErrors = input.form.headers.map((header) => {
    const headerKey = header.key.trim();
    const headerValue = header.value.trim();
    if (!headerKey && !headerValue) {
      return {};
    }
    const keyError = !headerKey
      ? input.t('settings.providers.page.custom.error.required')
      : seenHeaders.has(headerKey.toLowerCase())
        ? input.t('settings.providers.page.custom.error.duplicate')
        : (() => {
            seenHeaders.add(headerKey.toLowerCase());
            return undefined;
          })();
    const valueError = !headerValue
      ? input.t('settings.providers.page.custom.error.required')
      : undefined;
    return { key: keyError, value: valueError };
  });

  const headersValid = headerErrors.every((entry) => !entry.key && !entry.value);
  const headerConfig = Object.fromEntries(
    input.form.headers
      .map((header) => ({ key: header.key.trim(), value: header.value.trim() }))
      .filter((header) => header.key && header.value)
      .map((header) => [header.key, header.value]),
  );

  const err: FieldErrors = {
    providerID: idError ?? existsError,
    name: nameError,
    baseURL: urlError,
    apiKey: apiKeyError,
  };

  const ok = !idError && !existsError && !nameError && !urlError && !apiKeyError && modelsValid && headersValid;
  if (!ok) {
    return { err, models: modelErrors, headers: headerErrors };
  }

  return {
    err,
    models: modelErrors,
    headers: headerErrors,
    result: {
      providerID,
      name,
      apiKey: key,
      config: {
        npm: CUSTOM_PROVIDER_NPM,
        name,
        ...(env ? { env: [env] } : {}),
        options: {
          baseURL,
          ...(Object.keys(headerConfig).length > 0 ? { headers: headerConfig } : {}),
        },
        models: modelConfig,
      },
    },
  };
}

/**
 * Builds the OpenCode auth.set request body when a literal API key is present.
 */
export function buildAuthSetRequest(plan: CustomProviderPersistPlan): {
  providerID: string;
  auth: { type: 'api'; key: string };
} | null {
  if (!plan.apiKey) {
    return null;
  }
  return {
    providerID: plan.providerID,
    auth: { type: 'api', key: plan.apiKey },
  };
}

export type RemoteProviderModel = {
  id: string;
  name: string;
  contextWindow?: number;
};

export type FetchRemoteModelsRequest = {
  baseURL: string;
  apiKey?: string;
  headers?: Record<string, string>;
  providerID?: string;
};

export function buildFetchRemoteModelsRequest(
  form: CustomProviderFormState,
  options?: { allowExistingAuth?: boolean; editingProviderID?: string },
): { request: FetchRemoteModelsRequest } | { errorKey: string } {
  const baseURL = form.baseURL.trim();
  if (!baseURL) {
    return { errorKey: 'settings.providers.page.custom.error.fetch.baseURL' };
  }
  if (!BASE_URL_PATTERN.test(baseURL)) {
    return { errorKey: 'settings.providers.page.custom.error.baseURL.format' };
  }

  const { env, key } = parseEnvApiKey(form.apiKey);
  const providerID = form.providerID.trim();
  const canUseStoredAuth = Boolean(
    options?.allowExistingAuth
    && options.editingProviderID
    && options.editingProviderID === providerID,
  );
  if (!env && !key && !canUseStoredAuth) {
    return { errorKey: 'settings.providers.page.custom.error.fetch.apiKey' };
  }

  const headers = Object.fromEntries(
    form.headers
      .map((header) => ({ key: header.key.trim(), value: header.value.trim() }))
      .filter((header) => header.key && header.value)
      .map((header) => [header.key, header.value]),
  );

  return {
    request: {
      baseURL,
      ...(key || env ? { apiKey: form.apiKey.trim() } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(canUseStoredAuth ? { providerID } : {}),
    },
  };
}

export function parseRemoteProviderModelsPayload(payload: unknown): RemoteProviderModel[] | null {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { models?: unknown }).models)) {
    return null;
  }
  const models: RemoteProviderModel[] = [];
  const seen = new Set<string>();
  for (const item of (payload as { models: unknown[] }).models) {
    if (!item || typeof item !== 'object' || typeof (item as { id?: unknown }).id !== 'string') {
      continue;
    }
    const id = (item as { id: string }).id.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const rawName = (item as { name?: unknown }).name;
    const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : id;
    const resolved = resolveContextWindow({
      id,
      catalogContextWindow: item,
    });
    models.push({
      id,
      name,
      ...(resolved.contextWindow !== undefined ? { contextWindow: resolved.contextWindow } : {}),
    });
  }
  return models;
}

export const REMOTE_MODEL_FAMILIES = ['all', 'cc', 'gpt', 'grok', 'ds', 'other'] as const;
export type RemoteModelFamily = (typeof REMOTE_MODEL_FAMILIES)[number];

const hasToken = (haystack: string, token: string): boolean => {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack);
};

const includesAny = (haystack: string, needles: readonly string[]): boolean => (
  needles.some((needle) => haystack.includes(needle))
);

const hasAnyToken = (haystack: string, tokens: readonly string[]): boolean => (
  tokens.some((token) => hasToken(haystack, token))
);

/**
 * Family chips follow vendor product names, not 2-letter abbreviations.
 * OpenRouter groups by architecture (Claude / GPT / Grok / DeepSeek).
 * Anthropic, LiteLLM, and CC Switch identify Claude by role IDs
 * (opus / sonnet / haiku), including aliases like `opus-4-6` without a
 * `claude-` prefix. Short tokens such as `cc` or `ds` are not used.
 */
export function classifyRemoteModelFamily(
  model: Pick<RemoteProviderModel, 'id' | 'name'>,
): Exclude<RemoteModelFamily, 'all'> {
  const text = `${model.id} ${model.name}`.toLowerCase();
  if (includesAny(text, ['grok']) || hasAnyToken(text, ['x-ai', 'xai'])) {
    return 'grok';
  }
  if (includesAny(text, ['deepseek', 'deep-seek'])) {
    return 'ds';
  }
  if (includesAny(text, ['claude', 'anthropic']) || hasAnyToken(text, ['opus', 'sonnet', 'haiku'])) {
    return 'cc';
  }
  if (
    includesAny(text, ['gpt', 'openai', 'chatgpt', 'codex'])
    || /(^|[^a-z0-9])o[1-9]/.test(text)
  ) {
    return 'gpt';
  }
  return 'other';
}

export function filterRemoteModels(
  models: readonly RemoteProviderModel[],
  query: string,
  family: RemoteModelFamily = 'all',
): RemoteProviderModel[] {
  const needle = query.trim().toLowerCase();
  return models.filter((model) => {
    if (family !== 'all' && classifyRemoteModelFamily(model) !== family) {
      return false;
    }
    if (!needle) {
      return true;
    }
    return model.id.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle);
  });
}

function isWildcardRemoteModelId(id: string): boolean {
  return /[*?]/.test(id.trim());
}

/** Last path segment: `x-ai/grok-4.6` and `grok/grok-4.6` share `grok-4.6`. */
function remoteModelCanonicalId(id: string): string {
  const trimmed = id.trim();
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function remoteModelPrefix(id: string): string {
  const trimmed = id.trim();
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(0, slash).toLowerCase() : '';
}

/**
 * Only collapse a shared slug across known vendor aliases
 * (`x-ai/grok-4.6` + `grok-4.6`). `org-a/llama-3` and `org-b/llama-3` stay apart.
 */
const REMOTE_MODEL_PREFIX_FAMILIES: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['', 'x-ai', 'xai', 'grok']),
  new Set(['', 'openai', 'open-ai']),
  new Set(['', 'anthropic', 'claude']),
  new Set(['', 'deepseek', 'deep-seek']),
];

function remoteModelsShareAliasFamily(leftId: string, rightId: string): boolean {
  const left = remoteModelPrefix(leftId);
  const right = remoteModelPrefix(rightId);
  if (left === right) {
    return true;
  }
  return REMOTE_MODEL_PREFIX_FAMILIES.some((family) => family.has(left) && family.has(right));
}

function clusterRemoteModelsByAliasFamily(models: readonly RemoteProviderModel[]): RemoteProviderModel[][] {
  const clusters: RemoteProviderModel[][] = [];
  for (const model of models) {
    const existing = clusters.find((cluster) => (
      cluster.some((member) => remoteModelsShareAliasFamily(member.id, model.id))
    ));
    if (existing) {
      existing.push(model);
    } else {
      clusters.push([model]);
    }
  }
  return clusters;
}

const preferRemoteModelId = (ids: readonly string[]): string => (
  [...ids].sort((left, right) => {
    const leftPrefixed = left.includes('/') ? 1 : 0;
    const rightPrefixed = right.includes('/') ? 1 : 0;
    if (leftPrefixed !== rightPrefixed) {
      return leftPrefixed - rightPrefixed;
    }
    if (left.length !== right.length) {
      return left.length - right.length;
    }
    return left.localeCompare(right);
  })[0] ?? ids[0] ?? ''
);

export type RemoteModelChoice = {
  id: string;
  name: string;
  aliases: string[];
  contextWindow?: number;
};

/**
 * CC Switch groups a fetch by vendor and lets the user pick one ID.
 * Aggregators often repeat the same slug under `x-ai/`, `grok/`, and bare IDs.
 * Collapse those, drop glob IDs like `claude-*`, and keep the shortest bare ID.
 */
export function collapseRemoteModels(
  models: readonly RemoteProviderModel[],
): RemoteModelChoice[] {
  const groups = new Map<string, RemoteProviderModel[]>();
  for (const model of models) {
    if (isWildcardRemoteModelId(model.id)) {
      continue;
    }
    const key = remoteModelCanonicalId(model.id).toLowerCase();
    if (!key) {
      continue;
    }
    const group = groups.get(key) ?? [];
    group.push(model);
    groups.set(key, group);
  }

  return [...groups.values()]
    .flatMap((group) => clusterRemoteModelsByAliasFamily(group))
    .map((group) => {
      const ids = [...new Set(group.map((model) => model.id))];
      const id = preferRemoteModelId(ids);
      const named = group.find((model) => model.name.trim() && model.name.trim() !== model.id);
      const catalog = group.find((model) => readPositiveContextWindow(model.contextWindow) !== undefined);
      const resolved = resolveContextWindow({
        id,
        catalogContextWindow: catalog?.contextWindow,
      });
      return {
        id,
        name: named?.name.trim() || group.find((model) => model.id === id)?.name || id,
        aliases: ids.filter((alias) => alias !== id).sort((left, right) => left.localeCompare(right)),
        ...(resolved.contextWindow !== undefined ? { contextWindow: resolved.contextWindow } : {}),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export type RemoteModelFamilyCounts = Record<Exclude<RemoteModelFamily, 'all'>, number>;

export function prepareRemoteModelPicker(
  models: readonly RemoteProviderModel[],
  query = '',
  family: RemoteModelFamily = 'all',
): {
  choices: RemoteModelChoice[];
  familyCounts: RemoteModelFamilyCounts;
  fetchedCount: number;
  uniqueCount: number;
} {
  const collapsed = collapseRemoteModels(models);
  const familyCounts: RemoteModelFamilyCounts = {
    cc: 0,
    gpt: 0,
    grok: 0,
    ds: 0,
    other: 0,
  };
  for (const choice of collapsed) {
    familyCounts[classifyRemoteModelFamily(choice)] += 1;
  }
  const needle = query.trim().toLowerCase();
  const choices = collapsed.filter((choice) => {
    if (family !== 'all' && classifyRemoteModelFamily(choice) !== family) {
      return false;
    }
    if (!needle) {
      return true;
    }
    return [choice.id, choice.name, ...choice.aliases].some((value) => value.toLowerCase().includes(needle));
  });
  return {
    choices,
    familyCounts,
    fetchedCount: models.length,
    uniqueCount: collapsed.length,
  };
}

export function remoteModelAlreadyAdded(current: readonly ModelRow[], modelId: string): boolean {
  const id = modelId.trim();
  if (!id) {
    return false;
  }
  const canonical = remoteModelCanonicalId(id).toLowerCase();
  return current.some((row) => {
    const rowId = row.id.trim();
    if (!rowId || rowId === id) {
      return Boolean(rowId);
    }
    if (remoteModelCanonicalId(rowId).toLowerCase() !== canonical) {
      return false;
    }
    return remoteModelsShareAliasFamily(rowId, id);
  });
}

const isBlankModelRow = (row: ModelRow): boolean => (
  !row.id.trim() && !row.name.trim() && row.contextWindow === undefined && !row.contextTouched
);

/**
 * Appends chosen remote models. Fetch must not replace the form list.
 * A single blank starter row is replaced so the first add does not leave an empty slot.
 */
export function addRemoteModelsToForm(
  current: readonly ModelRow[],
  selected: readonly RemoteProviderModel[],
): ModelRow[] {
  const added: ModelRow[] = [];
  const seen = current.map((row) => ({ ...row }));
  for (const model of selected) {
    const id = model.id.trim();
    if (!id || remoteModelAlreadyAdded(seen, id) || remoteModelAlreadyAdded(added, id)) {
      continue;
    }
    const resolved = resolveContextWindow({
      id,
      catalogContextWindow: model.contextWindow,
    });
    const row = {
      row: nextRow(),
      id,
      name: model.name.trim() || id,
      ...(resolved.contextWindow !== undefined ? { contextWindow: resolved.contextWindow } : {}),
    };
    added.push(row);
    seen.push(row);
  }
  if (added.length === 0) {
    return current.length > 0 ? [...current] : [createModelRow()];
  }
  const kept = current.filter((row) => !isBlankModelRow(row));
  const next = [...kept, ...added];
  return next.length > 0 ? next : [createModelRow()];
}

export function fetchRemoteModelsErrorKey(status: number, code?: string): string {
  if (code === 'unauthorized' || status === 401 || status === 403) {
    return 'settings.providers.page.custom.error.fetch.unauthorized';
  }
  if (code === 'unsupported' || status === 404 || status === 405) {
    return 'settings.providers.page.custom.error.fetch.unsupported';
  }
  if (code === 'invalid' || status === 400) {
    return 'settings.providers.page.custom.error.fetch.failed';
  }
  return 'settings.providers.page.custom.error.fetch.failed';
}

/**
 * Builds the OpenChamber provider upsert request body (config persistence).
 * `scope` selects the OpenCode config layer (user/project/custom). Create
 * defaults to user; edit must pass the provider's effective existing layer.
 */
export function buildProviderUpsertRequest(
  plan: CustomProviderPersistPlan,
  options?: { scope?: ProviderConfigScope },
): {
  providerID: string;
  config: CustomProviderConfig;
  scope: ProviderConfigScope;
} {
  return {
    providerID: plan.providerID,
    config: plan.config,
    scope: options?.scope ?? 'user',
  };
}
