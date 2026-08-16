import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  isFeaturePluginSourceInstalled,
  listConfiguredPiPackageSources,
  readFeaturePlugins,
} from './feature-plugins.js';
import { resolvePiAgentDir } from './pi-resources.js';

const MCP_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*[a-z0-9]$|^[a-z0-9]$/;
const USER_SCOPE = 'user';
const PROJECT_SCOPE = 'project';

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

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const MCP_STATUS_EVENT = 'pi-mcp-adapter/status/v1';

export const isMcpFeaturePluginActive = (home = os.homedir()) => {
  const plugins = readFeaturePlugins(home);
  const mcp = plugins.mcp;
  if (!mcp?.enabled || !mcp.source) return false;
  return isFeaturePluginSourceInstalled(mcp.source, listConfiguredPiPackageSources(home));
};

export const listAdapterMcpConfigPaths = ({
  home = os.homedir(),
  cwd,
} = {}) => {
  const userConfig = path.join(home, '.config', 'mcp', 'mcp.json');
  const agentsFile = path.join(home, '.agents', 'mcp.json');
  const agentsDirFile = path.join(home, '.agents', 'mcp', 'mcp.json');
  const piAgentFile = path.join(resolvePiAgentDir(home), 'mcp.json');
  const projectCwd = typeof cwd === 'string' && cwd.trim() ? path.resolve(cwd.trim()) : '';
  const paths = [
    { path: userConfig, scope: USER_SCOPE, kind: 'user-shared' },
    { path: agentsFile, scope: USER_SCOPE, kind: 'user-agents' },
    { path: agentsDirFile, scope: USER_SCOPE, kind: 'user-agents-dir' },
    { path: piAgentFile, scope: USER_SCOPE, kind: 'pi-user' },
  ];
  if (projectCwd) {
    paths.push(
      { path: path.join(projectCwd, '.mcp.json'), scope: PROJECT_SCOPE, kind: 'project-shared' },
      { path: path.join(projectCwd, '.pi', 'mcp.json'), scope: PROJECT_SCOPE, kind: 'pi-project' },
    );
  }
  return paths;
};

const readMcpServersFromFile = (filePath) => {
  if (!isFile(filePath)) return {};
  const config = readJsonObject(filePath);
  const servers = isRecord(config.mcpServers) ? config.mcpServers : {};
  const next = {};
  for (const [name, entry] of Object.entries(servers)) {
    if (!isRecord(entry)) continue;
    next[name] = entry;
  }
  return next;
};

const isDefinitionEntry = (entry) => {
  if (!isRecord(entry)) return false;
  return Boolean(
    (typeof entry.command === 'string' && entry.command.trim())
    || (typeof entry.url === 'string' && entry.url.trim())
    || (typeof entry.socket === 'string' && entry.socket.trim())
    || Array.isArray(entry.command),
  );
};

export const validateMcpName = (name) => {
  if (!name || typeof name !== 'string') {
    const error = new Error('MCP server name is required');
    error.status = 400;
    throw error;
  }
  if (!MCP_NAME_PATTERN.test(name)) {
    const error = new Error('MCP server name must be lowercase alphanumeric with hyphens/underscores');
    error.status = 400;
    throw error;
  }
};

