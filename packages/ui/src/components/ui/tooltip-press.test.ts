import { describe, expect, test } from 'bun:test';

import {
  isPrimaryMouseTooltipPointer,
  shouldSuppressTooltipOpen,
} from './tooltip-press';

describe('tooltip press', () => {
  test('blocks opening while the activating mouse press is down', () => {
    expect(shouldSuppressTooltipOpen({
      nextOpen: true,
      pointerPressActive: true,
    })).toBe(true);
  });

  test('allows hover open after the press ends', () => {
    expect(shouldSuppressTooltipOpen({
      nextOpen: true,
      pointerPressActive: false,
    })).toBe(false);
  });

  test('still allows close during the press', () => {
    expect(shouldSuppressTooltipOpen({
      nextOpen: false,
      pointerPressActive: true,
    })).toBe(false);
  });

  test('treats only the primary mouse button as an activating press', () => {
    expect(isPrimaryMouseTooltipPointer('mouse', 0)).toBe(true);
    expect(isPrimaryMouseTooltipPointer('mouse', 2)).toBe(false);
    expect(isPrimaryMouseTooltipPointer('touch', 0)).toBe(false);
  });
});
