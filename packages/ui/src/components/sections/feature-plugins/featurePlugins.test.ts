import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FEATURE_PLUGIN_SOURCES,
  FEATURE_PLUGIN_SLOT_COPY,
  FEATURE_PLUGIN_SLOTS,
  emptyFeaturePluginsPayload,
  featurePluginPackageLabel,
  parseFeaturePluginsPayload,
  presetSourceLabel,
} from './featurePlugins';

const pageSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'FeaturePluginsPage.tsx'),
  'utf8',
);

describe('feature plugin payload parsing', () => {
  test('keeps default sources when building an empty payload', () => {
    const payload = emptyFeaturePluginsPayload();
    expect(payload.slots.goal.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.goal);
    expect(payload.slots.plan.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.plan);
    expect(payload.slots.mcp.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.mcp);
    expect(payload.slots.subagents.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.subagents);
    expect(payload.slots.btw.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.btw);
    expect(payload.slots.goal.installed).toBe(false);
    expect(payload.slots.goal.command).toBe('goal');
    expect(payload.slots.btw.command).toBe('btw');
    expect(payload.slots.plan.command).toEqual(undefined);
  });

  test('rejects a failed or malformed payload instead of treating it as empty', () => {
    expect(parseFeaturePluginsPayload(null)).toBeNull();
    expect(parseFeaturePluginsPayload({ slots: {} })).toBeNull();
    expect(parseFeaturePluginsPayload({ slots: { goal: { source: 'npm:@narumitw/pi-goal' } } })).toBeNull();
  });

  test('accepts a complete five-slot payload', () => {
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
        btw: {
          source: 'npm:@narumitw/pi-btw',
          command: 'btw',
          enabled: true,
          installed: true,
          presets: [{ id: 'default', source: 'npm:@narumitw/pi-btw' }],
        },
      },
    });
    expect(parsed?.slots.goal.installed).toBe(true);
    expect(parsed?.slots.btw.installed).toBe(true);
    expect(parsed?.slots.btw.command).toBe('btw');
    expect(parsed?.slots.plan.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.plan);
  });

  test('rejects a four-slot payload that omits btw', () => {
    expect(parseFeaturePluginsPayload({
      slots: {
        goal: { source: 'npm:@narumitw/pi-goal', enabled: false, installed: false, presets: [] },
        plan: { source: 'npm:@narumitw/pi-plan-mode', enabled: false, installed: false, presets: [] },
        mcp: { source: 'npm:pi-mcp-adapter', enabled: false, installed: false, presets: [] },
        subagents: { source: 'npm:pi-subagents', enabled: false, installed: false, presets: [] },
      },
    })).toBeNull();
  });

  test('shows the default package name without the npm protocol prefix', () => {
    expect(presetSourceLabel('npm:@narumitw/pi-goal')).toBe('@narumitw/pi-goal');
    expect(featurePluginPackageLabel('goal')).toBe('@narumitw/pi-goal');
    expect(featurePluginPackageLabel('plan')).toBe('@narumitw/pi-plan-mode');
    expect(featurePluginPackageLabel('mcp')).toBe('pi-mcp-adapter');
    expect(featurePluginPackageLabel('subagents')).toBe('pi-subagents');
    expect(featurePluginPackageLabel('btw')).toBe('@narumitw/pi-btw');
  });

  test('keeps Settings search IDs on the five slot cards', () => {
    expect(FEATURE_PLUGIN_SLOTS.map((slot) => FEATURE_PLUGIN_SLOT_COPY[slot].settingsItem)).toEqual([
      'feature-plugins.goal',
      'feature-plugins.plan',
      'feature-plugins.mcp',
      'feature-plugins.subagents',
      'feature-plugins.btw',
    ]);
  });

  test('Feature Plugins page has no text inputs and anchors search on each card', () => {
    expect(pageSource.includes('<Input')).toBe(false);
    expect(pageSource.includes('SettingsChipGroup')).toBe(false);
    expect(pageSource.includes('settings.featurePlugins.field.source')).toBe(false);
    expect(pageSource.includes('settings.featurePlugins.field.command')).toBe(false);
    expect(pageSource.includes('@xl:grid-cols-2')).toBe(true);
    expect(/(?:^|[^@\w])(?:sm|lg):/.test(pageSource)).toBe(false);
    expect(pageSource.includes('data-settings-item={copy.settingsItem}')).toBe(true);
    expect(pageSource.includes('SettingsCheckboxRow')).toBe(false);
    expect(pageSource.includes('settings.featurePlugins.enabled')).toBe(false);
    expect(pageSource.includes('onEnabledChange')).toBe(false);
    expect(pageSource.includes('settings.featurePlugins.actions.reinstall')).toBe(false);
    expect(pageSource.includes('{saved.installed ? null : (')).toBe(true);
    expect(pageSource.includes('if (payload.slots[slot].installed) return;')).toBe(true);
    for (const slot of FEATURE_PLUGIN_SLOTS) {
      expect(FEATURE_PLUGIN_SLOT_COPY[slot].settingsItem).toBe(`feature-plugins.${slot}`);
    }
  });
});
