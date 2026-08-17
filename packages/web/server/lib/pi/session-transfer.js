import { createMessageId, createPartId } from './ids.js';

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

const isMarkdownBlockStart = (line) => (
  isMarkdownFenceOpen(line)
  || isMarkdownHeading(line)
  || isMarkdownQuote(line)
  || isMarkdownUnordered(line)
  || isMarkdownOrdered(line)
  || isMarkdownRule(line)
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

const formatJsonForPre = (value) => {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? '');
  }
};

const formatMessageTimestamp = (info) => {
  const created = info?.time?.created;
  if (created == null || created === '') return '';
  return isoFromUnknown(created);
};

const formatModelLabel = (info) => {
  const resolved = resolveUsableFacadeModel(info);
  if (!resolved) return '';
  return `${resolved.providerID}/${resolved.modelID}`;
};

const formatUsageLine = (info) => {
  const tokens = isRecord(info?.tokens) ? info.tokens : null;
  const hasCost = typeof info?.cost === 'number' && Number.isFinite(info.cost);
  if (!tokens && !hasCost) return '';
  const parts = [];
  if (tokens) {
    if (typeof tokens.input === 'number' && Number.isFinite(tokens.input)) {
      parts.push(`${tokens.input} in`);
    }
    if (typeof tokens.output === 'number' && Number.isFinite(tokens.output)) {
      parts.push(`${tokens.output} out`);
    }
    if (typeof tokens.reasoning === 'number' && Number.isFinite(tokens.reasoning) && tokens.reasoning > 0) {
      parts.push(`${tokens.reasoning} reasoning`);
    }
  }
  if (hasCost) parts.push(`$${info.cost}`);
  return parts.join(' · ');
};

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

const htmlFromToolPart = (part) => {
  const name = escapeHtml(asTrimmedString(part?.tool) || 'tool');
  const status = asTrimmedString(part?.state?.status);
  const input = isRecord(part?.state?.input) ? part.state.input : {};
  const output = typeof part?.state?.output === 'string' ? part.state.output : '';
  const error = typeof part?.state?.error === 'string' ? part.state.error : '';
  const isError = status === 'error';
  const sections = [
    `<div class="tool-name">${name}</div>`,
  ];
  if (Object.keys(input).length > 0) {
    sections.push(`<div class="tool-label">Input</div><pre class="tool-io">${escapeHtml(formatJsonForPre(input))}</pre>`);
  }
  if (isError) {
    sections.push(`<div class="tool-label">Error</div><pre class="tool-io">${escapeHtml(error || output || 'tool error')}</pre>`);
  } else if (output) {
    sections.push(`<div class="tool-label">Output</div><pre class="tool-io">${escapeHtml(output)}</pre>`);
  }
  return `<section class="tool${isError ? ' error' : ''}">${sections.join('')}</section>`;
};

const htmlFromReasoningPart = (text) => {
  const body = asTrimmedString(text);
  if (!body) return '';
  return `<details class="thinking"><summary>Thinking</summary><div class="thinking-body">${markdownToHtml(body)}</div></details>`;
};

const htmlFromMessageParts = (parts) => {
  if (!Array.isArray(parts)) return '';
  return parts.map((part) => {
    if (!part || typeof part !== 'object') return '';
    if (part.type === 'reasoning') return htmlFromReasoningPart(part.text);
    if (part.type === 'text' && typeof part.text === 'string' && part.text) {
      return `<div class="body">${markdownToHtml(part.text)}</div>`;
    }
    if (part.type === 'tool') return htmlFromToolPart(part);
    if (part.type === 'file' || part.type === 'image') return htmlFromFilePart(part);
    return '';
  }).filter(Boolean).join('\n');
};

const htmlFromMessageEntry = (entry) => {
  const role = entry?.info?.role === 'assistant' ? 'Assistant' : 'User';
  const timestamp = formatMessageTimestamp(entry?.info);
  const model = role === 'Assistant' ? formatModelLabel(entry?.info) : '';
  const usage = role === 'Assistant' ? formatUsageLine(entry?.info) : '';
  const meta = [timestamp, model].filter(Boolean).join(' · ');
  const body = htmlFromMessageParts(entry?.parts);
  return [
    `<article class="msg ${role.toLowerCase()}">`,
    `<header><div class="role">${role}</div>${meta ? `<div class="meta">${escapeHtml(meta)}</div>` : ''}</header>`,
    body,
    usage ? `<footer class="usage">${escapeHtml(usage)}</footer>` : '',
    '</article>',
  ].filter(Boolean).join('\n');
};

const SESSION_HTML_STYLES = `body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; color: #111; line-height: 1.5; }
h1 { font-size: 1.35rem; margin-bottom: 1.5rem; }
h2, h3, h4, h5, h6 { line-height: 1.3; }
.msg { margin: 1.5rem 0; padding-bottom: 1.25rem; border-bottom: 1px solid #e5e5e5; }
.msg:last-child { border-bottom: 0; }
header { margin-bottom: 0.5rem; }
.role { font-weight: 650; }
.meta, .usage { color: #666; font-size: 0.85rem; }
.usage { margin-top: 0.75rem; }
.body p { margin: 0.5rem 0; }
.body p:first-child { margin-top: 0; }
.body pre, .thinking-body pre, .tool-io { white-space: pre-wrap; word-break: break-word; background: #f4f4f5; padding: 0.75rem; border-radius: 0.4rem; overflow-x: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9rem; }
.body code, .thinking-body code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; background: #f4f4f5; padding: 0.1em 0.3em; border-radius: 0.25rem; }
.body pre code { background: none; padding: 0; }
.body ul, .body ol { margin: 0.5rem 0; padding-left: 1.4rem; }
.body a { color: #155eef; }
.thinking { margin: 0.75rem 0; padding: 0.5rem 0.75rem; background: #fafafa; border: 1px solid #e5e5e5; border-radius: 0.4rem; }
.thinking summary { cursor: pointer; font-weight: 600; color: #444; }
.thinking-body { margin-top: 0.5rem; color: #444; }
.tool { margin: 0.75rem 0; padding: 0.75rem; border: 1px solid #d4d4d8; border-radius: 0.4rem; background: #fafafa; }
.tool.error { border-color: #f0b4b4; background: #fff7f7; }
.tool-name { font-weight: 650; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.tool-label { margin-top: 0.6rem; font-size: 0.75rem; font-weight: 650; text-transform: uppercase; letter-spacing: 0.04em; color: #666; }
.image { margin: 0.75rem 0; }
.image img { max-width: 100%; height: auto; border-radius: 0.4rem; }
.image-omitted, .file-omitted { color: #666; font-size: 0.9rem; font-style: italic; }
@media (prefers-color-scheme: dark) {
  body { color: #f4f4f5; background: #18181b; }
  .msg { border-bottom-color: #3f3f46; }
  .meta, .usage, .tool-label, .image-omitted, .file-omitted { color: #a1a1aa; }
  .body pre, .thinking-body pre, .tool-io, .body code, .thinking-body code { background: #27272a; }
  .thinking, .tool { background: #1f1f23; border-color: #3f3f46; }
  .tool.error { background: #2a1b1b; border-color: #7f1d1d; }
  .body a { color: #93c5fd; }
}`;

export const buildSessionHtml = (record) => {
  const title = escapeHtml(asTrimmedString(record?.info?.title) || 'Session');
  const blocks = (record?.messages || []).map((entry) => htmlFromMessageEntry(entry)).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${SESSION_HTML_STYLES}
</style>
</head>
<body>
<h1>${title}</h1>
${blocks}
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
