import { createEventId } from './ids.js';

const DEFAULT_REPLAY_LIMIT = 2048;
const DEFAULT_HEARTBEAT_MS = 20_000;

const writeSse = (res, eventId, payload) => {
  if (!res || res.writableEnded || res.destroyed) return false;
  const lines = [];
  if (eventId) lines.push(`id: ${eventId}`);
  lines.push(`data: ${JSON.stringify(payload)}`);
  lines.push('', '');
  const ok = res.write(lines.join('\n'));
  if (typeof res.flush === 'function') {
    try { res.flush(); } catch { /* ignore */ }
  }
  return ok;
};

export const createSseBus = ({
  replayLimit = DEFAULT_REPLAY_LIMIT,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
} = {}) => {
  const eventSubscribers = new Set();
  const statusSubscribers = new Set();
  const sseClients = new Set();
  const replay = [];
  let connected = false;
  let everConnected = false;
  let heartbeatTimer = null;

  const notify = (subscribers, payload) => {
    for (const subscriber of Array.from(subscribers)) {
      try {
        const result = subscriber(payload);
        if (result && typeof result.catch === 'function') {
          result.catch(() => {});
        }
      } catch {
      }
    }
  };

  const normalize = ({ directory, payload, eventId }) => {
    const resolvedDirectory = typeof directory === 'string' && directory.length > 0 ? directory : 'global';
    const resolvedEventId = typeof eventId === 'string' && eventId.length > 0 ? eventId : createEventId();
    return {
      envelope: { directory: resolvedDirectory, eventId: resolvedEventId },
      payload,
      directory: resolvedDirectory,
      eventId: resolvedEventId,
    };
  };

  const publish = (directory, payload, options = {}) => {
    const eventId = options.eventId || payload?.id || createEventId();
    const normalized = normalize({ directory, payload, eventId });
    replay.push(normalized);
    if (replay.length > replayLimit) {
      replay.splice(0, replay.length - replayLimit);
    }

    notify(eventSubscribers, normalized);

    const ssePayload = {
      directory: normalized.directory,
      payload: normalized.payload,
    };
    for (const res of Array.from(sseClients)) {
      // write() === false is kernel backpressure, not a disconnect.
      // Dropping the client here silently starves the UI of later events
      // while heartbeats on the same socket keep the stream "alive".
      writeSse(res, normalized.eventId, ssePayload);
    }

    return normalized;
  };

  const attachSse = (req, res) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }
    if (res.socket && typeof res.socket.setNoDelay === 'function') {
      res.socket.setNoDelay(true);
    }

    sseClients.add(res);
    start();

    const lastEventId = req.headers?.['last-event-id'] || req.query?.lastEventId;
    const replayEntries = lastEventId ? replayAfter(lastEventId) : replay.slice();
    for (const entry of replayEntries) {
      writeSse(res, entry.eventId, { directory: entry.directory, payload: entry.payload });
    }

    const heartbeat = setInterval(() => {
      if (res.writableEnded || res.destroyed) {
        clearInterval(heartbeat);
        return;
      }
      res.write(':heartbeat\n\n');
    }, heartbeatMs);
    heartbeat.unref?.();

    const cleanup = () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
  };

  const start = () => {
    if (connected) return;
    connected = true;
    const wasReady = everConnected;
    everConnected = true;
    notify(statusSubscribers, { type: 'connect', wasReady });
  };

  const stop = () => {
    connected = false;
    everConnected = false;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    for (const res of Array.from(sseClients)) {
      try {
        res.end();
      } catch {
      }
    }
    sseClients.clear();
  };

  const replayAfter = (eventId) => {
    if (!eventId) return [];
    const index = replay.findIndex((entry) => entry.eventId === eventId);
    return index === -1 ? [] : replay.slice(index + 1);
  };

  return {
    start,
    stop,
    publish,
    attachSse,
    isConnected() {
      return connected;
    },
    hasConnected() {
      return everConnected;
    },
    subscribeEvent(subscriber) {
      eventSubscribers.add(subscriber);
      return () => eventSubscribers.delete(subscriber);
    },
    subscribeStatus(subscriber) {
      statusSubscribers.add(subscriber);
      return () => statusSubscribers.delete(subscriber);
    },
    replayAfter,
    getSseClientCount() {
      return sseClients.size;
    },
  };
};
