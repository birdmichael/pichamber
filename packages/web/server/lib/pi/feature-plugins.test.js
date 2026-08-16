import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createSettingsJsonPackageManager,
  DEFAULT_FEATURE_PLUGIN_SOURCES,
  featurePluginSourceIdentity,
  featurePluginSourcesMatch,
  isFeaturePluginSourceInstalled,
  listConfiguredPiPackageSources,
  listFeaturePluginSlashCommands,
  mergeFeaturePluginPatch,
  normalizeFeaturePlugins,
  readFeaturePlugins,
  toFeaturePluginsPayload,
  writeFeaturePlugins,
} from './feature-plugins.js';
import { readPiDefaults, writePiDefaults } from './pi-resources.js';

const tempHomes = [];
afterEach(() => {
  for (const dir of tempHomes.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const makeTemp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-feature-plugins-'));
  tempHomes.push(dir);
  return dir;
};

describe('feature plugin source identity', () => {
  it('treats npm prefix and version as the same package', () => {
    expect(featurePluginSourceIdentity('npm:@narumitw/pi-goal')).toBe('npm:@narumitw/pi-goal');
    expect(featurePluginSourceIdentity('@narumitw/pi-goal')).toBe('npm:@narumitw/pi-goal');
    expect(featurePluginSourceIdentity('npm:@narumitw/pi-goal@0.1.0')).toBe('npm:@narumitw/pi-goal');
    expect(featurePluginSourcesMatch('npm:pi-mcp-adapter', 'pi-mcp-adapter@2.9.0')).toBe(true);
    expect(featurePluginSourcesMatch('npm:@narumitw/pi-goal', 'npm:@narumitw/pi-plan-mode')).toBe(false);
  });

  it('keeps local paths distinct from npm names', () => {
    expect(featurePluginSourceIdentity('/tmp/pi-goal')).toBe('local:/tmp/pi-goal');
    expect(featurePluginSourcesMatch('/tmp/pi-goal', 'npm:@narumitw/pi-goal')).toBe(false);
  });
});

describe('feature plugin defaults and persist', () => {
  it('fills default sources without enabling or writing', () => {
    const home = makeTemp();
    const plugins = readFeaturePlugins(home);
    expect(plugins.goal).toMatchObject({
      source: DEFAULT_FEATURE_PLUGIN_SOURCES.goal,
      command: 'goal',
      enabled: false,
    });
    expect(plugins.plan.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.plan);
    expect(plugins.mcp.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.mcp);
    expect(plugins.subagents.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.subagents);
    expect(fs.existsSync(path.join(home, '.pi', 'agent', 'pichamber.json'))).toBe(false);
  });

  it('persists source, command, and enable without installing', () => {
    const home = makeTemp();
    const saved = writeFeaturePlugins(home, {
      goal: { source: 'npm:@narumitw/pi-goal', command: 'goal', enabled: true },
      plan: { enabled: true },
    });
    expect(saved.goal.enabled).toBe(true);
    expect(saved.plan.enabled).toBe(true);
    expect(saved.mcp.enabled).toBe(false);
    const chamber = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'pichamber.json'), 'utf8'));
    expect(chamber.featurePlugins.goal).toMatchObject({
      source: 'npm:@narumitw/pi-goal',
      command: 'goal',
      enabled: true,
    });
    expect(chamber.featurePlugins.plan.enabled).toBe(true);
    expect(fs.existsSync(path.join(home, '.pi', 'agent', 'settings.json'))).toBe(false);
  });

  it('keeps featurePlugins when writing other pichamber defaults', () => {
    const home = makeTemp();
    writeFeaturePlugins(home, { mcp: { enabled: true } });
    writePiDefaults(home, { model: 'example-provider/example-model', thinking: 'high' });
    expect(readFeaturePlugins(home).mcp.enabled).toBe(true);
    expect(readPiDefaults(home).model).toBe('example-provider/example-model');
    const chamber = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'pichamber.json'), 'utf8'));
    expect(chamber.featurePlugins.mcp.enabled).toBe(true);
    expect(chamber.model).toBe('example-provider/example-model');
  });

  it('rejects an empty source and an invalid goal command', () => {
    expect(() => mergeFeaturePluginPatch({}, { goal: { source: '   ' } })).toThrow(/source is required/);
    expect(() => mergeFeaturePluginPatch({}, { goal: { command: '/plan start' } })).toThrow(/command is invalid/);
  });
});

describe('feature plugin slash commands', () => {
  it('lists /plan and /run for the slash menu when those slots are installed and enabled', () => {
    expect(listFeaturePluginSlashCommands({
      slots: { plan: { installed: true, enabled: true } },
    })).toEqual([{ name: 'plan', description: 'Plan mode', source: 'extension' }]);
    expect(listFeaturePluginSlashCommands({
      slots: { plan: { installed: true, enabled: false } },
    })).toEqual([]);
    expect(listFeaturePluginSlashCommands({
      slots: { plan: { installed: false, enabled: true } },
    })).toEqual([]);
    expect(listFeaturePluginSlashCommands({
      slots: { subagents: { installed: true, enabled: true } },
    })).toEqual([{
      name: 'run',
      description: 'Run one subagent through workflowScript',
      source: 'extension',
    }]);
    expect(listFeaturePluginSlashCommands({
      slots: { subagents: { installed: true, enabled: false } },
    })).toEqual([]);
  });
});

describe('settings.json package manager', () => {
  it('installs and removes only the matching source', async () => {
    const home = makeTemp();
    const manager = createSettingsJsonPackageManager({ home });
    await manager.installAndPersist('npm:@narumitw/pi-goal');
    await manager.installAndPersist('npm:pi-mcp-adapter');
    expect(listConfiguredPiPackageSources(home)).toEqual([
      'npm:@narumitw/pi-goal',
      'npm:pi-mcp-adapter',
    ]);
    expect(isFeaturePluginSourceInstalled('npm:@narumitw/pi-goal', listConfiguredPiPackageSources(home))).toBe(true);
    await manager.removeAndPersist('@narumitw/pi-goal');
    expect(listConfiguredPiPackageSources(home)).toEqual(['npm:pi-mcp-adapter']);
  });

  it('does not treat listing as an install', () => {
    const home = makeTemp();
    const payload = toFeaturePluginsPayload({
      plugins: normalizeFeaturePlugins({}),
      configuredSources: listConfiguredPiPackageSources(home),
    });
    expect(payload.slots.goal.installed).toBe(false);
    expect(payload.slots.plan.installed).toBe(false);
    expect(payload.slots.mcp.installed).toBe(false);
    expect(payload.slots.subagents.installed).toBe(false);
    expect(fs.existsSync(path.join(home, '.pi', 'agent', 'settings.json'))).toBe(false);
  });
});
