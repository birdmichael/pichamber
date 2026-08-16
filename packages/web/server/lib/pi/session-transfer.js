import { createMessageId, createPartId } from './ids.js';

const PI_SESSION_VERSION = 3;

const asTrimmedString = (value) => (typeof value === 'string' ? value.trim() : '');

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

export const facadeMessagesFromPiEntries = (entries, sessionID) => {
  const id = asTrimmedString(sessionID);
  const messages = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.type && entry.type !== 'message') continue;
    if (!entry?.message) continue;
    const facade = facadeFromPiMessage(entry);
    if (id) {
      facade.info.sessionID = id;
      facade.parts = facade.parts.map((part) => ({
        ...part,
        sessionID: id,
        messageID: facade.info.id,
      }));
    }
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

  const ingest = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    if (entry.type === 'session') {
      cwd = asTrimmedString(entry.cwd) || cwd;
      return;
    }
    if (entry.type === 'session_info' && asTrimmedString(entry.name)) {
      title = asTrimmedString(entry.name);
      return;
    }
    const facade = facadeFromUnknown(entry);
    if (facade) messages.push(facade);
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
    for (const entry of parsed) ingest(entry);
  } else {
    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        ingest(JSON.parse(trimmed));
      } catch {
        const error = new Error('Invalid JSONL session import');
        error.status = 400;
        throw error;
      }
    }
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
