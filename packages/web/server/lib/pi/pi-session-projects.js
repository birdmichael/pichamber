import os from 'node:os';
import path from 'node:path';

import { SESSION_ARCHIVE_DIRNAME } from './session-archive.js';

const HEADER_READ_BYTES = 8192;
const TMP_POSIX_ROOTS = ['/tmp', '/private/tmp'];

const isObject = (value) => Boolean(value) && typeof value === 'object';

/** True when `projects` has never been written. `[]` after Close Project is persisted, not missing. */
export const settingsNeverPersistedProjects = (settings) => (
  !isObject(settings) || !Object.prototype.hasOwnProperty.call(settings, 'projects')
);

export const projectLabelFromPath = (projectPath, pathMod = path) => {
  if (typeof projectPath !== 'string') return '';
  const normalized = projectPath.replace(/\\/g, '/').replace(/\/+$/g, '') || projectPath;
  if (!normalized || normalized === '/') return 'Root';
  const base = pathMod.basename(normalized);
  return base || normalized;
};

const normalizeSessionProjectPath = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withSlashes = trimmed.replace(/\\/g, '/');
  return withSlashes === '/' ? withSlashes : withSlashes.replace(/\/+$/g, '');
};

const resolvedPrefix = (dir, pathMod) => {
  const resolved = pathMod.resolve(dir);
  return resolved.endsWith(pathMod.sep) ? resolved : `${resolved}${pathMod.sep}`;
};

export const isSkippedPiSessionProjectCwd = (cwd, options = {}) => {
  const pathMod = options.path || path;
  const normalized = normalizeSessionProjectPath(cwd);
  if (!normalized) return true;

  const resolved = pathMod.resolve(normalized);
  const segments = resolved.split(/[/\\]/).filter(Boolean);
  if (segments.includes('node_modules')) return true;

  const tmpRoots = [];
  const tmpdir = typeof options.tmpdir === 'string' && options.tmpdir.trim()
    ? options.tmpdir
    : os.tmpdir();
  if (tmpdir) tmpRoots.push(pathMod.resolve(tmpdir));
  for (const root of TMP_POSIX_ROOTS) {
    tmpRoots.push(root);
  }

  for (const root of tmpRoots) {
    if (!root) continue;
    const resolvedRoot = pathMod.resolve(root);
    if (resolved === resolvedRoot || resolved.startsWith(resolvedPrefix(resolvedRoot, pathMod))) {
      return true;
    }
  }

  return false;
};

const parseHeaderTimestamp = (value) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string' || !value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const readSessionHeader = async (filePath, fsPromises) => {
  let handle;
  try {
    handle = await fsPromises.open(filePath, 'r');
    const buffer = Buffer.alloc(HEADER_READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_READ_BYTES, 0);
    const text = buffer.toString('utf8', 0, bytesRead);
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed?.type === 'session' && typeof parsed.cwd === 'string' && parsed.cwd.trim()) {
          return {
            cwd: parsed.cwd.trim(),
            timestampMs: parseHeaderTimestamp(parsed.timestamp),
          };
        }
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (handle) {
      await handle.close().catch(() => {});
    }
  }
};

const listTopLevelJsonl = async (dir, fsPromises, pathMod) => {
  let entries;
  try {
    entries = await fsPromises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => (
      (entry.isFile() || entry.isSymbolicLink())
      && entry.name.endsWith('.jsonl')
    ))
    .map((entry) => pathMod.join(dir, entry.name));
};

/**
 * Walk `{agentDir}/sessions/` and collect existing project cwds from jsonl
 * headers. Do not decode encoded folder names. Nested child jsonl and
 * `archive/` are not projects. One unreadable folder does not drop the rest.
 */
export const discoverPiSessionProjects = async (options = {}) => {
  const pathMod = options.path || path;
  const fsPromises = options.fsPromises;
  const agentDir = typeof options.agentDir === 'string' ? options.agentDir.trim() : '';
  if (!fsPromises || !agentDir) return [];

  const sessionsRoot = pathMod.join(agentDir, 'sessions');
  let entries;
  try {
    entries = await fsPromises.readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const byPath = new Map();

  for (const entry of entries) {
    if (entry.name === SESSION_ARCHIVE_DIRNAME) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

    const sessionDir = pathMod.join(sessionsRoot, entry.name);
    let files;
    try {
      files = await listTopLevelJsonl(sessionDir, fsPromises, pathMod);
    } catch {
      continue;
    }

    for (const file of files) {
      const header = await readSessionHeader(file, fsPromises);
      if (!header) continue;

      const projectPath = normalizeSessionProjectPath(header.cwd);
      if (!projectPath || isSkippedPiSessionProjectCwd(projectPath, {
        path: pathMod,
        tmpdir: options.tmpdir,
      })) {
        continue;
      }

      let lastUpdated = header.timestampMs;
      try {
        const stats = await fsPromises.stat(file);
        if (Number.isFinite(stats.mtimeMs)) {
          lastUpdated = Math.max(lastUpdated, stats.mtimeMs);
        }
      } catch {
        // Keep the header timestamp when the file disappears mid-scan.
      }

      const existing = byPath.get(projectPath);
      if (!existing || lastUpdated > existing.lastUpdated) {
        byPath.set(projectPath, {
          path: projectPath,
          lastUpdated,
          label: projectLabelFromPath(projectPath, pathMod),
        });
      }
    }
  }

  const existing = [];
  for (const candidate of byPath.values()) {
    try {
      const stats = await fsPromises.stat(candidate.path);
      if (stats.isDirectory()) {
        existing.push(candidate);
      }
    } catch {
      // Missing leftovers stay off the first-install list.
    }
  }

  existing.sort((left, right) => {
    if (right.lastUpdated !== left.lastUpdated) return right.lastUpdated - left.lastUpdated;
    return left.path.localeCompare(right.path);
  });
  return existing;
};
