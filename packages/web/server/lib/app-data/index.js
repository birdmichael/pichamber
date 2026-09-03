import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PICHAMBER_DATA_DIR_ENV = 'PICHAMBER_DATA_DIR';
export const OPENCHAMBER_DATA_DIR_ENV = 'OPENCHAMBER_DATA_DIR';
export const APP_DATA_DIR_NAME = 'pichamber';
export const LEGACY_APP_DATA_DIR_NAME = 'openchamber';

const MANAGED_CHATS_PATH_MARKERS = [
  `/.config/${APP_DATA_DIR_NAME}/chats`,
  `/.config/${LEGACY_APP_DATA_DIR_NAME}/chats`,
];

const attemptedMigrations = new Set();

function nodeFs() {
  return fs;
}

function trimEnvValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function samePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function isInside(parent, child) {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  if (resolvedParent === resolvedChild) return true;
  return resolvedChild.startsWith(resolvedParent + path.sep);
}

function statOrNull(fsImpl, target) {
  try {
    return fsImpl.lstatSync(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function isDirectory(fsImpl, target) {
  return Boolean(statOrNull(fsImpl, target)?.isDirectory());
}

function listNames(fsImpl, target) {
  try {
    return fsImpl.readdirSync(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function isEmptyDirectory(fsImpl, target) {
  const stat = statOrNull(fsImpl, target);
  if (!stat) return true;
  if (!stat.isDirectory()) return false;
  return listNames(fsImpl, target).length === 0;
}

function isNonEmptyDirectory(fsImpl, target) {
  return isDirectory(fsImpl, target) && listNames(fsImpl, target).length > 0;
}

function walkRelativeEntries(fsImpl, root) {
  const entries = [];
  const stack = ['.'];
  while (stack.length > 0) {
    const relative = stack.pop();
    const full = relative === '.' ? root : path.join(root, relative);
    for (const name of listNames(fsImpl, full)) {
      const childRelative = relative === '.' ? name : path.join(relative, name);
      const childFull = path.join(root, childRelative);
      const stat = statOrNull(fsImpl, childFull);
      if (!stat) continue;
      if (stat.isDirectory()) {
        entries.push({ relative: childRelative, type: 'dir' });
        stack.push(childRelative);
        continue;
      }
      if (stat.isSymbolicLink()) {
        entries.push({
          relative: childRelative,
          type: 'symlink',
          target: fsImpl.readlinkSync(childFull),
        });
        continue;
      }
      entries.push({
        relative: childRelative,
        type: 'file',
        size: stat.size,
      });
    }
  }
  entries.sort((left, right) => left.relative.localeCompare(right.relative));
  return entries;
}

function describeEntry(entry) {
  if (entry.type === 'dir') return `dir:${entry.relative}`;
  if (entry.type === 'symlink') return `symlink:${entry.relative}->${entry.target}`;
  return `file:${entry.relative}:${entry.size}`;
}

function verifyCopy(fsImpl, source, dest) {
  const sourceEntries = walkRelativeEntries(fsImpl, source);
  const destEntries = walkRelativeEntries(fsImpl, dest);
  if (sourceEntries.length !== destEntries.length) {
    const error = new Error('App data migration copy did not verify.');
    error.code = 'ERR_PICHAMBER_APP_DATA_VERIFY';
    throw error;
  }
  for (let index = 0; index < sourceEntries.length; index += 1) {
    if (describeEntry(sourceEntries[index]) !== describeEntry(destEntries[index])) {
      const error = new Error('App data migration copy did not verify.');
      error.code = 'ERR_PICHAMBER_APP_DATA_VERIFY';
      throw error;
    }
  }
}

function removeTree(fsImpl, target) {
  try {
    fsImpl.rmSync(target, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup of a failed staging tree.
  }
}

function migrateLegacyAppDataDir(source, dest, fsImpl) {
  const key = `${path.resolve(source)}\0${path.resolve(dest)}`;
  if (attemptedMigrations.has(key)) return;
  attemptedMigrations.add(key);

  if (samePath(source, dest) || isInside(source, dest) || isInside(dest, source)) {
    return;
  }
  if (!isNonEmptyDirectory(fsImpl, source)) return;
  if (isNonEmptyDirectory(fsImpl, dest)) return;
  const destStat = statOrNull(fsImpl, dest);
  if (destStat && !destStat.isDirectory()) return;

  const staging = `${dest}.migrating-${process.pid}`;
  const destExisted = Boolean(destStat);
  const destWasEmpty = destExisted && isEmptyDirectory(fsImpl, dest);
  try {
    removeTree(fsImpl, staging);
    fsImpl.cpSync(source, staging, {
      recursive: true,
      force: false,
      dereference: false,
      preserveTimestamps: true,
    });
    verifyCopy(fsImpl, source, staging);
    if (destWasEmpty) {
      removeTree(fsImpl, dest);
    }
    fsImpl.renameSync(staging, dest);
  } catch (error) {
    removeTree(fsImpl, staging);
    if (!destExisted) {
      removeTree(fsImpl, dest);
    } else if (destWasEmpty && !isDirectory(fsImpl, dest)) {
      try {
        fsImpl.mkdirSync(dest, { recursive: true });
      } catch {
        // Best-effort restore of the empty dest this attempt removed.
      }
    }
    const wrapped = new Error('App data migration failed.');
    wrapped.code = 'ERR_PICHAMBER_APP_DATA_MIGRATE';
    wrapped.cause = error;
    throw wrapped;
  }
}

export function defaultAppDataDir(home = os.homedir()) {
  return path.join(home, '.config', APP_DATA_DIR_NAME);
}

export function legacyAppDataDir(home = os.homedir()) {
  return path.join(home, '.config', LEGACY_APP_DATA_DIR_NAME);
}

export function resolveOverrideDataDir(env = process.env) {
  const branded = trimEnvValue(env?.[PICHAMBER_DATA_DIR_ENV]);
  if (branded) return path.resolve(branded);
  const alias = trimEnvValue(env?.[OPENCHAMBER_DATA_DIR_ENV]);
  if (alias) return path.resolve(alias);
  return null;
}

export function isManagedChatsPath(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  return MANAGED_CHATS_PATH_MARKERS.some((marker) => normalized.includes(marker));
}

export function resetAppDataDirCacheForTests() {
  attemptedMigrations.clear();
}

export function resolveAppDataDir(options = {}) {
  const env = options.env ?? process.env;
  const home = options.home ?? os.homedir();
  const fsImpl = options.fs ?? nodeFs();
  const migrate = options.migrate !== false;
  const override = resolveOverrideDataDir(env);
  if (override) return override;

  const dest = defaultAppDataDir(home);
  if (migrate) {
    try {
      migrateLegacyAppDataDir(legacyAppDataDir(home), dest, fsImpl);
    } catch (error) {
      // Source is left intact. Dest/staging are rolled back. Continue on the
      // branded path so a failed copy cannot strand the process on the old dir.
      if (error?.code !== 'ERR_PICHAMBER_APP_DATA_MIGRATE' && error?.code !== 'ERR_PICHAMBER_APP_DATA_VERIFY') {
        throw error;
      }
    }
  }
  return dest;
}
