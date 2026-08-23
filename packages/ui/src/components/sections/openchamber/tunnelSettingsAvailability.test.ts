import { describe, expect, test } from 'bun:test';
import {
  formatMissingTunnelProviderCliReason,
  isRequiredTunnelProviderCliMissing,
  tunnelModeRequiresProviderCli,
} from './tunnelSettingsAvailability';

describe('tunnelModeRequiresProviderCli', () => {
  test('quick, managed remote, and managed local all need the provider CLI', () => {
    expect(tunnelModeRequiresProviderCli('quick')).toBe(true);
    expect(tunnelModeRequiresProviderCli('managed-remote')).toBe(true);
    expect(tunnelModeRequiresProviderCli('managed-local')).toBe(true);
  });
});

describe('isRequiredTunnelProviderCliMissing', () => {
  test('keeps the missing-CLI warning for every current tunnel type', () => {
    for (const mode of ['quick', 'managed-remote', 'managed-local'] as const) {
      expect(isRequiredTunnelProviderCliMissing({
        dependencyAvailable: false,
        mode,
      })).toBe(true);
    }
  });

  test('hides the warning when the CLI is present or still unknown', () => {
    expect(isRequiredTunnelProviderCliMissing({
      dependencyAvailable: true,
      mode: 'managed-local',
    })).toBe(false);
    expect(isRequiredTunnelProviderCliMissing({
      dependencyAvailable: null,
      mode: 'quick',
    })).toBe(false);
  });
});

describe('formatMissingTunnelProviderCliReason', () => {
  test('reuses the visible not-found warning as the start-button reason', () => {
    expect(formatMissingTunnelProviderCliReason({
      notFound: 'cloudflared was not found.',
      installHint: 'Install it to enable remote tunnel access:',
    })).toBe('cloudflared was not found. Install it to enable remote tunnel access:');
  });
});
