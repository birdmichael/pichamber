import { createRequire } from 'node:module';

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
  if (asTrimmedString(value.modelID)) return true;
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
      source.modelID || (looksLikeModelRecord(source) ? source.id : ''),
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
    return message.timestamp;
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
  if (typeof value === 'number' && Number.isFinite(value)) return value;
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
  part.state = {
    status: isError ? 'error' : 'completed',
    input,
    output,
    ...(isError ? { error: output || 'tool error' } : {}),
    ...(details ? { metadata: details } : {}),
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
      parts.push({
        id: createPartId(),
        sessionID,
        messageID,
        type: 'text',
        text: item.text,
      });
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
      content.push({ type: 'text', text: part.text });
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

const formatShareDate = (value) => {
  if (value == null || value === '') return '';
  const millis = typeof value === 'number' && Number.isFinite(value)
    ? value
    : Date.parse(isoFromUnknown(value));
  if (!Number.isFinite(millis)) return '';
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return '';
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${date.getUTCDate()} ${SHARE_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${hours}:${minutes}`;
};

const formatModelLabel = (info) => {
  const resolved = resolveUsableFacadeModel(info);
  if (!resolved) return '';
  return `${resolved.providerID}/${resolved.modelID}`;
};

const EXPORT_LOCALES = {
  en: {
    copy: 'Copy',
    copyMessage: 'Copy message',
    copyAnswer: 'Copy reply',
    copyOutput: 'Copy output',
    questions: 'Questions',
    answered: '{count} answered',
    ignored: 'Questions dismissed',
    themeToggle: 'Toggle light and dark theme',
    github: 'GitHub',
    logo: 'Pichamber',
  },
  de: {
    copy: 'Kopieren',
    copyMessage: 'Nachricht kopieren',
    copyAnswer: 'Antwort kopieren',
    copyOutput: 'Ausgabe kopieren',
    questions: 'Fragen',
    answered: '{count} beantwortet',
    ignored: 'Fragen ignoriert',
    themeToggle: 'Hell- und Dunkelmodus umschalten',
    github: 'GitHub',
    logo: 'Pichamber',
  },
  es: {
    copy: 'Copiar',
    copyMessage: 'Copiar mensaje',
    copyAnswer: 'Copiar respuesta',
    copyOutput: 'Copiar salida',
    questions: 'Preguntas',
    answered: '{count} respondidas',
    ignored: 'Preguntas omitidas',
    themeToggle: 'Alternar tema claro y oscuro',
    github: 'GitHub',
    logo: 'Pichamber',
  },
  fr: {
    copy: 'Copier',
    copyMessage: 'Copier le message',
    copyAnswer: 'Copier la réponse',
    copyOutput: 'Copier la sortie',
    questions: 'Questions',
    answered: '{count} répondues',
    ignored: 'Questions ignorées',
    themeToggle: 'Basculer entre le thème clair et sombre',
    github: 'GitHub',
    logo: 'Pichamber',
  },
  ja: {
    copy: 'コピー',
    copyMessage: 'メッセージをコピー',
    copyAnswer: '返信をコピー',
    copyOutput: '出力をコピー',
    questions: '質問',
    answered: '{count} 件回答済み',
    ignored: '質問は無視されました',
    themeToggle: 'ライトとダークのテーマを切り替え',
    github: 'GitHub',
    logo: 'Pichamber',
  },
  ko: {
    copy: '복사',
    copyMessage: '메시지 복사',
    copyAnswer: '답변 복사',
    copyOutput: '출력 복사',
    questions: '질문',
    answered: '{count}개 답변됨',
    ignored: '질문이 무시됨',
    themeToggle: '밝은 테마와 어두운 테마 전환',
    github: 'GitHub',
    logo: 'Pichamber',
  },
  pl: {
    copy: 'Kopiuj',
    copyMessage: 'Kopiuj wiadomość',
    copyAnswer: 'Kopiuj odpowiedź',
    copyOutput: 'Kopiuj wynik',
    questions: 'Pytania',
    answered: 'odpowiedziano na {count}',
    ignored: 'Pytania pominięte',
    themeToggle: 'Przełącz jasny i ciemny motyw',
    github: 'GitHub',
    logo: 'Pichamber',
  },
  'pt-BR': {
    copy: 'Copiar',
    copyMessage: 'Copiar mensagem',
    copyAnswer: 'Copiar resposta',
    copyOutput: 'Copiar saída',
    questions: 'Perguntas',
    answered: '{count} respondidas',
    ignored: 'Perguntas ignoradas',
    themeToggle: 'Alternar tema claro e escuro',
    github: 'GitHub',
    logo: 'Pichamber',
  },
  uk: {
    copy: 'Копіювати',
    copyMessage: 'Копіювати повідомлення',
    copyAnswer: 'Копіювати відповідь',
    copyOutput: 'Копіювати вивід',
    questions: 'Питання',
    answered: 'відповідей: {count}',
    ignored: 'Питання проігноровано',
    themeToggle: 'Перемкнути світлу й темну тему',
    github: 'GitHub',
    logo: 'Pichamber',
  },
  'zh-CN': {
    copy: '复制',
    copyMessage: '复制消息',
    copyAnswer: '复制回复',
    copyOutput: '复制输出',
    questions: '问题',
    answered: '已回答 {count} 个',
    ignored: '问题已忽略',
    themeToggle: '切换浅色或深色主题',
    github: 'GitHub',
    logo: 'Pichamber',
  },
  'zh-TW': {
    copy: '複製',
    copyMessage: '複製訊息',
    copyAnswer: '複製回覆',
    copyOutput: '複製輸出',
    questions: '問題',
    answered: '已回答 {count} 個',
    ignored: '問題已忽略',
    themeToggle: '切換淺色或深色主題',
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

const PICHAMBER_MARK_SVG = `<svg class="pichamber-mark" viewBox="0 0 100 100" width="24" height="24" fill="none" aria-hidden="true"><path d="M50 50 L8.432 26 L8.432 74 L50 98 Z" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M50 50 L91.568 26 L91.568 74 L50 98 Z" fill="currentColor" fill-opacity="0.35" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M50 2 L8.432 26 L50 50 L91.568 26 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><g transform="matrix(0.866, 0.5, -0.866, 0.5, 50, 26) scale(0.068)" fill="currentColor"><path fill-rule="evenodd" d="M-234.71 -234.71 H117.36 V0 H0 V117.36 H-117.35 V234.72 H-234.71 Z M-117.35 -117.35 V0 H0 V-117.35 Z"/><path d="M117.36 0 H234.72 V234.72 H117.36 Z"/></g></svg>`;

const PI_PIXEL_MARK_SVG = `<svg class="pi-mark" viewBox="-235 -235 470 470" width="14" height="14" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M-234.71 -234.71 H117.36 V0 H0 V117.36 H-117.35 V234.72 H-234.71 Z M-117.35 -117.35 V0 H0 V-117.35 Z"/><path d="M117.36 0 H234.72 V234.72 H117.36 Z"/></svg>`;

const GITHUB_ICON_SVG = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"/></svg>`;

const THEME_ICON_SVG = `<svg class="icon-sun" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="8" cy="8" r="2.6"/><path d="M8 1.6v1.5M8 12.9v1.5M1.6 8h1.5M12.9 8h1.5M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1"/></svg><svg class="icon-moon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12.6 10.2A5.6 5.6 0 0 1 5.8 3.4 5.6 5.6 0 1 0 12.6 10.2Z"/></svg>`;

const STAR_ICON_SVG = `<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M8 1.4 9.9 5.3l4.3.6-3.1 3 0.7 4.3L8 11.2 4.2 13.2l.7-4.3-3.1-3 4.3-.6Z"/></svg>`;

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

const lastUsableModelLabel = (sources) => {
  for (let index = sources.length - 1; index >= 0; index -= 1) {
    const label = formatModelLabel(sources[index]);
    if (label) return label;
  }
  return '';
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
  `<button type="button" class="copy" data-copy="${escapeHtml(text)}" aria-label="${escapeHtml(label)}">${escapeHtml(label)}</button>`
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
  if (!match) return [];
  const pairs = [];
  const pairRegex = /"([^"]+)"="([^"]*)"/g;
  let pairMatch = pairRegex.exec(match[1]);
  while (pairMatch) {
    pairs.push({ question: pairMatch[1], answer: pairMatch[2] });
    pairMatch = pairRegex.exec(match[1]);
  }
  return pairs;
};

const questionItemsFromToolPart = (part) => {
  const input = isRecord(part?.state?.input) ? part.state.input : {};
  const metadata = isRecord(part?.state?.metadata) ? part.state.metadata : {};
  const output = typeof part?.state?.output === 'string' ? part.state.output : '';
  const error = typeof part?.state?.error === 'string' ? part.state.error : '';
  const status = asTrimmedString(part?.state?.status);
  const cancelled = status === 'error' || status === 'cancelled'
    || /dismissed|cancelled|canceled|ignored/i.test(error);
  const questions = Array.isArray(input.questions) ? input.questions : [];
  const parsed = parseAnsweredQuestionOutput(output);
  const answers = Array.isArray(metadata.answers) ? metadata.answers : [];
  if (questions.length > 0) {
    return questions.map((item, index) => {
      const question = asTrimmedString(item?.question || item?.title || item?.header) || asTrimmedString(item);
      const fromMeta = answersFromUnknown(answers[index]).filter(Boolean).join(', ');
      const fromParsed = parsed[index]?.answer || '';
      return {
        question,
        answer: fromMeta || fromParsed,
        cancelled: cancelled && !fromMeta && !fromParsed,
      };
    }).filter((item) => item.question);
  }
  if (parsed.length > 0) {
    return parsed.map((item) => ({ ...item, cancelled: false }));
  }
  const title = asTrimmedString(input.title || part?.title);
  if (title) {
    const answer = answersFromUnknown(metadata.answers ?? metadata.value).filter(Boolean).join(', ');
    return [{ question: title, answer, cancelled: cancelled && !answer }];
  }
  return [];
};

const questionItemsFromUiPrompt = (prompt) => {
  if (!isRecord(prompt)) return [];
  const kind = asTrimmedString(prompt.kind).toLowerCase();
  if (kind && kind !== 'select' && kind !== 'confirm') return [];
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
  return `<details class="questions" open><summary><span class="q-label">${escapeHtml(strings.questions)}</span> <span class="q-count">${escapeHtml(countLabel)}</span></summary><div class="qa-list">${rows}</div></details>`;
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
  return [
    `<details class="tool${isError ? ' error' : ''}">`,
    `<summary><span class="tool-name">${name}</span>${subtitle ? `<span class="tool-sub">${subtitle}</span>` : ''}</summary>`,
    '<div class="tool-body">',
    result ? copyButton(strings.copyOutput, result) : '',
    result ? `<pre class="tool-output"><span class="tool-prompt">$</span> ${escapeHtml(result)}</pre>` : '',
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
  return [
    '<div class="msg-user">',
    '<div class="bubble">',
    text ? `<div class="bubble-text">${escapeHtml(text).replace(/\n/g, '<br>\n')}</div>` : '',
    media.filter(Boolean).join('\n'),
    text ? copyButton(strings.copyMessage, text) : '',
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
    answerText ? `<div class="body answer">${markdownToHtml(answerText)}${copyButton(strings.copyAnswer, answerText)}</div>` : '',
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
  return `<footer class="turn-meta">${escapeHtml(bits.join(' · '))}</footer>`;
};

const htmlFromTurn = (turn, index, strings, extras) => {
  const id = `turn-${index + 1}`;
  const user = safeBlock(() => (turn.user ? htmlFromUserEntry(turn.user, strings) : ''));
  const assistants = (turn.assistants || []).map((entry) => safeBlock(() => htmlFromAssistantEntry(entry, strings, extras)));
  const meta = safeBlock(() => htmlFromTurnMeta(turn.assistants));
  return `<article class="turn" id="${id}">\n${[user, ...assistants, meta].filter(Boolean).join('\n')}\n</article>`;
};

const htmlFromSessionMeta = (record, version) => {
  const messages = Array.isArray(record?.messages) ? record.messages : [];
  const model = lastUsableModelLabel(messages.map((entry) => entry?.info));
  const date = formatShareDate(record?.info?.time?.created);
  const versionLabel = asTrimmedString(version) ? `v${asTrimmedString(version)}` : '';
  return `<div class="session-meta">
<span class="session-version">${PI_PIXEL_MARK_SVG}${versionLabel ? `<span> ${escapeHtml(versionLabel)}</span>` : ''}</span>
<span class="session-model">${STAR_ICON_SVG}${model ? `<span>${escapeHtml(model)}</span>` : ''}</span>
<span class="session-date">${escapeHtml(date)}</span>
</div>`;
};

const SESSION_HTML_STYLES = `:root {
  color-scheme: light;
  --bg-deep: #F8F7F7;
  --bg-surface: #ffffff;
  --text: #3A3A3A;
  --text-strong: #1A1A1A;
  --text-muted: #6B6B6B;
  --text-faint: #A3A3A3;
  --text-thinking: #8A8A8A;
  --border: #E8E6E6;
  --bubble: #F1F0F0;
  --critical: #B42318;
  --watermark: #D4D2D2;
  --icon: #6B6B6B;
}
html[data-theme="dark"] {
  color-scheme: dark;
  --bg-deep: #131010;
  --bg-surface: #1b1818;
  --text: #f1ecec;
  --text-strong: #f1ecec;
  --text-muted: #b7b1b1;
  --text-faint: #7f7979;
  --text-thinking: #7f7979;
  --border: #2d2828;
  --bubble: #252121;
  --critical: #f97066;
  --watermark: #2d2828;
  --icon: #b7b1b1;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body {
  background: var(--bg-deep);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1.7;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 4;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
}
.brand {
  display: inline-flex;
  align-items: center;
  color: var(--text-strong);
  text-decoration: none;
}
.pichamber-mark {
  display: block;
  width: 24px;
  height: 24px;
  color: var(--text-strong);
}
.pichamber-mark path { stroke-width: 3; }
.pichamber-mark path[fill-opacity="0.2"] { fill-opacity: 0.58; }
.pichamber-mark path[fill-opacity="0.35"] { fill-opacity: 0.82; }
.pi-mark { display: block; }
.topbar-right { display: flex; align-items: center; gap: 4px; }
.topbar-right a, .theme-toggle, .copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--icon);
  text-decoration: none;
  cursor: pointer;
}
.topbar-right a:hover, .theme-toggle:hover, .copy:hover { background: var(--bubble); color: var(--text-strong); }
html[data-theme="light"] .icon-moon, html[data-theme="dark"] .icon-sun { display: none; }
.page {
  width: min(880px, 100%);
  min-height: calc(100vh - 40px);
  margin: 0 auto;
  padding: 20px 36px 56px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-top: 0;
}
.session-header { margin-bottom: 2rem; }
.session-meta {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.75rem;
  margin: 0 0 0.85rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: var(--text-muted);
}
.session-version, .session-model, .session-date { display: inline-flex; align-items: center; gap: 6px; }
.session-version { justify-self: start; }
.session-model { justify-self: center; }
.session-date { justify-self: end; color: var(--text-faint); }
.session-title {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  color: var(--text-strong);
}
.transcript { display: flex; flex-direction: column; gap: 2.4rem; }
.turn { scroll-margin-top: 56px; }
.msg-user { display: flex; justify-content: flex-end; }
.bubble {
  position: relative;
  max-width: min(560px, 86%);
  padding: 10px 14px 28px;
  background: var(--bubble);
  border-radius: 16px;
  color: var(--text);
}
.bubble-text { white-space: pre-wrap; word-break: break-word; }
.bubble .copy, .body .copy, .tool-body .copy {
  position: absolute;
  right: 8px;
  bottom: 6px;
  width: auto;
  height: auto;
  padding: 2px 6px;
  font-size: 11px;
  color: var(--text-faint);
}
.thinking {
  display: block;
  margin: 0.75rem 0 1.15rem;
  padding: 12px 14px;
  background: var(--bubble);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-thinking);
  font-size: 13px;
}
.thinking p { margin: 0.45rem 0; }
.thinking p:first-child { margin-top: 0; }
.thinking p:last-child { margin-bottom: 0; }
.questions, .tool { margin: 0.85rem 0; }
.questions summary, .tool summary {
  display: flex;
  align-items: baseline;
  gap: 8px;
  cursor: pointer;
  list-style: none;
  color: var(--text-muted);
}
.questions summary::-webkit-details-marker, .tool summary::-webkit-details-marker { display: none; }
.q-label, .tool-name { font-weight: 650; color: var(--text-strong); }
.q-count, .tool-sub { color: var(--text-faint); font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.qa-list { margin-top: 0.65rem; display: flex; flex-direction: column; gap: 0.7rem; }
.qa-q { color: var(--text-muted); }
.qa-a { color: var(--text-strong); }
.tool-body { position: relative; margin-top: 0.45rem; padding-bottom: 22px; }
.tool-output {
  margin: 0;
  padding: 0;
  background: none;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: var(--text-muted);
}
.tool-prompt { color: var(--text-faint); margin-right: 0.35rem; }
.tool.error .tool-name, .tool.error .tool-sub, .tool.error .tool-output { color: var(--critical); }
.body { position: relative; padding-bottom: 22px; }
.body h1, .body h2, .body h3, .body h4, .body h5, .body h6 {
  margin: 1.15rem 0 0.4rem;
  font-size: 13px;
  font-weight: 650;
  color: var(--text-strong);
  line-height: 1.45;
}
.body p { margin: 0.55rem 0; }
.body p:first-child { margin-top: 0; }
.body ul, .body ol { margin: 0.5rem 0; padding-left: 1.25rem; }
.body li { margin: 0.15rem 0; }
.body a { color: var(--text); }
.body hr { border: 0; border-top: 1px solid var(--border); margin: 1.15rem 0; }
.body blockquote { margin: 0.75rem 0; padding-left: 0.85rem; border-left: 2px solid var(--border); color: var(--text-muted); }
.body table { width: 100%; border-collapse: collapse; margin: 0.75rem 0; }
.body th, .body td { border: 1px solid var(--border); padding: 0.35rem 0.5rem; text-align: left; }
.body th { color: var(--text-muted); font-weight: 650; }
.body pre {
  margin: 0.65rem 0;
  padding: 0;
  background: none;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.body code, .thinking code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.image { margin: 0.6rem 0; }
.image img { max-width: 100%; height: auto; border-radius: 4px; }
.image-omitted, .file-omitted { color: var(--text-thinking); font-style: italic; }
.turn-meta { margin-top: 0.85rem; color: var(--text-faint); font-size: 11px; }
.ticks {
  position: fixed;
  top: 88px;
  left: max(8px, calc(50% - 480px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 3;
}
.ticks a {
  position: relative;
  display: block;
  flex: none;
  width: 16px;
  height: 22px;
  background: transparent;
  color: transparent;
  font-size: 0;
  line-height: 0;
  overflow: hidden;
}
.ticks a::before {
  content: "";
  position: absolute;
  left: 6px;
  top: 3px;
  width: 4px;
  height: 16px;
  border-radius: 2px;
  background: var(--text-muted);
}
.ticks a.current::before {
  left: 5px;
  top: 0;
  width: 6px;
  height: 22px;
  background: var(--text-strong);
}
.page-footer { margin-top: 4rem; }
.watermark {
  margin: 0;
  text-align: center;
  font-size: clamp(48px, 12vw, 92px);
  font-weight: 600;
  letter-spacing: -0.05em;
  color: var(--watermark);
  user-select: none;
}
.ignored {
  margin: 0.4rem 0 0;
  text-align: right;
  color: var(--text-faint);
  font-size: 12px;
}
@media (max-width: 960px) {
  .ticks { display: none; }
  .session-meta { grid-template-columns: 1fr; }
  .session-model, .session-date { justify-self: start; }
}`;

const SESSION_HTML_BOOT = `!function(){try{var k=${JSON.stringify(EXPORT_THEME_KEY)};var s=localStorage.getItem(k);var t=(s==="light"||s==="dark")?s:(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","light");}}();`;

const SESSION_HTML_SCRIPT = `!function(){var root=document.documentElement;var key=${JSON.stringify(EXPORT_THEME_KEY)};function theme(){return root.getAttribute("data-theme")==="dark"?"dark":"light";}function setTheme(next){root.setAttribute("data-theme",next);try{localStorage.setItem(key,next);}catch(e){}}document.querySelector("[data-theme-toggle]")?.addEventListener("click",function(){setTheme(theme()==="dark"?"light":"dark");});document.addEventListener("click",function(event){var button=event.target.closest("[data-copy]");if(!button)return;var text=button.getAttribute("data-copy")||"";if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text);return;}var area=document.createElement("textarea");area.value=text;document.body.appendChild(area);area.select();try{document.execCommand("copy");}catch(e){}area.remove();});var ticks=Array.prototype.slice.call(document.querySelectorAll(".ticks a"));var turns=ticks.map(function(tick){return document.getElementById(tick.getAttribute("href").slice(1));}).filter(Boolean);function mark(id){ticks.forEach(function(tick){tick.classList.toggle("current",tick.getAttribute("href")==="#"+id);});}if("IntersectionObserver" in window&&turns.length){var io=new IntersectionObserver(function(entries){var visible=entries.filter(function(entry){return entry.isIntersecting;}).sort(function(a,b){return b.intersectionRatio-a.intersectionRatio;})[0];if(visible)mark(visible.target.id);},{rootMargin:"-20% 0px -60% 0px",threshold:[0.1,0.4,0.8]});turns.forEach(function(turn){io.observe(turn);});if(turns[0])mark(turns[0].id);}ticks.forEach(function(tick){tick.addEventListener("click",function(){mark(tick.getAttribute("href").slice(1));});});}();`;

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
  const ticks = turns.map((_, index) => `<a href="#turn-${index + 1}">${index + 1}</a>`).join('');
  return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
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
<header class="topbar">
<a class="brand" href="${PICHAMBER_REPO_HREF}" aria-label="${escapeHtml(strings.logo)}">${PICHAMBER_MARK_SVG}</a>
<div class="topbar-right">
<a href="${PICHAMBER_REPO_HREF}" aria-label="${escapeHtml(strings.github)}">${GITHUB_ICON_SVG}</a>
<button type="button" class="theme-toggle" data-theme-toggle aria-label="${escapeHtml(strings.themeToggle)}">${THEME_ICON_SVG}</button>
</div>
</header>
<nav class="ticks" aria-hidden="true">${ticks}</nav>
<div class="page">
<header class="session-header">
${htmlFromSessionMeta(record, version)}
<h1 class="session-title">${title}</h1>
</header>
<main class="transcript">
${articles}
</main>
<footer class="page-footer">
<p class="watermark">pichamber</p>
${cancelled ? `<p class="ignored">${escapeHtml(strings.ignored)}</p>` : ''}
</footer>
</div>
<script>${SESSION_HTML_SCRIPT}</script>
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

export const facadeMessagesFromPiEntries = (entries, sessionID, options = {}) => {
  const id = asTrimmedString(sessionID);
  const fallbackModel = isRecord(options) ? options.fallbackModel : undefined;
  const messages = [];
  const toolPartsByCallID = new Map();
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
