/**
 * Repository-shared project config (`<repo>/.pichamber/project.json`).
 *
 * Pi keeps personal setup in ~/.config/pichamber/projects/<id>.json (client-owned
 * keys). The shared file is optional and lives in the checkout so teammates who
 * pull the repo get the same plans folder, and (later) the same actions / setup
 * commands / draft starters. This module is pure parse/serialize; callers own IO.
 *
 * Naming: prefer `.pichamber/` (not `.openchamber/` or OpenCode paths).
 */

const SHARED_CONFIG_VERSION = 1;

export const SHARED_CONFIG_RELATIVE_PATH = '.pichamber/project.json';
/** Where repository plans live unless the shared file's `plansDir` says otherwise. */
export const DEFAULT_PLANS_DIR = '.pichamber/plans';

const trimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const isObjectRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

/**
 * A `plansDir` is a relative path inside the repo: no absolute paths, no
 * drive letters, no `..` segments, forward slashes. Returns the normalized
 * value or `null` when the value is not acceptable.
 */
export const normalizePlansDir = (value: unknown): string | null => {
  const raw = trimmedString(value).replace(/\\/g, '/');
  if (!raw) return null;
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) return null;
  const segments = raw.split('/').filter((segment) => segment.length > 0 && segment !== '.');
  if (segments.length === 0 || segments.some((segment) => segment === '..')) return null;
  return segments.join('/');
};

export type SharedProjectConfig = {
  setupWorktree: string[];
  setupWorktreeWait: boolean | null;
  projectActions: unknown[];
  draftStarters: unknown[];
  plansDir: string | null;
};

export type SharedProjectConfigRead =
  | { status: 'missing'; path: string }
  | { status: 'invalid'; path: string; reason: string }
  | { status: 'ok'; path: string; config: SharedProjectConfig };

const EMPTY_SHARED: SharedProjectConfig = Object.freeze({
  setupWorktree: [],
  setupWorktreeWait: null,
  projectActions: [],
  draftStarters: [],
  plansDir: null,
});

export const EMPTY_SHARED_PROJECT_CONFIG: SharedProjectConfig = EMPTY_SHARED;

/**
 * Parse the text of a shared file. Anything that is not a version-1 object
 * is `invalid` with a reason. A `plansDir` that points outside the repo is
 * invalid for the same reason.
 */
