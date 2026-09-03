import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMiniChatPageUrl,
  isAllowedMiniChatNavigationUrl,
  resolveMiniChatUiBase,
} from './mini-chat-url.mjs';

test('electron-dev prefers the Vite UI origin over the API sidecar', () => {
  assert.equal(resolveMiniChatUiBase({
    packaged: false,
    packagedUrl: 'pichamber-ui://app/mini-chat.html',
    uiOrigin: 'http://127.0.0.1:4066',
    localOrigin: 'http://127.0.0.1:5337',
    sidecarUrl: 'http://127.0.0.1:5337',
    hmrUiOrigin: 'http://127.0.0.1:5173',
  }), 'http://127.0.0.1:4066');
});

test('electron-dev falls back to the HMR UI origin when uiOrigin is empty', () => {
  assert.equal(resolveMiniChatUiBase({
    packaged: false,
    uiOrigin: '',
    localOrigin: 'http://127.0.0.1:5337',
    sidecarUrl: 'http://127.0.0.1:5337',
    hmrUiOrigin: 'http://127.0.0.1:4066',
  }), 'http://127.0.0.1:4066');
});

test('unpackaged falls back to the API origin only when no UI origin is known', () => {
  assert.equal(resolveMiniChatUiBase({
    packaged: false,
    localOrigin: 'http://127.0.0.1:5337',
    sidecarUrl: 'http://127.0.0.1:3901',
  }), 'http://127.0.0.1:5337');
  assert.equal(resolveMiniChatUiBase({
    packaged: false,
    sidecarUrl: 'http://127.0.0.1:3901',
  }), 'http://127.0.0.1:3901');
});

test('packaged Mini Chat stays on the bundled UI URL', () => {
  assert.equal(resolveMiniChatUiBase({
    packaged: true,
    packagedUrl: 'pichamber-ui://app/mini-chat.html',
    uiOrigin: 'http://127.0.0.1:4066',
    localOrigin: 'http://127.0.0.1:5337',
    sidecarUrl: 'http://127.0.0.1:5337',
    hmrUiOrigin: 'http://127.0.0.1:5173',
  }), 'pichamber-ui://app/mini-chat.html');
});

test('builds Mini Chat against the UI origin, not the API sidecar', () => {
  const url = buildMiniChatPageUrl({
    base: 'http://127.0.0.1:4066',
    packaged: false,
    mode: 'draft',
  });
  assert.equal(url, 'http://127.0.0.1:4066/mini-chat.html?mode=draft');
  assert.match(url, /:4066\//);
  assert.doesNotMatch(url, /:5337/);
});

test('packaged Mini Chat URL keeps the custom-protocol page', () => {
  assert.equal(buildMiniChatPageUrl({
    base: 'pichamber-ui://app/mini-chat.html',
    packaged: true,
    mode: 'session',
    sessionId: 'ses_1',
    directory: '/tmp/proj',
  }), 'pichamber-ui://app/mini-chat.html?mode=session&sessionId=ses_1&directory=%2Ftmp%2Fproj');
});

test('throws when no Mini Chat UI base is available', () => {
  assert.throws(() => buildMiniChatPageUrl({ base: '', packaged: false, mode: 'draft' }), /Local UI is not available/);
});

test('allows Vite same-origin navigations after Mini Chat loads the UI', () => {
  const vite = 'http://127.0.0.1:4066/mini-chat.html?mode=draft';
  const api = 'http://127.0.0.1:5337';
  assert.equal(isAllowedMiniChatNavigationUrl({
    url: 'http://127.0.0.1:4066/mini-chat.html?mode=session',
    packaged: false,
    uiOrigin: 'http://127.0.0.1:4066',
    localOrigin: api,
    sidecarUrl: api,
    currentUrl: vite,
  }), true);
  assert.equal(isAllowedMiniChatNavigationUrl({
    url: 'http://127.0.0.1:4066/mini-chat.html?mode=session',
    packaged: false,
    localOrigin: api,
    sidecarUrl: api,
    currentUrl: vite,
  }), true);
  assert.equal(isAllowedMiniChatNavigationUrl({
    url: 'https://example.com/',
    packaged: false,
    uiOrigin: 'http://127.0.0.1:4066',
    localOrigin: api,
    currentUrl: vite,
  }), false);
});

test('packaged Mini Chat does not treat the API sidecar as in-window navigation', () => {
  assert.equal(isAllowedMiniChatNavigationUrl({
    url: 'pichamber-ui://app/mini-chat.html',
    packaged: true,
    packagedOrigin: 'pichamber-ui://app',
    localOrigin: 'http://127.0.0.1:5337',
    currentUrl: 'pichamber-ui://app/index.html',
  }), true);
  assert.equal(isAllowedMiniChatNavigationUrl({
    url: 'http://127.0.0.1:5337/mini-chat.html',
    packaged: true,
    packagedOrigin: 'pichamber-ui://app',
    localOrigin: 'http://127.0.0.1:5337',
    currentUrl: 'pichamber-ui://app/mini-chat.html',
  }), false);
});
