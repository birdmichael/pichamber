import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isBrowsablePanelUrl,
  isLocalBrowserFileUrl,
  shouldAllowBrowserPanelCertificateError,
} from './browser-panel-security.mjs';

test('allows untrusted certificate authorities for loopback HTTPS pages', () => {
  for (const url of [
    'https://localhost:58580/',
    'https://127.0.0.1:58580/',
    'https://[::1]:58580/',
  ]) {
    assert.equal(shouldAllowBrowserPanelCertificateError({
      url,
      error: 'net::ERR_CERT_AUTHORITY_INVALID',
    }), true);
  }
});

test('keeps certificate validation for non-loopback pages', () => {
  for (const url of [
    'https://example.com/',
    'https://localhost.example.com/',
    'https://0.0.0.0:58580/',
  ]) {
    assert.equal(shouldAllowBrowserPanelCertificateError({
      url,
      error: 'net::ERR_CERT_AUTHORITY_INVALID',
    }), false);
  }
});

test('does not bypass other certificate failures or malformed URLs', () => {
  assert.equal(shouldAllowBrowserPanelCertificateError({
    url: 'https://localhost:58580/',
    error: 'net::ERR_CERT_DATE_INVALID',
  }), false);
  assert.equal(shouldAllowBrowserPanelCertificateError({
    url: 'not a url',
    error: 'net::ERR_CERT_AUTHORITY_INVALID',
  }), false);
});

test('isLocalBrowserFileUrl accepts local file URLs only', () => {
  assert.equal(isLocalBrowserFileUrl('file:///tmp/preview.html'), true);
  assert.equal(isLocalBrowserFileUrl('file://localhost/tmp/preview.html'), true);
  assert.equal(isLocalBrowserFileUrl('file://remote-host/share/x.html'), false);
  assert.equal(isLocalBrowserFileUrl('javascript:alert(1)'), false);
  assert.equal(isLocalBrowserFileUrl('data:text/html,hi'), false);
  assert.equal(isLocalBrowserFileUrl('https://example.com/'), false);
});

test('isBrowsablePanelUrl allows http(s) and local file, not other schemes', () => {
  assert.equal(isBrowsablePanelUrl('https://example.com/'), true);
  assert.equal(isBrowsablePanelUrl('http://127.0.0.1:5173/'), true);
  assert.equal(isBrowsablePanelUrl('file:///private/tmp/a.html'), true);
  assert.equal(isBrowsablePanelUrl('file://evil/share/a.html'), false);
  assert.equal(isBrowsablePanelUrl('javascript:alert(1)'), false);
  assert.equal(isBrowsablePanelUrl('data:text/html,x'), false);
});
