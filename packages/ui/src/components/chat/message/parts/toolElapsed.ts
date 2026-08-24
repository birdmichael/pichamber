const UNIX_SECONDS_FLOOR = 1e9;
const UNIX_SECONDS_CEILING = 1e12;

export const toEpochMillis = (value: number): number => {
  if (!Number.isFinite(value)) return value;
  return value >= UNIX_SECONDS_FLOOR && value < UNIX_SECONDS_CEILING ? value * 1000 : value;
};

const readFiniteNumber = (value: unknown): number | undefined => {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

export const readServerDurationMs = (input: {
  time?: { duration?: unknown; durationMs?: unknown } | null;
  metadata?: { duration?: unknown; durationMs?: unknown } | null;
}): number | undefined => {
  const candidates = [
    input.time?.durationMs,
    input.time?.duration,
    input.metadata?.durationMs,
    input.metadata?.duration,
  ];
  for (const candidate of candidates) {
    const value = readFiniteNumber(candidate);
    if (value !== undefined && value >= 0) {
      return value;
    }
  }
  return undefined;
};

export const resolveToolElapsedMs = (input: {
  start?: number;
  end?: number;
  durationMs?: number;
  now: number;
  finalized: boolean;
}): number => {
  if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) && input.durationMs >= 0) {
    return input.durationMs;
  }
  if (typeof input.start !== 'number' || !Number.isFinite(input.start)) {
    return 0;
  }
  const start = toEpochMillis(input.start);
  const end = input.finalized && typeof input.end === 'number'
    ? toEpochMillis(input.end)
    : toEpochMillis(input.now);
  return Math.max(0, end - start);
};

export const formatToolElapsed = (elapsedMs: number, finalized: boolean): string => {
  const seconds = elapsedMs / 1000;
  const displaySeconds = seconds < 0.05 && finalized ? 0.1 : seconds;
  return `${displaySeconds.toFixed(1)}s`;
};

export const isToolPartFinalized = (input: {
  status?: string;
  timeEnd?: number;
  durationMs?: number;
}): boolean => {
  const status = input.status;
  if (
    status === 'completed'
    || status === 'error'
    || status === 'aborted'
    || status === 'failed'
    || status === 'timeout'
    || status === 'cancelled'
  ) {
    return true;
  }
  if (typeof input.timeEnd === 'number' && Number.isFinite(input.timeEnd)) {
    return true;
  }
  return typeof input.durationMs === 'number' && Number.isFinite(input.durationMs);
};
