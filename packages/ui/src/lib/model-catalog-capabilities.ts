import {
  normalizeModelId,
  PUBLISHED_INPUT_CONTEXT_WINDOWS,
} from '@/lib/model-context-windows';
import type { ModelMetadata } from '@/types';

/**
 * Common-model capabilities for custom providers.
 *
 * Chamber looks up models.dev by official `provider/model`. A custom proxy
 * (`bmlab/grok-4.6`) misses that key, so we also look up by normalized model
 * id. Persist writes Pi `input` / `reasoning` so the kernel actually sends
 * images — UI metadata alone cannot.
 *
 * Authority: user explicit > catalog unanimous for that slug > published table
 * for a known id > omit (Pi defaults to text / no reasoning). Never invent a
 * capability for an unknown id.
 */

const VENDOR_PROVIDER_IDS = new Set([
  'openai',
  'anthropic',
  'xai',
  'x-ai',
  'google',
  'deepseek',
]);

/** Hosted DeepSeek chat APIs are text-only in current vendor docs. */
const PUBLISHED_TEXT_ONLY_IDS = new Set([
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-chat',
  'deepseek-reasoner',
]);

const PUBLISHED_NON_REASONING_IDS = new Set([
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4o-2024-05-13',
  'gpt-4o-2024-08-06',
  'gpt-4o-2024-11-20',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4.1-2025-04-14',
  'gpt-4.1-mini-2025-04-14',
  'gpt-4.1-nano-2025-04-14',
  'deepseek-chat',
  'grok-4.20-0309-non-reasoning',
]);

export type CatalogCapabilityEntry = {
  id: string;
  providerId?: string;
  attachment?: boolean;
  reasoning?: boolean;
  modalities?: {
    input?: string[];
  };
};

export type ResolvedModelCapabilities = {
  image?: boolean;
  reasoning?: boolean;
};

const hasImageInput = (entry: CatalogCapabilityEntry): boolean | undefined => {
  const input = entry.modalities?.input;
  if (Array.isArray(input)) {
    return input.some((item) => item.trim().toLowerCase() === 'image');
  }
  if (typeof entry.attachment === 'boolean') {
    return entry.attachment;
  }
  return undefined;
};

const hasReasoning = (entry: CatalogCapabilityEntry): boolean | undefined => {
  if (typeof entry.reasoning === 'boolean') {
    return entry.reasoning;
  }
  return undefined;
};

export const catalogEntriesFromMetadataMap = (
  catalog: Map<string, ModelMetadata> | Iterable<ModelMetadata>,
): CatalogCapabilityEntry[] => {
  const values = catalog instanceof Map ? catalog.values() : catalog;
  const entries: CatalogCapabilityEntry[] = [];
  for (const item of values) {
    if (!item || typeof item.id !== 'string' || !item.id.trim()) continue;
    entries.push({
      id: item.id,
      providerId: item.providerId,
      attachment: item.attachment,
      reasoning: item.reasoning,
      modalities: item.modalities,
    });
  }
  return entries;
};

const officialVendorScore = (entry: CatalogCapabilityEntry): number => {
  const provider = (entry.providerId ?? '').trim().toLowerCase();
  if (VENDOR_PROVIDER_IDS.has(provider)) return 2;
  return 1;
};

export const findCatalogMetadata = (
  catalog: Map<string, ModelMetadata>,
  providerId: string,
  modelId: string,
): ModelMetadata | undefined => {
  const exactKey = `${providerId.trim().toLowerCase()}/${modelId}`;
  const exact = catalog.get(exactKey);
  if (exact) return exact;

  const wanted = normalizeModelId(modelId);
  if (!wanted) return undefined;

  let best: ModelMetadata | undefined;
  let bestScore = -1;
  for (const [key, entry] of catalog) {
    const entryId = entry.id || key.slice(key.indexOf('/') + 1);
    if (normalizeModelId(entryId) !== wanted) continue;
    const score = officialVendorScore({
      id: entryId,
      providerId: entry.providerId || key.split('/')[0],
    });
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
};

export const lookupPublishedImageInput = (modelId: string): boolean | undefined => {
  const normalized = normalizeModelId(modelId);
  if (!normalized || PUBLISHED_INPUT_CONTEXT_WINDOWS[normalized] === undefined) {
    return undefined;
  }
  return !PUBLISHED_TEXT_ONLY_IDS.has(normalized);
};

export const lookupPublishedReasoning = (modelId: string): boolean | undefined => {
  const normalized = normalizeModelId(modelId);
  if (!normalized || PUBLISHED_INPUT_CONTEXT_WINDOWS[normalized] === undefined) {
    return undefined;
  }
  return !PUBLISHED_NON_REASONING_IDS.has(normalized);
};

const unanimousFlag = (
  entries: CatalogCapabilityEntry[],
  read: (entry: CatalogCapabilityEntry) => boolean | undefined,
): boolean | undefined => {
  const known = entries
    .map(read)
    .filter((value): value is boolean => typeof value === 'boolean');
  if (known.length === 0) return undefined;
  if (known.every((value) => value)) return true;
  if (known.every((value) => !value)) return false;
  return undefined;
};

export const resolveCatalogCapabilities = (
  modelId: string,
  catalog: readonly CatalogCapabilityEntry[] = [],
): ResolvedModelCapabilities => {
  const wanted = normalizeModelId(modelId);
  const matches = wanted
    ? catalog.filter((entry) => normalizeModelId(entry.id) === wanted)
    : [];
  return {
    image: unanimousFlag(matches, hasImageInput),
    reasoning: unanimousFlag(matches, hasReasoning),
  };
};

/**
 * Values to persist on a custom-model row. Explicit user/catalog-row values
 * win. Otherwise a unanimous models.dev slug, then the published id table.
 * False stays omitted so Pi keeps its default.
 */
export const resolvePersistedImageInput = (input: {
  id: string;
  image?: boolean;
  catalog?: readonly CatalogCapabilityEntry[];
}): true | undefined => {
  if (input.image === true) return true;
  if (input.image === false) return undefined;
  const catalog = resolveCatalogCapabilities(input.id, input.catalog).image;
  if (catalog === true) return true;
  if (lookupPublishedImageInput(input.id) === true) return true;
  return undefined;
};

export const resolvePersistedReasoning = (input: {
  id: string;
  reasoning?: boolean;
  catalog?: readonly CatalogCapabilityEntry[];
}): true | undefined => {
  if (input.reasoning === true) return true;
  if (input.reasoning === false) return undefined;
  const catalog = resolveCatalogCapabilities(input.id, input.catalog).reasoning;
  if (catalog === true) return true;
  if (lookupPublishedReasoning(input.id) === true) return true;
  return undefined;
};

export const piInputFromImage = (image: true | undefined): ['text', 'image'] | undefined => (
  image === true ? ['text', 'image'] : undefined
);
