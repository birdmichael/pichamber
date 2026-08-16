import { describe, expect, test } from 'bun:test';
import { canOfferOpenCodeSessionStub } from './usePiKernel';

describe('canOfferOpenCodeSessionStub', () => {
  test('hides share, revert, and shell on the Pi kernel', () => {
    expect(canOfferOpenCodeSessionStub(true)).toBe(false);
  });

  test('keeps share, revert, and shell on OpenCode', () => {
    expect(canOfferOpenCodeSessionStub(false)).toBe(true);
  });
});
