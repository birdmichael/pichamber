import { describe, expect, test } from 'bun:test';

import { createSystemPresenceLatch } from './usePushVisibilityBeacon';

describe('createSystemPresenceLatch', () => {
  test('lock-screen hidden is not cleared by a visible heartbeat until unlock', () => {
    const latch = createSystemPresenceLatch();
    expect(latch.allowsVisibleHeartbeat()).toBe(true);

    expect(latch.apply(false)).toBe('hidden');
    expect(latch.allowsVisibleHeartbeat()).toBe(false);

    expect(latch.apply(true)).toBe('report');
    expect(latch.allowsVisibleHeartbeat()).toBe(true);
  });
});
