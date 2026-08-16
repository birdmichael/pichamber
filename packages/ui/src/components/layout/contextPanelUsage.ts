/**
 * Pi session usage for the Context panel.
 *
 * The composer chip already reads `/api/session/:id/usage` (Pi
 * `getContextUsage`). The panel used to derive fill from OpenCode
 * `message.info.tokens`, which the Pi facade historically zeroed out.
 * These helpers apply the same Pi payload the chip uses and never invent
 * token counts.
 */

export type PiSessionUsage = {
  available?: boolean;
  tokens?: number | null;
  contextLimit?: number;
  contextWindow?: number;
  percent?: number | null;
};

export type ContextUsageView = {
  total: number;
  contextLimit: number | null;
  percent: number;
  unavailable: boolean;
};

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
);

export const readPiSessionUsage = (data: unknown): PiSessionUsage | null => {
  if (!data || typeof data !== 'object') return null;
  const record = data as PiSessionUsage;
  if (record.available === false) return null;
  const hasTokens = isFiniteNumber(record.tokens);
  const hasLimit = (isFiniteNumber(record.contextLimit) && record.contextLimit > 0)
    || (isFiniteNumber(record.contextWindow) && record.contextWindow > 0);
  const hasPercent = isFiniteNumber(record.percent);
  if (!hasTokens && !hasLimit && !hasPercent) return null;
  return record;
};

export const mergePiSessionUsage = (
  usage: PiSessionUsage | null,
  fallback: { total: number; contextLimit: number | null; percent: number },
): ContextUsageView => {
  if (!usage) {
    return {
      total: fallback.total,
      contextLimit: fallback.contextLimit,
      percent: fallback.percent,
      unavailable: fallback.total <= 0 && !(fallback.contextLimit && fallback.contextLimit > 0 && fallback.percent > 0),
    };
  }

  const contextLimit = (isFiniteNumber(usage.contextLimit) && usage.contextLimit > 0)
    ? usage.contextLimit
    : (isFiniteNumber(usage.contextWindow) && usage.contextWindow > 0)
      ? usage.contextWindow
      : fallback.contextLimit;

  const hasTokens = isFiniteNumber(usage.tokens);
  const hasPercent = isFiniteNumber(usage.percent);
  const unavailable = !hasTokens && !hasPercent && fallback.total <= 0;

  const total = hasTokens
    ? Math.max(0, usage.tokens as number)
    : fallback.total;

  const percent = hasPercent
    ? usage.percent as number
    : (contextLimit && contextLimit > 0 && total > 0)
      ? (total / contextLimit) * 100
      : fallback.percent;

  return { total, contextLimit, percent, unavailable };
};
