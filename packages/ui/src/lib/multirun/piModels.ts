import type { ModelPickerProvider } from '@/components/model-picker/ModelPickerList';
import { runtimeFetch } from '@/lib/runtime-fetch';

type PiRuntimeModelsLoad =
  | { ok: true; providers: ModelPickerProvider[]; enabledModels: string[] }
  | { ok: false };

type PiCatalogModel = {
  id?: unknown;
  name?: unknown;
};

type PiCatalogProvider = {
  id?: unknown;
  name?: unknown;
  models?: unknown;
};

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeEnabledModels = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const key = asNonEmptyString(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
};

const isModelEnabled = (providerId: string, modelId: string, enabledModels: string[]): boolean => {
  if (enabledModels.length === 0) return true;
  return enabledModels.includes(modelId) || enabledModels.includes(`${providerId}/${modelId}`);
};

const toCatalogModels = (models: unknown): Array<{ id: string; name?: string }> => {
  if (Array.isArray(models)) {
    return models.flatMap((model) => {
      if (!model || typeof model !== 'object') return [];
      const record = model as PiCatalogModel;
      const id = asNonEmptyString(record.id);
      if (!id) return [];
      const name = asNonEmptyString(record.name) ?? undefined;
      return [{ id, ...(name ? { name } : {}) }];
    });
  }

  if (!models || typeof models !== 'object') return [];

  return Object.entries(models as Record<string, PiCatalogModel | undefined>).flatMap(([key, model]) => {
    const id = asNonEmptyString(model?.id) ?? asNonEmptyString(key);
    if (!id) return [];
    const name = asNonEmptyString(model?.name) ?? undefined;
    return [{ id, ...(name ? { name } : {}) }];
  });
};

export const toPiRuntimeModelProviders = (
  catalog: unknown,
  enabledModels: string[] = [],
): ModelPickerProvider[] => {
  const providers = catalog && typeof catalog === 'object' && Array.isArray((catalog as { providers?: unknown }).providers)
    ? (catalog as { providers: PiCatalogProvider[] }).providers
    : [];

  return providers.flatMap((provider) => {
    const id = asNonEmptyString(provider?.id);
    if (!id) return [];
    const models = toCatalogModels(provider.models)
      .filter((model) => isModelEnabled(id, model.id, enabledModels))
      .map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
      }));
    if (models.length === 0) return [];
    const name = asNonEmptyString(provider.name) ?? id;
    return [{ id, name, models }];
  });
};

export const loadPiRuntimeModels = async (
  fetchFn: typeof runtimeFetch = runtimeFetch,
): Promise<PiRuntimeModelsLoad> => {
  try {
    const [modelsResponse, defaultsResponse] = await Promise.all([
      fetchFn('/api/pi/models', { method: 'GET', headers: { Accept: 'application/json' } }),
      fetchFn('/api/pi/defaults', { method: 'GET', headers: { Accept: 'application/json' } }),
    ]);

    if (!modelsResponse.ok) {
      return { ok: false };
    }

    const catalog: unknown = await modelsResponse.json();
    let enabledModels: string[] = [];
    if (defaultsResponse.ok) {
      try {
        const defaults: unknown = await defaultsResponse.json();
        enabledModels = normalizeEnabledModels(
          defaults && typeof defaults === 'object'
            ? (defaults as { enabledModels?: unknown }).enabledModels
            : [],
        );
      } catch {
        enabledModels = [];
      }
    }

    return {
      ok: true,
      providers: toPiRuntimeModelProviders(catalog, enabledModels),
      enabledModels,
    };
  } catch {
    return { ok: false };
  }
};
