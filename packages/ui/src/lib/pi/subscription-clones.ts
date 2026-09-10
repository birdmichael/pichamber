const XAI_FAMILY = 'xai';
const KIMI_FAMILY = 'kimi-coding';
const KIMI_API_SIBLING_ID = 'kimi-coding-api';

const CLONE_SUFFIX = /^[1-9]\d*$/;

/** Dual-auth reserved Completions sibling, or a display name like "Kimi API" / "Kimi Code API". */
export const isKimiApiSiblingId = (providerId: string | null | undefined): boolean => {
  const id = typeof providerId === 'string' ? providerId.trim() : '';
  return id === KIMI_API_SIBLING_ID;
};

export const isKimiApiSiblingDisplayName = (name: string | null | undefined): boolean => {
  const label = typeof name === 'string' ? name.trim() : '';
  return /\bAPI\b/i.test(label);
};

export const subscriptionFamilyOf = (providerId: string | null | undefined): 'xai' | 'kimi-coding' | null => {
  const id = typeof providerId === 'string' ? providerId.trim() : '';
  if (!id) return null;
  if (id === XAI_FAMILY || (id.startsWith(`${XAI_FAMILY}-`) && CLONE_SUFFIX.test(id.slice(XAI_FAMILY.length + 1)))) {
    return XAI_FAMILY;
  }
  if (id === KIMI_FAMILY || (id.startsWith(`${KIMI_FAMILY}-`) && CLONE_SUFFIX.test(id.slice(KIMI_FAMILY.length + 1)))) {
    return KIMI_FAMILY;
  }
  return null;
};

export const isXaiSubscriptionId = (providerId: string | null | undefined): boolean =>
  subscriptionFamilyOf(providerId) === XAI_FAMILY;

export const isKimiSubscriptionId = (providerId: string | null | undefined): boolean =>
  subscriptionFamilyOf(providerId) === KIMI_FAMILY;

/**
 * Kimi Code OAuth subscription rows that may appear in Usage.
 * Excludes the reserved dual-auth API sibling and Completions API-key
 * siblings whose display name is "… API" (e.g. user kimi-coding-2 "Kimi API").
 */
export const isKimiCodeUsageProvider = (
  provider: { id?: string | null; name?: string | null } | string | null | undefined,
): boolean => {
  if (typeof provider === 'string' || provider == null) {
    const id = typeof provider === 'string' ? provider : '';
    return isKimiSubscriptionId(id) && !isKimiApiSiblingId(id);
  }
  const id = typeof provider.id === 'string' ? provider.id : '';
  if (!isKimiSubscriptionId(id) || isKimiApiSiblingId(id)) return false;
  if (isKimiApiSiblingDisplayName(provider.name)) return false;
  return true;
};

export const isOfficialSubscriptionId = (providerId: string | null | undefined): boolean =>
  subscriptionFamilyOf(providerId) !== null;

/**
 * True when the family has a connected Code/OAuth subscription that can gate
 * "add another" clone. Kimi Completions API siblings (reserved id or "… API"
 * display name) do not count — otherwise Add → Kimi Code wrongly clones (#643).
 */
export const familyIsConnected = (
  family: 'xai' | 'kimi-coding',
  connectedIds: ReadonlySet<string>,
  providers?: ReadonlyArray<{ id?: string | null; name?: string | null }>,
): boolean => {
  if (family === KIMI_FAMILY) {
    return [...connectedIds].some((id) => {
      if (subscriptionFamilyOf(id) !== KIMI_FAMILY) return false;
      const provider = providers?.find((row) => row.id === id);
      return isKimiCodeUsageProvider(provider ?? { id });
    });
  }
  return [...connectedIds].some((id) => subscriptionFamilyOf(id) === family);
};

/** Clone path requires the root family id (matches server hasRoot). */
export const familyHasRootConnected = (
  family: 'xai' | 'kimi-coding',
  connectedIds: ReadonlySet<string>,
): boolean => connectedIds.has(family);
