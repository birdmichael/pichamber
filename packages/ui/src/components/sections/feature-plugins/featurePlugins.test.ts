import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_FEATURE_PLUGIN_SOURCES,
  FEATURE_PLUGIN_SLOT_COPY,
  FEATURE_PLUGIN_SLOTS,
  emptyFeaturePluginsPayload,
  featurePluginPackageLabel,
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
    expect(payload.slots.plan.command).toEqual(undefined);
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

  test('shows the default package name without the npm protocol prefix', () => {
    expect(presetSourceLabel('npm:@narumitw/pi-goal')).toBe('@narumitw/pi-goal');
    expect(featurePluginPackageLabel('goal')).toBe('@narumitw/pi-goal');
    expect(featurePluginPackageLabel('plan')).toBe('@narumitw/pi-plan-mode');
    expect(featurePluginPackageLabel('mcp')).toBe('pi-mcp-adapter');
    expect(featurePluginPackageLabel('subagents')).toBe('pi-subagents');
  });

  test('keeps Settings search IDs on the four slot cards', () => {
    expect(FEATURE_PLUGIN_SLOTS.map((slot) => FEATURE_PLUGIN_SLOT_COPY[slot].settingsItem)).toEqual([
      'feature-plugins.goal',
      'feature-plugins.plan',
      'feature-plugins.mcp',
      'feature-plugins.subagents',
    ]);
  });

  test('Feature Plugins page has no text inputs and anchors search on each card', () => {
    const page = readFileSync(join(import.meta.dir, 'FeaturePluginsPage.tsx'), 'utf8');
    expect(page).not.toMatch(/<Input\b/);
    expect(page).not.toContain('SettingsChipGroup');
    expect(page).not.toContain('settings.featurePlugins.field.source');
    expect(page).not.toContain('settings.featurePlugins.field.command');
    expect(page).toContain('@xl:grid-cols-2');
    expect(page).not.toMatch(/(?:^|[^@\w])(?:sm|lg):/);
    for (const slot of FEATURE_PLUGIN_SLOTS) {
      expect(page).toContain(`data-settings-item={copy.settingsItem}`);
      expect(FEATURE_PLUGIN_SLOT_COPY[slot].settingsItem).toBe(`feature-plugins.${slot}`);
    }
  });
});
