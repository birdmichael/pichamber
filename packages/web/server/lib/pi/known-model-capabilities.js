import { getCachedModelsMetadata } from '../opencode/models-metadata.js';

const VENDOR_MODEL_ID_PREFIXES = [
  'x-ai/',
  'xai/',
  'openai/',
  'anthropic/',
  'google/',
  'deepseek/',
];

const KNOWN_VISION_MODEL_IDS = new Set([
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
  'claude-fable-5',
  'claude-mythos-5',
  'claude-mythos-preview',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'opus-4-8',
  'opus-4-7',
  'opus-4-6',
  'opus-4.6',
  'opus-5',
  'sonnet-4-6',
  'sonnet-4.6',
  'sonnet-5',
  'fable-5',
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-5',
  'claude-sonnet-4-5-20250929',
  'claude-opus-4-5',
  'claude-opus-4-5-20251101',
  'claude-sonnet-4',
  'claude-opus-4',
  'claude-opus-4-1',
  'claude-3-5-sonnet',
  'claude-3-5-haiku',
  'claude-3-7-sonnet',
  'haiku-4-5',
  'haiku-4.5',
  'sonnet-4-5',
  'sonnet-4.5',
  'opus-4-5',
  'opus-4.5',
  'grok-4.6',
  'grok-4.5',
  'grok-4.5-latest',
  'grok-4.3',
  'grok-4.3-latest',
  'grok-4.20-0309-reasoning',
  'grok-4.20-0309-non-reasoning',
  'grok-4.20-multi-agent-0309',
  'grok-build-0.1',
  'grok-build-latest',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash-lite-preview-06-17',
]);

/** GPT-5.5/5.6/6 custom-proxy ids. Exact set still wins for older names. */
const KNOWN_VISION_ID_PREFIXES = [
  'gpt-6-',
  'gpt-5.6-',
  'gpt-5.5-',
];

const KNOWN_REASONING_MODEL_IDS = new Set([
  'claude-fable-5',
  'claude-mythos-5',
  'claude-mythos-preview',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'opus-4-8',
  'opus-4-7',
  'opus-4-6',
  'opus-4.6',
  'opus-5',
  'sonnet-4-6',
  'sonnet-4.6',
  'sonnet-5',
  'fable-5',
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-5',
  'claude-sonnet-4-5-20250929',
  'claude-opus-4-5',
  'claude-opus-4-5-20251101',
  'claude-sonnet-4',
  'claude-opus-4',
  'claude-opus-4-1',
  'claude-3-7-sonnet',
  'haiku-4-5',
  'haiku-4.5',
  'sonnet-4-5',
  'sonnet-4.5',
  'opus-4-5',
  'opus-4.5',
  'grok-4.6',
  'grok-4.5',
  'grok-4.5-latest',
  'grok-4.3',
  'grok-4.3-latest',
  'grok-4.20-0309-reasoning',
  'grok-4.20-multi-agent-0309',
  'grok-build-0.1',
  'grok-build-latest',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash-lite-preview-06-17',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-reasoner',
  'gpt-5.5',
  'o1',
  'o3',
  'o4',
]);

const KNOWN_REASONING_ID_PREFIXES = [
  'gpt-6-',
  'gpt-5.6-',
  'gpt-5.5-',
  'o1-',
  'o3-',
  'o4-',
];

const matchesKnownIdPrefix = (normalized, prefixes) => {
  if (!normalized) return false;
  return prefixes.some((prefix) => {
    if (normalized.startsWith(prefix)) return true;
    return prefix.endsWith('-') && normalized === prefix.slice(0, -1);
  });
};

export const normalizeKnownModelId = (id) => {
  let next = typeof id === 'string' ? id.trim().toLowerCase() : '';
  if (!next) return '';
  for (const prefix of VENDOR_MODEL_ID_PREFIXES) {
    if (next.startsWith(prefix)) {
      next = next.slice(prefix.length);
      break;
    }
  }
  return next;
};

