import { describe, expect, test } from 'bun:test';

import {
  parseXaiUsagePayload,
  presentXaiUsage,
  reconcileXaiUsageState,
} from './xai-usage';

describe('parseXaiUsagePayload', () => {
  test('rejects malformed payloads instead of empty success', () => {
    expect(parseXaiUsagePayload(null)).toBeNull();
    expect(parseXaiUsagePayload({})).toBeNull();
    expect(parseXaiUsagePayload({ ok: false })).toBeNull();
  });

  test('keeps slot-off and not-configured as trusted non-success', () => {
    expect(parseXaiUsagePayload({ ok: false, configured: false, slotActive: false })).toEqual({
      ok: false,
      configured: false,
      slotActive: false,
      expires: null,
      usage: null,
    });
    expect(parseXaiUsagePayload({ ok: false, configured: false, slotActive: true })).toMatchObject({
      ok: false,
      configured: false,
      slotActive: true,
    });
  });

  test('parses a billing window without inventing 0%', () => {
    const parsed = parseXaiUsagePayload({
      ok: true,
      configured: true,
      slotActive: true,
      expires: 1_900_000_000_000,
      usage: {
        windows: {
          billing_cycle: {
            usedPercent: 25,
            remainingPercent: 75,
            windowSeconds: null,
            resetAfterSeconds: 60,
            resetAt: 1_900_000_000_000,
            resetAtFormatted: null,
            resetAfterFormatted: null,
          },
        },
      },
    });
    expect(parsed?.ok).toBe(true);
    expect(parsed?.usage?.windows?.billing_cycle?.usedPercent).toBe(25);
  });
});

describe('presentXaiUsage', () => {
  test('first-load fetch failure is an error, not not-configured', () => {
    expect(presentXaiUsage({
      payload: null,
      error: 'xAI usage failed (502)',
    })).toEqual({
      kind: 'error',
      auth: false,
      message: 'xAI usage failed (502)',
    });
  });

  test('keeps last-good rows visible as an auth error when refresh failed', () => {
    expect(presentXaiUsage({
      payload: {
        ok: true,
        configured: true,
        slotActive: true,
        usage: { windows: { billing_cycle: {
          usedPercent: 10,
          remainingPercent: 90,
          windowSeconds: null,
          resetAfterSeconds: null,
          resetAt: null,
          resetAtFormatted: null,
          resetAfterFormatted: null,
        } } },
      },
      error: 'xAI OAuth token refresh failed (HTTP 401)',
    })).toMatchObject({ kind: 'error', auth: true });
  });

  test('missing oauth is not configured only after a trusted payload', () => {
    expect(presentXaiUsage({
      payload: { ok: false, configured: false, slotActive: true },
    })).toEqual({ kind: 'notConfigured' });
  });
});

describe('reconcileXaiUsageState', () => {
  const okPayload = {
    ok: true as const,
    configured: true,
    slotActive: true,
    usage: { windows: { billing_cycle: {
      usedPercent: 10,
      remainingPercent: 90,
      windowSeconds: null,
      resetAfterSeconds: null,
      resetAt: null,
      resetAtFormatted: null,
      resetAfterFormatted: null,
    } } },
  };

  test('keeps the last ok snapshot when a later configured fetch fails', () => {
    expect(reconcileXaiUsageState(
      { payload: okPayload },
      { type: 'parsed', payload: { ok: false, configured: true, slotActive: true, error: 'network down' } },
    )).toEqual({
      payload: okPayload,
      error: 'network down',
    });
  });

  test('keeps the last snapshot when the HTTP request fails', () => {
    expect(reconcileXaiUsageState(
      { payload: okPayload },
      { type: 'fetch-error', message: 'xAI usage failed (502)' },
    )).toEqual({
      payload: okPayload,
      error: 'xAI usage failed (502)',
    });
  });

  test('replaces state when the slot turns off', () => {
    expect(reconcileXaiUsageState(
      { payload: okPayload },
      { type: 'parsed', payload: { ok: false, configured: false, slotActive: false } },
    )).toEqual({
      payload: { ok: false, configured: false, slotActive: false },
      error: null,
    });
  });
});
