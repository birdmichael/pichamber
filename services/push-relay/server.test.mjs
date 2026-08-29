import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import {
  canonicalPublicJwkString,
  createJsonStore,
  createPushRelayHandler,
  deriveServerId,
  signApnsJwt,
  verifyRelaySignature,
} from './server.mjs';

const tmpDirs = [];
const tmpDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pichamber-push-'));
  tmpDirs.push(dir);
  return dir;
};
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const makeKey = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    privateKey,
    publicJwk: publicKey.export({ format: 'jwk' }),
  };
};

const sign = (privateKey, message) =>
  crypto.sign('SHA256', Buffer.from(message), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');

const listen = (handler) =>
  new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });

test('canonical JWK hash is stable regardless of key order', () => {
  const jwk = { kty: 'EC', crv: 'P-256', x: 'aa', y: 'bb' };
  assert.equal(canonicalPublicJwkString(jwk), canonicalPublicJwkString({ y: 'bb', x: 'aa', crv: 'P-256', kty: 'EC' }));
  assert.equal(deriveServerId(jwk), deriveServerId({ kty: 'EC', crv: 'P-256', x: 'aa', y: 'bb' }));
});

test('verifyRelaySignature accepts ieee-p1363 signatures', () => {
  const { privateKey, publicJwk } = makeKey();
  const sig = sign(privateKey, 'hello');
  assert.equal(verifyRelaySignature(publicJwk, 'hello', sig), true);
  assert.equal(verifyRelaySignature(publicJwk, 'nope', sig), false);
});

test('signApnsJwt produces three ES256 segments', () => {
  const { privateKey } = makeKey();
  const p8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const jwt = signApnsJwt({ keyId: 'KEYID', teamId: 'TEAMID', p8 });
  assert.equal(jwt.split('.').length, 3);
});

test('register binds on first use and send only delivers bound tokens', async () => {
  const store = createJsonStore(path.join(tmpDir(), 'tokens.json'));
  const sent = [];
  const handler = createPushRelayHandler({
    store,
    now: () => 1_000_000,
    sendApns: async (req) => {
      sent.push(req);
      return req.tokens.map((token) => ({ token, ok: true, drop: false }));
    },
  });
  const { url, close } = await listen(handler);
  try {
    const a = makeKey();
    const b = makeKey();
    const token = 'tokenA';
    const ts = 1_000_000;
    const register = await fetch(`${url}/v1/push/register-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token,
        platform: 'ios',
        publicKeyJwk: { kty: a.publicJwk.kty, crv: a.publicJwk.crv, x: a.publicJwk.x, y: a.publicJwk.y },
        ts,
        sig: sign(a.privateKey, `${ts}.${token}.ios`),
      }),
    });
    assert.equal(register.status, 200);

    const steal = await fetch(`${url}/v1/push/register-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token,
        platform: 'ios',
        publicKeyJwk: { kty: b.publicJwk.kty, crv: b.publicJwk.crv, x: b.publicJwk.x, y: b.publicJwk.y },
        ts,
        sig: sign(b.privateKey, `${ts}.${token}.ios`),
      }),
    });
    assert.equal(steal.status, 200);
    assert.equal(store.get(token).serverId, deriveServerId(a.publicJwk));

    const send = await fetch(`${url}/v1/push/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tokens: [token, 'unknown'],
        title: 'Agent needs your input',
        body: 'session',
        env: 'production',
        publicKeyJwk: { kty: a.publicJwk.kty, crv: a.publicJwk.crv, x: a.publicJwk.x, y: a.publicJwk.y },
        ts,
        sig: sign(a.privateKey, `${ts}.${['unknown', token].sort().join(',')}.Agent needs your input`),
      }),
    });
    assert.equal(send.status, 200);
    const data = await send.json();
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].tokens, [token]);
    const byToken = Object.fromEntries(data.results.map((r) => [r.token, r]));
    assert.equal(byToken[token].ok, true);
    assert.equal(byToken.unknown.reason, 'unbound');
    assert.equal(byToken.unknown.drop, false);
  } finally {
    await close();
  }
});

test('rejects stale timestamps and bad signatures', async () => {
  const store = createJsonStore(path.join(tmpDir(), 'tokens.json'));
  const handler = createPushRelayHandler({
    store,
    now: () => 1_000_000,
    sendApns: async () => [],
  });
  const { url, close } = await listen(handler);
  try {
    const { privateKey, publicJwk } = makeKey();
    const stale = await fetch(`${url}/v1/push/register-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: 't',
        platform: 'ios',
        publicKeyJwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y },
        ts: 1,
        sig: sign(privateKey, '1.t.ios'),
      }),
    });
    assert.equal(stale.status, 400);

    const bad = await fetch(`${url}/v1/push/register-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: 't',
        platform: 'ios',
        publicKeyJwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y },
        ts: 1_000_000,
        sig: 'not-a-sig',
      }),
    });
    assert.equal(bad.status, 401);
  } finally {
    await close();
  }
});

test('drops dead APNs tokens from the store', async () => {
  const store = createJsonStore(path.join(tmpDir(), 'tokens.json'));
  const { privateKey, publicJwk } = makeKey();
  const handler = createPushRelayHandler({
    store,
    now: () => 1_000_000,
    sendApns: async ({ tokens }) => tokens.map((token) => ({ token, ok: false, drop: true, reason: 'Unregistered' })),
  });
  const { url, close } = await listen(handler);
  try {
    const token = 'dead';
    const ts = 1_000_000;
    await fetch(`${url}/v1/push/register-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token,
        platform: 'ios',
        publicKeyJwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y },
        ts,
        sig: sign(privateKey, `${ts}.${token}.ios`),
      }),
    });
    const send = await fetch(`${url}/v1/push/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tokens: [token],
        title: 't',
        publicKeyJwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y },
        ts,
        sig: sign(privateKey, `${ts}.${token}.t`),
      }),
    });
    const data = await send.json();
    assert.equal(data.results[0].drop, true);
    assert.equal(store.get(token), null);
  } finally {
    await close();
  }
});
