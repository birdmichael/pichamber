import { describe, expect, test } from 'bun:test';
import type { ModelMetadata } from '@/types';
import { mergeModelMetadataWithLiveModel, readLiveModelContextWindow } from './modelMetadata';

const catalog = (context: number): ModelMetadata => ({
  id: 'grok-4.6',
  providerId: 'xai',
  name: 'Grok 4.6',
  limit: { context, output: 8192 },
});

describe('readLiveModelContextWindow', () => {
  test('reads Pi contextWindow before nested limit.context', () => {
    expect(readLiveModelContextWindow({
      id: 'grok-4.6',
      contextWindow: 256000,
      limit: { context: 128000 },
    })).toBe(256000);
    expect(readLiveModelContextWindow({
      id: 'grok-4.6',
      limit: { context: 256000 },
    })).toBe(256000);
  });

  test('ignores output / max tokens', () => {
    expect(readLiveModelContextWindow({
      id: 'grok-4.6',
      maxTokens: 500000,
      limit: { output: 500000 },
    })).toEqual(undefined);
  });
});

describe('mergeModelMetadataWithLiveModel', () => {
  test('uses the live Pi window instead of a models.dev leftover', () => {
    const merged = mergeModelMetadataWithLiveModel(
      'bmlab',
      { id: 'grok-4.6', name: 'Grok 4.6', contextWindow: 256000 },
      catalog(128000),
    );
    expect(merged?.limit?.context).toBe(256000);
  });

  test('does not keep a leftover catalog window when the live record has none', () => {
    const merged = mergeModelMetadataWithLiveModel(
      'bmlab',
      { id: 'grok-4.6', name: 'Grok 4.6' },
      catalog(128000),
    );
    expect(merged?.limit?.context).toEqual(undefined);
  });

  test('reads nested limit.context as the same Pi field', () => {
    const merged = mergeModelMetadataWithLiveModel(
      'acme',
      { id: 'example', limit: { context: 200000, output: 4096 } },
    );
    expect(merged?.limit).toEqual({ context: 200000, output: 4096 });
  });
});
