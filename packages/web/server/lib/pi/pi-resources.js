import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export const DEFAULT_COMPACTION_SETTINGS = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
};

export const DEFAULT_RETRY_SETTINGS = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 2000,
};

export const DEFAULT_PI_SETTINGS = {
  model: "",
  thinking: "medium",
  compaction: true,
  retry: true,
  compactionSettings: { ...DEFAULT_COMPACTION_SETTINGS },
  retrySettings: { ...DEFAULT_RETRY_SETTINGS },
};

/** Model a new session will actually start with: pinned default if it is in the catalog, else the first catalog model. */
export const resolvePiDefaultModel = (stored, providers = []) => {
  const keys = [];
  for (const provider of providers) {
    if (!provider?.id || !provider.models || typeof provider.models !== 'object') continue;
    for (const modelId of Object.keys(provider.models)) {
      if (modelId) keys.push(`${provider.id}/${modelId}`);
    }
  }
  const pinned = typeof stored === 'string' ? stored.trim() : '';
  if (pinned) {
    if (keys.includes(pinned)) return pinned;
    const byId = keys.find((key) => key.endsWith(`/${pinned}`) || key === pinned);
    if (byId) return byId;
  }
  return keys[0] || pinned || '';
};

export const BUILTIN_COMMANDS = [
  { name: 'compact', description: 'Compact session context', source: 'builtin', template: '' },
  { name: 'reload', description: 'Reload skills, prompts, and context files', source: 'builtin', template: '' },
  { name: 'model', description: 'Select a model', source: 'builtin', template: '' },
  { name: 'thinking', description: 'Set thinking level', source: 'builtin', template: '' },
  { name: 'login', description: 'Authenticate a provider', source: 'builtin', template: '' },
];

const isDirectory = (value) => {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
};

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

export const parseMarkdownFrontmatter = (text) => {
  const source = typeof text === 'string' ? text : '';
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { attributes: {}, body: source.trim() };
  }
  const attributes = {};
  for (const line of match[1].split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) attributes[key] = value;
  }
  return { attributes, body: match[2].trim() };
};

