import { describe, expect, test } from 'bun:test';

import { emptyFeaturePluginsPayload } from '@/components/sections/feature-plugins/featurePlugins';
import {
  isFeaturePluginSlotActive,
  parseFeaturePluginSlotActive,
  shouldDispatchFeaturePluginSlash,
} from './slotStatus';

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

describe('shouldDispatchFeaturePluginSlash', () => {
  test('routes /plan while Feature Plugins have not loaded', () => {
    expect(shouldDispatchFeaturePluginSlash('plan', null, 'idle')).toBe(true);
    expect(shouldDispatchFeaturePluginSlash('run', null, 'loading')).toBe(true);
    expect(shouldDispatchFeaturePluginSlash('goal', null, 'failed')).toBe(true);
  });

  test('honours installed+enabled once the payload is ready', () => {
    const payload = emptyFeaturePluginsPayload();
    expect(shouldDispatchFeaturePluginSlash('plan', payload, 'ready')).toBe(false);
    payload.slots.plan.installed = true;
    payload.slots.plan.enabled = true;
    expect(shouldDispatchFeaturePluginSlash('plan', payload, 'ready')).toBe(true);
  });

  test('does not treat /btw as a session.command slash', () => {
    expect(shouldDispatchFeaturePluginSlash('btw', null, 'idle')).toBe(false);
  });

  test('trims and lowercases the command name so a pasted /plan still routes', () => {
    const payload = emptyFeaturePluginsPayload();
    payload.slots.plan.installed = true;
    payload.slots.plan.enabled = true;
    expect(shouldDispatchFeaturePluginSlash('Plan', null, 'idle')).toBe(true);
    expect(shouldDispatchFeaturePluginSlash('plan\n', null, 'idle')).toBe(true);
    expect(shouldDispatchFeaturePluginSlash(' PLAN ', payload, 'ready')).toBe(true);
  });
});
