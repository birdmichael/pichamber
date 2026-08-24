import { getCurrentIntlLocale } from '@/lib/i18n';
import { formatMessage, useI18nStore } from '@/lib/i18n/store';
import { formatTimeForPreference, resolveDisplayTimeZone, toDisplayEpochMs } from '@/lib/timeFormat';
import type { TimeFormatPreference } from '@/stores/useUIStore';

const zonedDateParts = (date: Date, timeZone: string): { year: number; month: number; day: number } => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
    }).formatToParts(date);
    const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return { year: read('year'), month: read('month'), day: read('day') };
};

const isSameCalendarDay = (
    left: { year: number; month: number; day: number },
    right: { year: number; month: number; day: number },
): boolean => (
    left.year === right.year && left.month === right.month && left.day === right.day
);

const isYesterdayCalendarDay = (
    dateParts: { year: number; month: number; day: number },
    now: Date,
    timeZone: string,
): boolean => {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return isSameCalendarDay(dateParts, zonedDateParts(yesterday, timeZone));
};

const isValidTimestamp = (timestamp: number): boolean => {
    return Number.isFinite(toDisplayEpochMs(timestamp)) && !Number.isNaN(new Date(toDisplayEpochMs(timestamp)).getTime());
};

export const formatTimestampForDisplay = (timestamp: number, timeFormatPreference: TimeFormatPreference): string => {
    if (!isValidTimestamp(timestamp)) {
        return '';
    }

    const date = new Date(toDisplayEpochMs(timestamp));
    const now = new Date();
    const timeZone = resolveDisplayTimeZone();
    const timePart = formatTimeForPreference(date, timeFormatPreference);
    const locale = getCurrentIntlLocale();
    const dictionary = useI18nStore.getState().dictionary;
    const dateParts = zonedDateParts(date, timeZone);
    const nowParts = zonedDateParts(now, timeZone);

    if (isSameCalendarDay(dateParts, nowParts)) {
        return timePart;
    }

    if (isYesterdayCalendarDay(dateParts, now, timeZone)) {
        return formatMessage(dictionary, 'common.date.yesterdayWithTime', { time: timePart });
    }

    const monthPart = date.toLocaleString(locale, { month: 'short', timeZone });
    const datePart = `${monthPart} ${dateParts.day}`;

    if (dateParts.year === nowParts.year) {
        return `${datePart}, ${timePart}`;
    }

    return `${datePart}, ${dateParts.year}, ${timePart}`;
};
