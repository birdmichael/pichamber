import { describe, expect, test } from 'bun:test';
import {
  inferFamilyContextWindow,
  KNOWN_VISION_MODEL_IDS,
  lookupExactContextWindow,
  isPiDefaultTextInput,
  lookupExactVisionInput,
  normalizeModelId,
  PI_TEXT_IMAGE_INPUT,
  PUBLISHED_INPUT_CONTEXT_WINDOWS,
  readCatalogContextWindow,
  readPersistedModelInput,
  resolveContextWindow,
  resolvePersistedContextWindow,
  resolvePersistedInput,
  VENDOR_MODEL_ID_PREFIXES,
  type ContextWindowSource,
  type ResolvedContextWindow,
} from './model-context-windows';

describe('normalizeModelId', () => {
  test('strips known vendor prefixes and compares case-insensitively', () => {
    expect(normalizeModelId('  X-AI/Grok-4.6  ')).toBe('grok-4.6');
    expect(normalizeModelId('xai/grok-4.6')).toBe('grok-4.6');
    expect(normalizeModelId('openai/gpt-4o')).toBe('gpt-4o');
    expect(normalizeModelId('anthropic/claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
    expect(normalizeModelId('google/gemini-2.5-pro')).toBe('gemini-2.5-pro');
    expect(normalizeModelId('deepseek/deepseek-chat')).toBe('deepseek-chat');
  });

  test('does not strip unrelated org prefixes', () => {
    expect(normalizeModelId('org-a/llama-3')).toBe('org-a/llama-3');
    expect(normalizeModelId('grok/grok-4.6')).toBe('grok/grok-4.6');
  });
});

describe('lookupExactContextWindow', () => {
  test('prefills the published window for that exact id, not a family average', () => {
    expect(VENDOR_MODEL_ID_PREFIXES).toContain('openai/');
    expect(PUBLISHED_INPUT_CONTEXT_WINDOWS['gpt-4o']).toBe(128_000);
    expect(PUBLISHED_INPUT_CONTEXT_WINDOWS['gpt-4.1']).toBe(1_047_576);
    expect(lookupExactContextWindow('gpt-4o')).toBe(128_000);
    expect(lookupExactContextWindow('gpt-4.1')).toBe(1_047_576);
    expect(lookupExactContextWindow('GPT-4O')).toBe(128_000);
    expect(lookupExactContextWindow('openai/gpt-4.1')).toBe(1_047_576);
    expect(lookupExactContextWindow('gpt-4o')).not.toBe(lookupExactContextWindow('gpt-4.1'));
  });

  test('uses current Claude / Grok / Gemini / DeepSeek published input windows', () => {
    expect(lookupExactContextWindow('claude-sonnet-4-6')).toBe(1_000_000);
    expect(lookupExactContextWindow('claude-opus-4-6')).toBe(1_000_000);
    expect(lookupExactContextWindow('claude-sonnet-4-5')).toBe(200_000);
    expect(lookupExactContextWindow('claude-haiku-4-5')).toBe(200_000);
    expect(lookupExactContextWindow('x-ai/grok-4.6')).toBe(500_000);
    expect(lookupExactContextWindow('grok-4.3')).toBe(1_000_000);
    expect(lookupExactContextWindow('gemini-2.5-pro')).toBe(1_048_576);
    expect(lookupExactContextWindow('deepseek-v4-flash')).toBe(1_000_000);
    expect(lookupExactContextWindow('deepseek-chat')).toBe(1_000_000);
  });

  test('returns undefined for unknown exact ids', () => {
    expect(lookupExactContextWindow('gpt-unknown-99')).toEqual(undefined);
    expect(lookupExactContextWindow('claude-*')).toEqual(undefined);
    expect(lookupExactContextWindow('')).toEqual(undefined);
  });
});

describe('inferFamilyContextWindow', () => {
  test('is only a conservative last resort for known families', () => {
    expect(inferFamilyContextWindow('claude-unknown-99')).toBe(200_000);
    expect(inferFamilyContextWindow('opus-99')).toBe(200_000);
    expect(inferFamilyContextWindow('gemini-2.5-unknown')).toBe(1_048_576);
  });

  test('does not invent a GPT or Grok family average', () => {
    expect(inferFamilyContextWindow('gpt-unknown-99')).toEqual(undefined);
    expect(inferFamilyContextWindow('grok-unknown-99')).toEqual(undefined);
    expect(inferFamilyContextWindow('composer-2.5')).toEqual(undefined);
  });
});

describe('resolveContextWindow', () => {
  test('uses a provider catalog value before the exact-id table', () => {
    const catalog: ResolvedContextWindow = resolveContextWindow({
      id: 'gpt-4o',
      catalogContextWindow: 64_000,
    });
    const source: ContextWindowSource = catalog.source;
    expect(source).toBe('catalog');
    expect(catalog).toEqual({ contextWindow: 64_000, source: 'catalog' });
    expect(resolveContextWindow({
      id: 'gpt-4o',
      catalogContextWindow: { context_length: 96_000 },
    })).toEqual({ contextWindow: 96_000, source: 'catalog' });
  });

  test('uses the exact-id table when the catalog is silent', () => {
    expect(resolveContextWindow({ id: 'gpt-4.1' })).toEqual({
      contextWindow: 1_047_576,
      source: 'exact',
    });
    expect(resolveContextWindow({
      id: 'gpt-4o',
      catalogContextWindow: 0,
    })).toEqual({ contextWindow: 128_000, source: 'exact' });
  });

  test('uses family inference only when catalog and exact id miss', () => {
    expect(resolveContextWindow({ id: 'claude-unknown-99' })).toEqual({
      contextWindow: 200_000,
      source: 'family',
    });
    expect(resolveContextWindow({
      id: 'claude-unknown-99',
      allowFamilyFallback: false,
    })).toEqual({ source: 'none' });
    expect(resolveContextWindow({ id: 'mystery-model' })).toEqual({ source: 'none' });
  });
});

describe('resolvePersistedContextWindow', () => {
  test('writes the published window when a known id is left empty', () => {
    expect(resolvePersistedContextWindow({ id: 'grok-4.6' })).toBe(500_000);
    expect(resolvePersistedContextWindow({ id: 'x-ai/grok-4.6', contextWindow: '' })).toBe(500_000);
    expect(resolvePersistedContextWindow({ id: 'gpt-4.1' })).toBe(1_047_576);
  });

  test('does not invent a window for an unknown id left empty', () => {
    expect(resolvePersistedContextWindow({ id: 'mystery-model' })).toEqual(undefined);
    expect(resolvePersistedContextWindow({ id: 'claude-unknown-99' })).toEqual(undefined);
    expect(resolvePersistedContextWindow({ id: 'grok-unknown-99', contextWindow: 0 })).toEqual(undefined);
  });

  test('keeps a user-typed window instead of the published table', () => {
    expect(resolvePersistedContextWindow({
      id: 'grok-4.6',
      contextWindow: 64_000,
    })).toBe(64_000);
    expect(resolvePersistedContextWindow({
      id: 'mystery-model',
      contextWindow: '8192',
    })).toBe(8192);
  });
});

describe('resolvePersistedInput', () => {
  test('writes text+image for a known vision id left empty', () => {
    expect(KNOWN_VISION_MODEL_IDS.has('grok-4.6')).toBe(true);
    expect(lookupExactVisionInput('grok-4.6')).toEqual(PI_TEXT_IMAGE_INPUT);
    expect(resolvePersistedInput({ id: 'grok-4.6' })).toEqual(['text', 'image']);
    expect(resolvePersistedInput({ id: 'x-ai/grok-4.6', input: [] })).toEqual(['text', 'image']);
    expect(resolvePersistedInput({ id: 'gpt-4o' })).toEqual(['text', 'image']);
    expect(resolvePersistedInput({ id: 'claude-sonnet-5' })).toEqual(['text', 'image']);
    expect(resolvePersistedInput({ id: 'gemini-2.5-pro' })).toEqual(['text', 'image']);
  });

  test('does not invent vision for an unknown or text-only id', () => {
    expect(resolvePersistedInput({ id: 'mystery-model' })).toEqual(undefined);
    expect(resolvePersistedInput({ id: 'deepseek-chat' })).toEqual(undefined);
    expect(resolvePersistedInput({ id: 'deepseek-v4-flash' })).toEqual(undefined);
    expect(lookupExactVisionInput('grok-unknown-99')).toEqual(undefined);
  });

  test('treats Pi-default text-only as empty and keeps a stored vision array', () => {
    expect(isPiDefaultTextInput(['text'])).toBe(true);
    expect(isPiDefaultTextInput(['TEXT'])).toBe(true);
    expect(isPiDefaultTextInput(['text', 'image'])).toBe(false);
    expect(resolvePersistedInput({
      id: 'grok-4.6',
      input: ['text'],
    })).toEqual(['text', 'image']);
    expect(resolvePersistedInput({
      id: 'mystery-model',
      input: ['text'],
    })).toEqual(undefined);
    expect(resolvePersistedInput({
      id: 'grok-4.6',
      input: ['text', 'image'],
    })).toEqual(['text', 'image']);
    expect(resolvePersistedInput({
      id: 'mystery-model',
      input: ['text', 'image'],
    })).toEqual(['text', 'image']);
    expect(readPersistedModelInput(['TEXT', 'image', 'image', 'audio'])).toEqual(['text', 'image']);
  });
});

describe('readCatalogContextWindow', () => {
  test('reads gateway equivalents and ignores non-positive values', () => {
    expect(readCatalogContextWindow({ context_length: 131_072 })).toBe(131_072);
    expect(readCatalogContextWindow({ max_model_len: '8192' })).toBe(8192);
    expect(readCatalogContextWindow({ context_window: 256_000 })).toBe(256_000);
    expect(readCatalogContextWindow({ max_input_tokens: 200_000 })).toBe(200_000);
    expect(readCatalogContextWindow({ limit: { context: 128_000 } })).toBe(128_000);
    expect(readCatalogContextWindow({ context_length: 0 })).toEqual(undefined);
    expect(readCatalogContextWindow({ context_length: -1 })).toEqual(undefined);
    expect(readCatalogContextWindow(null)).toEqual(undefined);
  });
});
