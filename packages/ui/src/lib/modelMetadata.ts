import { findCatalogMetadata } from '@/lib/model-catalog-capabilities';
import { lookupExactContextWindow } from '@/lib/model-context-windows';
import { getCurrentIntlLocale } from '@/lib/i18n';
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

const sameProviderId = (left: string | undefined, right: string | undefined): boolean => (
  (left ?? '').trim().toLowerCase() === (right ?? '').trim().toLowerCase()
);

/**
 * Displayed input window for a live Pi model record.
 * `limit.context` and `contextWindow` are the same host field.
 */
export const readLiveModelContextWindow = (model: LiveProviderModel): number | undefined => (
  getNumericLimit(model.limit, 'context') ?? readPositiveNumber(model.contextWindow)
);

export const findExactCatalogMetadata = (
  catalog: Map<string, ModelMetadata>,
  providerId: string,
  modelId: string,
): ModelMetadata | undefined => {
  const key = `${providerId.trim().toLowerCase()}/${modelId}`;
  return catalog.get(key);
};

/**
 * One context-window number for every picker: live Pi record, then the exact
 * provider/model catalog row, then the published table for that model id.
 * Never a fuzzy other-provider leftover or max-output tokens.
 */
export const resolveDisplayedContextWindow = ({
  live,
  exactCatalog,
  modelId,
}: {
  live?: LiveProviderModel | null;
  exactCatalog?: ModelMetadata | null;
  modelId?: string;
}): number | undefined => (
  readLiveModelContextWindow(live ?? {})
  ?? getNumericLimit(exactCatalog?.limit, 'context')
  ?? lookupExactContextWindow(modelId ?? (typeof live?.id === 'string' ? live.id : ''))
);

export const formatModelContextTokens = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '';
  if (value === 0) return '0';
  const formatted = new Intl.NumberFormat(getCurrentIntlLocale(), {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(value);
  return formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted;
};

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
  const exactCatalog = sameProviderId(metadata?.providerId, providerId) ? metadata : undefined;
  const displayedContext = resolveDisplayedContextWindow({
    live: model,
    exactCatalog,
    modelId: typeof model.id === 'string' ? model.id : metadata?.id,
  });
  const liveOutputLimit = getNumericLimit(model.limit, 'output') ?? readPositiveNumber(model.maxTokens);
  const outputLimit = liveOutputLimit ?? metadata?.limit?.output;

  if (displayedContext === undefined && outputLimit === undefined && !metadata) {
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
      context: displayedContext,
      ...(outputLimit !== undefined ? { output: outputLimit } : {}),
    },
  };
};
