import { getCurrentIntlLocale } from '@/lib/i18n';
import type { TimeFormatPreference } from '@/stores/useUIStore';

type TimePrecision = 'minute' | 'second';

const UNIX_SECONDS_FLOOR = 1e9;
const UNIX_SECONDS_CEILING = 1e12;

export const toDisplayEpochMs = (timestamp: number | Date): number => {
  if (timestamp instanceof Date) return timestamp.getTime();
  if (!Number.isFinite(timestamp)) return Number.NaN;
  return timestamp >= UNIX_SECONDS_FLOOR && timestamp < UNIX_SECONDS_CEILING
    ? timestamp * 1000
    : timestamp;
};

export const resolveDisplayTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const getHour12Option = (preference: TimeFormatPreference): boolean | undefined => {
  if (preference === '12h') return true;
  if (preference === '24h') return false;
  return undefined;
};

export const formatTimeForPreference = (
  timestamp: number | Date,
  preference: TimeFormatPreference,
  options: { precision?: TimePrecision; hour?: 'numeric' | '2-digit'; fallback?: string } = {},
): string => {
  const date = timestamp instanceof Date ? timestamp : new Date(toDisplayEpochMs(timestamp));
  if (!Number.isFinite(date.getTime())) {
    return options.fallback ?? '';
  }

  return date.toLocaleTimeString(getCurrentIntlLocale(), {
    hour: options.hour ?? 'numeric',
    minute: '2-digit',
    second: options.precision === 'second' ? '2-digit' : undefined,
    hour12: getHour12Option(preference),
    timeZone: resolveDisplayTimeZone(),
  });
};

export const formatDateTimeForPreference = (
  timestamp: number | Date,
  preference: TimeFormatPreference,
  options: Intl.DateTimeFormatOptions,
): string => {
  const date = timestamp instanceof Date ? timestamp : new Date(toDisplayEpochMs(timestamp));
  if (!Number.isFinite(date.getTime())) {
    return '';
  }

  return date.toLocaleString(getCurrentIntlLocale(), {
    ...options,
    hour12: options.hour ? getHour12Option(preference) : options.hour12,
    timeZone: options.timeZone ?? resolveDisplayTimeZone(),
  });
};
