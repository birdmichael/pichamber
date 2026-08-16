// Pichamber session metadata rides Pi's extension custom entries so a goal
// (and any other facade metadata) survives reload of the same UUID jsonl
// under ~/.pi/agent/sessions. Custom entries are not LLM context.

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

export const persistSessionMetadata = (manager, metadata) => {
  if (!isRecord(metadata) || typeof manager?.appendCustomEntry !== 'function') return false;
  try {
    manager.appendCustomEntry(PICHAMBER_METADATA_CUSTOM_TYPE, metadata);
    return true;
  } catch {
    return false;
  }
};

export const archiveTimeFromMetadata = (metadata) => {
  if (!isRecord(metadata) || !isRecord(metadata.time)) return undefined;
  const archived = metadata.time.archived;
  return typeof archived === 'number' && Number.isFinite(archived) ? archived : undefined;
};

export const sessionMetadataWithoutArchive = (metadata) => {
  if (!isRecord(metadata)) return undefined;
  const { time: _time, ...rest } = metadata;
  return Object.keys(rest).length > 0 ? rest : undefined;
};

export const readPersistedArchiveTime = (entries) => (
  archiveTimeFromMetadata(readPersistedSessionMetadata(entries))
);

export const persistSessionArchive = (manager, archived, existingMetadata) => {
  const metadata = isRecord(existingMetadata) ? { ...existingMetadata } : {};
  metadata.time = {
    archived: typeof archived === 'number' && Number.isFinite(archived) ? archived : 0,
  };
  return persistSessionMetadata(manager, metadata);
};
