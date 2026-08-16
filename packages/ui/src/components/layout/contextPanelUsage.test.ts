import { describe, expect, test } from 'bun:test';
import { mergePiSessionUsage, readPiSessionUsage } from './contextPanelUsage';

describe('readPiSessionUsage', () => {
  test('rejects missing or unavailable payloads', () => {
    expect(readPiSessionUsage(null)).toBeNull();
    expect(readPiSessionUsage({ available: false, percent: 2 })).toBeNull();
    expect(readPiSessionUsage({ available: true })).toBeNull();
  });

  test('accepts the chip-shaped Pi getContextUsage payload', () => {
    expect(readPiSessionUsage({
      available: true,
      tokens: 4000,
      contextWindow: 200000,
      percent: 2,
    })).toMatchObject({ tokens: 4000, contextWindow: 200000, percent: 2 });
  });
});

describe('mergePiSessionUsage', () => {
  test('uses Pi percent and tokens instead of zeroed message fallbacks', () => {
    const merged = mergePiSessionUsage(
      { available: true, tokens: 4000, contextLimit: 200000, percent: 2 },
      { total: 0, contextLimit: null, percent: 0 },
    );
    expect(merged).toEqual({
      total: 4000,
      contextLimit: 200000,
      percent: 2,
      unavailable: false,
    });
  });

  test('maps contextWindow when contextLimit is absent', () => {
    const merged = mergePiSessionUsage(
      { tokens: 2560, contextWindow: 128000 },
      { total: 0, contextLimit: null, percent: 0 },
    );
    expect(merged.contextLimit).toBe(128000);
    expect(merged.percent).toBe(2);
    expect(merged.unavailable).toBe(false);
  });

  test('does not invent tokens when Pi reports unknown usage', () => {
    const merged = mergePiSessionUsage(
      { available: true, tokens: null, contextWindow: 200000, percent: null },
      { total: 0, contextLimit: null, percent: 0 },
    );
    expect(merged.total).toBe(0);
    expect(merged.contextLimit).toBe(200000);
    expect(merged.unavailable).toBe(true);
  });

  test('keeps message fallback when no Pi usage is available', () => {
    const merged = mergePiSessionUsage(null, { total: 900, contextLimit: 1000, percent: 90 });
    expect(merged).toEqual({
      total: 900,
      contextLimit: 1000,
      percent: 90,
      unavailable: false,
    });
  });
});
