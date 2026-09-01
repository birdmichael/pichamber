import { createRequire } from 'node:module';
import fs from 'node:fs';

import { createMessageId, createPartId } from './ids.js';

const require = createRequire(import.meta.url);

const PI_SESSION_VERSION = 3;

const asTrimmedString = (value) => (typeof value === 'string' ? value.trim() : '');

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Facade leftover assistants default to `pi`/`pi`. That pair is not a catalog model. */
const FACADE_PLACEHOLDER_PROVIDER = 'pi';
const FACADE_PLACEHOLDER_MODEL = 'pi';

const asUsableFacadeModel = (providerID, modelID) => {
  const provider = asTrimmedString(providerID);
  const model = asTrimmedString(modelID);
  if (!provider || !model) return null;
  if (provider === FACADE_PLACEHOLDER_PROVIDER && model === FACADE_PLACEHOLDER_MODEL) return null;
  return {
    providerID: provider,
    modelID: model,
    model: { providerID: provider, modelID: model },
  };
};

const parseFacadeModelKey = (value) => {
  const trimmed = asTrimmedString(value);
  if (!trimmed) return null;
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash >= trimmed.length - 1) return null;
  return asUsableFacadeModel(trimmed.slice(0, slash), trimmed.slice(slash + 1));
};

const looksLikeModelRecord = (value) => {
  if (!isRecord(value)) return false;
  if (asTrimmedString(value.modelID) || asTrimmedString(value.modelId)) return true;
  if (value.role || value.sessionID || value.parts) return false;
  return Boolean(asTrimmedString(value.providerID || value.provider) && asTrimmedString(value.id));
};

/**
 * Resolve a real provider/model for assistant labels.
 * Leftover facade `pi`/`pi` is not usable. Do not invent a hardcoded model.
 */
export const resolveUsableFacadeModel = (...sources) => {
  for (const source of sources) {
    if (source == null || source === '') continue;
    if (typeof source === 'string') {
      const parsed = parseFacadeModelKey(source);
      if (parsed) return parsed;
      continue;
    }
    if (!isRecord(source)) continue;
    const fromFields = asUsableFacadeModel(
      source.providerID || source.provider,
      source.modelID || source.modelId || (looksLikeModelRecord(source) ? source.id : ''),
    );
    if (fromFields) return fromFields;
    if (source.model && source.model !== source) {
      const nested = resolveUsableFacadeModel(source.model);
      if (nested) return nested;
    }
    const fromPair = asUsableFacadeModel(
      source.provider,
      typeof source.model === 'string' ? source.model : '',
    );
    if (fromPair) return fromPair;
  }
  return null;
};

export const lastModelChangeFromMessages = (messages) => {
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const parts = messages[index]?.parts;
    if (!Array.isArray(parts)) continue;
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      if (part?.type !== 'model_change') continue;
      const found = resolveUsableFacadeModel(part);
      if (found) return found;
    }
  }
  return null;
};

export const lastModelChangeFromEntries = (entries) => {
  if (!Array.isArray(entries)) return null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== 'model_change') continue;
    const found = resolveUsableFacadeModel(entry);
    if (found) return found;
  }
  return null;
};

export const lastThinkingLevelChangeFromEntries = (entries) => {
  if (!Array.isArray(entries)) return null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== 'thinking_level_change') continue;
    const level = asTrimmedString(entry.thinkingLevel || entry.level);
    if (level) return level;
  }
  return null;
};

const assignReadableRuntime = (piSession, key, value) => {
  try {
    piSession[key] = value;
  } catch {
    // Real AgentSession thinkingLevel is getter-only. GET paths still
    // read lastModelChangeFromEntries / lastThinkingLevelChangeFromEntries.
  }
};

export const applySessionRuntimeFromEntries = (piSession, entries) => {
  if (!piSession || !Array.isArray(entries) || entries.length === 0) return piSession;
  const model = lastModelChangeFromEntries(entries);
  if (model) {
    const next = { id: model.modelID, provider: model.providerID };
    // Do not call setModel: real AgentSession.setModel needs a Model object,
    // is async, and appends another model_change. A stub {id,provider} also
    // replaces this.model so getAvailableThinkingLevels collapses to ["off"].
    assignReadableRuntime(piSession, 'currentModel', next);
  }
  const thinking = lastThinkingLevelChangeFromEntries(entries);
  if (thinking) {
    // Do not call setThinkingLevel: it clamps to this.model and may persist.
    assignReadableRuntime(piSession, 'thinkingLevel', thinking);
  }
  return piSession;
};

const toNonNegativeNumber = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
};

export const usageHasRecordedNumbers = (usage) => {
  if (!isRecord(usage)) return false;
  const cost = usage.cost;
  const candidates = [
    usage.input,
    usage.output,
    usage.reasoning,
    usage.cacheRead,
    usage.cacheWrite,
    usage.totalTokens,
    isRecord(usage.cache) ? usage.cache.read : undefined,
    isRecord(usage.cache) ? usage.cache.write : undefined,
    typeof cost === 'number' ? cost : (isRecord(cost) ? cost.total : undefined),
  ];
  return candidates.some((value) => typeof value === 'number' && Number.isFinite(value));
};

/** Map Pi assistant `usage` onto the OpenCode message token/cost shape. */
export const mapPiUsageToOpenCodeTokens = (usage) => {
  if (!usage || typeof usage !== 'object') {
    return {
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    };
  }
  const costValue = usage.cost;
  const cost = typeof costValue === 'number'
    ? toNonNegativeNumber(costValue)
    : toNonNegativeNumber(costValue?.total);
  return {
    cost,
    tokens: {
      input: toNonNegativeNumber(usage.input),
      output: toNonNegativeNumber(usage.output),
      reasoning: toNonNegativeNumber(usage.reasoning),
      cache: {
        read: toNonNegativeNumber(usage.cacheRead ?? usage.cache?.read),
        write: toNonNegativeNumber(usage.cacheWrite ?? usage.cache?.write),
      },
    },
  };
};

const facadeModelFromPiMessage = (message, fallbackModel) => {
  const resolved = resolveUsableFacadeModel(message, fallbackModel);
  if (!resolved) return {};
  return {
    modelID: resolved.modelID,
    providerID: resolved.providerID,
    model: resolved.model,
  };
};

const facadeUsageFromPiMessage = (message) => {
  if (!usageHasRecordedNumbers(message?.usage)) return {};
  const mapped = mapPiUsageToOpenCodeTokens(message.usage);
  return {
    cost: mapped.cost,
    tokens: mapped.tokens,
  };
};

/** Copy Pi assistant provider/model/usage onto the live SSE `info` shape. */
const facadeAssistantInfoFromPiMessage = (message, fallbackModel) => {
  if (!isRecord(message) || message.role !== 'assistant') return {};
  return {
    ...facadeModelFromPiMessage(message, fallbackModel),
    ...facadeUsageFromPiMessage(message),
  };
};

const PI_ASSISTANT_TERMINAL_STOP_REASONS = new Set([
  'stop',
  'length',
  'toolUse',
  'error',
  'aborted',
]);

const assistantContentLooksPresent = (content) => {
  if (typeof content === 'string') return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  return content.some((block) => {
    if (!isRecord(block)) return false;
    if (block.type === 'text') return Boolean(asTrimmedString(block.text));
    if (block.type === 'thinking') return Boolean(asTrimmedString(block.thinking));
    if (block.type === 'toolCall' || block.type === 'image') return true;
    return false;
  });
};

/**
 * Disk jsonl assistants are finished unless they still look open.
 * `stopReason: "pending"` is the live streaming stub; Pi replaces it before persist.
 * Persist helpers may omit `stopReason` / `usage` on an already-complete turn.
 */
const isFinishedPiAssistantMessage = (message) => {
  if (!isRecord(message) || message.role !== 'assistant') return false;
  const stopReason = asTrimmedString(message.stopReason);
  if (stopReason === 'pending') return false;
  if (PI_ASSISTANT_TERMINAL_STOP_REASONS.has(stopReason)) return true;
  if (usageHasRecordedNumbers(message.usage)) return true;
  return assistantContentLooksPresent(message.content);
};

const completedMillisFromPiAssistant = (message, created) => {
  if (typeof message?.timestamp === 'number' && Number.isFinite(message.timestamp) && message.timestamp > 0) {
    return message.timestamp >= 1e9 && message.timestamp < 1e12 ? message.timestamp * 1000 : message.timestamp;
  }
  if (typeof message?.timestamp === 'string' && message.timestamp.trim()) {
    const parsed = Date.parse(message.timestamp);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return created;
};

/** OpenCode `info.time` / `finish` for hydrate. Users and open assistants stay created-only. */
const facadeMessageTimeFromPi = (message, created) => {
  if (!isFinishedPiAssistantMessage(message)) {
    return { time: { created } };
  }
  return {
    time: { created, completed: completedMillisFromPiAssistant(message, created) },
    finish: 'stop',
  };
};

const piModelUsageFromFacadeInfo = (info) => {
  if (!isRecord(info) || info.role !== 'assistant') return {};
  const rawModel = info.model;
  const providerID = asTrimmedString(
    info.providerID
    || (isRecord(rawModel) ? (rawModel.providerID || rawModel.provider) : undefined),
  );
  const modelID = asTrimmedString(
    info.modelID
    || (typeof rawModel === 'string' ? rawModel : undefined)
    || (isRecord(rawModel) ? (rawModel.modelID || rawModel.id) : undefined),
  );
  const extras = {
    ...(providerID ? { provider: providerID } : {}),
    ...(modelID ? { model: modelID } : {}),
  };
  const tokens = isRecord(info.tokens) ? info.tokens : null;
  const hasCost = typeof info.cost === 'number' && Number.isFinite(info.cost);
  if (!tokens && !hasCost) return extras;
  extras.usage = {
    ...(tokens ? {
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cacheRead: tokens.cache?.read,
      cacheWrite: tokens.cache?.write,
    } : {}),
    ...(hasCost ? { cost: { total: info.cost } } : {}),
  };
  return extras;
};

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const isoFromUnknown = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
    return value.trim();
  }
  return new Date().toISOString();
};

const millisFromUnknown = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 1e9 && value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
};

