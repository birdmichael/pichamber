// Pichamber session metadata rides Pi's extension custom entries so a goal
// (and any other facade metadata) survives reload of the same UUID jsonl
// under ~/.pi/agent/sessions. Custom entries are not LLM context.
// Archive is a Pichamber-only flag: `{ archived: ms | 0 }` on this entry.
// `0` means restored. Clone/fork `parentID` is the same entry:
// `{ parentID: "<source session id>" }`. Adapter children persist that same
// field so the session list can nest them; `pichamber.subagentRun.parentSessionID`
// is a fallback when only the adapter marker exists. A `subagentRun` marker
// on a top-level `{timestamp}_{id}.jsonl` chat is a stolen attach — list and
// hydrate ignore that parent so the conversation stays a root. Do not invent
// a second session store.
// Session list tail-scans the last pichamber.metadata; it does not full-read
// jsonl again just to find archived / parentID / Goal mark. A leftover
// piGoal.active is listed inactive unless the latest goal-state still holds
// the mutex (see reconcileListedPiGoalMetadata). Archived files also move to
// a sibling `archive/` so archived=false never opens them.

import fs from 'node:fs';
import path from 'node:path';

export const PICHAMBER_METADATA_CUSTOM_TYPE = 'pichamber.metadata';

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const readPersistedSessionMetadata = (entries) => {
  if (!Array.isArray(entries)) return undefined;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry?.type !== 'custom' || entry.customType !== PICHAMBER_METADATA_CUSTOM_TYPE) continue;
    return isRecord(entry.data) ? entry.data : undefined;
  }
  return undefined;
};

export const readPersistedSessionMetadataFromFile = (file) => {
  if (typeof file !== 'string' || !file) return undefined;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // One malformed line must not hide later metadata or fail the list.
    }
  }
  return readPersistedSessionMetadata(entries);
};

// List hot path: scan from the end for the last pichamber.metadata and stop.
// Do not full-read jsonl just to count messages or rebuild allMessagesText.
export const LIST_METADATA_TAIL_CHUNK_SIZE = 8 * 1024;

const defaultListMetadataIo = {
  openSync: (file, flags) => fs.openSync(file, flags),
  fstatSync: (fd) => fs.fstatSync(fd),
  readSync: (fd, buffer, offset, length, position) => (
    fs.readSync(fd, buffer, offset, length, position)
  ),
  closeSync: (fd) => fs.closeSync(fd),
};

const parseCustomEntryDataLine = (line, customType) => {
  if (!line || typeof customType !== 'string' || !customType) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (parsed?.type !== 'custom' || parsed.customType !== customType) {
    return undefined;
  }
  return isRecord(parsed.data) ? parsed.data : undefined;
};

const parsePersistedSessionMetadataLine = (line) => (
  parseCustomEntryDataLine(line, PICHAMBER_METADATA_CUSTOM_TYPE)
);

// List / restore hot path: scan from the end for the last matching custom
// entry and stop. Do not full-read jsonl just to find goal-state or metadata.
export const readLatestCustomEntryDataFromFileTail = (file, customType, options = {}) => {
  if (typeof file !== 'string' || !file || typeof customType !== 'string' || !customType) {
    return undefined;
  }
  const io = options.io && typeof options.io === 'object'
    ? { ...defaultListMetadataIo, ...options.io }
    : defaultListMetadataIo;
  const requestedChunk = Number(options.chunkSize);
  const chunkSize = Number.isFinite(requestedChunk) && requestedChunk > 0
    ? Math.floor(requestedChunk)
    : LIST_METADATA_TAIL_CHUNK_SIZE;
  let fd;
  try {
    fd = io.openSync(file, 'r');
  } catch {
    return undefined;
  }
  try {
    const fileSize = Number(io.fstatSync(fd)?.size) || 0;
    if (fileSize <= 0) return undefined;
    let position = fileSize;
    let leftover = '';
    const buffer = Buffer.allocUnsafe(Math.min(chunkSize, fileSize));
    while (position > 0) {
      const start = Math.max(0, position - chunkSize);
      const length = position - start;
      const bytesRead = io.readSync(fd, buffer, 0, length, start);
      const text = `${buffer.toString('utf8', 0, bytesRead)}${leftover}`;
      const lines = text.split(/\r?\n/);
      if (start > 0) leftover = lines.shift() ?? '';
      else leftover = '';
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const data = parseCustomEntryDataLine(lines[i], customType);
        if (!data) continue;
        return data;
      }
      position = start;
    }
    return parseCustomEntryDataLine(leftover, customType);
  } catch {
    return undefined;
  } finally {
    try {
      io.closeSync(fd);
    } catch {
    }
  }
};

export const readPersistedSessionMetadataFromFileTail = (file, options = {}) => (
  readLatestCustomEntryDataFromFileTail(file, PICHAMBER_METADATA_CUSTOM_TYPE, options)
);

export const readPersistedParentID = (metadata) => {
  if (!isRecord(metadata)) return undefined;
  const parentID = typeof metadata.parentID === 'string' ? metadata.parentID.trim() : '';
  if (parentID) return parentID;
  const nested = metadata.pichamber?.subagentRun?.parentSessionID;
  return typeof nested === 'string' && nested.trim() ? nested.trim() : undefined;
};

const TOP_LEVEL_USER_SESSION_FILE = /^\d{4}-\d{2}-\d{2}T.+\.jsonl$/i;

// Project chats are `{timestamp}_{id}.jsonl` in the cwd session dir.
// Adapter / herdr children are `session.jsonl` (or a file under
// async-subagent-runs), not a second top-level conversation.
export const isTopLevelUserSessionFile = (file) => {
  if (typeof file !== 'string' || !file.trim()) return false;
  return TOP_LEVEL_USER_SESSION_FILE.test(path.basename(file.trim()));
};

const hasAdapterSubagentRunMarker = (metadata) => {
  if (!isRecord(metadata)) return false;
  const run = metadata.pichamber?.subagentRun;
  if (!isRecord(run)) return false;
  return Boolean(
    (typeof run.parentSessionID === 'string' && run.parentSessionID.trim())
    || (typeof run.runId === 'string' && run.runId.trim()),
  );
};

// List / hydrate nesting. Clone/fork `parentID` on a top-level chat stays.
// A `subagentRun` marker on that same top-level file is a stolen attach —
// ignore it so the conversation stays a root.
export const readListedParentID = (metadata, sessionFile) => {
  const parentID = readPersistedParentID(metadata);
  if (!parentID) return undefined;
  if (isTopLevelUserSessionFile(sessionFile) && hasAdapterSubagentRunMarker(metadata)) {
    return undefined;
  }
  return parentID;
};

export const readPersistedArchivedTimestamp = (metadata) => {
  if (!isRecord(metadata)) return undefined;
  const archived = metadata.archived;
  if (archived === 0 || archived === '0') return 0;
  const numeric = typeof archived === 'number' ? archived : Number(archived);
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  return numeric;
};

export const sessionTimeWithArchived = (time, metadata) => {
  const archived = readPersistedArchivedTimestamp(metadata);
  if (archived === undefined) return { ...(time || {}) };
  return { ...(time || {}), archived };
};

export const persistSessionMetadata = (manager, metadata) => {
  if (!isRecord(metadata) || typeof manager?.appendCustomEntry !== 'function') return false;
  try {
    manager.appendCustomEntry(PICHAMBER_METADATA_CUSTOM_TYPE, metadata);
    return true;
  } catch {
    return false;
  }
};
