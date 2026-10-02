import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, importTs } from './bundle.mjs';
import { encodePng } from './png.mjs';

/**
 * Writes apps/dashboard/public/og.png, the 1200x630 Open Graph image of
 * link.daffa.me. It follows the pattern of favicons.mjs: colors from
 * shared/tokens.ts, geometry drawn here, encoded by png.mjs, no image library.
 *
 * The picture is the slug tile of the design blown up into a signboard: the
 * dark tile gradient with its neumorphic shadow on the page background, a
 * grey slash and daffa.me in sign yellow, and below it the yellow square
 * marker and rule that the design uses as a wayfinding accent. Text is drawn
 * with a small monoline stroke font that only knows the glyphs it needs.
 * Edges are anti aliased from exact distances, so one sample per pixel is
 * enough. Rerun with `npm run icons` after a token change.
 */

const { COLORS } = await importTs('shared/tokens.ts');

const W = 1200;
const H = 630;
const OUT = path.join(ROOT, 'apps/dashboard/public/og.png');

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const BG = rgb(COLORS['--bg']);
const HI = rgb(COLORS['--tile-hi']);
const LO = rgb(COLORS['--tile-lo']);
const PREFIX = rgb(COLORS['--tile-prefix']);
const SIGN = rgb(COLORS['--sign']);
const INK = rgb(COLORS['--ink']);
const LINE = rgb(COLORS['--line']);
const LIGHT = rgb(COLORS['--sh-l']);

// Geometry ---------------------------------------------------------------

const TILE = { x: 120, y: 150, w: 960, h: 300, r: 40 };
const EM = 124;
const ADVANCE = 0.74 * EM;
const STROKE = 0.115 * EM;
const TEXT = '/daffa.me';
const BASELINE = TILE.y + TILE.h / 2 + 0.45 * EM;
const TEXT_X = TILE.x + (TILE.w - TEXT.length * ADVANCE) / 2 + 0.07 * EM;
const MARKER = { x: TILE.x, y: TILE.y + TILE.h + 52, size: 26, border: 3 };
const RULE = { x1: MARKER.x + MARKER.size + 22, x2: TILE.x + TILE.w, y: MARKER.y + MARKER.size / 2, width: 3 };

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);

/** Signed distance to a rounded rectangle, negative inside. */
function roundedRect(x, y, rect) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const qx = Math.abs(x - cx) - rect.w / 2 + rect.r;
  const qy = Math.abs(y - cy) - rect.h / 2 + rect.r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rect.r;
}

// Stroke font ------------------------------------------------------------
// Glyphs on a unit grid: x to the right, y up from the baseline. x height is
// 0.62, ascenders reach 1. Curves are polylines fine enough to look round.

function arc(cx, cy, rx, ry, from, to, steps = 28) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    points.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return points;
}

const BOWL = { cx: 0.29, cy: 0.31, rx: 0.27, ry: 0.31 };
const GLYPHS = {
  '/': [[[0.06, -0.1], [0.52, 1.0]]],
  d: [arc(BOWL.cx, BOWL.cy, BOWL.rx, BOWL.ry, 0, 360, 48), [[0.56, 0], [0.56, 1.0]]],
  a: [arc(BOWL.cx, BOWL.cy, BOWL.rx, BOWL.ry, 0, 360, 48), [[0.56, 0], [0.56, 0.62]]],
  f: [[[0.24, 0], [0.24, 0.78]], arc(0.46, 0.78, 0.22, 0.22, 180, 50, 16), [[0.04, 0.62], [0.5, 0.62]]],
  m: [
    [[0.02, 0], [0.02, 0.62]],
    [[0.02, 0.42], ...arc(0.17, 0.42, 0.15, 0.17, 180, 0, 16), [0.32, 0]],
    [[0.32, 0.42], ...arc(0.47, 0.42, 0.15, 0.17, 180, 0, 16), [0.62, 0]],
  ],
  e: [[[0.03, 0.31], [0.56, 0.31]], arc(BOWL.cx, BOWL.cy, BOWL.rx, BOWL.ry, 0, 320, 44)],
  '.': [[[0.28, 0.02], [0.28, 0.02]]],
};

