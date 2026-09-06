import fs from 'node:fs';

import { listConfiguredPiPackageSources, readFeaturePlugins, toFeaturePluginsPayload } from './feature-plugins.js';
import { listPiProviderPublicConfigs, readZaiProviderRegion, resolvePiAuthPath } from './pi-resources.js';

const ZAI_DOMESTIC_USAGE_ORIGIN = 'https://open.bigmodel.cn';
const USAGE_PATH = '/api/monitor/usage/quota/limit';
const MAX_USAGE_BODY_BYTES = 64 * 1024;
const USAGE_TIMEOUT_MS = 15_000;
const FIVE_HOUR_SECONDS = 5 * 60 * 60;
const MONTH_SECONDS = 30 * 24 * 60 * 60;
const PROVIDER_NAME = '智谱 / Z.AI';

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const readJsonObject = (filePath, readFile) => {
  try { const parsed = JSON.parse(readFile(filePath)); return isRecord(parsed) ? parsed : {}; } catch { return {}; }
};

export const isZaiSlotActive = (payload) => Boolean(payload?.slots?.zai?.installed && payload?.slots?.zai?.enabled);

const readApiKey = (entry) => {
  if (!isRecord(entry) || String(entry.type || '').toLowerCase() === 'oauth') return '';
  const key = typeof entry.key === 'string' ? entry.key : typeof entry.apiKey === 'string' ? entry.apiKey : typeof entry.token === 'string' ? entry.token : '';
  return key.trim();
};

const readProviderDisplayName = (home) => {
  try {
    const name = listPiProviderPublicConfigs({ home }).zai?.name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  } catch { /* optional provider overlay */ }
  return PROVIDER_NAME;
};

const parseNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};
const normalizeTimestamp = (value) => {
  const number = parseNumber(value);
  return number == null ? null : (number < 1_000_000_000_000 ? number * 1000 : number);
};
const resolveTokenWindowSeconds = (limit) => {
  const unit = parseNumber(limit?.unit); const number = parseNumber(limit?.number);
  if (unit === 3 && number != null) return number * 60 * 60;
  if (unit === 6 && number != null) return number * 24 * 60 * 60;
  return FIVE_HOUR_SECONDS;
};
const toUsageWindow = ({ usedPercent, windowSeconds, resetAt }) => {
  const percent = typeof usedPercent === 'number' && Number.isFinite(usedPercent) ? Math.max(0, Math.min(100, usedPercent)) : null;
  return { usedPercent: percent, remainingPercent: percent == null ? null : 100 - percent, windowSeconds: windowSeconds ?? null, resetAfterSeconds: typeof resetAt === 'number' ? Math.max(0, Math.floor((resetAt - Date.now()) / 1000)) : null, resetAt: typeof resetAt === 'number' ? resetAt : null, resetAtFormatted: null, resetAfterFormatted: null };
};

export const mapZaiLimitsToWindows = (payload) => {
  const limits = Array.isArray(payload?.data?.limits) ? payload.data.limits : Array.isArray(payload?.limits) ? payload.limits : [];
  const windows = {};
  const tokens = limits.find((limit) => limit?.type === 'TOKENS_LIMIT');
  if (tokens) windows['5h'] = toUsageWindow({ usedPercent: parseNumber(tokens.percentage), windowSeconds: resolveTokenWindowSeconds(tokens), resetAt: normalizeTimestamp(tokens.nextResetTime) });
  const time = limits.find((limit) => limit?.type === 'TIME_LIMIT');
  if (time) windows['MCP Tools'] = toUsageWindow({ usedPercent: parseNumber(time.percentage), windowSeconds: MONTH_SECONDS, resetAt: normalizeTimestamp(time.nextResetTime) });
  return Object.keys(windows).length > 0 ? windows : null;
};

const readBoundedJson = async (response) => {
  const text = await response.text();
  if (text.length > MAX_USAGE_BODY_BYTES) throw new Error('Z.AI usage response was too large');
  try { return JSON.parse(text); } catch { throw new Error('Z.AI usage returned invalid JSON (HTTP ' + response.status + ')'); }
};
const withTimeout = async (work) => {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), USAGE_TIMEOUT_MS);
  try { return await work(controller.signal); } catch (error) { if (controller.signal.aborted) throw new Error('Z.AI usage request timed out'); throw error; } finally { clearTimeout(timer); }
};
const usageRequestFailed = (status) => { const error = new Error('Z.AI usage lookup failed (HTTP ' + status + ')'); error.status = status >= 400 && status < 600 ? status : 502; return error; };

export const getPiZaiUsage = async ({ home, providerId = 'zai', fetchImpl = fetch, readFile = (filePath) => fs.readFileSync(filePath, 'utf8') } = {}) => {
  const payload = toFeaturePluginsPayload({ plugins: readFeaturePlugins(home), configuredSources: listConfiguredPiPackageSources(home) });
  if (!isZaiSlotActive(payload)) return { ok: false, configured: false, slotActive: false };
  const auth = readJsonObject(resolvePiAuthPath(home), readFile);
  const apiKey = readApiKey(providerId === 'zai' || !providerId ? auth.zai : auth[providerId]);
  const providerName = readProviderDisplayName(home);
  const region = readZaiProviderRegion(home, providerId);
  if (!apiKey) return { ok: false, configured: false, slotActive: true, providerId, providerName, region };
  if (region !== 'domestic') return { ok: false, configured: true, slotActive: true, providerId, providerName, region: 'international', usageUnavailable: true, error: 'Z.AI usage is not available for the international region', usage: null, fetchedAt: Date.now() };
  try {
    const windows = await withTimeout(async (signal) => {
      const response = await fetchImpl(ZAI_DOMESTIC_USAGE_ORIGIN + USAGE_PATH, { method: 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer ' + apiKey }, redirect: 'error', signal });
      if (!response.ok) throw usageRequestFailed(response.status);
      const mapped = mapZaiLimitsToWindows(await readBoundedJson(response));
      if (!mapped) throw new Error('Z.AI usage response had no usable limits');
      return mapped;
    });
    return { ok: true, configured: true, slotActive: true, providerId, providerName, region: 'domestic', usage: { windows }, fetchedAt: Date.now() };
  } catch (error) {
    return { ok: false, configured: true, slotActive: true, providerId, providerName, region: 'domestic', error: error instanceof Error ? error.message : 'Z.AI usage request failed', usage: null, fetchedAt: Date.now() };
  }
};
