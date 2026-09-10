import { describe, expect, test } from 'bun:test';

import {
  familyHasRootConnected,
  familyIsConnected,
  familyRootIsStored,
  isKimiApiSiblingDisplayName,
  isKimiApiSiblingId,
  isKimiCodeUsageProvider,
  isKimiSubscriptionId,
  isXaiSubscriptionId,
  shouldCloneOfficialSubscription,
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
    expect(familyHasRootConnected('kimi-coding', new Set(['kimi-coding-2']))).toBe(false);
    expect(familyHasRootConnected('kimi-coding', new Set(['kimi-coding']))).toBe(true);
  });

  test('API-only kimi-coding-2 does not count as family connected for clone gating', () => {
    const providers = [{ id: 'kimi-coding-2', name: 'Kimi API' }];
    expect(familyIsConnected('kimi-coding', new Set(['kimi-coding-2']), providers)).toBe(false);
    expect(familyIsConnected('kimi-coding', new Set(['kimi-coding']), [{ id: 'kimi-coding', name: 'Kimi Code' }])).toBe(true);
    expect(familyIsConnected('kimi-coding', new Set(['kimi-coding-3']), [{ id: 'kimi-coding-3', name: 'Work' }])).toBe(true);
  });
});

describe('isKimiCodeUsageProvider', () => {
  test('lists Code OAuth rows and excludes Completions API siblings', () => {
    expect(isKimiApiSiblingId('kimi-coding-api')).toBe(true);
    expect(isKimiApiSiblingId('kimi-coding-2')).toBe(false);
    expect(isKimiApiSiblingDisplayName('Kimi API')).toBe(true);
    expect(isKimiApiSiblingDisplayName('Kimi Code API')).toBe(true);
    expect(isKimiApiSiblingDisplayName('Kimi Code')).toBe(false);
    expect(isKimiCodeUsageProvider({ id: 'kimi-coding', name: 'Kimi Code' })).toBe(true);
    expect(isKimiCodeUsageProvider({ id: 'kimi-coding-3', name: 'Work' })).toBe(true);
    expect(isKimiCodeUsageProvider({ id: 'kimi-coding-2', name: 'Kimi API' })).toBe(false);
    expect(isKimiCodeUsageProvider({ id: 'kimi-coding-api', name: 'Kimi Code API' })).toBe(false);
    expect(isKimiCodeUsageProvider('kimi-coding')).toBe(true);
    expect(isKimiCodeUsageProvider('kimi-coding-api')).toBe(false);
  });
});

describe('familyRootIsStored / shouldCloneOfficialSubscription', () => {
  test('API sibling alone does not unlock clone; root auth or models does', () => {
    expect(familyRootIsStored({
      catalogAuth: { exists: false },
      user: { exists: false },
      auth: { exists: true },
      apiKey: { exists: true },
      oauth: { exists: false },
    })).toBe(false);
    expect(shouldCloneOfficialSubscription(
      'kimi-coding',
      new Set(['kimi-coding', 'kimi-coding-2']),
      { catalogAuth: { exists: false }, user: { exists: false }, auth: { exists: true } },
    )).toBe(false);
    expect(familyRootIsStored({ catalogAuth: { exists: true }, user: { exists: false } })).toBe(true);
    expect(familyRootIsStored({ catalogAuth: { exists: false }, user: { exists: true } })).toBe(true);
    expect(shouldCloneOfficialSubscription(
      'kimi-coding',
      new Set(['kimi-coding']),
      { catalogAuth: { exists: true }, user: { exists: false } },
    )).toBe(true);
    // Without sources, fall back to root id in connected set.
    expect(shouldCloneOfficialSubscription('kimi-coding', new Set(['kimi-coding-2']))).toBe(false);
    expect(shouldCloneOfficialSubscription('kimi-coding', new Set(['kimi-coding']))).toBe(true);
  });
});
