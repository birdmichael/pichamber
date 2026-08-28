import type { UsageWindow } from '@/types';

export type XaiUsagePayload = {
  ok: boolean;
  configured: boolean;
  slotActive: boolean;
  error?: string;
  expires?: number | null;
  usage?: { windows?: Record<string, UsageWindow> } | null;
  fetchedAt?: number;
  providerId?: string;
  providerName?: string;
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

/** Failure is null. Empty-config and slot-off are trusted payloads, not empty success. */
export const parseXaiUsagePayload = (value: unknown): XaiUsagePayload | null => {
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
  };
};

export const isXaiUsageAuthError = (message?: string | null): boolean => {
  if (!message) return false;
  return /\b(401|403|unauthorized|invalid_grant|expired|refresh)\b/i.test(message)
    || /sign in again/i.test(message);
};

export type XaiUsagePresentation =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'notConfigured' }
  | { kind: 'error'; auth: boolean; message: string };

/** Shared Work Status / Providers status. Fetch failure is never "not signed in". */
export const presentXaiUsage = (input: {
  payload: XaiUsagePayload | null;
  error?: string | null;
  isLoading?: boolean;
}): XaiUsagePresentation => {
  const { payload, error } = input;
  const message = error || payload?.error || '';
  if (!payload) {
    if (message) return { kind: 'error', auth: isXaiUsageAuthError(message), message };
    return { kind: 'loading' };
  }
  if (!payload.slotActive) return { kind: 'loading' };
  if (!payload.configured) return { kind: 'notConfigured' };
  if (message || !payload.ok) {
    const resolved = message || 'xAI usage request failed';
    return { kind: 'error', auth: isXaiUsageAuthError(resolved), message: resolved };
  }
  return { kind: 'ready' };
};

export const reconcileXaiUsageState = (
  current: { payload: XaiUsagePayload | null },
  incoming: { type: 'fetch-error'; message: string } | { type: 'parsed'; payload: XaiUsagePayload },
): { payload: XaiUsagePayload | null; error: string | null } => {
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
      error: next.error || 'xAI usage request failed',
    };
  }
  return {
    payload: next,
    error: next.ok ? null : (next.error ?? null),
  };
};
