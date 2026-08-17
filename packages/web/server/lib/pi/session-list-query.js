// OpenCode session-list query contract for the Pi facade.
// archived=false/absent keeps active + restored (`time.archived === 0`).
// roots=true keeps sessions with no parentID. limit/cursor page by
// time.updated strictly earlier and expose x-next-cursor when more remain.

const isTruthyQueryFlag = (value) => value === true || value === 'true';

const parseFiniteNumber = (value) => {
  if (value == null || value === '') return undefined;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const parsePositiveInt = (value) => {
  const numeric = parseFiniteNumber(value);
  if (numeric === undefined || numeric <= 0) return undefined;
  return Math.floor(numeric);
};

export const includeArchivedSessions = (archivedQuery) => isTruthyQueryFlag(archivedQuery);

export const applySessionListQuery = (infos, query = {}) => {
  const includeArchived = includeArchivedSessions(query.archived);
  const rootsOnly = isTruthyQueryFlag(query.roots);
  const limit = parsePositiveInt(query.limit);
  const cursor = parseFiniteNumber(query.cursor);

  const rows = [];
  for (const info of infos || []) {
    if (!info || typeof info !== 'object') continue;
    if (!includeArchived && info.time?.archived) continue;
    if (rootsOnly && info.parentID) continue;
    const updated = Number(info.time?.updated);
    const updatedAt = Number.isFinite(updated) ? updated : 0;
    if (cursor !== undefined && updatedAt >= cursor) continue;
    rows.push(info);
  }

  rows.sort((left, right) => {
    const leftUpdated = Number(left.time?.updated);
    const rightUpdated = Number(right.time?.updated);
    const delta = (Number.isFinite(rightUpdated) ? rightUpdated : 0)
      - (Number.isFinite(leftUpdated) ? leftUpdated : 0);
    if (delta !== 0) return delta;
    return String(left.id || '').localeCompare(String(right.id || ''));
  });

  if (limit === undefined || rows.length <= limit) {
    return { sessions: rows, nextCursor: undefined };
  }
  const sessions = rows.slice(0, limit);
  const lastUpdated = Number(sessions[sessions.length - 1]?.time?.updated);
  return {
    sessions,
    nextCursor: Number.isFinite(lastUpdated) ? lastUpdated : 0,
  };
};
