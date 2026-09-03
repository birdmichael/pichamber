import fs from 'fs';
import path from 'path';
import { resolveAppDataDir } from '../app-data/index.js';

const DEFAULT_GITHUB_CLIENT_ID = 'Ov23lit4gCvEzB2YqOuU';
const LEGACY_OPENCHAMBER_GITHUB_CLIENT_ID = 'Ov23lizomPOC3eFYo56r';
const DEFAULT_GITHUB_SCOPES = 'repo read:org workflow read:user user:email';
export const GH_CLI_ACCOUNT_ID = 'gh-cli';

function getDataDir() {
  return resolveAppDataDir();
}

function getStorageFile() {
  return path.join(getDataDir(), 'github-auth.json');
}

function getSettingsFile() {
  return path.join(getDataDir(), 'settings.json');
}

function trimNonEmptyString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveConfiguredClientId(value) {
  const clientId = trimNonEmptyString(value);
  if (!clientId || clientId === LEGACY_OPENCHAMBER_GITHUB_CLIENT_ID) {
    return '';
  }
  return clientId;
}

function isCompatibleAuthEntry(entry, clientId) {
  const issuedFor = trimNonEmptyString(entry?.clientId);
  return Boolean(issuedFor) && issuedFor === clientId;
}

function ensureStorageDir() {
  const storageDir = getDataDir();
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }
}