/** Every stroke segment in pixels, grouped by color, with a bounding box per glyph. */
function layoutText() {
  const glyphs = [];
  [...TEXT].forEach((char, index) => {
    const strokes = GLYPHS[char];
    if (!strokes) throw new Error(`No glyph for ${char}`);
    const ox = TEXT_X + index * ADVANCE;
    const segments = [];
    for (const stroke of strokes) {
      const points = stroke.map(([x, y]) => [ox + x * EM, BASELINE - y * EM]);
      for (let i = 0; i < points.length - 1; i += 1) segments.push([points[i], points[i + 1]]);
    }
    const xs = segments.flat().map((p) => p[0]);
    const ys = segments.flat().map((p) => p[1]);
    const pad = STROKE;
    glyphs.push({
      color: char === '/' ? PREFIX : SIGN,
      // The dot reads better a little heavier than the strokes.
      width: char === '.' ? STROKE * 1.45 : STROKE,
      segments,
      box: [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad],
    });
  });
  return glyphs;
}

function segmentDistance(x, y, [[x1, y1], [x2, y2]]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : clamp(((x - x1) * dx + (y - y1) * dy) / length);
  return Math.hypot(x1 + t * dx - x, y1 + t * dy - y);
}

const GLYPH_LAYOUT = layoutText();

// Painting ---------------------------------------------------------------

/** CSS linear-gradient(145deg, hi, lo) across the tile. */
const ANGLE = (145 * Math.PI) / 180;
const DIR = [Math.sin(ANGLE), -Math.cos(ANGLE)];
const SPAN = Math.abs(DIR[0]) * TILE.w + Math.abs(DIR[1]) * TILE.h;
function tileColor(x, y) {
  const t = ((x - TILE.x - TILE.w / 2) * DIR[0] + (y - TILE.y - TILE.h / 2) * DIR[1]) / SPAN + 0.5;
  return mix(HI, LO, clamp(t));
}

function pixel(x, y) {
  let color = BG;

  // The raised tile: a light glow up and left, a dark shadow down and right,
  // as --tile-in does on the slug tiles.
  const light = 1 - smoothstep(-10, 30, roundedRect(x + 14, y + 14, TILE));
  color = mix(color, LIGHT, 0.9 * light);
  const dark = 1 - smoothstep(-14, 46, roundedRect(x - 16, y - 20, TILE));
  color = mix(color, INK, 0.38 * dark);

  const inside = clamp(0.5 - roundedRect(x, y, TILE));
  if (inside > 0) {
    let fill = tileColor(x, y);
    for (const glyph of GLYPH_LAYOUT) {
      const [bx1, by1, bx2, by2] = glyph.box;
      if (x < bx1 || x > bx2 || y < by1 || y > by2) continue;
      let distance = Infinity;
      for (const segment of glyph.segments) distance = Math.min(distance, segmentDistance(x, y, segment));
      const ink = clamp(glyph.width / 2 + 0.5 - distance);
      if (ink > 0) fill = mix(fill, glyph.color, ink);
    }
    color = mix(color, fill, inside);
  }

  // Wayfinding accent: a yellow square with an ink border, then a rule.
  const m = MARKER;
  if (x >= m.x && x < m.x + m.size && y >= m.y && y < m.y + m.size) {
    const edge = Math.min(x - m.x, m.x + m.size - 1 - x, y - m.y, m.y + m.size - 1 - y);
    color = edge < m.border ? INK : SIGN;
  }
  if (x >= RULE.x1 && x < RULE.x2 && Math.abs(y + 0.5 - RULE.y) <= RULE.width / 2) color = LINE;

  return color;
}

const pixels = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const [r, g, b] = pixel(x + 0.5, y + 0.5);
    const offset = (y * W + x) * 3;
    pixels[offset] = Math.round(r);
    pixels[offset + 1] = Math.round(g);
    pixels[offset + 2] = Math.round(b);
  }
}

const image = encodePng(W, H, pixels, 3);
await writeFile(OUT, image);
console.log(`Wrote apps/dashboard/public/og.png ${image.length} bytes (${W}x${H})`);
