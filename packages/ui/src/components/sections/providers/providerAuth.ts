export interface AuthMethod {
  type?: string;
  name?: string;
  label?: string;
  description?: string;
  help?: string;
  method?: number;
  /** Inputs an OAuth method wants answered before authorize; see `provider-oauth.ts`. */
  prompts?: unknown;
  [key: string]: unknown;
}

export interface OAuthAuthMethodEntry {
  method: AuthMethod;
  /** Index in the full provider auth-methods array (passed to oauth authorize/callback). */
  methodIndex: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const normalizeAuthType = (method: AuthMethod): string => {
  const raw = typeof method.type === 'string' ? method.type : '';
  const label = `${method.name ?? ''} ${method.label ?? ''}`.toLowerCase();
  const merged = `${raw} ${label}`.toLowerCase();
  if (merged.includes('oauth')) return 'oauth';
  if (merged.includes('api')) return 'api';
  return raw.toLowerCase();
};

export const parseAuthPayload = (payload: unknown): Record<string, AuthMethod[]> => {
  if (!isRecord(payload)) {
    return {};
  }
  const result: Record<string, AuthMethod[]> = {};
  for (const [providerId, value] of Object.entries(payload)) {
    if (Array.isArray(value)) {
      result[providerId] = value.filter((entry) => isRecord(entry)) as AuthMethod[];
    }
  }
  return result;
};

/**
 * Show the API key form when the provider declares API auth, or when auth
 * methods are still unknown (empty). OAuth-only providers must not get an
 * API key prompt.
 */
export const shouldShowApiKeyAuth = (methods: AuthMethod[]): boolean => {
  if (methods.length === 0) {
    return true;
  }
  return methods.some((method) => normalizeAuthType(method) === 'api');
};

export const getOAuthAuthMethods = (methods: AuthMethod[]): OAuthAuthMethodEntry[] =>
  methods
    .map((method, methodIndex) => ({ method, methodIndex }))
    .filter(({ method }) => normalizeAuthType(method) === 'oauth');

export const requiresOpenCodeRestartAfterOAuth = (providerId: string): boolean =>
  providerId !== 'claude-code';

/** Catalog OAuth id → reserved API-key sibling. Mirrors server `pi-dual-auth.js`. */
export const DUAL_AUTH_CATALOG = {
  'kimi-coding': { catalogId: 'kimi-coding', apiId: 'kimi-coding-api' },
  xai: { catalogId: 'xai', apiId: 'xai-api' },
} as const;

export type DualAuthCatalogId = keyof typeof DUAL_AUTH_CATALOG;

export const DUAL_AUTH_API_SIBLING_IDS: ReadonlySet<string> = new Set(
  Object.values(DUAL_AUTH_CATALOG).map((entry) => entry.apiId),
);

export const isDualAuthCatalogId = (providerId: string): providerId is DualAuthCatalogId =>
  Object.prototype.hasOwnProperty.call(DUAL_AUTH_CATALOG, providerId);

export const isDualAuthApiSiblingId = (providerId: string): boolean =>
  DUAL_AUTH_API_SIBLING_IDS.has(providerId);

export const dualAuthSiblingId = (providerId: string): string | null =>
  isDualAuthCatalogId(providerId) ? DUAL_AUTH_CATALOG[providerId].apiId : null;

export const dualAuthCatalogId = (providerId: string): string | null => {
  if (isDualAuthCatalogId(providerId)) return providerId;
  for (const spec of Object.values(DUAL_AUTH_CATALOG)) {
    if (spec.apiId === providerId) return spec.catalogId;
  }
  return null;
};

export const isDualAuthSurfaceId = (providerId: string): boolean =>
  Boolean(dualAuthCatalogId(providerId));

export interface ProviderCredentialInput {
  /** Present when the kernel reports an active credential (api/env/oauth). */
  key?: string | null;
  /** Auth.json provenance for this provider. */
  authSourceExists?: boolean | null;
  /**
   * Provider.options is shipped to the client for config-defined providers
   * but never reaches `Provider.key` (upstream only sets `key` from a single
   * resolved env var or an api-type auth.json entry). Treat a non-empty
   * `options.apiKey` as a usable login.
   */
  optionsApiKey?: string | null;
  /**
   * The provider declares environment variables it reads credentials from.
   * Multi-variable providers (Bedrock, Azure, Vertex) never resolve a single
   * `Provider.key` upstream, so without this signal they read as
   * "Credentials missing" even when fully configured.
   */
  envDeclared?: boolean;
}

/**
 * Prefer authoritative credential signals. Declared env vars are the weakest of
 * them — the array holds variable *names*, not values — but for providers whose
 * credentials span several env vars it is the only signal the kernel exposes.
 */
export const providerHasCredentials = (input: ProviderCredentialInput): boolean => {
  if (typeof input.key === 'string' && input.key.trim().length > 0) {
    return true;
  }
  if (typeof input.optionsApiKey === 'string' && input.optionsApiKey.trim().length > 0) {
    return true;
  }
  if (input.envDeclared === true) {
    return true;
  }
  return input.authSourceExists === true;
};

export const shouldShowModelsSection = (input: {
  modelCount: number;
  sourcesLoaded: boolean;
  hasCredentials: boolean;
  /**
   * Config-defined custom providers (providerSources.custom present and parsed
   * via `isConfigDefinedCustomProvider`) are user-editable in place, so a
   * stale `Credentials missing` signal must not hide their models section.
   * Optional for back-compat; defaults to `false`.
   */
  isEditableCustomProvider?: boolean;
}): boolean =>
  input.modelCount > 0 &&
  (!input.sourcesLoaded || input.hasCredentials || Boolean(input.isEditableCustomProvider));

export const shouldAutoOpenAuthPanel = (input: {
  sourcesLoaded: boolean;
  hasCredentials: boolean;
  userDismissed: boolean;
  /**
   * Config-defined custom providers do not auto-open the auth panel: the
   * provider is editable directly in the form, and a stale `Credentials
   * missing` summary would be misleading. Optional for back-compat.
   */
  isEditableCustomProvider?: boolean;
  /**
   * Dual-auth catalog (Kimi Code / xAI): keep the panel open until both
   * OAuth and API key are connected so saving the second method is visible.
   */
  dualAuthIncomplete?: boolean;
}): boolean =>
  input.sourcesLoaded &&
  !input.userDismissed &&
  !input.isEditableCustomProvider &&
  (Boolean(input.dualAuthIncomplete) || !input.hasCredentials);
