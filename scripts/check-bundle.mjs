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
 *   9. Route split, from the module map the build writes to
 *      dist/client-chunks.json (see chunkMap in vite.config.ts):
 *      a. the boot entry holds no public page and no dashboard module,
 *      b. the public page loads only its own modules and the shared primitives,
 *      c. the dashboard never loads a public page module,
 *      d. the QR encoder is only ever loaded lazily,
 *      e. the Turnstile script is referenced by the public page only.
 *  10. Reports the initial load of the public page and of the dashboard.
 */

const DIST = path.join(ROOT, 'apps/dashboard/dist/client');
const CHUNK_MAP = path.join(ROOT, 'apps/dashboard/dist/client-chunks.json');

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
const DEV_ONLY = [
  'daffa-dev-state-preview',
  'noresults',
  'create-errors',
  'create-ok',
  'create-url',
  'loading-more',
  'menu-blocked',
  'public-delete',
  'block-none',
  'block-covered',
  'blocked-empty',
  'blocked-nomatch',
  'budget-warn',
  'budget-full',
];
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

// 9: route split. The boot entry loads either the public page or the
// dashboard, each a lazy chunk. Chunks a route loads before it renders are
// the static closure of its chunk: its imports, their imports, and so on.
const CLIENT = 'apps/dashboard/src/client/';
const PUBLIC_APP = `${CLIENT}public/PublicApp.tsx`;
const DASHBOARD_APP = `${CLIENT}features/app/DashboardApp.tsx`;

/**
 * Everything the public page may load: its own folder, the boot entry and
 * global styles, the named shared primitives, the shared rules, React, and the
 * bundler runtime (virtual ids start with a NUL byte). Any other client module
 * is dashboard code.
 */
const PUBLIC_ALLOWED = [
  /^\0/,
  /^apps\/dashboard\/index\.html$/,
  new RegExp(`^${CLIENT}(main\\.tsx|boot\\.ts)$`),
  new RegExp(`^${CLIENT}public/`),
  new RegExp(`^${CLIENT}styles/`),
  new RegExp(`^${CLIENT}components/(controls|fields|overlay|tiles|qr)\\.module\\.css$`),
  new RegExp(`^${CLIENT}components/(controls|fields|overlay|tiles|Icons|QrCode)\\.tsx$`),
  new RegExp(`^${CLIENT}lib/(http|qr|useQr|clipboard|toast|countdown|urlPreview|format|focus)\\.ts$`),
  /^shared\/(?!.*\.test\.ts$)/,
  /^node_modules\/(react|react-dom|scheduler|@fontsource\/[^/]+)\//,
];

const pending = (message) => checks.push(`  PENDING  ${message}`);

let chunks = [];
if (!existsSync(CHUNK_MAP)) {
  fail('dist/client-chunks.json is missing. Build with npm run build:dashboard, whose Vite config writes it');
} else {
  chunks = JSON.parse(await readFile(CHUNK_MAP, 'utf8')).chunks;
}
const byFile = new Map(chunks.map((chunk) => [chunk.file, chunk]));
const entry = chunks.find((chunk) => chunk.isEntry);
const publicChunk = chunks.find((chunk) => chunk.facadeModuleId === PUBLIC_APP);
const dashboardChunk = chunks.find((chunk) => chunk.facadeModuleId === DASHBOARD_APP);

/**
 * Chunks reachable from `start` through static imports, and through dynamic
 * imports too when `dynamic` is set. The boot entry's own dynamic imports are
 * the two routes, so they are never followed: reaching the entry from one
 * route must not count as loading the other.
 */
function closure(start, { dynamic = false } = {}) {
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file) || !byFile.has(file)) continue;
    seen.add(file);
    const chunk = byFile.get(file);
    stack.push(...chunk.imports);
    if (dynamic && !chunk.isEntry) stack.push(...chunk.dynamicImports);
  }
  return [...seen].map((file) => byFile.get(file));
}

const modulesIn = (list) => [...new Set(list.flatMap((chunk) => chunk.modules))];
const show = (ids) => ids.map((id) => id.replace(/^\0/, '')).join(', ');

