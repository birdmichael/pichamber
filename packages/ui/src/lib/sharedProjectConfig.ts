/**
 * Repository-shared project config (`<repo>/.pichamber/project.json`).
 *
 * Personal setup stays in ~/.config/pichamber/projects/<id>.json. The shared
 * file is optional and committed so teammates get the same plans folder,
 * actions, setup commands, and draft starters. Pure parse/serialize/merge;
 * callers own IO.
 *
 * Naming: prefer `.pichamber/` (not `.openchamber/` / OpenCode paths).
 */

export const SHARED_CONFIG_RELATIVE_PATH = '.pichamber/project.json';
export const DEFAULT_PLANS_DIR = '.pichamber/plans';
const SHARED_CONFIG_VERSION = 1;

const ACTION_NAME_MAX_LENGTH = 80;
const ACTION_COMMAND_MAX_LENGTH = 4000;
const ACTION_OPEN_URL_MAX_LENGTH = 2000;
const ACTION_DESKTOP_FORWARD_MAX_LENGTH = 300;
const SETUP_COMMAND_MAX_LENGTH = 4000;
const SETUP_COMMANDS_MAX = 50;
const ACTION_PLATFORMS = new Set(['macos', 'linux', 'windows']);
const SETUP_WORKTREE_MODES = new Set(['append', 'replace']);

const trimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const clamp = (value: string, maxLength: number): string => (value.length > maxLength ? value.slice(0, maxLength) : value);
const isObjectRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

export type ProjectSetupSource = 'shared' | 'personal';
export type SharedProjectActionPlatform = 'macos' | 'linux' | 'windows';

export type SharedProjectAction = {
  id: string;
  name: string;
  command: string;
  icon?: string | null;
  runIn?: 'parent';
  platforms?: SharedProjectActionPlatform[];
  autoOpenUrl?: boolean;
  openUrl?: string;
  desktopOpenSshForward?: string;
  source?: ProjectSetupSource;
};

export type SharedDraftStarter = { type: 'command' | 'skill'; name: string; source?: ProjectSetupSource };

export type SharedProjectConfig = {
  setupWorktree: string[];
  setupWorktreeWait: boolean | null;
  projectActions: SharedProjectAction[];
  draftStarters: SharedDraftStarter[];
  plansDir: string | null;
};

export type SharedProjectConfigRead =
  | { status: 'missing'; path: string }
  | { status: 'invalid'; path: string; reason: string }
  | { status: 'ok'; path: string; config: SharedProjectConfig };

export type PersonalProjectSetup = {
  setupWorktree: string[];
  setupWorktreeWait: boolean | null;
  setupWorktreeMode: 'append' | 'replace';
  projectActions: SharedProjectAction[];
  projectActionsPrimaryId: string | null;
  draftStarters: SharedDraftStarter[];
  hiddenSharedActionIds: string[];
  sharedTrust: { hash: string; trustedAt: number } | null;
};

export type ProjectSetup = {
  trust: { hash: string | null; trusted: boolean };
  setupWorktree: string[];
  setupWorktreeWait: boolean;
  projectActions: Array<SharedProjectAction & { source: ProjectSetupSource }>;
  projectActionsPrimaryId: string | null;
  draftStarters: Array<SharedDraftStarter & { source: ProjectSetupSource }>;
  shared: SharedProjectConfigRead extends never ? never : {
    status: 'missing' | 'ok' | 'invalid';
    reason?: string;
    path: string;
    setupWorktree: string[];
    setupWorktreeWait: boolean | null;
    projectActions: SharedProjectAction[];
    draftStarters: SharedDraftStarter[];
    plansDir: string | null;
  };
  personal: PersonalProjectSetup;
};

export const normalizePlansDir = (value: unknown): string | null => {
  const raw = trimmedString(value).replace(/\\/g, '/');
  if (!raw) return null;
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) return null;
  const segments = raw.split('/').filter((segment) => segment.length > 0 && segment !== '.');
  if (segments.length === 0 || segments.some((segment) => segment === '..')) return null;
  return segments.join('/');
};

