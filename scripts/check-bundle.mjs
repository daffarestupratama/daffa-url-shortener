import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { ROOT } from './bundle.mjs';

/**
 * Checks the production client build in apps/dashboard/dist/client. Run
 * `npm run build:dashboard` first.
 *
 *   1. The dev only state preview is absent.
 *   2. Nothing is loaded from a font or script CDN.
 *   3. _headers exists and forbids framing.
 *   4. Flags are separate files, not inlined into JavaScript.
 *   5. Reports raw and gzip sizes, split into the initial load and lazy chunks.
 */

const DIST = path.join(ROOT, 'apps/dashboard/dist/client');

if (!existsSync(DIST)) {
  console.error('No build found. Run `npm run build:dashboard` first.');
  process.exit(1);
}

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

const all = await walk(DIST);
const textFiles = all.filter((file) => /\.(js|css|html)$/.test(file));
const failures = [];
const checks = [];

const pass = (message) => checks.push(`  PASS  ${message}`);
const fail = (message) => {
  checks.push(`  FAIL  ${message}`);
  failures.push(message);
};

// 1 and 2: forbidden strings in any shipped text file.
const DEV_ONLY = ['daffa-dev-state-preview', 'noresults', 'create-errors', 'create-ok'];
const CDNS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com'];

const contents = new Map();
for (const file of textFiles) contents.set(file, await readFile(file, 'utf8'));

function findAll(needles) {
  const hits = [];
  for (const [file, text] of contents) {
    for (const needle of needles) {
      if (text.includes(needle)) hits.push(`${needle} in ${path.relative(DIST, file)}`);
    }
  }
  return hits;
}

const devHits = findAll(DEV_ONLY);
if (devHits.length) fail(`dev state preview found in the build: ${devHits.join(', ')}`);
else pass('dev state preview is absent from the production build');

const cdnHits = findAll(CDNS);
if (cdnHits.length) fail(`CDN reference found: ${cdnHits.join(', ')}`);
else pass('no Google Fonts or CDN references');

// 3: security headers for static assets.
const headersFile = path.join(DIST, '_headers');
if (!existsSync(headersFile)) {
  fail('dist/client/_headers is missing');
} else {
  const headers = await readFile(headersFile, 'utf8');
  if (!headers.includes("frame-ancestors 'none'")) fail("_headers lacks frame-ancestors 'none'");
  else pass("_headers is present with frame-ancestors 'none'");
}

// 4: flags ship as files. An inlined SVG data URI in JS would mean all 265 flags are in the bundle.
const js = textFiles.filter((file) => file.endsWith('.js'));
const inlined = js.filter((file) => contents.get(file).includes('data:image/svg+xml'));
if (inlined.length) fail(`SVG data URIs inlined into ${inlined.map((f) => path.basename(f)).join(', ')}`);
else pass('flags are separate files, none inlined into JavaScript');

// 5: sizes.
const html = contents.get(path.join(DIST, 'index.html')) ?? '';
const initialNames = new Set([...html.matchAll(/(?:src|href)="\/?(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]));

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const rows = [];
let initialRaw = 0;
let initialGzip = 0;

for (const file of all.filter((f) => /\.(js|css)$/.test(f)).sort()) {
  const buffer = await readFile(file);
  const gzip = gzipSync(buffer, { level: 9 }).length;
  const name = path.relative(DIST, file).replaceAll('\\', '/');
  const initial = initialNames.has(name);
  if (initial) {
    initialRaw += buffer.length;
    initialGzip += gzip;
  }
  rows.push({ name, raw: buffer.length, gzip, initial });
}

const fonts = all.filter((f) => f.endsWith('.woff2'));
const flags = all.filter((f) => f.endsWith('.svg'));
const size = async (list) => (await Promise.all(list.map((f) => stat(f)))).reduce((sum, s) => sum + s.size, 0);

console.log('Production client build checks\n');
for (const line of checks) console.log(line);

console.log('\nJavaScript and CSS');
console.log(`  ${'file'.padEnd(46)} ${'raw'.padStart(10)} ${'gzip'.padStart(10)}  load`);
for (const row of rows) {
  console.log(`  ${row.name.padEnd(46)} ${kb(row.raw).padStart(10)} ${kb(row.gzip).padStart(10)}  ${row.initial ? 'initial' : 'lazy'}`);
}
console.log(`\n  Initial load, JS and CSS: ${kb(initialRaw)} raw, ${kb(initialGzip)} gzip`);
console.log(`  Fonts: ${fonts.length} woff2 files, ${kb(await size(fonts))} on disk, only the weights and subsets in use are fetched`);
console.log(`  Flags: ${flags.length} svg files, ${kb(await size(flags))} on disk, fetched only for countries shown`);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll bundle checks passed.');
