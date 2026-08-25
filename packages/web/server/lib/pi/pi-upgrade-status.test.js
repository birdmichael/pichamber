import { describe, expect, it } from 'vitest';

import {
  comparePiSdkVersions,
  getPiUpgradeStatus,
  npmLatestUrlForPackage,
  PI_SDK_PACKAGE,
  shouldSkipPiVersionCheck,
} from './pi-upgrade-status.js';

describe('pi-upgrade-status', () => {
  it('compares SDK versions and treats a newer latest as available', () => {
    expect(comparePiSdkVersions('0.85.0', '0.84.2')).toBeGreaterThan(0);
    expect(comparePiSdkVersions('0.84.2', '0.84.2')).toBe(0);
    expect(comparePiSdkVersions('0.84.1', '0.84.2')).toBeLessThan(0);
  });

  it('skips the npm check when PI_OFFLINE or PI_SKIP_VERSION_CHECK is set', () => {
    expect(shouldSkipPiVersionCheck({ PI_OFFLINE: '1' })).toBe(true);
    expect(shouldSkipPiVersionCheck({ PI_SKIP_VERSION_CHECK: 'true' })).toBe(true);
    expect(shouldSkipPiVersionCheck({ PI_OFFLINE: '0' })).toBe(false);
    expect(shouldSkipPiVersionCheck({})).toBe(false);
  });

  it('returns a bundled upgrade payload without calling npm when skipped', async () => {
    let called = 0;
    const status = await getPiUpgradeStatus({
      currentVersion: '0.84.2',
      env: { PI_OFFLINE: '1' },
      fetchImpl: async () => {
        called += 1;
        throw new Error('should not fetch');
      },
    });
    expect(called).toBe(0);
    expect(status).toEqual({
      available: false,
      currentVersion: '0.84.2',
      latestVersion: null,
      package: PI_SDK_PACKAGE,
      upgrade: { supported: false, reason: 'bundled' },
    });
  });

  it('reports an informational update when npm has a newer SDK', async () => {
    const status = await getPiUpgradeStatus({
      currentVersion: '0.84.2',
      env: {},
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ version: '0.90.0' }),
      }),
    });
    expect(status).toEqual({
      available: true,
      currentVersion: '0.84.2',
      latestVersion: '0.90.0',
      package: PI_SDK_PACKAGE,
      upgrade: { supported: false, reason: 'bundled' },
    });
  });

  it('builds the same npm latest URL shape used by the header banner', () => {
    expect(npmLatestUrlForPackage(PI_SDK_PACKAGE)).toBe(
      'https://registry.npmjs.org/@earendil-works%2Fpi-coding-agent/latest',
    );
  });

  it('does not claim an update is available when the npm check fails', async () => {
    const status = await getPiUpgradeStatus({
      currentVersion: '0.84.2',
      env: {},
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });
    expect(status.available).toBe(false);
    expect(status.latestVersion).toBeNull();
    expect(status.upgrade).toEqual({ supported: false, reason: 'bundled' });
  });
});
