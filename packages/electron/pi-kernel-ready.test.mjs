import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHealthUrl,
  isPiKernelHealthReady,
  resolveLocalBootStatus,
  waitForPiKernelReady,
} from './pi-kernel-ready.mjs';

const jsonResponse = (body) => ({
  json: async () => body,
});

test('buildHealthUrl appends /health', () => {
  assert.equal(buildHealthUrl('http://127.0.0.1:57123'), 'http://127.0.0.1:57123/health');
  assert.equal(buildHealthUrl('http://127.0.0.1:57123/'), 'http://127.0.0.1:57123/health');
  assert.equal(buildHealthUrl('not a url'), null);
});

test('isPiKernelHealthReady requires kernelReady or piRunning', () => {
  assert.equal(isPiKernelHealthReady({ kernelReady: true }), true);
  assert.equal(isPiKernelHealthReady({ piRunning: true }), true);
  assert.equal(isPiKernelHealthReady({
    kernel: 'pi',
    status: 'ok',
    kernelReady: false,
    piRunning: false,
    piNodeRuntime: { ok: false, code: 'PI_SDK_UNAVAILABLE' },
  }), false);
});

test('resolveLocalBootStatus requires both the HTTP server and kernel', () => {
  assert.equal(resolveLocalBootStatus({ localAvailable: true, localKernelReady: true }), 'ok');
  assert.equal(resolveLocalBootStatus({ localAvailable: true, localKernelReady: false }), 'unreachable');
  assert.equal(resolveLocalBootStatus({ localAvailable: false, localKernelReady: true }), 'unreachable');
});

test('waitForPiKernelReady returns true on the first ready snapshot', async () => {
  const ok = await waitForPiKernelReady('http://127.0.0.1:1', {
    fetchImpl: async () => jsonResponse({ kernelReady: true, piRunning: true }),
    sleep: async () => {
      throw new Error('should not sleep');
    },
  });
  assert.equal(ok, true);
});

test('waitForPiKernelReady keeps polling after piNodeRuntime.ok === false', async () => {
  let calls = 0;
  let nowMs = 0;
  const ok = await waitForPiKernelReady('http://127.0.0.1:1', {
    timeoutMs: 5000,
    initialPollMs: 10,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({
          kernelReady: false,
          piRunning: false,
          piNodeRuntime: { ok: false },
        });
      }
      return jsonResponse({ kernelReady: true, piRunning: true });
    },
    now: () => nowMs,
    sleep: async (ms) => {
      nowMs += ms;
    },
  });
  assert.equal(ok, true);
  assert.equal(calls, 2);
});

test('waitForPiKernelReady keeps polling after PI_SDK_UNAVAILABLE', async () => {
  let calls = 0;
  let nowMs = 0;
  const ok = await waitForPiKernelReady('http://127.0.0.1:1', {
    timeoutMs: 5000,
    initialPollMs: 10,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({
          kernelReady: false,
          piRunning: false,
          piNodeRuntime: { ok: true, code: 'PI_SDK_UNAVAILABLE' },
        });
      }
      return jsonResponse({ kernelReady: true });
    },
    now: () => nowMs,
    sleep: async (ms) => {
      nowMs += ms;
    },
  });
  assert.equal(ok, true);
  assert.equal(calls, 2);
});

test('waitForPiKernelReady times out when the kernel never becomes ready', async () => {
  let nowMs = 0;
  const ok = await waitForPiKernelReady('http://127.0.0.1:1', {
    timeoutMs: 40,
    initialPollMs: 10,
    maxPollMs: 10,
    fetchImpl: async () => jsonResponse({
      kernelReady: false,
      piRunning: false,
      piNodeRuntime: { ok: false, code: 'PI_NODE_UNAVAILABLE' },
    }),
    now: () => nowMs,
    sleep: async (ms) => {
      nowMs += ms;
    },
  });
  assert.equal(ok, false);
});

test('waitForPiKernelReady returns false for an invalid url', async () => {
  const ok = await waitForPiKernelReady('not a url', {
    fetchImpl: async () => {
      throw new Error('should not fetch');
    },
  });
  assert.equal(ok, false);
});
