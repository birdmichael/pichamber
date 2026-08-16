/**
 * Published input context windows keyed by exact model id.
 *
 * Numbers are vendor-published INPUT limits verified against current (2026)
 * docs. A family comment is not the source of truth — only the id table is.
 *
 * Sources:
 * - OpenAI: https://developers.openai.com/api/docs/models/gpt-4o (128k)
 *   and https://developers.openai.com/api/docs/models/gpt-4.1 (1,047,576)
 * - Anthropic: https://platform.claude.com/docs/en/about-claude/models/overview
 *   and https://platform.claude.com/docs/en/build-with-claude/context-windows
 * - xAI: https://docs.x.ai/developers/models
 * - Google: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro
 * - DeepSeek: https://api-docs.deepseek.com/quick_start/pricing
 */

export const VENDOR_MODEL_ID_PREFIXES = [
  'x-ai/',
  'xai/',
  'openai/',
  'anthropic/',
  'google/',
  'deepseek/',
] as const;

const CONTEXT_128K = 128_000;
const CONTEXT_200K = 200_000;
const CONTEXT_256K = 256_000;
const CONTEXT_500K = 500_000;
const CONTEXT_1M_OPENAI = 1_047_576;
const CONTEXT_1M_GEMINI = 1_048_576;
const CONTEXT_1M = 1_000_000;

/**
 * Exact published input windows. Keys are already normalized
 * (lowercase, vendor prefix stripped). Do not add family wildcards here.
 */
export const PUBLISHED_INPUT_CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  // OpenAI — gpt-4o is 128k; gpt-4.1 is 1,047,576. They must not share a number.
  'gpt-4o': CONTEXT_128K,
  'gpt-4o-mini': CONTEXT_128K,
  'gpt-4o-2024-05-13': CONTEXT_128K,
  'gpt-4o-2024-08-06': CONTEXT_128K,
  'gpt-4o-2024-11-20': CONTEXT_128K,
  'gpt-4.1': CONTEXT_1M_OPENAI,
  'gpt-4.1-mini': CONTEXT_1M_OPENAI,
  'gpt-4.1-nano': CONTEXT_1M_OPENAI,
  'gpt-4.1-2025-04-14': CONTEXT_1M_OPENAI,
  'gpt-4.1-mini-2025-04-14': CONTEXT_1M_OPENAI,
  'gpt-4.1-nano-2025-04-14': CONTEXT_1M_OPENAI,

  // Anthropic — 1M only for ids that publish it. Older Sonnet/Opus/Haiku stay 200k.
  'claude-fable-5': CONTEXT_1M,
  'claude-mythos-5': CONTEXT_1M,
  'claude-mythos-preview': CONTEXT_1M,
  'claude-opus-5': CONTEXT_1M,
  'claude-sonnet-5': CONTEXT_1M,
  'claude-opus-4-8': CONTEXT_1M,
  'claude-opus-4-7': CONTEXT_1M,
  'claude-opus-4-6': CONTEXT_1M,
  'claude-sonnet-4-6': CONTEXT_1M,
  'opus-4-8': CONTEXT_1M,
  'opus-4-7': CONTEXT_1M,
  'opus-4-6': CONTEXT_1M,
  'opus-4.6': CONTEXT_1M,
  'opus-5': CONTEXT_1M,
  'sonnet-4-6': CONTEXT_1M,
  'sonnet-4.6': CONTEXT_1M,
  'sonnet-5': CONTEXT_1M,
  'fable-5': CONTEXT_1M,
  'claude-haiku-4-5': CONTEXT_200K,
  'claude-haiku-4-5-20251001': CONTEXT_200K,
  'claude-sonnet-4-5': CONTEXT_200K,
  'claude-sonnet-4-5-20250929': CONTEXT_200K,
  'claude-opus-4-5': CONTEXT_200K,
  'claude-opus-4-5-20251101': CONTEXT_200K,
  'claude-sonnet-4': CONTEXT_200K,
  'claude-opus-4': CONTEXT_200K,
  'claude-opus-4-1': CONTEXT_200K,
  'claude-3-5-sonnet': CONTEXT_200K,
  'claude-3-5-haiku': CONTEXT_200K,
  'claude-3-7-sonnet': CONTEXT_200K,
  'haiku-4-5': CONTEXT_200K,
  'haiku-4.5': CONTEXT_200K,
  'sonnet-4-5': CONTEXT_200K,
  'sonnet-4.5': CONTEXT_200K,
  'opus-4-5': CONTEXT_200K,
  'opus-4.5': CONTEXT_200K,

  // xAI — current catalog windows differ by id (4.6/4.5 = 500k, 4.3 = 1M).
  'grok-4.6': CONTEXT_500K,
  'grok-4.5': CONTEXT_500K,
  'grok-4.5-latest': CONTEXT_500K,
  'grok-4.3': CONTEXT_1M,
  'grok-4.3-latest': CONTEXT_1M,
  'grok-4.20-0309-reasoning': CONTEXT_1M,
  'grok-4.20-0309-non-reasoning': CONTEXT_1M,
  'grok-4.20-multi-agent-0309': CONTEXT_1M,
  'grok-build-0.1': CONTEXT_256K,
  'grok-build-latest': CONTEXT_500K,

  // Google Gemini 2.5 — 1,048,576 input tokens.
  'gemini-2.5-pro': CONTEXT_1M_GEMINI,
  'gemini-2.5-flash': CONTEXT_1M_GEMINI,
  'gemini-2.5-flash-lite': CONTEXT_1M_GEMINI,
  'gemini-2.5-flash-lite-preview-06-17': CONTEXT_1M_GEMINI,

  // DeepSeek hosted API (2026 pricing page): V4 Flash/Pro are 1M.
  // Legacy chat/reasoner aliases now point at V4 Flash on that API.
  'deepseek-v4-flash': CONTEXT_1M,
  'deepseek-v4-pro': CONTEXT_1M,
  'deepseek-chat': CONTEXT_1M,
  'deepseek-reasoner': CONTEXT_1M,
};

