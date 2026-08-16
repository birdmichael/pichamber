import { describe, expect, test } from 'bun:test';
import { isMcpSettingsAvailable } from './metadata';

describe('isMcpSettingsAvailable', () => {
  test('keeps the OpenCode MCP page available', () => {
    expect(isMcpSettingsAvailable({ isPiKernel: false })).toBe(true);
    expect(isMcpSettingsAvailable({ isPiKernel: false, isMcpFeaturePluginActive: false })).toBe(true);
  });

  test('hides the Pi MCP page unless the adapter slot is installed and enabled', () => {
    expect(isMcpSettingsAvailable({ isPiKernel: true })).toBe(false);
    expect(isMcpSettingsAvailable({ isPiKernel: true, isMcpFeaturePluginActive: false })).toBe(false);
    expect(isMcpSettingsAvailable({ isPiKernel: true, isMcpFeaturePluginActive: true })).toBe(true);
  });
});
