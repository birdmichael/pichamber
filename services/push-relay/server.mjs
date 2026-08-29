#!/usr/bin/env node
// Pichamber APNs push relay. Protocol matches packages/web/server/lib/notifications
// (register-token + send). The Apple .p8 stays on this host; Desktop clients only sign.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import http2 from 'node:http2';
import path from 'node:path';

const TS_WINDOW_MS = 5 * 60 * 1000;
const MAX_TOKENS = 100;
const JWT_TTL_MS = 50 * 60 * 1000;
const APNS_HOST_PRODUCTION = 'https://api.push.apple.com';
const APNS_HOST_SANDBOX = 'https://api.sandbox.push.apple.com';
const DEAD_TOKEN_REASONS = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic']);

const trimmedEnv = (name) => {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
};

const normalizePem = (value) => (typeof value === 'string' ? value.replace(/\\n/g, '\n').trim() : '');

export const canonicalPublicJwkString = (jwk) =>
  JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });

export const deriveServerId = (publicJwk) =>
  crypto.createHash('sha256').update(canonicalPublicJwkString(publicJwk)).digest('base64url');

export const verifyRelaySignature = (publicJwk, message, sigB64Url) => {
  if (!publicJwk || typeof sigB64Url !== 'string' || typeof message !== 'string') return false;
  try {
    const key = crypto.createPublicKey({ key: publicJwk, format: 'jwk' });
    return crypto.verify(
      'SHA256',
      Buffer.from(message),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(sigB64Url, 'base64url'),
    );
  } catch {
    return false;
  }
};

export const createJsonStore = (filePath) => {
  const empty = () => ({ tokens: {} });
  const read = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || typeof parsed.tokens !== 'object' || parsed.tokens == null) {
        return empty();
      }
      return { tokens: parsed.tokens };
    } catch (error) {
      if (error && error.code === 'ENOENT') return empty();
      throw error;
    }
  };
  const write = (data) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  };
  return {
    get(token) {
      return read().tokens[token] || null;
    },
    bindFirst(token, record) {
      const data = read();
      const existing = data.tokens[token];
      if (existing && existing.serverId !== record.serverId) {
        return { bound: false, existing };
      }
      data.tokens[token] = {
        ...existing,
        ...record,
        createdAt: existing?.createdAt ?? record.createdAt,
      };
      write(data);
      return { bound: true, existing: existing || null };
    },
    unbind(token) {
      const data = read();
      if (!data.tokens[token]) return false;
      delete data.tokens[token];
      write(data);
      return true;
    },
  };
};

export const signApnsJwt = ({ keyId, teamId, p8 }) => {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  const signingInput = `${header}.${claims}`;
  const signature = crypto
    .sign('sha256', Buffer.from(signingInput), { key: p8, dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
  return `${signingInput}.${signature}`;
};

const createJwtCache = (config) => {
  let cached = null;
  return () => {
    const now = Date.now();
    if (cached && now - cached.issuedAtMs < JWT_TTL_MS) return cached.token;
    const token = signApnsJwt(config);
    cached = { token, issuedAtMs: now };
    return token;
  };
};

const buildApnsBody = (payload) => {
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  return JSON.stringify({
    aps: {
      alert: {
        title: typeof payload.title === 'string' ? payload.title : undefined,
        body: typeof payload.body === 'string' ? payload.body : undefined,
      },
      badge: Number.isFinite(payload.badge) && payload.badge >= 0 ? Math.trunc(payload.badge) : undefined,
      sound: 'default',
      'thread-id': typeof payload.collapseId === 'string' ? payload.collapseId : undefined,
      'mutable-content': 1,
      ...(typeof payload.category === 'string' && payload.category ? { category: payload.category } : {}),
    },
    ...data,
  });
};

export const sendOneApns = (client, deviceToken, body, jwt, { bundleId, collapseId }) =>
  new Promise((resolve) => {
    const headers = {
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
    };
    if (typeof collapseId === 'string' && collapseId.length > 0) {
      headers['apns-collapse-id'] = collapseId.slice(0, 64);
    }
    let req;
    try {
      req = client.request(headers);
    } catch (error) {
      resolve({ token: deviceToken, ok: false, drop: false, reason: error?.message || 'request_open_failed' });
      return;
    }
    let status = 0;
    let responseBody = '';
    req.on('response', (resHeaders) => {
      status = Number(resHeaders[':status']) || 0;
    });
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      responseBody += chunk;
    });
    req.on('end', () => {
      if (status === 200) {
        resolve({ token: deviceToken, ok: true, drop: false });
        return;
      }
      let reason = '';
      try {
        reason = JSON.parse(responseBody)?.reason || '';
      } catch {
        // non-JSON
      }
      const drop = status === 410 || DEAD_TOKEN_REASONS.has(reason);
      resolve({ token: deviceToken, ok: false, drop, status, reason: reason || 'unknown' });
    });
    req.on('error', (error) => {
      resolve({ token: deviceToken, ok: false, drop: false, reason: error?.message || 'request_error' });
    });
    req.end(body);
  });

