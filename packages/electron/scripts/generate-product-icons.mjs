#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEV_ICON_BADGE_COLOR,
  DOCS_BADGES_DIR,
  ICONS_DIR,
  PRODUCT_ICON_SOURCES,
  WEB_PUBLIC_DIR,
  assertDesktopAppIconIsDistinct,
  easeBreathOpacity,
  encodeIcns,
  encodeIco,
} from './product-icons.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRAY_DIR = path.join(ICONS_DIR, 'tray');
const APP_ICON_ASSETS_DIR = path.join(ICONS_DIR, 'AppIcon.icon', 'Assets');
const TRAY_BREATH_FRAME_COUNT = 16;

const resolveRsvgConvert = () => {
  const candidates = ['rsvg-convert', '/usr/bin/rsvg-convert'];
  for (const command of candidates) {
    const probe = spawnSync(command, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (!probe.error && probe.status === 0) return command;
  }
  throw new Error('rsvg-convert is required to rasterize product icons. Install librsvg2-bin.');
};

const rasterizeSvg = (svgPath, { width, height, outputPath }) => {
  const command = resolveRsvgConvert();
  const args = ['-w', String(width), '-h', String(height), svgPath];
  if (outputPath) args.push('-o', outputPath);
  const result = spawnSync(command, args, { encoding: outputPath ? 'utf8' : undefined });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`rsvg-convert failed for ${svgPath}: ${result.stderr || result.status}`);
  }
  return outputPath ? outputPath : result.stdout;
};

const writeFile = (filePath, contents) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
};

