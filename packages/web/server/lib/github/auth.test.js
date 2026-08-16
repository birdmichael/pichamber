import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const previousDataDir = process.env.OPENCHAMBER_DATA_DIR;
const previousPreferredClientId = process.env.PICHAMBER_GITHUB_CLIENT_ID;
const previousDeprecatedClientId = process.env.OPENCHAMBER_GITHUB_CLIENT_ID;
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pichamber-github-auth-'));
process.env.OPENCHAMBER_DATA_DIR = temporaryDirectory;
delete process.env.PICHAMBER_GITHUB_CLIENT_ID;
delete process.env.OPENCHAMBER_GITHUB_CLIENT_ID;

const {
  activateGitHubAuth,
  clearGitHubAuth,
  getGitHubAuth,
  getGitHubAuthAccounts,
  getGitHubClientId,
  setGitHubAuth,
} = await import('./auth.js');

const PICHAMBER_CLIENT_ID = 'Ov23lit4gCvEzB2YqOuU';
const OPENCHAMBER_CLIENT_ID = 'Ov23lizomPOC3eFYo56r';
const AUTH_FILE = path.join(temporaryDirectory, 'github-auth.json');
const SETTINGS_FILE = path.join(temporaryDirectory, 'settings.json');

function writeAuthFile(payload) {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(payload, null, 2), 'utf8');
}

function leftoverOpenChamberEntry(overrides = {}) {
  return {
    accessToken: 'gho_openchamber_leftover',
    scope: 'repo',
    tokenType: 'bearer',
    createdAt: 1,
    user: { login: 'octocat', id: 1, name: 'Octocat' },
    current: true,
    accountId: 'octocat',
    ...overrides,
  };
}

describe('GitHub OAuth client id', () => {
  afterEach(() => {
    delete process.env.PICHAMBER_GITHUB_CLIENT_ID;
    delete process.env.OPENCHAMBER_GITHUB_CLIENT_ID;
    if (fs.existsSync(SETTINGS_FILE)) {
      fs.unlinkSync(SETTINGS_FILE);
    }
    if (fs.existsSync(AUTH_FILE)) {
      fs.unlinkSync(AUTH_FILE);
    }
  });

  it('defaults to the Pichamber OAuth app, not OpenChamber', () => {
    expect(getGitHubClientId()).toBe(PICHAMBER_CLIENT_ID);
    expect(getGitHubClientId()).not.toBe(OPENCHAMBER_CLIENT_ID);
  });

  it('prefers PICHAMBER_GITHUB_CLIENT_ID over the deprecated OpenChamber alias', () => {
    process.env.OPENCHAMBER_GITHUB_CLIENT_ID = 'Ov23liDeprecatedAlias';
    process.env.PICHAMBER_GITHUB_CLIENT_ID = 'Ov23liPreferredOverride';
    expect(getGitHubClientId()).toBe('Ov23liPreferredOverride');
  });

  it('accepts OPENCHAMBER_GITHUB_CLIENT_ID as a deprecated self-host override', () => {
    process.env.OPENCHAMBER_GITHUB_CLIENT_ID = 'Ov23liSelfHostFromAlias';
    expect(getGitHubClientId()).toBe('Ov23liSelfHostFromAlias');
  });

  it('accepts settings.json githubClientId as a self-host override', () => {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ githubClientId: 'Ov23liFromSettings' }), 'utf8');
    expect(getGitHubClientId()).toBe('Ov23liFromSettings');
  });

  it('ignores the leftover OpenChamber client id in env and settings', () => {
    process.env.PICHAMBER_GITHUB_CLIENT_ID = OPENCHAMBER_CLIENT_ID;
    process.env.OPENCHAMBER_GITHUB_CLIENT_ID = OPENCHAMBER_CLIENT_ID;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ githubClientId: OPENCHAMBER_CLIENT_ID }), 'utf8');
    expect(getGitHubClientId()).toBe(PICHAMBER_CLIENT_ID);
  });
});