const walkFiles = (root, predicate, results = []) => {
  if (!isDirectory(root)) return results;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, predicate, results);
      continue;
    }
    if (entry.isFile() && predicate(entry.name, fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
};

export const resolvePiAgentDir = (home = os.homedir()) => path.join(home, '.pi', 'agent');

export const resolvePiDefaultsPath = (home = os.homedir()) => path.join(resolvePiAgentDir(home), 'pichamber.json');

export const resolvePiAuthPath = (home = os.homedir()) => path.join(resolvePiAgentDir(home), 'auth.json');

export const resolvePiModelsPath = (home = os.homedir()) => path.join(resolvePiAgentDir(home), 'models.json');

export const resolvePiAgentsMdPath = (home = os.homedir()) => path.join(resolvePiAgentDir(home), 'AGENTS.md');

export const resolvePiSettingsPath = (home = os.homedir()) => path.join(resolvePiAgentDir(home), 'settings.json');

export const resolvePiTrustPath = (home = os.homedir()) => path.join(resolvePiAgentDir(home), 'trust.json');

export const PROJECT_TRUST_VALUES = ['ask', 'always', 'never'];

export const resolvePiSystemMdPath = (home = os.homedir()) => path.join(resolvePiAgentDir(home), 'SYSTEM.md');

export const resolvePiAppendSystemMdPath = (home = os.homedir()) => path.join(resolvePiAgentDir(home), 'APPEND_SYSTEM.md');

export const resolveActiveProjectDirectory = (home = os.homedir()) => {
  const settingsFile = path.join(
    process.env.OPENCHAMBER_DATA_DIR
      ? path.resolve(process.env.OPENCHAMBER_DATA_DIR)
      : path.join(home, '.config', 'openchamber'),
    'settings.json',
  );
  try {
    const settings = JSON.parse(readText(settingsFile));
    if (typeof settings.lastDirectory === 'string' && settings.lastDirectory.trim()) {
      return settings.lastDirectory.trim();
    }
  } catch {
  }
  return '';
};

export const resolveProjectAgentsMd = (home = os.homedir(), directory = resolveActiveProjectDirectory(home)) => {
  if (!directory) {
    return { path: '', scope: 'project', exists: false };
  }
  const projectPath = path.join(directory, 'AGENTS.md');
  return { path: projectPath, scope: 'project', exists: isFile(projectPath) };
};

/** Global / user AGENTS.md only. Never fall back to the project repo file. */
export const resolveBehaviorAgentsMd = (home = os.homedir()) => {
  const userPath = resolvePiAgentsMdPath(home);
  return { path: userPath, scope: 'user', exists: isFile(userPath) };
};

export const readBehaviorAgentsMd = (home = os.homedir()) => {
  const resolved = resolveBehaviorAgentsMd(home);
  return {
    ...resolved,
    content: resolved.exists ? readText(resolved.path) : '',
  };
};

const readJsonObject = (filePath) => {
  try {
    const parsed = JSON.parse(readText(filePath));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const providerMap = (models) => (
  models.providers && typeof models.providers === 'object' && !Array.isArray(models.providers)
    ? models.providers
    : {}
);

const authMethodType = (entry) => {
  const rawType = entry && typeof entry === 'object' && typeof entry.type === 'string'
    ? entry.type.toLowerCase()
    : 'api';
  return rawType === 'oauth' ? 'oauth' : 'api';
};

const authMethodLabel = (methodType) => (methodType === 'oauth' ? 'OAuth' : 'API Key');

export const getPiAuthMethods = (home = os.homedir()) => {
  const auth = readJsonObject(resolvePiAuthPath(home));
  const providers = providerMap(readJsonObject(resolvePiModelsPath(home)));
  const ids = new Set([...Object.keys(auth), ...Object.keys(providers)]);
  const result = {};
  for (const id of ids) {
    if (!id) continue;
    const methodType = authMethodType(auth[id]);
    result[id] = [{
      type: methodType,
      label: authMethodLabel(methodType),
    }];
  }
  return result;
};

export const getPiProviderSources = (providerId, { home = os.homedir(), directory } = {}) => {
  const authPath = resolvePiAuthPath(home);
  const modelsPath = resolvePiModelsPath(home);
  const auth = readJsonObject(authPath);
  const providers = providerMap(readJsonObject(modelsPath));
  const projectModelsPath = directory ? path.join(directory, '.pi', 'models.json') : null;
  const projectProviders = projectModelsPath ? providerMap(readJsonObject(projectModelsPath)) : {};
  return {
    sources: {
      auth: { exists: Boolean(auth[providerId]), path: authPath },
      user: { exists: Object.prototype.hasOwnProperty.call(providers, providerId), path: modelsPath },
      project: {
        exists: Object.prototype.hasOwnProperty.call(projectProviders, providerId),
        path: projectModelsPath,
      },
      custom: { exists: false, path: null },
    },
  };
};

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/;
const BASE_URL_PATTERN = /^https?:\/\//;
export const RESERVED_PI_AUTH_IDS = new Set(['session', 'passkey', 'url-token', 'reset']);

const httpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const sanitizeProviderId = (providerId) => {
  const id = typeof providerId === 'string' ? providerId.trim() : '';
  if (!id || !PROVIDER_ID_PATTERN.test(id)) {
    throw httpError(400, 'Provider ID must match /^[a-z0-9][a-z0-9-_]*$/');
  }
  if (RESERVED_PI_AUTH_IDS.has(id)) {
    throw httpError(400, 'Provider ID is reserved');
  }
  return id;
};

const writeJsonFile = (filePath, data, mode = 0o644) => {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  const tempPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tempPath, payload, { encoding: 'utf8', mode });
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch { /* ignore cleanup */ }
    throw error;
  }
  if (process.platform !== 'win32') {
    try { fs.chmodSync(directory, 0o700); } catch { /* best-effort */ }
    try { fs.chmodSync(filePath, mode); } catch { /* best-effort */ }
  }
};

const authEntryLooksStored = (entry) => (
  Boolean(entry && typeof entry === 'object' && (
    (typeof entry.key === 'string' && entry.key.length > 0)
    || (typeof entry.apiKey === 'string' && entry.apiKey.length > 0)
    || (typeof entry.access === 'string' && entry.access.length > 0)
    || (typeof entry.token === 'string' && entry.token.length > 0)
    || (typeof entry.refresh === 'string' && entry.refresh.length > 0)
  ))
);

export const hasPiStoredAuth = (home, providerId) => {
  const id = typeof providerId === 'string' ? providerId.trim() : '';
  if (!id) return false;
  const auth = readJsonObject(resolvePiAuthPath(home));
  return authEntryLooksStored(auth[id]);
};

const readPiAuthFile = (filePath) => {
  if (!isFile(filePath)) return {};
  const text = readText(filePath).trim();
  if (!text) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const error = new Error('Failed to read Pi auth.json');
    error.status = 500;
    throw error;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const error = new Error('Invalid Pi auth.json: expected an object');
    error.status = 500;
    throw error;
  }
  return parsed;
};

const writePiAuthFile = (filePath, data) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
    }
  }
  return data;
};

export const normalizePiAuthCredential = (body = {}) => {
  const source = body && typeof body === 'object' && !Array.isArray(body)
    ? (body.auth && typeof body.auth === 'object' && !Array.isArray(body.auth) ? body.auth : body)
    : {};
  const rawType = typeof source.type === 'string' ? source.type.toLowerCase() : '';
  if (rawType === 'oauth') {
    const access = typeof source.access === 'string' ? source.access : '';
    const refresh = typeof source.refresh === 'string' ? source.refresh : '';
    const expires = Number(source.expires);
    if (!access || !refresh || !Number.isFinite(expires)) {
      const error = new Error('OAuth credentials need access, refresh, and expires');
      error.status = 400;
      throw error;
    }
    const credential = { type: 'oauth', access, refresh, expires };
    if (typeof source.accountId === 'string' && source.accountId) credential.accountId = source.accountId;
    if (typeof source.enterpriseUrl === 'string' && source.enterpriseUrl) credential.enterpriseUrl = source.enterpriseUrl;
    return credential;
  }
  const key = typeof source.key === 'string' && source.key.trim()
    ? source.key.trim()
    : (typeof source.token === 'string' ? source.token.trim() : '');
  if (!key) {
    const error = new Error('API key is required');
    error.status = 400;
    throw error;
  }
  return { type: 'api_key', key };
};

