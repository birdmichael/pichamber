import type { ModelPickerProvider } from '@/components/model-picker/ModelPickerList';
import { runtimeFetch } from '@/lib/runtime-fetch';

type PiRuntimeModelsLoad =
  | { ok: true; providers: ModelPickerProvider[]; enabledModels: string[] }
  | { ok: false };

type PiCatalogModel = {
  id?: unknown;
  name?: unknown;
  displayName?: unknown;
};

type PiCatalogProvider = {
  id?: unknown;
  name?: unknown;
  models?: unknown;
};

type CatalogModel = {
  id: string;
  name?: string;
  sourceKeys: string[];
};

export type PiEnabledModelRow = {
  key: string;
  label: string;
  providerId: string;
  modelId: string;
  aliases: string[];
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

const catalogModelName = (record: PiCatalogModel | undefined): string | undefined => {
  return asNonEmptyString(record?.name) ?? asNonEmptyString(record?.displayName) ?? undefined;
};

const isModelEnabled = (providerId: string, modelId: string, enabledModels: string[]): boolean => {
  if (enabledModels.length === 0) return true;
  return enabledModels.includes(modelId) || enabledModels.includes(`${providerId}/${modelId}`);
};

const toCatalogModels = (models: unknown): CatalogModel[] => {
  if (Array.isArray(models)) {
    return models.flatMap((model) => {
      if (!model || typeof model !== 'object') return [];
      const record = model as PiCatalogModel;
      const id = asNonEmptyString(record.id);
      if (!id) return [];
      const name = catalogModelName(record);
      return [{ id, sourceKeys: [id], ...(name ? { name } : {}) }];
    });
  }

  if (!models || typeof models !== 'object') return [];

  return Object.entries(models as Record<string, PiCatalogModel | undefined>).flatMap(([key, model]) => {
    const sourceKey = asNonEmptyString(key);
    const id = asNonEmptyString(model?.id) ?? sourceKey;
    if (!id) return [];
    const name = catalogModelName(model) ?? (sourceKey && sourceKey !== id ? sourceKey : undefined);
    const sourceKeys = [id, sourceKey].filter((item): item is string => Boolean(item));
    return [{ id, sourceKeys, ...(name ? { name } : {}) }];
  });
};

const hasDistinctDisplayName = (model: { id: string; name?: string }): boolean => (
  Boolean(model.name && model.name !== model.id)
);

const preferCanonicalModel = (left: CatalogModel, right: CatalogModel): CatalogModel => {
  const leftNamed = hasDistinctDisplayName(left);
  const rightNamed = hasDistinctDisplayName(right);
  if (leftNamed !== rightNamed) {
    return leftNamed ? left : right;
  }
  const leftSpaced = /\s/.test(left.id);
  const rightSpaced = /\s/.test(right.id);
  if (leftSpaced !== rightSpaced) {
    return leftSpaced ? right : left;
  }
  return left;
};

/**
 * Same provider+id is one model. A row whose id is the other row's display
 * name (and which has no separate identity of its own) is that same model,
 * not a second catalog entry. Different ids stay separate even when names
 * look similar.
 */
const isSameCatalogModel = (left: CatalogModel, right: CatalogModel): boolean => {
  if (left.id === right.id) return true;
  const leftName = left.name ?? left.id;
  const rightName = right.name ?? right.id;
  if (right.id === leftName && (rightName === leftName || rightName === left.id)) return true;
  if (left.id === rightName && (leftName === rightName || leftName === right.id)) return true;
  return false;
};

const uniqueCatalogModels = (models: CatalogModel[]): CatalogModel[] => {
  const unique: CatalogModel[] = [];
  for (const model of models) {
    const index = unique.findIndex((existing) => isSameCatalogModel(existing, model));
    if (index < 0) {
      unique.push({
        id: model.id,
        sourceKeys: [...new Set(model.sourceKeys)],
        ...(model.name ? { name: model.name } : {}),
      });
      continue;
    }

    const existing = unique[index];
    const winner = preferCanonicalModel(existing, model);
    const name = (winner.name && winner.name !== winner.id)
      ? winner.name
      : (existing.name && existing.name !== winner.id)
        ? existing.name
        : (model.name && model.name !== winner.id)
          ? model.name
          : winner.name ?? existing.name ?? model.name;
    unique[index] = {
      id: winner.id,
      sourceKeys: [...new Set([...existing.sourceKeys, ...model.sourceKeys, existing.id, model.id])],
      ...(name ? { name } : {}),
    };
  }
  return unique;
};

const rowAliases = (providerId: string, model: CatalogModel): string[] => {
  const aliases = new Set<string>();
  for (const token of [model.id, ...model.sourceKeys]) {
    if (!token) continue;
    aliases.add(token);
    aliases.add(`${providerId}/${token}`);
  }
  aliases.delete(`${providerId}/${model.id}`);
  return [...aliases].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
};

export const listPiEnabledModelRows = (catalog: unknown): PiEnabledModelRow[] => {
  const providers = catalog && typeof catalog === 'object' && Array.isArray((catalog as { providers?: unknown }).providers)
    ? (catalog as { providers: PiCatalogProvider[] }).providers
    : [];

  const rows: PiEnabledModelRow[] = [];
  const seen = new Set<string>();
  for (const provider of providers) {
    const providerId = asNonEmptyString(provider?.id);
    if (!providerId) continue;
    for (const model of uniqueCatalogModels(toCatalogModels(provider.models))) {
      const key = `${providerId}/${model.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        key,
        label: model.name || model.id,
        providerId,
        modelId: model.id,
        aliases: rowAliases(providerId, model),
      });
    }
  }
  return rows;
};

export const isPiEnabledModelRowChecked = (
  row: Pick<PiEnabledModelRow, 'key' | 'providerId' | 'modelId' | 'aliases'>,
  enabledModels: string[],
): boolean => {
  if (enabledModels.length === 0) return true;
  if (isModelEnabled(row.providerId, row.modelId, enabledModels)) {
    return true;
  }
  return row.aliases.some((alias) => enabledModels.includes(alias));
};

export const nextPiEnabledModels = (
  rows: readonly PiEnabledModelRow[],
  enabledModels: string[],
  row: PiEnabledModelRow,
  nextChecked: boolean,
): string[] => {
  const identity = new Set([row.key, row.modelId, ...row.aliases]);
  const current = (enabledModels.length === 0 ? rows.map((item) => item.key) : enabledModels)
    .filter((item) => !identity.has(item));
  const next = nextChecked ? [...current, row.key] : current;
  const enabledKeys = rows
    .filter((item) => isPiEnabledModelRowChecked(item, next))
    .map((item) => item.key);
  if (enabledKeys.length === 0 || enabledKeys.length === rows.length) {
    return [];
  }
  return enabledKeys;
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
    const models = uniqueCatalogModels(toCatalogModels(provider.models))
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
