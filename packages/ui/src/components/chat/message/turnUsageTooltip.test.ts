import { describe, expect, test } from 'bun:test';

import { formatTurnUsageCost, resolveTurnUsageTooltip } from './turnUsageTooltip';

describe('resolveTurnUsageTooltip', () => {
  test('returns null when there is no recorded usage object', () => {
    expect(resolveTurnUsageTooltip(undefined, undefined)).toBeNull();
    expect(resolveTurnUsageTooltip(null, 1.25)).toBeNull();
    expect(resolveTurnUsageTooltip(1200, 0.5)).toBeNull();
    expect(resolveTurnUsageTooltip('tokens', 0.5)).toBeNull();
  });

  test('treats a recorded all-zero breakdown as real usage, not missing', () => {
    expect(resolveTurnUsageTooltip({
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    }, 0)).toEqual({
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: null,
    });
  });

  test('fills missing token fields with 0 instead of dropping the tooltip', () => {
    expect(resolveTurnUsageTooltip({}, undefined)).toEqual({
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: null,
    });
  });

  test('lists cache read and write separately', () => {
    const result = resolveTurnUsageTooltip({
      input: 100,
      output: 40,
      reasoning: 12,
      cache: { read: 80, write: 20 },
    }, undefined);
    expect(result).toEqual({
      input: 100,
      output: 40,
      reasoning: 12,
      cacheRead: 80,
      cacheWrite: 20,
      cost: null,
    });
  });

  test('hides cost when it is 0, missing, or not a finite number', () => {
    const tokens = { input: 10, output: 4, reasoning: 0, cache: { read: 0, write: 0 } };
    expect(resolveTurnUsageTooltip(tokens, 0)?.cost).toBeNull();
    expect(resolveTurnUsageTooltip(tokens, undefined)?.cost).toBeNull();
    expect(resolveTurnUsageTooltip(tokens, Number.NaN)?.cost).toBeNull();
    expect(resolveTurnUsageTooltip(tokens, Number.POSITIVE_INFINITY)?.cost).toBeNull();
    expect(resolveTurnUsageTooltip(tokens, -0.12)?.cost).toBeNull();
    expect(resolveTurnUsageTooltip(tokens, { total: 1.5 })?.cost).toBeNull();
  });

  test('shows cost only when it is a finite number greater than 0', () => {
    const tokens = { input: 10, output: 4 };
    expect(resolveTurnUsageTooltip(tokens, 0.0123)?.cost).toBe('$0.0123');
    expect(resolveTurnUsageTooltip(tokens, 1.5)?.cost).toBe('$1.5');
    expect(resolveTurnUsageTooltip(tokens, 2)?.cost).toBe('$2');
  });
});

describe('formatTurnUsageCost', () => {
  test('matches Work Status: dollar sign and trimmed four-decimal precision', () => {
    expect(formatTurnUsageCost(1.23456)).toBe('$1.2346');
    expect(formatTurnUsageCost(0.1)).toBe('$0.1');
    expect(formatTurnUsageCost(3)).toBe('$3');
  });
});