export const writePiProviderAuth = (providerId, body, { home = os.homedir() } = {}) => {
  const id = sanitizeProviderId(providerId);
  const credential = normalizePiAuthCredential(body);
  const filePath = resolvePiAuthPath(home);
  const current = readPiAuthFile(filePath);
  writePiAuthFile(filePath, { ...current, [id]: credential });
  const methodType = authMethodType(credential);
  return {
    providerId: id,
    type: methodType,
    methods: [{ type: methodType, label: authMethodLabel(methodType) }],
  };
};

export const removePiProviderAuth = (providerId, { home = os.homedir() } = {}) => {
  const id = sanitizeProviderId(providerId);
  const filePath = resolvePiAuthPath(home);
  const current = readPiAuthFile(filePath);
  const removed = Object.prototype.hasOwnProperty.call(current, id);
  if (removed) {
    const next = { ...current };
    delete next[id];
    writePiAuthFile(filePath, next);
  }
  return { providerId: id, removed };
};

const normalizePiModels = (models) => {
  const result = [];
  if (Array.isArray(models)) {
    for (const model of models) {
      if (!model || typeof model !== 'object') continue;
      const id = typeof model.id === 'string' ? model.id.trim() : '';
      if (!id) continue;
      const name = typeof model.name === 'string' && model.name.trim() ? model.name.trim() : id;
      result.push({ id, name });
    }
    return result;
  }
  if (models && typeof models === 'object') {
    for (const [modelId, modelValue] of Object.entries(models)) {
      const id = typeof modelId === 'string' ? modelId.trim() : '';
      if (!id) continue;
      const name = modelValue && typeof modelValue === 'object' && typeof modelValue.name === 'string' && modelValue.name.trim()
        ? modelValue.name.trim()
        : id;
      result.push({ id, name });
    }
  }
  return result;
};

const normalizePiHeaders = (headers) => {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return undefined;
  const next = {};
  for (const [headerKey, headerValue] of Object.entries(headers)) {
    if (typeof headerKey !== 'string' || !headerKey.trim()) continue;
    if (typeof headerValue !== 'string' || !headerValue.trim()) {
      throw httpError(400, `Header "${headerKey}" requires a non-empty value`);
    }
    next[headerKey.trim()] = headerValue.trim();
  }
  return Object.keys(next).length > 0 ? next : undefined;
};

const firstEnvName = (env) => {
  if (!Array.isArray(env)) return '';
  const name = env.find((entry) => typeof entry === 'string' && entry.trim());
  return name ? name.trim() : '';
};

/**
 * Map the Settings custom-provider payload (OpenCode-shaped) onto Pi models.json.
 * Literal API keys stay in auth.json; `{env:VAR}` becomes `apiKey: "$VAR"`.
 */
export const mapOpenCodeProviderToPi = (config = {}) => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw httpError(400, 'Provider config is required');
  }
  const name = typeof config.name === 'string' ? config.name.trim() : '';
  if (!name) {
    throw httpError(400, 'Provider name is required');
  }
  const options = config.options && typeof config.options === 'object' && !Array.isArray(config.options)
    ? config.options
    : {};
  const baseUrl = typeof options.baseURL === 'string' && options.baseURL.trim()
    ? options.baseURL.trim()
    : (typeof config.baseUrl === 'string' ? config.baseUrl.trim() : '');
  if (!baseUrl) {
    throw httpError(400, 'Base URL is required');
  }
  if (!BASE_URL_PATTERN.test(baseUrl)) {
    throw httpError(400, 'Base URL must start with http:// or https://');
  }
  const models = normalizePiModels(config.models);
  if (models.length === 0) {
    throw httpError(400, 'At least one model is required');
  }
  const api = typeof config.api === 'string' && config.api.trim()
    ? config.api.trim()
    : 'openai-completions';
  const headers = normalizePiHeaders(options.headers) || normalizePiHeaders(config.headers);
  const envName = firstEnvName(config.env);
  const mapped = {
    name,
    baseUrl,
    api,
    models,
  };
  if (headers) mapped.headers = headers;
  if (envName) mapped.apiKey = `$${envName}`;
  return mapped;
};

const ENV_DOLLAR_PATTERN = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;
const ENV_BRACE_PATTERN = /^\{env:([^}]+)\}$/;

const envNameFromApiKey = (apiKey) => {
  if (typeof apiKey !== 'string') return '';
  const trimmed = apiKey.trim();
  const dollar = trimmed.match(ENV_DOLLAR_PATTERN);
  if (dollar) return dollar[1];
  const brace = trimmed.match(ENV_BRACE_PATTERN);
  return brace?.[1]?.trim() || '';
};

const publicPiProviderConfig = (provider) => {
  if (!provider || typeof provider !== 'object') return {};
  const envName = envNameFromApiKey(provider.apiKey) || firstEnvName(provider.env);
  const { apiKey: _apiKey, env: _env, ...rest } = provider;
  return envName ? { ...rest, env: [envName] } : rest;
};

/**
 * User + project models.json providers without credentials.
 * Settings uses baseUrl/name/headers to decide Edit and prefill the form.
 */
