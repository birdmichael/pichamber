// Pichamber session metadata rides Pi's extension custom entries so a goal
// (and any other facade metadata) survives reload of the same UUID jsonl
// under ~/.pi/agent/sessions. Custom entries are not LLM context.
// Archive is a Pichamber-only flag: `{ archived: ms | 0 }` on this entry.
// `0` means restored. Do not invent a second session store.

import fs from 'node:fs';

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
