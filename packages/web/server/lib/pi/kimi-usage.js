import fs from 'node:fs';

import {
  listConfiguredPiPackageSources,
  readFeaturePlugins,
  toFeaturePluginsPayload,
} from './feature-plugins.js';
import {
  KIMI_CODING_PROVIDER_ID,
  isKimiSubscriptionId,
  listPiProviderPublicConfigs,
  resolvePiAuthPath,
  writePiProviderAuth,
} from './pi-resources.js';
import { refreshPiKimiOAuth } from './kimi-oauth.js';

const KIMI_USAGE_ORIGIN = 'https://api.kimi.com';
const MAX_USAGE_BODY_BYTES = 64 * 1024;
const USAGE_TIMEOUT_MS = 15_000;
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const FIVE_HOUR_SECONDS = 5 * 60 * 60;
const WEEKLY_SECONDS = 7 * 24 * 60 * 60;
const PROVIDER_NAME = 'Kimi Code';

const readProviderDisplayName = (home, providerId) => {
  try {
    const name = listPiProviderPublicConfigs({ home })[providerId]?.name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  } catch {
    // Overlay is optional; fall back to the catalog name.
  }
  return PROVIDER_NAME;
};

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readJsonObject = (filePath, readFile) => {
  try {
    const parsed = JSON.parse(readFile(filePath));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const isKimiSlotActive = (payload) => Boolean(
  payload?.slots?.kimi?.installed && payload?.slots?.kimi?.enabled,
);

const readOauthEntry = (entry) => {
  if (!isRecord(entry) || String(entry.type || '').toLowerCase() !== 'oauth') return null;
  const access = typeof entry.access === 'string' ? entry.access.trim() : '';
  const refresh = typeof entry.refresh === 'string' ? entry.refresh.trim() : '';
  if (!access && !refresh) return null;
  const expires = Number(entry.expires);
  return {
    access,
    refresh,
    expires: Number.isFinite(expires) ? expires : null,
  };
};

const readApiKey = (entry) => {
  if (!isRecord(entry)) return '';
  const type = String(entry.type || '').toLowerCase();
  if (type === 'oauth') return '';
  const key = typeof entry.key === 'string' ? entry.key.trim()
    : typeof entry.apiKey === 'string' ? entry.apiKey.trim()
    : typeof entry.token === 'string' ? entry.token.trim()
    : '';
  return key;
};

const oauthNeedsRefresh = (oauth, now) => {
  if (!oauth?.refresh) return false;
  if (!oauth.access) return true;
  return oauth.expires != null && oauth.expires <= now + REFRESH_SKEW_MS;
};

const isUnauthorizedUsageError = (error) => {
  const status = Number(error?.status);
  if (status === 401 || status === 403) return true;
  const message = error instanceof Error ? error.message : String(error || '');
  return /\b(401|403|unauthorized|invalid_grant)\b/i.test(message);
};

const toUsageWindow = ({ usedPercent, windowSeconds, resetAt, valueLabel } = {}) => {
  const hasFiniteUsed = typeof usedPercent === 'number' && Number.isFinite(usedPercent);
  const resetAtTime = typeof resetAt === 'number' && Number.isFinite(resetAt) ? resetAt : null;
  const resetAfterSeconds = resetAtTime == null
    ? null
    : Math.max(0, Math.floor((resetAtTime - Date.now()) / 1000));
  return {
    usedPercent: hasFiniteUsed ? usedPercent : null,
    remainingPercent: hasFiniteUsed ? Math.max(0, 100 - usedPercent) : null,
    windowSeconds: windowSeconds ?? null,
    resetAfterSeconds,
    resetAt: resetAtTime,
    resetAtFormatted: null,
    resetAfterFormatted: null,
    ...(valueLabel ? { valueLabel } : {}),
  };
};

const unwrapNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  if (isRecord(value)) {
    if (typeof value.val === 'number' && Number.isFinite(value.val)) return value.val;
    if (typeof value.val === 'string' && value.val.trim() && Number.isFinite(Number(value.val))) {
      return Number(value.val);
    }
  }
  return null;
};

const firstTime = (record, keys) => {
  if (!isRecord(record)) return null;
  for (const key of keys) {
    const parts = key.split('.');
    let current = record;
    for (const part of parts) {
      if (!isRecord(current)) {
        current = undefined;
        break;
      }
      current = current[part];
    }
    if (typeof current === 'number' && Number.isFinite(current)) {
      return current < 1e12 ? current * 1000 : current;
    }
    if (typeof current === 'string' && current.trim()) {
      const ms = Date.parse(current);
      if (Number.isFinite(ms)) return ms;
    }
  }
  return null;
};

const computeUsedPercent = (limit, used, remaining) => {
  if (limit == null || limit <= 0) return null;
  if (used != null) {
    // Limit already normalized to 100 means used is already a percent.
    if (limit === 100) return Math.max(0, Math.min(100, used));
    return Math.max(0, Math.min(100, (used / limit) * 100));
  }
  if (remaining != null) {
    return Math.max(0, Math.min(100, 100 - (remaining / limit) * 100));
  }
  return null;
};

const isFiveHourWindow = (window) => {
  if (!isRecord(window)) return false;
  return unwrapNumber(window.duration) === 300 && window.timeUnit === 'TIME_UNIT_MINUTE';
};

const readMembershipLevel = (payload) => {
  const level = isRecord(payload?.user) && isRecord(payload.user.membership)
    ? payload.user.membership.level
    : null;
  if (typeof level !== 'string') return undefined;
  const trimmed = level.trim();
  return trimmed || undefined;
};

export const mapKimiUsagesToWindows = (payload) => {
  if (!isRecord(payload)) return null;
  const windows = {};
  const usage = isRecord(payload.usage) ? payload.usage : null;
  if (usage) {
    const limit = unwrapNumber(usage.limit);
    const used = unwrapNumber(usage.used);
    const remaining = unwrapNumber(usage.remaining);
    windows.weekly = toUsageWindow({
      usedPercent: computeUsedPercent(limit, used, remaining),
      windowSeconds: WEEKLY_SECONDS,
      resetAt: firstTime(usage, ['resetTime', 'reset_time', 'resetAt']),
    });
  }

  const limits = Array.isArray(payload.limits) ? payload.limits : [];
  for (const item of limits) {
    if (!isRecord(item)) continue;
    const window = isRecord(item.window) ? item.window : null;
    if (!window || !isFiveHourWindow(window)) continue;
    const detail = isRecord(item.detail) ? item.detail : null;
    if (!detail) {
      windows['5h'] = toUsageWindow({
        usedPercent: 0,
        windowSeconds: FIVE_HOUR_SECONDS,
        resetAt: null,
      });
      continue;
    }
    const limit = unwrapNumber(detail.limit);
    const used = unwrapNumber(detail.used);
    const remaining = unwrapNumber(detail.remaining);
    const usedPercent = computeUsedPercent(limit, used, remaining);
    windows['5h'] = toUsageWindow({
      usedPercent: usedPercent == null ? 0 : usedPercent,
      windowSeconds: FIVE_HOUR_SECONDS,
      resetAt: firstTime(detail, ['resetTime', 'reset_time', 'resetAt']),
    });
  }

  if (Object.keys(windows).length === 0) return null;
  return windows;
};

const readBoundedJson = async (response) => {
  const text = await response.text();
  if (text.length > MAX_USAGE_BODY_BYTES) {
    throw new Error('Kimi Code usage response was too large');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Kimi Code usage returned invalid JSON (HTTP ${response.status})`);
  }
  return parsed;
};

const usageRequestFailed = (action, status) => {
  const error = new Error(`Kimi Code ${action} failed (HTTP ${status})`);
  error.status = status >= 400 && status < 600 ? status : 502;
  return error;
};

const fetchKimiUsageWindows = async ({
  access,
  fetchImpl = fetch,
  origin = KIMI_USAGE_ORIGIN,
  signal,
} = {}) => {
  const token = typeof access === 'string' ? access.trim() : '';
  if (!token) {
    const error = new Error('Kimi Code access token is missing');
    error.status = 400;
    throw error;
  }
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const usageResponse = await fetchImpl(`${origin}/coding/v1/usages`, {
    method: 'GET',
    headers,
    redirect: 'error',
    signal,
  });
  if (!usageResponse.ok) {
    throw usageRequestFailed('usage lookup', usageResponse.status);
  }
  const payload = await readBoundedJson(usageResponse);
  const windows = mapKimiUsagesToWindows(payload);
  if (!windows) {
    throw new Error('Kimi Code usage response had no usable windows');
  }
  return { windows, membershipLevel: readMembershipLevel(payload) };
};

const withTimeout = async (work, timeoutMs = USAGE_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await work(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Kimi Code usage request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const persistRefreshedOauth = (credential, home, providerId = KIMI_CODING_PROVIDER_ID) => {
  try {
    writePiProviderAuth(providerId, credential, { home });
  } catch {
    // Still use the refreshed access for this request.
  }
};

const refreshOauthCredential = async (oauth, {
  home,
  providerId = KIMI_CODING_PROVIDER_ID,
  refreshOAuth = refreshPiKimiOAuth,
  signal,
}) => {
  const credential = await refreshOAuth({
    type: 'oauth',
    access: oauth.access,
    refresh: oauth.refresh,
    expires: oauth.expires,
  }, { signal });
  persistRefreshedOauth(credential, home, providerId);
  const next = readOauthEntry(credential);
  if (!next?.access) {
    const error = new Error('Kimi Code OAuth refresh returned no access token');
    error.status = 401;
    throw error;
  }
  return next;
};

export const getPiKimiUsage = async ({
  home,
  providerId,
  fetchImpl = fetch,
  origin = KIMI_USAGE_ORIGIN,
  readFile = (filePath) => fs.readFileSync(filePath, 'utf8'),
  refreshOAuth = refreshPiKimiOAuth,
  now = Date.now(),
} = {}) => {
  const usageProviderId = isKimiSubscriptionId(providerId) ? providerId : KIMI_CODING_PROVIDER_ID;
  const payload = toFeaturePluginsPayload({
    plugins: readFeaturePlugins(home),
    configuredSources: listConfiguredPiPackageSources(home),
  });
  const slotActive = isKimiSlotActive(payload);
  if (!slotActive) {
    return { ok: false, configured: false, slotActive: false };
  }
  const auth = readJsonObject(resolvePiAuthPath(home), readFile);
  let oauth = readOauthEntry(auth[usageProviderId]);
  const apiKey = readApiKey(auth[usageProviderId]);
  if (!oauth && !apiKey) {
    return { ok: false, configured: false, slotActive: true };
  }
  try {
    const { windows, membershipLevel } = await withTimeout(async (signal) => {
      if (oauth) {
        if (oauthNeedsRefresh(oauth, now)) {
          oauth = await refreshOauthCredential(oauth, { home, providerId: usageProviderId, refreshOAuth, signal });
        }
        try {
          return await fetchKimiUsageWindows({
            access: oauth.access,
            fetchImpl,
            origin,
            signal,
          });
        } catch (error) {
          if (!isUnauthorizedUsageError(error) || !oauth.refresh) throw error;
          oauth = await refreshOauthCredential(oauth, { home, providerId: usageProviderId, refreshOAuth, signal });
          return fetchKimiUsageWindows({
            access: oauth.access,
            fetchImpl,
            origin,
            signal,
          });
        }
      }
      return fetchKimiUsageWindows({
        access: apiKey,
        fetchImpl,
        origin,
        signal,
      });
    });
    return {
      ok: true,
      configured: true,
      slotActive: true,
      providerId: usageProviderId,
      providerName: readProviderDisplayName(home, usageProviderId),
      expires: oauth?.expires ?? null,
      usage: { windows },
      ...(membershipLevel ? { membershipLevel } : {}),
      fetchedAt: Date.now(),
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      slotActive: true,
      providerId: usageProviderId,
      providerName: readProviderDisplayName(home, usageProviderId),
      expires: oauth?.expires ?? null,
      error: error instanceof Error ? error.message : 'Kimi Code usage request failed',
      usage: null,
      fetchedAt: Date.now(),
    };
  }
};
