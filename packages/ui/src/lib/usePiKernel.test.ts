import { describe, expect, test } from 'bun:test';
import { canOfferOpenCodeSessionStub, isSessionGoalVisibleOnPiKernel } from './usePiKernel';

describe('canOfferOpenCodeSessionStub', () => {
  test('hides share, revert, and shell on the Pi kernel', () => {
    expect(canOfferOpenCodeSessionStub(true)).toBe(false);
  });

  test('keeps share, revert, and shell on OpenCode', () => {
    expect(canOfferOpenCodeSessionStub(false)).toBe(true);
  });
});

describe('isSessionGoalVisibleOnPiKernel', () => {
  test('keeps Session Goal visible on the Pi kernel', () => {
    expect(isSessionGoalVisibleOnPiKernel(true)).toBe(true);
  });

  test('keeps Session Goal visible on OpenCode', () => {
    expect(isSessionGoalVisibleOnPiKernel(false)).toBe(true);
  });
});
