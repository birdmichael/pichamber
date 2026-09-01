/** `undefined` means no per-group upper cap. */
export const MAX_MODELS_PER_GROUP: number | undefined = undefined;

export const canAddModelToGroup = (selectedCount: number): boolean =>
  MAX_MODELS_PER_GROUP === undefined || selectedCount < MAX_MODELS_PER_GROUP;