describe('GitHub auth leftover OpenChamber tokens', () => {
  afterEach(() => {
    delete process.env.PICHAMBER_GITHUB_CLIENT_ID;
    delete process.env.OPENCHAMBER_GITHUB_CLIENT_ID;
    if (fs.existsSync(AUTH_FILE)) {
      fs.unlinkSync(AUTH_FILE);
    }
  });

  it('does not treat an unstamped leftover token as a Pichamber login', () => {
    writeAuthFile([leftoverOpenChamberEntry()]);
    expect(getGitHubAuth()).toBeNull();
    expect(getGitHubAuthAccounts()).toEqual([]);
  });

  it('does not treat a token stamped for the OpenChamber app as a Pichamber login', () => {
    writeAuthFile([leftoverOpenChamberEntry({ clientId: OPENCHAMBER_CLIENT_ID })]);
    expect(getGitHubAuth()).toBeNull();
    expect(getGitHubAuthAccounts()).toEqual([]);
    expect(activateGitHubAuth('octocat')).toBe(false);
  });

  it('accepts a token issued to the current Pichamber client id', () => {
    const saved = setGitHubAuth({
      accessToken: 'gho_pichamber',
      scope: 'repo',
      user: { login: 'octocat', id: 1, name: 'Octocat' },
    });
    expect(saved.clientId).toBe(PICHAMBER_CLIENT_ID);
    expect(getGitHubAuth()?.accessToken).toBe('gho_pichamber');
    expect(getGitHubAuthAccounts()).toEqual([
      expect.objectContaining({ id: 'octocat', current: true }),
    ]);
  });

  it('keeps leftover OpenChamber tokens on disk when saving a Pichamber login', () => {
    writeAuthFile([leftoverOpenChamberEntry()]);
    setGitHubAuth({
      accessToken: 'gho_pichamber',
      scope: 'repo',
      user: { login: 'octocat', id: 1, name: 'Octocat' },
    });

    const stored = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    expect(stored).toEqual(expect.arrayContaining([
      expect.objectContaining({ accessToken: 'gho_openchamber_leftover' }),
      expect.objectContaining({ accessToken: 'gho_pichamber', clientId: PICHAMBER_CLIENT_ID }),
    ]));
    expect(getGitHubAuth()?.accessToken).toBe('gho_pichamber');
  });

  it('clears only the Pichamber login and leaves leftover OpenChamber tokens', () => {
    writeAuthFile([leftoverOpenChamberEntry()]);
    setGitHubAuth({
      accessToken: 'gho_pichamber',
      scope: 'repo',
      user: { login: 'octocat', id: 1, name: 'Octocat' },
    });
    expect(clearGitHubAuth()).toBe(true);
    expect(getGitHubAuth()).toBeNull();

    const stored = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    expect(stored).toEqual([
      expect.objectContaining({ accessToken: 'gho_openchamber_leftover' }),
    ]);
  });

  it('writes new tokens into the configured data dir, not a hardcoded OpenChamber home', () => {
    setGitHubAuth({
      accessToken: 'gho_pichamber',
      user: { login: 'octocat', id: 1 },
    });
    expect(fs.existsSync(AUTH_FILE)).toBe(true);
    expect(AUTH_FILE.startsWith(temporaryDirectory)).toBe(true);
  });
});

afterAll(() => {
  if (previousDataDir === undefined) delete process.env.OPENCHAMBER_DATA_DIR;
  else process.env.OPENCHAMBER_DATA_DIR = previousDataDir;
  if (previousPreferredClientId === undefined) delete process.env.PICHAMBER_GITHUB_CLIENT_ID;
  else process.env.PICHAMBER_GITHUB_CLIENT_ID = previousPreferredClientId;
  if (previousDeprecatedClientId === undefined) delete process.env.OPENCHAMBER_GITHUB_CLIENT_ID;
  else process.env.OPENCHAMBER_GITHUB_CLIENT_ID = previousDeprecatedClientId;
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});