const textFromPiContent = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      if (typeof item.text === 'string') return item.text;
      if (typeof item.thinking === 'string') return item.thinking;
      return '';
    })
    .filter(Boolean)
    .join('\n');
};

const textFromToolContent = (content) => {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (isRecord(item) && typeof item.text === 'string') return item.text;
        return '';
      })
      .filter(Boolean)
      .join('');
  }
  if (isRecord(content)) {
    if (typeof content.text === 'string') return content.text;
    if (Array.isArray(content.content)) return textFromToolContent(content.content);
  }
  return '';
};

const toolInputFromCall = (item) => {
  if (isRecord(item?.arguments)) return item.arguments;
  if (isRecord(item?.args)) return item.args;
  return {};
};

const filenameFromMime = (mime) => {
  const subtype = asTrimmedString(mime).split('/')[1]?.split(';')[0]?.toLowerCase();
  if (!subtype) return 'image';
  const ext = subtype === 'jpeg' ? 'jpg' : subtype.replace(/[^a-z0-9]+/g, '') || 'bin';
  return `image.${ext}`;
};

const imagePayloadFromDataUrl = (url, fallbackMime) => {
  const value = asTrimmedString(url);
  if (!value.startsWith('data:')) return null;
  const comma = value.indexOf(',');
  if (comma === -1) return null;
  const header = value.slice(5, comma);
  const data = value.slice(comma + 1);
  if (!data) return null;
  const mime = asTrimmedString(header.split(';')[0]) || asTrimmedString(fallbackMime);
  if (!mime) return null;
  return { mime, data };
};

const imagePayloadFromUnknown = (item) => {
  if (!isRecord(item)) return null;

  if (typeof item.url === 'string') {
    const fromUrl = imagePayloadFromDataUrl(item.url, item.mime || item.mimeType);
    if (fromUrl) return fromUrl;
  }

  if (typeof item.data === 'string' && item.data.startsWith('data:')) {
    const fromDataUrl = imagePayloadFromDataUrl(item.data, item.mimeType || item.mime);
    if (fromDataUrl) return fromDataUrl;
  }

  const source = isRecord(item.source) ? item.source : null;
  const sourceMime = asTrimmedString(
    source?.mediaType || source?.mimeType || item.mimeType || item.mime,
  );
  if (source) {
    if (typeof source.url === 'string') {
      const fromSourceUrl = imagePayloadFromDataUrl(source.url, sourceMime);
      if (fromSourceUrl) return fromSourceUrl;
    }
    const sourceData = typeof source.data === 'string' ? source.data : '';
    if (sourceData.startsWith('data:')) {
      const fromSourceDataUrl = imagePayloadFromDataUrl(sourceData, sourceMime);
      if (fromSourceDataUrl) return fromSourceDataUrl;
    }
    if (sourceData && sourceMime) {
      return { mime: sourceMime, data: sourceData };
    }
  }

  const mime = asTrimmedString(item.mimeType || item.mime);
  const data = typeof item.data === 'string' ? item.data : '';
  if (mime && data) return { mime, data };
  return null;
};

/** Normalize a Pi image block or facade file/image part to Pi ImageContent. */
export const toPiImageContent = (item) => {
  const payload = imagePayloadFromUnknown(item);
  if (!payload) return null;
  if (!payload.mime.startsWith('image/')) return null;
  return {
    type: 'image',
    data: payload.data,
    mimeType: payload.mime,
  };
};

export const facadeFilePartFromUnknown = (item, sessionID, messageID) => {
  if (!isRecord(item)) return null;
  const payload = imagePayloadFromUnknown(item);
  if (payload) {
    return {
      id: createPartId(),
      sessionID,
      messageID,
      type: 'file',
      mime: payload.mime,
      url: `data:${payload.mime};base64,${payload.data}`,
      filename: asTrimmedString(item.filename) || filenameFromMime(payload.mime),
    };
  }
  if (item.type === 'file' && (asTrimmedString(item.mime) || typeof item.url === 'string')) {
    return {
      id: createPartId(),
      sessionID,
      messageID,
      type: 'file',
      mime: asTrimmedString(item.mime) || 'application/octet-stream',
      url: typeof item.url === 'string' ? item.url : '',
      ...(asTrimmedString(item.filename) ? { filename: item.filename } : {}),
    };
  }
  return null;
};

const facadeToolPart = (item, sessionID, messageID) => {
  const callID = asTrimmedString(item?.id);
  return {
    id: createPartId(),
    sessionID,
    messageID,
    type: 'tool',
    callID,
    tool: asTrimmedString(item?.name) || 'tool',
    state: {
      status: 'pending',
      input: toolInputFromCall(item),
    },
  };
};

const applyToolResultToPart = (part, message) => {
  if (!part || !isRecord(message)) return;
  const output = textFromToolContent(message.content);
  const isError = message.isError === true;
  const details = isRecord(message.details) ? message.details : undefined;
  const input = isRecord(part.state?.input) ? part.state.input : {};
  const toolName = asTrimmedString(message.toolName || message.name);
  if (toolName && (!part.tool || part.tool === 'tool')) {
    part.tool = toolName;
  }
  const created = typeof part.state?.time?.start === 'number' ? part.state.time.start : undefined;
  const endedAt = Date.now();
  const startedAt = created ?? endedAt;
  const duration = Math.max(0, endedAt - startedAt);
  part.state = {
    status: isError ? 'error' : 'completed',
    input,
    output,
    ...(isError ? { error: output || 'tool error' } : {}),
    ...(details ? { metadata: { ...details, ...(typeof details.duration === 'number' || typeof details.durationMs === 'number' ? {} : { duration }) } } : {}),
    time: { start: startedAt, end: endedAt, duration },
  };
};

const partsFromPiContent = (content, sessionID, messageID) => {
  if (typeof content === 'string' && content) {
    return [{
      id: createPartId(),
      sessionID,
      messageID,
      type: 'text',
      text: content,
    }];
  }
  if (!Array.isArray(content)) return [];
  const parts = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'thinking' || typeof item.thinking === 'string') {
      parts.push({
        id: createPartId(),
        sessionID,
        messageID,
        type: 'reasoning',
        text: typeof item.thinking === 'string' ? item.thinking : String(item.text || ''),
      });
      continue;
    }
    if (item.type === 'toolCall') {
      parts.push(facadeToolPart(item, sessionID, messageID));
      continue;
    }
    if (item.type === 'image') {
      const file = facadeFilePartFromUnknown(item, sessionID, messageID);
      if (file) parts.push(file);
      continue;
    }
    if (typeof item.text === 'string') {
      const textPart = {
        id: createPartId(),
        sessionID,
        messageID,
        type: 'text',
        text: item.text,
      };
      if (item.synthetic === true) textPart.synthetic = true;
      if (item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)) {
        textPart.metadata = item.metadata;
      }
      parts.push(textPart);
    }
  }
  return parts;
};

const textFromFacadeParts = (parts) => {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((part) => part && (part.type === 'text' || part.type === 'reasoning') && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
};

const toolResultFromFacadePart = (part, timestamp) => {
  if (!part || part.type !== 'tool') return null;
  const callID = asTrimmedString(part.callID);
  if (!callID) return null;
  const status = asTrimmedString(part.state?.status);
  const output = typeof part.state?.output === 'string' ? part.state.output : '';
  if (status !== 'completed' && status !== 'error' && !output) return null;
  return {
    role: 'toolResult',
    toolName: asTrimmedString(part.tool) || 'tool',
    toolCallId: callID,
    content: [{ type: 'text', text: output }],
    timestamp,
    ...(status === 'error' ? { isError: true } : {}),
  };
};

/** Facade parts → Pi-native messages for SessionManager.appendMessage and JSONL export. */
export const piMessagesFromFacadeEntry = (entry) => {
  const role = entry?.info?.role === 'assistant' ? 'assistant' : 'user';
  const timestamp = millisFromUnknown(entry?.info?.time?.created);
  const content = [];
  const toolResults = [];
  for (const part of Array.isArray(entry?.parts) ? entry.parts : []) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'reasoning' && typeof part.text === 'string') {
      content.push({ type: 'thinking', thinking: part.text });
      continue;
    }
    if (part.type === 'text' && typeof part.text === 'string') {
      const item = { type: 'text', text: part.text };
      if (part.synthetic === true) item.synthetic = true;
      if (part.metadata && typeof part.metadata === 'object' && !Array.isArray(part.metadata)) {
        item.metadata = part.metadata;
      }
      content.push(item);
      continue;
    }
    if (part.type === 'tool') {
      const callID = asTrimmedString(part.callID);
      content.push({
        type: 'toolCall',
        id: callID,
        name: asTrimmedString(part.tool) || 'tool',
        arguments: isRecord(part.state?.input) ? part.state.input : {},
      });
      const toolResult = toolResultFromFacadePart(part, timestamp);
      if (toolResult) toolResults.push(toolResult);
      continue;
    }
    if (part.type === 'file' || part.type === 'image') {
      const image = toPiImageContent(part);
      if (image) content.push(image);
    }
  }
  if (content.length === 0 && toolResults.length === 0) return [];
  return [
    {
      role,
      content,
      timestamp,
      ...piModelUsageFromFacadeInfo(entry?.info),
    },
    ...toolResults,
  ];
};

export const persistFacadeMessages = (manager, messages) => {
  if (typeof manager?.appendMessage !== 'function') return false;
  for (const entry of Array.isArray(messages) ? messages : []) {
    for (const message of piMessagesFromFacadeEntry(entry)) {
      manager.appendMessage(message);
    }
  }
  return true;
};

export const sanitizeExportBasename = (title) => {
  const base = asTrimmedString(title) || 'session';
  const safe = base
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return safe || 'session';
};

export const cloneImportedMessages = (messages, sessionID) => (
  (Array.isArray(messages) ? messages : []).map((entry) => {
    const info = entry?.info && typeof entry.info === 'object' ? { ...entry.info, sessionID } : {
      id: createMessageId(),
      sessionID,
      role: 'user',
      time: { created: Date.now() },
      agent: 'pi',
    };
    const parts = (Array.isArray(entry?.parts) ? entry.parts : []).map((part) => ({
      ...part,
      sessionID,
      messageID: info.id,
    }));
    return { info, parts };
  })
);