let tempSvgSerial = 0;
const withTempSvg = (contents, work) => {
  tempSvgSerial += 1;
  const tempPath = path.join(os.tmpdir(), `pichamber-icon-${process.pid}-${Date.now()}-${tempSvgSerial}.svg`);
  fs.writeFileSync(tempPath, contents);
  try {
    return work(tempPath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
};

const overlayDevBadge = (appIconSvg) => {
  // Small amber pip in the lower-right of the 1024 canvas so Dev stays the
  // same dock mark with a distinct badge.
  return appIconSvg.replace(
    /<\/svg>\s*$/i,
    `  <circle cx="820" cy="820" r="78" fill="${DEV_ICON_BADGE_COLOR}"/>
</svg>
`,
  );
};

const writeTrayFrame = (glyphSvg, opacity, outputPath, size) => {
  const faded = glyphSvg
    .replace(/<svg([^>]*)>/, `<svg$1><g opacity="${opacity}">`)
    .replace(/<\/svg>\s*$/i, '</g></svg>');
  withTempSvg(faded, (tempPath) => {
    rasterizeSvg(tempPath, { width: size, height: size, outputPath });
  });
};

export const generateTrayIcons = ({ glyphSvg = fs.readFileSync(PRODUCT_ICON_SOURCES.trayGlyph, 'utf8') } = {}) => {
  writeTrayFrame(glyphSvg, 0.55, path.join(TRAY_DIR, 'trayTemplate-idle.png'), 18);
  writeTrayFrame(glyphSvg, 0.55, path.join(TRAY_DIR, 'trayTemplate-idle@2x.png'), 36);
  writeTrayFrame(glyphSvg, 1, path.join(TRAY_DIR, 'trayTemplate-unseen.png'), 18);
  writeTrayFrame(glyphSvg, 1, path.join(TRAY_DIR, 'trayTemplate-unseen@2x.png'), 36);
  for (let index = 0; index < TRAY_BREATH_FRAME_COUNT; index += 1) {
    const opacity = easeBreathOpacity(index, TRAY_BREATH_FRAME_COUNT);
    const name = `trayTemplate-breath-${String(index).padStart(2, '0')}`;
    writeTrayFrame(glyphSvg, opacity, path.join(TRAY_DIR, `${name}.png`), 18);
    writeTrayFrame(glyphSvg, opacity, path.join(TRAY_DIR, `${name}@2x.png`), 36);
  }
};

export const generateAppIcons = ({
  appIconSvg = fs.readFileSync(PRODUCT_ICON_SOURCES.appIcon, 'utf8'),
  windowsIconSvg = fs.existsSync(PRODUCT_ICON_SOURCES.windowsIcon)
    ? fs.readFileSync(PRODUCT_ICON_SOURCES.windowsIcon, 'utf8')
    : appIconSvg,
} = {}) => {
  assertDesktopAppIconIsDistinct(appIconSvg);
  const sizes = [16, 32, 64, 128, 256, 512, 1024];
  const pngBySize = {};
  withTempSvg(appIconSvg, (tempPath) => {
    for (const size of sizes) {
      const outputPath = path.join(os.tmpdir(), `pichamber-app-${size}.png`);
      rasterizeSvg(tempPath, { width: size, height: size, outputPath });
      pngBySize[size] = fs.readFileSync(outputPath);
      fs.rmSync(outputPath, { force: true });
    }
    rasterizeSvg(tempPath, { width: 512, height: 512, outputPath: path.join(ICONS_DIR, 'app-icon.png') });
    rasterizeSvg(tempPath, { width: 1024, height: 1024, outputPath: path.join(ICONS_DIR, 'icon.png') });
    rasterizeSvg(tempPath, {
      width: 1024,
      height: 1024,
      outputPath: path.join(APP_ICON_ASSETS_DIR, 'app-icon-glyph-dark 4.png'),
    });
    rasterizeSvg(tempPath, {
      width: 1024,
      height: 1024,
      outputPath: path.join(APP_ICON_ASSETS_DIR, 'app-icon-glyph-light 2.png'),
    });
  });

  writeFile(path.join(ICONS_DIR, 'icon.icns'), encodeIcns(pngBySize));

  const windowsPngs = {};
  withTempSvg(windowsIconSvg, (tempPath) => {
    for (const size of [16, 32, 256, 512]) {
      const outputPath = path.join(os.tmpdir(), `pichamber-win-${size}.png`);
      rasterizeSvg(tempPath, { width: size, height: size, outputPath });
      windowsPngs[size] = fs.readFileSync(outputPath);
      fs.rmSync(outputPath, { force: true });
    }
  });
  writeFile(path.join(ICONS_DIR, 'icon.ico'), encodeIco([
    windowsPngs[16],
    windowsPngs[32],
    windowsPngs[256],
    windowsPngs[512],
  ]));

  const devSvg = overlayDevBadge(appIconSvg);
  withTempSvg(devSvg, (tempPath) => {
    rasterizeSvg(tempPath, { width: 1024, height: 1024, outputPath: path.join(ICONS_DIR, 'dev-icon.png') });
    const devPngs = {};
    for (const size of sizes) {
      const outputPath = path.join(os.tmpdir(), `pichamber-dev-${size}.png`);
      rasterizeSvg(tempPath, { width: size, height: size, outputPath });
      devPngs[size] = fs.readFileSync(outputPath);
      fs.rmSync(outputPath, { force: true });
    }
    writeFile(path.join(ICONS_DIR, 'dev-icon.icns'), encodeIcns(devPngs));
  });
};

export const generateWebIcons = ({
  appIconSvg = fs.readFileSync(PRODUCT_ICON_SOURCES.appIcon, 'utf8'),
  glyphSvg = fs.readFileSync(PRODUCT_ICON_SOURCES.trayGlyph, 'utf8'),
} = {}) => {
  assertDesktopAppIconIsDistinct(appIconSvg);
  withTempSvg(appIconSvg, (tempPath) => {
    rasterizeSvg(tempPath, { width: 16, height: 16, outputPath: path.join(WEB_PUBLIC_DIR, 'favicon-16.png') });
    rasterizeSvg(tempPath, { width: 32, height: 32, outputPath: path.join(WEB_PUBLIC_DIR, 'favicon-32.png') });
    rasterizeSvg(tempPath, { width: 64, height: 64, outputPath: path.join(WEB_PUBLIC_DIR, 'favicon.png') });
    for (const size of [120, 152, 167, 180]) {
      rasterizeSvg(tempPath, {
        width: size,
        height: size,
        outputPath: path.join(WEB_PUBLIC_DIR, `apple-touch-icon-${size}x${size}.png`),
      });
    }
    fs.copyFileSync(path.join(WEB_PUBLIC_DIR, 'apple-touch-icon-180x180.png'), path.join(WEB_PUBLIC_DIR, 'apple-touch-icon.png'));
    rasterizeSvg(tempPath, { width: 192, height: 192, outputPath: path.join(WEB_PUBLIC_DIR, 'pwa-192.png') });
    rasterizeSvg(tempPath, { width: 512, height: 512, outputPath: path.join(WEB_PUBLIC_DIR, 'pwa-512.png') });
    rasterizeSvg(tempPath, { width: 192, height: 192, outputPath: path.join(WEB_PUBLIC_DIR, 'pwa-maskable-192.png') });
    rasterizeSvg(tempPath, { width: 512, height: 512, outputPath: path.join(WEB_PUBLIC_DIR, 'pwa-maskable-512.png') });
  });

  const whiteGlyph = glyphSvg.replace(/#000/g, '#fff');
  withTempSvg(whiteGlyph, (tempPath) => {
    rasterizeSvg(tempPath, { width: 192, height: 192, outputPath: path.join(WEB_PUBLIC_DIR, 'logo-dark-192x192.png') });
  });
  withTempSvg(glyphSvg, (tempPath) => {
    rasterizeSvg(tempPath, { width: 192, height: 192, outputPath: path.join(WEB_PUBLIC_DIR, 'logo-light-192x192.png') });
  });
};

export const generateDocsBadges = ({
  glyphSvg = fs.readFileSync(PRODUCT_ICON_SOURCES.trayGlyph, 'utf8'),
} = {}) => {
  const dark = glyphSvg.replace(/#000/g, '#fff');
  writeFile(path.join(DOCS_BADGES_DIR, 'pichamber-logo-dark.svg'), dark);
  writeFile(path.join(DOCS_BADGES_DIR, 'pichamber-logo-light.svg'), glyphSvg);
  writeFile(path.join(DOCS_BADGES_DIR, 'openchamber-logo-dark.svg'), dark);
  writeFile(path.join(DOCS_BADGES_DIR, 'openchamber-logo-light.svg'), glyphSvg);
  withTempSvg(dark, (tempPath) => {
    rasterizeSvg(tempPath, { width: 512, height: 512, outputPath: path.join(DOCS_BADGES_DIR, 'openchamber-logo-dark.png') });
    rasterizeSvg(tempPath, { width: 512, height: 512, outputPath: path.join(DOCS_BADGES_DIR, 'pichamber-logo-dark.png') });
  });
};

const run = () => {
  const args = new Set(process.argv.slice(2));
  const appIconSvg = fs.readFileSync(PRODUCT_ICON_SOURCES.appIcon, 'utf8');
  if (!args.has('--tray-only') && !args.has('--skip-app-icon')) {
    assertDesktopAppIconIsDistinct(appIconSvg);
    generateAppIcons({ appIconSvg });
    generateWebIcons({ appIconSvg });
  }
  if (!args.has('--app-only')) {
    generateTrayIcons();
    generateDocsBadges();
  }
  console.log(`Generated product icons from ${path.relative(path.resolve(__dirname, '../../..'), ICONS_DIR)}`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}
