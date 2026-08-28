import fs from 'node:fs';

import {
  listConfiguredPiPackageSources,
  readFeaturePlugins,
  toFeaturePluginsPayload,
} from './feature-plugins.js';
import {
  XAI_PROVIDER_ID,
  resolvePiAuthPath,
  writePiProviderAuth,
} from './pi-resources.js';
import { refreshPiXaiOAuth } from './xai-oauth.js';

const XAI_USAGE_ORIGIN = 'https://cli-chat-proxy.grok.com';
const MAX_USAGE_BODY_BYTES = 64 * 1024;
const USAGE_TIMEOUT_MS = 15_000;
const REFRESH_SKEW_MS = 5 * 60 * 1000;

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readJsonObject = (filePath, readFile) => {
  try {
    const parsed = JSON.parse(readFile(filePath));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const isXaiSlotActive = (payload) => Boolean(
  payload?.slots?.xai?.installed && payload?.slots?.xai?.enabled,
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

const firstNumber = (record, keys) => {
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
    const number = unwrapNumber(current);
    if (number != null) return number;
  }
  return null;
};

const productUsagePercent = (record) => {
  if (!Array.isArray(record.productUsage)) return null;
  const percents = record.productUsage
    .filter((entry) => isRecord(entry))
    .map((entry) => ({
      product: typeof entry.product === 'string' ? entry.product : '',
      percent: unwrapNumber(entry.usagePercent),
    }))
    .filter((entry) => entry.percent != null && entry.percent >= 0 && entry.percent <= 100);
  const preferred = percents.find((entry) => entry.product === 'GrokChat')
    || percents.find((entry) => entry.product === 'GrokBuild')
    || percents[0];
  return preferred?.percent ?? null;
};

const firstTime = (record, keys) => {
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

const formatCreditPair = (used, limit) => {
  if (used == null || limit == null) return undefined;
  return `${used} / ${limit}`;
};

export const mapXaiBillingToWindows = (billing) => {
  if (!isRecord(billing)) return null;
  const record = isRecord(billing.config) ? billing.config : billing;
  const includedPercent = firstNumber(record, [
    'creditUsagePercent',
    'credit_usage_percent',
    'includedUsagePercent',
    'included_usage_percent',
    'includedPercent',
    'usagePercent',
    'percentUsed',
    'included.usagePercent',
    'included.percent',
  ]) ?? productUsagePercent(record);
  const used = firstNumber(record, [
    'includedUsed',
    'included_used',
    'usedCredits',
    'used',
    'included.used',
    'included.usedCredits',
  ]);
  const limit = firstNumber(record, [
    'includedLimit',
    'included_limit',
    'includedCredits',
    'monthlyLimit',
    'included.limit',
    'included.credits',
  ]);
  const onDemandUsed = firstNumber(record, ['onDemandUsed', 'on_demand_used']);
  const onDemandCap = firstNumber(record, ['onDemandCap', 'on_demand_cap']);
  const resetAt = firstTime(record, [
    'currentPeriod.end',
    'billingPeriodEnd',
    'billing_period_end',
    'resetTime',
    'reset_time',
    'resetAt',
    'reset_at',
    'currentResetTime',
    'included.resetTime',
    'included.resetAt',
  ]);
  let usedPercent = includedPercent;
  if (usedPercent == null && used != null && limit != null && limit > 0) {
    usedPercent = (used / limit) * 100;
  }
  if (usedPercent == null && onDemandUsed != null && onDemandCap != null && onDemandCap > 0) {
    usedPercent = (onDemandUsed / onDemandCap) * 100;
  }
  const valueUsed = used != null && limit != null && limit > 0
    ? used
    : (onDemandCap != null && onDemandCap > 0 ? onDemandUsed : used);
  const valueLimit = used != null && limit != null && limit > 0
    ? limit
    : (onDemandCap != null && onDemandCap > 0 ? onDemandCap : limit);
  if (usedPercent == null && resetAt == null) return null;
  return {
    billing_cycle: toUsageWindow({
      usedPercent,
      windowSeconds: null,
      resetAt,
      valueLabel: formatCreditPair(valueUsed, valueLimit),
    }),
  };
};

const readBoundedJson = async (response) => {
  const text = await response.text();
  if (text.length > MAX_USAGE_BODY_BYTES) {
    throw new Error('xAI usage response was too large');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`xAI usage returned invalid JSON (HTTP ${response.status})`);
  }
  return parsed;
};

const usageRequestFailed = (action, status) => {
  const error = new Error(`xAI ${action} failed (HTTP ${status})`);
  error.status = status >= 400 && status < 600 ? status : 502;
  return error;
};

const fetchXaiBillingWindows = async ({
  access,
  fetchImpl = fetch,
  origin = XAI_USAGE_ORIGIN,
  signal,
} = {}) => {
  const token = typeof access === 'string' ? access.trim() : '';
  if (!token) {
    const error = new Error('xAI OAuth access token is missing');
    error.status = 400;
    throw error;
  }
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const billingResponse = await fetchImpl(`${origin}/v1/billing?format=credits`, {
    method: 'GET',
    headers,
    redirect: 'error',
    signal,
  });
  if (!billingResponse.ok) {
    throw usageRequestFailed('billing lookup', billingResponse.status);
  }
  const billing = await readBoundedJson(billingResponse);
  const windows = mapXaiBillingToWindows(billing);
  if (!windows) {
    throw new Error('xAI billing response had no usable current-period usage');
  }
  return windows;
};

const withTimeout = async (work, timeoutMs = USAGE_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await work(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('xAI usage request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const persistRefreshedOauth = (credential, home) => {
  try {
    writePiProviderAuth(XAI_PROVIDER_ID, credential, { home });
  } catch {
    // Still use the refreshed access for this request.
  }
};

const refreshOauthCredential = async (oauth, {
  home,
  refreshOAuth = refreshPiXaiOAuth,
  signal,
}) => {
  const credential = await refreshOAuth({
    type: 'oauth',
    access: oauth.access,
    refresh: oauth.refresh,
    expires: oauth.expires,
  }, { signal });
  persistRefreshedOauth(credential, home);
  const next = readOauthEntry(credential);
  if (!next?.access) {
    const error = new Error('xAI OAuth refresh returned no access token');
    error.status = 401;
    throw error;
  }
  return next;
};

export const getPiXaiUsage = async ({
  home,
  fetchImpl = fetch,
  origin = XAI_USAGE_ORIGIN,
  readFile = (filePath) => fs.readFileSync(filePath, 'utf8'),
  refreshOAuth = refreshPiXaiOAuth,
  now = Date.now(),
} = {}) => {
  const payload = toFeaturePluginsPayload({
    plugins: readFeaturePlugins(home),
    configuredSources: listConfiguredPiPackageSources(home),
  });
  const slotActive = isXaiSlotActive(payload);
  if (!slotActive) {
    return { ok: false, configured: false, slotActive: false };
  }
  const auth = readJsonObject(resolvePiAuthPath(home), readFile);
  let oauth = readOauthEntry(auth[XAI_PROVIDER_ID]);
  if (!oauth) {
    return { ok: false, configured: false, slotActive: true };
  }
  try {
    const windows = await withTimeout(async (signal) => {
      if (oauthNeedsRefresh(oauth, now)) {
        oauth = await refreshOauthCredential(oauth, { home, refreshOAuth, signal });
      }
      try {
        return await fetchXaiBillingWindows({
          access: oauth.access,
          fetchImpl,
          origin,
          signal,
        });
      } catch (error) {
        if (!isUnauthorizedUsageError(error) || !oauth.refresh) throw error;
        oauth = await refreshOauthCredential(oauth, { home, refreshOAuth, signal });
        return fetchXaiBillingWindows({
          access: oauth.access,
          fetchImpl,
          origin,
          signal,
        });
      }
    });
    return {
      ok: true,
      configured: true,
      slotActive: true,
      providerId: XAI_PROVIDER_ID,
      providerName: 'xAI',
      expires: oauth.expires,
      usage: { windows },
      fetchedAt: Date.now(),
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      slotActive: true,
      providerId: XAI_PROVIDER_ID,
      providerName: 'xAI',
      expires: oauth.expires,
      error: error instanceof Error ? error.message : 'xAI usage request failed',
      usage: null,
      fetchedAt: Date.now(),
    };
  }
};
