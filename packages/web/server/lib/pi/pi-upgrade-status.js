import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PI_SDK_PACKAGE = '@earendil-works/pi-coding-agent';

const require = createRequire(import.meta.url);
const NPM_LATEST_URL = `https://registry.npmjs.org/${encodeURIComponent(PI_SDK_PACKAGE).replace('%40', '@')}/latest`;
const FETCH_TIMEOUT_MS = 10_000;

const isEnvFlagPresent = (value) => {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && normalized !== '0' && normalized !== 'false';
};

export const shouldSkipPiVersionCheck = (env = process.env) => (
  isEnvFlagPresent(env.PI_OFFLINE) || isEnvFlagPresent(env.PI_SKIP_VERSION_CHECK)
);

const parseVersionForComparison = (value) => {
  const raw = typeof value === 'string' ? value.trim().replace(/^v/i, '') : '';
  const prereleaseIndex = raw.search(/[-+]/);
  const core = prereleaseIndex >= 0 ? raw.slice(0, prereleaseIndex) : raw;
  const parts = core.split('.').map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  return { parts, prerelease: prereleaseIndex >= 0 };
};

export const comparePiSdkVersions = (left, right) => {
  const a = parseVersionForComparison(left);
  const b = parseVersionForComparison(right);
  const length = Math.max(a.parts.length, b.parts.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a.parts[index] || 0) - (b.parts[index] || 0);
    if (diff !== 0) return diff;
  }
  if (a.prerelease !== b.prerelease) return a.prerelease ? -1 : 1;
  return 0;
};

export const readInstalledPiSdkVersion = () => {
  try {
    const pkgPath = require.resolve(`${PI_SDK_PACKAGE}/package.json`);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (typeof pkg?.version === 'string' && pkg.version.trim()) {
      return pkg.version.trim().replace(/^v/i, '');
    }
  } catch {
  }
  try {
    const webPackagePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../package.json',
    );
    const pkg = JSON.parse(fs.readFileSync(webPackagePath, 'utf8'));
    const declared = pkg?.dependencies?.[PI_SDK_PACKAGE];
    if (typeof declared === 'string' && declared.trim()) {
      return declared.trim().replace(/^[^\d]*/, '');
    }
  } catch {
  }
  return null;
};

export const fetchLatestPiSdkVersion = async ({ fetchImpl = fetch, env = process.env } = {}) => {
  if (shouldSkipPiVersionCheck(env)) return null;
  const response = await fetchImpl(NPM_LATEST_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  const version = typeof payload?.version === 'string' ? payload.version.trim().replace(/^v/i, '') : '';
  return version || null;
};

export const getPiUpgradeStatus = async ({
  fetchImpl = fetch,
  env = process.env,
  currentVersion = readInstalledPiSdkVersion(),
} = {}) => {
  const upgrade = { supported: false, reason: 'bundled' };
  if (shouldSkipPiVersionCheck(env)) {
    return {
      available: false,
      currentVersion,
      latestVersion: null,
      package: PI_SDK_PACKAGE,
      upgrade,
    };
  }
  try {
    const latestVersion = await fetchLatestPiSdkVersion({ fetchImpl, env });
    if (!currentVersion || !latestVersion) {
      return {
        available: false,
        currentVersion,
        latestVersion,
        package: PI_SDK_PACKAGE,
        upgrade,
      };
    }
    return {
      available: comparePiSdkVersions(latestVersion, currentVersion) > 0,
      currentVersion,
      latestVersion,
      package: PI_SDK_PACKAGE,
      upgrade,
    };
  } catch {
    return {
      available: false,
      currentVersion,
      latestVersion: null,
      package: PI_SDK_PACKAGE,
      upgrade,
    };
  }
};
