import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolvePiAuthPath, resolvePiModelsPath } from './pi-resources.js';

const BASE_URL_PATTERN = /^https?:\/\//;
const ENV_KEY_PATTERN = /^\{env:([^}]+)\}$/;
const FETCH_TIMEOUT_MS = 15_000;
const BLOCKED_REQUEST_HEADERS = new Set([
  'authorization',
  'cookie',
  'host',
  'proxy-authorization',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-real-ip',
]);
const METADATA_HOSTS = new Set([
  '169.254.169.254',
  '100.100.100.200',
  'metadata.google.internal',
  'metadata.goog',
]);
/**
 * Anthropic-compat subpaths from CC Switch. Longest suffix first so
 * `/api/anthropic` is not stripped down to a leftover `/api`.
 */
const KNOWN_COMPAT_SUFFIXES = [
  '/api/claudecode',
  '/api/anthropic',
  '/apps/anthropic',
  '/api/coding',
  '/claudecode',
  '/anthropic',
  '/step_plan',
  '/coding',
  '/claude',
];

const httpError = (status, message, code) => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
};

const trimSlash = (value) => value.replace(/\/+$/, '');

const endsWithVersionSegment = (url) => {
  const last = trimSlash(url).split('/').pop() || '';
  if (!/^v/i.test(last)) return false;
  const digits = last.slice(1);
  return digits.length > 0 && /^[0-9]+$/.test(digits);
};

const stripCompatSuffix = (base) => {
  const lower = base.toLowerCase();
  for (const suffix of KNOWN_COMPAT_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      return base.slice(0, base.length - suffix.length);
    }
  }
  return '';
};

/**
 * Candidate list matches CC Switch: versioned bases use `{base}/models`,
 * other bases try `{base}/v1/models`, then stripped Anthropic-compat roots.
 */
export const buildRemoteModelListUrls = (baseURL) => {
  const trimmed = trimSlash(typeof baseURL === 'string' ? baseURL.trim() : '');
  if (!trimmed) return [];
  const candidates = [];
  if (endsWithVersionSegment(trimmed)) {
    candidates.push(`${trimmed}/models`);
    if (!/\/v1$/i.test(trimmed)) {
      candidates.push(`${trimmed}/v1/models`);
    }
  } else {
    candidates.push(`${trimmed}/v1/models`);
  }
  const stripped = trimSlash(stripCompatSuffix(trimmed));
  if (stripped && stripped.includes('://') && stripped !== trimmed) {
    candidates.push(`${stripped}/v1/models`);
    candidates.push(`${stripped}/models`);
  }
  return [...new Set(candidates)];
};

const ipv4Parts = (value) => {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return null;
  return parts;
};

const isMetadataIPv4 = (parts) => (
  (parts[0] === 169 && parts[1] === 254 && parts[2] === 169 && parts[3] === 254)
  || (parts[0] === 100 && parts[1] === 100 && parts[2] === 100 && parts[3] === 200)
);

const isPrivateIPv4 = (parts) => {
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
};

const isPrivateIPv6 = (ip) => {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1' || lower === '0:0:0:0:0:0:0:0' || lower === '0:0:0:0:0:0:0:1') {
    return true;
  }
  if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
    return true;
  }
  if (lower.startsWith('::ffff:')) {
    const mapped = ipv4Parts(lower.slice('::ffff:'.length));
    return Boolean(mapped && (isPrivateIPv4(mapped) || isMetadataIPv4(mapped)));
  }
  return false;
};

const classifyRemoteFetchHost = (hostname) => {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return 'invalid';
  if (METADATA_HOSTS.has(host)) return 'metadata';
  const ipv4 = ipv4Parts(host);
  if (ipv4) {
    if (isMetadataIPv4(ipv4)) return 'metadata';
    if (isPrivateIPv4(ipv4)) return 'private';
    return 'public';
  }
  if (host.includes(':')) {
    if (isPrivateIPv6(host)) return 'private';
    return 'public';
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0') {
    return 'private';
  }
  return 'public';
};

const defaultPort = (protocol) => (protocol === 'https:' ? '443' : '80');

const sameOriginBaseUrls = (left, right) => {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return a.protocol === b.protocol
      && a.hostname.toLowerCase() === b.hostname.toLowerCase()
      && (a.port || defaultPort(a.protocol)) === (b.port || defaultPort(b.protocol));
  } catch {
    return false;
  }
};