export const lookupKnownVisionInput = (id) => {
  const normalized = normalizeKnownModelId(id);
  if (!normalized) return undefined;
  if (KNOWN_VISION_MODEL_IDS.has(normalized) || matchesKnownIdPrefix(normalized, KNOWN_VISION_ID_PREFIXES)) {
    return ['text', 'image'];
  }
  return undefined;
};

export const lookupKnownReasoning = (id) => {
  const normalized = normalizeKnownModelId(id);
  if (!normalized) return undefined;
  if (KNOWN_REASONING_MODEL_IDS.has(normalized) || matchesKnownIdPrefix(normalized, KNOWN_REASONING_ID_PREFIXES)) {
    return true;
  }
  return undefined;
};

const isDefaultTextInput = (input) => (
  Array.isArray(input) && input.length === 1 && input[0] === 'text'
);

const catalogVendorScore = (providerId) => (
  new Set(['openai', 'anthropic', 'xai', 'x-ai', 'google', 'deepseek']).has(
    String(providerId || '').trim().toLowerCase(),
  ) ? 2 : 1
);

const normalizeCatalogModelId = (id) => normalizeKnownModelId(id);

/**
 * Find the best models.dev row for a model slug. Custom providers commonly
 * use `vendor/model`, so matching intentionally ignores the vendor prefix.
 */
export const lookupCatalogModel = (id, catalog) => {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) return undefined;
  const wanted = normalizeCatalogModelId(id);
  if (!wanted) return undefined;
  let best;
  let bestScore = -1;
  for (const [providerKey, provider] of Object.entries(catalog)) {
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) continue;
    const providerId = typeof provider.id === 'string' && provider.id.trim() ? provider.id : providerKey;
    const models = provider.models;
    if (!models || typeof models !== 'object' || Array.isArray(models)) continue;
    for (const [modelKey, rawModel] of Object.entries(models)) {
      if (!rawModel || typeof rawModel !== 'object' || Array.isArray(rawModel)) continue;
      const modelId = typeof rawModel.id === 'string' && rawModel.id.trim() ? rawModel.id : modelKey;
      if (normalizeCatalogModelId(modelId) !== wanted) continue;
      const score = catalogVendorScore(providerId);
      if (score > bestScore) {
        best = rawModel;
        bestScore = score;
      }
    }
  }
  return best;
};

const catalogInput = (entry) => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
  if (Array.isArray(entry.input)) {
    const input = entry.input.filter((value) => value === 'text' || value === 'image');
    if (input.length > 0) return [...new Set(input)];
  }
  const modalities = entry.modalities?.input;
  if (Array.isArray(modalities) && modalities.some((value) => String(value).toLowerCase() === 'image')) {
    return ['text', 'image'];
  }
  if (entry.attachment === true) return ['text', 'image'];
  return undefined;
};

const catalogReasoning = (entry) => (
  entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.reasoning === 'boolean'
    ? entry.reasoning
    : undefined
);

export const enrichKnownModelEntry = (id, model = {}, options = {}) => {
  const next = model && typeof model === 'object' && !Array.isArray(model) ? { ...model } : {};
  const hasExplicitCatalog = Object.prototype.hasOwnProperty.call(options, 'catalog');
  const catalog = hasExplicitCatalog ? options.catalog : getCachedModelsMetadata();
  const hasCatalog = Boolean(catalog);
  const catalogEntry = hasCatalog ? lookupCatalogModel(id, catalog) : undefined;
  // A fetched catalog is authoritative: hardcoded tables are only used when
  // the catalog could not be fetched at all.
  const vision = catalogEntry ? catalogInput(catalogEntry) : (hasCatalog ? undefined : lookupKnownVisionInput(id));
  const reasoning = catalogEntry ? catalogReasoning(catalogEntry) : (hasCatalog ? undefined : lookupKnownReasoning(id));
  let changed = false;
  if (vision && (!Array.isArray(next.input) || isDefaultTextInput(next.input))) {
    next.input = vision;
    changed = true;
  }
  if (reasoning === true && next.reasoning !== true) {
    next.reasoning = true;
    changed = true;
  }
  return { model: next, changed };
};