export const buildSessionJsonl = (record) => {
  const info = record?.info || {};
  const cwd = record?.directory || info.directory || '';
  const header = {
    type: 'session',
    version: PI_SESSION_VERSION,
    id: record?.id || info.id || createMessageId(),
    timestamp: isoFromUnknown(info.time?.created),
    cwd,
  };
  const lines = [JSON.stringify(header)];
  if (asTrimmedString(info.title) && info.title !== 'New session') {
    lines.push(JSON.stringify({
      type: 'session_info',
      id: createMessageId(),
      parentId: null,
      timestamp: isoFromUnknown(info.time?.created),
      name: info.title,
    }));
  }
  let prevId = null;
  for (const entry of record?.messages || []) {
    const messageId = entry?.info?.id || createMessageId();
    const parentId = entry?.info?.parentID || prevId;
    const timestamp = isoFromUnknown(entry?.info?.time?.created);
    const mapped = piMessagesFromFacadeEntry(entry);
    const messages = mapped.length > 0
      ? mapped
      : [{
          role: entry?.info?.role === 'assistant' ? 'assistant' : 'user',
          content: [],
          timestamp: millisFromUnknown(entry?.info?.time?.created),
        }];
    for (const [index, message] of messages.entries()) {
      const id = index === 0 ? messageId : createMessageId();
      lines.push(JSON.stringify({
        type: 'message',
        id,
        parentId: index === 0 ? parentId : prevId,
        timestamp,
        message,
      }));
      prevId = id;
    }
  }
  return `${lines.join('\n')}\n`;
};

const isSafeHref = (href) => {
  const value = asTrimmedString(href);
  if (!value) return false;
  const lower = value.toLowerCase();
  if (lower.startsWith('https://') || lower.startsWith('http://') || lower.startsWith('mailto:')) {
    return true;
  }
  if (lower.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  return true;
};

const isRemoteHttpUrl = (value) => /^https?:\/\//i.test(asTrimmedString(value));

const isEmbeddableDataImage = (value) => /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(asTrimmedString(value));

const holdSlot = (slots, html) => {
  const key = `\u0000${slots.length}\u0000`;
  slots.push(html);
  return key;
};

const replaceMarkdownLinks = (text, image, replace) => {
  let result = '';
  let index = 0;
  while (index < text.length) {
    const bang = image && text[index] === '!' && text[index + 1] === '[';
    const open = bang ? index + 1 : (!image && text[index] === '[' ? index : -1);
    if (open === -1) {
      result += text[index];
      index += 1;
      continue;
    }
    const closeLabel = text.indexOf(']', open + 1);
    if (closeLabel === -1 || text[closeLabel + 1] !== '(') {
      result += text[index];
      index += 1;
      continue;
    }
    let depth = 1;
    let cursor = closeLabel + 2;
    while (cursor < text.length && depth > 0) {
      if (text[cursor] === '(') depth += 1;
      else if (text[cursor] === ')') depth -= 1;
      cursor += 1;
    }
    if (depth !== 0) {
      result += text[index];
      index += 1;
      continue;
    }
    const label = text.slice(open + 1, closeLabel);
    const href = text.slice(closeLabel + 2, cursor - 1);
    result += replace(label, href);
    index = cursor;
  }
  return result;
};

const inlineMarkdown = (raw) => {
  const slots = [];
  let text = escapeHtml(raw);
  text = text.replace(/`([^`]+)`/g, (_, code) => holdSlot(slots, `<code>${code}</code>`));
  text = replaceMarkdownLinks(text, true, (alt, href) => {
    const src = href.trim();
    if (isEmbeddableDataImage(src)) {
      return holdSlot(slots, `<img src="${src}" alt="${alt}">`);
    }
    if (isRemoteHttpUrl(src)) {
      return holdSlot(slots, '<span class="image-omitted">Image omitted (remote URL)</span>');
    }
    return holdSlot(slots, alt ? `<span class="image-omitted">${alt}</span>` : '<span class="image-omitted">Image omitted</span>');
  });
  text = replaceMarkdownLinks(text, false, (label, href) => {
    const dest = href.trim();
    if (!isSafeHref(dest)) return `[${label}](${dest})`;
    return holdSlot(slots, `<a href="${dest}">${label}</a>`);
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  text = text.replace(/\n/g, '<br>\n');
  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => slots[Number(index)] || '');
};

const isMarkdownFenceOpen = (line) => /^```/.test(line);

const isMarkdownHeading = (line) => /^(#{1,6})\s+\S/.test(line);

const isMarkdownQuote = (line) => /^>\s?/.test(line);

const isMarkdownUnordered = (line) => /^\s*[-*+]\s+\S/.test(line);

const isMarkdownOrdered = (line) => /^\s*\d+\.\s+\S/.test(line);

const isMarkdownRule = (line) => /^(\*{3,}|-{3,}|_{3,})\s*$/.test(line);

const isMarkdownTableRow = (line) => /^\s*\|.+\|\s*$/.test(line);

const isMarkdownTableDivider = (line) => /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);

const cellsFromTableRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());

const isMarkdownBlockStart = (line) => (
  isMarkdownFenceOpen(line)
  || isMarkdownHeading(line)
  || isMarkdownQuote(line)
  || isMarkdownUnordered(line)
  || isMarkdownOrdered(line)
  || isMarkdownRule(line)
  || isMarkdownTableRow(line)
);