const assertFetchUrlAllowed = (urlString, { allowPrivate }) => {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw httpError(400, 'Base URL is invalid', 'invalid');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw httpError(400, 'Base URL must start with http:// or https://', 'invalid');
  }
  const kind = classifyRemoteFetchHost(parsed.hostname);
  if (kind === 'invalid' || kind === 'metadata') {
    throw httpError(400, 'This URL is not allowed', 'invalid');
  }
  if (kind === 'private' && !allowPrivate) {
    throw httpError(400, 'This URL is not allowed', 'invalid');
  }
};

const readStoredApiKey = (home, providerId) => {
  const id = typeof providerId === 'string' ? providerId.trim() : '';
  if (!id) return '';
  try {
    const raw = fs.readFileSync(resolvePiAuthPath(home), 'utf8');
    const auth = JSON.parse(raw);
    const entry = auth && typeof auth === 'object' ? auth[id] : null;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return '';
    for (const field of ['key', 'apiKey']) {
      if (typeof entry[field] === 'string' && entry[field].trim()) {
        return entry[field].trim();
      }
    }
  } catch {
    return '';
  }
  return '';
};

const readStoredProviderBaseUrl = (home, providerId) => {
  const id = typeof providerId === 'string' ? providerId.trim() : '';
  if (!id) return '';
  try {
    const raw = fs.readFileSync(resolvePiModelsPath(home), 'utf8');
    const parsed = JSON.parse(raw);
    const provider = parsed?.providers?.[id];
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) return '';
    return typeof provider.baseUrl === 'string' ? provider.baseUrl.trim() : '';
  } catch {
    return '';
  }
};

const resolveApiKey = ({ apiKey, providerID, home, env = process.env } = {}) => {
  const trimmed = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (trimmed) {
    const envMatch = trimmed.match(ENV_KEY_PATTERN);
    const envName = envMatch?.[1]?.trim();
    if (envName) {
      const fromEnv = typeof env?.[envName] === 'string' ? env[envName].trim() : '';
      if (!fromEnv) {
        throw httpError(400, `Environment variable ${envName} is not set`, 'invalid');
      }
      return fromEnv;
    }
    return trimmed;
  }
  const stored = readStoredApiKey(home, providerID);
  if (stored) return stored;
  throw httpError(400, 'API key is required', 'invalid');
};

const normalizeHeaders = (headers) => {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};
  const next = {};
  for (const [headerKey, headerValue] of Object.entries(headers)) {
    if (typeof headerKey !== 'string' || !headerKey.trim()) continue;
    if (typeof headerValue !== 'string' || !headerValue.trim()) continue;
    if (BLOCKED_REQUEST_HEADERS.has(headerKey.trim().toLowerCase())) continue;
    next[headerKey.trim()] = headerValue.trim();
  }
  return next;
};

const REMOTE_CONTEXT_KEYS = [
  'context_length',
  'max_model_len',
  'context_window',
  'contextWindow',
  'max_input_tokens',
  'maxInputTokens',
  'context',
];

const readRemoteContextWindow = (item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  for (const key of REMOTE_CONTEXT_KEYS) {
    const numeric = Number(item[key]);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.round(numeric);
    }
  }
  const limit = item.limit;
  if (limit && typeof limit === 'object' && !Array.isArray(limit)) {
    const nested = Number(limit.context);
    if (Number.isFinite(nested) && nested > 0) {
      return Math.round(nested);
    }
  }
  return undefined;
};

const PI_MODEL_INPUT_TYPES = new Set(['text', 'image']);

const readRemoteModelInput = (item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  const value = item.input;
  if (Array.isArray(value)) {
    const next = [];
    const seen = new Set();
    for (const entry of value) {
      if (typeof entry !== 'string') continue;
      const token = entry.trim().toLowerCase();
      if (!PI_MODEL_INPUT_TYPES.has(token) || seen.has(token)) continue;
      seen.add(token);
      next.push(token);
    }
    if (next.length > 0) return next;
  }
  const architecture = item.architecture && typeof item.architecture === 'object' && !Array.isArray(item.architecture)
    ? item.architecture
    : null;
  const modalities = Array.isArray(architecture?.input_modalities)
    ? architecture.input_modalities
    : Array.isArray(item.modalities?.input)
      ? item.modalities.input
      : [];
  if (modalities.some((entry) => typeof entry === 'string' && entry.trim().toLowerCase() === 'image')) {
    return ['text', 'image'];
  }
  return undefined;
};

