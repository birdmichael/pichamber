import { describe, expect, test } from 'bun:test';
import type { ModelMetadata } from '@/types';
import {
  catalogEntriesFromMetadataMap,
  findCatalogMetadata,
  lookupPublishedReasoning,
  resolveCatalogCapabilities,
  resolvePersistedImageInput,
  resolvePersistedReasoning,
} from './model-catalog-capabilities';

const entry = (id: string, providerId: string, extras: Partial<ModelMetadata> = {}): ModelMetadata => ({
  id,
  providerId,
  ...extras,
});

describe('findCatalogMetadata', () => {
  test('returns the official provider/model key first', () => {
    const catalog = new Map<string, ModelMetadata>([
      ['xai/grok-4.6', entry('grok-4.6', 'xai', { attachment: true, reasoning: true })],
      ['openrouter/x-ai/grok-4.6', entry('x-ai/grok-4.6', 'openrouter', { attachment: true })],
    ]);
    expect(findCatalogMetadata(catalog, 'xai', 'grok-4.6')?.providerId).toBe('xai');
  });

  test('falls back to the same model id on another provider', () => {
    const catalog = new Map<string, ModelMetadata>([
      ['xai/grok-4.6', entry('grok-4.6', 'xai', {
        attachment: true,
        reasoning: true,
        modalities: { input: ['text', 'image'] },
      })],
    ]);
    const found = findCatalogMetadata(catalog, 'bmlab', 'grok-4.6');
    expect(found?.providerId).toBe('xai');
    expect(found?.attachment).toBe(true);
    expect(found?.reasoning).toBe(true);
  });

  test('normalizes vendor prefixes on the requested id', () => {
    const catalog = new Map<string, ModelMetadata>([
      ['openai/gpt-4o', entry('gpt-4o', 'openai', { attachment: true })],
    ]);
    expect(findCatalogMetadata(catalog, 'bmlab', 'openai/gpt-4o')?.id).toBe('gpt-4o');
  });
});

describe('published reasoning', () => {
  test('marks thinking models without inventing GPT-4o reasoning', () => {
    expect(lookupPublishedReasoning('grok-4.6')).toBe(true);
    expect(lookupPublishedReasoning('claude-sonnet-4-6')).toBe(true);
    expect(lookupPublishedReasoning('gemini-2.5-flash')).toBe(true);
    expect(lookupPublishedReasoning('gpt-4o')).toBe(false);
    expect(lookupPublishedReasoning('gpt-4.1')).toBe(false);
    expect(lookupPublishedReasoning('mystery-model')).toEqual(undefined);
  });
});

describe('catalog capability resolution', () => {
  test('requires a unanimous slug before adopting a flag', () => {
    expect(resolveCatalogCapabilities('deepseek-chat', [
      { id: 'deepseek-chat', attachment: true, modalities: { input: ['text', 'image'] } },
      { id: 'deepseek-chat', attachment: false, modalities: { input: ['text'] } },
    ])).toEqual({ image: undefined, reasoning: undefined });
  });

  test('adopts a unanimous models.dev slug', () => {
    expect(resolveCatalogCapabilities('grok-4.6', [
      { id: 'x-ai/grok-4.6', providerId: 'openrouter', attachment: true, reasoning: true, modalities: { input: ['text', 'image'] } },
      { id: 'grok-4.6', providerId: 'xai', attachment: true, reasoning: true, modalities: { input: ['text', 'image'] } },
    ])).toEqual({ image: true, reasoning: true });
  });
});

describe('persisted custom-model capabilities', () => {
  test('writes published vision and reasoning for a known empty id', () => {
    expect(resolvePersistedImageInput({ id: 'grok-4.6' })).toEqual(['text', 'image']);
    expect(resolvePersistedReasoning({ id: 'grok-4.6' })).toBe(true);
    expect(resolvePersistedImageInput({ id: 'gpt-4o' })).toEqual(['text', 'image']);
    expect(resolvePersistedReasoning({ id: 'gpt-4o' })).toEqual(undefined);
  });

  test('does not invent capabilities for an unknown id', () => {
    expect(resolvePersistedImageInput({ id: 'mystery-model' })).toEqual(undefined);
    expect(resolvePersistedReasoning({ id: 'mystery-model' })).toEqual(undefined);
  });

  test('treats Pi-default text-only as empty and keeps an explicit disable', () => {
    expect(resolvePersistedImageInput({ id: 'grok-4.6', input: ['text'] })).toEqual(['text', 'image']);
    expect(resolvePersistedReasoning({ id: 'grok-4.6', reasoning: false })).toEqual(undefined);
    expect(resolvePersistedImageInput({ id: 'mystery-model', input: ['text', 'image'] })).toEqual(['text', 'image']);
  });

  test('uses a unanimous catalog slug when the published table is silent', () => {
    const catalog = catalogEntriesFromMetadataMap(new Map([
      ['acme/vision-pro', entry('vision-pro', 'acme', {
        attachment: true,
        reasoning: true,
        modalities: { input: ['text', 'image'] },
      })],
    ]));
    expect(resolvePersistedImageInput({ id: 'vision-pro', catalog })).toEqual(['text', 'image']);
    expect(resolvePersistedReasoning({ id: 'vision-pro', catalog })).toBe(true);
  });
});
