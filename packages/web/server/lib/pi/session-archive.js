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

const HEADER_READ_BYTES = 8 * 1024;
const NESTED_SESSION_WALK_MAX_DEPTH = 6;
const NESTED_SESSION_WALK_MAX_FILES = 256;
const NESTED_SESSION_SKIP_DIRNAMES = new Set([SESSION_ARCHIVE_DIRNAME, 'node_modules', '.git']);

const asTrimmedId = (value) => (typeof value === 'string' && value.trim() ? value.trim() : '');

/** Header `id` only. Child files are often named `session.jsonl`. */
export const readSessionIdFromJsonlHeader = (file) => {
  if (typeof file !== 'string' || !file) return '';
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(HEADER_READ_BYTES);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const firstLine = buffer.slice(0, bytes).toString('utf8').split(/\r?\n/).find((line) => line.trim());
      if (!firstLine) return '';
      const parsed = JSON.parse(firstLine);
      return asTrimmedId(parsed?.id);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
};

const walkSessionJsonlFiles = (dir, {
  skipDirnames = NESTED_SESSION_SKIP_DIRNAMES,
  maxDepth = NESTED_SESSION_WALK_MAX_DEPTH,
  maxFiles = NESTED_SESSION_WALK_MAX_FILES,
} = {}) => {
  const skip = skipDirnames instanceof Set ? skipDirnames : new Set(skipDirnames || []);
  const files = [];
  const walk = (current, depth) => {
    if (files.length >= maxFiles) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const full = path.join(current, entry.name);
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        if (skip.has(entry.name) || depth >= maxDepth) continue;
        if (entry.isSymbolicLink()) {
          try {
            if (!fs.statSync(full).isDirectory()) continue;
          } catch {
            continue;
          }
        }
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      files.push(full);
    }
  };
  walk(dir, 0);
  return files;
};

/**
 * Resolve a session id to a jsonl path. Top-level filename match first,
 * then nested herdr/subagent files whose header id matches (`session.jsonl`).
 * `archive/` is skipped unless it is the walk root.
 */
export const findSessionJsonlById = (dir, sessionID, { skipArchive = true } = {}) => {
  const id = asTrimmedId(sessionID);
  if (!id || typeof dir !== 'string' || !dir) return undefined;
  const topLevel = findSessionJsonlInDir(dir, id);
  if (topLevel) return topLevel;
  const skipDirnames = skipArchive
    ? NESTED_SESSION_SKIP_DIRNAMES
    : new Set(['node_modules', '.git']);
  for (const file of walkSessionJsonlFiles(dir, { skipDirnames })) {
    if (path.basename(file).includes(id)) return file;
    if (readSessionIdFromJsonlHeader(file) === id) return file;
  }
  return undefined;
};