/** Escape first, then insert only our tags. Code fences, lists, and links stay offline-safe. */
const markdownToHtml = (source) => {
  const lines = String(source ?? '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (isMarkdownFenceOpen(line)) {
      const language = escapeHtml(line.slice(3).trim().split(/\s+/, 1)[0] || '');
      index += 1;
      const code = [];
      while (index < lines.length && !isMarkdownFenceOpen(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const classAttr = language ? ` class="language-${language}"` : '';
      html.push(`<pre><code${classAttr}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (isMarkdownRule(line)) {
      html.push('<hr>');
      index += 1;
      continue;
    }
    if (isMarkdownTableRow(line) && index + 1 < lines.length && isMarkdownTableDivider(lines[index + 1])) {
      const header = cellsFromTableRow(line);
      index += 2;
      const bodyRows = [];
      while (index < lines.length && isMarkdownTableRow(lines[index]) && !isMarkdownTableDivider(lines[index])) {
        bodyRows.push(cellsFromTableRow(lines[index]));
        index += 1;
      }
      const thead = `<tr>${header.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr>`;
      const tbody = bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('');
      html.push(`<table><thead>${thead}</thead>${tbody ? `<tbody>${tbody}</tbody>` : ''}</table>`);
      continue;
    }
    if (isMarkdownQuote(line)) {
      const quote = [];
      while (index < lines.length && isMarkdownQuote(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      html.push(`<blockquote>${markdownToHtml(quote.join('\n'))}</blockquote>`);
      continue;
    }
    if (isMarkdownUnordered(line)) {
      const items = [];
      while (index < lines.length && isMarkdownUnordered(lines[index])) {
        items.push(`<li>${inlineMarkdown(lines[index].replace(/^\s*[-*+]\s+/, ''))}</li>`);
        index += 1;
      }
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (isMarkdownOrdered(line)) {
      const items = [];
      while (index < lines.length && isMarkdownOrdered(lines[index])) {
        items.push(`<li>${inlineMarkdown(lines[index].replace(/^\s*\d+\.\s+/, ''))}</li>`);
        index += 1;
      }
      html.push(`<ol>${items.join('')}</ol>`);
      continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    html.push(`<p>${inlineMarkdown(paragraph.join('\n'))}</p>`);
  }
  return html.join('\n');
};

const SHARE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const shareDateParts = (value) => {
  if (value == null || value === '') return null;
  const millis = typeof value === 'number' && Number.isFinite(value)
    ? value
    : Date.parse(isoFromUnknown(value));
  if (!Number.isFinite(millis)) return null;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const formatShareClock = (value) => {
  const date = shareDateParts(value);
  if (!date) return '';
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
};

const formatShareDate = (value) => {
  const date = shareDateParts(value);
  if (!date) return '';
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${date.getUTCDate()} ${SHARE_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${hours}:${minutes}`;
};

const EXPORT_LOCALES = {
  en: {
    copy: 'Copy',
    copyMessage: 'Copy message',
    copyAnswer: 'Copy reply',
    copyOutput: 'Copy output',
    copied: 'Copied',
    copyFailed: 'Copy failed',
    questions: 'Questions',
    answered: '{count} answered',
    ignored: 'Questions dismissed',
    themeToggle: 'Toggle light and dark theme',
    themeToLight: 'Switch to light theme',
    themeToDark: 'Switch to dark theme',
    github: 'GitHub',
    logo: 'Pichamber',
  },
  de: {
    copy: 'Kopieren',
    copyMessage: 'Nachricht kopieren',
    copyAnswer: 'Antwort kopieren',
    copyOutput: 'Ausgabe kopieren',
    copied: 'Kopiert',
    copyFailed: 'Kopieren fehlgeschlagen',
    questions: 'Fragen',
    answered: '{count} beantwortet',
    ignored: 'Fragen ignoriert',
    themeToggle: 'Hell- und Dunkelmodus umschalten',
    themeToLight: 'Zum hellen Modus wechseln',
    themeToDark: 'Zum dunklen Modus wechseln',
    github: 'GitHub',
    logo: 'Pichamber',
  },
  es: {
    copy: 'Copiar',
    copyMessage: 'Copiar mensaje',
    copyAnswer: 'Copiar respuesta',
    copyOutput: 'Copiar salida',
    copied: 'Copiado',
    copyFailed: 'Error al copiar',
    questions: 'Preguntas',
    answered: '{count} respondidas',
    ignored: 'Preguntas omitidas',
    themeToggle: 'Alternar tema claro y oscuro',
    themeToLight: 'Cambiar al tema claro',
    themeToDark: 'Cambiar al tema oscuro',
    github: 'GitHub',
    logo: 'Pichamber',
  },
  fr: {
    copy: 'Copier',
    copyMessage: 'Copier le message',
    copyAnswer: 'Copier la réponse',
    copyOutput: 'Copier la sortie',
    copied: 'Copié',
    copyFailed: 'Échec de la copie',
    questions: 'Questions',
    answered: '{count} répondues',
    ignored: 'Questions ignorées',
    themeToggle: 'Basculer entre le thème clair et sombre',
    themeToLight: 'Passer au thème clair',
    themeToDark: 'Passer au thème sombre',
    github: 'GitHub',
    logo: 'Pichamber',
  },
  ja: {
    copy: 'コピー',
    copyMessage: 'メッセージをコピー',
    copyAnswer: '返信をコピー',
    copyOutput: '出力をコピー',
    copied: 'コピーしました',
    copyFailed: 'コピーに失敗しました',
    questions: '質問',
    answered: '{count} 件回答済み',
    ignored: '質問は無視されました',
    themeToggle: 'ライトとダークのテーマを切り替え',
    themeToLight: 'ライトテーマに切り替え',
    themeToDark: 'ダークテーマに切り替え',
    github: 'GitHub',
    logo: 'Pichamber',
  },
  ko: {
    copy: '복사',
    copyMessage: '메시지 복사',
    copyAnswer: '답변 복사',
    copyOutput: '출력 복사',
    copied: '복사됨',
    copyFailed: '복사 실패',
    questions: '질문',
    answered: '{count}개 답변됨',
    ignored: '질문이 무시됨',
    themeToggle: '밝은 테마와 어두운 테마 전환',
    themeToLight: '밝은 테마로 전환',
    themeToDark: '어두운 테마로 전환',
    github: 'GitHub',
    logo: 'Pichamber',
  },
  pl: {
    copy: 'Kopiuj',
    copyMessage: 'Kopiuj wiadomość',
    copyAnswer: 'Kopiuj odpowiedź',
    copyOutput: 'Kopiuj wynik',
    copied: 'Skopiowano',
    copyFailed: 'Nie udało się skopiować',
    questions: 'Pytania',
    answered: 'odpowiedziano na {count}',
    ignored: 'Pytania pominięte',
    themeToggle: 'Przełącz jasny i ciemny motyw',
    themeToLight: 'Przełącz na jasny motyw',
    themeToDark: 'Przełącz na ciemny motyw',
    github: 'GitHub',
    logo: 'Pichamber',
  },
  'pt-BR': {
    copy: 'Copiar',
    copyMessage: 'Copiar mensagem',
    copyAnswer: 'Copiar resposta',
    copyOutput: 'Copiar saída',
    copied: 'Copiado',
    copyFailed: 'Falha ao copiar',
    questions: 'Perguntas',
    answered: '{count} respondidas',
    ignored: 'Perguntas ignoradas',
    themeToggle: 'Alternar tema claro e escuro',
    themeToLight: 'Mudar para o tema claro',
    themeToDark: 'Mudar para o tema escuro',
    github: 'GitHub',
    logo: 'Pichamber',
  },
  uk: {
    copy: 'Копіювати',
    copyMessage: 'Копіювати повідомлення',
    copyAnswer: 'Копіювати відповідь',
    copyOutput: 'Копіювати вивід',
    copied: 'Скопійовано',
    copyFailed: 'Не вдалося скопіювати',
    questions: 'Питання',
    answered: 'відповідей: {count}',
    ignored: 'Питання проігноровано',
    themeToggle: 'Перемкнути світлу й темну тему',
    themeToLight: 'Перемкнути на світлу тему',
    themeToDark: 'Перемкнути на темну тему',
    github: 'GitHub',
    logo: 'Pichamber',
  },
  'zh-CN': {
    copy: '复制',
    copyMessage: '复制消息',
    copyAnswer: '复制回复',
    copyOutput: '复制输出',
    copied: '已复制',
    copyFailed: '复制失败',
    questions: '问题',
    answered: '已回答 {count} 个',
    ignored: '问题已忽略',
    themeToggle: '切换浅色或深色主题',
    themeToLight: '切换到浅色',
    themeToDark: '切换到深色',
    github: 'GitHub',
    logo: 'Pichamber',
  },
  'zh-TW': {
    copy: '複製',
    copyMessage: '複製訊息',
    copyAnswer: '複製回覆',
    copyOutput: '複製輸出',
    copied: '已複製',
    copyFailed: '複製失敗',
    questions: '問題',
    answered: '已回答 {count} 個',
    ignored: '問題已忽略',
    themeToggle: '切換淺色或深色主題',
    themeToLight: '切換到淺色',
    themeToDark: '切換到深色',
    github: 'GitHub',
    logo: 'Pichamber',
  },
};

const normalizeExportLocale = (value) => {
  const normalized = asTrimmedString(value).toLowerCase().replace(/_/g, '-');
  if (!normalized) return 'en';
  if (normalized === 'zh-cn' || normalized === 'zh-hans' || normalized.startsWith('zh-hans-')) return 'zh-CN';
  if (normalized === 'zh-tw' || normalized === 'zh-hant' || normalized.startsWith('zh-hant-')) return 'zh-TW';
  if (normalized.startsWith('zh')) return 'zh-CN';
  if (normalized === 'pt-br' || normalized.startsWith('pt-br-') || normalized === 'pt') return 'pt-BR';
  const base = normalized.split('-')[0];
  if (Object.hasOwn(EXPORT_LOCALES, normalized)) return normalized;
  if (Object.hasOwn(EXPORT_LOCALES, base)) return base;
  return 'en';
};

const exportStrings = (locale) => EXPORT_LOCALES[normalizeExportLocale(locale)] || EXPORT_LOCALES.en;

const interpolate = (template, params) => String(template ?? '').replace(/\{(\w+)\}/g, (_, key) => String(params?.[key] ?? ''));

const stripVersionPrefix = (value) => asTrimmedString(value).replace(/^[^\d]*/, '');

export const readPiCodingAgentVersion = () => {
  try {
    const version = stripVersionPrefix(require('@earendil-works/pi-coding-agent/package.json')?.version);
    if (version) return version;
  } catch {
    // Fall through to the workspace dependency pin.
  }
  try {
    const version = stripVersionPrefix(require('../../../package.json')?.dependencies?.['@earendil-works/pi-coding-agent']);
    if (version) return version;
  } catch {
    // One failed lookup must not empty the export.
  }
  return '';
};

const PICHAMBER_REPO_HREF = 'https://github.com/birdmichael/pichamber';
const EXPORT_THEME_KEY = 'pichamber-export-theme';

const PICHAMBER_MARK_SVG = `<svg class="pichamber-mark" viewBox="0 0 100 100" width="18" height="18" fill="none" aria-hidden="true"><path d="M50 50 L8.432 26 L8.432 74 L50 98 Z" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M50 50 L91.568 26 L91.568 74 L50 98 Z" fill="currentColor" fill-opacity="0.35" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M50 2 L8.432 26 L50 50 L91.568 26 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><g transform="matrix(0.866, 0.5, -0.866, 0.5, 50, 26) scale(0.068)" fill="currentColor"><path fill-rule="evenodd" d="M-234.71 -234.71 H117.36 V0 H0 V117.36 H-117.35 V234.72 H-234.71 Z M-117.35 -117.35 V0 H0 V-117.35 Z"/><path d="M117.36 0 H234.72 V234.72 H117.36 Z"/></g></svg>`;

const PI_PIXEL_MARK_SVG = `<svg class="pi-mark" viewBox="-235 -235 470 470" width="12" height="12" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M-234.71 -234.71 H117.36 V0 H0 V117.36 H-117.35 V234.72 H-234.71 Z M-117.35 -117.35 V0 H0 V-117.35 Z"/><path d="M117.36 0 H234.72 V234.72 H117.36 Z"/></svg>`;

const GITHUB_ICON_SVG = `<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M10 1.7A8.3 8.3 0 0 0 1.7 10c0 3.67 2.38 6.78 5.68 7.88.42.08.57-.18.57-.4 0-.2-.01-.86-.01-1.56-2.31.5-2.8-1-2.8-1-.38-.96-.92-1.22-.92-1.22-.76-.52.06-.51.06-.51.84.06 1.28.86 1.28.86.74 1.28 1.95.91 2.43.7.07-.54.29-.91.53-1.12-1.85-.21-3.79-.92-3.79-4.12 0-.91.32-1.65.86-2.23-.09-.21-.37-1.07.08-2.23 0 0 .7-.22 2.3.86a8 8 0 0 1 4.18 0c1.6-1.08 2.3-.86 2.3-.86.45 1.16.17 2.02.08 2.23.54.58.86 1.32.86 2.23 0 3.21-1.95 3.9-3.8 4.11.3.26.57.76.57 1.54 0 1.12-.01 2.02-.01 2.3 0 .22.15.48.57.4A8.3 8.3 0 0 0 18.3 10 8.3 8.3 0 0 0 10 1.7Z"/></svg>`;

const THEME_ICON_SVG = `<svg class="icon-moon" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12.6 3.2A6.4 6.4 0 1 0 16.8 12 5.2 5.2 0 0 1 12.6 3.2Z"/></svg><svg class="icon-sun" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10" cy="10" r="3.2"/><path d="M10 2.5v1.6M10 15.9v1.6M2.5 10h1.6M15.9 10h1.6M4.4 4.4l1.1 1.1M14.5 14.5l1.1 1.1M4.4 15.6l1.1-1.1M14.5 5.5l1.1-1.1"/></svg>`;

const STAR_ICON_SVG = `<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M8 1.2 9.4 5h3.8l-3 2.3L11.5 11 8 8.8 4.5 11l1.3-3.7-3-2.3h3.8L8 1.2Z"/></svg>`;

const COPY_ICON_SVG = `<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="7" y="7" width="9" height="9" rx="1.5"/><path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-7A1.5 1.5 0 0 0 3 5.5v7A1.5 1.5 0 0 0 4.5 14H6"/></svg>`;

const CHEVRON_SVG = `<svg class="chevron" viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 4.5 6 8.5 10 4.5"/></svg>`;

const safeBlock = (render) => {
  try {
    return render() || '';
  } catch {
    return '';
  }
};

const formatTurnDuration = (durationMs) => {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return '';
  const totalSeconds = durationMs / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
};

const lastUsableModelId = (sources) => {
  for (let index = sources.length - 1; index >= 0; index -= 1) {
    const resolved = resolveUsableFacadeModel(sources[index]);
    if (resolved?.modelID) return resolved.modelID;
  }
  return '';
};

const isPlanInfo = (info) => {
  const mode = asTrimmedString(info?.mode).toLowerCase();
  const agent = asTrimmedString(info?.agent).toLowerCase();
  return mode === 'plan' || agent === 'plan';
};

const copyButton = (label, text) => (
  `<button type="button" class="copy" data-copy="${escapeHtml(text)}" aria-label="${escapeHtml(label)}">${COPY_ICON_SVG}</button>`
);

const htmlFromFilePart = (part) => {
  const image = toPiImageContent(part);
  if (image) {
    const alt = escapeHtml(asTrimmedString(part.filename) || filenameFromMime(image.mimeType));
    return `<figure class="image"><img src="data:${image.mimeType};base64,${image.data}" alt="${alt}"></figure>`;
  }
  const file = facadeFilePartFromUnknown(part, '', '');
  const url = asTrimmedString(file?.url || part?.url);
  const mime = asTrimmedString(file?.mime || part?.mime || part?.mimeType);
  if (isRemoteHttpUrl(url) && (mime.startsWith('image/') || part?.type === 'image' || part?.type === 'file')) {
    return '<p class="image-omitted">Image omitted (remote URL)</p>';
  }
  if (file || part?.type === 'file' || part?.type === 'image') {
    const label = escapeHtml(asTrimmedString(part?.filename) || mime || 'file');
    return `<p class="file-omitted">File omitted (${label})</p>`;
  }
  return '';
};

const toolSubtitle = (input) => {
  if (!isRecord(input)) return '';
  for (const key of ['command', 'path', 'filePath', 'file_path', 'target']) {
    if (typeof input[key] === 'string' && input[key].trim()) return input[key].trim();
  }
  const keys = Object.keys(input);
  if (keys.length === 1 && typeof input[keys[0]] === 'string') return input[keys[0]];
  return '';
};

const isQuestionToolName = (name) => {
  const tool = asTrimmedString(name).toLowerCase();
  return tool === 'question' || tool === 'plan_mode_question';
};

const answersFromUnknown = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (Array.isArray(item)) return item.map((part) => String(part)).filter(Boolean).join(', ');
      if (typeof item === 'string') return item;
      if (isRecord(item) && typeof item.answer === 'string') return item.answer;
      return '';
    });
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (value === true) return ['true'];
  if (value === false) return ['false'];
  return [];
};

const parseAnsweredQuestionOutput = (output) => {
  const text = String(output ?? '');
  const match = text.match(/User has answered your questions:\s*(.+?)(?:\.\s*You can now|$)/s);
  if (match) {
    const pairs = [];
    const pairRegex = /"([^"]+)"="([^"]*)"/g;
    let pairMatch = pairRegex.exec(match[1]);
    while (pairMatch) {
      pairs.push({ question: pairMatch[1], answer: pairMatch[2] });
      pairMatch = pairRegex.exec(match[1]);
    }
    return pairs;
  }
  const trimmed = text.trim();
  if (/^User cancelled the selection/i.test(trimmed)) return [];
  const selected = trimmed.match(/^User selected:\s*(?:\d+\.\s*)?([\s\S]+)$/i);
  if (selected?.[1]?.trim()) return [{ question: '', answer: selected[1].trim() }];
  const wrote = trimmed.match(/^User wrote:\s*([\s\S]+)$/i);
  if (wrote?.[1]?.trim()) return [{ question: '', answer: wrote[1].trim() }];
  return [];
};

const questionsFromToolInput = (input) => {
  if (Array.isArray(input.questions)) {
    return input.questions.map((item) => (
      asTrimmedString(item?.question || item?.title || item?.header) || asTrimmedString(item)
    )).filter(Boolean);
  }
  const question = asTrimmedString(input.question || input.title);
  return question ? [question] : [];
};

const questionItemsFromToolPart = (part) => {
  const input = isRecord(part?.state?.input) ? part.state.input : {};
  const metadata = isRecord(part?.state?.metadata) ? part.state.metadata : {};
  const output = typeof part?.state?.output === 'string' ? part.state.output : '';
  const error = typeof part?.state?.error === 'string' ? part.state.error : '';
  const status = asTrimmedString(part?.state?.status);
  const cancelled = status === 'error' || status === 'cancelled'
    || /dismissed|cancelled|canceled|ignored/i.test(error)
    || /^User cancelled the selection/i.test(output.trim());
  const questions = questionsFromToolInput(input);
  const parsed = parseAnsweredQuestionOutput(output);
  const answers = Array.isArray(metadata.answers) ? metadata.answers : [];
  const metaAnswer = answersFromUnknown(metadata.answers ?? metadata.answer ?? metadata.value).filter(Boolean).join(', ');
  if (questions.length > 0) {
    return questions.map((question, index) => {
      const fromMeta = answersFromUnknown(answers[index]).filter(Boolean).join(', ');
      const fromParsed = parsed[index]?.answer || '';
      const fromSingle = questions.length === 1 ? metaAnswer : '';
      const answer = fromMeta || fromParsed || fromSingle;
      return {
        question,
        answer,
        cancelled: cancelled && !answer,
      };
    }).filter((item) => item.question);
  }
  if (parsed.length > 0) {
    return parsed.map((item) => ({
      question: item.question || asTrimmedString(metadata.question || part?.title),
      answer: item.answer,
      cancelled: false,
    }));
  }
  const title = asTrimmedString(metadata.question || input.title || part?.title);
  if (title) {
    return [{ question: title, answer: metaAnswer, cancelled: cancelled && !metaAnswer }];
  }
  return [];
};

const questionItemsFromUiPrompt = (prompt) => {
  if (!isRecord(prompt)) return [];
  const kind = asTrimmedString(prompt.kind).toLowerCase();
  if (kind && kind !== 'select' && kind !== 'confirm' && kind !== 'input' && kind !== 'editor') return [];
  const status = asTrimmedString(prompt.status).toLowerCase();
  const cancelled = status === 'cancelled' || status === 'canceled';
  const question = asTrimmedString(prompt.title || prompt.message || prompt.question);
  if (!question) return [];
  const answer = answersFromUnknown(prompt.value ?? prompt.answer).filter(Boolean).join(', ');
  return [{ question, answer, cancelled: cancelled && !answer }];
};

const collectQuestionItems = (entry, extras = []) => {
  const items = [];
  for (const part of Array.isArray(entry?.parts) ? entry.parts : []) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'tool' && isQuestionToolName(part.tool)) {
      items.push(...questionItemsFromToolPart(part));
      continue;
    }
    if (part.type === 'ui' || part.type === 'question' || part.type === 'select') {
      items.push(...questionItemsFromUiPrompt(part));
    }
  }
  for (const prompt of extras) items.push(...questionItemsFromUiPrompt(prompt));
  return items;
};

