import {
  KIMI_CODE_BASE_URL,
  KIMI_CODING_PROVIDER_ID,
  XAI_BASE_URL,
  XAI_PROVIDER_ID,
  kimiBaseUrlForRegion,
  listStoredProviderIds,
  mergePiProviderOverlay,
  nextSubscriptionCloneId,
  readKimiRegion,
  subscriptionFamilyOf,
} from './pi-resources.js';
import { isDualAuthApiSiblingId, loadDualAuthApiModels, dualAuthSpecFor } from './pi-dual-auth.js';

const serializeRuntimeModels = (models) => {
  if (!Array.isArray(models)) return [];
  const next = [];
  for (const model of models) {
    if (!model || typeof model !== 'object') continue;
    const id = typeof model.id === 'string' ? model.id.trim() : '';
    if (!id) continue;
    const name = typeof model.name === 'string' && model.name.trim() ? model.name.trim() : id;
    const contextWindow = Number(model.contextWindow);
    const maxTokens = Number(model.maxTokens);
    const input = Array.isArray(model.input)
      ? model.input.filter((item) => item === 'text' || item === 'image')
      : undefined;
    next.push({
      id,
      name,
      ...(Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow: Math.round(contextWindow) } : {}),
      ...(Number.isFinite(maxTokens) && maxTokens > 0 ? { maxTokens: Math.round(maxTokens) } : {}),
      ...(input && input.length > 0 ? { input } : {}),
      ...(model.reasoning === true ? { reasoning: true } : {}),
      ...(typeof model.api === 'string' && model.api.trim() ? { api: model.api.trim() } : {}),
    });
  }
  return next;
};

const familySeed = (family) => {
  if (family === KIMI_CODING_PROVIDER_ID) {
    const spec = dualAuthSpecFor(KIMI_CODING_PROVIDER_ID);
    return {
      name: 'Kimi Code',
      baseUrl: KIMI_CODE_BASE_URL,
      api: 'anthropic-messages',
      models: spec ? loadDualAuthApiModels(spec) : [],
    };
  }
  const spec = dualAuthSpecFor(XAI_PROVIDER_ID);
  return {
    name: 'xAI / Grok',
    baseUrl: XAI_BASE_URL,
    api: 'openai-completions',
    models: spec ? loadDualAuthApiModels(spec) : [],
  };
};

const modelsFromRuntime = (runtime, family) => {
  if (!runtime || typeof runtime.getProvider !== 'function') return [];
  try {
    const provider = runtime.getProvider(family);
    const models = typeof provider?.getModels === 'function' ? provider.getModels() : [];
    return serializeRuntimeModels(models);
  } catch {
    return [];
  }
};

export const listSubscriptionCloneIds = (home) => listStoredProviderIds(home).filter((id) => {
  const family = subscriptionFamilyOf(id);
  return Boolean(family) && id !== family && !isDualAuthApiSiblingId(id);
});

const cloneNativeSubscriptionProvider = (runtime, {
  id,
  family,
  name,
  baseUrl,
} = {}) => {
  if (!runtime || typeof runtime.getProvider !== 'function' || typeof runtime.registerNativeProvider !== 'function') {
    return false;
  }
  const base = runtime.getProvider(family);
  if (!base) return false;
  runtime.registerNativeProvider({
    ...base,
    id,
    name: name || base.name,
    baseUrl: baseUrl || base.baseUrl,
    getModels: () => {
      const models = typeof base.getModels === 'function' ? base.getModels() : [];
      return (Array.isArray(models) ? models : []).map((model) => ({
        ...model,
        provider: id,
        baseUrl: baseUrl || model.baseUrl,
      }));
    },
  });
  return true;
};

export const registerSubscriptionCloneProviders = (runtime, { home } = {}) => {
  if (!runtime) return [];
  const registered = [];
  for (const id of listSubscriptionCloneIds(home)) {
    const family = subscriptionFamilyOf(id);
    if (!family) continue;
    if (cloneNativeSubscriptionProvider(runtime, { id, family })) {
      registered.push(id);
    }
  }
  return registered;
};

export const createSubscriptionClone = ({
  home,
  family,
  displayName,
  runtime,
} = {}) => {
  const resolvedFamily = subscriptionFamilyOf(family) === family ? family : null;
  if (!resolvedFamily) {
    const error = new Error('family must be xai or kimi-coding');
    error.status = 400;
    throw error;
  }
  const existing = listStoredProviderIds(home);
  const hasRoot = existing.includes(resolvedFamily);
  if (!hasRoot) {
    const error = new Error(`Connect ${resolvedFamily} before adding another subscription`);
    error.status = 400;
    throw error;
  }
  const providerId = nextSubscriptionCloneId(resolvedFamily, existing);
  const seed = familySeed(resolvedFamily);
  const models = modelsFromRuntime(runtime, resolvedFamily);
  const name = typeof displayName === 'string' && displayName.trim()
    ? displayName.trim()
    : `${seed.name} ${providerId.slice(resolvedFamily.length + 1)}`;
  const overlay = mergePiProviderOverlay({
    home,
    providerId,
    overlay: {
      name,
      baseUrl: seed.baseUrl,
      api: seed.api,
      models: models.length > 0 ? models : seed.models,
    },
  });
  cloneNativeSubscriptionProvider(runtime, {
    id: providerId,
    family: resolvedFamily,
    name,
    baseUrl: seed.baseUrl,
  });
  return {
    providerId,
    family: resolvedFamily,
    name,
    baseUrl: seed.baseUrl,
    config: overlay.config,
  };
};

export const patchSubscriptionClone = ({
  home,
  providerId,
  displayName,
  region,
} = {}) => {
  const id = typeof providerId === 'string' ? providerId.trim() : '';
  const family = subscriptionFamilyOf(id);
  if (!family && id !== 'kimi-coding-api') {
    const error = new Error('Not an official Grok or Kimi subscription');
    error.status = 400;
    throw error;
  }
  const overlay = {};
  if (typeof displayName === 'string' && displayName.trim()) {
    overlay.name = displayName.trim();
  }
  if (id === 'kimi-coding-api' && (region === 'domestic' || region === 'international')) {
    overlay.baseUrl = kimiBaseUrlForRegion(region);
  }
  if (Object.keys(overlay).length === 0) {
    const error = new Error('displayName or region is required');
    error.status = 400;
    throw error;
  }
  if (overlay.name && !overlay.baseUrl) {
    overlay.baseUrl = family === XAI_PROVIDER_ID
      ? XAI_BASE_URL
      : (id === 'kimi-coding-api' ? kimiBaseUrlForRegion(readKimiRegion(home)) : familySeed(KIMI_CODING_PROVIDER_ID).baseUrl);
  }
  return mergePiProviderOverlay({ home, providerId: id, overlay });
};

