import type { I18nKey } from '@/lib/i18n';
import type { UsageWindow } from '@/types';

export type KimiUsagePayload = {
  ok: boolean;
  configured: boolean;
  slotActive: boolean;
  error?: string;
  expires?: number | null;
  usage?: { windows?: Record<string, UsageWindow> } | null;
  fetchedAt?: number;
  providerId?: string;
  providerName?: string;
  membershipLevel?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asFiniteNumber = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
);

const parseUsageWindow = (value: unknown): UsageWindow | null => {
  if (!isRecord(value)) return null;
  return {
    usedPercent: asFiniteNumber(value.usedPercent),
    remainingPercent: asFiniteNumber(value.remainingPercent),
    windowSeconds: asFiniteNumber(value.windowSeconds),
    resetAfterSeconds: asFiniteNumber(value.resetAfterSeconds),
    resetAt: asFiniteNumber(value.resetAt),
    resetAtFormatted: typeof value.resetAtFormatted === 'string' ? value.resetAtFormatted : null,
    resetAfterFormatted: typeof value.resetAfterFormatted === 'string' ? value.resetAfterFormatted : null,
    ...(typeof value.valueLabel === 'string' ? { valueLabel: value.valueLabel } : {}),
  };
};

const KIMI_MEMBERSHIP_LABEL_KEYS: Record<string, I18nKey> = {
  LEVEL_FREE: 'chat.workStatus.kimi.membership.free',
  LEVEL_BASIC: 'chat.workStatus.kimi.membership.basic',
  LEVEL_INTERMEDIATE: 'chat.workStatus.kimi.membership.intermediate',
  LEVEL_ADVANCED: 'chat.workStatus.kimi.membership.advanced',
  LEVEL_PROFESSIONAL: 'chat.workStatus.kimi.membership.professional',
  LEVEL_PRO: 'chat.workStatus.kimi.membership.professional',
  LEVEL_ENTERPRISE: 'chat.workStatus.kimi.membership.enterprise',
};

const toTitleCaseWords = (value: string): string =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

/** Translate a Kimi membership enum. Never returns the raw LEVEL_* string. */
export const formatKimiMembershipLabel = (
  level: string | null | undefined,
  t: (key: I18nKey) => string,
): string | null => {
  if (typeof level !== 'string') return null;
  const trimmed = level.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toUpperCase();
  const key = KIMI_MEMBERSHIP_LABEL_KEYS[normalized];
  if (key) return t(key);
  const stripped = normalized.replace(/^LEVEL_/, '').replace(/_/g, ' ').trim();
  if (!stripped) return null;
  return toTitleCaseWords(stripped);
};

/** Weekly is just Weekly — never the leftover OpenCode "Weekly Limit" string. */
export const formatKimiWindowLabel = (
  label: string,
  t: (key: I18nKey) => string,
): string => {
  if (label === 'weekly') return t('chat.workStatus.kimi.window.weekly');
  if (label === '5h') return t('quota.window.5h');
  return label;
};

/** Failure is null. Empty-config and slot-off are trusted payloads, not empty success. */
export const parseKimiUsagePayload = (value: unknown): KimiUsagePayload | null => {
  if (!isRecord(value)) return null;
  if (typeof value.ok !== 'boolean' || typeof value.configured !== 'boolean' || typeof value.slotActive !== 'boolean') {
    return null;
  }
  const windows: Record<string, UsageWindow> = {};
  const usage = isRecord(value.usage) ? value.usage : null;
  const rawWindows = usage && isRecord(usage.windows) ? usage.windows : null;
  if (rawWindows) {
    for (const [key, window] of Object.entries(rawWindows)) {
      const parsed = parseUsageWindow(window);
      if (parsed) windows[key] = parsed;
    }
  }
  const membershipLevel = typeof value.membershipLevel === 'string' ? value.membershipLevel.trim() : '';
  return {
    ok: value.ok,
    configured: value.configured,
    slotActive: value.slotActive,
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
    expires: asFiniteNumber(value.expires),
    usage: Object.keys(windows).length > 0 ? { windows } : null,
    fetchedAt: asFiniteNumber(value.fetchedAt) ?? undefined,
    ...(typeof value.providerId === 'string' ? { providerId: value.providerId } : {}),
    ...(typeof value.providerName === 'string' ? { providerName: value.providerName } : {}),
    ...(membershipLevel ? { membershipLevel } : {}),
  };
};

export const isKimiUsageAuthError = (message?: string | null): boolean => {
  if (!message) return false;
  return /\b(401|403|unauthorized|invalid_grant)\b/i.test(message)
    || /sign in again/i.test(message);
};

export type KimiUsagePresentation =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'notConfigured' }
  | { kind: 'error'; auth: boolean; message: string };

/** Shared Work Status / Providers status. Fetch failure is never "not signed in". */
export const presentKimiUsage = (input: {
  payload: KimiUsagePayload | null;
  error?: string | null;
  isLoading?: boolean;
}): KimiUsagePresentation => {
  const { payload, error } = input;
  const message = error || payload?.error || '';
  if (!payload) {
    if (message) return { kind: 'error', auth: isKimiUsageAuthError(message), message };
    return { kind: 'loading' };
  }
  if (!payload.slotActive) return { kind: 'loading' };
  if (!payload.configured) return { kind: 'notConfigured' };
  if (message || !payload.ok) {
    const resolved = message || 'Kimi Code usage request failed';
    return { kind: 'error', auth: isKimiUsageAuthError(resolved), message: resolved };
  }
  return { kind: 'ready' };
};

export const reconcileKimiUsageState = (
  current: { payload: KimiUsagePayload | null },
  incoming: { type: 'fetch-error'; message: string } | { type: 'parsed'; payload: KimiUsagePayload },
): { payload: KimiUsagePayload | null; error: string | null } => {
  if (incoming.type === 'fetch-error') {
    return {
      payload: current.payload,
      error: incoming.message,
    };
  }
  const next = incoming.payload;
  if (!next.slotActive) {
    return { payload: next, error: null };
  }
  if (!next.ok && next.configured && current.payload?.ok) {
    return {
      payload: current.payload,
      error: next.error || 'Kimi Code usage request failed',
    };
  }
  return {
    payload: next,
    error: next.ok ? null : (next.error ?? null),
  };
};