export const listPiProviderPublicConfigs = ({ home = os.homedir(), directory } = {}) => {
  const userProviders = providerMap(readJsonObject(resolvePiModelsPath(home)));
  const projectProviders = directory
    ? providerMap(readJsonObject(path.join(directory, '.pi', 'models.json')))
    : {};
  const ids = new Set([...Object.keys(userProviders), ...Object.keys(projectProviders)]);
  const result = {};
  for (const id of ids) {
    if (!id) continue;
    const user = userProviders[id] && typeof userProviders[id] === 'object' && !Array.isArray(userProviders[id])
      ? userProviders[id]
      : {};
    const project = projectProviders[id] && typeof projectProviders[id] === 'object' && !Array.isArray(projectProviders[id])
      ? projectProviders[id]
      : {};
    result[id] = publicPiProviderConfig({ ...user, ...project });
  }
  return result;
};

const resolvePiModelsFile = ({ home, directory, scope = 'user' } = {}) => {
  if (scope === 'project') {
    if (typeof directory !== 'string' || !directory.trim()) {
      throw httpError(400, 'Working directory is required for project scope');
    }
    return path.join(directory.trim(), '.pi', 'models.json');
  }
  return resolvePiModelsPath(home);
};

export const upsertPiProviderConfig = ({
  home = os.homedir(),
  directory,
  providerId,
  config,
  scope = 'user',
  hasStoredAuth = false,
} = {}) => {
  const id = sanitizeProviderId(providerId);
  const mapped = mapOpenCodeProviderToPi(config);
  const storedAuth = hasStoredAuth || hasPiStoredAuth(home, id);
  if (!mapped.apiKey && !storedAuth) {
    throw httpError(400, 'API key or {env:VAR} credentials are required');
  }
  const writeScope = scope === 'project' ? 'project' : 'user';
  const filePath = resolvePiModelsFile({ home, directory, scope: writeScope });
  const current = readJsonObject(filePath);
  const providers = { ...providerMap(current) };
  const previous = providers[id] && typeof providers[id] === 'object' && !Array.isArray(providers[id])
    ? providers[id]
    : {};
  const nextProvider = {
    ...previous,
    ...mapped,
  };
  if (!mapped.apiKey) {
    delete nextProvider.apiKey;
  }
  providers[id] = nextProvider;
  writeJsonFile(filePath, { ...current, providers }, 0o600);
  return {
    providerId: id,
    path: filePath,
    scope: writeScope,
    config: publicPiProviderConfig(nextProvider),
  };
};

export const deletePiProviderConfig = ({
  home = os.homedir(),
  directory,
  providerId,
  scope = 'user',
} = {}) => {
  const id = sanitizeProviderId(providerId);
  const filePath = resolvePiModelsFile({ home, directory, scope: scope === 'project' ? 'project' : 'user' });
  const current = readJsonObject(filePath);
  const providers = { ...providerMap(current) };
  if (!Object.prototype.hasOwnProperty.call(providers, id)) {
    return { removed: false, providerId: id, path: filePath };
  }
  delete providers[id];
  const next = { ...current, providers };
  if (Object.keys(providers).length === 0 && Object.keys(next).every((key) => key === 'providers')) {
    try { fs.unlinkSync(filePath); } catch { /* already gone */ }
  } else {
    writeJsonFile(filePath, next, 0o600);
  }
  return { removed: true, providerId: id, path: filePath };
};


export const listPiSkillRoots = ({ home = os.homedir(), directory } = {}) => {
  const roots = [
    { root: path.join(home, '.pi', 'agent', 'skills'), scope: 'user', source: 'pi' },
    { root: path.join(home, '.agents', 'skills'), scope: 'user', source: 'agents' },
  ];
  if (directory) {
    roots.push(
      { root: path.join(directory, '.pi', 'skills'), scope: 'project', source: 'pi' },
      { root: path.join(directory, '.agents', 'skills'), scope: 'project', source: 'agents' },
    );
  }
  return roots;
};

export const listPiPromptRoots = ({ home = os.homedir(), directory } = {}) => {
  const roots = [
    { root: path.join(home, '.pi', 'agent', 'prompts'), scope: 'user', source: 'pi' },
  ];
  if (directory) {
    roots.push({ root: path.join(directory, '.pi', 'prompts'), scope: 'project', source: 'pi' });
  }
  return roots;
};

export const listPiSkills = ({ home = os.homedir(), directory } = {}) => {
  const skills = [];
  const seen = new Set();
  for (const { root, scope, source } of listPiSkillRoots({ home, directory })) {
    for (const skillPath of walkFiles(root, (name) => name === 'SKILL.md')) {
      const name = path.basename(path.dirname(skillPath));
      const key = `${scope}:${name}`;
      if (!name || seen.has(key)) continue;
      seen.add(key);
      const parsed = parseMarkdownFrontmatter(readText(skillPath));
      skills.push({
        name,
        path: skillPath,
        scope,
        source,
        description: parsed.attributes.description || parsed.attributes.name || '',
        content: parsed.body,
        sources: {
          md: {
            exists: true,
            path: skillPath,
            dir: path.dirname(skillPath),
            fields: Object.keys(parsed.attributes),
            scope,
            source,
            supportingFiles: [],
            name,
            description: parsed.attributes.description || '',
            instructions: parsed.body,
          },
        },
        renamable: true,
      });
    }
  }
  return skills;
};

