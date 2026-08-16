import { describe, expect, test } from 'bun:test';

import { emptyFeaturePluginsPayload } from '@/components/sections/feature-plugins/featurePlugins';
import { isFeaturePluginSlotActive, parseFeaturePluginSlotActive } from './slotStatus';

describe('isFeaturePluginSlotActive', () => {
  test('requires installed and enabled', () => {
    const payload = emptyFeaturePluginsPayload();
    expect(isFeaturePluginSlotActive(payload, 'subagents')).toBe(false);
    payload.slots.subagents.installed = true;
    expect(isFeaturePluginSlotActive(payload, 'subagents')).toBe(false);
    payload.slots.subagents.enabled = true;
    expect(isFeaturePluginSlotActive(payload, 'subagents')).toBe(true);
  });

  test('does not treat a parse failure as an empty success', () => {
    expect(parseFeaturePluginSlotActive(null, 'subagents')).toBe(false);
    expect(parseFeaturePluginSlotActive({ slots: {} }, 'subagents')).toBe(false);
  });
});
