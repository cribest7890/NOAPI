// Generates the NOAPI? extension icons (no dependencies — writes PNG by hand).
// Logo: dark disc + cyan "no" symbol (circle with diagonal slash) = "no API".
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- PNG plumbing ----
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
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePng(size, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- drawing ----
function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const rDisc = size * 0.48;
  const rRing = size * 0.3;
  const t = Math.max(1, size * 0.07); // stroke thickness
  // diagonal slash endpoints (45deg through center)
  const d = rRing * 0.72;
  const p1 = [c - d, c - d];
  const p2 = [c + d, c + d];
  const bg = [15, 23, 42]; // slate-900
  const fg = [125, 211, 252]; // sky-300

  const distSeg = (x, y, ax, ay, bx, by) => {
    const vx = bx - ax, vy = by - ay;
    const wx = x - ax, wy = y - ay;
    const len2 = vx * vx + vy * vy;
    let tparam = len2 ? (wx * vx + wy * vy) / len2 : 0;
    tparam = Math.max(0, Math.min(1, tparam));
    const cx = ax + tparam * vx, cy = ay + tparam * vy;
    return Math.hypot(x - cx, y - cy);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const dist = Math.hypot(dx, dy);
      const i = (y * size + x) * 4;
      // disc with soft edge
      let a = 1;
      if (dist > rDisc) a = Math.max(0, 1 - (dist - rDisc) / 1.5);
      let r = bg[0], g = bg[1], b = bg[2];
      const ring = Math.abs(dist - rRing);
      const slash = distSeg(x + 0.5, y + 0.5, p1[0], p1[1], p2[0], p2[1]);
      let mark = 0;
      if (ring < t) mark = Math.max(mark, 1 - ring / t);
      if (slash < t) mark = Math.max(mark, 1 - slash / t);
      if (mark > 0) {
        r = r * (1 - mark) + fg[0] * mark;
        g = g * (1 - mark) + fg[1] * mark;
        b = b * (1 - mark) + fg[2] * mark;
      }
      px[i] = Math.round(r);
      px[i + 1] = Math.round(g);
      px[i + 2] = Math.round(b);
      px[i + 3] = Math.round(a * 255);
    }
  }
  return px;
}

for (const target of ["extension/chrome", "extension/firefox"]) {
  const dir = join(root, target, "icons");
  mkdirSync(dir, { recursive: true });
  for (const size of [16, 48, 128]) {
    const png = makePng(size, drawIcon(size));
    writeFileSync(join(dir, `${size}.png`), png);
    console.log(`wrote ${target}/icons/${size}.png (${png.length} bytes)`);
  }
}
console.log("icons done");
