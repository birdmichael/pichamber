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
  listPiPackages,
  mergeFeaturePluginPatch,
  normalizeFeaturePlugins,
  readFeaturePlugins,
  resolveFeaturePluginEnabled,
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
    expect(featurePluginSourcesMatch('npm:@narumitw/pi-btw', '@narumitw/pi-btw')).toBe(true);
  });

  it('keeps local paths distinct from npm names', () => {
    expect(featurePluginSourceIdentity('/tmp/pi-goal')).toBe('local:/tmp/pi-goal');
    expect(featurePluginSourcesMatch('/tmp/pi-goal', 'npm:@narumitw/pi-goal')).toBe(false);
  });
});

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const writeMainstreamSettings = (home, extra = {}) => {
  writeJson(path.join(home, '.pi', 'agent', 'settings.json'), {
    packages: [
      'npm:@narumitw/pi-goal',
      'npm:pi-mcp-adapter',
      'npm:pi-subagents',
    ],
    defaultProvider: 'bmlab',
    defaultModel: 'grok-4.6',
    defaultThinkingLevel: 'high',
    ...extra,
  });
};

describe('feature plugin defaults and persist', () => {
  it('fills default sources without enabling or writing', () => {
    const home = makeTemp();
    const plugins = readFeaturePlugins(home);
    expect(plugins.goal).toMatchObject({
      source: DEFAULT_FEATURE_PLUGIN_SOURCES.goal,
      command: 'goal',
    });
    expect(plugins.goal.enabled).toBeUndefined();
    expect(plugins.plan.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.plan);
    expect(plugins.mcp.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.mcp);
    expect(plugins.subagents.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.subagents);
    expect(plugins.btw).toMatchObject({
      source: DEFAULT_FEATURE_PLUGIN_SOURCES.btw,
      command: 'btw',
    });
    expect(plugins.todo.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.todo);
    expect(plugins.todo.source).toBe('npm:@juicesharp/rpiv-todo');
    expect(plugins.todo.source).not.toBe('npm:rpiv-todo');
    expect(plugins.todo.command).toBeUndefined();
    expect(plugins.xai.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.xai);
    expect(plugins.xai.source).toBe('npm:pi-xai-oauth');
    expect(plugins.xai.command).toBeUndefined();
    expect(fs.existsSync(path.join(home, '.pi', 'agent', 'pichamber.json'))).toBe(false);
  });

  it('persists source and command without installing or emitting enabled', () => {
    const home = makeTemp();
    const saved = writeFeaturePlugins(home, {
      goal: { source: 'npm:@narumitw/pi-goal', command: 'goal', enabled: true },
      plan: { enabled: true },
    });
    expect(saved.goal.enabled).toBeUndefined();
    expect(saved.plan.enabled).toBeUndefined();
    expect(saved.mcp.enabled).toBeUndefined();
    const chamber = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'pichamber.json'), 'utf8'));
    expect(chamber.featurePlugins.goal).toEqual({
      source: 'npm:@narumitw/pi-goal',
      command: 'goal',
    });
    expect(chamber.featurePlugins.plan).toEqual({
      source: DEFAULT_FEATURE_PLUGIN_SOURCES.plan,
    });
    expect(chamber.featurePlugins.mcp.enabled).toBeUndefined();
    expect(chamber.featurePlugins.subagents.enabled).toBeUndefined();
    expect(fs.existsSync(path.join(home, '.pi', 'agent', 'settings.json'))).toBe(false);
  });

  it('does not create pichamber.json when the patch is only enabled flags', () => {
    const home = makeTemp();
    writeFeaturePlugins(home, { goal: { enabled: true }, plan: { enabled: false } });
    expect(fs.existsSync(path.join(home, '.pi', 'agent', 'pichamber.json'))).toBe(false);
  });

  it('keeps featurePlugins when writing other pichamber defaults', () => {
    const home = makeTemp();
    writeFeaturePlugins(home, { mcp: { source: DEFAULT_FEATURE_PLUGIN_SOURCES.mcp } });
    writePiDefaults(home, { model: 'example-provider/example-model', thinking: 'high' });
    expect(readFeaturePlugins(home).mcp.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.mcp);
    expect(readFeaturePlugins(home).mcp.enabled).toBeUndefined();
    expect(readPiDefaults(home).model).toBe('example-provider/example-model');
    const chamber = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'pichamber.json'), 'utf8'));
    expect(chamber.featurePlugins.mcp).toEqual({ source: DEFAULT_FEATURE_PLUGIN_SOURCES.mcp });
    expect(chamber.featurePlugins.mcp.enabled).toBeUndefined();
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
      description: 'Run a subagent as a one-shot workflow',
      source: 'extension',
    }]);
    expect(listFeaturePluginSlashCommands({
      slots: { subagents: { installed: true, enabled: false } },
    })).toEqual([]);
    expect(listFeaturePluginSlashCommands({
      slots: { btw: { installed: true, enabled: true } },
    })).toEqual([{
      name: 'btw',
      description: 'Ask a side question in a temporary forked session',
      source: 'extension',
    }]);
    expect(listFeaturePluginSlashCommands({
      slots: { btw: { installed: true, enabled: false } },
    })).toEqual([]);
    expect(listFeaturePluginSlashCommands({
      slots: { btw: { installed: true, enabled: true, command: 'btw' } },
    })).toEqual([{
      name: 'btw',
      description: 'Ask a side question in a temporary forked session',
      source: 'extension',
    }]);
    expect(listFeaturePluginSlashCommands({
      slots: { xai: { installed: true, enabled: true } },
    })).toEqual([{
      name: 'xai-usage',
      description: 'Show Grok subscription usage',
      source: 'extension',
    }]);
    expect(listFeaturePluginSlashCommands({
      slots: { xai: { installed: true, enabled: false } },
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
    await expect(manager.update('npm:pi-mcp-adapter')).resolves.toEqual({
      updated: ['npm:pi-mcp-adapter'],
    });
    await expect(manager.update()).resolves.toEqual({
      updated: ['npm:pi-mcp-adapter'],
    });
    await expect(manager.update('npm:missing-package')).rejects.toMatchObject({ status: 404 });
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
    expect(payload.slots.btw.installed).toBe(false);
    expect(payload.slots.todo.installed).toBe(false);
    expect(payload.slots.xai.installed).toBe(false);
    expect(payload.slots.goal.enabled).toBe(false);
    expect(payload.slots.todo.enabled).toBe(false);
    expect(payload.slots.xai.enabled).toBe(false);
    expect(fs.existsSync(path.join(home, '.pi', 'agent', 'settings.json'))).toBe(false);
  });

  it('enables Btw when packages lists @narumitw/pi-btw with or without the npm prefix', () => {
    const withPrefix = toFeaturePluginsPayload({
      plugins: normalizeFeaturePlugins({}),
      configuredSources: ['npm:@narumitw/pi-btw'],
    });
    const withoutPrefix = toFeaturePluginsPayload({
      plugins: normalizeFeaturePlugins({}),
      configuredSources: ['@narumitw/pi-btw'],
    });
    expect(withPrefix.slots.btw).toMatchObject({ installed: true, enabled: true, command: 'btw' });
    expect(withoutPrefix.slots.btw).toMatchObject({ installed: true, enabled: true, command: 'btw' });
    expect(listFeaturePluginSlashCommands(withPrefix).map((item) => item.name)).toEqual(['btw']);
  });
});

