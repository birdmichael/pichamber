import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_FEATURE_PLUGIN_SOURCES,
  emptyFeaturePluginsPayload,
  parseFeaturePluginsPayload,
  presetSourceLabel,
} from './featurePlugins';

describe('feature plugin payload parsing', () => {
  test('keeps default sources when building an empty payload', () => {
    const payload = emptyFeaturePluginsPayload();
    expect(payload.slots.goal.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.goal);
    expect(payload.slots.plan.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.plan);
    expect(payload.slots.mcp.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.mcp);
    expect(payload.slots.subagents.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.subagents);
    expect(payload.slots.goal.installed).toBe(false);
    expect(payload.slots.goal.command).toBe('goal');
    expect(payload.slots.plan.command).toBeUndefined();
  });

  test('rejects a failed or malformed payload instead of treating it as empty', () => {
    expect(parseFeaturePluginsPayload(null)).toBeNull();
    expect(parseFeaturePluginsPayload({ slots: {} })).toBeNull();
    expect(parseFeaturePluginsPayload({ slots: { goal: { source: 'npm:@narumitw/pi-goal' } } })).toBeNull();
  });

  test('accepts a complete four-slot payload', () => {
    const parsed = parseFeaturePluginsPayload({
      slots: {
        goal: {
          source: 'npm:@narumitw/pi-goal',
          command: 'goal',
          enabled: true,
          installed: true,
          presets: [{ id: 'default', source: 'npm:@narumitw/pi-goal' }],
        },
        plan: { source: 'npm:@narumitw/pi-plan-mode', enabled: false, installed: false, presets: [] },
        mcp: { source: 'npm:pi-mcp-adapter', enabled: false, installed: false, presets: [] },
        subagents: { source: 'npm:pi-subagents', enabled: false, installed: false, presets: [] },
      },
    });
    expect(parsed?.slots.goal.installed).toBe(true);
    expect(parsed?.slots.plan.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.plan);
  });

  test('shows the npm spec without the protocol prefix on preset chips', () => {
    expect(presetSourceLabel('npm:@narumitw/pi-goal')).toBe('@narumitw/pi-goal');
  });
});
