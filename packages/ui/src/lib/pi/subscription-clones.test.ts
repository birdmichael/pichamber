import { describe, expect, test } from 'bun:test';

import {
  familyIsConnected,
  isKimiSubscriptionId,
  isXaiSubscriptionId,
  subscriptionFamilyOf,
} from './subscription-clones';

describe('subscriptionFamilyOf', () => {
  test('treats numeric clones as the official family and ignores API siblings', () => {
    expect(subscriptionFamilyOf('xai')).toBe('xai');
    expect(subscriptionFamilyOf('xai-2')).toBe('xai');
    expect(isXaiSubscriptionId('xai-10')).toBe(true);
    expect(isXaiSubscriptionId('xai-api')).toBe(false);
    expect(isKimiSubscriptionId('kimi-coding-2')).toBe(true);
    expect(isKimiSubscriptionId('kimi-coding-api')).toBe(false);
    expect(familyIsConnected('xai', new Set(['xai-2']))).toBe(true);
    expect(familyIsConnected('kimi-coding', new Set(['xai']))).toBe(false);
  });
});
