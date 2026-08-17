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
 * Pi `input` tokens. Docs default omitted `input` to `["text"]`.
 * Vision requires an explicit `["text", "image"]`.
 */
export const PI_MODEL_INPUT_TYPES = ['text', 'image'] as const;
export type PiModelInputType = (typeof PI_MODEL_INPUT_TYPES)[number];
export const PI_TEXT_IMAGE_INPUT: readonly PiModelInputType[] = ['text', 'image'];

const PI_MODEL_INPUT_TYPE_SET = new Set<string>(PI_MODEL_INPUT_TYPES);

/**
 * Exact ids whose vendor docs publish image input. Same keying as
 * `PUBLISHED_INPUT_CONTEXT_WINDOWS` (normalized, no family wildcards).
 * DeepSeek hosted V4 ids are in the context table and stay omitted here —
 * that API is text-only.
 *
 * Sources:
 * - OpenAI: https://developers.openai.com/api/docs/models/gpt-4o
 *   and https://developers.openai.com/api/docs/models/gpt-4.1
 * - Anthropic: https://platform.claude.com/docs/en/about-claude/models/overview
 *   ("All current Claude models support text and image input")
 * - xAI: https://docs.x.ai/developers/models/grok-4.6 (and sibling model pages)
 * - Google: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro
 */
export const KNOWN_VISION_MODEL_IDS: ReadonlySet<string> = new Set([
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

/**
 * Pi `input` arrays. Empty, unknown tokens, and non-arrays are omitted
 * so Pi can keep its `["text"]` default.
 */
export const readPersistedModelInput = (value: unknown): PiModelInputType[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const next: PiModelInputType[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const token = item.trim().toLowerCase();
    if (!PI_MODEL_INPUT_TYPE_SET.has(token) || seen.has(token)) {
      continue;
    }
    seen.add(token);
    next.push(token as PiModelInputType);
  }
  return next.length > 0 ? next : undefined;
};

/**
 * Pi's omitted-`input` default. Live models and text-only capabilities
 * look like a stored value, but they are not a user override.
 */
export const isPiDefaultTextInput = (value: unknown): boolean => {
  const input = readPersistedModelInput(value);
  return input !== undefined && input.length === 1 && input[0] === 'text';
};

export const lookupExactVisionInput = (modelId: string): readonly PiModelInputType[] | undefined => {
  const normalized = normalizeModelId(modelId);
  if (!normalized || !KNOWN_VISION_MODEL_IDS.has(normalized)) {
    return undefined;
  }
  return PI_TEXT_IMAGE_INPUT;
};

/**
 * `input` to write on a custom-model persist. A stored non-default array
 * wins (`["text", "image"]` is not stripped). Empty or Pi-default
 * `["text"]` on a known vision id writes `["text", "image"]`. The same
 * empty/default on an unknown id stays omitted — do not invent vision.
 */
export const resolvePersistedInput = (input: {
  id: string;
  input?: unknown;
}): PiModelInputType[] | undefined => {
  const user = readPersistedModelInput(input.input);
  if (user !== undefined && !isPiDefaultTextInput(user)) {
    return user;
  }
  const known = lookupExactVisionInput(input.id);
  return known ? [...known] : undefined;
};

/**
 * Window to write on a custom-model persist. A typed number wins.
 * Empty on a known id uses the published table. Empty on an unknown id
 * stays omitted — family inference is display-only and is not persisted.
 */
export const resolvePersistedContextWindow = (input: {
  id: string;
  contextWindow?: unknown;
}): number | undefined => {
  const user = readPositiveContextWindow(input.contextWindow);
  if (user !== undefined) {
    return user;
  }
  return lookupExactContextWindow(input.id);
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