export const listPiPrompts = ({ home = os.homedir(), directory } = {}) => {
  const prompts = [];
  const seen = new Set();
  for (const { root, scope, source } of listPiPromptRoots({ home, directory })) {
    for (const promptPath of walkFiles(root, (name) => name.endsWith('.md'))) {
      const name = path.basename(promptPath, '.md');
      const key = `${scope}:${name}`;
      if (!name || seen.has(key)) continue;
      seen.add(key);
      const parsed = parseMarkdownFrontmatter(readText(promptPath));
      prompts.push({
        name,
        path: promptPath,
        scope,
        source,
        description: parsed.attributes.description || parsed.attributes.name || `/${name}`,
        template: parsed.body || readText(promptPath),
      });
    }
  }
  return prompts;
};

export const listPiCommands = ({ home = os.homedir(), directory } = {}) => {
  const prompts = listPiPrompts({ home, directory }).map((prompt) => ({
    name: prompt.name,
    description: prompt.description,
    source: 'prompt',
    template: prompt.template,
    agent: 'pi',
    path: prompt.path,
    scope: prompt.scope,
  }));
  return [
    ...BUILTIN_COMMANDS.map((command) => ({ ...command, agent: 'pi' })),
    ...prompts,
  ];
};

const asNonNegativeInt = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
};

const normalizeCompactionSettings = (value, enabledFallback = DEFAULT_COMPACTION_SETTINGS.enabled) => {
  if (typeof value === "boolean") {
    return { ...DEFAULT_COMPACTION_SETTINGS, enabled: value };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      enabled: typeof value.enabled === "boolean" ? value.enabled : enabledFallback,
      reserveTokens: asNonNegativeInt(value.reserveTokens, DEFAULT_COMPACTION_SETTINGS.reserveTokens),
      keepRecentTokens: asNonNegativeInt(value.keepRecentTokens, DEFAULT_COMPACTION_SETTINGS.keepRecentTokens),
    };
  }
  return { ...DEFAULT_COMPACTION_SETTINGS, enabled: enabledFallback };
};

const normalizeRetrySettings = (value, enabledFallback = DEFAULT_RETRY_SETTINGS.enabled) => {
  if (typeof value === "boolean") {
    return { ...DEFAULT_RETRY_SETTINGS, enabled: value };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      enabled: typeof value.enabled === "boolean" ? value.enabled : enabledFallback,
      maxRetries: asNonNegativeInt(value.maxRetries, DEFAULT_RETRY_SETTINGS.maxRetries),
      baseDelayMs: asNonNegativeInt(value.baseDelayMs, DEFAULT_RETRY_SETTINGS.baseDelayMs),
    };
  }
  return { ...DEFAULT_RETRY_SETTINGS, enabled: enabledFallback };
};

const pickObjectPatch = (value) => (
  value && typeof value === "object" && !Array.isArray(value) ? value : null
);

const pickCompactionPatch = (patch = {}) => {
  const fromSettings = pickObjectPatch(patch.compactionSettings);
  const fromObject = pickObjectPatch(patch.compaction);
  const fromBool = typeof patch.compaction === "boolean" ? { enabled: patch.compaction } : null;
  if (!fromSettings && !fromObject && !fromBool) return null;
  return { ...fromSettings, ...fromObject, ...fromBool };
};

const pickRetryPatch = (patch = {}) => {
  const fromSettings = pickObjectPatch(patch.retrySettings);
  const fromObject = pickObjectPatch(patch.retry);
  const fromBool = typeof patch.retry === "boolean" ? { enabled: patch.retry } : null;
  if (!fromSettings && !fromObject && !fromBool) return null;
  return { ...fromSettings, ...fromObject, ...fromBool };
};

export const readPiAgentSettings = (home = os.homedir()) => readJsonObject(resolvePiSettingsPath(home));

export const normalizeEnabledModels = (value) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const key = item.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
};

export const isModelEnabled = (providerId, modelId, enabledModels) => {
  const list = normalizeEnabledModels(enabledModels);
  if (list.length === 0) return true;
  const id = typeof modelId === "string" ? modelId.trim() : "";
  const provider = typeof providerId === "string" ? providerId.trim() : "";
  if (id && list.includes(id)) return true;
  if (provider && id && list.includes(`${provider}/${id}`)) return true;
  return false;
};

export const filterProvidersByEnabledModels = (providers, enabledModels) => {
  const list = normalizeEnabledModels(enabledModels);
  if (list.length === 0 || !Array.isArray(providers)) return providers || [];
  return providers
    .map((provider) => {
      const models = provider?.models && typeof provider.models === "object" && !Array.isArray(provider.models)
        ? provider.models
        : {};
      const nextModels = {};
      for (const [id, model] of Object.entries(models)) {
        if (isModelEnabled(provider.id, id, list)) nextModels[id] = model;
      }
      return { ...provider, models: nextModels };
    })
    .filter((provider) => Object.keys(provider.models || {}).length > 0);
};

