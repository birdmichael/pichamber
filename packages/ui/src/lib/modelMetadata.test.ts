import { describe, expect, test } from 'bun:test';
import type { ModelMetadata } from '@/types';
import {
  findExactCatalogMetadata,
  formatModelContextTokens,
  lookupModelMetadata,
  mergeModelMetadataWithLiveModel,
  readLiveModelContextWindow,
  resolveDisplayedContextWindow,
} from './modelMetadata';
import { toPiRuntimeModelProviders } from './multirun/piModels';

const catalogRow = (providerId: string, context: number): ModelMetadata => ({
  id: 'grok-4.6',
  providerId,
  name: 'Grok 4.6',
  limit: { context, output: 8192 },
});

describe('readLiveModelContextWindow', () => {
  test('reads nested limit.context before contextWindow', () => {
    expect(readLiveModelContextWindow({
      id: 'example',
      contextWindow: 256000,
      limit: { context: 128000 },
    })).toBe(128000);
    expect(readLiveModelContextWindow({
      id: 'example',
      contextWindow: 256000,
    })).toBe(256000);
    expect(readLiveModelContextWindow({
      id: 'example',
      limit: { context: 256000 },
    })).toBe(256000);
  });

  test('ignores output / max tokens', () => {
    expect(readLiveModelContextWindow({
      id: 'example',
      maxTokens: 500000,
      limit: { output: 500000 },
    })).toEqual(undefined);
  });
});

describe('findExactCatalogMetadata', () => {
  test('does not take another provider\'s row for the same model id', () => {
    const catalog = new Map<string, ModelMetadata>([
      ['xai/grok-4.6', catalogRow('xai', 128000)],
    ]);
    expect(findExactCatalogMetadata(catalog, 'acme', 'grok-4.6')).toEqual(undefined);
    expect(findExactCatalogMetadata(catalog, 'xai', 'grok-4.6')?.limit?.context).toBe(128000);
  });
});

describe('resolveDisplayedContextWindow', () => {
  test('uses live, then exact catalog, then published — same K for one model', () => {
    const live = { id: 'grok-4.6', limit: { context: 256000 } };
    const exact = catalogRow('acme', 128000);
    expect(resolveDisplayedContextWindow({ live, exactCatalog: exact, modelId: 'grok-4.6' })).toBe(256000);
    expect(resolveDisplayedContextWindow({ live: { id: 'grok-4.6' }, exactCatalog: exact, modelId: 'grok-4.6' })).toBe(128000);
    expect(resolveDisplayedContextWindow({ live: { id: 'grok-4.6' }, modelId: 'grok-4.6' })).toBe(500000);
  });
});

describe('mergeModelMetadataWithLiveModel', () => {
  test('uses the live Pi window instead of a models.dev leftover', () => {
    const merged = mergeModelMetadataWithLiveModel(
      'acme',
      { id: 'grok-4.6', name: 'Grok 4.6', limit: { context: 256000 } },
      catalogRow('xai', 128000),
    );
    expect(merged?.limit?.context).toBe(256000);
  });

  test('keeps an exact same-provider catalog window when the live record has none', () => {
    const merged = mergeModelMetadataWithLiveModel(
      'xai',
      { id: 'grok-4.6', name: 'Grok 4.6' },
      catalogRow('xai', 200000),
    );
    expect(merged?.limit?.context).toBe(200000);
  });

  test('does not keep another provider\'s catalog window', () => {
    const merged = mergeModelMetadataWithLiveModel(
      'acme',
      { id: 'unknown-model', name: 'Unknown' },
      catalogRow('xai', 128000),
    );
    expect(merged?.limit?.context).toEqual(undefined);
  });

  test('falls back to the published table for a known id when live and exact catalog are missing', () => {
    const merged = mergeModelMetadataWithLiveModel(
      'acme',
      { id: 'grok-4.6', name: 'Grok 4.6' },
      catalogRow('xai', 128000),
    );
    expect(merged?.limit?.context).toBe(500000);
  });

  test('reads nested limit.context as the same Pi field', () => {
    const merged = mergeModelMetadataWithLiveModel(
      'acme',
      { id: 'example', limit: { context: 200000, output: 4096 } },
    );
    expect(merged?.limit).toEqual({ context: 200000, output: 4096 });
  });

  test('Recent / fork / multi-run merge to the same K for one live record', () => {
    const live = { id: 'example', name: 'Example', contextWindow: 256000, limit: { context: 256000 } };
    const recent = mergeModelMetadataWithLiveModel('acme', live, catalogRow('xai', 128000));
    const fork = mergeModelMetadataWithLiveModel('acme', live);
    const multiRun = mergeModelMetadataWithLiveModel('acme', { id: 'example', contextWindow: 256000 });
    expect(recent?.limit?.context).toBe(256000);
    expect(fork?.limit?.context).toBe(256000);
    expect(multiRun?.limit?.context).toBe(256000);
  });

  test('Recent, Fork ModelSelector, and multi-run format the same K string', () => {
    const providers = toPiRuntimeModelProviders({
      providers: [{
        id: 'acme',
        name: 'Acme',
        models: {
          example: {
            id: 'example',
            name: 'Example',
            contextWindow: 256000,
            limit: { context: 256000, output: 8192 },
          },
        },
      }],
    });
    const live = providers[0]?.models?.[0];
    expect(live).toBeTruthy();

    const fuzzyOtherProvider: ModelMetadata = {
      id: 'example',
      providerId: 'other',
      limit: { context: 128000 },
    };
    const modelsMetadata = new Map<string, ModelMetadata>([
      ['other/example', fuzzyOtherProvider],
    ]);

    const recent = mergeModelMetadataWithLiveModel('acme', live!, fuzzyOtherProvider);
    const fork = mergeModelMetadataWithLiveModel(
      'acme',
      live!,
      lookupModelMetadata(modelsMetadata, 'acme', 'example'),
    );
    const multiRun = mergeModelMetadataWithLiveModel('acme', live!);

    const recentK = formatModelContextTokens(recent?.limit?.context);
    const forkK = formatModelContextTokens(fork?.limit?.context);
    const multiRunK = formatModelContextTokens(multiRun?.limit?.context);
    expect(recentK).toBe(forkK);
    expect(forkK).toBe(multiRunK);
    expect(recentK).toBe(formatModelContextTokens(256000));
  });
});
