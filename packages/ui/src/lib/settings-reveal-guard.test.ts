import { describe, expect, test } from 'bun:test';

import { isSettingsRevealArmed, SETTINGS_REVEAL_GUARD_MS } from './settings-reveal-guard';

describe('settings reveal click guard', () => {
  test('ignores the leftover click immediately after a row appears', () => {
    expect(isSettingsRevealArmed(1000, 1000)).toBe(true);
    expect(isSettingsRevealArmed(1000, 1000 + SETTINGS_REVEAL_GUARD_MS - 1)).toBe(true);
  });

  test('stops ignoring once the guard window ends', () => {
    expect(isSettingsRevealArmed(1000, 1000 + SETTINGS_REVEAL_GUARD_MS)).toBe(false);
    expect(isSettingsRevealArmed(0, 1000)).toBe(false);
  });
});