function readJsonFile() {
  ensureStorageDir();
  const storageFile = getStorageFile();
  if (!fs.existsSync(storageFile)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(storageFile, 'utf8');
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch (error) {
    console.error('Failed to read GitHub auth file:', error);
    return null;
  }
}

function writeJsonFile(payload) {
  ensureStorageDir();
  const storageFile = getStorageFile();

  // Atomic write so multiple Pichamber instances can safely share the same file.
  const tmpFile = `${storageFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), 'utf8');
  try {
    fs.chmodSync(tmpFile, 0o600);
  } catch {
    // best-effort
  }

  fs.renameSync(tmpFile, storageFile);
  try {
    fs.chmodSync(storageFile, 0o600);
  } catch {
    // best-effort
  }
}

function resolveAccountId({ user, accessToken, accountId }) {
  if (typeof accountId === 'string' && accountId.trim()) {
    return accountId.trim();
  }
  if (user && typeof user.login === 'string' && user.login.trim()) {
    return user.login.trim();
  }
  if (user && typeof user.id === 'number') {
    return String(user.id);
  }
  if (typeof accessToken === 'string' && accessToken.trim()) {
    return `token:${accessToken.slice(0, 8)}`;
  }
  return '';
}

function normalizeAuthEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const accessToken = typeof entry.accessToken === 'string' ? entry.accessToken : '';
  if (!accessToken) return null;
  const user = entry.user && typeof entry.user === 'object'
    ? {
      login: typeof entry.user.login === 'string' ? entry.user.login : null,
      avatarUrl: typeof entry.user.avatarUrl === 'string' ? entry.user.avatarUrl : null,
      id: typeof entry.user.id === 'number' ? entry.user.id : null,
      name: typeof entry.user.name === 'string' ? entry.user.name : null,
      email: typeof entry.user.email === 'string' ? entry.user.email : null,
    }
    : null;

  const accountId = resolveAccountId({
    user,
    accessToken,
    accountId: typeof entry.accountId === 'string' ? entry.accountId : '',
  });

  return {
    accessToken,
    scope: typeof entry.scope === 'string' ? entry.scope : '',
    tokenType: typeof entry.tokenType === 'string' ? entry.tokenType : 'bearer',
    createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : null,
    user,
    current: Boolean(entry.current),
    accountId,
    clientId: trimNonEmptyString(entry.clientId) || null,
  };
}

function normalizeAuthList(raw) {
  const list = (Array.isArray(raw) ? raw : [raw])
    .map((entry) => normalizeAuthEntry(entry))
    .filter(Boolean);

  if (!list.length) {
    return { list: [], changed: false };
  }

  let changed = false;
  let currentFound = false;
  list.forEach((entry) => {
    if (entry.current && !currentFound) {
      currentFound = true;
    } else if (entry.current && currentFound) {
      entry.current = false;
      changed = true;
    }
  });

  if (!currentFound && list[0]) {
    list[0].current = true;
    changed = true;
  }

  list.forEach((entry) => {
    if (!entry.accountId) {
      entry.accountId = resolveAccountId(entry);
      changed = true;
    }
  });

  return { list, changed };
}

function readAuthList() {
  const data = readJsonFile();
  if (!data) {
    return [];
  }
  const { list, changed } = normalizeAuthList(data);
  if (changed) {
    writeJsonFile(list);
  }
  return list;
}

function writeAuthList(list) {
  writeJsonFile(list);
}

function readSettingsFile() {
  const settingsFile = getSettingsFile();
  try {
    if (fs.existsSync(settingsFile)) {
      return JSON.parse(fs.readFileSync(settingsFile, 'utf8')) || {};
    }
  } catch {
    // ignore
  }
  return {};
}

function writeSettingsFile(settings) {
  ensureStorageDir();
  const settingsFile = getSettingsFile();
  const tmpFile = `${settingsFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(settings, null, 2), 'utf8');
  try {
    fs.chmodSync(tmpFile, 0o600);
  } catch {
    // best-effort
  }
  fs.renameSync(tmpFile, settingsFile);
  try {
    fs.chmodSync(settingsFile, 0o600);
  } catch {
    // best-effort
  }
}

function listCompatibleAuth(list) {
  const clientId = getGitHubClientId();
  return list.filter((entry) => isCompatibleAuthEntry(entry, clientId));
}

export function getGitHubAuth() {
  const list = listCompatibleAuth(readAuthList());
  if (!list.length) {
    return null;
  }
  const current = list.find((entry) => entry.current) || list[0];
  if (!current?.accessToken) {
    return null;
  }
  return current;
}

export function getGitHubAuthAccounts() {
  return listCompatibleAuth(readAuthList())
    .filter((entry) => entry?.user && entry.accountId)
    .map((entry) => ({
      id: entry.accountId,
      user: entry.user,
      scope: entry.scope || '',
      current: Boolean(entry.current),
    }));
}

export function setGitHubAuth({ accessToken, scope, tokenType, user, accountId }) {
  if (!accessToken || typeof accessToken !== 'string') {
    throw new Error('accessToken is required');
  }
  const normalizedUser = user && typeof user === 'object'
    ? {
      login: typeof user.login === 'string' ? user.login : undefined,
      avatarUrl: typeof user.avatarUrl === 'string' ? user.avatarUrl : undefined,
      id: typeof user.id === 'number' ? user.id : undefined,
      name: typeof user.name === 'string' ? user.name : undefined,
      email: typeof user.email === 'string' ? user.email : undefined,
    }
    : undefined;

  const resolvedAccountId = resolveAccountId({
    user: normalizedUser,
    accessToken,
    accountId,
  });

  const list = readAuthList();
  const clientId = getGitHubClientId();
  const existingIndex = list.findIndex((entry) => (
    entry.accountId === resolvedAccountId && isCompatibleAuthEntry(entry, clientId)
  ));
  const nextEntry = {
    accessToken,
    scope: typeof scope === 'string' ? scope : '',
    tokenType: typeof tokenType === 'string' ? tokenType : 'bearer',
    createdAt: Date.now(),
    user: normalizedUser || null,
    current: true,
    accountId: resolvedAccountId,
    clientId,
  };

  if (existingIndex >= 0) {
    list[existingIndex] = nextEntry;
  } else {
    list.push(nextEntry);
  }

  list.forEach((entry, index) => {
    entry.current = index === (existingIndex >= 0 ? existingIndex : list.length - 1);
  });
  writeAuthList(list);
  return nextEntry;
}

export function activateGitHubAuth(accountId) {
  if (typeof accountId !== 'string' || !accountId.trim()) {
    return false;
  }
  const list = readAuthList();
  const clientId = getGitHubClientId();
  const index = list.findIndex((entry) => (
    entry.accountId === accountId.trim() && isCompatibleAuthEntry(entry, clientId)
  ));
  if (index === -1) {
    return false;
  }
  setGhCliActive(false);
  list.forEach((entry, idx) => {
    entry.current = idx === index;
  });
  writeAuthList(list);
  return true;
}

export function clearGitHubAuth() {
  try {
    const list = readAuthList();
    const compatible = listCompatibleAuth(list);
    if (!compatible.length) {
      return true;
    }
    const current = compatible.find((entry) => entry.current) || compatible[0];
    const remaining = list.filter((entry) => entry !== current);
    if (!remaining.length) {
      const storageFile = getStorageFile();
      if (fs.existsSync(storageFile)) {
        fs.unlinkSync(storageFile);
      }
      return true;
    }
    const remainingCompatible = listCompatibleAuth(remaining);
    remaining.forEach((entry) => {
      entry.current = remainingCompatible[0] ? entry === remainingCompatible[0] : false;
    });
    writeAuthList(remaining);
    return true;
  } catch (error) {
    console.error('Failed to clear GitHub auth file:', error);
    return false;
  }
}

export function getGitHubClientId() {
  const fromPreferredEnv = resolveConfiguredClientId(process.env.PICHAMBER_GITHUB_CLIENT_ID);
  if (fromPreferredEnv) return fromPreferredEnv;

  const fromDeprecatedEnv = resolveConfiguredClientId(process.env.OPENCHAMBER_GITHUB_CLIENT_ID);
  if (fromDeprecatedEnv) return fromDeprecatedEnv;

  const stored = resolveConfiguredClientId(readSettingsFile()?.githubClientId);
  if (stored) return stored;

  return DEFAULT_GITHUB_CLIENT_ID;
}

export function getGitHubScopes() {
  const raw = process.env.OPENCHAMBER_GITHUB_SCOPES;
  const fromEnv = typeof raw === 'string' ? raw.trim() : '';
  if (fromEnv) return fromEnv;

  const stored = trimNonEmptyString(readSettingsFile()?.githubScopes);
  if (stored) return stored;

  return DEFAULT_GITHUB_SCOPES;
}

export const GITHUB_AUTH_FILE = getStorageFile();

export function isGhCliDisabled() {
  return Boolean(readSettingsFile()?.ghCliDisabled);
}

export function setGhCliDisabled(disabled) {
  const settings = readSettingsFile();
  settings.ghCliDisabled = Boolean(disabled);
  if (settings.ghCliDisabled) {
    settings.ghCliActive = false;
  }
  writeSettingsFile(settings);
}

export function isGhCliActive() {
  const settings = readSettingsFile();
  return !settings?.ghCliDisabled && Boolean(settings?.ghCliActive);
}

export function setGhCliActive(active) {
  const settings = readSettingsFile();
  settings.ghCliActive = Boolean(active) && !settings.ghCliDisabled;
  writeSettingsFile(settings);
}
