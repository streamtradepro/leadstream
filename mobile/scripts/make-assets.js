/**
 * Generates placeholder app icons with zero dependencies (pure PNG encoding via
 * Node's zlib). Solid GitHub-dark background (#0d1117) with a blocky orange "LS".
 *
 *   node scripts/make-assets.js
 *
 * Outputs: assets/icon.png (1024), assets/adaptive-icon.png (1024),
 *          assets/splash-icon.png (512), assets/favicon.png (48).
 * Replace these with real artwork before a store release.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG = [0x0d, 0x11, 0x17];
const FG = [0xf0, 0x88, 0x3e]; // orange

// 5x7 bitmap glyphs
const GLYPHS = {
  L: ['X....', 'X....', 'X....', 'X....', 'X....', 'X....', 'XXXXX'],
  S: ['.XXXX', 'X....', 'X....', '.XXX.', '....X', '....X', 'XXXX.'],
};

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, pixelAt) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelAt(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Draw "LS" centred in a size x size square. */
function makeLogo(size) {
  const cell = Math.floor(size / 17); // 5+1+5 = 11 cells wide + margins
  const gap = cell;
  const textW = 5 * cell + gap + 5 * cell;
  const textH = 7 * cell;
  const x0 = Math.floor((size - textW) / 2);
  const y0 = Math.floor((size - textH) / 2);
  const glyphs = [
    { g: GLYPHS.L, x: x0 },
    { g: GLYPHS.S, x: x0 + 5 * cell + gap },
  ];
  return encodePng(size, size, (x, y) => {
    for (const { g, x: gx } of glyphs) {
      const cx = Math.floor((x - gx) / cell);
      const cy = Math.floor((y - y0) / cell);
      if (cx >= 0 && cx < 5 && cy >= 0 && cy < 7 && x >= gx && y >= y0) {
        if (g[cy][cx] === 'X') return FG;
      }
    }
    return BG;
  });
}

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
const files = {
  'icon.png': 1024,
  'adaptive-icon.png': 1024,
  'splash-icon.png': 512,
  'favicon.png': 48,
};
for (const [name, size] of Object.entries(files)) {
  const file = path.join(out, name);
  fs.writeFileSync(file, makeLogo(size));
  console.log('wrote', file, `${size}x${size}`);
}
