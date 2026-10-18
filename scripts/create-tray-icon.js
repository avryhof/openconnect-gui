#!/usr/bin/env node

// Generates a valid 32x32 PNG tray icon (VPN shield with keyhole).
// The previous version embedded a base64 PNG whose IDAT chunk was corrupt,
// which made Electron fail to load the tray icon.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 32;
const FILL = [37, 99, 235, 255];    // blue shield
const KEYHOLE = [255, 255, 255, 255]; // white keyhole

// Shield geometry (centered in the canvas)
const SH_W = 24;
const SH_X = (SIZE - SH_W) / 2;
const SH_Y = 3;
const SH_H = 26;
const SH_MID = SH_Y + SH_H * 0.45;

// Keyhole geometry
const KH_X = SIZE / 2;
const KH_Y = SH_Y + SH_H * 0.38;
const KH_R = 3.5;

function shieldHalfWidth(y) {
  if (y < SH_Y || y > SH_Y + SH_H) return 0;
  if (y <= SH_MID) return SH_W / 2;
  const t = (y - SH_MID) / (SH_Y + SH_H - SH_MID);
  return (SH_W / 2) * (1 - Math.pow(t, 1.6));
}

function isShieldPixel(x, y) {
  const half = shieldHalfWidth(y);
  if (half <= 0) return false;
  return Math.abs(x + 0.5 - SIZE / 2) <= half;
}

function isKeyholePixel(x, y) {
  const dx = x + 0.5 - KH_X;
  const dy = y + 0.5 - KH_Y;
  if (dx * dx + dy * dy <= KH_R * KH_R) return true;
  // Stem below the circle, widening slightly
  const stemTop = KH_Y + KH_R - 1;
  const stemBottom = KH_Y + KH_R + 5;
  if (y + 0.5 >= stemTop && y + 0.5 <= stemBottom) {
    const t = (y + 0.5 - stemTop) / (stemBottom - stemTop);
    const halfStem = 1.5 + t * 1.0;
    return Math.abs(dx) <= halfStem;
  }
  return false;
}

function crc32(buf) {
  if (typeof zlib.crc32 === 'function') {
    return zlib.crc32(buf) >>> 0;
  }
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let c = 0xffffffff;
  for (const x of buf) c = table[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'latin1');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return out;
}

// RGBA scanlines with filter byte 0
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (1 + SIZE * 4);
  raw[rowStart] = 0;
  for (let x = 0; x < SIZE; x++) {
    const px = rowStart + 1 + x * 4;
    const shield = isShieldPixel(x, y);
    const keyhole = shield && isKeyholePixel(x, y);
    const color = keyhole ? KEYHOLE : shield ? FILL : [0, 0, 0, 0];
    raw[px] = color[0];
    raw[px + 1] = color[1];
    raw[px + 2] = color[2];
    raw[px + 3] = color[3];
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
]);

const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

const iconPath = path.join(assetsDir, 'tray-icon.png');
fs.writeFileSync(iconPath, png);

// Verify the image actually decodes before declaring success
{
  let off = 8;
  let idat = null;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.slice(off + 4, off + 8).toString('latin1');
    if (type === 'IDAT') idat = png.slice(off + 8, off + 8 + len);
    off += 12 + len;
  }
  zlib.inflateSync(idat);
}
console.log('Tray icon created at:', iconPath, `(${png.length} bytes)`);