const adapterEntryToUi = (name, entry, scope) => {
  const command = typeof entry.command === 'string' && entry.command.trim()
    ? [entry.command, ...(Array.isArray(entry.args) ? entry.args.map(String) : [])]
    : (Array.isArray(entry.command) ? entry.command.map(String) : []);
  const url = typeof entry.url === 'string' ? entry.url.trim() : '';
  const type = url ? 'remote' : 'local';
  const environment = isRecord(entry.env)
    ? Object.fromEntries(Object.entries(entry.env).map(([key, value]) => [key, String(value)]))
    : (isRecord(entry.environment)
      ? Object.fromEntries(Object.entries(entry.environment).map(([key, value]) => [key, String(value)]))
      : undefined);
  const headers = isRecord(entry.headers)
    ? Object.fromEntries(Object.entries(entry.headers).map(([key, value]) => [key, String(value)]))
    : undefined;
  const enabled = entry.disabled !== true;
  const ui = {
    name,
    type,
    enabled,
    scope,
  };
  if (type === 'local') {
    ui.command = command;
  } else {
    ui.url = url;
    if (headers && Object.keys(headers).length > 0) ui.headers = headers;
    if (entry.oauth === false) {
      ui.oauth = false;
    } else if (isRecord(entry.oauth)) {
      ui.oauth = { ...entry.oauth };
    }
    if (typeof entry.requestTimeoutMs === 'number' && Number.isFinite(entry.requestTimeoutMs) && entry.requestTimeoutMs > 0) {
      ui.timeout = entry.requestTimeoutMs;
    } else if (typeof entry.timeout === 'number' && Number.isFinite(entry.timeout) && entry.timeout > 0) {
      ui.timeout = entry.timeout;
    }
  }
  if (environment && Object.keys(environment).length > 0) {
    ui.environment = environment;
  }
  return ui;
};

const uiToAdapterEntry = (data) => {
  const entry = {};
  const type = data.type === 'remote' || (typeof data.url === 'string' && data.url.trim())
    ? 'remote'
    : 'local';

  if (type === 'local') {
    const command = Array.isArray(data.command) ? data.command.map(String).filter((item) => item.trim()) : [];
    if (command.length > 0) {
      entry.command = command[0];
      if (command.length > 1) entry.args = command.slice(1);
    }
  } else if (typeof data.url === 'string' && data.url.trim()) {
    entry.url = data.url.trim();
    if (isRecord(data.headers)) {
      const headers = {};
      for (const [key, value] of Object.entries(data.headers)) {
        if (key && value != null) headers[key] = String(value);
      }
      if (Object.keys(headers).length > 0) entry.headers = headers;
    }
    if (data.oauth === false) {
      // leave auth unset
    } else if (isRecord(data.oauth)) {
      const oauth = {};
      if (typeof data.oauth.clientId === 'string' && data.oauth.clientId.trim()) oauth.clientId = data.oauth.clientId.trim();
      if (typeof data.oauth.clientSecret === 'string' && data.oauth.clientSecret.trim()) oauth.clientSecret = data.oauth.clientSecret.trim();
      if (typeof data.oauth.scope === 'string' && data.oauth.scope.trim()) oauth.scope = data.oauth.scope.trim();
      if (typeof data.oauth.redirectUri === 'string' && data.oauth.redirectUri.trim()) oauth.redirectUri = data.oauth.redirectUri.trim();
      if (Object.keys(oauth).length > 0) {
        entry.auth = 'oauth';
        entry.oauth = oauth;
      } else {
        entry.auth = 'oauth';
      }
    }
    if (typeof data.timeout === 'number' && Number.isFinite(data.timeout) && data.timeout > 0) {
      entry.requestTimeoutMs = data.timeout;
    }
  }

  const environment = isRecord(data.environment) ? data.environment : (isRecord(data.env) ? data.env : null);
  if (environment) {
    const env = {};
    for (const [key, value] of Object.entries(environment)) {
      if (key && value != null) env[key] = String(value);
    }
    if (Object.keys(env).length > 0) entry.env = env;
  }

  return entry;
};

