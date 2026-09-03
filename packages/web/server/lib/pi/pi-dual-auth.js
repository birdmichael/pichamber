import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const KIMI_CODING_API_PROVIDER_ID = 'kimi-coding-api';
export const XAI_API_PROVIDER_ID = 'xai-api';
const KIMI_CODING_PROVIDER_ID = 'kimi-coding';
const XAI_PROVIDER_ID = 'xai';

const toPiModelSeed = (model) => ({
  id: model.id,
  name: model.name,
  ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
  ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
  ...(Array.isArray(model.input) ? { input: [...model.input] } : {}),
  ...(model.reasoning ? { reasoning: true } : {}),
});

const KIMI_API_FALLBACK_MODELS = [
  { id: 'kimi-k2.5', name: 'Kimi K2.5', contextWindow: 262144, input: ['text', 'image'], reasoning: true },
  { id: 'kimi-k2.6', name: 'Kimi K2.6', contextWindow: 262144, input: ['text', 'image'], reasoning: true },
  { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', contextWindow: 262144, input: ['text', 'image'], reasoning: true },
  { id: 'kimi-k3', name: 'Kimi K3', contextWindow: 1048576, input: ['text', 'image'], reasoning: true },
].map(toPiModelSeed);

const XAI_API_FALLBACK_MODELS = [
  { id: 'grok-4.6', name: 'Grok 4.6', contextWindow: 500000, input: ['text', 'image'], reasoning: true },
  { id: 'grok-4.3', name: 'Grok 4.3', contextWindow: 1000000, input: ['text', 'image'], reasoning: true },
  { id: 'grok-build-0.1', name: 'Grok Build 0.1', contextWindow: 256000, input: ['text', 'image'], reasoning: true },
].map(toPiModelSeed);

/** Catalog OAuth id → reserved API-key sibling. Pi auth.json is 1:1 per id. */
const PI_DUAL_AUTH_PROVIDERS = {
  [KIMI_CODING_PROVIDER_ID]: {
    catalogId: KIMI_CODING_PROVIDER_ID,
    apiId: KIMI_CODING_API_PROVIDER_ID,
    apiName: 'Kimi Code API',
    baseUrl: 'https://api.moonshot.ai/v1',
    api: 'openai-completions',
    catalogFile: 'moonshotai.json',
    fallbackModels: KIMI_API_FALLBACK_MODELS,
  },
  [XAI_PROVIDER_ID]: {
    catalogId: XAI_PROVIDER_ID,
    apiId: XAI_API_PROVIDER_ID,
    apiName: 'xAI API',
    baseUrl: 'https://api.x.ai/v1',
    api: 'openai-completions',
    catalogFile: 'xai.json',
    fallbackModels: XAI_API_FALLBACK_MODELS,
  },
};

const dualAuthByApiId = new Map(
  Object.values(PI_DUAL_AUTH_PROVIDERS).map((spec) => [spec.apiId, spec]),
);

export const isDualAuthCatalogId = (providerId) => Boolean(
  providerId && PI_DUAL_AUTH_PROVIDERS[providerId],
);

export const isDualAuthApiSiblingId = (providerId) => dualAuthByApiId.has(providerId);

export const dualAuthSpecFor = (providerId) => {
  if (!providerId) return null;
  return PI_DUAL_AUTH_PROVIDERS[providerId] || dualAuthByApiId.get(providerId) || null;
};

/**
 * OAuth always lands on the catalog id. API keys always land on the sibling
 * so saving one method cannot overwrite the other.
 */
export const dualAuthWritePlan = (providerId, credentialType) => {
  const spec = dualAuthSpecFor(providerId);
  if (!spec) return null;
  if (credentialType === 'oauth') {
    return {
      spec,
      authId: spec.catalogId,
      ensureApiProvider: false,
      migrateCatalogApiKeyToSibling: true,
      clearCatalogApiKey: false,
    };
  }
  return {
    spec,
    authId: spec.apiId,
    ensureApiProvider: true,
    migrateCatalogApiKeyToSibling: false,
    clearCatalogApiKey: true,
  };
};

const toFilesystemPath = (value) => {
  const text = String(value || '');
  if (text.startsWith('file:')) return fileURLToPath(text);
  return text;
};

const findNamedPackageDir = (start, name) => {
  let current = path.dirname(toFilesystemPath(start));
  while (current && current !== path.dirname(current)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(current, 'package.json'), 'utf8'));
      if (parsed?.name === name) return current;
    } catch {
      // Keep walking; a stray file is not the package root.
    }
    current = path.dirname(current);
  }
  return '';
};

const locatePiAiProviderData = (fileName) => {
  try {
    const sdkHref = import.meta.resolve('@earendil-works/pi-coding-agent');
    const sdkDir = findNamedPackageDir(sdkHref, '@earendil-works/pi-coding-agent');
    const candidates = [
      path.join(sdkDir, '..', 'pi-ai', 'dist', 'providers', 'data', fileName),
      path.join(sdkDir, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data', fileName),
    ];
    for (const file of candidates) {
      if (sdkDir && fs.existsSync(file)) return file;
    }
  } catch {
    // Unit tests without the SDK still seed fallback models.
  }
  return '';
};

const modelsFromCatalogJson = (catalog, api) => {
  const group = catalog && typeof catalog === 'object' ? catalog[api] : null;
  if (!group || typeof group !== 'object' || Array.isArray(group)) return [];
  const models = [];
  for (const model of Object.values(group)) {
    if (!model || typeof model !== 'object' || Array.isArray(model)) continue;
    const id = typeof model.id === 'string' ? model.id.trim() : '';
    if (!id) continue;
    const name = typeof model.name === 'string' && model.name.trim() ? model.name.trim() : id;
    const contextWindow = Number(model.contextWindow);
    const maxTokens = Number(model.maxTokens);
    const input = Array.isArray(model.input)
      ? model.input.filter((item) => item === 'text' || item === 'image')
      : undefined;
    models.push({
      id,
      name,
      ...(Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow: Math.round(contextWindow) } : {}),
      ...(Number.isFinite(maxTokens) && maxTokens > 0 ? { maxTokens: Math.round(maxTokens) } : {}),
      ...(input && input.length > 0 ? { input } : {}),
      ...(model.reasoning === true ? { reasoning: true } : {}),
    });
  }
  return models;
};

export const loadDualAuthApiModels = (spec) => {
  if (!spec) return [];
  const filePath = locatePiAiProviderData(spec.catalogFile);
  if (filePath) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const fromDisk = modelsFromCatalogJson(parsed, spec.api);
      if (fromDisk.length > 0) return fromDisk;
    } catch {
      // Fall through to the baked-in seed.
    }
  }
  return spec.fallbackModels.map((model) => ({
    id: model.id,
    name: model.name,
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
    ...(Array.isArray(model.input) ? { input: [...model.input] } : {}),
    ...(model.reasoning ? { reasoning: true } : {}),
  }));
};
