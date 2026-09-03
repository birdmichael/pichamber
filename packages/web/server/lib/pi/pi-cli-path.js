import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_CACHE_TTL_MS = 2000;

const asText = (value) => (typeof value === 'string' ? value.trim() : '');

const stripWrappingQuotes = (value) => {
  const trimmed = asText(value);
  if (trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const defaultIsExecutable = (filePath, { fsImpl = fs, platform = process.platform, pathModule = path } = {}) => {
  try {
    const stat = fsImpl.statSync(filePath);
    if (!stat.isFile()) return false;
    if (platform === 'win32') {
      const ext = pathModule.extname(filePath).toLowerCase();
      if (!ext) return true;
      return ['.exe', '.cmd', '.bat', '.com'].includes(ext);
    }
    fsImpl.accessSync(filePath, fsImpl.constants?.X_OK ?? fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const binaryNamesFor = (platform) => (
  platform === 'win32' ? ['pi.exe', 'pi.cmd', 'pi.bat', 'pi'] : ['pi']
);

const pushUniqueDir = (dirs, seen, dir) => {
  const trimmed = asText(dir);
  if (!trimmed) return;
  const key = trimmed.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  dirs.push(trimmed);
};

export const listPiCliPathCandidates = ({
  env = process.env,
  homedir = os.homedir(),
  platform = process.platform,
  pathModule = path,
  npmGlobalBins = [],
} = {}) => {
  const home = asText(typeof homedir === 'function' ? homedir() : homedir) || os.homedir();
  const names = binaryNamesFor(platform);
  const dirs = [];
  const seen = new Set();
  const tagged = [];

  const pathValue = asText(env?.PATH || env?.Path);
  if (pathValue) {
    for (const dir of pathValue.split(pathModule.delimiter)) {
      if (!asText(dir)) continue;
      pushUniqueDir(dirs, seen, dir);
      for (const name of names) {
        tagged.push({ path: pathModule.join(dir, name), source: 'path' });
      }
    }
  }

  const fallbackDirs = [
    pathModule.join(home, '.bun', 'bin'),
    pathModule.join(home, '.hermes', 'node', 'bin'),
    pathModule.join(home, '.local', 'bin'),
    pathModule.join(home, 'bin'),
    pathModule.join(home, '.npm-global', 'bin'),
  ];

  if (platform !== 'win32') {
    fallbackDirs.push(
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/home/linuxbrew/.linuxbrew/bin',
      '/usr/bin',
      '/bin',
    );
  } else {
    const userProfile = env?.USERPROFILE || home;
    const appData = env?.APPDATA || '';
    const programData = env?.ProgramData || 'C:\\ProgramData';
    const programFiles = env?.ProgramFiles || 'C:\\Program Files';
    fallbackDirs.push(
      appData ? pathModule.join(appData, 'npm') : '',
      pathModule.join(programFiles, 'nodejs'),
      pathModule.join(userProfile, 'scoop', 'shims'),
      pathModule.join(programData, 'chocolatey', 'bin'),
      pathModule.join(userProfile, '.bun', 'bin'),
    );
  }

  for (const dir of fallbackDirs) {
    const before = seen.size;
    pushUniqueDir(dirs, seen, dir);
    if (seen.size === before) continue;
    for (const name of names) {
      tagged.push({ path: pathModule.join(dir, name), source: 'fallback' });
    }
  }

  for (const dir of npmGlobalBins) {
    const before = seen.size;
    pushUniqueDir(dirs, seen, dir);
    if (seen.size === before) continue;
    for (const name of names) {
      tagged.push({ path: pathModule.join(dir, name), source: 'npm-global' });
    }
  }

  const unique = [];
  const seenPaths = new Set();
  for (const candidate of tagged) {
    const key = candidate.path.toLowerCase();
    if (seenPaths.has(key)) continue;
    seenPaths.add(key);
    unique.push(candidate);
  }
  return unique;
};

const resolveNpmGlobalBinDirs = ({
  env,
  platform,
  pathModule,
  spawn,
} = {}) => {
  const dirs = [];
  const prefix = asText(env?.npm_config_prefix || env?.NPM_CONFIG_PREFIX);
  if (prefix) {
    dirs.push(platform === 'win32' ? prefix : pathModule.join(prefix, 'bin'));
  }

  try {
    const result = spawn('npm', ['prefix', '-g'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 2000,
      env,
    });
    if (result?.status === 0) {
      const found = asText(result.stdout);
      if (found) {
        dirs.push(platform === 'win32' ? found : pathModule.join(found, 'bin'));
      }
    }
  } catch {
    // npm is optional; well-known fallbacks still run.
  }

  const unique = [];
  const seen = new Set();
  for (const dir of dirs) {
    const key = dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(dir);
  }
  return unique;
};

const resolveFromShell = ({
  platform,
  isExecutable,
  spawn,
  env,
} = {}) => {
  if (platform === 'win32') {
    try {
      const result = spawn('where', ['pi'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env,
      });
      if (result?.status === 0) {
        const lines = String(result.stdout || '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const found = lines.find((line) => isExecutable(line));
        if (found) return { path: found, source: 'where' };
      }
    } catch {
    }
    return null;
  }

  const shells = [env?.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh'].filter(Boolean);
  for (const shell of shells) {
    if (!isExecutable(shell)) continue;
    try {
      const result = spawn(shell, ['-lic', 'command -v pi'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env,
      });
      if (result?.status === 0) {
        const found = asText(result.stdout).split(/\s+/).pop() || '';
        if (found && isExecutable(found)) {
          return { path: found, source: 'shell' };
        }
      }
    } catch {
    }
  }
  return null;
};

const resolvePiCliPathUncached = (options = {}) => {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const pathModule = options.pathModule || path;
  const homedir = options.homedir || os.homedir;
  const spawn = typeof options.spawnSync === 'function' ? options.spawnSync : spawnSync;
  const isExecutable = typeof options.isExecutable === 'function'
    ? options.isExecutable
    : (filePath) => defaultIsExecutable(filePath, {
      fsImpl: options.fs || fs,
      platform,
      pathModule,
    });

  const explicit = [
    env?.PI_BINARY,
    env?.PI_PATH,
    env?.OPENCHAMBER_PI_PATH,
    env?.OPENCHAMBER_PI_BIN,
    env?.PICHAMBER_PI_BINARY,
  ]
    .map(stripWrappingQuotes)
    .filter(Boolean);

  for (const candidate of explicit) {
    if (isExecutable(candidate)) {
      return { path: candidate, source: 'env' };
    }
  }

  const providedNpmGlobalBins = Array.isArray(options.npmGlobalBins) ? options.npmGlobalBins : null;
  const candidates = listPiCliPathCandidates({
    env,
    homedir,
    platform,
    pathModule,
    npmGlobalBins: providedNpmGlobalBins || [],
  });

  for (const candidate of candidates) {
    if (isExecutable(candidate.path)) {
      return candidate;
    }
  }

  if (!providedNpmGlobalBins) {
    const discovered = resolveNpmGlobalBinDirs({ env, platform, pathModule, spawn });
    for (const dir of discovered) {
      for (const name of binaryNamesFor(platform)) {
        const candidate = pathModule.join(dir, name);
        if (isExecutable(candidate)) {
          return { path: candidate, source: 'npm-global' };
        }
      }
    }
  }

  return resolveFromShell({ platform, isExecutable, spawn, env });
};

let cache = { at: 0, result: undefined };

export const clearPiCliPathCache = () => {
  cache = { at: 0, result: undefined };
};

export const resolvePiCliPath = (options = {}) => {
  const now = typeof options.now === 'function' ? options.now() : Date.now();
  const ttl = Number.isFinite(options.ttlMs) ? options.ttlMs : DEFAULT_CACHE_TTL_MS;
  if (options.bypassCache !== true && cache.result !== undefined && (now - cache.at) < ttl) {
    return cache.result;
  }
  const result = resolvePiCliPathUncached(options) || null;
  cache = { at: now, result };
  return result;
};