if (chunks.length && (!entry || !publicChunk || !dashboardChunk)) {
  fail('the module map lacks the boot entry, the public page chunk, or the dashboard chunk');
} else if (chunks.length) {
  const entryModules = modulesIn(closure(entry.file));
  const routeInEntry = entryModules.filter((id) => id.startsWith(`${CLIENT}public/`) || id.startsWith(`${CLIENT}features/`));
  if (routeInEntry.length) fail(`9a. the boot entry loads route code: ${show(routeInEntry)}`);
  else pass(`9a. the boot entry holds no public page or dashboard module (${entryModules.length} modules)`);

  const publicModules = modulesIn(closure(publicChunk.file));
  const notAllowed = publicModules.filter((id) => !PUBLIC_ALLOWED.some((rule) => rule.test(id)));
  if (notAllowed.length) fail(`9b. the public page loads modules outside its allowlist: ${show(notAllowed)}`);
  else pass(`9b. the public page loads only its own modules and shared primitives (${publicModules.length} modules)`);

  const dashboardModules = modulesIn(closure(dashboardChunk.file, { dynamic: true }));
  const publicInDashboard = dashboardModules.filter((id) => id.startsWith(`${CLIENT}public/`));
  if (publicInDashboard.length) fail(`9c. the dashboard loads public page modules: ${show(publicInDashboard)}`);
  else pass(`9c. the dashboard, its lazy pages included, loads no public page module (${dashboardModules.length} modules)`);

  const qrChunks = chunks.filter((chunk) => chunk.modules.some((id) => id.startsWith('node_modules/qrcode-generator/')));
  const eager = new Set([entry, publicChunk, dashboardChunk].flatMap((chunk) => closure(chunk.file)).map((c) => c.file));
  const eagerQr = qrChunks.filter((chunk) => eager.has(chunk.file) || !chunk.isDynamicEntry);
  if (!qrChunks.length) fail('9d. qrcode-generator is missing from the build');
  else if (eagerQr.length) fail(`9d. qrcode-generator loads with a route: ${eagerQr.map((c) => c.file).join(', ')}`);
  else pass('9d. qrcode-generator is a lazy chunk, loaded on first QR code only');

  const turnstileFiles = [...contents]
    .filter(([file, text]) => file.endsWith('.js') && text.includes('challenges.cloudflare.com'))
    .map(([file]) => path.relative(DIST, file).replaceAll('\\', '/'));
  const publicFiles = new Set(closure(publicChunk.file).map((chunk) => chunk.file));
  const outside = turnstileFiles.filter((file) => !publicFiles.has(file) || file === entry.file);
  if (outside.length) fail(`9e. the Turnstile script is referenced outside the public page: ${outside.join(', ')}`);
  else if (!turnstileFiles.length) pending('9e. the Turnstile script is not in the build yet, the public page form arrives in F2');
  else pass('9e. the Turnstile script is referenced by the public page chunks only');
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

// 10: what each route loads before it renders, JavaScript and CSS. Fonts
// are left out, the browser fetches only the weights a page uses.
const sizeOf = new Map(rows.map((row) => [row.name, row]));
function routeLoad(chunk) {
  const files = new Set();
  for (const part of closure(chunk.file)) {
    files.add(part.file);
    for (const css of part.css) files.add(css);
  }
  for (const name of initialNames) files.add(name);
  let raw = 0;
  let gzip = 0;
  for (const file of files) {
    raw += sizeOf.get(file)?.raw ?? 0;
    gzip += sizeOf.get(file)?.gzip ?? 0;
  }
  return { raw, gzip, files: files.size };
}
const routeLoads =
  chunks.length && publicChunk && dashboardChunk
    ? { public: routeLoad(publicChunk), dashboard: routeLoad(dashboardChunk) }
    : null;
if (routeLoads) {
  pending(
    `10. public page initial load is ${kb(routeLoads.public.gzip)} gzip, the budget is set in F2 from the full public page`,
  );
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
if (routeLoads) {
  console.log(
    `  Public page initial load, boot entry and public route: ${kb(routeLoads.public.raw)} raw, ${kb(routeLoads.public.gzip)} gzip, ${routeLoads.public.files} files`,
  );
  console.log(
    `  Dashboard initial load, boot entry and dashboard route: ${kb(routeLoads.dashboard.raw)} raw, ${kb(routeLoads.dashboard.gzip)} gzip, ${routeLoads.dashboard.files} files`,
  );
}
console.log(`  Fonts: ${fonts.length} woff2 files, ${kb(await size(fonts))} on disk, only the weights and subsets in use are fetched`);
console.log(`  Flags: ${flags.length} svg files, ${kb(await size(flags))} on disk, fetched only for countries shown`);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll bundle checks passed.');
