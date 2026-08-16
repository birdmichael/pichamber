import { describe, expect, test } from 'bun:test';
import { canOfferOpenCodeSessionStub, isMcpFeaturePluginAvailable, isSessionGoalVisibleOnPiKernel } from './usePiKernel';

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
    expect(isSessionGoalVisibleOnPiKernel(true)).toBe(false);
  });

  test('keeps Session Goal visible on OpenCode', () => {
    expect(isSessionGoalVisibleOnPiKernel(false)).toBe(true);
  });
});

describe('isMcpFeaturePluginAvailable', () => {
  test('keeps MCP available on OpenCode regardless of the Pi slot', () => {
    expect(isMcpFeaturePluginAvailable({ isPiKernel: false })).toBe(true);
    expect(isMcpFeaturePluginAvailable({ isPiKernel: false, isMcpFeaturePluginActive: false })).toBe(true);
  });

  test('requires the installed and enabled adapter slot on Pi', () => {
    expect(isMcpFeaturePluginAvailable({ isPiKernel: true })).toBe(false);
    expect(isMcpFeaturePluginAvailable({ isPiKernel: true, isMcpFeaturePluginActive: false })).toBe(false);
    expect(isMcpFeaturePluginAvailable({ isPiKernel: true, isMcpFeaturePluginActive: true })).toBe(true);
  });
});
