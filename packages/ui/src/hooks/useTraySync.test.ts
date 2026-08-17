import { describe, expect, test } from 'bun:test';

import { resolveTrayUsage } from './useTraySync';

describe('resolveTrayUsage', () => {
  test('omits leftover provider quota on Pi so the tray has no Usage submenu', () => {
    expect(resolveTrayUsage(true)).toEqual({ mode: 'usage', groups: [] });
  });
});
