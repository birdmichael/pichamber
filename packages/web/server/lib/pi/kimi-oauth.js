import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isKimiSubscriptionId } from './pi-resources.js';

const AUTHORIZE_NOTIFY_TIMEOUT_MS = 15_000;
const KIMI_OAUTH_RELATIVE = path.join('dist', 'auth', 'oauth', 'kimi-coding.js');

const toFilesystemPath = (value) => {
  const text = String(value || '');
  if (text.startsWith('file:')) return fileURLToPath(text);
  return text;
};

const findNamedPackageDir = (start, name) => {
  let current = path.dirname(toFilesystemPath(start));
  while (current && current !== path.dirname(current)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(current, 'package.json'), 'utf8'));
      if (parsed?.name === name) return current;
    } catch {
      // Keep walking; a stray file is not the SDK root.
    }
    current = path.dirname(current);
  }
  return '';
};

const resolveBundledKimiOAuthHref = () => {
  const sdkHref = import.meta.resolve('@earendil-works/pi-coding-agent');
  const sdkDir = findNamedPackageDir(sdkHref, '@earendil-works/pi-coding-agent');
  const candidates = [
    path.join(sdkDir, '..', 'pi-ai', KIMI_OAUTH_RELATIVE),
    path.join(sdkDir, 'node_modules', '@earendil-works', 'pi-ai', KIMI_OAUTH_RELATIVE),
  ];
  for (const file of candidates) {
    if (sdkDir && fs.existsSync(file)) return pathToFileURL(file).href;
  }
  throw new Error('Bundled Pi Kimi Code OAuth helper was not found next to the Pi SDK');
};

const defaultLoadKimiOAuth = async () => {
  try {
    const direct = await import('@earendil-works/pi-ai/dist/auth/oauth/kimi-coding.js');
    if (direct?.kimiCodingOAuth) return direct.kimiCodingOAuth;
  } catch {
    // pi-ai does not export that subpath; load the bundled file next to the SDK.
  }
  const bundled = await import(resolveBundledKimiOAuthHref());
  return bundled.kimiCodingOAuth;
};

const unsupportedProvider = (providerId) => {
  const error = new Error(`OAuth is not supported for provider ${providerId}`);
  error.status = 404;
  return error;
};

const noPendingError = () => {
  const error = new Error('No pending Kimi Code authorization');
  error.status = 400;
  return error;
};

/**
 * Wraps Pi's built-in Kimi Code device-code login. Settings holds callback until
 * the poll finishes; a new authorize aborts the previous attempt.
 */
export const createPiKimiOAuthController = ({
  loadKimiOAuth = defaultLoadKimiOAuth,
  authorizeNotifyTimeoutMs = AUTHORIZE_NOTIFY_TIMEOUT_MS,
} = {}) => {
  let pending = null;

  const abortPending = () => {
    if (!pending) return;
    pending.abort.abort();
    pending = null;
  };

  const authorize = async (providerId) => {
    if (!isKimiSubscriptionId(providerId)) {
      throw unsupportedProvider(providerId);
    }
    abortPending();
    const kimiCodingOAuth = await loadKimiOAuth();
    if (!kimiCodingOAuth || typeof kimiCodingOAuth.login !== 'function') {
      const error = new Error('Pi Kimi Code OAuth helper is unavailable');
      error.status = 503;
      throw error;
    }
    const abort = new AbortController();
    let settleNotify;
    const notifyReady = new Promise((resolve, reject) => {
      settleNotify = { resolve, reject };
    });
    const loginPromise = Promise.resolve().then(() => kimiCodingOAuth.login({
      notify: (event) => {
        if (event?.type === 'device_code') {
          settleNotify.resolve({
            url: event.verificationUri,
            userCode: event.userCode,
          });
        }
      },
      signal: abort.signal,
    }));
    loginPromise.catch((error) => {
      settleNotify.reject(error);
    });
    pending = { abort, loginPromise, providerId };

    const timeoutMs = Number.isFinite(authorizeNotifyTimeoutMs) && authorizeNotifyTimeoutMs > 0
      ? authorizeNotifyTimeoutMs
      : AUTHORIZE_NOTIFY_TIMEOUT_MS;
    let timeoutId;
    const timedNotify = new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => {
        const error = new Error('Kimi Code authorization did not start');
        error.status = 504;
        reject(error);
      }, timeoutMs);
      notifyReady.then(resolve, reject).finally(() => clearTimeout(timeoutId));
    });

    try {
      const device = await timedNotify;
      return {
        method: 'auto',
        url: device.url,
        userCode: device.userCode,
      };
    } catch (error) {
      if (pending?.loginPromise === loginPromise) {
        abort.abort();
        pending = null;
      }
      throw error;
    }
  };

  const complete = async (providerId) => {
    if (!isKimiSubscriptionId(providerId)) {
      throw unsupportedProvider(providerId);
    }
    if (!pending) throw noPendingError();
    if (pending.providerId && pending.providerId !== providerId) {
      throw unsupportedProvider(providerId);
    }
    const current = pending;
    try {
      const credential = await current.loginPromise;
      return credential;
    } finally {
      if (pending === current) pending = null;
    }
  };

  return {
    authorize,
    complete,
    abort: abortPending,
  };
};

const shared = createPiKimiOAuthController();

export const authorizePiKimiOAuth = (providerId) => shared.authorize(providerId);
export const completePiKimiOAuth = (providerId) => shared.complete(providerId);

/** Refresh via Pi's helper. Do not copy leftover token-exchange code. */
export const refreshPiKimiOAuth = async (credential, {
  loadKimiOAuth = defaultLoadKimiOAuth,
  signal,
} = {}) => {
  const kimiCodingOAuth = await loadKimiOAuth();
  if (!kimiCodingOAuth || typeof kimiCodingOAuth.refresh !== 'function') {
    const error = new Error('Pi Kimi Code OAuth refresh helper is unavailable');
    error.status = 503;
    throw error;
  }
  const access = typeof credential?.access === 'string' ? credential.access : '';
  const refresh = typeof credential?.refresh === 'string' ? credential.refresh : '';
  const expires = Number(credential?.expires);
  if (!refresh) {
    const error = new Error('Kimi Code OAuth refresh token is missing');
    error.status = 401;
    throw error;
  }
  return kimiCodingOAuth.refresh({
    type: 'oauth',
    access,
    refresh,
    expires: Number.isFinite(expires) ? expires : 0,
  }, signal);
};