const htmlFromQuestionItems = (items, strings) => {
  if (!Array.isArray(items) || items.length === 0) return '';
  const answered = items.filter((item) => asTrimmedString(item.answer));
  if (answered.length === 0) return '';
  const countLabel = interpolate(strings.answered, { count: answered.length });
  const rows = answered.map((item) => {
    const question = escapeHtml(item.question);
    const answer = asTrimmedString(item.answer);
    return `<div class="qa-row"><div class="qa-q">${question}</div>${
      answer ? `<div class="qa-a">${escapeHtml(answer)}</div>` : ''
    }</div>`;
  }).join('');
  return `<details class="questions" open><summary>${CHEVRON_SVG}<span class="q-label">${escapeHtml(strings.questions)}</span> <span class="q-count">${escapeHtml(countLabel)}</span></summary><div class="qa-list">${rows}</div></details>`;
};

const htmlFromToolPart = (part, strings) => {
  if (isQuestionToolName(part?.tool)) return '';
  const name = escapeHtml(asTrimmedString(part?.tool) || 'tool');
  const status = asTrimmedString(part?.state?.status);
  const input = isRecord(part?.state?.input) ? part.state.input : {};
  const output = typeof part?.state?.output === 'string' ? part.state.output : '';
  const error = typeof part?.state?.error === 'string' ? part.state.error : '';
  const isError = status === 'error';
  const subtitle = escapeHtml(toolSubtitle(input));
  const result = isError ? (error || output || 'tool error') : output;
  const command = subtitle || name;
  return [
    `<details class="tool${isError ? ' error' : ''}">`,
    `<summary>${CHEVRON_SVG}<span class="tool-name">${name}</span>${subtitle ? `<span class="tool-sub">${subtitle}</span>` : ''}</summary>`,
    '<div class="tool-panel">',
    `<div class="tool-cmd"><span class="tool-prompt">$</span> ${command}</div>`,
    result ? `<pre class="tool-output tool-out">${escapeHtml(result)}</pre>` : '',
    result ? `<div class="tool-copy-row">${copyButton(strings.copyOutput, result)}</div>` : '',
    '</div>',
    '</details>',
  ].filter(Boolean).join('');
};

const htmlFromReasoningPart = (text) => {
  const body = asTrimmedString(text);
  if (!body) return '';
  return `<div class="thinking">${markdownToHtml(body)}</div>`;
};

const htmlFromUserEntry = (entry, strings) => {
  const parts = Array.isArray(entry?.parts) ? entry.parts : [];
  const texts = [];
  const media = [];
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' && typeof part.text === 'string' && part.text) {
      texts.push(part.text);
      continue;
    }
    if (part.type === 'file' || part.type === 'image') {
      media.push(safeBlock(() => htmlFromFilePart(part)));
    }
  }
  const text = texts.join('\n');
  if (!text && media.filter(Boolean).length === 0) return '';
  const clock = formatShareClock(entry?.info?.time?.created);
  return [
    '<div class="msg-user">',
    '<div class="user-col">',
    '<div class="bubble">',
    text ? `<div class="bubble-text">${escapeHtml(text).replace(/\n/g, '<br>\n')}</div>` : '',
    media.filter(Boolean).join('\n'),
    '</div>',
    (text || clock) ? `<div class="user-meta">${clock ? `<span>${escapeHtml(clock)}</span><span>·</span>` : ''}${text ? copyButton(strings.copyMessage, text) : ''}</div>` : '',
    '</div>',
    '</div>',
  ].filter(Boolean).join('');
};

