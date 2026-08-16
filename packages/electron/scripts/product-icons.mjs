import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ICONS_DIR = path.resolve(__dirname, '..', 'resources', 'icons');
export const WEB_PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'web', 'public');
export const DOCS_BADGES_DIR = path.resolve(__dirname, '..', '..', '..', 'docs', 'references', 'badges');

export const PRODUCT_ICON_SOURCES = {
  appIcon: path.join(ICONS_DIR, 'app-icon.svg'),
  windowsIcon: path.join(ICONS_DIR, 'icon-win.svg'),
  trayGlyph: path.join(ICONS_DIR, 'tray', 'tray-glyph.svg'),
};

export const DEV_ICON_BADGE_COLOR = '#F5A524';

// Official pi.dev/favicon.svg is a full-bleed 800² plate. Pichamber's desktop
// mark must be a distinct treatment of the pixel glyph, not that file copied
// into app-icon.svg.
const OFFICIAL_FAVICON_MARKERS = [
  /viewBox="0 0 800 800"/,
  /fill="#09090b"/,
  /M165\.29 165\.29/,
];

export const looksLikeOfficialPiFavicon = (svg) => {
  const text = String(svg ?? '');
  if (!OFFICIAL_FAVICON_MARKERS.every((marker) => marker.test(text))) return false;
  return !/translate\(\s*100\s*,\s*100\s*\)/.test(text);
};

export const looksLikeRejectedInnerGlyphPlacement = (svg) => {
  const text = String(svg ?? '');
  return /scale\(\s*0\.115\s*\)/.test(text)
    && /matrix\(\s*0\.866\s*,\s*0\.5\s*,\s*-0\.866\s*,\s*0\.5\s*,\s*0\s*,\s*6\s*\)/.test(text);
};

export const assertDesktopAppIconIsDistinct = (svg, filePath = PRODUCT_ICON_SOURCES.appIcon) => {
  if (looksLikeOfficialPiFavicon(svg)) {
    throw new Error(
      `${filePath} is the raw pi.dev favicon. Pichamber's desktop mark must be a distinct treatment of the official pixel glyph, not a copy of that file.`,
    );
  }
  if (looksLikeRejectedInnerGlyphPlacement(svg)) {
    throw new Error(
      `${filePath} still uses the rejected inner-glyph placement (scale(0.115) ty=6). Wait for corrected SVG paths.`,
    );
  }
};

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[i] = value >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
};

const pngChunk = (type, data) => {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
};

export const encodePng = ({ width, height, rgba }) => {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const dest = y * (width * 4 + 1);
    raw[dest] = 0;
    rgba.copy(raw, dest + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};

export const readPngSize = (png) => {
  if (!Buffer.isBuffer(png) || png.length < 24 || png.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('Expected a PNG buffer');
  }
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
};

const ICNS_TYPES = {
  16: 'icp4',
  32: 'icp5',
  64: 'icp6',
  128: 'ic07',
  256: 'ic08',
  512: 'ic09',
  1024: 'ic10',
};

export const encodeIcns = (pngBySize) => {
  const chunks = [];
  for (const [size, type] of Object.entries(ICNS_TYPES)) {
    const png = pngBySize[Number(size)];
    if (!png) continue;
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(png.length + 8, 4);
    chunks.push(header, png);
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
};

export const encodeIco = (pngs) => {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const entries = [];
  const images = [];
  let offset = 6 + (16 * count);
  for (const png of pngs) {
    const { width, height } = readPngSize(png);
    const entry = Buffer.alloc(16);
    entry.writeUInt8(width >= 256 ? 0 : width, 0);
    entry.writeUInt8(height >= 256 ? 0 : height, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    images.push(png);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images]);
};

export const easeBreathOpacity = (index, frameCount) => {
  if (frameCount <= 1) return 1;
  const t = index / (frameCount - 1);
  const eased = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
  return 0.4 + (0.6 * eased);
};
