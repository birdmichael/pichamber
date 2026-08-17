// Archived Pi sessions live in a sibling `archive/` under the same cwd
// session dir. Active list only reads the active dir; archived=true also
// reads archive/. Restore (`archived: 0`) moves the jsonl back. Location
// is the skip-I/O signal so archived=false never opens those files.

import fs from 'node:fs';
import path from 'node:path';

export const SESSION_ARCHIVE_DIRNAME = 'archive';

export const sessionArchiveDir = (sessionDir) => {
  if (typeof sessionDir !== 'string' || !sessionDir) return undefined;
  return path.join(sessionDir, SESSION_ARCHIVE_DIRNAME);
};

const resolvedPrefix = (dir) => {
  const resolved = path.resolve(dir);
  return resolved.endsWith(path.sep) ? resolved : `${resolved}${path.sep}`;
};

export const isUnderSessionArchiveDir = (file, sessionDir) => {
  if (typeof file !== 'string' || !file || typeof sessionDir !== 'string' || !sessionDir) {
    return false;
  }
  const archiveDir = sessionArchiveDir(sessionDir);
  if (!archiveDir) return false;
  const resolvedFile = path.resolve(file);
  const resolvedArchive = path.resolve(archiveDir);
  return resolvedFile === resolvedArchive || resolvedFile.startsWith(resolvedPrefix(resolvedArchive));
};

export const archivedSessionFilePath = (sessionDir, file) => {
  const archiveDir = sessionArchiveDir(sessionDir);
  if (!archiveDir || typeof file !== 'string' || !file) return undefined;
  return path.join(archiveDir, path.basename(file));
};

export const activeSessionFilePath = (sessionDir, file) => {
  if (typeof sessionDir !== 'string' || !sessionDir || typeof file !== 'string' || !file) {
    return undefined;
  }
  return path.join(sessionDir, path.basename(file));
};

export const moveSessionFile = (from, to) => {
  if (typeof from !== 'string' || !from || typeof to !== 'string' || !to) return from;
  if (path.resolve(from) === path.resolve(to)) return to;
  if (!fs.existsSync(from)) return from;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.existsSync(to)) return from;
  fs.renameSync(from, to);
  return to;
};

// archived: ms → archive/; archived: 0 / false → active dir.
// Failed move leaves the source in place. Never overwrite dest.
export const relocateSessionFileForArchiveState = (file, sessionDir, archived) => {
  if (typeof file !== 'string' || !file || typeof sessionDir !== 'string' || !sessionDir) {
    return file;
  }
  const dest = archived
    ? archivedSessionFilePath(sessionDir, file)
    : activeSessionFilePath(sessionDir, file);
  if (!dest) return file;
  try {
    return moveSessionFile(file, dest);
  } catch {
    return file;
  }
};

export const findSessionJsonlInDir = (dir, sessionID) => {
  const id = typeof sessionID === 'string' ? sessionID.trim() : '';
  if (!id || typeof dir !== 'string' || !dir) return undefined;
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return undefined;
  }
  const match = names.find((name) => name.endsWith('.jsonl') && name.includes(id));
  return match ? path.join(dir, match) : undefined;
};