describe('existing Pi agent recognition', () => {
  it('enables installed slots when pichamber.json is missing', () => {
    const home = makeTemp();
    writeMainstreamSettings(home);
    const payload = toFeaturePluginsPayload({
      plugins: readFeaturePlugins(home),
      configuredSources: listConfiguredPiPackageSources(home),
    });
    expect(payload.slots.goal).toMatchObject({ installed: true, enabled: true });
    expect(payload.slots.mcp).toMatchObject({ installed: true, enabled: true });
    expect(payload.slots.subagents).toMatchObject({ installed: true, enabled: true });
    expect(payload.slots.plan).toMatchObject({ installed: false, enabled: false });
    expect(payload.slots.btw).toMatchObject({ installed: false, enabled: false });
    expect(payload.slots.todo).toMatchObject({ installed: false, enabled: false });
    expect(payload.slots.xai).toMatchObject({ installed: false, enabled: false });
    expect(listFeaturePluginSlashCommands(payload).map((item) => item.name)).toEqual(['run']);
    expect(fs.existsSync(path.join(home, '.pi', 'agent', 'pichamber.json'))).toBe(false);
  });

  it('enables Grok Usage when packages lists npm:pi-xai-oauth', () => {
    const scoped = toFeaturePluginsPayload({
      plugins: {},
      configuredSources: ['npm:pi-xai-oauth'],
    });
    expect(scoped.slots.xai).toMatchObject({
      source: 'npm:pi-xai-oauth',
      installed: true,
      enabled: true,
    });
    expect(listFeaturePluginSlashCommands(scoped).map((item) => item.name)).toEqual(['xai-usage']);
  });

  it('enables Todo when packages lists @juicesharp/rpiv-todo, not unscoped rpiv-todo', () => {
    const scoped = toFeaturePluginsPayload({
      plugins: normalizeFeaturePlugins({}),
      configuredSources: ['npm:@juicesharp/rpiv-todo'],
    });
    const unscoped = toFeaturePluginsPayload({
      plugins: normalizeFeaturePlugins({}),
      configuredSources: ['npm:rpiv-todo'],
    });
    expect(scoped.slots.todo).toMatchObject({
      source: 'npm:@juicesharp/rpiv-todo',
      installed: true,
      enabled: true,
    });
    expect(unscoped.slots.todo).toMatchObject({
      source: 'npm:@juicesharp/rpiv-todo',
      installed: false,
      enabled: false,
    });
  });

  it('lets installed packages win over a leftover chamber enabled false', () => {
    const home = makeTemp();
    writeMainstreamSettings(home);
    writeJson(path.join(home, '.pi', 'agent', 'pichamber.json'), {
      featurePlugins: {
        subagents: { source: DEFAULT_FEATURE_PLUGIN_SOURCES.subagents, enabled: false },
        goal: { source: DEFAULT_FEATURE_PLUGIN_SOURCES.goal, command: 'goal', enabled: false },
      },
    });
    const payload = toFeaturePluginsPayload({
      plugins: readFeaturePlugins(home),
      configuredSources: listConfiguredPiPackageSources(home),
    });
    expect(payload.slots.subagents).toMatchObject({ installed: true, enabled: true });
    expect(payload.slots.goal).toMatchObject({ installed: true, enabled: true });
    expect(payload.slots.plan).toMatchObject({ installed: false, enabled: false });
    expect(payload.slots.btw).toMatchObject({ installed: false, enabled: false });
    expect(payload.slots.todo).toMatchObject({ installed: false, enabled: false });
    expect(payload.slots.xai).toMatchObject({ installed: false, enabled: false });
    expect(listFeaturePluginSlashCommands(payload).map((item) => item.name)).toEqual(['run']);
    expect(readFeaturePlugins(home).subagents.enabled).toBeUndefined();
    expect(resolveFeaturePluginEnabled(true)).toBe(true);
    expect(resolveFeaturePluginEnabled(false)).toBe(false);
  });

  it('does not write enabled flags onto siblings when persisting one slot', () => {
    const home = makeTemp();
    writeJson(path.join(home, '.pi', 'agent', 'pichamber.json'), {
      featurePlugins: {
        goal: { source: DEFAULT_FEATURE_PLUGIN_SOURCES.goal, command: 'goal', enabled: false },
        plan: { source: DEFAULT_FEATURE_PLUGIN_SOURCES.plan, enabled: false },
        mcp: { source: DEFAULT_FEATURE_PLUGIN_SOURCES.mcp, enabled: true },
        subagents: { source: DEFAULT_FEATURE_PLUGIN_SOURCES.subagents, enabled: false },
      },
    });
    writeFeaturePlugins(home, { goal: { command: 'ship' } });
    const chamber = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'pichamber.json'), 'utf8'));
    expect(chamber.featurePlugins.goal).toEqual({
      source: DEFAULT_FEATURE_PLUGIN_SOURCES.goal,
      command: 'ship',
    });
    expect(chamber.featurePlugins.plan).toEqual({ source: DEFAULT_FEATURE_PLUGIN_SOURCES.plan });
    expect(chamber.featurePlugins.mcp).toEqual({ source: DEFAULT_FEATURE_PLUGIN_SOURCES.mcp });
    expect(chamber.featurePlugins.subagents).toEqual({
      source: DEFAULT_FEATURE_PLUGIN_SOURCES.subagents,
    });
    expect(chamber.featurePlugins.btw).toEqual({
      source: DEFAULT_FEATURE_PLUGIN_SOURCES.btw,
      command: 'btw',
    });
    expect(chamber.featurePlugins.todo).toEqual({
      source: DEFAULT_FEATURE_PLUGIN_SOURCES.todo,
    });
    expect(chamber.featurePlugins.xai).toEqual({
      source: DEFAULT_FEATURE_PLUGIN_SOURCES.xai,
    });
    expect(JSON.stringify(chamber)).not.toContain('"enabled"');
  });

  it('lists settings.json package names and skips a bad entry', () => {
    const home = makeTemp();
    const project = makeTemp();
    writeJson(path.join(home, '.pi', 'agent', 'settings.json'), {
      packages: [
        'npm:@narumitw/pi-goal',
        { broken: true },
        'npm:pi-mcp-adapter',
      ],
    });
    writeJson(path.join(home, '.pi', 'agent', 'npm', 'package.json'), { name: 'pi-extensions' });
    writeJson(path.join(project, '.pi', 'settings.json'), {
      packages: ['npm:pi-subagents', null, { source: 'npm:project-only' }],
    });
    const packages = listPiPackages({ home, directory: project });
    expect(packages.map((item) => item.name)).toEqual([
      '@narumitw/pi-goal',
      'pi-mcp-adapter',
      'pi-subagents',
      'project-only',
    ]);
    expect(packages.some((item) => item.name === 'pi-extensions')).toBe(false);
    expect(packages.find((item) => item.name === 'pi-subagents')).toMatchObject({
      source: 'npm',
      scope: 'project',
    });
  });
});