export const createDefaultApnsSender = (config) => {
  const getJwt = createJwtCache(config);
  return async ({ tokens, payload, environment }) => {
    const host = environment === 'sandbox' ? APNS_HOST_SANDBOX : APNS_HOST_PRODUCTION;
    const jwt = getJwt();
    const body = buildApnsBody(payload);
    const client = http2.connect(host);
    try {
      const results = [];
      for (const token of tokens) {
        results.push(await sendOneApns(client, token, body, jwt, {
          bundleId: config.bundleId,
          collapseId: payload.collapseId,
        }));
      }
      return results;
    } finally {
      client.close();
    }
  };
};

const readJson = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });

const writeJson = (res, status, data) => {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
};

const isFreshTs = (ts, now) => typeof ts === 'number' && Number.isFinite(ts) && Math.abs(now() - ts) <= TS_WINDOW_MS;

const asPublicJwk = (value) => {
  if (!value || typeof value !== 'object') return null;
  if (value.kty !== 'EC' || value.crv !== 'P-256' || typeof value.x !== 'string' || typeof value.y !== 'string') {
    return null;
  }
  return { kty: value.kty, crv: value.crv, x: value.x, y: value.y };
};

export const createPushRelayHandler = ({ store, sendApns, now = Date.now, log = console } = {}) => {
  const handleRegister = async (body) => {
    const publicKeyJwk = asPublicJwk(body?.publicKeyJwk);
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    const platform = body?.platform === 'android' ? 'android' : 'ios';
    const ts = body?.ts;
    const sig = body?.sig;
    if (!publicKeyJwk || !token || !isFreshTs(ts, now) || typeof sig !== 'string') {
      return { status: 400, data: { error: 'invalid_request' } };
    }
    if (!verifyRelaySignature(publicKeyJwk, `${ts}.${token}.${platform}`, sig)) {
      return { status: 401, data: { error: 'invalid_signature' } };
    }
    const serverId = deriveServerId(publicKeyJwk);
    store.bindFirst(token, { serverId, platform, createdAt: now(), lastSeenAt: now() });
    return { status: 200, data: { ok: true } };
  };

  const handleSend = async (body) => {
    const publicKeyJwk = asPublicJwk(body?.publicKeyJwk);
    const title = typeof body?.title === 'string' ? body.title : '';
    const tokens = Array.isArray(body?.tokens) ? body.tokens.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()) : [];
    const ts = body?.ts;
    const sig = body?.sig;
    if (!publicKeyJwk || !title || tokens.length === 0 || tokens.length > MAX_TOKENS || !isFreshTs(ts, now) || typeof sig !== 'string') {
      return { status: 400, data: { error: 'invalid_request' } };
    }
    const unique = [...new Set(tokens)];
    const message = `${ts}.${[...unique].sort().join(',')}.${title}`;
    if (!verifyRelaySignature(publicKeyJwk, message, sig)) {
      return { status: 401, data: { error: 'invalid_signature' } };
    }
    const serverId = deriveServerId(publicKeyJwk);
    const environment = body?.env === 'sandbox' ? 'sandbox' : 'production';
    const bound = [];
    const results = [];
    for (const token of unique) {
      const record = store.get(token);
      if (!record || record.serverId !== serverId) {
        results.push({ token, ok: false, drop: false, reason: 'unbound' });
        continue;
      }
      if (record.platform === 'android') {
        results.push({ token, ok: false, drop: false, reason: 'unsupported_platform' });
        continue;
      }
      bound.push(token);
    }
    if (bound.length > 0) {
      const sent = await sendApns({
        tokens: bound,
        environment,
        payload: {
          title,
          body: typeof body.body === 'string' ? body.body : '',
          badge: body.badge,
          collapseId: typeof body.collapseId === 'string' ? body.collapseId : undefined,
          category: typeof body.category === 'string' ? body.category : undefined,
          data: body.data && typeof body.data === 'object' ? body.data : undefined,
        },
      });
      for (const result of sent) {
        if (result.drop === true) store.unbind(result.token);
        results.push(result);
      }
    }
    log.info?.(`[push-relay] send n=${unique.length} bound=${bound.length} env=${environment}`);
    return { status: 200, data: { ok: true, results } };
  };

  return async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/health' || url.pathname === '/')) {
      writeJson(res, 200, { ok: true, name: 'pichamber-push' });
      return;
    }
    if (req.method !== 'POST') {
      writeJson(res, 405, { error: 'method_not_allowed' });
      return;
    }
    let body;
    try {
      body = await readJson(req);
    } catch {
      writeJson(res, 400, { error: 'invalid_json' });
      return;
    }
    try {
      if (url.pathname === '/v1/push/register-token') {
        const result = await handleRegister(body);
        writeJson(res, result.status, result.data);
        return;
      }
      if (url.pathname === '/v1/push/send') {
        const result = await handleSend(body);
        writeJson(res, result.status, result.data);
        return;
      }
      writeJson(res, 404, { error: 'not_found' });
    } catch (error) {
      log.warn?.('[push-relay] handler failed:', error?.message ?? error);
      writeJson(res, 500, { error: 'internal' });
    }
  };
};

