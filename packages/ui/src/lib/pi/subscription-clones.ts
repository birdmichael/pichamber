const XAI_FAMILY = 'xai';
const KIMI_FAMILY = 'kimi-coding';

const CLONE_SUFFIX = /^[1-9]\d*$/;

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

export const isOfficialSubscriptionId = (providerId: string | null | undefined): boolean =>
  subscriptionFamilyOf(providerId) !== null;

export const familyIsConnected = (
  family: 'xai' | 'kimi-coding',
  connectedIds: ReadonlySet<string>,
): boolean => [...connectedIds].some((id) => subscriptionFamilyOf(id) === family);
