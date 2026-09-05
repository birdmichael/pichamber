import { describe, expect, it } from 'vitest';

import { createPiXaiOAuthController, refreshPiXaiOAuth } from './xai-oauth.js';

const deviceLogin = ({ notify, signal }) => {
  notify({
    type: 'device_code',
    userCode: 'ABCD-1234',
    verificationUri: 'https://auth.x.ai/device',
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

describe('createPiXaiOAuthController', () => {
  it('returns device-code authorize then oauth credentials without leaking secrets in the authorize payload', async () => {
    const oauth = createPiXaiOAuthController({
      loadXaiOAuth: async () => ({ login: deviceLogin }),
    });
    const authorization = await oauth.authorize('xai');
    expect(authorization).toEqual({
      method: 'auto',
      url: 'https://auth.x.ai/device',
      userCode: 'ABCD-1234',
    });
    expect(JSON.stringify(authorization)).not.toContain('access-secret');
    const credential = await oauth.complete('xai');
    expect(credential.type).toBe('oauth');
    expect(credential.access).toBe('access-secret');
    expect(credential.refresh).toBe('refresh-secret');
  });

  it('rejects a second complete without authorize', async () => {
    const oauth = createPiXaiOAuthController({
      loadXaiOAuth: async () => ({ login: deviceLogin }),
    });
    await expect(oauth.complete('xai')).rejects.toThrow(/No pending/);
  });

  it('rejects non-xai providers', async () => {
    const oauth = createPiXaiOAuthController({
      loadXaiOAuth: async () => ({ login: deviceLogin }),
    });
    await expect(oauth.authorize('openai')).rejects.toThrow(/not supported/);
  });

  it('authorizes a second Grok subscription id', async () => {
    const oauth = createPiXaiOAuthController({
      loadXaiOAuth: async () => ({ login: deviceLogin }),
    });
    const authorization = await oauth.authorize('xai-2');
    expect(authorization.userCode).toBe('ABCD-1234');
    const credential = await oauth.complete('xai-2');
    expect(credential.access).toBe('access-secret');
    await expect(oauth.complete('xai')).rejects.toThrow(/No pending|not supported/);
  });

  it('loads the bundled Pi xAI helper when the package subpath is unpublished', async () => {
    await expect(refreshPiXaiOAuth({ refresh: '' })).rejects.toThrow(/refresh token is missing/);
  });

  it('times out authorize when device_code never arrives', async () => {
    const oauth = createPiXaiOAuthController({
      authorizeNotifyTimeoutMs: 20,
      loadXaiOAuth: async () => ({
        login: ({ signal }) => new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('Login cancelled')), { once: true });
        }),
      }),
    });
    await expect(oauth.authorize('xai')).rejects.toThrow(/did not start/);
  });
});