const readRemoteModelReasoning = (item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  if (item.reasoning === true) return true;
  const params = Array.isArray(item.supported_parameters) ? item.supported_parameters : [];
  if (params.some((entry) => {
    const token = typeof entry === 'string' ? entry.trim().toLowerCase() : '';
    return token === 'reasoning' || token === 'include_reasoning';
  })) {
    return true;
  }
  return undefined;
};

export const parseRemoteModelsPayload = (body) => {
  const list = Array.isArray(body)
    ? body
    : Array.isArray(body?.data)
      ? body.data
      : Array.isArray(body?.models)
        ? body.models
        : null;
  if (!list) {
    throw httpError(502, 'The endpoint did not return an OpenAI-compatible model list', 'upstream');
  }
  const models = [];
  const seen = new Set();
  for (const item of list) {
    const id = typeof item === 'string'
      ? item.trim()
      : (item && typeof item === 'object' && typeof item.id === 'string' ? item.id.trim() : '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = item && typeof item === 'object' && typeof item.name === 'string' && item.name.trim()
      ? item.name.trim()
      : id;
    const contextWindow = readRemoteContextWindow(item);
    const input = readRemoteModelInput(item);
    const reasoning = readRemoteModelReasoning(item);
    models.push({
      id,
      name,
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(input !== undefined ? { input } : {}),
      ...(reasoning ? { reasoning: true } : {}),
    });
  }
  return models;
};

const classifyHttpStatus = (status) => {
  if (status === 401 || status === 403) {
    return httpError(401, 'The API key was rejected', 'unauthorized');
  }
  if (status === 404 || status === 405 || (status >= 300 && status < 400)) {
    return httpError(404, 'This endpoint does not list models', 'unsupported');
  }
  return httpError(502, 'The provider did not return a usable model list', 'upstream');
};

const looksLikeJson = (contentType, text) => {
  if (typeof contentType === 'string' && contentType.toLowerCase().includes('application/json')) {
    return true;
  }
  const trimmed = typeof text === 'string' ? text.trim() : '';
  return trimmed.startsWith('{') || trimmed.startsWith('[');
};

/**
 * GET {baseURL}/models with the form API key (or a stored Pi key).
 * Stored keys are only sent to the saved provider origin. Never returns credentials.
 * Failure is distinct from an empty list.
 */
export const fetchRemoteProviderModels = async ({
  baseURL,
  apiKey,
  headers,
  providerID,
  home = os.homedir(),
  env = process.env,
} = {}, { fetchImpl = globalThis.fetch } = {}) => {
  const url = typeof baseURL === 'string' ? baseURL.trim() : '';
  if (!url) {
    throw httpError(400, 'Base URL is required', 'invalid');
  }
  if (!BASE_URL_PATTERN.test(url)) {
    throw httpError(400, 'Base URL must start with http:// or https://', 'invalid');
  }

  const suppliedKey = typeof apiKey === 'string' && apiKey.trim();
  if (!suppliedKey) {
    const storedBaseUrl = readStoredProviderBaseUrl(home, providerID);
    if (!storedBaseUrl) {
      throw httpError(400, 'A saved provider URL is required to reuse a stored key', 'invalid');
    }
    if (!sameOriginBaseUrls(url, storedBaseUrl)) {
      throw httpError(400, 'Base URL must match the saved provider', 'invalid');
    }
  }

  let parsedBase;
  try {
    parsedBase = new URL(url);
  } catch {
    throw httpError(400, 'Base URL is invalid', 'invalid');
  }
  const allowPrivate = Boolean(suppliedKey) || classifyRemoteFetchHost(parsedBase.hostname) === 'private';
  assertFetchUrlAllowed(url, { allowPrivate });

  const resolvedKey = resolveApiKey({ apiKey, providerID, home, env });
  const extraHeaders = normalizeHeaders(headers);
  const candidates = buildRemoteModelListUrls(url);
  let lastError = httpError(502, 'The provider did not return a usable model list', 'upstream');

  for (const candidate of candidates) {
    assertFetchUrlAllowed(candidate, { allowPrivate });
    let response;
    try {
      response = await fetchImpl(candidate, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...extraHeaders,
          Authorization: `Bearer ${resolvedKey}`,
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        lastError = httpError(502, 'The provider timed out while listing models', 'upstream');
        continue;
      }
      lastError = httpError(502, 'Could not reach the provider model list', 'upstream');
      continue;
    }

    const text = await response.text().catch(() => '');
    if (!response.ok) {
      lastError = classifyHttpStatus(response.status);
      if (lastError.code === 'unauthorized' && looksLikeJson(response.headers?.get?.('content-type'), text)) {
        throw lastError;
      }
      continue;
    }
    if (!looksLikeJson(response.headers?.get?.('content-type'), text)) {
      lastError = httpError(502, 'The endpoint did not return an OpenAI-compatible model list', 'upstream');
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      lastError = httpError(502, 'The endpoint did not return an OpenAI-compatible model list', 'upstream');
      continue;
    }
    return { models: parseRemoteModelsPayload(parsed) };
  }

  throw lastError;
};

export const handleFetchRemoteProviderModels = async (req, res, { home = os.homedir() } = {}) => {
  try {
    const result = await fetchRemoteProviderModels({
      home,
      baseURL: req.body?.baseURL ?? req.body?.baseUrl,
      apiKey: req.body?.apiKey,
      headers: req.body?.headers,
      providerID: req.body?.providerID ?? req.body?.providerId,
    });
    res.status(200).json(result);
  } catch (error) {
    const status = Number(error?.status) || 500;
    res.status(status).json({
      error: error.code || 'upstream',
      message: error.message || 'Could not fetch models',
    });
  }
};


/** Builtin catalogs must not use the custom OpenAI-compat list-models sync path. */
const BUILTIN_SKIP_SYNC_IDS = new Set(['xai', 'kimi-coding', 'deepseek', 'anthropic', 'openai', 'google', 'openrouter']);

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/;

const readJsonObjectFile = (filePath) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writeJsonObjectFile = (filePath, data) => {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  const tempPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tempPath, payload, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    throw error;
  }
};