const normalizeDefaultProjectTrust = (value, fallback = "ask") => (
  PROJECT_TRUST_VALUES.includes(value) ? value : fallback
);

export const writePiAgentSettings = (home = os.homedir(), patch = {}) => {
  const filePath = resolvePiSettingsPath(home);
  const current = readJsonObject(filePath);
  const next = { ...current };
  if (patch.compaction && typeof patch.compaction === "object" && !Array.isArray(patch.compaction)) {
    next.compaction = {
      ...(current.compaction && typeof current.compaction === "object" && !Array.isArray(current.compaction)
        ? current.compaction
        : {}),
      ...patch.compaction,
    };
  }
  if (patch.retry && typeof patch.retry === "object" && !Array.isArray(patch.retry)) {
    next.retry = {
      ...(current.retry && typeof current.retry === "object" && !Array.isArray(current.retry)
        ? current.retry
        : {}),
      ...patch.retry,
    };
  }
  if (Object.prototype.hasOwnProperty.call(patch, "enabledModels")) {
    const list = normalizeEnabledModels(patch.enabledModels);
    if (list.length === 0) delete next.enabledModels;
    else next.enabledModels = list;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "defaultProjectTrust")) {
    next.defaultProjectTrust = normalizeDefaultProjectTrust(patch.defaultProjectTrust, current.defaultProjectTrust || "ask");
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
};

export const readPiDefaults = (home = os.homedir()) => {
  const chamberPath = resolvePiDefaultsPath(home);
  const chamber = isFile(chamberPath) ? readJsonObject(chamberPath) : {};
  const agent = readPiAgentSettings(home);
  const thinking = THINKING_LEVELS.includes(chamber.thinking) ? chamber.thinking : DEFAULT_PI_SETTINGS.thinking;
  const chamberCompaction = typeof chamber.compaction === "boolean" ? chamber.compaction : DEFAULT_PI_SETTINGS.compaction;
  const chamberRetry = typeof chamber.retry === "boolean" ? chamber.retry : DEFAULT_PI_SETTINGS.retry;
  const compactionSettings = normalizeCompactionSettings(agent.compaction ?? chamber.compaction, chamberCompaction);
  const retrySettings = normalizeRetrySettings(agent.retry ?? chamber.retry, chamberRetry);
  return {
    model: typeof chamber.model === "string" ? chamber.model : "",
    thinking,
    compaction: compactionSettings.enabled,
    retry: retrySettings.enabled,
    compactionSettings,
    retrySettings,
    enabledModels: normalizeEnabledModels(agent.enabledModels),
    defaultProjectTrust: normalizeDefaultProjectTrust(agent.defaultProjectTrust),
  };
};

export const writePiDefaults = (home = os.homedir(), patch = {}) => {
  const current = readPiDefaults(home);
  const compactionPatch = pickCompactionPatch(patch);
  const retryPatch = pickRetryPatch(patch);
  const compactionSettings = compactionPatch
    ? normalizeCompactionSettings({ ...current.compactionSettings, ...compactionPatch }, current.compaction)
    : current.compactionSettings;
  const retrySettings = retryPatch
    ? normalizeRetrySettings({ ...current.retrySettings, ...retryPatch }, current.retry)
    : current.retrySettings;
  const enabledModels = Object.prototype.hasOwnProperty.call(patch, "enabledModels")
    ? normalizeEnabledModels(patch.enabledModels)
    : current.enabledModels;
  const defaultProjectTrust = Object.prototype.hasOwnProperty.call(patch, "defaultProjectTrust")
    ? normalizeDefaultProjectTrust(patch.defaultProjectTrust, current.defaultProjectTrust)
    : current.defaultProjectTrust;
  const next = {
    model: typeof patch.model === "string" ? patch.model : current.model,
    thinking: THINKING_LEVELS.includes(patch.thinking) ? patch.thinking : current.thinking,
    compaction: compactionSettings.enabled,
    retry: retrySettings.enabled,
    compactionSettings,
    retrySettings,
    enabledModels,
    defaultProjectTrust,
  };
  const chamberPath = resolvePiDefaultsPath(home);
  fs.mkdirSync(path.dirname(chamberPath), { recursive: true });
  fs.writeFileSync(chamberPath, `${JSON.stringify({
    model: next.model,
    thinking: next.thinking,
    compaction: next.compaction,
    retry: next.retry,
  }, null, 2)}\n`);
  const agentPatch = {
    compaction: compactionSettings,
    retry: retrySettings,
  };
  if (Object.prototype.hasOwnProperty.call(patch, "enabledModels")) {
    agentPatch.enabledModels = enabledModels;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "defaultProjectTrust")) {
    agentPatch.defaultProjectTrust = defaultProjectTrust;
  }
  writePiAgentSettings(home, agentPatch);
  return next;
};

export const resolvePiSystemPromptFiles = (home = os.homedir()) => {
  const directory = resolveActiveProjectDirectory(home);
  return {
    directory,
    global: {
      replace: resolvePiSystemMdPath(home),
      append: resolvePiAppendSystemMdPath(home),
    },
    project: directory
      ? {
        replace: path.join(directory, ".pi", "SYSTEM.md"),
        append: path.join(directory, ".pi", "APPEND_SYSTEM.md"),
      }
      : null,
  };
};

