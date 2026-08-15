import fs from 'fs';
import os from 'os';

import { isPiKernelEnabled } from '../pi/kernel.js';
import {
  readPiDefaults,
  resolvePiAuthPath,
  resolvePiModelsPath,
} from '../pi/pi-resources.js';
import { parseModelRef } from './resolve.js';

const DEFAULT_CONTEXT_TOKENS = 64_000;
const DEFAULT_OUTPUT_TOKENS = 16_384;

let modelRuntimePromise = null;

const readJsonObject = (filePath) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

const firstModelFromProvider = (provider) => {
  if (!provider || typeof provider !== 'object') return null;
  if (Array.isArray(provider.models)) {
    const first = provider.models.find((model) => model && typeof model.id === 'string' && model.id);
    return first || null;
  }
  if (provider.models && typeof provider.models === 'object') {
    const first = Object.values(provider.models).find((model) => model && typeof model.id === 'string' && model.id);
    return first || null;
  }
  return null;
};

const findModelEntry = (providers, providerID, modelID) => {
  const provider = providers[providerID];
  if (!provider) return null;
  if (Array.isArray(provider.models)) {
    return provider.models.find((model) => model && model.id === modelID) || null;
  }
  if (provider.models && typeof provider.models === 'object') {
    return provider.models[modelID] || null;
  }
  return null;
};

const envNameFromApiKeyRef = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.startsWith('$') && trimmed.length > 1) return trimmed.slice(1);
  return null;
};

const authEntryLooksUsable = (entry) => {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.key === 'string' && entry.key.length > 0) return true;
  if (typeof entry.apiKey === 'string' && entry.apiKey.length > 0) return true;
  if (typeof entry.access === 'string' && entry.access.length > 0) return true;
  if (typeof entry.token === 'string' && entry.token.length > 0) return true;
  if (typeof entry.refresh === 'string' && entry.refresh.length > 0) return true;
  return false;
};

export const readPiProviderCatalog = (home = os.homedir()) => providerMap(readJsonObject(resolvePiModelsPath(home)));

export const providerHasPiLogin = (providerID, home = os.homedir()) => {
  if (!providerID) return false;
  const auth = readJsonObject(resolvePiAuthPath(home));
  if (authEntryLooksUsable(auth[providerID])) return true;
  const provider = readPiProviderCatalog(home)[providerID];
  const envName = envNameFromApiKeyRef(provider?.apiKey);
  if (envName) return Boolean(process.env[envName]);
  return typeof provider?.apiKey === 'string' && provider.apiKey.length > 0 && !provider.apiKey.startsWith('$');
};

export const listPiAuthenticatedProviders = (home = os.homedir()) => {
  const providers = readPiProviderCatalog(home);
  const auth = readJsonObject(resolvePiAuthPath(home));
  const ids = new Set([
    ...Object.keys(providers),
    ...Object.keys(auth).filter((id) => authEntryLooksUsable(auth[id])),
  ]);
  return Array.from(ids).filter((id) => providerHasPiLogin(id, home));
};

const firstCatalogModel = (providers) => {
  for (const [providerID, provider] of Object.entries(providers)) {
    const model = firstModelFromProvider(provider);
    if (model?.id) {
      return { providerID, modelID: model.id };
    }
  }
  return null;
};

/**
 * Resolve the current Pi model. Never invents a second provider — only
 * ~/.pi/agent defaults and models.json (plus an explicit override).
 */
export const resolvePiSmallModel = ({
  home = os.homedir(),
  overrideModel,
  settingsSmallModel,
  preferredProviderID,
  preferredModelID,
} = {}) => {
  const providers = readPiProviderCatalog(home);
  const explicit = parseModelRef(overrideModel) || parseModelRef(settingsSmallModel);
  if (explicit) {
    return { ...explicit, source: overrideModel ? 'request' : 'settings' };
  }

  const defaults = readPiDefaults(home);
  const fromDefaults = parseModelRef(defaults.model);
  if (fromDefaults) {
    return { ...fromDefaults, source: 'pi-default' };
  }

  const preferred = typeof preferredProviderID === 'string' && preferredProviderID
    ? preferredProviderID
    : null;
  if (preferred && providers[preferred]) {
    if (typeof preferredModelID === 'string' && preferredModelID && findModelEntry(providers, preferred, preferredModelID)) {
      return { providerID: preferred, modelID: preferredModelID, source: 'session-model' };
    }
    const model = firstModelFromProvider(providers[preferred]);
    if (model?.id) {
      return { providerID: preferred, modelID: model.id, source: 'pi-default' };
    }
  }

  const first = firstCatalogModel(providers);
  return first ? { ...first, source: 'pi-default' } : null;
};