export const sanitizeSetupCommands = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const commands: string[] = [];
  for (const entry of value) {
    const command = clamp(trimmedString(entry), SETUP_COMMAND_MAX_LENGTH);
    if (!command) continue;
    commands.push(command);
    if (commands.length >= SETUP_COMMANDS_MAX) break;
  }
  return commands;
};

const sanitizeActionPlatforms = (value: unknown): SharedProjectActionPlatform[] => {
  if (!Array.isArray(value)) return [];
  const platforms: SharedProjectActionPlatform[] = [];
  for (const entry of value) {
    const platform = trimmedString(entry).toLowerCase();
    if (ACTION_PLATFORMS.has(platform) && !platforms.includes(platform as SharedProjectActionPlatform)) {
      platforms.push(platform as SharedProjectActionPlatform);
    }
  }
  return platforms;
};

export const sanitizeProjectActions = (value: unknown): SharedProjectAction[] => {
  if (!Array.isArray(value)) return [];
  const actions: SharedProjectAction[] = [];
  const seenIds = new Set<string>();
  for (const entry of value) {
    if (!isObjectRecord(entry)) continue;
    const id = trimmedString(entry.id);
    const name = clamp(trimmedString(entry.name), ACTION_NAME_MAX_LENGTH);
    const command = clamp(trimmedString(entry.command), ACTION_COMMAND_MAX_LENGTH);
    if (!id || !name || !command || seenIds.has(id)) continue;
    seenIds.add(id);
    const icon = trimmedString(entry.icon);
    const platforms = sanitizeActionPlatforms(entry.platforms);
    const openUrl = clamp(trimmedString(entry.openUrl), ACTION_OPEN_URL_MAX_LENGTH);
    const desktopOpenSshForward = clamp(trimmedString(entry.desktopOpenSshForward), ACTION_DESKTOP_FORWARD_MAX_LENGTH);
    const action: SharedProjectAction = { id, name, command, icon: icon || null };
    if (entry.autoOpenUrl === true) action.autoOpenUrl = true;
    if (openUrl) action.openUrl = openUrl;
    if (desktopOpenSshForward) action.desktopOpenSshForward = desktopOpenSshForward;
    if (platforms.length > 0) action.platforms = platforms;
    if (entry.runIn === 'parent') action.runIn = 'parent';
    actions.push(action);
  }
  return actions;
};

