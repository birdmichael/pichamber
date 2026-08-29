import { describe, expect, test } from 'bun:test';

import { createSystemPresenceLatch, shouldReportPushVisibility } from './usePushVisibilityBeacon';

describe('shouldReportPushVisibility', () => {
  test('includes Electron desktop so lock-screen can report hidden', () => {
    expect(shouldReportPushVisibility({
      isWeb: false,
      isCapacitor: false,
      isDesktop: true,
    })).toBe(true);
  });

  test('keeps web and Capacitor beacons', () => {
    expect(shouldReportPushVisibility({
      isWeb: true,
      isCapacitor: false,
      isDesktop: false,
    })).toBe(true);
    expect(shouldReportPushVisibility({
      isWeb: false,
      isCapacitor: true,
      isDesktop: false,
    })).toBe(true);
  });

  test('does not beacon from an unknown non-desktop runtime', () => {
    expect(shouldReportPushVisibility({
      isWeb: false,
      isCapacitor: false,
      isDesktop: false,
    })).toBe(false);
  });
});

describe('createSystemPresenceLatch', () => {
  test('lock-screen hidden is not cleared by a visible heartbeat until unlock', () => {
    const latch = createSystemPresenceLatch();
    expect(latch.allowsVisibleHeartbeat()).toBe(true);

    expect(latch.apply(false)).toBe('hidden');
    expect(latch.allowsVisibleHeartbeat()).toBe(false);

    // A 20s visible heartbeat must not undo lock. The hook only reports
    // visible when allowsVisibleHeartbeat() is true.
    expect(latch.allowsVisibleHeartbeat()).toBe(false);

    expect(latch.apply(true)).toBe('report');
    expect(latch.allowsVisibleHeartbeat()).toBe(true);
  });

  test('lock then apply(undefined) stays hidden', () => {
    const latch = createSystemPresenceLatch();
    expect(latch.apply(false)).toBe('hidden');
    expect(latch.apply(undefined)).toBe('noop');
    expect(latch.allowsVisibleHeartbeat()).toBe(false);
  });

  test('lock then apply(true) reports and allows heartbeat', () => {
    const latch = createSystemPresenceLatch();
    expect(latch.apply(false)).toBe('hidden');
    expect(latch.apply(true)).toBe('report');
    expect(latch.allowsVisibleHeartbeat()).toBe(true);
  });
});
