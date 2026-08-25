import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolvePiAgentDir } from './pi-resources.js';
import {
  comparePiSdkVersions,
  fetchLatestNpmPackageVersion,
  shouldSkipPiVersionCheck,
} from './pi-upgrade-status.js';

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
  } = {},
) => {
  const rows = Array.isArray(packages) ? packages : [];
  const skipLatest = shouldSkipPiVersionCheck(env);
  const latestByName = new Map();

  const resolveLatest = async (name) => {
    if (skipLatest) return null;
    if (latestByName.has(name)) return latestByName.get(name);
    try {
      const latest = await fetchLatestNpmPackageVersion(name, { fetchImpl, env });
      latestByName.set(name, latest);
      return latest;
    } catch {
      latestByName.set(name, null);
      return null;
    }
  };

  const enriched = [];
  for (const item of rows) {
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
    enriched.push({
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
    });
  }
  return enriched;
};
