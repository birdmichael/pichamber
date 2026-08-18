import {
  isPiDefaultTextInput,
  lookupExactVisionInput,
  normalizeModelId,
  PI_TEXT_IMAGE_INPUT,
  PUBLISHED_INPUT_CONTEXT_WINDOWS,
  readPersistedModelInput,
  type PiModelInputType,
} from '@/lib/model-context-windows';
import type { PiThinkingLevel } from '@/components/chat/piThinking';
import { parsePiThinkingLevel } from '@/components/chat/piThinking';
import type { ModelMetadata } from '@/types';

/**
 * Common-model capabilities for custom providers.
 *
 * Chamber looks up models.dev by official `provider/model`. A custom proxy
 * (`bmlab/grok-4.6`) misses that key, so we also look up by normalized model
 * id. Persist and live reads write Pi `input` / `reasoning` so the kernel
 * actually sends images — UI metadata alone cannot.
 *
 * Authority: user explicit > catalog unanimous for that slug > published
 * table for a known id > omit (Pi defaults to text / no reasoning).
 */

const VENDOR_PROVIDER_IDS = new Set([
  'openai',
  'anthropic',
  'xai',
  'x-ai',
  'google',
  'deepseek',
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
  input?: unknown;
  modalities?: {
    input?: string[];
  };
  reasoning_options?: unknown;
};

export type ResolvedModelCapabilities = {
  image?: boolean;
  reasoning?: boolean;
};

const hasImageInput = (entry: CatalogCapabilityEntry): boolean | undefined => {
  const persisted = readPersistedModelInput(entry.input);
  if (persisted) {
    return persisted.includes('image');
  }
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
      reasoning_options: item.reasoning_options,
    });
  }
  return entries;
};

const officialVendorScore = (entry: CatalogCapabilityEntry): number => {
  const provider = (entry.providerId ?? '').trim().toLowerCase();
  return VENDOR_PROVIDER_IDS.has(provider) ? 2 : 1;
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

export const resolvePersistedImageInput = (input: {
  id: string;
  input?: unknown;
  catalog?: readonly CatalogCapabilityEntry[];
}): PiModelInputType[] | undefined => {
  const user = readPersistedModelInput(input.input);
  if (user !== undefined && !isPiDefaultTextInput(user)) {
    return user;
  }
  if (resolveCatalogCapabilities(input.id, input.catalog).image === true) {
    return [...PI_TEXT_IMAGE_INPUT];
  }
  const known = lookupExactVisionInput(input.id);
  return known ? [...known] : undefined;
};

const EFFORT_TO_PI: Record<string, PiThinkingLevel> = {
  none: 'off',
  off: 'off',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
};

const readEffortValues = (options: unknown): string[] => {
  if (!Array.isArray(options)) return [];
  const values: string[] = [];
  for (const option of options) {
    if (!option || typeof option !== 'object' || Array.isArray(option)) continue;
    const record = option as { type?: unknown; values?: unknown };
    if (record.type !== 'effort' || !Array.isArray(record.values)) continue;
    for (const value of record.values) {
      if (typeof value === 'string' && value.trim()) values.push(value.trim().toLowerCase());
    }
  }
  return values;
};

const hasToggleOption = (options: unknown): boolean => (
  Array.isArray(options)
  && options.some((option) => option && typeof option === 'object' && !Array.isArray(option) && (option as { type?: unknown }).type === 'toggle')
);

/**
 * Draft / no-session thinking list from models.dev `reasoning_options`.
 * Live sessions still prefer `getAvailableThinkingLevels()`.
 * Missing effort values stay omitted — do not invent seven levels.
 */
export const resolveCatalogThinkingLevels = (
  metadata: Pick<ModelMetadata, 'reasoning' | 'reasoning_options'> | undefined,
): PiThinkingLevel[] => {
  if (!metadata) return [];
  const efforts = readEffortValues(metadata.reasoning_options);
  const levels: PiThinkingLevel[] = [];
  const seen = new Set<PiThinkingLevel>();
  const push = (level: PiThinkingLevel) => {
    if (seen.has(level)) return;
    seen.add(level);
    levels.push(level);
  };
  if (efforts.length > 0) {
    for (const effort of efforts) {
      const mapped = EFFORT_TO_PI[effort] ?? parsePiThinkingLevel(effort);
      if (mapped) push(mapped);
    }
    if (hasToggleOption(metadata.reasoning_options) && !seen.has('off')) {
      return ['off', ...levels];
    }
    return levels;
  }
  if (hasToggleOption(metadata.reasoning_options) && metadata.reasoning === true) {
    return ['off', 'medium'];
  }
  return [];
};

export const resolvePersistedReasoning = (input: {
  id: string;
  reasoning?: unknown;
  catalog?: readonly CatalogCapabilityEntry[];
}): true | undefined => {
  if (input.reasoning === true) return true;
  if (input.reasoning === false) return undefined;
  if (resolveCatalogCapabilities(input.id, input.catalog).reasoning === true) {
    return true;
  }
  return lookupPublishedReasoning(input.id) === true ? true : undefined;
};