const describePromptFile = (filePath) => ({
  path: filePath,
  exists: isFile(filePath),
  content: isFile(filePath) ? readText(filePath) : "",
});

export const readPiSystemPromptFiles = (home = os.homedir()) => {
  const paths = resolvePiSystemPromptFiles(home);
  return {
    directory: paths.directory,
    global: {
      replace: describePromptFile(paths.global.replace),
      append: describePromptFile(paths.global.append),
    },
    project: paths.project
      ? {
        replace: describePromptFile(paths.project.replace),
        append: describePromptFile(paths.project.append),
      }
      : null,
  };
};

export const writePiSystemPromptFile = ({
  home = os.homedir(),
  kind = "replace",
  scope = "user",
  content = "",
} = {}) => {
  const paths = resolvePiSystemPromptFiles(home);
  const target = scope === "project" ? paths.project : paths.global;
  if (!target) {
    const error = new Error("Project SYSTEM.md needs a lastDirectory");
    error.status = 400;
    throw error;
  }
  const filePath = kind === "append" ? target.append : target.replace;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = typeof content === "string" ? content : "";
  fs.writeFileSync(filePath, body.endsWith("\n") || body.length === 0 ? body : `${body}\n`);
  return { path: filePath, scope: scope === "project" ? "project" : "user", kind: kind === "append" ? "append" : "replace" };
};

export const listPiExtensionRoots = ({ home = os.homedir(), directory } = {}) => {
  const roots = [
    { root: path.join(resolvePiAgentDir(home), "extensions"), scope: "user" },
  ];
  if (directory) {
    roots.push({ root: path.join(directory, ".pi", "extensions"), scope: "project" });
  }
  return roots;
};

export const listPiExtensions = ({ home = os.homedir(), directory } = {}) => {
  const extensions = [];
  const seen = new Set();
  for (const { root, scope } of listPiExtensionRoots({ home, directory })) {
    if (!isDirectory(root)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(root, entry.name);
      const isExtFile = entry.isFile() && /\.(ts|js|mjs|cjs)$/i.test(entry.name);
      if (!entry.isDirectory() && !isExtFile) continue;
      const name = entry.isDirectory() ? entry.name : path.basename(entry.name, path.extname(entry.name));
      const key = `${scope}:${name}`;
      if (!name || seen.has(key)) continue;
      seen.add(key);
      extensions.push({ name, path: fullPath, scope });
    }
  }
  return extensions;
};

const collectPackageJsonFiles = (root, depth = 0, results = []) => {
  if (depth > 3 || !isDirectory(root)) return results;
  const manifest = path.join(root, "package.json");
  if (isFile(manifest)) {
    results.push(manifest);
    return results;
  }
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    collectPackageJsonFiles(path.join(root, entry.name), depth + 1, results);
  }
  return results;
};

export const listPiPackageRoots = ({ home = os.homedir(), directory } = {}) => {
  const roots = [
    { root: path.join(resolvePiAgentDir(home), "npm"), source: "npm", scope: "user" },
    { root: path.join(resolvePiAgentDir(home), "git"), source: "git", scope: "user" },
  ];
  if (directory) {
    roots.push({ root: path.join(directory, ".pi", "npm"), source: "npm", scope: "project" });
    roots.push({ root: path.join(directory, ".pi", "git"), source: "git", scope: "project" });
  }
  return roots;
};

export const listPiPackages = ({ home = os.homedir(), directory } = {}) => {
  const packages = [];
  const seen = new Set();
  for (const { root, source, scope } of listPiPackageRoots({ home, directory })) {
    for (const manifest of collectPackageJsonFiles(root)) {
      const parsed = readJsonObject(manifest);
      const name = typeof parsed.name === "string" && parsed.name.trim()
        ? parsed.name.trim()
        : path.basename(path.dirname(manifest));
      const key = [scope, source, name].join(":");
      if (!name || seen.has(key)) continue;
      seen.add(key);
      packages.push({ name, source, scope, path: path.dirname(manifest) });
    }
  }
  return packages;
};


export const areProjectSkillsInjected = (trust) => {
  if (trust?.current?.trusted === true) return true;
  if (trust?.current?.trusted == null && trust?.defaultProjectTrust === 'always') return true;
  return false;
};

export const toConfigSkillsPayload = (skills, { home, directory } = {}) => {
  const trust = readPiProjectTrust(home, directory);
  const projectInjected = areProjectSkillsInjected(trust);
  return {
    skills: (Array.isArray(skills) ? skills : []).map((skill) => ({
      ...skill,
      injected: skill.scope !== 'project' || projectInjected,
    })),
    projectTrust: {
      trusted: projectInjected,
      defaultProjectTrust: trust.defaultProjectTrust,
      current: trust.current,
    },
    externalSkills: {
      claudeDisabled: false,
      allDisabled: false,
    },
  };
};

const SAFE_COMMAND_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export const isBuiltinCommandName = (name) => BUILTIN_COMMANDS.some((command) => command.name === name);

const sanitizeCommandName = (name) => {
  const value = typeof name === 'string' ? name.trim() : '';
  if (!SAFE_COMMAND_NAME.test(value)) {
    const error = new Error('Invalid command name');
    error.status = 400;
    throw error;
  }
  return value;
};