const providerMapFromModels = (models) => (
  models?.providers && typeof models.providers === 'object' && !Array.isArray(models.providers)
    ? models.providers
    : {}
);

/**
 * Merge upstream list-models ids into the local models.json catalog.
 * Existing rows keep user overrides (name / contextWindow / input / reasoning / compat).
 * Local-only ids are kept. Empty remote lists do not wipe the catalog.
 */
export const mergeRemoteModelsIntoCatalog = (localModels, remoteModels) => {
  const local = Array.isArray(localModels) ? localModels : [];
  const remote = Array.isArray(remoteModels) ? remoteModels : [];
  if (remote.length === 0) {
    return { models: local, added: 0, changed: false };
  }

  const next = [];
  const seen = new Set();
  for (const model of local) {
    if (!model || typeof model !== 'object' || Array.isArray(model)) continue;
    const id = typeof model.id === 'string' ? model.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push(model);
  }

  let added = 0;
  for (const model of remote) {
    if (!model || typeof model !== 'object' || Array.isArray(model)) continue;
    const id = typeof model.id === 'string' ? model.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = typeof model.name === 'string' && model.name.trim() ? model.name.trim() : id;
    const entry = { id, name };
    if (model.contextWindow !== undefined) entry.contextWindow = model.contextWindow;
    if (Array.isArray(model.input) && model.input.length > 0) entry.input = model.input;
    if (model.reasoning === true) entry.reasoning = true;
    next.push(entry);
    added += 1;
  }

  return { models: next, added, changed: added > 0 };
};

const resolveModelsFileForSync = ({ home, directory, scope } = {}) => {
  if (scope === 'project') {
    if (typeof directory !== 'string' || !directory.trim()) {
      throw httpError(400, 'Working directory is required for project scope', 'invalid');
    }
    return path.join(directory.trim(), '.pi', 'models.json');
  }
  return resolvePiModelsPath(home);
};

const findProviderModelsFile = ({ home, directory, providerId, scope } = {}) => {
  if (scope === 'user' || scope === 'project') {
    return resolveModelsFileForSync({ home, directory, scope });
  }
  if (typeof directory === 'string' && directory.trim()) {
    const projectPath = path.join(directory.trim(), '.pi', 'models.json');
    const projectProviders = providerMapFromModels(readJsonObjectFile(projectPath));
    if (Object.prototype.hasOwnProperty.call(projectProviders, providerId)) {
      return projectPath;
    }
  }
  return resolvePiModelsPath(home);
};

