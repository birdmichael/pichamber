import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  PRODUCT_ICON_SOURCES,
  assertDesktopAppIconIsDistinct,
  easeBreathOpacity,
  encodeIcns,
  encodeIco,
  encodePng,
  looksLikeOfficialPiFavicon,
  looksLikeRejectedInnerGlyphPlacement,
  readPngSize,
} from './product-icons.mjs';

const OFFICIAL_FAVICON = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">
  <rect width="800" height="800" rx="120" fill="#09090b"/>
  <path fill="#fff" fill-rule="evenodd" d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z"/>
  <path fill="#fff" d="M517.36 400 H634.72 V634.72 H517.36 Z"/>
</svg>
`;

test('rejects the raw pi.dev favicon as the desktop app icon', () => {
  assert.equal(looksLikeOfficialPiFavicon(OFFICIAL_FAVICON), true);
  assert.throws(
    () => assertDesktopAppIconIsDistinct(OFFICIAL_FAVICON, 'app-icon.svg'),
    /raw pi\.dev favicon/,
  );
});

test('rejects the uncorrected inside-the-volume scale(0.115) ty=6 placement', () => {
  const rejected = `<svg viewBox="0 0 1024 1024"><g transform="matrix(0.866, 0.5, -0.866, 0.5, 0, 6) scale(0.115)"></g></svg>`;
  assert.equal(looksLikeRejectedInnerGlyphPlacement(rejected), true);
  assert.throws(
    () => assertDesktopAppIconIsDistinct(rejected, 'app-icon.svg'),
    /scale\(0\.115\) ty=6/,
  );
});

test('allows a distinct desktop treatment that still uses the official glyph', () => {
  const distinct = OFFICIAL_FAVICON.replace(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">',
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><g transform="translate(100, 100)">',
  ).replace('</svg>', '</g></svg>');
  assert.equal(looksLikeOfficialPiFavicon(distinct), false);
  assert.doesNotThrow(() => assertDesktopAppIconIsDistinct(distinct));
});

test('encodes PNG, ICNS, and ICO from raw pixels', () => {
  const rgba = Buffer.alloc(16 * 16 * 4, 255);
  const png = encodePng({ width: 16, height: 16, rgba });
  assert.deepEqual(readPngSize(png), { width: 16, height: 16 });

  const icns = encodeIcns({ 16: png });
  assert.equal(icns.toString('ascii', 0, 4), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);

  const ico = encodeIco([png]);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 1);
});

test('checked-in dock master uses the corrected top-face Pi slot', () => {
  const appIcon = fs.readFileSync(PRODUCT_ICON_SOURCES.appIcon, 'utf8');
  assert.doesNotThrow(() => assertDesktopAppIconIsDistinct(appIcon));
  assert.match(appIcon, /scale\(0\.068\)/);
  assert.match(appIcon, /matrix\(0\.866, 0\.5, -0\.866, 0\.5, 0, -24\)/);
  assert.doesNotMatch(appIcon, /OpenCode/);
  assert.doesNotMatch(appIcon, /scale\(0\.115\)/);
});

test('eases tray breath opacity from dim idle to full unseen', () => {
  assert.equal(easeBreathOpacity(0, 16), 0.4);
  assert.equal(easeBreathOpacity(15, 16), 1);
  assert.ok(easeBreathOpacity(8, 16) > easeBreathOpacity(4, 16));
});