const promptFileForScope = ({ home = os.homedir(), directory, name, scope } = {}) => {
  if (scope === 'project') {
    if (!directory) {
      const error = new Error('Project commands need a directory');
      error.status = 400;
      throw error;
    }
    return path.join(directory, '.pi', 'prompts', `${name}.md`);
  }
  return path.join(resolvePiAgentDir(home), 'prompts', `${name}.md`);
};

export const writePiPrompt = ({
  home = os.homedir(),
  directory,
  name,
  description = '',
  template = '',
  scope = 'user',
} = {}) => {
  const commandName = sanitizeCommandName(name);
  if (isBuiltinCommandName(commandName)) {
    const error = new Error('Cannot overwrite a built-in Pi command');
    error.status = 400;
    throw error;
  }
  const filePath = promptFileForScope({ home, directory, name: commandName, scope });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const desc = typeof description === 'string' ? description.trim() : '';
  const body = typeof template === 'string' ? template : '';
  const contents = desc
    ? `---\ndescription: ${desc.replace(/\n/g, ' ')}\n---\n${body}${body.endsWith('\n') ? '' : '\n'}`
    : `${body}${body.endsWith('\n') ? '' : '\n'}`;
  fs.writeFileSync(filePath, contents);
  return {
    name: commandName,
    description: desc || `/${commandName}`,
    source: 'prompt',
    template: body,
    agent: 'pi',
    path: filePath,
    scope: scope === 'project' ? 'project' : 'user',
  };
};

export const deletePiPrompt = ({ home = os.homedir(), directory, name } = {}) => {
  const commandName = sanitizeCommandName(name);
  if (isBuiltinCommandName(commandName)) {
    const error = new Error('Cannot delete a built-in Pi command');
    error.status = 400;
    throw error;
  }
  const candidates = [
    path.join(resolvePiAgentDir(home), 'prompts', `${commandName}.md`),
  ];
  if (directory) {
    candidates.unshift(path.join(directory, '.pi', 'prompts', `${commandName}.md`));
  }
  const existing = candidates.find((filePath) => isFile(filePath));
  if (!existing) {
    const error = new Error('Command not found');
    error.status = 404;
    throw error;
  }
  fs.unlinkSync(existing);
  return { deleted: true, name: commandName, path: existing };
};

export const readPiTrustDecisions = (home = os.homedir()) => {
  const data = readJsonObject(resolvePiTrustPath(home));
  const decisions = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === true || value === false) {
      decisions.push({ path: key, trusted: value });
    }
  }
  return decisions.sort((a, b) => a.path.localeCompare(b.path));
};

export const getPiTrustDecision = (home = os.homedir(), directory = '') => {
  const target = typeof directory === 'string' && directory.trim() ? path.resolve(directory.trim()) : '';
  if (!target) return { path: '', trusted: null };
  const data = readJsonObject(resolvePiTrustPath(home));
  let currentDir = target;
  while (true) {
    if (data[currentDir] === true || data[currentDir] === false) {
      return { path: currentDir, trusted: data[currentDir] };
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return { path: target, trusted: null };
    }
    currentDir = parentDir;
  }
};

export const writePiTrustDecisions = (home = os.homedir(), decisions = []) => {
  const filePath = resolvePiTrustPath(home);
  const current = readJsonObject(filePath);
  for (const item of Array.isArray(decisions) ? decisions : []) {
    if (!item || typeof item.path !== 'string' || !item.path.trim()) continue;
    const key = path.resolve(item.path.trim());
    if (item.trusted === null || item.trusted === undefined) {
      delete current[key];
    } else {
      current[key] = Boolean(item.trusted);
    }
  }
  const sorted = {};
  for (const key of Object.keys(current).sort()) {
    if (current[key] === true || current[key] === false) sorted[key] = current[key];
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(sorted, null, 2)}\n`);
  return readPiTrustDecisions(home);
};

export const setPiProjectTrust = (home = os.homedir(), directory, trusted) => {
  if (typeof directory !== 'string' || !directory.trim()) {
    const error = new Error('Project directory is required');
    error.status = 400;
    throw error;
  }
  writePiTrustDecisions(home, [{ path: directory, trusted: Boolean(trusted) }]);
  return getPiTrustDecision(home, directory);
};

export const readPiProjectTrust = (home = os.homedir(), directory = '') => {
  const defaults = readPiDefaults(home);
  const resolved = typeof directory === 'string' && directory.trim()
    ? directory.trim()
    : resolveActiveProjectDirectory(home);
  return {
    defaultProjectTrust: defaults.defaultProjectTrust,
    decisions: readPiTrustDecisions(home),
    current: resolved ? getPiTrustDecision(home, resolved) : null,
  };
};

export const writePiProjectTrust = (home = os.homedir(), patch = {}, directory = '') => {
  if (Object.prototype.hasOwnProperty.call(patch, 'defaultProjectTrust')) {
    writePiAgentSettings(home, { defaultProjectTrust: patch.defaultProjectTrust });
  }
  if (Array.isArray(patch.decisions)) {
    writePiTrustDecisions(home, patch.decisions);
  }
  return readPiProjectTrust(home, directory);
};

