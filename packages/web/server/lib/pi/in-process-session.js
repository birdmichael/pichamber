// In-process session reads for the Pi kernel.
// session-goal / session-assist must never HTTP-fetch the local facade
// (same bun process): that deadlocks the single-threaded server and
// starves SSE of session.idle.

const decodeSegment = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const resolvePiHost = (getPiHost, isPiKernelEnabled) => {
  const host = typeof getPiHost === 'function' ? getPiHost() : getPiHost;
  if (host) return host;
  const enabled = typeof isPiKernelEnabled === 'function' ? isPiKernelEnabled() : Boolean(isPiKernelEnabled);
  if (enabled) {
    throw new Error('Pi host is not available; refusing self-fetch');
  }
  return null;
};

export const dispatchPiSessionRequest = async (host, fetchPath, {
  directory,
  method = 'GET',
  body,
  query,
} = {}) => {
  if (!host) {
    throw new Error('Pi host is not available');
  }
  const pathname = String(fetchPath || '');
  const verb = String(method || 'GET').toUpperCase();

  if (pathname === '/session/status' && verb === 'GET') {
    return host.getStatus(directory || undefined);
  }

  const match = pathname.match(/^\/session\/([^/]+)(?:\/([^/]+)(?:\/([^/]+))?)?$/);
  if (!match) {
    throw new Error(`Unsupported in-process Pi path: ${verb} ${pathname}`);
  }
  const sessionId = decodeSegment(match[1]);
  const rest = match[2] || '';
  const leaf = match[3] ? decodeSegment(match[3]) : '';

  if (typeof host.ensureSession === 'function') {
    await host.ensureSession(sessionId, directory);
  }

  if (!rest && verb === 'GET') {
    return host.getSession(sessionId).info;
  }
  if (!rest && verb === 'PATCH') {
    return (await host.updateSession(sessionId, body || {})).info;
  }
  if (rest === 'message' && verb === 'GET') {
    const messages = host.getMessages(sessionId);
    if (leaf) {
      const message = Array.isArray(messages)
        ? messages.find((entry) => entry?.info?.id === leaf)
        : null;
      if (!message) {
        const error = new Error('Message not found');
        error.status = 404;
        throw error;
      }
      return message;
    }
    const limit = Number(query?.limit);
    if (Number.isFinite(limit) && limit > 0 && Array.isArray(messages) && messages.length > limit) {
      return messages.slice(-limit);
    }
    return messages;
  }
  if (rest === 'children' && verb === 'GET') {
    if (typeof host.listSessionChildren === 'function') {
      return host.listSessionChildren(sessionId, directory || undefined);
    }
    return [];
  }
  if (rest === 'subagent-runs' && verb === 'GET') {
    if (typeof host.listSubagentRuns === 'function') {
      return host.listSubagentRuns(sessionId, directory || undefined);
    }
    return { runs: [] };
  }
  if (rest === 'prompt_async' && verb === 'POST') {
    return host.promptAsync(sessionId, body || {});
  }
  throw new Error(`Unsupported in-process Pi path: ${verb} ${pathname}`);
};