const htmlFromAssistantEntry = (entry, strings, extras = []) => {
  const parts = Array.isArray(entry?.parts) ? entry.parts : [];
  const thinking = [];
  const answers = [];
  const tools = [];
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'reasoning') {
      thinking.push(safeBlock(() => htmlFromReasoningPart(part.text)));
      continue;
    }
    if (part.type === 'text' && typeof part.text === 'string' && part.text) {
      answers.push(part.text);
      continue;
    }
    if (part.type === 'tool') {
      tools.push(safeBlock(() => htmlFromToolPart(part, strings)));
      continue;
    }
    if (part.type === 'file' || part.type === 'image') {
      tools.push(safeBlock(() => htmlFromFilePart(part)));
    }
  }
  const answerText = answers.join('\n\n');
  const questions = htmlFromQuestionItems(collectQuestionItems(entry, extras), strings);
  return [
    thinking.filter(Boolean).join('\n'),
    questions,
    tools.filter(Boolean).join('\n'),
    answerText ? `<div class="body answer">${markdownToHtml(answerText)}</div>` : '',
  ].filter(Boolean).join('\n');
};

const turnsFromMessages = (messages) => {
  const turns = [];
  let current = null;
  for (const entry of Array.isArray(messages) ? messages : []) {
    const role = entry?.info?.role;
    if (role === 'user') {
      current = { user: entry, assistants: [] };
      turns.push(current);
      continue;
    }
    if (role === 'assistant') {
      if (!current) {
        current = { user: null, assistants: [] };
        turns.push(current);
      }
      current.assistants.push(entry);
    }
  }
  return turns;
};

const settledUiFromRecord = (record) => {
  const buckets = [];
  for (const key of ['settledUi', 'uiPrompts', 'extensionUIHistory']) {
    if (Array.isArray(record?.[key])) buckets.push(...record[key]);
  }
  return buckets;
};

const htmlFromTurnMeta = (assistants) => {
  if (!Array.isArray(assistants) || assistants.length === 0) return '';
  const model = lastUsableModelId(assistants.map((entry) => entry?.info));
  const plan = assistants.some((entry) => isPlanInfo(entry?.info));
  let start = null;
  let end = null;
  for (const entry of assistants) {
    const created = entry?.info?.time?.created;
    const completed = entry?.info?.time?.completed;
    if (typeof created === 'number' && Number.isFinite(created)) {
      start = start == null ? created : Math.min(start, created);
    }
    if (typeof completed === 'number' && Number.isFinite(completed)) {
      end = end == null ? completed : Math.max(end, completed);
    }
  }
  const duration = start != null && end != null && end >= start ? formatTurnDuration(end - start) : '';
  const bits = [
    plan ? 'Plan' : '',
    model,
    duration,
  ].filter(Boolean);
  if (bits.length === 0) return '';
  return `<footer class="turn-meta"><span>${escapeHtml(bits.join(' · '))}</span></footer>`;
};

const htmlFromTurn = (turn, index, strings, extras) => {
  const id = `turn-${index + 1}`;
  const user = safeBlock(() => (turn.user ? htmlFromUserEntry(turn.user, strings) : ''));
  const assistants = (turn.assistants || []).map((entry) => safeBlock(() => htmlFromAssistantEntry(entry, strings, extras)));
  const answerText = (turn.assistants || []).flatMap((entry) => (
    (Array.isArray(entry?.parts) ? entry.parts : [])
      .filter((part) => part?.type === 'text' && typeof part.text === 'string' && part.text)
      .map((part) => part.text)
  )).join('\n\n');
  const meta = safeBlock(() => htmlFromTurnMeta(turn.assistants));
  const metaWithCopy = meta
    ? meta.replace('</footer>', `${answerText ? copyButton(strings.copyAnswer, answerText) : ''}</footer>`)
    : (answerText ? `<footer class="turn-meta">${copyButton(strings.copyAnswer, answerText)}</footer>` : '');
  return `<article class="turn" id="${id}">\n${[user, ...assistants, metaWithCopy].filter(Boolean).join('\n')}\n</article>`;
};

const htmlFromSessionMeta = (record, version) => {
  const messages = Array.isArray(record?.messages) ? record.messages : [];
  const model = lastUsableModelId(messages.map((entry) => entry?.info));
  const date = formatShareDate(record?.info?.time?.created);
  const versionLabel = asTrimmedString(version) ? `v${asTrimmedString(version)}` : '';
  return `<div class="session-meta">
<span class="session-version">${PI_PIXEL_MARK_SVG}${versionLabel ? `<span> ${escapeHtml(versionLabel)}</span>` : ''}</span>
<span class="session-model">${STAR_ICON_SVG}${model ? `<span>${escapeHtml(model)}</span>` : ''}</span>
<span class="session-date">${escapeHtml(date)}</span>
</div>`;
};

const SESSION_HTML_STYLES = `:root {
  --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}
html[data-theme="dark"] {
  color-scheme: dark;
  --background-base: #101010;
  --background-strong: #121212;
  --background-stronger: #151515;
  --background-weak: #1e1e1e;
  --text-strong: #ffffffef;
  --text-base: #ffffff9e;
  --text-weak: #ffffff6c;
  --text-weaker: #ffffff48;
  --border-weak-base: #282828;
  --border-weaker-base: #202020;
  --surface-base: #ffffff08;
  --surface-strong: #ffffff2b;
  --icon-strong-base: #ededed;
  --icon-base: #7e7e7e;
  --icon-weak-base: #343434;
  --markdown-text: #eee;
  --markdown-link-text: #56b6c2;
  --code-bg: #ffffff14;
  --critical: #fc533a;
}
html[data-theme="light"] {
  color-scheme: light;
  --background-base: #f8f8f8;
  --background-strong: #fcfcfc;
  --background-stronger: #fcfcfc;
  --background-weak: #f3f3f3;
  --text-strong: #171717;
  --text-base: #6f6f6f;
  --text-weak: #8f8f8f;
  --text-weaker: #c7c7c7;
  --border-weak-base: #e5e5e5;
  --border-weaker-base: #ececec;
  --surface-base: #00000008;
  --surface-strong: #fff;
  --icon-strong-base: #171717;
  --icon-base: #8f8f8f;
  --icon-weak-base: #dbdbdb;
  --markdown-text: #1a1a1a;
  --markdown-link-text: #318795;
  --code-bg: #0000000d;
  --critical: #b42318;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  height: 100%;
  background: var(--background-stronger);
  color: var(--text-strong);
  font: 13px/1.5 var(--font-sans);
  -webkit-font-smoothing: antialiased;
  overscroll-behavior: none;
}
button, a { font: inherit; color: inherit; }
button { background: none; border: 0; padding: 0; cursor: pointer; }
a { text-decoration: none; }
.shell { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.topbar {
  height: 48px;
  padding: 8px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--background-base);
  border-bottom: 1px solid var(--border-weak-base);
  flex-shrink: 0;
}
.brand { color: var(--icon-strong-base); display: flex; }
.pichamber-mark { display: block; width: 18px; height: 18px; color: var(--icon-strong-base); }
.pi-mark { display: block; width: 12px; height: 12px; }
.topbar-right { display: flex; gap: 12px; align-items: center; }
.topbar-right a, .theme-toggle, .copy {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--icon-base);
  border-radius: 6px;
}
.topbar-right a:hover, .theme-toggle:hover, .copy:hover { color: var(--icon-strong-base); background: var(--surface-base); }
.topbar-right a svg, .theme-toggle svg { width: 16px; height: 16px; }
.copy svg { width: 14px; height: 14px; }
html[data-theme="dark"] .icon-moon, html[data-theme="light"] .icon-sun { display: none; }
.scroller { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: none; }
.scroller::-webkit-scrollbar { display: none; }
.page { position: relative; max-width: 52rem; margin: 0 auto; padding: 56px 24px 96px; }
.session-header { margin-bottom: 40px; }
.session-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  min-height: 32px;
  margin: 0 0 16px;
}
.session-version {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 2px 8px 2px 6px;
  background: var(--surface-strong);
  box-shadow: 0 0 0 1px var(--border-weak-base);
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-strong);
}
.session-version svg { width: 12px; height: 12px; color: var(--icon-strong-base); }
.session-model svg { width: 12px; height: 12px; color: var(--text-weak); }
.session-model {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-base);
  font-size: 12px;
}
.session-date { margin-left: auto; color: var(--text-weaker); font-size: 12px; }
.session-title {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: var(--text-strong);
}
.layout { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 16px; }
.ticks { position: sticky; top: 0; padding-top: 8px; display: flex; flex-direction: column; }
.ticks a {
  width: 24px;
  height: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0;
  color: transparent;
}
.ticks a i {
  display: block;
  width: 10px;
  height: 1px;
  background: var(--border-weak-base);
}
.ticks a.current i { width: 14px; background: var(--text-base); }
.transcript { display: flex; flex-direction: column; gap: 40px; min-width: 0; }
.turn { scroll-margin-top: 16px; }
.msg-user { display: flex; justify-content: flex-end; }
.user-col { max-width: min(36rem, 92%); }
.bubble {
  background: var(--background-weak);
  color: var(--text-strong);
  border-radius: 10px;
  padding: 10px 14px;
}
.bubble-text { white-space: pre-wrap; word-break: break-word; }
.user-meta, .turn-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  color: var(--text-weak);
  font-size: 12px;
}
.user-meta { justify-content: flex-end; }
.thinking { color: var(--text-weak); margin: 0 0 16px; white-space: pre-wrap; }
.thinking p { margin: 0 0 12px; }
.thinking p:last-child { margin-bottom: 0; }
.questions { margin: 16px 0 20px; color: var(--text-base); }
.tool { margin: 8px 0; }
.questions summary, .tool summary {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 32px;
  cursor: pointer;
  list-style: none;
  color: var(--text-base);
}
.questions summary { gap: 8px; }
.questions summary::-webkit-details-marker, .tool summary::-webkit-details-marker { display: none; }
.chevron {
  width: 12px;
  height: 12px;
  color: var(--text-weaker);
  flex: none;
  transition: transform .15s;
}
.questions:not([open]) .chevron, .tool:not([open]) .chevron { transform: rotate(-90deg); }
.q-label, .q-count { color: var(--text-base); }
.tool-name { color: var(--text-strong); font-weight: 500; min-width: 3.5rem; }
.tool-sub {
  color: var(--text-weak);
  font-family: var(--font-mono);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qa-list { margin: 12px 0 0 20px; display: flex; flex-direction: column; gap: 12px; }
.qa-q { color: var(--text-weak); margin-bottom: 2px; }
.qa-a { color: var(--text-strong); }
.tool-panel {
  margin: 6px 0 12px 22px;
  border: 1px solid var(--border-weak-base);
  border-radius: 8px;
  background: var(--background-base);
  overflow: hidden;
}
.tool-cmd {
  padding: 10px 12px 0;
  color: var(--text-strong);
  font-family: var(--font-mono);
  font-size: 12px;
}
.tool-output {
  margin: 0;
  padding: 10px 12px 12px;
  white-space: pre-wrap;
  word-break: break-word;
  font: 12px/1.5 var(--font-mono);
  color: var(--text-base);
}
.tool-copy-row { display: flex; justify-content: flex-end; padding: 0 8px 8px; }
.tool-prompt { color: var(--text-weaker); margin-right: 0.35rem; }
.tool.error .tool-name, .tool.error .tool-output { color: var(--critical); }
.body { color: var(--markdown-text); }
.body .copy { margin-top: 8px; }
.body h1, .body h2 { font-size: 15px; font-weight: 500; margin: 28px 0 12px; color: var(--text-strong); }
.body h3, .body h4, .body h5, .body h6 { font-size: 13px; font-weight: 500; margin: 20px 0 8px; color: var(--text-strong); }
.body p { margin: 0 0 12px; }
.body ul, .body ol { margin: 0 0 12px; padding-left: 1.2em; }
.body li { margin: 4px 0; }
.body a { color: var(--markdown-link-text); }
.body hr { border: 0; border-top: 1px solid var(--border-weak-base); margin: 24px 0; }
.body blockquote { margin: 12px 0; padding-left: 0.85rem; border-left: 2px solid var(--border-weak-base); color: var(--text-weak); }
.body table { width: 100%; border-collapse: collapse; margin: 12px 0; }
.body th, .body td { border: 1px solid var(--border-weak-base); padding: 0.35rem 0.5rem; text-align: left; }
.body pre {
  margin: 12px 0;
  padding: 10px 12px;
  background: var(--code-bg);
  border-radius: 8px;
  white-space: pre-wrap;
  word-break: break-word;
  font: 12px/1.5 var(--font-mono);
}
.body code, .thinking code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--code-bg);
  border-radius: 4px;
  padding: 1px 5px;
}
.body pre code { background: none; padding: 0; }
.image { margin: 8px 0; }
.image img { max-width: 100%; height: auto; border-radius: 4px; }
.image-omitted, .file-omitted { color: var(--text-weak); font-style: italic; }
.page-footer { margin-top: 72px; text-align: center; }
.watermark {
  margin: 0;
  font-size: 72px;
  font-weight: 600;
  letter-spacing: -0.05em;
  color: var(--text-weaker);
  opacity: .28;
  line-height: 1;
  user-select: none;
}
.ignored {
  position: absolute;
  right: 24px;
  bottom: 20px;
  margin: 0;
  color: var(--text-weaker);
  font-size: 12px;
}
.toast {
  position: fixed;
  right: 20px;
  bottom: 20px;
  background: var(--background-weak);
  color: var(--text-strong);
  border: 1px solid var(--border-weak-base);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  opacity: 0;
  pointer-events: none;
  transition: opacity .2s;
}
.toast.show { opacity: 1; }
@media (max-width: 720px) {
  .layout { grid-template-columns: 1fr; }
  .ticks { display: none; }
  .page { padding: 32px 16px 80px; }
  .watermark { font-size: 40px; }
}`;