/**
 * Fetch upstream /v1/models for a custom provider and persist new ids into models.json.
 * Non-destructive on failure or empty list. Does not touch hiddenModels.
 */
export const syncCustomProviderRemoteModels = async ({
  home = os.homedir(),
  directory,
  providerId,
  scope,
  apiKey,
  headers,
  env = process.env,
} = {}, { fetchImpl = globalThis.fetch } = {}) => {
  const id = typeof providerId === 'string' ? providerId.trim() : '';
  if (!id || !PROVIDER_ID_PATTERN.test(id)) {
    throw httpError(400, 'Provider ID must match /^[a-z0-9][a-z0-9-_]*$/', 'invalid');
  }
  if (BUILTIN_SKIP_SYNC_IDS.has(id)) {
    return { synced: false, skipped: true, reason: 'builtin', providerId: id, models: [] };
  }

  const filePath = findProviderModelsFile({ home, directory, providerId: id, scope });
  const current = readJsonObjectFile(filePath);
  const providers = { ...providerMapFromModels(current) };
  const provider = providers[id];
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
    throw httpError(404, 'Custom provider not found in models.json', 'invalid');
  }
  const baseURL = typeof provider.baseUrl === 'string' ? provider.baseUrl.trim() : '';
  if (!baseURL) {
    return { synced: false, skipped: true, reason: 'not-custom', providerId: id, models: Array.isArray(provider.models) ? provider.models : [] };
  }

  const localModels = Array.isArray(provider.models) ? provider.models : [];
  // Prefer an explicit key; otherwise reuse models.json `$VAR` / `{env:VAR}` so
  // env-backed custom providers sync without an auth.json row.
  let resolvedApiKey = typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : '';
  if (!resolvedApiKey && typeof provider.apiKey === 'string' && provider.apiKey.trim()) {
    const stored = provider.apiKey.trim();
    if (stored.startsWith('$') && stored.length > 1) {
      resolvedApiKey = `{env:${stored.slice(1)}}`;
    } else if (stored.startsWith('{env:')) {
      resolvedApiKey = stored;
    }
  }
  let remote;
  try {
    remote = await fetchRemoteProviderModels({
      home,
      baseURL,
      apiKey: resolvedApiKey || undefined,
      headers: headers || provider.headers,
      providerID: id,
      env,
    }, { fetchImpl });
  } catch (error) {
    const status = Number(error?.status) || 502;
    const code = error?.code || 'upstream';
    const err = httpError(status, error?.message || 'Could not sync models', code);
    err.previousModels = localModels;
    throw err;
  }

  const remoteModels = Array.isArray(remote?.models) ? remote.models : [];
  if (remoteModels.length === 0) {
    return {
      synced: false,
      skipped: false,
      reason: 'empty',
      providerId: id,
      models: localModels,
      path: filePath,
    };
  }

  const merged = mergeRemoteModelsIntoCatalog(localModels, remoteModels);
  if (merged.changed) {
    providers[id] = { ...provider, models: merged.models };
    writeJsonObjectFile(filePath, { ...current, providers });
  }

  return {
    synced: true,
    skipped: false,
    providerId: id,
    models: merged.models,
    added: merged.added,
    changed: merged.changed,
    path: filePath,
  };
};

export const handleSyncCustomProviderRemoteModels = async (req, res, {
  home = os.homedir(),
  directory,
  providerId,
  fetchImpl,
} = {}) => {
  try {
    const id = providerId
      || req.params?.providerId
      || req.params?.providerID
      || req.body?.providerID
      || req.body?.providerId;
    const result = await syncCustomProviderRemoteModels({
      home,
      directory,
      providerId: id,
      scope: typeof req.body?.scope === 'string' ? req.body.scope
        : (typeof req.query?.scope === 'string' ? req.query.scope : undefined),
      apiKey: req.body?.apiKey,
      headers: req.body?.headers,
    }, { fetchImpl });
    res.status(200).json({
      success: true,
      ...result,
      // Never echo credentials
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    res.status(status).json({
      error: error.code || 'upstream',
      message: error.message || 'Could not sync models',
    });
  }
};