export const parseSharedProjectConfig = (raw: string): SharedProjectConfigRead => {
  const path = SHARED_CONFIG_RELATIVE_PATH;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      status: 'invalid',
      path,
      reason: `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!isObjectRecord(parsed)) return { status: 'invalid', path, reason: 'not an object' };
  if (parsed.version !== SHARED_CONFIG_VERSION) {
    return { status: 'invalid', path, reason: `unsupported version ${JSON.stringify(parsed.version)}` };
  }
  if ('setupWorktree' in parsed && !Array.isArray(parsed.setupWorktree)) {
    return { status: 'invalid', path, reason: 'setupWorktree must be an array' };
  }
  if ('setupWorktreeWait' in parsed && typeof parsed.setupWorktreeWait !== 'boolean') {
    return { status: 'invalid', path, reason: 'setupWorktreeWait must be a boolean' };
  }
  if ('projectActions' in parsed && !Array.isArray(parsed.projectActions)) {
    return { status: 'invalid', path, reason: 'projectActions must be an array' };
  }
  if ('draftStarters' in parsed && !Array.isArray(parsed.draftStarters)) {
    return { status: 'invalid', path, reason: 'draftStarters must be an array' };
  }
  let plansDir: string | null = null;
  if ('plansDir' in parsed && parsed.plansDir !== null) {
    plansDir = normalizePlansDir(parsed.plansDir);
    if (!plansDir) {
      return { status: 'invalid', path, reason: 'plansDir must be a relative path inside the repository' };
    }
  }
  return {
    status: 'ok',
    path,
    config: {
      setupWorktree: Array.isArray(parsed.setupWorktree)
        ? parsed.setupWorktree.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [],
      setupWorktreeWait: typeof parsed.setupWorktreeWait === 'boolean' ? parsed.setupWorktreeWait : null,
      projectActions: Array.isArray(parsed.projectActions) ? parsed.projectActions : [],
      draftStarters: Array.isArray(parsed.draftStarters) ? parsed.draftStarters : [],
      plansDir,
    },
  };
};

/** True when the shared config carries nothing: the file should not exist. */
export const isSharedProjectConfigEmpty = (config: SharedProjectConfig): boolean => (
  config.setupWorktree.length === 0
  && config.setupWorktreeWait === null
  && config.projectActions.length === 0
  && config.draftStarters.length === 0
  && config.plansDir === null
);

/**
 * The bytes of a shared file: version first, then only the keys that carry
 * something, in a fixed order, pretty-printed.
 */
export const serializeSharedProjectConfig = (config: SharedProjectConfig): string => {
  const document: Record<string, unknown> = { version: SHARED_CONFIG_VERSION };
  if (config.setupWorktree.length > 0) document.setupWorktree = config.setupWorktree;
  if (config.setupWorktreeWait !== null) document.setupWorktreeWait = config.setupWorktreeWait;
  if (config.projectActions.length > 0) document.projectActions = config.projectActions;
  if (config.draftStarters.length > 0) document.draftStarters = config.draftStarters;
  if (config.plansDir !== null) document.plansDir = config.plansDir;
  return `${JSON.stringify(document, null, 2)}\n`;
};

export type SharedProjectConfigPatch = Partial<{
  setupWorktree: string[];
  setupWorktreeWait: boolean | null;
  projectActions: unknown[];
  draftStarters: unknown[];
  plansDir: string | null;
}>;

/**
 * The next shared config after a client patch. Every named key replaces the
 * current value; a wrongly shaped key throws; a `plansDir` outside the repo
 * is refused rather than stored.
 */
export const applySharedProjectSetupPatch = (
  current: SharedProjectConfig,
  patch: SharedProjectConfigPatch,
): SharedProjectConfig => {
  if (!isObjectRecord(patch)) throw new Error('patch must be an object');
  const next: SharedProjectConfig = { ...current };
  if ('setupWorktree' in patch) {
    if (!Array.isArray(patch.setupWorktree)) throw new Error('setupWorktree must be an array of commands');
    next.setupWorktree = patch.setupWorktree
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean);
  }
  if ('setupWorktreeWait' in patch) {
    if (patch.setupWorktreeWait !== null && typeof patch.setupWorktreeWait !== 'boolean') {
      throw new Error('setupWorktreeWait must be a boolean or null');
    }
    next.setupWorktreeWait = patch.setupWorktreeWait ?? null;
  }
  if ('projectActions' in patch) {
    if (!Array.isArray(patch.projectActions)) throw new Error('projectActions must be an array');
    next.projectActions = patch.projectActions;
  }
  if ('draftStarters' in patch) {
    if (!Array.isArray(patch.draftStarters)) throw new Error('draftStarters must be an array');
    next.draftStarters = patch.draftStarters;
  }
  if ('plansDir' in patch) {
    if (patch.plansDir === null || (typeof patch.plansDir === 'string' && !patch.plansDir.trim())) {
      next.plansDir = null;
    } else {
      const plansDir = normalizePlansDir(patch.plansDir);
      if (!plansDir) throw new Error('plansDir must be a relative path inside the repository');
      next.plansDir = plansDir;
    }
  }
  return next;
};

/** Relative plans folder for a shared read: custom when set, else the default. */
export const resolvePlansDirRelative = (read: SharedProjectConfigRead): string => {
  if (read.status === 'ok' && read.config.plansDir) {
    return read.config.plansDir;
  }
  return DEFAULT_PLANS_DIR;
};