export const loadApnsConfigFromEnv = () => {
  const keyId = trimmedEnv('APNS_KEY_ID');
  const teamId = trimmedEnv('APNS_TEAM_ID');
  const bundleId = trimmedEnv('APNS_BUNDLE_ID') || 'com.pichamber.app';
  let p8 = normalizePem(process.env.APNS_P8 || '');
  const p8Path = trimmedEnv('APNS_P8_PATH');
  if (!p8 && p8Path) p8 = normalizePem(fs.readFileSync(p8Path, 'utf8'));
  if (!keyId || !teamId || !p8) return null;
  return { keyId, teamId, bundleId, p8 };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  const config = loadApnsConfigFromEnv();
  if (!config) {
    console.error('[push-relay] missing APNS_KEY_ID / APNS_TEAM_ID / APNS_P8(_PATH)');
    process.exit(1);
  }
  const dataDir = trimmedEnv('DATA_DIR') || '/data';
  const store = createJsonStore(path.join(dataDir, 'push-tokens.json'));
  const sendApns = createDefaultApnsSender(config);
  const handler = createPushRelayHandler({ store, sendApns, log: console });
  const port = Number.parseInt(trimmedEnv('PORT') || '8080', 10);
  const server = http.createServer(handler);
  server.listen(port, '0.0.0.0', () => {
    console.info(`[push-relay] listening on ${port} topic=${config.bundleId}`);
  });
}