const SESSION_HTML_BOOT = `!function(){try{var k=${JSON.stringify(EXPORT_THEME_KEY)};var s=localStorage.getItem(k);var t=(s==="light"||s==="dark")?s:(window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","dark");}}();`;

const sessionHtmlScript = (strings) => `!function(){var root=document.documentElement;var key=${JSON.stringify(EXPORT_THEME_KEY)};var toggle=document.querySelector("[data-theme-toggle]");var toast=document.querySelector(".toast");var copied=${JSON.stringify(strings.copied)};var failed=${JSON.stringify(strings.copyFailed)};var toLight=${JSON.stringify(strings.themeToLight)};var toDark=${JSON.stringify(strings.themeToDark)};function theme(){return root.getAttribute("data-theme")==="light"?"light":"dark";}function syncThemeLabel(){if(toggle)toggle.setAttribute("aria-label",theme()==="light"?toDark:toLight);}function setTheme(next){root.setAttribute("data-theme",next);try{localStorage.setItem(key,next);}catch(e){}syncThemeLabel();}syncThemeLabel();if(toggle)toggle.addEventListener("click",function(){setTheme(theme()==="dark"?"light":"dark");});var toastTimer;function showToast(text){if(!toast)return;toast.textContent=text;toast.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(function(){toast.classList.remove("show");},1200);}document.addEventListener("click",function(event){var button=event.target.closest("[data-copy]");if(!button)return;var text=button.getAttribute("data-copy")||"";if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(function(){showToast(copied);}).catch(function(){showToast(failed);});return;}var area=document.createElement("textarea");area.value=text;document.body.appendChild(area);area.select();try{document.execCommand("copy");showToast(copied);}catch(e){showToast(failed);}area.remove();});var ticks=Array.prototype.slice.call(document.querySelectorAll(".ticks a"));var turns=Array.prototype.slice.call(document.querySelectorAll(".turn"));var scroller=document.querySelector(".scroller");function mark(id){ticks.forEach(function(tick){tick.classList.toggle("current",tick.getAttribute("href")==="#"+id);});}function syncTicks(){var active=turns[0];turns.forEach(function(turn){if(turn.getBoundingClientRect().top<160)active=turn;});if(active)mark(active.id);}if(turns[0])mark(turns[0].id);if(scroller)scroller.addEventListener("scroll",syncTicks,{passive:true});ticks.forEach(function(tick){tick.addEventListener("click",function(){mark(tick.getAttribute("href").slice(1));});});}();`;

