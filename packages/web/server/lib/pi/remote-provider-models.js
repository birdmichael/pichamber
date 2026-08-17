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
  if (!Array.isArray(value)) return undefined;
  const next = [];
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const token = entry.trim().toLowerCase();
    if (!PI_MODEL_INPUT_TYPES.has(token) || seen.has(token)) continue;
    seen.add(token);
    next.push(token);
  }
  return next.length > 0 ? next : undefined;
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
    models.push({
      id,
      name,
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(input !== undefined ? { input } : {}),
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
