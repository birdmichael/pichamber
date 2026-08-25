import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolvePiAgentDir } from './pi-resources.js';
import {
  comparePiSdkVersions,
  fetchLatestNpmPackageVersion,
  shouldSkipPiVersionCheck,
} from './pi-upgrade-status.js';

const PI_PACKAGE_VERSION_TTL_MS = 5 * 60 * 1000;
// Match DefaultPackageManager.update's in-process concurrency.
const PI_PACKAGE_VERSION_CONCURRENCY = 4;

const latestVersionCache = new Map();
const latestVersionInflight = new Map();

export const invalidatePiPackageVersionCache = () => {
  latestVersionCache.clear();
  latestVersionInflight.clear();
};

const mapWithConcurrency = async (items, limit, mapper) => {
  const results = new Array(items.length);
  let next = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
};

const NPM_SPEC_PATTERN = /^(?:npm:)?(@[^/]+\/[^@\s]+|[^@/\s:]+)(?:@(.+))?$/;

const isFile = (value) => {
  try {
    return fs.statSync(value).isFile();
  } catch {
    return false;
  }
};

const readJsonObject = (filePath) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const parsePiPackageSpec = (source) => {
  const spec = typeof source === 'string' ? source.trim() : '';
  if (!spec) return null;
  if (
    spec.startsWith('git:')
    || spec.startsWith('git@')
    || /^https?:\/\//.test(spec)
    || spec.startsWith('ssh://')
  ) {
    return { kind: 'git', source: spec, name: spec, version: null, pinned: false };
  }
  const looksLocal = spec.startsWith('/')
    || spec.startsWith('.')
    || spec.includes('\\')
    || /^[A-Za-z]:[\\/]/.test(spec);
  if (looksLocal) {
    return { kind: 'local', source: spec, name: spec, version: null, pinned: false };
  }
  const match = spec.match(NPM_SPEC_PATTERN);
  if (!match) {
    return { kind: 'unknown', source: spec, name: spec, version: null, pinned: false };
  }
  const rawVersion = typeof match[2] === 'string' ? match[2].trim() : '';
  const version = rawVersion && rawVersion.toLowerCase() !== 'latest' ? rawVersion.replace(/^v/i, '') : null;
  const pinned = Boolean(version)
    && !version.startsWith('^')
    && !version.startsWith('~')
    && !version.includes('*')
    && !version.includes('x')
    && !version.includes('X');
  return {
    kind: 'npm',
    source: spec,
    name: match[1],
    version,
    pinned,
  };
};

const resolveManagedNpmPackageJsonPath = ({
  home = os.homedir(),
  directory,
  scope,
  packageName,
} = {}) => {
  const name = typeof packageName === 'string' ? packageName.trim() : '';
  if (!name) return '';
  if (scope === 'project') {
    const cwd = typeof directory === 'string' ? directory.trim() : '';
    if (!cwd) return '';
    return path.join(path.resolve(cwd), '.pi', 'npm', 'node_modules', name, 'package.json');
  }
  return path.join(resolvePiAgentDir(home), 'npm', 'node_modules', name, 'package.json');
};

const readInstalledNpmPackageVersion = (packageJsonPath) => {
  if (!packageJsonPath || !isFile(packageJsonPath)) return null;
  const pkg = readJsonObject(packageJsonPath);
  const version = typeof pkg.version === 'string' ? pkg.version.trim().replace(/^v/i, '') : '';
  return version || null;
};

export const packageHasUpdate = ({ currentVersion, latestVersion, pinned, kind } = {}) => {
  if (kind && kind !== 'npm') return false;
  if (pinned) return false;
  if (!currentVersion || !latestVersion) return false;
  return comparePiSdkVersions(latestVersion, currentVersion) > 0;
};

export const enrichPiPackageVersions = async (
  packages,
  {
    home = os.homedir(),
    directory,
    env = process.env,
    fetchImpl = fetch,
    now = Date.now,
    ttlMs = PI_PACKAGE_VERSION_TTL_MS,
    concurrency = PI_PACKAGE_VERSION_CONCURRENCY,
  } = {},
) => {
  const rows = Array.isArray(packages) ? packages : [];
  const skipLatest = shouldSkipPiVersionCheck(env);

  const resolveLatest = async (name) => {
    if (skipLatest) return null;
    const at = typeof now === 'function' ? now() : now;
    const cached = latestVersionCache.get(name);
    if (cached && at < cached.expiresAt) return cached.version;
    const pending = latestVersionInflight.get(name);
    if (pending) return pending;
    const request = (async () => {
      try {
        const latest = await fetchLatestNpmPackageVersion(name, { fetchImpl, env });
        latestVersionCache.set(name, {
          version: latest,
          expiresAt: (typeof now === 'function' ? now() : now) + ttlMs,
        });
        return latest;
      } catch {
        return null;
      } finally {
        latestVersionInflight.delete(name);
      }
    })();
    latestVersionInflight.set(name, request);
    return request;
  };

  return mapWithConcurrency(rows, concurrency, async (item) => {
    const parsed = parsePiPackageSpec(item?.path || item?.source || '');
    const kind = parsed?.kind || item?.source || 'unknown';
    const packageName = parsed?.kind === 'npm' ? parsed.name : (typeof item?.name === 'string' ? item.name : '');
    const installedVersion = parsed?.kind === 'npm'
      ? readInstalledNpmPackageVersion(resolveManagedNpmPackageJsonPath({
        home,
        directory,
        scope: item?.scope,
        packageName,
      }))
      : null;
    const currentVersion = installedVersion || parsed?.version || null;
    const latestVersion = parsed?.kind === 'npm' && packageName
      ? await resolveLatest(packageName)
      : null;
    const pinned = Boolean(parsed?.pinned);
    return {
      ...item,
      currentVersion,
      latestVersion,
      pinned,
      updateAvailable: packageHasUpdate({
        currentVersion,
        latestVersion,
        pinned,
        kind: parsed?.kind,
      }),
      kind,
    };
  });
};