export const buildSessionHtml = (record, options = {}) => {
  const locale = normalizeExportLocale(options?.locale || record?.locale || record?.info?.locale);
  const strings = exportStrings(locale);
  const rawTitle = asTrimmedString(record?.info?.title) || 'Session';
  const title = escapeHtml(rawTitle);
  const version = asTrimmedString(options?.piVersion) || readPiCodingAgentVersion();
  const extras = settledUiFromRecord(record);
  const turns = turnsFromMessages(record?.messages);
  const cancelled = [
    ...turns.flatMap((turn) => (turn.assistants || []).flatMap((entry) => collectQuestionItems(entry, extras))),
    ...extras.flatMap((prompt) => questionItemsFromUiPrompt(prompt)),
  ].some((item) => item.cancelled);
  const articles = turns.map((turn, index) => htmlFromTurn(turn, index, strings, extras)).join('\n');
  const ticks = turns.map((_, index) => `<a class="tick" href="#turn-${index + 1}"><i></i></a>`).join('');
  return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<script>${SESSION_HTML_BOOT}</script>
<style>
${SESSION_HTML_STYLES}
</style>
</head>
<body>
<div class="shell">
<header class="topbar">
<a class="brand" href="${PICHAMBER_REPO_HREF}" aria-label="${escapeHtml(strings.logo)}">${PICHAMBER_MARK_SVG}</a>
<div class="topbar-right">
<a href="${PICHAMBER_REPO_HREF}" aria-label="${escapeHtml(strings.github)}">${GITHUB_ICON_SVG}</a>
<button type="button" class="theme-toggle" data-theme-toggle aria-label="${escapeHtml(strings.themeToggle)}">${THEME_ICON_SVG}</button>
</div>
</header>
<div class="scroller">
<div class="page">
<header class="session-header">
${htmlFromSessionMeta(record, version)}
<h1 class="session-title">${title}</h1>
</header>
<div class="layout">
<nav class="ticks" aria-hidden="true">${ticks}</nav>
<main class="transcript">
${articles}
</main>
</div>
<footer class="page-footer">
<p class="watermark">pichamber</p>
${cancelled ? `<p class="ignored">${escapeHtml(strings.ignored)}</p>` : ''}
</footer>
</div>
</div>
</div>
<div class="toast" aria-live="polite"></div>
<script>${sessionHtmlScript(strings)}</script>
</body>
</html>
`;
};

const facadeFromPiMessage = (entry, fallbackModel) => {
  const message = entry?.message && typeof entry.message === 'object' ? entry.message : {};
  if (message.role === 'toolResult') return null;
  const role = message.role === 'assistant' ? 'assistant' : 'user';
  const messageID = asTrimmedString(entry?.id) || createMessageId();
  const created = millisFromUnknown(entry?.timestamp ?? message.timestamp);
  return {
    info: {
      id: messageID,
      role,
      agent: 'pi',
      ...(role === 'assistant' ? { mode: 'pi' } : {}),
      ...(asTrimmedString(entry?.parentId) ? { parentID: entry.parentId } : {}),
      ...facadeAssistantInfoFromPiMessage(message, fallbackModel),
      ...facadeMessageTimeFromPi(message, created),
    },
    parts: partsFromPiContent(message.content, '', messageID),
  };
};

const registerToolParts = (parts, toolPartsByCallID) => {
  for (const part of parts) {
    const callID = asTrimmedString(part?.callID);
    if (part?.type === 'tool' && callID) {
      toolPartsByCallID.set(callID, part);
    }
  }
};

/**
 * Read every JSONL entry from a Pi session file.
 * One malformed line is skipped. A missing file is empty, not thrown.
 */
export const readPiSessionFileEntries = (file) => {
  const path = asTrimmedString(file);
  if (!path) return [];
  let text;
  try {
    text = fs.readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Keep the rest of the transcript.
    }
  }
  return entries;
};

/**
 * Transcript for opening a session: the full jsonl, not the live leaf path.
 * `getBranch` / `buildContextEntries` omit compacted and abandoned turns.
 */
export const transcriptEntriesForHydrate = ({ file, manager } = {}) => {
  const fromFile = readPiSessionFileEntries(file);
  if (fromFile.length > 0) return fromFile;
  if (typeof manager?.getEntries === 'function') {
    const entries = manager.getEntries();
    if (Array.isArray(entries) && entries.length > 0) return entries;
  }
  return [];
};

const userTextFromFacade = (entry) => {
  const parts = Array.isArray(entry?.parts) ? entry.parts : [];
  return parts
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text.trim())
    .join('\n');
};

/**
 * Keep live / optimistic user ids when disk hydrate has the same turn
 * under a Pi-native id. Otherwise one send becomes two bubbles.
 */
const isGoalCommandFacadeUser = (entry) => (
  entry?.info?.role === 'user' && /^\/goal(?::\d+)?\s+\S/i.test(userTextFromFacade(entry))
);

/**
 * Client transcripts sort by time.created. After hydrate, Pi assistant times
 * can be earlier than the facade /goal bubble — array order is not enough.
 */
export const stampGoalCommandChronology = (messages) => {
  if (!Array.isArray(messages)) return messages;
  for (let index = 0; index < messages.length; index += 1) {
    if (!isGoalCommandFacadeUser(messages[index])) continue;
    let end = index + 1;
    while (end < messages.length && !isGoalCommandFacadeUser(messages[end])) end += 1;
    const previousCreated = messages[index - 1]?.info?.time?.created;
    const base = (typeof previousCreated === 'number' ? previousCreated : Date.now()) + 1;
    for (let cursor = index; cursor < end; cursor += 1) {
      const entry = messages[cursor];
      if (!entry?.info) continue;
      entry.info.time = { ...(entry.info.time || {}), created: base + (cursor - index) };
    }
  }
  return messages;
};

/** Keep the live /goal bubble ahead of Goal-turn assistants after jsonl hydrate. */
export const restoreGoalCommandPlacement = (live, hydrated) => {
  const previous = Array.isArray(live) ? live : [];
  const next = Array.isArray(hydrated) ? [...hydrated] : [];
  const goals = previous.filter(isGoalCommandFacadeUser);
  if (goals.length === 0) return stampGoalCommandChronology(next);
  const taken = new Set();
  const without = next.filter((entry) => {
    if (!isGoalCommandFacadeUser(entry)) return true;
    const text = userTextFromFacade(entry);
    const match = goals.findIndex((goal, index) => (
      !taken.has(index)
      && (goal.info.id === entry.info.id || userTextFromFacade(goal) === text)
    ));
    if (match < 0) return true;
    taken.add(match);
    return false;
  });
  for (const goal of goals) {
    const liveIndex = previous.findIndex((entry) => entry?.info?.id === goal.info.id);
    const after = liveIndex >= 0 ? previous[liveIndex + 1] : null;
    const before = liveIndex > 0 ? previous[liveIndex - 1] : null;
    let insertAt = without.length;
    if (after?.info?.id) {
      const afterIdx = without.findIndex((entry) => entry?.info?.id === after.info.id);
      if (afterIdx >= 0) insertAt = afterIdx;
    } else if (before?.info?.id) {
      const beforeIdx = without.findIndex((entry) => entry?.info?.id === before.info.id);
      if (beforeIdx >= 0) insertAt = beforeIdx + 1;
    }
    without.splice(insertAt, 0, goal);
  }
  return stampGoalCommandChronology(without);
};

export const reconcileHydratedMessages = (live, hydrated) => {
  const next = Array.isArray(hydrated) ? hydrated : [];
  const previous = Array.isArray(live) ? live : [];
  if (previous.length === 0) return next;
  // Disk has not caught up (or has only metadata). Do not wipe the live turn.
  if (next.length === 0 || next.length < previous.length) {
    return restoreGoalCommandPlacement(previous, previous);
  }
  const liveUsers = previous.filter((entry) => entry?.info?.role === 'user');
  if (liveUsers.length === 0) return next;
  const used = new Set();
  const matched = next.map((entry) => {
    if (entry?.info?.role !== 'user') return entry;
    const text = userTextFromFacade(entry);
    if (!text) return entry;
    const matchIndex = liveUsers.findIndex((candidate, index) => (
      !used.has(index) && userTextFromFacade(candidate) === text
    ));
    if (matchIndex < 0) return entry;
    used.add(matchIndex);
    const liveEntry = liveUsers[matchIndex];
    const liveId = asTrimmedString(liveEntry?.info?.id);
    const liveParts = Array.isArray(liveEntry?.parts) ? liveEntry.parts : [];
    const liveHasContext = liveParts.some((part) => {
      const metadata = part?.metadata;
      if (!metadata || typeof metadata !== 'object') return false;
      return Boolean(metadata.pichamberContext || metadata.openchamberContext);
    });
    if (liveHasContext) {
      const id = liveId || entry.info.id;
      return {
        ...entry,
        info: { ...entry.info, id },
        parts: liveParts.map((part) => ({
          ...part,
          messageID: id,
        })),
      };
    }
    if (!liveId || liveId === entry.info.id) return entry;
    return {
      ...entry,
      info: { ...entry.info, id: liveId },
      parts: (Array.isArray(entry.parts) ? entry.parts : []).map((part) => ({
        ...part,
        messageID: liveId,
      })),
    };
  });
  return restoreGoalCommandPlacement(previous, matched);
};

export const facadeMessagesFromPiEntries = (entries, sessionID, options = {}) => {
  const id = asTrimmedString(sessionID);
  const fallbackModel = isRecord(options) ? options.fallbackModel : undefined;
  const messages = [];
  const toolPartsByCallID = new Map();
  let lastUserId = '';
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.type && entry.type !== 'message') continue;
    if (!entry?.message) continue;
    const message = entry.message;
    if (message.role === 'toolResult') {
      const callID = asTrimmedString(message.toolCallId);
      const part = callID ? toolPartsByCallID.get(callID) : null;
      if (part) applyToolResultToPart(part, message);
      continue;
    }
    const facade = facadeFromPiMessage(entry, fallbackModel);
    if (!facade) continue;
    if (facade.info.role === 'user') {
      lastUserId = facade.info.id;
    } else if (facade.info.role === 'assistant' && lastUserId) {
      // Pi jsonl parentId is the previous line (often toolResult). Chat turns
      // group assistants by parentID === the user message, same as live SSE.
      const rawParent = asTrimmedString(facade.info.parentID);
      const parentIsUser = rawParent && messages.some((item) => (
        item.info.role === 'user' && item.info.id === rawParent
      ));
      if (!parentIsUser) facade.info.parentID = lastUserId;
    }
    if (id) {
      facade.info.sessionID = id;
      facade.parts = facade.parts.map((part) => ({
        ...part,
        sessionID: id,
        messageID: facade.info.id,
      }));
    }
    registerToolParts(facade.parts, toolPartsByCallID);
    messages.push(facade);
  }
  return messages;
};

const facadeFromUnknown = (entry) => {
  if (entry?.info && Array.isArray(entry.parts)) {
    return {
      info: { ...entry.info },
      parts: entry.parts.map((part) => ({ ...part })),
    };
  }
  if (entry?.type === 'message' && entry.message) {
    return facadeFromPiMessage(entry);
  }
  if (entry?.role && (entry.content !== undefined || Array.isArray(entry.parts))) {
    if (entry.role === 'toolResult') return null;
    const messageID = asTrimmedString(entry.id) || createMessageId();
    const role = entry.role === 'assistant' ? 'assistant' : 'user';
    const created = millisFromUnknown(entry.timestamp ?? entry.time?.created);
    return {
      info: {
        id: messageID,
        role,
        agent: 'pi',
        ...(role === 'assistant' ? { mode: 'pi' } : {}),
        ...facadeAssistantInfoFromPiMessage(entry),
        ...facadeMessageTimeFromPi(entry, created),
      },
      parts: Array.isArray(entry.parts)
        ? entry.parts.map((part) => ({ ...part, messageID }))
        : partsFromPiContent(entry.content, '', messageID),
    };
  }
  return null;
};

export const parseSessionImport = (raw) => {
  const source = typeof raw === 'string' ? raw.trim() : '';
  if (!source) {
    const error = new Error('Import body is empty');
    error.status = 400;
    throw error;
  }

  let title = '';
  let cwd = '';
  const messages = [];

  const ingestMeta = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    if (entry.type === 'session') {
      cwd = asTrimmedString(entry.cwd) || cwd;
      return;
    }
    if (entry.type === 'session_info' && asTrimmedString(entry.name)) {
      title = asTrimmedString(entry.name);
    }
  };

  const ingestFacade = (entry) => {
    ingestMeta(entry);
    const facade = facadeFromUnknown(entry);
    if (facade) messages.push(facade);
  };

  const ingestEntries = (entries) => {
    for (const entry of entries) ingestMeta(entry);
    const mapped = facadeMessagesFromPiEntries(entries);
    if (mapped.length > 0) {
      messages.push(...mapped);
      return;
    }
    for (const entry of entries) ingestFacade(entry);
  };

  if (source.startsWith('[')) {
    let parsed;
    try {
      parsed = JSON.parse(source);
    } catch {
      const error = new Error('Invalid JSON session import');
      error.status = 400;
      throw error;
    }
    if (!Array.isArray(parsed)) {
      const error = new Error('JSON import must be an array of messages');
      error.status = 400;
      throw error;
    }
    ingestEntries(parsed);
  } else {
    const entries = [];
    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed));
      } catch {
        const error = new Error('Invalid JSONL session import');
        error.status = 400;
        throw error;
      }
    }
    ingestEntries(entries);
  }

  if (messages.length === 0) {
    const error = new Error('Import did not contain any messages');
    error.status = 400;
    throw error;
  }

  if (!title) {
    const firstUser = messages.find((entry) => entry.info?.role === 'user');
    const preview = textFromFacadeParts(firstUser?.parts).replace(/\s+/g, ' ').trim().slice(0, 80);
    title = preview || 'Imported session';
  }

  return { title, cwd, messages };
};

export const firstUserPreview = (messages) => {
  const firstUser = (messages || []).find((entry) => entry.info?.role === 'user');
  return textFromFacadeParts(firstUser?.parts).replace(/\s+/g, ' ').trim();
};
