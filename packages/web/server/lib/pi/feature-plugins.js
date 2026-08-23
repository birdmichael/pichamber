import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  resolvePiAgentDir,
  resolvePiDefaultsPath,
  resolvePiSettingsPath,
} from './pi-resources.js';

const FEATURE_PLUGIN_SLOTS = ['goal', 'plan', 'mcp', 'subagents'];

export const DEFAULT_FEATURE_PLUGIN_SOURCES = {
  goal: 'npm:@narumitw/pi-goal',
  plan: 'npm:@narumitw/pi-plan-mode',
  mcp: 'npm:pi-mcp-adapter',
  subagents: 'npm:pi-subagents',
};

const DEFAULT_GOAL_COMMAND = 'goal';

const GOAL_COMMAND_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const NPM_SPEC_PATTERN = /^(?:npm:)?(@[^/]+\/[^@\s]+|[^@/\s:]+)(?:@.+)?$/;
const MAX_SOURCE_LENGTH = 512;

const isFile = (value) => {
  try {
    return fs.statSync(value).isFile();
  } catch {
    return false;
  }
};

const readText = (filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
};

const readJsonObject = (filePath) => {
  try {
    const parsed = JSON.parse(readText(filePath));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const isFeaturePluginSlot = (value) => FEATURE_PLUGIN_SLOTS.includes(value);

const normalizeFeaturePluginSource = (value, fallback = '') => {
  const source = typeof value === 'string' ? value.trim() : '';
  if (!source) return typeof fallback === 'string' ? fallback : '';
  return source.length > MAX_SOURCE_LENGTH ? source.slice(0, MAX_SOURCE_LENGTH) : source;
};

const normalizeGoalCommand = (value, fallback = DEFAULT_GOAL_COMMAND) => {
  const raw = typeof value === 'string' ? value.trim().replace(/^\//, '') : '';
  if (GOAL_COMMAND_PATTERN.test(raw)) return raw;
  return GOAL_COMMAND_PATTERN.test(fallback) ? fallback : DEFAULT_GOAL_COMMAND;
};

export const featurePluginSourceIdentity = (source) => {
  const value = typeof source === 'string' ? source.trim() : '';
  if (!value) return '';
  if (
    value.startsWith('git:')
    || value.startsWith('git@')
    || /^https?:\/\//.test(value)
  ) {
    return value.replace(/\.git$/, '').split('#')[0];
  }
  const looksLocal = value.startsWith('/')
    || value.startsWith('.')
    || value.includes('\\')
    || /^[A-Za-z]:[\\/]/.test(value);
  if (!looksLocal) {
    const npm = value.match(NPM_SPEC_PATTERN);
    if (npm) return `npm:${npm[1]}`;
  }
  return `local:${value}`;
};

export const featurePluginSourcesMatch = (left, right) => {
  const a = featurePluginSourceIdentity(left);
  const b = featurePluginSourceIdentity(right);
  return Boolean(a) && a === b;
};

const configuredPackageSource = (entry) => {
  if (typeof entry === 'string') return entry.trim();
  if (entry && typeof entry === 'object' && typeof entry.source === 'string') {
    return entry.source.trim();
  }
  return '';
};

export const listConfiguredPiPackageSources = (home = os.homedir()) => {
  const settings = readJsonObject(resolvePiSettingsPath(home));
  const packages = Array.isArray(settings.packages) ? settings.packages : [];
  return packages.map(configuredPackageSource).filter(Boolean);
};

export const isFeaturePluginSourceInstalled = (source, configuredSources = []) => (
  configuredSources.some((item) => featurePluginSourcesMatch(source, item))
);

const defaultSlotConfig = (slot) => {
  if (slot === 'goal') {
    return {
      source: DEFAULT_FEATURE_PLUGIN_SOURCES.goal,
      command: DEFAULT_GOAL_COMMAND,
    };
  }
  return {
    source: DEFAULT_FEATURE_PLUGIN_SOURCES[slot],
  };
};

const normalizeSlotConfig = (slot, raw) => {
  const defaults = defaultSlotConfig(slot);
  const entry = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const next = {
    source: normalizeFeaturePluginSource(entry.source, defaults.source),
  };
  if (slot === 'goal') {
    next.command = normalizeGoalCommand(entry.command, defaults.command);
  }
  return next;
};

/** Chrome is on iff the slot source is already in Pi `packages`. Chamber `enabled` is ignored. */
export const resolveFeaturePluginEnabled = (installed) => Boolean(installed);

export const normalizeFeaturePlugins = (raw) => {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const next = {};
  for (const slot of FEATURE_PLUGIN_SLOTS) {
    next[slot] = normalizeSlotConfig(slot, input[slot]);
  }
  return next;
};

const serializeFeaturePlugins = (plugins) => {
  const normalized = normalizeFeaturePlugins(plugins);
  const out = {};
  for (const slot of FEATURE_PLUGIN_SLOTS) {
    const entry = normalized[slot];
    out[slot] = slot === 'goal'
      ? { source: entry.source, command: entry.command }
      : { source: entry.source };
  }
  return out;
};

export const readFeaturePlugins = (home = os.homedir()) => {
  const chamber = isFile(resolvePiDefaultsPath(home))
    ? readJsonObject(resolvePiDefaultsPath(home))
    : {};
  return normalizeFeaturePlugins(chamber.featurePlugins);
};

const writeChamberFile = (home, chamber) => {
  const chamberPath = resolvePiDefaultsPath(home);
  fs.mkdirSync(path.dirname(chamberPath), { recursive: true });
  fs.writeFileSync(chamberPath, `${JSON.stringify(chamber, null, 2)}\n`);
};

const readChamberFile = (home = os.homedir()) => (
  isFile(resolvePiDefaultsPath(home)) ? readJsonObject(resolvePiDefaultsPath(home)) : {}
);

/** Source/command writes persist. Chamber `enabled` is ignored and never written. */
export const featurePluginPatchHasPersistableFields = (patch) => {
  const input = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  for (const slot of FEATURE_PLUGIN_SLOTS) {
    if (!Object.prototype.hasOwnProperty.call(input, slot)) continue;
    const value = input[slot];
    if (value == null) return true;
    if (typeof value !== 'object' || Array.isArray(value)) return true;
    if (Object.prototype.hasOwnProperty.call(value, 'source')) return true;
    if (Object.prototype.hasOwnProperty.call(value, 'command')) return true;
  }
  return false;
};

export const mergeFeaturePluginPatch = (current, patch) => {
  const base = normalizeFeaturePlugins(current);
  const input = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  const next = { ...base };
  for (const slot of FEATURE_PLUGIN_SLOTS) {
    if (!Object.prototype.hasOwnProperty.call(input, slot)) continue;
    const value = input[slot];
    if (value == null) {
      next[slot] = defaultSlotConfig(slot);
      continue;
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      const error = new Error(`Invalid ${slot} plugin config`);
      error.status = 400;
      throw error;
    }
    const merged = { ...base[slot] };
    if (Object.prototype.hasOwnProperty.call(value, 'source')) {
      const source = normalizeFeaturePluginSource(value.source);
      if (!source) {
        const error = new Error(`${slot} source is required`);
        error.status = 400;
        throw error;
      }
      merged.source = source;
    }
    if (slot === 'goal' && Object.prototype.hasOwnProperty.call(value, 'command')) {
      const raw = typeof value.command === 'string' ? value.command.trim().replace(/^\//, '') : '';
      if (!GOAL_COMMAND_PATTERN.test(raw)) {
        const error = new Error('Goal command is invalid');
        error.status = 400;
        throw error;
      }
      merged.command = raw;
    }
    next[slot] = merged;
  }
  return next;
};

export const writeFeaturePlugins = (home = os.homedir(), patch = {}) => {
  const chamber = readChamberFile(home);
  const next = mergeFeaturePluginPatch(chamber.featurePlugins, patch);
  if (!featurePluginPatchHasPersistableFields(patch)) {
    return next;
  }
  writeChamberFile(home, {
    model: typeof chamber.model === 'string' ? chamber.model : '',
    thinking: chamber.thinking,
    compaction: chamber.compaction,
    retry: chamber.retry,
    featurePlugins: serializeFeaturePlugins(next),
  });
  return next;
};

const slotPresets = (slot) => ([
  { id: 'default', source: DEFAULT_FEATURE_PLUGIN_SOURCES[slot] },
]);

/** Slash entries that must appear even before a live session calls getCommands(). */
export const listFeaturePluginSlashCommands = (payload) => {
  const listed = [];
  const plan = payload?.slots?.plan;
  if (plan?.installed && plan.enabled) {
    listed.push({
      name: 'plan',
      description: 'Plan mode',
      source: 'extension',
    });
  }
  const subagents = payload?.slots?.subagents;
  if (subagents?.installed && subagents.enabled) {
    listed.push({
      name: 'run',
      description: 'Run a subagent as a one-shot workflow',
      source: 'extension',
    });
  }
  return listed;
};

export const toFeaturePluginsPayload = ({
  plugins,
  configuredSources = [],
} = {}) => {
  const normalized = normalizeFeaturePlugins(plugins);
  const slots = {};
  for (const slot of FEATURE_PLUGIN_SLOTS) {
    const entry = normalized[slot];
    const installed = isFeaturePluginSourceInstalled(entry.source, configuredSources);
    slots[slot] = {
      ...entry,
      installed,
      enabled: resolveFeaturePluginEnabled(installed),
      presets: slotPresets(slot),
    };
  }
  return { slots };
};

const packageListSourceKind = (identity) => {
  if (
    identity.startsWith('git:')
    || identity.startsWith('git@')
    || /^https?:\/\//.test(identity)
  ) {
    return 'git';
  }
  if (identity.startsWith('local:')) return 'local';
  return 'npm';
};

const packageListName = (identity) => {
  if (identity.startsWith('npm:')) return identity.slice('npm:'.length);
  if (identity.startsWith('local:')) return identity.slice('local:'.length);
  if (identity.startsWith('git:')) return identity.slice('git:'.length);
  return identity;
};

const addConfiguredPackagesFromSettings = ({
  settingsPath,
  scope,
  packages,
  seen,
}) => {
  if (!isFile(settingsPath)) return;
  let entries = [];
  try {
    const settings = readJsonObject(settingsPath);
    entries = Array.isArray(settings.packages) ? settings.packages : [];
  } catch {
    return;
  }
  for (const entry of entries) {
    try {
      const spec = configuredPackageSource(entry);
      if (!spec) continue;
      const identity = featurePluginSourceIdentity(spec);
      if (!identity) continue;
      const source = packageListSourceKind(identity);
      const name = packageListName(identity);
      const key = [scope, source, identity].join(':');
      if (!name || seen.has(key)) continue;
      seen.add(key);
      packages.push({ name, source, scope, path: spec });
    } catch {
      // One unreadable package entry does not drop the rest.
    }
  }
};

/** Settings → Extensions packages: configured settings.json names, not npm wrapper manifests. */
export const listPiPackages = ({ home = os.homedir(), directory } = {}) => {
  const packages = [];
  const seen = new Set();
  addConfiguredPackagesFromSettings({
    settingsPath: resolvePiSettingsPath(home),
    scope: 'user',
    packages,
    seen,
  });
  if (typeof directory === 'string' && directory.trim()) {
    addConfiguredPackagesFromSettings({
      settingsPath: path.join(path.resolve(directory.trim()), '.pi', 'settings.json'),
      scope: 'project',
      packages,
      seen,
    });
  }
  return packages;
};

export const createSettingsJsonPackageManager = ({ home = os.homedir() } = {}) => {
  const settingsPath = resolvePiSettingsPath(home);

  const readPackages = () => {
    const settings = readJsonObject(settingsPath);
    return Array.isArray(settings.packages) ? settings.packages : [];
  };

  const writePackages = (packages) => {
    const settings = readJsonObject(settingsPath);
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, `${JSON.stringify({
      ...settings,
      packages,
    }, null, 2)}\n`);
  };

  return {
    async installAndPersist(source) {
      const spec = typeof source === 'string' ? source.trim() : '';
      if (!spec) {
        const error = new Error('Package source is required');
        error.status = 400;
        throw error;
      }
      const packages = readPackages();
      if (packages.some((entry) => featurePluginSourcesMatch(configuredPackageSource(entry), spec))) {
        return { source: spec, alreadyInstalled: true };
      }
      writePackages([...packages, spec]);
      return { source: spec, alreadyInstalled: false };
    },
    async removeAndPersist(source) {
      const spec = typeof source === 'string' ? source.trim() : '';
      const packages = readPackages();
      const next = packages.filter((entry) => (
        !featurePluginSourcesMatch(configuredPackageSource(entry), spec)
      ));
      const removed = next.length !== packages.length;
      if (removed) writePackages(next);
      return removed;
    },
    listConfiguredPackages() {
      return readPackages().map((entry) => ({
        source: configuredPackageSource(entry),
        scope: 'user',
        filtered: typeof entry === 'object',
      })).filter((item) => item.source);
    },
  };
};

export const createSdkPackageManager = async ({
  cwd,
  home = os.homedir(),
  loadSdk,
} = {}) => {
  const pi = await loadSdk();
  if (!pi?.SettingsManager?.create || !pi.DefaultPackageManager) {
    const error = new Error('Pi PackageManager is unavailable');
    error.status = 503;
    throw error;
  }
  const agentDir = resolvePiAgentDir(home);
  const settingsManager = pi.SettingsManager.create(cwd, agentDir);
  return new pi.DefaultPackageManager({
    cwd,
    agentDir,
    settingsManager,
  });
};
