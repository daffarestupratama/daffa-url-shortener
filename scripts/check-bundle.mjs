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
 *   6. The favicons are present: favicon.svg, favicon.ico, apple-touch-icon.png.
 *   7. Search engines: robots.txt and sitemap.xml are present, the public page
 *      carries no noindex but a canonical link and Open Graph tags, og.png is a
 *      1200x630 PNG, and _headers marks /dashboard as noindex.
 *   8. Turnstile: no test site key is in the build, and index.html carries a
 *      real production site key, not the placeholder from .env.production.
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

// 6: favicons ship as real files, so /favicon.ico never falls through to index.html.
const FAVICONS = ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png'];
const missingIcons = FAVICONS.filter((name) => !existsSync(path.join(DIST, name)));
if (missingIcons.length) {
  fail(`favicon files missing from dist/client: ${missingIcons.join(', ')}`);
} else {
  const icoBytes = await readFile(path.join(DIST, 'favicon.ico'));
  const touch = await readFile(path.join(DIST, 'apple-touch-icon.png'));
  const isIco = icoBytes.readUInt32LE(0) === 0x00010000;
  const touchSize = `${touch.readUInt32BE(16)}x${touch.readUInt32BE(20)}`;
  if (!isIco) fail('favicon.ico is not an ICO file');
  else if (touchSize !== '180x180') fail(`apple-touch-icon.png is ${touchSize}, expected 180x180`);
  else pass('favicon.svg, favicon.ico and a 180x180 apple-touch-icon.png are present');
}

// 7: search engines and link previews.
const html = contents.get(path.join(DIST, 'index.html')) ?? '';

async function readText(name) {
  const file = path.join(DIST, name);
  return existsSync(file) ? readFile(file, 'utf8') : null;
}

const robots = await readText('robots.txt');
const robotsRules = ['User-agent: *', 'Allow: /', 'Disallow: /dashboard', 'Disallow: /api', 'Sitemap: https://link.daffa.me/sitemap.xml'];
const robotsLines = robots === null ? [] : robots.split(/\r?\n/);
const missingRules = robotsRules.filter((rule) => !robotsLines.includes(rule));
if (missingRules.length) fail(`robots.txt is missing ${missingRules.join(', ')}`);
else pass('robots.txt allows / and disallows /dashboard and /api');

const sitemap = await readText('sitemap.xml');
if (!sitemap?.includes('<loc>https://link.daffa.me/</loc>')) fail('sitemap.xml does not list https://link.daffa.me/');
else pass('sitemap.xml lists https://link.daffa.me/');

// A rule block starts with an unindented path, its headers follow indented.
const headerBlocks = ((await readText('_headers')) ?? '').split(/\r?\n(?=\S)/);
const dashboardNoindex = ['/dashboard', '/dashboard/*'].every((rule) =>
  headerBlocks.some((block) => block.split(/\r?\n/)[0]?.trim() === rule && block.includes('X-Robots-Tag: noindex')),
);
if (!dashboardNoindex) fail('_headers does not send X-Robots-Tag: noindex on /dashboard and /dashboard/*');
else pass('_headers sends X-Robots-Tag: noindex on /dashboard');

const metaProblems = [];
if (/<meta[^>]+name="robots"[^>]+noindex/i.test(html)) metaProblems.push('a noindex meta tag');
if (!html.includes('<link rel="canonical" href="https://link.daffa.me/"')) metaProblems.push('no canonical link');
for (const tag of ['og:title', 'og:description', 'og:url', 'og:image', 'twitter:card']) {
  if (!html.includes(`"${tag}"`)) metaProblems.push(`no ${tag}`);
}
if (metaProblems.length) fail(`index.html has ${metaProblems.join(', ')}`);
else pass('index.html is indexable, with a canonical link and Open Graph tags');

const ogFile = path.join(DIST, 'og.png');
if (!existsSync(ogFile)) {
  fail('og.png is missing from dist/client');
} else {
  const og = await readFile(ogFile);
  const isPng = og.readUInt32BE(0) === 0x89504e47;
  const ogSize = `${og.readUInt32BE(16)}x${og.readUInt32BE(20)}`;
  if (!isPng || ogSize !== '1200x630') fail(`og.png must be a 1200x630 PNG, found ${isPng ? ogSize : 'another format'}`);
  else pass(`og.png is a 1200x630 PNG, ${(og.length / 1024).toFixed(1)} KB`);
}

// 8: Turnstile site keys. The test keys are documented by Cloudflare and
// always pass or always fail, so one in production would disable the check.
const TEST_SITE_KEY = /\b[123]x0{20}[A-F]{2}\b/;
const testKeyHits = [...contents].filter(([, text]) => TEST_SITE_KEY.test(text)).map(([file]) => path.relative(DIST, file));
if (testKeyHits.length) fail(`a Turnstile test site key is in the build: ${testKeyHits.join(', ')}`);
else pass('no Turnstile test site key in the build');

const siteKey = /<meta name="turnstile-site-key" content="([^"]*)"/.exec(html)?.[1];
const ENV_FILE = 'apps/dashboard/.env.production';
if (siteKey === undefined) {
  fail('index.html has no turnstile-site-key meta tag');
} else if (siteKey === '' || siteKey.includes('%VITE_')) {
  fail(`the Turnstile site key is empty. Set VITE_TURNSTILE_SITE_KEY in ${ENV_FILE}`);
} else if (siteKey.includes('REPLACE_WITH')) {
  fail(`the Turnstile site key is still the placeholder. Put the real key in ${ENV_FILE}`);
} else if (!/^0x[A-Za-z0-9_-]{18,}$/.test(siteKey)) {
  fail(`the Turnstile site key "${siteKey}" does not look like a real key. Check ${ENV_FILE}`);
} else {
  pass('a real Turnstile site key is set');
}

// 5: sizes.
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
const flags = all.filter((f) => f.endsWith('.svg') && path.basename(f) !== 'favicon.svg');
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
