import { resolveCatalogThinkingLevels } from '@/lib/model-catalog-capabilities';

type CatalogMetadata = Parameters<typeof resolveCatalogThinkingLevels>[0];

export const resolveForkThinkingLevels = (input: {
  isPiKernel: boolean;
  providerId: string;
  modelId: string;
  getModelMetadata: (providerId: string, modelId: string) => CatalogMetadata;
  variantKeys: readonly string[];
}): string[] => {
  if (!input.providerId || !input.modelId) return [];
  if (input.isPiKernel) {
    // Live Pi catalog levels — same source as Session Defaults.
    // Do not invent OpenCode variants or vendor lists.
    return resolveCatalogThinkingLevels(input.getModelMetadata(input.providerId, input.modelId));
  }
  return [...input.variantKeys];
};

/** Keep a pin until the selected model is known; then empty levels clear it. */
export const nextScheduledTaskThinkingVariant = (input: {
  thinkingLevels: readonly string[];
  modelKnown: boolean;
  currentVariant: string;
}): string | undefined => {
  const current = input.currentVariant.trim();
  if (input.thinkingLevels.length > 0) {
    return undefined;
  }
  if (!input.modelKnown || !current) {
    return undefined;
  }
  return '';
};

export const persistScheduledTaskThinkingVariant = (input: {
  thinkingLevels: readonly string[];
  modelKnown: boolean;
  currentVariant: string;
}): string | undefined => {
  const current = input.currentVariant.trim();
  if (!current) return undefined;
  if (input.thinkingLevels.includes(current)) return current;
  if (!input.modelKnown) return current;
  return undefined;
};
