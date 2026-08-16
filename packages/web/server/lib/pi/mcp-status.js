import { MCP_STATUS_EVENT } from './mcp-config.js';

const snapshotsByDirectory = new Map();

const normalizeDirectory = (directory) => {
  if (typeof directory !== 'string') return '';
  const trimmed = directory.trim();
  return trimmed || '';
};

const rememberMcpStatusSnapshot = (directory, snapshot) => {
  const key = normalizeDirectory(directory);
  if (!key) return;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    snapshotsByDirectory.delete(key);
    return;
  }
  snapshotsByDirectory.set(key, snapshot);
};

export const getRememberedMcpStatusSnapshot = (directory) => {
  const key = normalizeDirectory(directory);
  if (!key) return null;
  return snapshotsByDirectory.get(key) || null;
};

const resolvePiSessionEvents = (piSession) => {
  if (!piSession || typeof piSession !== 'object') return null;
  const candidates = [
    piSession.events,
    piSession.pi?.events,
    piSession.extensionRunner?.events,
    piSession.ctx?.events,
  ];
  return candidates.find((events) => events && typeof events.on === 'function') || null;
};

export const attachMcpStatusListener = (record) => {
  const events = resolvePiSessionEvents(record?.piSession);
  if (!events) return () => {};
  const handler = (snapshot) => {
    rememberMcpStatusSnapshot(record.directory, snapshot);
  };
  events.on(MCP_STATUS_EVENT, handler);
  return () => {
    if (typeof events.off === 'function') {
      events.off(MCP_STATUS_EVENT, handler);
    } else if (typeof events.removeListener === 'function') {
      events.removeListener(MCP_STATUS_EVENT, handler);
    }
  };
};
