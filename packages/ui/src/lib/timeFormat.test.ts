import { describe, expect, test } from 'bun:test';

import { toDisplayEpochMs } from './timeFormat';

describe('toDisplayEpochMs', () => {
  test('converts unix seconds and leaves milliseconds alone', () => {
    expect(toDisplayEpochMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(toDisplayEpochMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toDisplayEpochMs(20)).toBe(20);
  });

  test('accepts Date values', () => {
    const date = new Date('2026-08-24T05:22:00.000Z');
    expect(toDisplayEpochMs(date)).toBe(date.getTime());
  });
});
