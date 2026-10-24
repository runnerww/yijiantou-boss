// 生成插件图标 PNG(无第三方依赖)。青绿圆角方块 + 白色对勾。
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const OUT_DIR = process.argv[2];
const SIZES = [16, 48, 128];

const TEAL = [0x00, 0xa6, 0xa7, 255];
const WHITE = [0xff, 0xff, 0xff, 255];
const CLEAR = [0, 0, 0, 0];

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function makeIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const checkW = size * 0.085;
  // 对勾三个点
  const p1 = [size * 0.27, size * 0.53];
  const p2 = [size * 0.44, size * 0.69];
  const p3 = [size * 0.74, size * 0.33];

  function setPx(x, y, color) {
    const i = (y * size + x) * 4;
    px[i] = color[0]; px[i + 1] = color[1]; px[i + 2] = color[2]; px[i + 3] = color[3];
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 圆角矩形遮罩
      const cx = Math.min(x, size - 1 - x);
      const cy = Math.min(y, size - 1 - y);
      let inside = true;
      if (cx < radius && cy < radius) {
        const d = Math.hypot(radius - cx, radius - cy);
        if (d > radius) inside = false;
      }
      if (!inside) { setPx(x, y, CLEAR); continue; }
      // 白对勾
      const d = Math.min(
        distToSegment(x, y, p1[0], p1[1], p2[0], p2[1]),
        distToSegment(x, y, p2[0], p2[1], p3[0], p3[1])
      );
      setPx(x, y, d <= checkW ? WHITE : TEAL);
    }
  }

  // 扫描线 + filter 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

if (!OUT_DIR) { console.error('usage: node gen_icons.js <outDir>'); process.exit(1); }
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const s of SIZES) {
  const buf = makeIcon(s);
  fs.writeFileSync(path.join(OUT_DIR, `icon${s}.png`), buf);
  console.log(`icon${s}.png ${buf.length} bytes`);
}
