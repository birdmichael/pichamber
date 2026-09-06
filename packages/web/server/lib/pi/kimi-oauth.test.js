import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createPiKimiOAuthController, refreshPiKimiOAuth } from './kimi-oauth.js';
import { writeKimiRegion } from './pi-resources.js';

const deviceLogin = ({ notify, signal }) => {
  notify({
    type: 'device_code',
    userCode: 'ABCD-1234',
    verificationUri: 'https://auth.kimi.com/device',
  });
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error('Login cancelled'));
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve({
        type: 'oauth',
        access: 'access-secret',
        refresh: 'refresh-secret',
        expires: Date.now() + 3600_000,
      });
    }, 5);
  });
};

describe('createPiKimiOAuthController', () => {
  it('returns device-code authorize then oauth credentials without leaking secrets in the authorize payload', async () => {
    const oauth = createPiKimiOAuthController({
      loadKimiOAuth: async () => ({ login: deviceLogin }),
    });
    const authorization = await oauth.authorize('kimi-coding');
    expect(authorization).toEqual({
      method: 'auto',
      url: 'https://auth.kimi.com/device',
      userCode: 'ABCD-1234',
    });
    expect(JSON.stringify(authorization)).not.toContain('access-secret');
    const credential = await oauth.complete('kimi-coding');
    expect(credential.type).toBe('oauth');
    expect(credential.access).toBe('access-secret');
    expect(credential.refresh).toBe('refresh-secret');
  });

  it('rejects a second complete without authorize', async () => {
    const oauth = createPiKimiOAuthController({
      loadKimiOAuth: async () => ({ login: deviceLogin }),
    });
    await expect(oauth.complete('kimi-coding')).rejects.toThrow(/No pending/);
  });

  it('accepts kimi-coding-2 family ids', async () => {
    const oauth = createPiKimiOAuthController({
      loadKimiOAuth: async () => ({ login: deviceLogin }),
    });
    const authorization = await oauth.authorize('kimi-coding-2');
    expect(authorization.url).toBe('https://auth.kimi.com/device');
    const credential = await oauth.complete('kimi-coding-2');
    expect(credential.access).toBe('access-secret');
  });

  it('does not start international OAuth for a domestic Kimi row', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-oauth-domestic-'));
    try {
      writeKimiRegion(home, 'domestic', { providerId: 'kimi-coding' });
      let loaded = false;
      const oauth = createPiKimiOAuthController({
        loadKimiOAuth: async () => {
          loaded = true;
          return { login: deviceLogin };
        },
      });
      await expect(oauth.authorize('kimi-coding', { home })).rejects.toThrow(/Moonshot China API key/);
      expect(loaded).toBe(false);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('rejects non-kimi-coding providers', async () => {
    const oauth = createPiKimiOAuthController({
      loadKimiOAuth: async () => ({ login: deviceLogin }),
    });
    await expect(oauth.authorize('openai')).rejects.toThrow(/not supported/);
  });

  it('loads the bundled Pi Kimi Code helper when the package subpath is unpublished', async () => {
    await expect(refreshPiKimiOAuth({ refresh: '' })).rejects.toThrow(/refresh token is missing/);
  });

  it('times out authorize when device_code never arrives', async () => {
    const oauth = createPiKimiOAuthController({
      authorizeNotifyTimeoutMs: 20,
      loadKimiOAuth: async () => ({
        login: ({ signal }) => new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('Login cancelled')), { once: true });
        }),
      }),
    });
    await expect(oauth.authorize('kimi-coding')).rejects.toThrow(/did not start/);
  });
});
