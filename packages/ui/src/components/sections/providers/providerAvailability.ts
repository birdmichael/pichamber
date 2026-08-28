export const shouldLoadAvailableProviders = (isAddMode: boolean): boolean => isAddMode;

/** Config-defined customs have no standalone auth panel — credentials live on the form. */
export const requiresProviderAuth = (
  sourcesLoaded: boolean,
  hasCredentials: boolean,
  isConfigDefinedCustomProvider: boolean,
): boolean => sourcesLoaded && !hasCredentials && !isConfigDefinedCustomProvider;

export type AddCatalogProvider = {
  id: string;
  name?: string;
};

/** Settings Add must list Grok even when the live catalog omitted the stub or already connected it. */
export const BUILTIN_ADD_CATALOG_PROVIDERS: readonly AddCatalogProvider[] = [
  { id: 'xai', name: 'xAI / Grok' },
];

export const providerHasConnectedModels = (provider: { models?: unknown }): boolean => {
  const models = provider.models;
  if (Array.isArray(models)) return models.length > 0;
  if (models && typeof models === 'object') return Object.keys(models).length > 0;
  return false;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const parseConnectedProviderIds = (payload: unknown): string[] => {
  if (!isRecord(payload) || !Array.isArray(payload.connected)) {
    return [];
  }
  return payload.connected.filter((id): id is string => typeof id === 'string' && id.length > 0);
};

export const mergeAddCatalogProviders = (
  available: readonly AddCatalogProvider[],
  builtins: readonly AddCatalogProvider[] = BUILTIN_ADD_CATALOG_PROVIDERS,
): AddCatalogProvider[] => {
  const merged = [...available];
  for (const builtin of builtins) {
    if (!builtin.id) continue;
    const index = merged.findIndex((provider) => provider.id === builtin.id);
    if (index >= 0) {
      if (builtin.name) merged[index] = { ...merged[index], name: builtin.name };
      continue;
    }
    merged.push({ id: builtin.id, name: builtin.name });
  }
  return merged;
};

export const selectUnconnectedProviders = (
  catalog: readonly AddCatalogProvider[],
  connectedIds: ReadonlySet<string>,
): AddCatalogProvider[] =>
  [...catalog]
    .filter((provider) => !connectedIds.has(provider.id))
    .sort((left, right) => (left.name || left.id).localeCompare(right.name || right.id));

/** Hide connected live rows, then put builtins back so Grok login stays clickable. */
export const selectAddCatalogProviders = (
  available: readonly AddCatalogProvider[],
  connectedIds: ReadonlySet<string>,
  builtins: readonly AddCatalogProvider[] = BUILTIN_ADD_CATALOG_PROVIDERS,
): AddCatalogProvider[] => {
  const builtinIds = new Set(builtins.map((provider) => provider.id).filter(Boolean));
  return mergeAddCatalogProviders(
    available.filter((provider) => !connectedIds.has(provider.id) || builtinIds.has(provider.id)),
    builtins,
  ).sort((left, right) => (left.name || left.id).localeCompare(right.name || right.id));
};

export const shouldAutoSelectBuiltinAddProvider = (
  isAddMode: boolean,
  availableLoading: boolean,
  catalog: readonly AddCatalogProvider[],
  candidateProviderId: string,
  builtinId = 'xai',
): string | null => {
  if (!isAddMode || availableLoading || candidateProviderId) return null;
  return catalog.some((provider) => provider.id === builtinId) ? builtinId : null;
};

/** Empty Add catalog is not a dead end — open Other / Custom once loading finishes. */
export const shouldAutoSelectCustomProvider = (
  isAddMode: boolean,
  availableLoading: boolean,
  unconnectedCount: number,
  candidateProviderId: string,
): boolean =>
  isAddMode && !availableLoading && unconnectedCount === 0 && candidateProviderId === '';
