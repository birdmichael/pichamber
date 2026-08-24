import { describe, expect, test } from 'bun:test';

import {
  formatToolElapsed,
  isToolPartFinalized,
  readServerDurationMs,
  resolveToolElapsedMs,
  toEpochMillis,
} from './toolElapsed';

describe('toolElapsed', () => {
  test('treats unix seconds as milliseconds', () => {
    expect(toEpochMillis(1_700_000_000)).toBe(1_700_000_000_000);
    expect(toEpochMillis(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toEpochMillis(20)).toBe(20);
  });

  test('prefers server duration over a live clock', () => {
    expect(resolveToolElapsedMs({
      start: 1_000,
      end: 2_000,
      durationMs: 18_400,
      now: 50_000,
      finalized: true,
    })).toBe(18_400);
  });

  test('freezes at end when finalized and no duration is present', () => {
    expect(resolveToolElapsedMs({
      start: 1_000,
      end: 19_400,
      now: 80_000,
      finalized: true,
    })).toBe(18_400);
  });

  test('keeps counting only while the part is still running', () => {
    expect(resolveToolElapsedMs({
      start: 1_000,
      now: 21_300,
      finalized: false,
    })).toBe(20_300);
  });

  test('reads duration from time or metadata', () => {
    expect(readServerDurationMs({ time: { duration: 18400 } })).toBe(18400);
    expect(readServerDurationMs({ metadata: { durationMs: 2100 } })).toBe(2100);
    expect(readServerDurationMs({})).toBeUndefined();
  });

  test('finalizes from status, end, or duration', () => {
    expect(isToolPartFinalized({ status: 'completed' })).toBe(true);
    expect(isToolPartFinalized({ status: 'running', timeEnd: 9 })).toBe(true);
    expect(isToolPartFinalized({ status: 'running', durationMs: 12 })).toBe(true);
    expect(isToolPartFinalized({ status: 'running' })).toBe(false);
  });

  test('formats a completed sub-frame duration as 0.1s', () => {
    expect(formatToolElapsed(20, true)).toBe('0.1s');
    expect(formatToolElapsed(18_400, true)).toBe('18.4s');
  });
});