export type ContextWindowSource = 'catalog' | 'exact' | 'family' | 'none';

export type ResolvedContextWindow = {
  contextWindow?: number;
  source: ContextWindowSource;
};

const CATALOG_CONTEXT_KEYS = [
  'context_length',
  'max_model_len',
  'context_window',
  'contextWindow',
  'max_input_tokens',
  'maxInputTokens',
  'context',
] as const;

export const normalizeModelId = (id: string): string => {
  let next = id.trim().toLowerCase();
  for (const prefix of VENDOR_MODEL_ID_PREFIXES) {
    if (next.startsWith(prefix)) {
      next = next.slice(prefix.length);
      break;
    }
  }
  return next;
};

export const readPositiveContextWindow = (value: unknown): number | undefined => {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  const numeric = typeof value === 'number' || typeof value === 'string'
    ? Number(value)
    : NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }
  return Math.round(numeric);
};

/**
 * Provider /models catalog fields. First positive value wins.
 * Nested `limit.context` is an OpenCode-shaped equivalent.
 */
export const readCatalogContextWindow = (item: unknown): number | undefined => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return undefined;
  }
  const record = item as Record<string, unknown>;
  for (const key of CATALOG_CONTEXT_KEYS) {
    const found = readPositiveContextWindow(record[key]);
    if (found !== undefined) {
      return found;
    }
  }
  const limit = record.limit;
  if (limit && typeof limit === 'object' && !Array.isArray(limit)) {
    const nested = readPositiveContextWindow((limit as Record<string, unknown>).context);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
};

export const lookupExactContextWindow = (modelId: string): number | undefined => {
  const normalized = normalizeModelId(modelId);
  if (!normalized) {
    return undefined;
  }
  return PUBLISHED_INPUT_CONTEXT_WINDOWS[normalized];
};

/**
 * Conservative family inference. Used only when catalog and exact id miss.
 * GPT and Grok have no family number — same prefix, different published windows.
 */
export const inferFamilyContextWindow = (modelId: string): number | undefined => {
  const normalized = normalizeModelId(modelId);
  if (!normalized) {
    return undefined;
  }
  if (/^gemini-2\.5([._-]|$)/.test(normalized)) {
    return CONTEXT_1M_GEMINI;
  }
  if (/^(claude|opus|sonnet|haiku)([._-]|$)/.test(normalized)) {
    return CONTEXT_200K;
  }
  return undefined;
};

export const resolveContextWindow = (input: {
  id: string;
  catalogContextWindow?: unknown;
  allowFamilyFallback?: boolean;
}): ResolvedContextWindow => {
  const catalog = readPositiveContextWindow(input.catalogContextWindow)
    ?? (input.catalogContextWindow && typeof input.catalogContextWindow === 'object'
      ? readCatalogContextWindow(input.catalogContextWindow)
      : undefined);
  if (catalog !== undefined) {
    return { contextWindow: catalog, source: 'catalog' };
  }

  const exact = lookupExactContextWindow(input.id);
  if (exact !== undefined) {
    return { contextWindow: exact, source: 'exact' };
  }

  if (input.allowFamilyFallback === false) {
    return { source: 'none' };
  }

  const family = inferFamilyContextWindow(input.id);
  if (family !== undefined) {
    return { contextWindow: family, source: 'family' };
  }

  return { source: 'none' };
};
