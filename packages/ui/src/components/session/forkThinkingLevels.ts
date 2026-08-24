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
