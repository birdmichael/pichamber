import { describe, expect, test } from 'bun:test';
import { isMcpFeaturePluginActiveFromState } from './useFeaturePluginsStore';
import { emptyFeaturePluginsPayload } from '@/components/sections/feature-plugins/featurePlugins';

describe('isMcpFeaturePluginActiveFromState', () => {
  test('does not treat a failed or idle load as an active MCP slot', () => {
    expect(isMcpFeaturePluginActiveFromState({ status: 'idle' })).toBe(false);
    expect(isMcpFeaturePluginActiveFromState({ status: 'loading' })).toBe(false);
    expect(isMcpFeaturePluginActiveFromState({ status: 'error' })).toBe(false);
  });

  test('requires installed and enabled together', () => {
    const payload = emptyFeaturePluginsPayload();
    expect(isMcpFeaturePluginActiveFromState({ status: 'ready', payload })).toBe(false);
    payload.slots.mcp.installed = true;
    expect(isMcpFeaturePluginActiveFromState({ status: 'ready', payload })).toBe(false);
    payload.slots.mcp.enabled = true;
    expect(isMcpFeaturePluginActiveFromState({ status: 'ready', payload })).toBe(true);
  });
});