export const sanitizeDraftStarters = (value: unknown): SharedDraftStarter[] => {
  if (!Array.isArray(value)) return [];
  const starters: SharedDraftStarter[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isObjectRecord(entry)) continue;
    const type = entry.type === 'command' || entry.type === 'skill' ? entry.type : null;
    const name = trimmedString(entry.name);
    if (!type || !name) continue;
    const key = `${type}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    starters.push({ type, name });
  }
  return starters;
};

const sanitizeIdList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const entry of value) {
    const id = trimmedString(entry);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
};

const sharedTrustOf = (value: unknown): PersonalProjectSetup['sharedTrust'] => {
  if (!isObjectRecord(value)) return null;
  const hash = trimmedString(value.hash);
  if (!hash) return null;
  return { hash, trustedAt: Number.isFinite(value.trustedAt) ? Number(value.trustedAt) : 0 };
};

/** Personal view from the personal config document (client-owned keys). */
export const personalSetupOf = (raw: unknown): PersonalProjectSetup => {
  const document = isObjectRecord(raw) ? raw : {};
  const projectActions = sanitizeProjectActions(document.projectActions);
  const primaryRaw = trimmedString(document.projectActionsPrimaryId);
  return {
    setupWorktree: sanitizeSetupCommands(document['setup-worktree']),
    setupWorktreeWait: typeof document['setup-worktree-wait'] === 'boolean' ? document['setup-worktree-wait'] : null,
    setupWorktreeMode: SETUP_WORKTREE_MODES.has(String(document.setupWorktreeMode))
      ? (document.setupWorktreeMode as 'append' | 'replace')
      : 'append',
    projectActions,
    projectActionsPrimaryId: primaryRaw && projectActions.some((action) => action.id === primaryRaw) ? primaryRaw : null,
    draftStarters: sanitizeDraftStarters(document.draftStarters),
    hiddenSharedActionIds: sanitizeIdList(document.hiddenSharedActionIds),
    sharedTrust: sharedTrustOf(document.sharedTrust),
  };
};

const EMPTY_SHARED: SharedProjectConfig = Object.freeze({
  setupWorktree: [],
  setupWorktreeWait: null,
  projectActions: [],
  draftStarters: [],
  plansDir: null,
});

export const EMPTY_SHARED_PROJECT_CONFIG: SharedProjectConfig = EMPTY_SHARED;

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
      setupWorktree: sanitizeSetupCommands(parsed.setupWorktree),
      setupWorktreeWait: typeof parsed.setupWorktreeWait === 'boolean' ? parsed.setupWorktreeWait : null,
      projectActions: sanitizeProjectActions(parsed.projectActions),
      draftStarters: sanitizeDraftStarters(parsed.draftStarters),
      plansDir,
    },
  };
};

export const isSharedProjectConfigEmpty = (config: SharedProjectConfig): boolean => (
  config.setupWorktree.length === 0
  && config.setupWorktreeWait === null
  && config.projectActions.length === 0
  && config.draftStarters.length === 0
  && config.plansDir === null
);

const withoutEmptyIcon = (action: SharedProjectAction): SharedProjectAction => {
  if (action.icon !== null && action.icon !== undefined) {
    const { source, ...rest } = action;
    void source;
    return rest;
  }
  const { icon, source, ...rest } = action;
  void icon;
  void source;
  return rest;
};

export const serializeSharedProjectConfig = (config: SharedProjectConfig): string => {
  const document: Record<string, unknown> = { version: SHARED_CONFIG_VERSION };
  if (config.setupWorktree.length > 0) document.setupWorktree = config.setupWorktree;
  if (config.setupWorktreeWait !== null) document.setupWorktreeWait = config.setupWorktreeWait;
  if (config.projectActions.length > 0) {
    document.projectActions = sanitizeProjectActions(config.projectActions).map(withoutEmptyIcon);
  }
  if (config.draftStarters.length > 0) document.draftStarters = config.draftStarters.map(({ type, name }) => ({ type, name }));
  if (config.plansDir !== null) document.plansDir = config.plansDir;
  return `${JSON.stringify(document, null, 2)}\n`;
};

export type SharedProjectConfigPatch = Partial<{
  setupWorktree: string[];
  setupWorktreeWait: boolean | null;
  projectActions: SharedProjectAction[];
  draftStarters: SharedDraftStarter[];
  plansDir: string | null;
}>;

export const applySharedProjectSetupPatch = (
  current: SharedProjectConfig,
  patch: SharedProjectConfigPatch,
): SharedProjectConfig => {
  if (!isObjectRecord(patch)) throw new Error('patch must be an object');
  const next: SharedProjectConfig = {
    setupWorktree: [...current.setupWorktree],
    setupWorktreeWait: current.setupWorktreeWait,
    projectActions: [...current.projectActions],
    draftStarters: [...current.draftStarters],
    plansDir: current.plansDir,
  };
  if ('setupWorktree' in patch) {
    if (!Array.isArray(patch.setupWorktree)) throw new Error('setupWorktree must be an array of commands');
    next.setupWorktree = sanitizeSetupCommands(patch.setupWorktree);
  }
  if ('setupWorktreeWait' in patch) {
    if (patch.setupWorktreeWait !== null && typeof patch.setupWorktreeWait !== 'boolean') {
      throw new Error('setupWorktreeWait must be a boolean or null');
    }
    next.setupWorktreeWait = patch.setupWorktreeWait ?? null;
  }
  if ('projectActions' in patch) {
    if (!Array.isArray(patch.projectActions)) throw new Error('projectActions must be an array');
    next.projectActions = sanitizeProjectActions(patch.projectActions);
  }
  if ('draftStarters' in patch) {
    if (!Array.isArray(patch.draftStarters)) throw new Error('draftStarters must be an array');
    next.draftStarters = sanitizeDraftStarters(patch.draftStarters);
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

export const resolvePlansDirRelative = (read: SharedProjectConfigRead): string => {
  if (read.status === 'ok' && read.config.plansDir) return read.config.plansDir;
  return DEFAULT_PLANS_DIR;
};

const bytesToHex = (bytes: ArrayBuffer): string => (
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
);

/** Sync-friendly hex digest for environments without SubtleCrypto (tests). */
const fallbackSha256Hex = (text: string): string => {
  // FNV-1a 64-bit folded into hex — only used when SubtleCrypto is unavailable.
  // Production Electron/browser uses SubtleCrypto below via sharedTrustHashOfAsync.
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < text.length; i += 1) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
};

/**
 * Hash of shared executable commands. Prefer SubtleCrypto SHA-256; fall back
 * only in unit-test runtimes without Web Crypto.
 */
export const sharedTrustHashOf = (shared: SharedProjectConfig): string | null => {
  const commands = shared.setupWorktree;
  const actions = shared.projectActions
    .map((action) => {
      const executable: Record<string, string> = { id: action.id, command: action.command };
      if (action.runIn) executable.runIn = action.runIn;
      return executable;
    })
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  if (commands.length === 0 && actions.length === 0) return null;
  const payload = JSON.stringify({ setupWorktree: commands, projectActions: actions });
  // Note: async SHA-256 is applied in getProjectSetup when SubtleCrypto exists;
  // this sync helper remains deterministic for merge/tests.
  return `sha256:${fallbackSha256Hex(payload)}`;
};

export const sharedTrustHashOfAsync = async (shared: SharedProjectConfig): Promise<string | null> => {
  const commands = shared.setupWorktree;
  const actions = shared.projectActions
    .map((action) => {
      const executable: Record<string, string> = { id: action.id, command: action.command };
      if (action.runIn) executable.runIn = action.runIn;
      return executable;
    })
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  if (commands.length === 0 && actions.length === 0) return null;
  const payload = JSON.stringify({ setupWorktree: commands, projectActions: actions });
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
    return `sha256:${bytesToHex(digest)}`;
  }
  return `sha256:${fallbackSha256Hex(payload)}`;
};

const withSource = <T extends object>(entries: T[], source: ProjectSetupSource): Array<T & { source: ProjectSetupSource }> => (
  entries.map((entry) => ({ ...entry, source }))
);

export const mergeProjectSetup = (
  personal: PersonalProjectSetup,
  sharedRead: SharedProjectConfigRead,
  trustHash: string | null,
): ProjectSetup => {
  const shared = sharedRead.status === 'ok' ? sharedRead.config : EMPTY_SHARED;
  const hidden = new Set(personal.hiddenSharedActionIds);
  const personalIds = new Set(personal.projectActions.map((action) => action.id));
  const sharedActions = shared.projectActions.filter((action) => !hidden.has(action.id) && !personalIds.has(action.id));
  const starterKeys = new Set(shared.draftStarters.map((starter) => `${starter.type}:${starter.name}`));
  const personalStarters = personal.draftStarters.filter((starter) => !starterKeys.has(`${starter.type}:${starter.name}`));
  const sharedBlock = {
    status: sharedRead.status,
    path: SHARED_CONFIG_RELATIVE_PATH,
    ...(sharedRead.status === 'invalid' ? { reason: sharedRead.reason } : {}),
    ...shared,
  };
  return {
    trust: { hash: trustHash, trusted: trustHash === null || personal.sharedTrust?.hash === trustHash },
    setupWorktree: personal.setupWorktreeMode === 'replace'
      ? personal.setupWorktree
      : [...shared.setupWorktree, ...personal.setupWorktree],
    setupWorktreeWait: personal.setupWorktreeWait !== null
      ? personal.setupWorktreeWait
      : shared.setupWorktreeWait === true,
    projectActions: [...withSource(sharedActions, 'shared'), ...withSource(personal.projectActions, 'personal')],
    projectActionsPrimaryId: personal.projectActionsPrimaryId,
    draftStarters: [...withSource(shared.draftStarters, 'shared'), ...withSource(personalStarters, 'personal')],
    shared: sharedBlock,
    personal,
  };
};
