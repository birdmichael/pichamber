import { describe, expect, test } from 'bun:test';

import { resolveTrayUsage } from './useTraySync';

describe('resolveTrayUsage', () => {
  test('omits leftover provider quota on Pi so the tray has no Usage submenu', () => {
    expect(resolveTrayUsage(true)).toEqual({ mode: 'usage', groups: [] });
  });

  test('keeps leftover OpenCode tray usage shape when quota is available', () => {
    const usage = resolveTrayUsage(false);
    expect(usage.mode === 'usage' || usage.mode === 'remaining').toBe(true);
    expect(Array.isArray(usage.groups)).toBe(true);
  });
});
