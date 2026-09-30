import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { ROOT, importTs } from './bundle.mjs';

/**
 * Writes the dashboard favicons to apps/dashboard/public: favicon.svg,
 * favicon.ico (16 and 32, PNG inside ICO) and apple-touch-icon.png (180).
 *
 * The motif is a small gate tile: the tile gradient with a yellow slash, in
 * colors read from shared/tokens.ts so they cannot drift from the design.
 * Rasterizing and PNG encoding are done here with node:zlib, so no image
 * library is needed. Rerun with `npm run icons` after a token change.
 */

const { COLORS } = await importTs('shared/tokens.ts');
const HI = COLORS['--tile-hi'];
const LO = COLORS['--tile-lo'];
const SIGN = COLORS['--sign'];

const OUT = path.join(ROOT, 'apps/dashboard/public');

// Geometry on a 32 unit grid, scaled to every size.
const GRID = 32;
const RADIUS = 8; // the header LogoTile: 40px with a 10px radius
const SLASH = { x1: 19.5, y1: 7, x2: 12.5, y2: 25, width: 4.5 };

// CSS linear-gradient(145deg, hi, lo): direction and gradient line length.
const ANGLE = (145 * Math.PI) / 180;
const DIR = { x: Math.sin(ANGLE), y: -Math.cos(ANGLE) };
const SPAN = Math.abs(DIR.x) + Math.abs(DIR.y);
const G1 = { x: GRID / 2 - (DIR.x * SPAN * GRID) / 2, y: GRID / 2 - (DIR.y * SPAN * GRID) / 2 };
const G2 = { x: GRID / 2 + (DIR.x * SPAN * GRID) / 2, y: GRID / 2 + (DIR.y * SPAN * GRID) / 2 };

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const HI_RGB = rgb(HI);
const LO_RGB = rgb(LO);
const SIGN_RGB = rgb(SIGN);

const round = (n) => Number(n.toFixed(3));

// SVG --------------------------------------------------------------------

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}">
<defs><linearGradient id="t" gradientUnits="userSpaceOnUse" x1="${round(G1.x)}" y1="${round(G1.y)}" x2="${round(G2.x)}" y2="${round(G2.y)}"><stop offset="0" stop-color="${HI}"/><stop offset="1" stop-color="${LO}"/></linearGradient></defs>
<rect width="${GRID}" height="${GRID}" rx="${RADIUS}" fill="url(#t)"/>
<path d="M${SLASH.x1} ${SLASH.y1}L${SLASH.x2} ${SLASH.y2}" stroke="${SIGN}" stroke-width="${SLASH.width}" stroke-linecap="round"/>
</svg>
`;

// Raster -----------------------------------------------------------------

function insideRoundedSquare(x, y, radius) {
  if (x < 0 || y < 0 || x > GRID || y > GRID) return false;
  const cx = Math.min(Math.max(x, radius), GRID - radius);
  const cy = Math.min(Math.max(y, radius), GRID - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function insideSlash(x, y) {
  const dx = SLASH.x2 - SLASH.x1;
  const dy = SLASH.y2 - SLASH.y1;
  const t = Math.min(1, Math.max(0, ((x - SLASH.x1) * dx + (y - SLASH.y1) * dy) / (dx * dx + dy * dy)));
  const px = SLASH.x1 + t * dx - x;
  const py = SLASH.y1 + t * dy - y;
  return px * px + py * py <= (SLASH.width / 2) ** 2;
}

function tileColor(x, y) {
  const t = Math.min(1, Math.max(0, ((x - G1.x) * (G2.x - G1.x) + (y - G1.y) * (G2.y - G1.y)) / ((G2.x - G1.x) ** 2 + (G2.y - G1.y) ** 2)));
  return HI_RGB.map((c, i) => c + (LO_RGB[i] - c) * t);
}

/** RGBA pixels, 4x4 supersampled. `radius` 0 gives an opaque square. */
function rasterize(size, radius) {
  const SS = 4;
  const scale = GRID / size;
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const x = (px + (sx + 0.5) / SS) * scale;
          const y = (py + (sy + 0.5) / SS) * scale;
          if (!insideRoundedSquare(x, y, radius)) continue;
          const color = insideSlash(x, y) ? SIGN_RGB : tileColor(x, y);
          r += color[0];
          g += color[1];
          b += color[2];
          covered += 1;
        }
      }
      const offset = (py * size + px) * 4;
      if (covered > 0) {
        pixels[offset] = Math.round(r / covered);
        pixels[offset + 1] = Math.round(g / covered);
        pixels[offset + 2] = Math.round(b / covered);
      }
      pixels[offset + 3] = Math.round((covered / (SS * SS)) * 255);
    }
  }
  return pixels;
}

// PNG and ICO encoding ---------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, radius) {
  const pixels = rasterize(size, radius);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  // Each scanline starts with filter type 0.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** An ICO file with PNG images inside, supported by every current browser. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size % 256;
    entry[1] = size % 256;
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

const favicon = ico([16, 32].map((size) => ({ size, data: png(size, RADIUS) })));
// iOS masks the corners itself and shows transparency as black, so the touch icon is an opaque square.
const touch = png(180, 0);

await writeFile(path.join(OUT, 'favicon.svg'), svg, 'utf8');
await writeFile(path.join(OUT, 'favicon.ico'), favicon);
await writeFile(path.join(OUT, 'apple-touch-icon.png'), touch);

console.log(`Wrote apps/dashboard/public/favicon.svg          ${svg.length} bytes`);
console.log(`Wrote apps/dashboard/public/favicon.ico          ${favicon.length} bytes (16 and 32)`);
console.log(`Wrote apps/dashboard/public/apple-touch-icon.png ${touch.length} bytes (180)`);
