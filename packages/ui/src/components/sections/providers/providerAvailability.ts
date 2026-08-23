export const shouldLoadAvailableProviders = (isAddMode: boolean): boolean => isAddMode;

/** Config-defined customs have no standalone auth panel — credentials live on the form. */
export const requiresProviderAuth = (
  sourcesLoaded: boolean,
  hasCredentials: boolean,
  isConfigDefinedCustomProvider: boolean,
): boolean => sourcesLoaded && !hasCredentials && !isConfigDefinedCustomProvider;
