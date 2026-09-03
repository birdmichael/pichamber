import { describe, expect, test } from 'bun:test';

import { dict as enDict } from '@/lib/i18n/messages/en';
import type { I18nKey } from '@/lib/i18n';

import {
  formatKimiMembershipLabel,
  formatKimiWindowLabel,
  parseKimiUsagePayload,
  presentKimiUsage,
  reconcileKimiUsageState,
} from './kimi-usage';

const t = (key: I18nKey) => enDict[key];

describe('parseKimiUsagePayload', () => {
  test('rejects malformed payloads instead of empty success', () => {
    expect(parseKimiUsagePayload(null)).toBeNull();
    expect(parseKimiUsagePayload({})).toBeNull();
    expect(parseKimiUsagePayload({ ok: false })).toBeNull();
  });

  test('keeps slot-off and not-configured as trusted non-success', () => {
    expect(parseKimiUsagePayload({ ok: false, configured: false, slotActive: false })).toEqual({
      ok: false,
      configured: false,
      slotActive: false,
      expires: null,
      usage: null,
    });
    expect(parseKimiUsagePayload({ ok: false, configured: false, slotActive: true })).toMatchObject({
      ok: false,
      configured: false,
      slotActive: true,
    });
  });

  test('parses a billing window without inventing 0%', () => {
    const parsed = parseKimiUsagePayload({
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

  test('parses membershipLevel when it is a non-empty string', () => {
    const parsed = parseKimiUsagePayload({
      ok: true,
      configured: true,
      slotActive: true,
      membershipLevel: 'LEVEL_INTERMEDIATE',
      usage: {
        windows: {
          weekly: {
            usedPercent: 10,
            remainingPercent: 90,
            windowSeconds: 1,
            resetAfterSeconds: null,
            resetAt: null,
            resetAtFormatted: null,
            resetAfterFormatted: null,
          },
        },
      },
    });
    expect(parsed?.membershipLevel).toBe('LEVEL_INTERMEDIATE');
  });

  test('omits empty membershipLevel', () => {
    expect(parseKimiUsagePayload({
      ok: true,
      configured: true,
      slotActive: true,
      membershipLevel: '   ',
    })?.membershipLevel).toBeUndefined();
  });
});


describe('formatKimiWindowLabel', () => {
  test('weekly is Weekly without Limit; 5h stays 5-Hour', () => {
    expect(formatKimiWindowLabel('weekly', t)).toBe('Weekly');
    expect(formatKimiWindowLabel('weekly', t)).not.toContain('Limit');
    expect(formatKimiWindowLabel('5h', t)).toBe('5-Hour');
  });
});

describe('formatKimiMembershipLabel', () => {
  test('translates known membership enums and never renders the raw LEVEL_* value', () => {
    expect(formatKimiMembershipLabel('LEVEL_FREE', t)).toBe('Free');
    expect(formatKimiMembershipLabel('LEVEL_BASIC', t)).toBe('Basic');
    expect(formatKimiMembershipLabel('LEVEL_INTERMEDIATE', t)).toBe('Intermediate');
    expect(formatKimiMembershipLabel('LEVEL_ADVANCED', t)).toBe('Advanced');
    expect(formatKimiMembershipLabel('LEVEL_PROFESSIONAL', t)).toBe('Professional');
    expect(formatKimiMembershipLabel('LEVEL_PRO', t)).toBe('Professional');
    expect(formatKimiMembershipLabel('LEVEL_ENTERPRISE', t)).toBe('Enterprise');
    expect(formatKimiMembershipLabel('LEVEL_INTERMEDIATE', t)).not.toBe('LEVEL_INTERMEDIATE');
  });

  test('title-cases unknown levels after stripping LEVEL_', () => {
    expect(formatKimiMembershipLabel('LEVEL_CUSTOM_TIER', t)).toBe('Custom Tier');
    expect(formatKimiMembershipLabel('gold_plan', t)).toBe('Gold Plan');
    expect(formatKimiMembershipLabel('', t)).toBeNull();
    expect(formatKimiMembershipLabel(undefined, t)).toBeNull();
  });
});

describe('presentKimiUsage', () => {
  test('first-load fetch failure is an error, not not-configured', () => {
    expect(presentKimiUsage({
      payload: null,
      error: 'Kimi Code usage failed (502)',
    })).toEqual({
      kind: 'error',
      auth: false,
      message: 'Kimi Code usage failed (502)',
    });
  });

  test('does not treat a missing refresh helper as sign-in-again', () => {
    expect(presentKimiUsage({
      payload: { ok: false, configured: true, slotActive: true, error: 'Pi Kimi Code OAuth refresh helper is unavailable' },
    })).toEqual({
      kind: 'error',
      auth: false,
      message: 'Pi Kimi Code OAuth refresh helper is unavailable',
    });
  });

  test('keeps last-good rows visible as an auth error when refresh failed', () => {
    expect(presentKimiUsage({
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
      error: 'Kimi Code OAuth token refresh failed (HTTP 401)',
    })).toMatchObject({ kind: 'error', auth: true });
  });

  test('missing oauth is not configured only after a trusted payload', () => {
    expect(presentKimiUsage({
      payload: { ok: false, configured: false, slotActive: true },
    })).toEqual({ kind: 'notConfigured' });
  });
});

describe('reconcileKimiUsageState', () => {
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
    expect(reconcileKimiUsageState(
      { payload: okPayload },
      { type: 'parsed', payload: { ok: false, configured: true, slotActive: true, error: 'network down' } },
    )).toEqual({
      payload: okPayload,
      error: 'network down',
    });
  });

  test('keeps the last snapshot when the HTTP request fails', () => {
    expect(reconcileKimiUsageState(
      { payload: okPayload },
      { type: 'fetch-error', message: 'Kimi Code usage failed (502)' },
    )).toEqual({
      payload: okPayload,
      error: 'Kimi Code usage failed (502)',
    });
  });

  test('replaces state when the slot turns off', () => {
    expect(reconcileKimiUsageState(
      { payload: okPayload },
      { type: 'parsed', payload: { ok: false, configured: false, slotActive: false } },
    )).toEqual({
      payload: { ok: false, configured: false, slotActive: false },
      error: null,
    });
  });
});