export const describePiSmallModel = ({
  home = os.homedir(),
  overrideModel,
  settingsSmallModel,
  preferredProviderID,
  preferredModelID,
  outputReserveTokens,
} = {}) => {
  const resolved = resolvePiSmallModel({
    home,
    overrideModel,
    settingsSmallModel,
    preferredProviderID,
    preferredModelID,
  });
  if (!resolved) return null;

  const providers = readPiProviderCatalog(home);
  const entry = findModelEntry(providers, resolved.providerID, resolved.modelID);
  const contextTokens = Number(entry?.contextWindow) > 0 ? Number(entry.contextWindow) : DEFAULT_CONTEXT_TOKENS;
  const outputTokenLimit = Number(entry?.maxTokens) > 0 ? Number(entry.maxTokens) : DEFAULT_OUTPUT_TOKENS;
  const reserveTokens = typeof outputReserveTokens === 'function'
    ? outputReserveTokens({ contextTokens, outputTokenLimit })
    : outputReserveTokens;
  const reserve = Number(reserveTokens) > 0 ? Number(reserveTokens) : 4_000;
  const inputBudgetTokens = Math.max(1_000, contextTokens - reserve);

  return {
    ...resolved,
    hasLogin: providerHasPiLogin(resolved.providerID, home),
    inputCharBudget: inputBudgetTokens * 4,
    contextTokens,
    contextKnown: Number(entry?.contextWindow) > 0,
    outputTokens: Number(reserveTokens) > 0 ? Number(reserveTokens) : null,
    structuredOutput: null,
    outputTokenLimit,
  };
};

const extractAssistantText = (message) => {
  if (!message || typeof message !== 'object') return '';
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content
    .map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .join('');
};

const getModelRuntime = async () => {
  if (!modelRuntimePromise) {
    modelRuntimePromise = (async () => {
      const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
      return ModelRuntime.create({ allowModelNetwork: false });
    })().catch((error) => {
      modelRuntimePromise = null;
      throw error;
    });
  }
  return modelRuntimePromise;
};

const pickRuntimeModel = async (runtime, providerID, modelID) => {
  if (typeof runtime.getModel === 'function') {
    const exact = runtime.getModel(providerID, modelID);
    if (exact) return exact;
  }
  const available = typeof runtime.getAvailable === 'function'
    ? await runtime.getAvailable()
    : [];
  return (available || []).find((item) => (
    item.id === `${providerID}/${modelID}`
    || (item.id === modelID && (!item.provider || item.provider === providerID))
    || (item.provider === providerID && item.id === modelID)
  )) || (available || [])[0] || null;
};

export const callPiSmallModel = async ({
  providerID,
  modelID,
  prompt,
  system,
  maxOutputTokens,
  responseSchema,
  timeoutMs,
  signal,
}) => {
  const runtime = await getModelRuntime();
  const model = await pickRuntimeModel(runtime, providerID, modelID);
  if (!model) {
    throw Object.assign(
      new Error(`Pi model ${providerID}/${modelID} is not available`),
      { statusCode: 404, code: 'no-model' },
    );
  }

  const schemaNote = responseSchema
    ? `\nRespond with a single JSON object matching this schema:\n${JSON.stringify(responseSchema)}`
    : '';
  const systemPrompt = [typeof system === 'string' ? system.trim() : '', schemaNote].filter(Boolean).join('\n');
  const context = {
    ...(systemPrompt ? { systemPrompt } : {}),
    messages: [{
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    }],
  };
  const options = {
    ...(Number(maxOutputTokens) > 0 ? { maxTokens: Number(maxOutputTokens) } : {}),
    ...(signal ? { signal } : {}),
    ...(Number(timeoutMs) > 0 ? { timeoutMs: Number(timeoutMs) } : {}),
  };

  const complete = typeof runtime.completeSimple === 'function'
    ? runtime.completeSimple.bind(runtime)
    : runtime.complete.bind(runtime);
  const result = await complete(model, context, options);
  if (result?.stopReason === 'error' || result?.stopReason === 'aborted') {
    throw Object.assign(
      new Error(result.errorMessage || 'Pi model request failed'),
      { statusCode: 502 },
    );
  }
  const text = extractAssistantText(result);
  if (!text.trim() && (result?.stopReason === 'length' || (result?.content || []).some((part) => part?.type === 'thinking'))) {
    throw Object.assign(
      new Error('Pi model spent the output budget on reasoning and returned no answer'),
      { code: 'output-exhausted', provider: providerID },
    );
  }
  if (!text.trim()) {
    throw new Error(`Pi model ${providerID}/${modelID} returned no message content`);
  }
  return text;
};

export const isPiSmallModelEnabled = (env = process.env) => isPiKernelEnabled(env);

export const __testing = {
  resetModelRuntime() {
    modelRuntimePromise = null;
  },
  envNameFromApiKeyRef,
  findModelEntry,
  firstCatalogModel,
};
