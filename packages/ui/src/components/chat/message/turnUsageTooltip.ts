const isRecord = (value: unknown): value is Record<string, unknown> => (
    Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const toFiniteNumber = (value: unknown): number | null => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return value;
};

const toTokenCount = (value: unknown): number => toFiniteNumber(value) ?? 0;

/**
 * Spend readout matches Work Status: `$` plus up to four decimals, trailing
 * zeros dropped. Callers must already know the value is a finite number > 0.
 */
export const formatTurnUsageCost = (cost: number): string => {
    const fixed = cost.toFixed(4);
    const trimmed = fixed.includes('.')
        ? fixed.replace(/0+$/, '').replace(/\.$/, '')
        : fixed;
    return `$${trimmed}`;
};

export type TurnUsageTooltipModel = {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
    /** Formatted `$…` string when `cost` is a finite number greater than 0. */
    cost: string | null;
};

/**
 * Build the timestamp-hover usage rows from recorded assistant `info.tokens`
 * (and optional `info.cost`).
 *
 * Returns `null` when there is no recorded tokens object, so the footer keeps
 * today's timestamp-only tooltip. A tokens object with zeros is real usage and
 * must not be replaced with a fake empty state. Cost is omitted at 0/missing.
 */
export const resolveTurnUsageTooltip = (
    tokens: unknown,
    cost: unknown,
): TurnUsageTooltipModel | null => {
    if (!isRecord(tokens)) {
        return null;
    }

    const cache = isRecord(tokens.cache) ? tokens.cache : null;
    const costValue = toFiniteNumber(cost);

    return {
        input: toTokenCount(tokens.input),
        output: toTokenCount(tokens.output),
        reasoning: toTokenCount(tokens.reasoning),
        cacheRead: toTokenCount(cache?.read),
        cacheWrite: toTokenCount(cache?.write),
        cost: costValue !== null && costValue > 0 ? formatTurnUsageCost(costValue) : null,
    };
};
