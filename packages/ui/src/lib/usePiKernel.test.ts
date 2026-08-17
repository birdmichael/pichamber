import { describe, expect, test } from 'bun:test';
import {
  canOfferOpenCodeSessionStub,
  isMcpFeaturePluginAvailable,
  isSessionGoalVisibleOnPiKernel,
  resolvePinnedPiAgentName,
  shouldShowOpenCodeAgentPicker,
  SYNTHETIC_PI_AGENT_NAME,
} from './usePiKernel';

describe('canOfferOpenCodeSessionStub', () => {
  test('hides share, revert, and shell on the Pi kernel', () => {
    expect(canOfferOpenCodeSessionStub(true)).toBe(false);
  });

  test('keeps share, revert, and shell on OpenCode', () => {
    expect(canOfferOpenCodeSessionStub(false)).toBe(true);
  });
});

describe('shouldShowOpenCodeAgentPicker', () => {
  test('hides leftover OpenCode agent dropdowns on the Pi kernel', () => {
    expect(shouldShowOpenCodeAgentPicker(true)).toBe(false);
    expect(shouldShowOpenCodeAgentPicker(true, [])).toBe(false);
    expect(shouldShowOpenCodeAgentPicker(true, [{ name: SYNTHETIC_PI_AGENT_NAME }])).toBe(false);
  });

  test('shows the leftover picker on Pi only when there is another agent to choose', () => {
    expect(shouldShowOpenCodeAgentPicker(true, [{ name: SYNTHETIC_PI_AGENT_NAME }, { name: 'reviewer' }])).toBe(true);
  });

  test('keeps leftover OpenCode agent dropdowns on OpenCode', () => {
    expect(shouldShowOpenCodeAgentPicker(false)).toBe(true);
    expect(shouldShowOpenCodeAgentPicker(false, [{ name: SYNTHETIC_PI_AGENT_NAME }])).toBe(true);
    expect(shouldShowOpenCodeAgentPicker(false, [{ name: 'build' }, { name: 'plan' }])).toBe(true);
  });
});

describe('resolvePinnedPiAgentName', () => {
  test('pins leftover OpenCode agent values to pi on the Pi kernel', () => {
    expect(resolvePinnedPiAgentName(true, 'plan')).toBe(SYNTHETIC_PI_AGENT_NAME);
    expect(resolvePinnedPiAgentName(true, '')).toBe(SYNTHETIC_PI_AGENT_NAME);
    expect(resolvePinnedPiAgentName(true, undefined)).toBe(SYNTHETIC_PI_AGENT_NAME);
  });

  test('keeps the caller agent on OpenCode', () => {
    expect(resolvePinnedPiAgentName(false, 'build')).toBe('build');
    expect(resolvePinnedPiAgentName(false, '  plan  ')).toBe('plan');
    expect(resolvePinnedPiAgentName(false, '')).toBe('');
    expect(resolvePinnedPiAgentName(false, undefined)).toBe('');
  });
});

describe('isSessionGoalVisibleOnPiKernel', () => {
  test('hides Session Goal on the Pi kernel', () => {
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
