import { createMessageId, createPartId } from './ids.js';

const PI_SESSION_VERSION = 3;

const asTrimmedString = (value) => (typeof value === 'string' ? value.trim() : '');

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

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

const piContentFromFacadeParts = (parts) => {
  if (!Array.isArray(parts)) return [];
  const content = [];
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'reasoning' && typeof part.text === 'string') {
      content.push({ type: 'thinking', thinking: part.text });
      continue;
    }
    if (part.type === 'text' && typeof part.text === 'string') {
      content.push({ type: 'text', text: part.text });
    }
  }
  return content;
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

/** Persist-only: facade parts → Pi-native messages for SessionManager.appendMessage. */
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
    { role, content, timestamp },
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
    const role = entry?.info?.role === 'assistant' ? 'assistant' : 'user';
    lines.push(JSON.stringify({
      type: 'message',
      id: messageId,
      parentId: entry?.info?.parentID || prevId,
      timestamp: isoFromUnknown(entry?.info?.time?.created),
      message: {
        role,
        content: piContentFromFacadeParts(entry?.parts),
        timestamp: millisFromUnknown(entry?.info?.time?.created),
      },
    }));
    prevId = messageId;
  }
  return `${lines.join('\n')}\n`;
};

export const buildSessionHtml = (record) => {
  const title = escapeHtml(asTrimmedString(record?.info?.title) || 'Session');
  const blocks = (record?.messages || []).map((entry) => {
    const role = entry?.info?.role === 'assistant' ? 'Assistant' : 'User';
    const text = escapeHtml(textFromFacadeParts(entry?.parts));
    return `<article class="msg ${role.toLowerCase()}"><div class="role">${role}</div><pre>${text}</pre></article>`;
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 44rem; margin: 2rem auto; padding: 0 1rem; color: #111; }
h1 { font-size: 1.25rem; }
.msg { margin: 1.25rem 0; }
.role { font-weight: 600; margin-bottom: 0.35rem; }
pre { white-space: pre-wrap; word-break: break-word; margin: 0; font: inherit; }
</style>
</head>
<body>
<h1>${title}</h1>
${blocks}
</body>
</html>
`;
};

const facadeFromPiMessage = (entry) => {
  const message = entry?.message && typeof entry.message === 'object' ? entry.message : {};
  if (message.role === 'toolResult') return null;
  const role = message.role === 'assistant' ? 'assistant' : 'user';
  const messageID = asTrimmedString(entry?.id) || createMessageId();
  const created = millisFromUnknown(entry?.timestamp ?? message.timestamp);
  return {
    info: {
      id: messageID,
      role,
      time: { created },
      agent: 'pi',
      ...(asTrimmedString(entry?.parentId) ? { parentID: entry.parentId } : {}),
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

export const facadeMessagesFromPiEntries = (entries, sessionID) => {
  const id = asTrimmedString(sessionID);
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
    const facade = facadeFromPiMessage(entry);
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
    return {
      info: {
        id: messageID,
        role: entry.role === 'assistant' ? 'assistant' : 'user',
        time: { created: millisFromUnknown(entry.timestamp ?? entry.time?.created) },
        agent: 'pi',
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