const writeJsonFile = (filePath, config) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`);
};

const writeMcpServerToFile = (filePath, name, entry, { remove = false } = {}) => {
  const config = isFile(filePath) ? readJsonObject(filePath) : {};
  const servers = isRecord(config.mcpServers) ? { ...config.mcpServers } : {};
  if (remove) {
    delete servers[name];
  } else {
    servers[name] = entry;
  }
  if (Object.keys(servers).length === 0) {
    delete config.mcpServers;
  } else {
    config.mcpServers = servers;
  }
  writeJsonFile(filePath, config);
};

export const resolveAdapterMcpLayers = ({
  home = os.homedir(),
  cwd,
} = {}) => {
  const layers = [];
  for (const item of listAdapterMcpConfigPaths({ home, cwd })) {
    const servers = readMcpServersFromFile(item.path);
    layers.push({ ...item, exists: isFile(item.path), servers });
  }
  return layers;
};

export const listAdapterMcpConfigs = ({
  home = os.homedir(),
  cwd,
} = {}) => {
  const layers = resolveAdapterMcpLayers({ home, cwd });
  const merged = new Map();
  for (const layer of layers) {
    for (const [name, entry] of Object.entries(layer.servers)) {
      const current = merged.get(name);
      const nextDisabled = entry.disabled === true
        ? true
        : (Object.prototype.hasOwnProperty.call(entry, 'disabled') && entry.disabled === false
          ? false
          : current?.disabled);
      if (isDefinitionEntry(entry)) {
        merged.set(name, {
          name,
          entry,
          scope: layer.scope,
          path: layer.path,
          kind: layer.kind,
          disabled: nextDisabled === true,
        });
      } else if (current) {
        merged.set(name, {
          ...current,
          disabled: nextDisabled === true,
        });
      }
    }
  }
  return [...merged.values()]
    .map((item) => adapterEntryToUi(item.name, {
      ...item.entry,
      disabled: item.disabled,
    }, item.scope))
    .sort((left, right) => left.name.localeCompare(right.name));
};

export const getAdapterMcpOwnership = ({
  home = os.homedir(),
  cwd,
  name,
} = {}) => {
  const layers = resolveAdapterMcpLayers({ home, cwd });
  let owner = null;
  let disabled = false;
  for (const layer of layers) {
    const entry = layer.servers[name];
    if (!entry) continue;
    if (isDefinitionEntry(entry)) {
      owner = { ...layer, entry };
    }
    if (entry.disabled === true) disabled = true;
    if (Object.prototype.hasOwnProperty.call(entry, 'disabled') && entry.disabled === false) {
      disabled = false;
    }
  }
  return { owner, disabled };
};

export const getAdapterMcpConfig = ({
  home = os.homedir(),
  cwd,
  name,
} = {}) => listAdapterMcpConfigs({ home, cwd }).find((item) => item.name === name) || null;

const userCreatePath = (home) => path.join(home, '.config', 'mcp', 'mcp.json');
const projectCreatePath = (cwd) => path.join(path.resolve(cwd), '.mcp.json');
const projectOverridePath = (cwd) => path.join(path.resolve(cwd), '.pi', 'mcp.json');

export const createAdapterMcpConfig = ({
  home = os.homedir(),
  cwd,
  name,
  config,
  scope,
} = {}) => {
  validateMcpName(name);
  const existing = getAdapterMcpOwnership({ home, cwd, name });
  if (existing.owner) {
    const error = new Error(`MCP server "${name}" already exists`);
    error.status = 409;
    throw error;
  }
  const targetScope = scope === PROJECT_SCOPE ? PROJECT_SCOPE : USER_SCOPE;
  if (targetScope === PROJECT_SCOPE && !(typeof cwd === 'string' && cwd.trim())) {
    const error = new Error('Project scope requires working directory');
    error.status = 400;
    throw error;
  }
  const targetPath = targetScope === PROJECT_SCOPE
    ? projectCreatePath(cwd)
    : userCreatePath(home);
  writeMcpServerToFile(targetPath, name, uiToAdapterEntry(config || {}));
  if (config?.enabled === false) {
    if (!(typeof cwd === 'string' && cwd.trim())) {
      const error = new Error('Disabling a server requires a project directory');
      error.status = 400;
      throw error;
    }
    setAdapterMcpEnabled({ home, cwd, name, enabled: false });
  }
};

export const updateAdapterMcpConfig = ({
  home = os.homedir(),
  cwd,
  name,
  updates,
} = {}) => {
  const ownership = getAdapterMcpOwnership({ home, cwd, name });
  if (!ownership.owner) {
    const error = new Error(`MCP server "${name}" not found`);
    error.status = 404;
    throw error;
  }
  const keys = Object.keys(updates || {});
  if (keys.length === 1 && keys[0] === 'enabled') {
    setAdapterMcpEnabled({ home, cwd, name, enabled: updates.enabled !== false });
    return;
  }
  const currentUi = adapterEntryToUi(name, ownership.owner.entry, ownership.owner.scope);
  const nextUi = {
    ...currentUi,
    ...updates,
    name,
  };
  if (updates?.type === 'local') {
    delete nextUi.url;
    delete nextUi.headers;
    delete nextUi.oauth;
    delete nextUi.timeout;
  }
  if (updates?.type === 'remote') {
    delete nextUi.command;
  }
  writeMcpServerToFile(ownership.owner.path, name, uiToAdapterEntry(nextUi));
  if (Object.prototype.hasOwnProperty.call(updates || {}, 'enabled')) {
    setAdapterMcpEnabled({ home, cwd, name, enabled: updates.enabled !== false });
  }
};

export const deleteAdapterMcpConfig = ({
  home = os.homedir(),
  cwd,
  name,
} = {}) => {
  const ownership = getAdapterMcpOwnership({ home, cwd, name });
  if (!ownership.owner) {
    const error = new Error(`MCP server "${name}" not found`);
    error.status = 404;
    throw error;
  }
  writeMcpServerToFile(ownership.owner.path, name, null, { remove: true });
  if (typeof cwd === 'string' && cwd.trim()) {
    const overridePath = projectOverridePath(cwd);
    if (isFile(overridePath) && isRecord(readMcpServersFromFile(overridePath)[name])) {
      writeMcpServerToFile(overridePath, name, null, { remove: true });
    }
  }
};

export const setAdapterMcpEnabled = ({
  home = os.homedir(),
  cwd,
  name,
  enabled,
} = {}) => {
  if (!(typeof cwd === 'string' && cwd.trim())) {
    const error = new Error('Enable/disable requires a project directory');
    error.status = 400;
    throw error;
  }
  const ownership = getAdapterMcpOwnership({ home, cwd, name });
  if (!ownership.owner) {
    const error = new Error(`MCP server "${name}" not found`);
    error.status = 404;
    throw error;
  }
  const overridePath = projectOverridePath(cwd);
  const sourceDisabled = ownership.owner.entry.disabled === true;
  if (enabled) {
    if (!sourceDisabled) {
      if (isFile(overridePath)) {
        const servers = readMcpServersFromFile(overridePath);
        if (isRecord(servers[name])) {
          writeMcpServerToFile(overridePath, name, null, { remove: true });
        }
      }
      return;
    }
    writeMcpServerToFile(overridePath, name, { disabled: false });
    return;
  }
  writeMcpServerToFile(overridePath, name, { disabled: true });
};

export const mapAdapterStatusToOpenCode = (status) => {
  if (status === 'needs-auth') return 'needs_auth';
  if (status === 'not-connected') return 'cached';
  if (
    status === 'connected'
    || status === 'cached'
    || status === 'failed'
    || status === 'disabled'
  ) {
    return status;
  }
  return 'cached';
};

export const statusMapFromAdapterSnapshot = (snapshot) => {
  const servers = Array.isArray(snapshot?.servers) ? snapshot.servers : [];
  const map = {};
  for (const server of servers) {
    if (!server || typeof server.name !== 'string' || !server.name.trim()) continue;
    const status = mapAdapterStatusToOpenCode(server.status);
    map[server.name] = {
      status,
      ...(typeof server.failedAgoSeconds === 'number' ? { error: `Failed ${server.failedAgoSeconds}s ago` } : {}),
    };
  }
  return map;
};

export const statusMapFromAdapterConfigs = (configs) => {
  const map = {};
  for (const config of configs || []) {
    map[config.name] = {
      status: config.enabled === false ? 'disabled' : 'cached',
    };
  }
  return map;
};
