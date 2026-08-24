import { findCatalogMetadata } from '@/lib/model-catalog-capabilities';
import type { ModelMetadata } from '@/types';

type LiveProviderModel = Record<string, unknown> & { id?: string; name?: string };

const readPositiveNumber = (value: unknown): number | undefined => {
  const numeric = typeof value === 'number' || typeof value === 'string'
    ? Number(value)
    : NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }
  return numeric;
};

const getNumericLimit = (limit: unknown, key: 'context' | 'output') => {
  if (!limit || typeof limit !== 'object') return undefined;
  return readPositiveNumber((limit as Record<string, unknown>)[key]);
};

/**
 * Displayed input window for a live Pi model record.
 * `contextWindow` and `limit.context` are the same host field.
 * Do not fall back to models.dev leftovers or max-output tokens.
 */
export const readLiveModelContextWindow = (model: LiveProviderModel): number | undefined => (
  readPositiveNumber(model.contextWindow) ?? getNumericLimit(model.limit, 'context')
);

export const lookupModelMetadata = (
  catalog: Map<string, ModelMetadata>,
  providerId: string,
  modelId: string,
): ModelMetadata | undefined => findCatalogMetadata(catalog, providerId, modelId);

export const mergeModelMetadataWithLiveModel = (
  providerId: string,
  model: LiveProviderModel,
  metadata?: ModelMetadata,
): ModelMetadata | undefined => {
  const liveContextLimit = readLiveModelContextWindow(model);
  const liveOutputLimit = getNumericLimit(model.limit, 'output') ?? readPositiveNumber(model.maxTokens);
  const outputLimit = liveOutputLimit ?? metadata?.limit?.output;

  if (liveContextLimit === undefined && outputLimit === undefined && !metadata) {
    return undefined;
  }

  return {
    ...(metadata ?? {
      id: typeof model.id === 'string' ? model.id : '',
      providerId,
      name: typeof model.name === 'string' ? model.name : undefined,
    }),
    limit: {
      ...metadata?.limit,
      // Live Pi window wins. A missing live window stays omitted so a
      // models.dev leftover cannot show a different K for the same model.
      context: liveContextLimit,
      ...(outputLimit !== undefined ? { output: outputLimit } : {}),
    },
  };
};
