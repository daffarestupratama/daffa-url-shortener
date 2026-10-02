/**
 * End to end smoke test for the dashboard API, run against `npm run dev`.
 *
 * Needs apps/dashboard/.dev.vars as in .dev.vars.example (development bypass,
 * the Turnstile test secret that always passes, a rate limit secret) and a
 * migrated, seeded local database. Exercises every owner endpoint under
 * /api/admin, the public endpoint under /api/public, every CSRF case, the
 * path from the redirector to the dashboard through the shared D1 state,
 * every public link page at the redirector, and the daily cron. It also walks
 * both dashboard tabs page by page the way the client does, and checks that
 * every client address serves the single page document. Counters and
 * fixtures are read and set in the local database through wrangler, never the
 * remote one. Prints PASS or FAIL per check, removes every link it creates,
 * restores every counter it changes, and exits 1 on any failure.
 *
 * Turnstile: the test secret accepts the dummy token, and on 2 Oct 2026 it
 * also accepted any other token, so a rejected token cannot be produced here.
 * The rejection paths are covered by the unit tests in routes/public.test.ts.
 *
 *   SMOKE_DASHBOARD  default http://localhost:5173
 *   SMOKE_REDIRECT   default http://127.0.0.1:8787
 */

import { randomInt } from 'node:crypto';
import { importTs } from './bundle.mjs';
import { d1Local } from './d1.mjs';

const DASHBOARD = process.env.SMOKE_DASHBOARD ?? 'http://localhost:5173';
const REDIRECT = process.env.SMOKE_REDIRECT ?? 'http://127.0.0.1:8787';
const ORIGIN = new URL(DASHBOARD).origin;
const DEV_EMAIL = 'developer@localhost';
const PREFIX = 'smoke-';
const RUN = `${PREFIX}${Date.now().toString(36)}`;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const PUBLIC_SLUG = /^[abcdefghijkmnpqrstuvwxyz23456789]{6}$/;

let passed = 0;
let failed = 0;
const created = new Set();
/** Public links created by this run, removed through the moderation route. */
const createdPublic = new Set();

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
  return ok;
}

function section(title) {
  console.log(`\n${title}`);
}

const MUTATING = ['POST', 'PATCH', 'DELETE'];

/**
 * Calls the API. Mutations send the dashboard Origin and a JSON content type
 * unless the caller overrides them, which is how the CSRF cases are built.
 */
async function api(method, path, { body, raw, origin, contentType } = {}) {
  const headers = {};
  const mutating = MUTATING.includes(method);
  const sendOrigin = origin === undefined ? (mutating ? ORIGIN : null) : origin;
  const sendType = contentType === undefined ? (mutating ? 'application/json' : null) : contentType;
  if (sendOrigin !== null) headers.Origin = sendOrigin;
  if (sendType !== null) headers['Content-Type'] = sendType;

  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  const response = await fetch(`${DASHBOARD}${path}`, { method, headers, body: payload });
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, json, headers: response.headers };
}

const errorCode = (result) => result.json?.error?.code;

async function createLink(body) {
  const result = await api('POST', '/api/admin/links', { body });
  if (result.status === 201 && result.json?.link?.id) created.add(result.json.link.id);
  return result;
}

/**
 * Every row of a listing, following nextCursor page by page. `pages` holds the
 * size of each page, `counts` the counts of the first page.
 */
async function listAll(query = '') {
  const links = [];
  const pages = [];
  let counts = null;
  let status = 200;
  let cursor = null;
  for (let guard = 0; guard < 100; guard += 1) {
    const separator = query ? '&' : '';
    const path = `/api/admin/links?${query}${cursor ? `${separator}cursor=${cursor}` : ''}`;
    const result = await api('GET', path);
    status = result.status;
    if (result.status !== 200) break;
    counts ??= result.json.counts;
    links.push(...result.json.links);
    pages.push(result.json.links.length);
    cursor = result.json.nextCursor;
    if (!cursor) break;
  }
  return { status, links, pages, counts };
}

/** Strictly ordered on (key, id), both in `direction`, so no two rows tie. */
function inOrder(list, key, direction) {
  const sign = direction === 'asc' ? 1 : -1;
  return list.every((row, index) => {
    if (index === 0) return true;
    const prev = list[index - 1];
    const step = (key(row) - key(prev)) * sign;
    return step > 0 || (step === 0 && (row.id - prev.id) * sign > 0);
  });
}

/** POST /api/public/links the way the public page sends it. */
async function publicCreate(body, options = {}) {
  const result = await api('POST', '/api/public/links', { body, ...options });
  if (result.status === 201 && result.json?.slug) {
    const id = await publicIdOf(result.json.slug);
    if (id) createdPublic.add(id);
  }
  return result;
}

async function publicIdOf(slug) {
  const { links } = await listAll(`visibility=public&q=${slug}`);
  return links.find((link) => link.slug === slug)?.id ?? null;
}

async function deletePublic(id) {
  const result = await api('DELETE', `/api/admin/public-links/${id}`);
  if (result.status === 204) createdPublic.delete(id);
  return result;
}

const currentHour = () => Math.floor(Date.now() / HOUR) * HOUR;

/** Every rate limit row of the current and the previous hour, for restoring later. */
async function snapshotRateLimits() {
  const since = currentHour() - HOUR;
  return { since, rows: await rows(`SELECT window_start, bucket, count FROM rate_limits WHERE window_start >= ${since};`) };
}

async function restoreRateLimits(snapshot) {
  const statements = [`DELETE FROM rate_limits WHERE window_start >= ${snapshot.since};`];
  for (const row of snapshot.rows) {
    statements.push(
      `INSERT INTO rate_limits (window_start, bucket, count) VALUES (${row.window_start}, '${row.bucket}', ${row.count}) ON CONFLICT (window_start, bucket) DO UPDATE SET count = ${row.count};`,
    );
  }
  await d1Local(statements.join('\n'));
}

/** Empties the current hour, so a group of creations starts from zero. */
async function resetRateWindow() {
  await d1Local(`DELETE FROM rate_limits WHERE window_start = ${currentHour()};`);
}

async function rateCounts() {
  const list = await rows(`SELECT bucket, count FROM rate_limits WHERE window_start = ${currentHour()} ORDER BY bucket;`);
  return {
    global: list.find((row) => row.bucket === 'global')?.count ?? 0,
    visitors: list.filter((row) => row.bucket !== 'global'),
  };
}

/** The hourly windows are clock hours. A run in the last minute of one waits for the next. */
async function awayFromHourEdge() {
  const left = HOUR - (Date.now() % HOUR);
  if (left < 90_000) {
    console.log(`  (waiting ${Math.ceil(left / 1000)} seconds for the next clock hour)`);
    await sleep(left + 2000);
  }
}

async function redirectStatus(slug) {
  const response = await fetch(`${REDIRECT}/${slug}`, { redirect: 'manual' });
  return { status: response.status, location: response.headers.get('location') };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log(`Dashboard API smoke test\n  dashboard ${DASHBOARD}\n  redirector ${REDIRECT}`);

  // Precheck ---------------------------------------------------------------
  section('Precheck');
  let me;
  try {
    me = await api('GET', '/api/admin/me');
  } catch (error) {
    console.error(`\nThe dashboard is not reachable at ${DASHBOARD}. Start it with \`npm run dev\`.`);
    console.error(String(error));
    process.exit(1);
  }
  if (!check('GET /api/admin/me returns the dev identity', me.status === 200 && me.json?.email === DEV_EMAIL, `status ${me.status}, ${JSON.stringify(me.json)}`)) {
    console.error('\nSet DEV_AUTH_BYPASS=true in apps/dashboard/.dev.vars and restart `npm run dev`.');
    process.exit(1);
  }

  // Remove links left behind by a run that crashed before its cleanup.
  const leftovers = await listAll(`q=${PREFIX}`);
  for (const link of leftovers.links) {
    if (link.slug.startsWith(PREFIX)) await api('DELETE', `/api/admin/links/${link.id}`);
  }
  // Smoke public links have random slugs, but every destination names the run.
  await d1Local(
    `DELETE FROM links WHERE slug LIKE '${PREFIX}%' OR (is_public = 1 AND url LIKE '%${PREFIX}%');` +
      `DELETE FROM blocked_domains WHERE host LIKE '%${PREFIX}%';` +
      `DELETE FROM rate_limits WHERE bucket LIKE '${PREFIX}%';`,
  );
  check('leftover smoke links cleared', leftovers.status === 200);

  const unknown = await api('GET', '/api/admin/nope');
  check('unknown API path is a JSON 404', unknown.status === 404 && errorCode(unknown) === 'not_found');
  for (const path of ['/api/me', '/api/links', '/api/summary']) {
    const old = await api('GET', path);
    check(`the old owner path ${path} is gone with a 404`, old.status === 404 && errorCode(old) === 'not_found', `status ${old.status}`);
  }
  const headers = (await api('GET', '/api/admin/me')).headers;
  check('API answers are no-store and noindex', headers.get('cache-control') === 'no-store' && headers.get('x-robots-tag') === 'noindex');

  // Reads ------------------------------------------------------------------
  section('Summary, tags, list');
  const summary = await api('GET', '/api/admin/summary');
  const s = summary.json ?? {};
  check(
    'GET /api/admin/summary has integer counts and a 7 day window',
    summary.status === 200 &&
      [s.total, s.active, s.human7d, s.unique7d].every(Number.isInteger) &&
      s.active <= s.total &&
      s.unique7d <= s.human7d &&
      s.windowEnd - s.windowStart > 6 * DAY &&
      s.windowEnd - s.windowStart <= 7 * DAY,
    JSON.stringify(s),
  );
  check('summary names the most clicked link', s.top === null || typeof s.top?.slug === 'string');
  const [budgetRow] = await rows(`SELECT clicks FROM public_click_budget WHERE day = ${utcToday()};`);
  check(
    'summary reports public clicks today from the daily budget row, against 20000',
    s.publicClicksToday === (budgetRow?.clicks ?? 0) && s.publicDailyBudget === 20000,
    `${s.publicClicksToday} vs ${budgetRow?.clicks}`,
  );

  const tags = await api('GET', '/api/admin/tags');
  const tagList = tags.json?.tags ?? [];
  check(
    'GET /api/admin/tags is sorted and includes career',
    tags.status === 200 && tagList.includes('career') && tagList.join() === [...tagList].sort().join(),
  );

  const all = await listAll();
  const links = all.links;
  const bySlug = new Map(links.map((link) => [link.slug, link]));
  check(
    'GET /api/admin/links lists every private link, and the count agrees',
    all.status === 200 && all.counts.private.total === links.length && links.length >= 10 && all.pages[0] <= 25,
    `${links.length} links, counts ${JSON.stringify(all.counts)}`,
  );
  check('summary counts private links only', s.total === all.counts.private.total, `${s.total} vs ${all.counts.private.total}`);
  check('summary counts every public link', s.publicTotal === all.counts.public.total, `${s.publicTotal} vs ${all.counts.public.total}`);
  check('list items carry tags, status and clicks7d', links.every((l) => Array.isArray(l.tags) && typeof l.status === 'string' && Number.isInteger(l.clicks7d)));

  const kaggle = await api('GET', '/api/admin/links?q=KAGGLE');
  check('q search is case insensitive', kaggle.json?.links?.some((l) => l.slug === 'kaggle'));
  // LIKE wildcards must match literally. Unescaped, "%" or "_" would match every
  // link. The expected set is computed here from the full list by plain substring.
  for (const char of ['%', '_']) {
    const result = await api('GET', `/api/admin/links?q=${encodeURIComponent(char)}`);
    const expected = links
      .filter((l) => [l.slug, l.title.toLowerCase(), l.url.toLowerCase()].some((v) => v.includes(char)))
      .map((l) => l.slug)
      .sort();
    const actual = (result.json?.links ?? []).map((l) => l.slug).sort();
    check(
      `q treats ${char} literally`,
      result.status === 200 && actual.join() === expected.join() && actual.length < links.length,
      `got [${actual}] expected [${expected}]`,
    );
  }

  const career = await api('GET', '/api/admin/links?tag=career');
  check('tag filter keeps only tagged links', career.json?.links?.length > 0 && career.json.links.every((l) => l.tags.includes('career')));

  for (const status of ['active', 'inactive', 'expired']) {
    const filtered = await api('GET', `/api/admin/links?status=${status}`);
    const items = filtered.json?.links ?? [];
    check(`status=${status} returns only ${status} links`, filtered.status === 200 && items.length > 0 && items.every((l) => l.status === status));
  }

  const byClicks = (await listAll('sort=clicks')).links;
  check(
    'sort=clicks orders by 7 day clicks, highest first, ties by id descending',
    byClicks.length === links.length && inOrder(byClicks, (l) => l.clicks7d, 'desc'),
  );

  const byOldest = (await listAll('sort=oldest')).links;
  check(
    'sort=oldest orders by creation date, oldest first, ties by id ascending',
    byOldest.length === links.length && inOrder(byOldest, (l) => l.createdAt, 'asc'),
  );

  const byLeast = (await listAll('sort=least')).links;
  check(
    'sort=least orders by 7 day clicks, lowest first, ties by id ascending',
    byLeast.length === links.length && inOrder(byLeast, (l) => l.clicks7d, 'asc'),
  );
  check('the default order is newest first, ties by id descending', inOrder(links, (l) => l.createdAt, 'desc'));

  const badStatus = await api('GET', '/api/admin/links?status=aktif');
  check('an unknown status is a 400', badStatus.status === 400 && errorCode(badStatus) === 'bad_request');
  const badSort = await api('GET', '/api/admin/links?sort=popular');
  check('an unknown sort is a 400', badSort.status === 400 && errorCode(badSort) === 'bad_request');

  // Create -----------------------------------------------------------------
  section('Create');
  const slugA = `${RUN}-a`;
  const createA = await createLink({
    url: 'https://example.com/smoke',
    slug: slugA,
    title: 'Smoke test link',
    tags: ['Smoke Test', '#smoke', 'smoke'],
  });
  const linkA = createA.json?.link;
  check('POST /api/admin/links creates a link with 201', createA.status === 201 && linkA?.slug === slugA, `status ${createA.status}, ${JSON.stringify(createA.json)}`);
  check('create sets Location to the new link', createA.headers.get('location') === `/api/admin/links/${linkA?.id}`);
  check('create normalizes, dedupes and sorts tags', JSON.stringify(linkA?.tags) === JSON.stringify(['smoke', 'smoke-test']), JSON.stringify(linkA?.tags));
  check('a new link is active with no expiry', linkA?.status === 'active' && linkA?.isActive === true && linkA?.expiresAt === null);

  const slugB = `${RUN}-b`;
  const createB = await createLink({
    url: 'https://www.github.com/daffarestupratama',
    slug: slugB,
    title: '',
    expiresAt: Date.now() - DAY,
  });
  const linkB = createB.json?.link;
  check('an empty title falls back to the host', createB.status === 201 && linkB?.title === 'github.com', linkB?.title);
  check('an expiry in the past is accepted and reads as expired', linkB?.status === 'expired');

  // A destination typed without a scheme gains https://, and is stored that way.
  const slugC = `${RUN}-c`;
  const createC = await createLink({ url: `  example.com/${RUN} `, slug: slugC });
  const linkC = createC.json?.link;
  check('a URL without a scheme is stored with https://', createC.status === 201 && linkC?.url === `https://example.com/${RUN}`, linkC?.url);
  const bareRedirect = await redirectStatus(slugC).catch(() => null);
  check('the redirector sends that link to the normalized URL', bareRedirect?.location === `https://example.com/${RUN}`, bareRedirect?.location);
  const patchedBare = await api('PATCH', `/api/admin/links/${linkC?.id}`, { body: { url: 'WWW.example.org/patched' } });
  check('PATCH with a bare URL stores it normalized', patchedBare.json?.link?.url === 'https://WWW.example.org/patched', patchedBare.json?.link?.url);
  const script = await createLink({ url: 'javascript:alert(1)', slug: `${RUN}-x` });
  check(
    'a javascript: destination is refused with the new format message',
    script.status === 400 &&
      errorCode(script) === 'invalid_url' &&
      script.json.error.message === 'Invalid URL format. Enter a web address such as example.com or https://example.com/page.',
    script.json?.error?.message,
  );

  const cases = [
    ['an invalid URL is rejected', { url: 'not a url', slug: `${RUN}-x` }, 400, 'invalid_url'],
    ['a daffa.me destination is rejected as a loop', { url: 'https://daffa.me/x', slug: `${RUN}-x` }, 400, 'invalid_url'],
    ['a reserved slug is rejected', { url: 'https://example.com', slug: 'admin' }, 400, 'invalid_slug'],
    ['a missing slug is rejected', { url: 'https://example.com' }, 400, 'invalid_slug'],
    ['an unknown field is rejected', { url: 'https://example.com', slug: `${RUN}-x`, color: 'red' }, 400, 'invalid_field'],
  ];
  for (const [name, body, status, code] of cases) {
    const result = await createLink(body);
    check(name, result.status === status && errorCode(result) === code, `status ${result.status}, ${errorCode(result)}`);
  }

  const loop = await createLink({ url: 'https://daffa.me/x', slug: `${RUN}-x` });
  check('the loop message explains the redirect loop', /redirect loop/.test(loop.json?.error?.message ?? ''));
  const reserved = await createLink({ url: 'https://example.com', slug: 'admin' });
  check('the reserved message names the word', reserved.json?.error?.message === '"admin" is a reserved word and cannot be used.');

  const taken = await createLink({ url: 'https://example.com', slug: 'cv' });
  check(
    'a taken slug is a 409 naming the owner',
    taken.status === 409 && errorCode(taken) === 'slug_taken' && taken.json.error.message === 'This slug is already used by "CV and LinkedIn profile".',
    JSON.stringify(taken.json),
  );

  const malformed = await api('POST', '/api/admin/links', { raw: '{"url":' });
  check('malformed JSON is a 400 invalid_json', malformed.status === 400 && errorCode(malformed) === 'invalid_json');

  const huge = await api('POST', '/api/admin/links', {
    raw: JSON.stringify({ url: 'https://example.com', slug: `${RUN}-x`, description: 'x'.repeat(17_000) }),
  });
  check('a body over 16 KB is a 413', huge.status === 413 && errorCode(huge) === 'payload_too_large', `status ${huge.status}`);

  // Detail -----------------------------------------------------------------
  section('Detail');
  const detail = await api('GET', `/api/admin/links/${linkA?.id}`);
  check('GET /api/admin/links/:id returns the link and totals', detail.status === 200 && detail.json?.link?.slug === slugA && detail.json?.totals?.human === 0);
  for (const raw of ['abc', '0', '-1', '1.5', '01']) {
    const bad = await api('GET', `/api/admin/links/${raw}`);
    check(`id "${raw}" is a 400 invalid_id`, bad.status === 400 && errorCode(bad) === 'invalid_id', `status ${bad.status}`);
  }
  const missing = await api('GET', '/api/admin/links/999999');
  check('an unknown id is a 404', missing.status === 404 && errorCode(missing) === 'not_found');

  // Edit -------------------------------------------------------------------
  section('Edit');
  const future = Date.now() + 30 * DAY;
  const edited = await api('PATCH', `/api/admin/links/${linkA?.id}`, {
    body: { title: 'Smoke renamed', tags: ['edited'], expiresAt: future },
  });
  check(
    'PATCH updates title, tags and expiry',
    edited.status === 200 &&
      edited.json?.link?.title === 'Smoke renamed' &&
      JSON.stringify(edited.json.link.tags) === '["edited"]' &&
      edited.json.link.expiresAt === future,
    JSON.stringify(edited.json),
  );
  const cleared = await api('PATCH', `/api/admin/links/${linkA?.id}`, { body: { title: '' } });
  check('clearing the title falls back to the host', cleared.json?.link?.title === 'example.com', cleared.json?.link?.title);
  const stolen = await api('PATCH', `/api/admin/links/${linkA?.id}`, { body: { slug: 'cv' } });
  check('PATCH to a taken slug is a 409', stolen.status === 409 && errorCode(stolen) === 'slug_taken');
  const empty = await api('PATCH', `/api/admin/links/${linkA?.id}`, { body: {} });
  check('an empty PATCH is a 400', empty.status === 400 && errorCode(empty) === 'invalid_field');
  const tagsAfter = await api('GET', '/api/admin/tags');
  check('tags replaced by an edit leave the tag list', !tagsAfter.json?.tags?.includes('smoke-test') && tagsAfter.json?.tags?.includes('edited'));

  // Toggle -----------------------------------------------------------------
  section('Toggle');
  const off = await api('POST', `/api/admin/links/${linkA?.id}/toggle`);
  check('toggle turns an active link inactive', off.status === 200 && off.json?.link?.status === 'inactive');
  const on = await api('POST', `/api/admin/links/${linkA?.id}/toggle`);
  check('toggle turns it active again', on.json?.link?.status === 'active' && on.json.link.expiresAt === future);
  const revived = await api('POST', `/api/admin/links/${linkB?.id}/toggle`);
  check('toggle reactivates an expired link and clears its expiry', revived.json?.link?.status === 'active' && revived.json.link.expiresAt === null, JSON.stringify(revived.json?.link));

  // Slug availability --------------------------------------------------------
  section('Slug availability');
  const free = await api('GET', `/api/admin/slugs/${RUN}-free/available`);
  check('a free slug is available', free.json?.available === true);
  const cv = await api('GET', '/api/admin/slugs/cv/available');
  check('a taken slug is unavailable and names the owner', cv.json?.available === false && cv.json.code === 'slug_taken' && /CV and LinkedIn profile/.test(cv.json.message));
  const admin = await api('GET', '/api/admin/slugs/admin/available');
  check('a reserved slug is unavailable', admin.json?.available === false && admin.json.code === 'invalid_slug' && /reserved/.test(admin.json.message));
  const upper = await api('GET', '/api/admin/slugs/Upper/available');
  check('an invalid slug is unavailable', upper.json?.available === false && upper.json.code === 'invalid_slug');
  const own = await api('GET', `/api/admin/slugs/${slugA}/available?exclude=${linkA?.id}`);
  check('a link\'s own slug is available while editing it', own.json?.available === true);
  const ownNoExclude = await api('GET', `/api/admin/slugs/${slugA}/available`);
  check('the same slug is taken without exclude', ownNoExclude.json?.available === false);

  // Analytics ----------------------------------------------------------------
  section('Analytics');
  const cvLink = bySlug.get('cv');
  const jadwal = bySlug.get('jadwal');
  const lengths = { '24h': 24, '7d': 7, '30d': 30, '90d': 90 };
  for (const range of ['24h', '7d', '30d', '90d', 'all']) {
    const result = await api('GET', `/api/admin/links/${cvLink?.id}/analytics?range=${range}`);
    const a = result.json ?? {};
    const series = a.series ?? [];
    const expected = lengths[range];
    check(
      `cv ${range}: ${expected ?? 'one per month'} buckets`,
      result.status === 200 && (expected ? series.length === expected : series.length >= 1),
      `status ${result.status}, ${series.length} buckets`,
    );
    const sum = (key) => series.reduce((total, point) => total + point[key], 0);
    check(
      `cv ${range}: series adds up to the totals`,
      sum('human') === a.totals?.human && sum('bot') === a.totals?.bot,
      `human ${sum('human')} vs ${a.totals?.human}, bot ${sum('bot')} vs ${a.totals?.bot}`,
    );
  }
  const cv30 = (await api('GET', `/api/admin/links/${cvLink?.id}/analytics?range=30d`)).json ?? {};
  check('cv 30d has rankings from human clicks', cv30.countries?.length > 0 && cv30.colos?.length > 0 && cv30.asns?.length > 0 && cv30.referrers?.length > 0);
  check('cv 30d returns raw user agents for the browser to parse', cv30.userAgents?.human?.length > 0 && cv30.userAgents?.bot?.length > 0);
  check('cv unique visitors never exceed human clicks', cv30.totals?.unique <= cv30.totals?.human);
  check('cv has a last human click time', Number.isInteger(cv30.allTime?.lastHumanAt));

  for (const range of ['24h', '7d', '30d', '90d', 'all']) {
    const result = await api('GET', `/api/admin/links/${jadwal?.id}/analytics?range=${range}`);
    const a = result.json ?? {};
    const zero = (a.series ?? []).every((p) => p.human === 0 && p.bot === 0 && p.unique === 0);
    check(
      `jadwal ${range}: zero clicks is a 200 with zeros`,
      result.status === 200 &&
        a.totals?.human === 0 &&
        a.totals?.bot === 0 &&
        a.allTime?.human === 0 &&
        a.allTime?.lastHumanAt === null &&
        zero &&
        (lengths[range] ? a.series.length === lengths[range] : a.series.length >= 1),
      `status ${result.status}`,
    );
  }
  const badRange = await api('GET', `/api/admin/links/${cvLink?.id}/analytics?range=7h`);
  check('a prototype range key is a 400', badRange.status === 400);
  const missingAnalytics = await api('GET', '/api/admin/links/999999/analytics');
  check('analytics for an unknown link is a 404', missingAnalytics.status === 404);

  // Click log ----------------------------------------------------------------
  section('Click log');
  const first = await api('GET', `/api/admin/links/${cvLink?.id}/clicks?range=all&page=0`);
  const log = first.json ?? {};
  const times = (log.rows ?? []).map((row) => row.ts);
  check('page 0 has ten rows, newest first', first.status === 200 && log.rows?.length === 10 && times.every((t, i) => i === 0 || times[i - 1] >= t));
  const cvAll = (await api('GET', `/api/admin/links/${cvLink?.id}/analytics?range=all`)).json ?? {};
  check('the log total matches the analytics totals', log.total === cvAll.totals?.human + cvAll.totals?.bot, `${log.total} vs ${cvAll.totals?.human + cvAll.totals?.bot}`);
  const lastPage = Math.ceil(log.total / 10) - 1;
  const last = await api('GET', `/api/admin/links/${cvLink?.id}/clicks?range=all&page=${lastPage}`);
  check('the last page holds the remainder', last.json?.rows?.length === log.total - lastPage * 10);
  const beyond = await api('GET', `/api/admin/links/${cvLink?.id}/clicks?range=all&page=${lastPage + 1}`);
  check('a page past the end is empty with the same total', beyond.status === 200 && beyond.json?.rows?.length === 0 && beyond.json.total === log.total);
  const negative = await api('GET', `/api/admin/links/${cvLink?.id}/clicks?page=-1`);
  check('a negative page is a 400', negative.status === 400 && errorCode(negative) === 'bad_request');
  const textPage = await api('GET', `/api/admin/links/${cvLink?.id}/clicks?page=abc`);
  check('a text page is a 400', textPage.status === 400);
  const row = log.rows?.[0] ?? {};
  check('log rows carry the raw user agent and network fields', typeof row.ua === 'string' && typeof row.isBot === 'boolean' && 'colo' in row && 'asn' in row && 'asOrg' in row);

  // CSRF ---------------------------------------------------------------------
  section('CSRF');
  const csrfCases = [
    ['foreign origin', { origin: 'https://evil.example' }],
    ['missing origin', { origin: null }],
    ['text/plain', { contentType: 'text/plain' }],
  ];
  for (const [label, overrides] of csrfCases) {
    const post = await api('POST', '/api/admin/links', { body: { url: 'https://example.com', slug: `${RUN}-csrf` }, ...overrides });
    check(`POST with ${label} is a 403`, post.status === 403 && errorCode(post) === 'csrf_rejected', `status ${post.status}`);
    const patch = await api('PATCH', `/api/admin/links/${linkA?.id}`, { body: { title: 'hijacked' }, ...overrides });
    check(`PATCH with ${label} is a 403`, patch.status === 403 && errorCode(patch) === 'csrf_rejected', `status ${patch.status}`);
    const del = await api('DELETE', `/api/admin/links/${linkA?.id}`, overrides);
    check(`DELETE with ${label} is a 403`, del.status === 403 && errorCode(del) === 'csrf_rejected', `status ${del.status}`);
  }
  const survivor = await api('GET', `/api/admin/links/${linkA?.id}`);
  check('the link survived every rejected request unchanged', survivor.status === 200 && survivor.json.link.title === 'example.com');
  const csrfSlug = await api('GET', `/api/admin/slugs/${RUN}-csrf/available`);
  check('no link was created by a rejected POST', csrfSlug.json?.available === true);
  const getWithEvil = await api('GET', '/api/admin/links', { origin: 'https://evil.example' });
  check('GET is not affected by a foreign origin', getWithEvil.status === 200);

  // Redirector and dashboard share one database ------------------------------
  section('Redirector to dashboard, shared D1 state');
  let redirect;
  try {
    redirect = await redirectStatus(slugA);
  } catch (error) {
    check('redirector reachable', false, `${REDIRECT} is not responding. Start it with npm run dev.`);
  }
  if (redirect) {
    check('a link created in the dashboard redirects', redirect.status === 302 && redirect.location === 'https://example.com/smoke', `status ${redirect.status}`);
    let total = 0;
    for (let attempt = 0; attempt < 25 && total < 1; attempt += 1) {
      await sleep(200);
      total = (await api('GET', `/api/admin/links/${linkA?.id}/clicks?range=all`)).json?.total ?? 0;
    }
    check('the click logged by the redirector shows in the dashboard', total >= 1, `total ${total} after 5 seconds`);

    await api('POST', `/api/admin/links/${linkA?.id}/toggle`);
    const gone = await redirectStatus(slugA);
    check('a link deactivated in the dashboard is a 410 at the redirector', gone.status === 410, `status ${gone.status}`);
  }

  // Delete -------------------------------------------------------------------
  section('Delete');
  const removed = await api('DELETE', `/api/admin/links/${linkA?.id}`);
  check('DELETE removes the link with 204', removed.status === 204);
  if (removed.status === 204) created.delete(linkA?.id);
  const after = await api('GET', `/api/admin/links/${linkA?.id}`);
  check('the deleted link is a 404 in the dashboard', after.status === 404);
  const again = await api('DELETE', `/api/admin/links/${linkA?.id}`);
  check('deleting twice is a 404', again.status === 404);
  if (redirect) {
    const redirectAfter = await redirectStatus(slugA);
    check('the deleted slug is a 404 at the redirector', redirectAfter.status === 404, `status ${redirectAfter.status}`);
    await publicLinks();
  }

  await pagination();
  await tabs();
  await clientContract();
  await clientPublicContract();

  // Public creation spends the hourly counters. They are restored afterwards,
  // whatever happens, so the run leaves the local limits as it found them.
  const snapshot = await snapshotRateLimits();
  try {
    await publicCreation();
    await moderation(cvLink?.id);
    await blockedDomains();
  } finally {
    await restoreRateLimits(snapshot);
  }

  await cron();
  await staticFiles();
  await clientRoutes();
}

/**
 * The requests the dashboard client makes, in the order it makes them: the
 * first page of a tab without any parameter but the tab, then nextCursor
 * until it runs out. The public tab gets 30 extra rows here, so the walk
 * crosses a page boundary on every sort, as infinite scroll does.
 */
async function clientContract() {
  section('Client contract, dashboard lists');
  const first = await api('GET', '/api/admin/links');
  const body = first.json ?? {};
  check(
    'the plain first page is the private tab, with a cursor field and the counts of both tabs',
    first.status === 200 &&
      body.visibility === 'private' &&
      'nextCursor' in body &&
      ['private', 'public'].every((tab) => Number.isInteger(body.counts?.[tab]?.matching) && Number.isInteger(body.counts?.[tab]?.total)),
    JSON.stringify(body.counts),
  );

  const stem = `${RUN}-pub`;
  const base = Date.now() - 300 * DAY;
  const day = utcToday();
  const values = Array.from({ length: 30 }, (_, i) => {
    const slug = `${stem}${String(i).padStart(2, '0')}`;
    // Pairs of equal totals and creation times, so ties on the sort key are broken by id.
    const createdAt = base + Math.floor(i / 2) * 1000;
    return `('${slug}', 'https://example.com/${slug}', 'example.com', '', 1, NULL, ${createdAt}, ${createdAt}, 1, ${(i % 15) * 10}, ${day}, ${i % 3})`;
  });
  await d1Local(
    'INSERT INTO links (slug, url, title, description, is_active, expires_at, created_at, updated_at, is_public, click_total, click_day, click_today) VALUES ' +
      `${values.join(',\n')};`,
  );
  try {
    const orders = [
      ['newest', (l) => l.createdAt, 'desc'],
      ['oldest', (l) => l.createdAt, 'asc'],
      ['clicks', (l) => l.clickTotal, 'desc'],
      ['least', (l) => l.clickTotal, 'asc'],
    ];
    for (const [sort, key, direction] of orders) {
      const walk = await listAll(`visibility=public&q=${stem}&sort=${sort}`);
      const ids = walk.links.map((l) => l.id);
      check(`public sort=${sort}: 30 links come in pages of 25 and 5`, walk.pages.join() === '25,5', walk.pages.join());
      check(
        `public sort=${sort}: no link twice, and the rows loaded equal counts.public.matching`,
        new Set(ids).size === ids.length && ids.length === walk.counts?.public?.matching,
        `${ids.length} rows, matching ${walk.counts?.public?.matching}`,
      );
      check(`public sort=${sort}: ordered on the sort key, then id`, inOrder(walk.links, key, direction));
    }
    const tagged = await listAll(`visibility=public&q=${stem}&tag=career`);
    check('a tag sent with the public tab changes nothing on it', tagged.links.length === 30 && tagged.counts?.public?.matching === 30);
  } finally {
    await d1Local(`DELETE FROM links WHERE slug LIKE '${stem}%';`);
  }
}

/**
 * link.daffa.me serves one index.html for every path, and the client decides
 * what to show. Each address the client knows must come back as that document.
 */
async function clientRoutes() {
  section('Client routes');
  const paths = ['/', '/dashboard', '/dashboard/', '/dashboard/links/1', '/links/1', '/some/unknown'];
  for (const path of paths) {
    const response = await fetch(`${DASHBOARD}${path}`, { headers: { Accept: 'text/html' } });
    const html = await response.text();
    check(
      `${path} serves the single page document`,
      response.status === 200 &&
        (response.headers.get('content-type') ?? '').includes('text/html') &&
        html.includes('<div id="root">') &&
        html.includes('<title>daffa.me · Free short links with QR code</title>'),
      `status ${response.status}`,
    );
  }
  const root = await fetch(`${DASHBOARD}/`, { headers: { Accept: 'text/html' } }).then((r) => r.text());
  check(
    'the document carries the development Turnstile site key',
    root.includes('<meta name="turnstile-site-key" content="1x00000000000000000000AA" />'),
  );
}

/** 00:00 UTC of today, the day public click counters belong to. */
const utcToday = () => Math.floor(Date.now() / DAY) * DAY;

/** Rows of the last statement in `sql`, read from the local database. */
async function rows(sql) {
  const results = await d1Local(sql);
  return results[results.length - 1]?.results ?? [];
}

async function counters(slug) {
  const [row] = await rows(
    `SELECT l.id, l.click_total, l.click_today, l.click_day, (SELECT COUNT(*) FROM clicks c WHERE c.link_id = l.id) AS logged, (SELECT clicks FROM public_click_budget WHERE day = ${utcToday()}) AS budget FROM links l WHERE l.slug = '${slug}'`,
  );
  return row;
}

/** Counters are written in waitUntil, so a read may need a moment to see them. */
async function countersAfter(slug, ready) {
  let row;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await sleep(attempt === 0 ? 300 : 1000);
    row = await counters(slug);
    if (row && ready(row)) break;
  }
  return row;
}

async function visit(slug, method = 'GET') {
  const response = await fetch(`${REDIRECT}/${slug}`, { method, redirect: 'manual' });
  return { status: response.status, headers: response.headers, body: await response.text() };
}

const noStore = (result) => result.headers.get('cache-control') === 'no-store, private';

/** Retry-After must point at the next 00:00 UTC, within a two second margin. */
function retryAfterOk(result) {
  const expected = Math.ceil((utcToday() + DAY - Date.now()) / 1000);
  return Math.abs(Number(result.headers.get('retry-after')) - expected) <= 2;
}

/**
 * Public links at the redirector. The seed provides the links, and the states
 * each check needs are set straight in the local database first, so the run is
 * repeatable. Every value changed here is restored at the end.
 */
async function publicLinks() {
  section('Public links at the redirector');
  const day = utcToday();
  let saved;
  try {
    const [links, budget] = await d1Local(
      `SELECT slug, click_total, click_today, click_day FROM links WHERE slug IN ('x7kq2m', 'ze3k9r');` +
        `SELECT clicks FROM public_click_budget WHERE day = ${day};`,
    );
    saved = { links: links.results, budget: budget.results[0]?.clicks ?? null };
  } catch (error) {
    check('local database reachable through wrangler', false, String(error.message ?? error).split('\n')[0]);
    return;
  }
  if (!check('seeded public links present', saved.links.length === 2, 'run npm run seed:local')) return;

  try {
    // Start every run from the same place: x7kq2m well under its limit,
    // ze3k9r one click short of it, and the shared budget far from used.
    await d1Local(
      `UPDATE links SET click_today = 41, click_day = ${day} WHERE slug = 'x7kq2m';` +
        `UPDATE links SET click_today = 499, click_day = ${day} WHERE slug = 'ze3k9r';` +
        `INSERT INTO public_click_budget (day, clicks) VALUES (${day}, 1000) ON CONFLICT (day) DO UPDATE SET clicks = 1000;`,
    );

    const cvBefore = await counters('cv');
    const cv = await visit('cv');
    check('a private link still redirects with 302 and no-store', cv.status === 302 && noStore(cv) && cv.headers.get('location') === 'https://www.linkedin.com/in/daffarestupratama', `status ${cv.status}`);
    const cvAfter = await countersAfter('cv', (row) => row.logged > cvBefore.logged);
    check('a private link visit still writes a clicks row', cvAfter.logged === cvBefore.logged + 1, `${cvBefore.logged} then ${cvAfter.logged}`);
    check('a private link visit leaves the public budget alone', cvAfter.budget === cvBefore.budget);

    const before = await counters('x7kq2m');
    const notice = await visit('x7kq2m?ref=abc');
    const href = 'href="https://docs.google.com/forms/d/e/1FAIpQLSd3kR9vQx/viewform"';
    check('a public link serves the notice with 200', notice.status === 200 && notice.headers.get('content-type')?.startsWith('text/html') && noStore(notice), `status ${notice.status}`);
    check('the notice names the destination and links straight to it', notice.body.includes('EXTERNAL LINK') && notice.body.includes(href) && notice.body.includes('<strong>docs.google.com</strong>'));
    check('the incoming query string is ignored on the Continue link', !notice.body.includes('ref=abc'));
    check('the notice stays under 3 KB apart from the destination URL', new TextEncoder().encode(notice.body.replaceAll('https://docs.google.com/forms/d/e/1FAIpQLSd3kR9vQx/viewform', '')).byteLength <= 3072);
    const after = await countersAfter('x7kq2m', (row) => row.click_total > before.click_total);
    check('a public visit raises the link total and today by 1', after.click_total === before.click_total + 1 && after.click_today === before.click_today + 1, JSON.stringify({ before, after }));
    check('a public visit raises the shared daily budget by 1', after.budget === before.budget + 1, `${before.budget} then ${after.budget}`);
    check('a public visit writes no clicks row', after.logged === 0, `${after.logged} rows`);

    const head = await visit('x7kq2m', 'HEAD');
    const afterHead = await countersAfter('x7kq2m', () => false);
    check('HEAD on a public link is a 200 that counts nothing', head.status === 200 && afterHead.click_total === after.click_total && afterHead.budget === after.budget);

    const last = await visit('ze3k9r');
    check('the 500th click of the day is still served', last.status === 200, `status ${last.status}`);
    const full = await countersAfter('ze3k9r', (row) => row.click_today >= 500);
    check('the link reaches 500 clicks today', full.click_today === 500, `${full.click_today}`);
    const limited = await visit('ze3k9r');
    check('the next click hits the daily limit with 429', limited.status === 429 && limited.body.includes('Daily click limit reached') && noStore(limited), `status ${limited.status}`);
    const afterLimit = await countersAfter('ze3k9r', () => false);
    check('a refused click is not counted', afterLimit.click_today === 500 && afterLimit.budget === full.budget);

    const atCap = await visit('r9pd3v');
    check('a link at its limit is a 429 with the link limit page', atCap.status === 429 && atCap.body.includes('CODE 429 · LINK LIMIT'), `status ${atCap.status}`);
    check('Retry-After points at the next 00:00 UTC', retryAfterOk(atCap), atCap.headers.get('retry-after'));
    const past = await visit('v6hd9k');
    check('a link past its limit is a 429 as well', past.status === 429, `status ${past.status}`);

    await d1Local(`UPDATE public_click_budget SET clicks = 20000 WHERE day = ${day};`);
    const busy = await visit('x7kq2m');
    check('a used up shared budget gives 429 with the busy page', busy.status === 429 && busy.body.includes('Public links are temporarily busy') && noStore(busy), `status ${busy.status}`);
    check('the busy page carries Retry-After to 00:00 UTC', retryAfterOk(busy), busy.headers.get('retry-after'));
    const privateDuringBusy = await visit('cv');
    check('a private link is never affected by the budget', privateDuringBusy.status === 302, `status ${privateDuringBusy.status}`);

    const disabled = await visit('tq6wna');
    check('a disabled public link is a 410', disabled.status === 410, `status ${disabled.status}`);
    const unknown = await visit('q9q9q9');
    check('an unknown public slug is a 404', unknown.status === 404, `status ${unknown.status}`);
  } finally {
    const restore = saved.links.map(
      (link) => `UPDATE links SET click_total = ${link.click_total}, click_today = ${link.click_today}, click_day = ${link.click_day} WHERE slug = '${link.slug}';`,
    );
    restore.push(
      saved.budget === null
        ? `DELETE FROM public_click_budget WHERE day = ${day};`
        : `INSERT INTO public_click_budget (day, clicks) VALUES (${day}, ${saved.budget}) ON CONFLICT (day) DO UPDATE SET clicks = ${saved.budget};`,
    );
    await d1Local(restore.join('\n'));
  }
}

const SLUG_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
/** A slug the public page could have drawn. */
const drawSlug = () => Array.from({ length: 6 }, () => SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)]).join('');

/**
 * Thirty private links straight in the database, with shared creation times
 * so the id has to break ties, walked page by page in every sort order.
 */
async function pagination() {
  section('Pagination');
  const stem = `${RUN}-p`;
  const base = Date.now() - 400 * DAY;
  const values = Array.from({ length: 30 }, (_, i) => {
    const createdAt = i < 10 ? base : i < 20 ? base + 1000 : base + 2000 + i;
    const slug = `${stem}${String(i).padStart(2, '0')}`;
    return `('${slug}', 'https://example.com/${slug}', 'Smoke page ${i}', '', 1, NULL, ${createdAt}, ${createdAt})`;
  });
  await d1Local(
    `INSERT INTO links (slug, url, title, description, is_active, expires_at, created_at, updated_at) VALUES ${values.join(',\n')};`,
  );
  try {
    const orders = [
      ['newest', (l) => l.createdAt, 'desc'],
      ['oldest', (l) => l.createdAt, 'asc'],
      ['clicks', (l) => l.clicks7d, 'desc'],
      ['least', (l) => l.clicks7d, 'asc'],
    ];
    for (const [sort, key, direction] of orders) {
      const result = await listAll(`q=${stem}&sort=${sort}`);
      const ids = result.links.map((l) => l.id);
      check(`sort=${sort}: 30 links come in pages of 25 and 5`, result.pages.join() === '25,5', result.pages.join());
      check(`sort=${sort}: no link twice and none missing`, ids.length === 30 && new Set(ids).size === 30);
      check(`sort=${sort}: ordered on the sort key, then id`, inOrder(result.links, key, direction));
    }

    const first = await api('GET', `/api/admin/links?q=${stem}`);
    const cursor = first.json?.nextCursor ?? '';
    check('the first page counts all 30 matches', first.json?.counts?.private?.matching === 30, JSON.stringify(first.json?.counts));
    check('a full first page carries a cursor', cursor.length > 0);
    const second = await api('GET', `/api/admin/links?q=${stem}&cursor=${cursor}`);
    check('the last page holds 5 rows and no cursor', second.json?.links?.length === 5 && second.json?.nextCursor === null);
    const cut = await api('GET', `/api/admin/links?q=${stem}&cursor=${cursor.slice(0, Math.floor(cursor.length / 2))}`);
    check('a damaged cursor is a 400', cut.status === 400 && errorCode(cut) === 'bad_request', `status ${cut.status}`);
    const otherSort = await api('GET', `/api/admin/links?q=${stem}&sort=oldest&cursor=${cursor}`);
    check('a cursor reused with another sort is a 400', otherSort.status === 400, `status ${otherSort.status}`);
    const otherTab = await api('GET', `/api/admin/links?visibility=public&cursor=${cursor}`);
    check('a cursor reused on the other tab is a 400', otherTab.status === 400, `status ${otherTab.status}`);
    const badTab = await api('GET', '/api/admin/links?visibility=everyone');
    check('an unknown visibility is a 400', badTab.status === 400 && errorCode(badTab) === 'bad_request');
  } finally {
    await d1Local(`DELETE FROM links WHERE slug LIKE '${stem}%';`);
  }
}

/** The public tab, its fields, and how the filters count on both tabs. */
async function tabs() {
  section('Tabs and counts');
  const pub = await listAll('visibility=public');
  const bySlug = new Map(pub.links.map((l) => [l.slug, l]));
  check(
    'the public tab lists every public link, and the count agrees',
    pub.status === 200 && pub.links.length === pub.counts.public.total && pub.links.length >= 9,
    `${pub.links.length} vs ${pub.counts?.public?.total}`,
  );
  check(
    'public rows carry counters and nothing private',
    pub.links.every(
      (l) =>
        Number.isInteger(l.clickTotal) &&
        Number.isInteger(l.clicksToday) &&
        typeof l.limitReached === 'boolean' &&
        typeof l.domainBlocked === 'boolean' &&
        !('tags' in l) &&
        !('clicks7d' in l) &&
        !('description' in l),
    ),
  );
  check('a public row shows its host without www', bySlug.get('r9pd3v')?.host === 'youtube.com' && bySlug.get('x7kq2m')?.host === 'docs.google.com');

  const [cap] = await rows(`SELECT click_day, click_today FROM links WHERE slug = 'r9pd3v';`);
  const today = cap?.click_day === utcToday() ? cap.click_today : 0;
  check(
    "today's count reads the counter of the current UTC day, against the limit of 500",
    bySlug.get('r9pd3v')?.clicksToday === today && bySlug.get('r9pd3v')?.limitReached === today >= 500,
    JSON.stringify(bySlug.get('r9pd3v')),
  );
  check(
    'a link on a blocked domain is marked, others are not',
    bySlug.get('tq6wna')?.domainBlocked === true && bySlug.get('tq6wna')?.status === 'inactive' && bySlug.get('x7kq2m')?.domainBlocked === false,
  );

  const inactive = await listAll('visibility=public&status=inactive');
  check(
    'the status filter applies to public links',
    inactive.links.length > 0 && inactive.links.every((l) => l.status === 'inactive') && inactive.counts.public.matching === inactive.links.length,
  );
  const tagged = await listAll('visibility=public&tag=career');
  check(
    'the tag filter leaves public links alone but narrows the private count',
    tagged.links.length === pub.links.length &&
      tagged.counts.public.matching === pub.counts.public.total &&
      tagged.counts.private.matching < tagged.counts.private.total,
    JSON.stringify(tagged.counts),
  );
  const youtube = await listAll('visibility=public&q=youtube');
  check(
    'the search counts on both tabs',
    youtube.links.map((l) => l.slug).join() === 'r9pd3v' && youtube.counts.public.matching === 1 && youtube.counts.private.matching === 0,
    JSON.stringify(youtube.counts),
  );
  const byTotal = (await listAll('visibility=public&sort=clicks')).links;
  check('public sort=clicks orders by total clicks, then id', inOrder(byTotal, (l) => l.clickTotal, 'desc'));
}

/** POST /api/public/links: success, every refusal, CSRF, slugs, and both hourly limits. */
async function publicCreation() {
  section('Public link creation');
  await awayFromHourEdge();
  await resetRateWindow();
  const totalBefore = (await listAll('visibility=public')).counts?.public?.total ?? 0;

  const requested = drawSlug();
  const made = await publicCreate({ url: `  Example.ORG/${RUN}/page?x=1 `, slug: requested, turnstileToken: DUMMY_TOKEN });
  const destination = `https://example.org/${RUN}/page?x=1`;
  check('a visitor creates a link with 201', made.status === 201, `status ${made.status}, ${JSON.stringify(made.json)}`);
  check(
    'the answer holds the result card fields and nothing else',
    JSON.stringify(Object.keys(made.json ?? {}).sort()) === '["createdAt","shortUrl","slug","url"]',
    JSON.stringify(made.json),
  );
  check(
    'the slug is kept, the short URL is on daffa.me, and the URL is normalized',
    made.json?.slug === requested && made.json?.shortUrl === `https://daffa.me/${requested}` && made.json?.url === destination,
    JSON.stringify(made.json),
  );
  const id = await publicIdOf(requested);
  const row = (await listAll(`visibility=public&q=${requested}`)).links.find((l) => l.slug === requested);
  check('the owner sees it on the public tab, titled by its host', row?.host === 'example.org' && row?.status === 'active' && row?.clickTotal === 0);
  const notice = await visit(requested).catch(() => null);
  check('the redirector serves its notice page', notice?.status === 200 && notice.body.includes('EXTERNAL LINK'), `status ${notice?.status}`);

  const counted = await rateCounts();
  check(
    'one creation counts once globally and once for the visitor, under an HMAC bucket',
    counted.global === 1 && counted.visitors.length === 1 && counted.visitors[0].count === 1 && /^ip:[A-Za-z0-9_-]{43}$/.test(counted.visitors[0].bucket),
    JSON.stringify(counted),
  );

  const refusals = [
    ['a missing URL', { turnstileToken: DUMMY_TOKEN }, 400, 'invalid_url', 'required'],
    ['a URL over 2048 characters', { url: `https://example.org/${'a'.repeat(2100)}`, turnstileToken: DUMMY_TOKEN }, 400, 'invalid_url', 'too_long'],
    ['text that is not a URL', { url: 'not a url', turnstileToken: DUMMY_TOKEN }, 400, 'invalid_url', 'invalid'],
    ['a javascript: URL', { url: 'javascript:alert(1)', turnstileToken: DUMMY_TOKEN }, 400, 'invalid_url', 'invalid'],
    ['a host without a dot', { url: 'localhost:3000', turnstileToken: DUMMY_TOKEN }, 400, 'invalid_url', 'invalid'],
    ['an IP address', { url: 'http://127.0.0.1/admin', turnstileToken: DUMMY_TOKEN }, 400, 'invalid_url', 'ip'],
    ['a daffa.me address', { url: 'https://daffa.me/cv', turnstileToken: DUMMY_TOKEN }, 400, 'invalid_url', 'loop'],
    ['the public page itself', { url: 'link.daffa.me', turnstileToken: DUMMY_TOKEN }, 400, 'invalid_url', 'loop'],
    ['another shortener', { url: 'bit.ly/3xYz9Qa', turnstileToken: DUMMY_TOKEN }, 400, 'invalid_url', 'shortener'],
    ['a blocked domain', { url: 'https://grabgift-promo.com/klaim', turnstileToken: DUMMY_TOKEN }, 400, 'blocked_domain'],
    ['a subdomain of a blocked domain', { url: 'https://promo.grabgift-promo.com/x', turnstileToken: DUMMY_TOKEN }, 400, 'blocked_domain'],
    ['a slug the page cannot draw', { url: destination, slug: 'ABCDEF', turnstileToken: DUMMY_TOKEN }, 400, 'invalid_slug'],
    ['an owner field', { url: destination, title: 'x', turnstileToken: DUMMY_TOKEN }, 400, 'invalid_field'],
    ['a missing Turnstile token', { url: destination }, 403, 'turnstile_failed'],
  ];
  for (const [name, body, status, code, reason] of refusals) {
    const result = await publicCreate(body);
    check(
      `${name} is refused with ${status} ${code}${reason ? ` (${reason})` : ''}`,
      result.status === status && errorCode(result) === code && (!reason || result.json?.error?.reason === reason),
      `status ${result.status}, ${JSON.stringify(result.json?.error)}`,
    );
  }
  const malformed = await publicCreate(undefined, { raw: '{"url":' });
  check('malformed JSON is a 400 invalid_json', malformed.status === 400 && errorCode(malformed) === 'invalid_json');
  const huge = await publicCreate(undefined, { raw: JSON.stringify({ url: `https://example.org/${'a'.repeat(9000)}`, turnstileToken: DUMMY_TOKEN }) });
  check('a body over 8 KB is a 413', huge.status === 413 && errorCode(huge) === 'payload_too_large', `status ${huge.status}`);
  const blockedMessage = await publicCreate({ url: 'https://www.grabgift-promo.com/klaim', turnstileToken: DUMMY_TOKEN });
  check(
    'the blocked message names the host without www',
    blockedMessage.json?.error?.message === 'The domain grabgift-promo.com is blocked for public links and cannot be shortened.',
    blockedMessage.json?.error?.message,
  );

  for (const [label, overrides] of [
    ['a foreign origin', { origin: 'https://evil.example' }],
    ['the retired dashboard origin', { origin: 'https://shorten.daffa.me' }],
    ['a missing origin', { origin: null }],
    ['text/plain', { contentType: 'text/plain' }],
  ]) {
    const result = await publicCreate({ url: destination, turnstileToken: DUMMY_TOKEN }, overrides);
    check(`a public POST with ${label} is a 403`, result.status === 403 && errorCode(result) === 'csrf_rejected', `status ${result.status}`);
  }
  const afterRefusals = await rateCounts();
  check('refused requests never spend the hourly counters', JSON.stringify(afterRefusals) === JSON.stringify(counted), JSON.stringify(afterRefusals));
  const totalAfter = (await listAll('visibility=public')).counts?.public?.total ?? 0;
  check('refused requests create nothing', totalAfter === totalBefore + 1, `${totalBefore} then ${totalAfter}`);

  const collided = await publicCreate({ url: `https://example.org/${RUN}/two`, slug: 'x7kq2m', turnstileToken: DUMMY_TOKEN });
  check(
    'a taken slug is replaced by a new random one',
    collided.status === 201 && collided.json?.slug !== 'x7kq2m' && PUBLIC_SLUG.test(collided.json?.slug ?? ''),
    JSON.stringify(collided.json),
  );

  if (id) {
    check('deleting a public link is a 204', (await deletePublic(id)).status === 204);
    const gone = await visit(requested).catch(() => null);
    check('its slug is a 404 at the redirector', gone?.status === 404, `status ${gone?.status}`);
    const reused = await publicCreate({ url: `https://example.org/${RUN}/reused`, slug: requested, turnstileToken: DUMMY_TOKEN });
    check('the freed slug can be drawn again', reused.status === 201 && reused.json?.slug === requested, JSON.stringify(reused.json));
  }

  // Hourly limit per visitor: five pass, the sixth is refused.
  await resetRateWindow();
  const statuses = [];
  for (let i = 0; i < 5; i += 1) {
    statuses.push((await publicCreate({ url: `https://example.org/${RUN}/burst-${i}`, turnstileToken: DUMMY_TOKEN })).status);
  }
  check('five links in one hour are accepted', statuses.every((status) => status === 201), statuses.join());
  const sixth = await publicCreate({ url: `https://example.org/${RUN}/burst-5`, turnstileToken: DUMMY_TOKEN });
  const nextHour = currentHour() + HOUR;
  check(
    'the sixth is a 429 rate_limited_ip that resets at the next clock hour',
    sixth.status === 429 && errorCode(sixth) === 'rate_limited_ip' && sixth.json?.error?.resetAt === nextHour,
    `status ${sixth.status}, ${JSON.stringify(sixth.json?.error)}`,
  );
  const retryAfter = Number(sixth.headers.get('retry-after'));
  check('it carries Retry-After to the next hour', Math.abs(retryAfter - Math.ceil((nextHour - Date.now()) / 1000)) <= 2, String(retryAfter));
  const burst = await rateCounts();
  check('the refused sixth was not counted', burst.global === 5 && burst.visitors[0]?.count === 5, JSON.stringify(burst));

  // The global limit, with the visitor's own count cleared.
  await d1Local(
    `DELETE FROM rate_limits WHERE window_start = ${currentHour()} AND bucket <> 'global';` +
      `UPDATE rate_limits SET count = 30 WHERE window_start = ${currentHour()} AND bucket = 'global';`,
  );
  const crowded = await publicCreate({ url: `https://example.org/${RUN}/crowded`, turnstileToken: DUMMY_TOKEN });
  check(
    'with 30 links this hour anyone is refused with rate_limited_global',
    crowded.status === 429 && errorCode(crowded) === 'rate_limited_global' && crowded.json?.error?.resetAt === nextHour,
    `status ${crowded.status}, ${JSON.stringify(crowded.json?.error)}`,
  );
  const crowdedRetry = Number(crowded.headers.get('retry-after'));
  check('it carries Retry-After to the next hour as well', Math.abs(crowdedRetry - Math.ceil((nextHour - Date.now()) / 1000)) <= 2, String(crowdedRetry));
  const full = await rateCounts();
  check('the refused request was not counted', full.global === 30 && full.visitors.length === 0, JSON.stringify(full));
}

/**
 * The public page checks a destination itself before it spends a Turnstile
 * token, and shows the server's message for whatever it lets through. Both
 * must agree word for word, or the field would show two different texts for
 * the same mistake.
 */
async function clientPublicContract() {
  section('Client contract, public page');
  const { checkPublicUrl, blockedDomainMessage } = await importTs('shared/url.ts');
  const samples = [
    '',
    `https://example.org/${'a'.repeat(2100)}`,
    'docs google com/forms/rsvp',
    'http://192.168.1.10/admin',
    'https://daffa.me/cv',
    'link.daffa.me',
    'bit.ly/3xYz9Qa',
  ];
  for (const url of samples) {
    const local = checkPublicUrl(url);
    const result = await publicCreate({ url, turnstileToken: DUMMY_TOKEN });
    const error = result.json?.error;
    check(
      `the page and the server agree on "${url.length > 40 ? `${url.slice(0, 37)}...` : url}"`,
      result.status === 400 && error?.code === 'invalid_url' && error?.reason === local?.code && error?.message === local?.message,
      `server ${JSON.stringify(error)}, page ${JSON.stringify(local)}`,
    );
  }
  const blocked = await publicCreate({ url: 'https://promo.grabgift-promo.com/x', turnstileToken: DUMMY_TOKEN });
  check(
    'a blocked domain message names the host, in the shared wording the page shows',
    errorCode(blocked) === 'blocked_domain' && blocked.json?.error?.message === blockedDomainMessage('promo.grabgift-promo.com'),
    JSON.stringify(blocked.json?.error),
  );
}

/** Enable, disable and delete, and the wall between public and private routes. */
async function moderation(privateId) {
  section('Public link moderation');
  await resetRateWindow();
  const made = await publicCreate({ url: `https://example.org/${RUN}/moderated`, turnstileToken: DUMMY_TOKEN });
  const slug = made.json?.slug;
  const id = slug ? await publicIdOf(slug) : null;
  if (!check('a public link to moderate exists', made.status === 201 && id !== null, `status ${made.status}`)) return;

  const off = await api('PATCH', `/api/admin/public-links/${id}`, { body: { isActive: false } });
  check('PATCH isActive false disables it', off.status === 200 && off.json?.link?.isActive === false && off.json.link.status === 'inactive');
  check('a disabled public link is a 410 at the redirector', (await visit(slug)).status === 410);
  const on = await api('PATCH', `/api/admin/public-links/${id}`, { body: { isActive: true } });
  check('PATCH isActive true enables it again', on.status === 200 && on.json?.link?.status === 'active');
  check('an enabled public link shows its notice again', (await visit(slug)).status === 200);
  for (const body of [{ isActive: 'no' }, { isActive: true, url: 'https://evil.example' }, {}]) {
    const bad = await api('PATCH', `/api/admin/public-links/${id}`, { body });
    check(`moderation refuses ${JSON.stringify(body)} with 400`, bad.status === 400 && errorCode(bad) === 'invalid_field');
  }

  if (privateId) {
    const patchPrivate = await api('PATCH', `/api/admin/public-links/${privateId}`, { body: { isActive: false } });
    check('a private id on the moderation route is a 404', patchPrivate.status === 404);
    check('a private link cannot be deleted through it', (await api('DELETE', `/api/admin/public-links/${privateId}`)).status === 404);
  }
  for (const [method, path, body] of [
    ['GET', `/api/admin/links/${id}`],
    ['PATCH', `/api/admin/links/${id}`, { title: 'hijacked' }],
    ['POST', `/api/admin/links/${id}/toggle`],
    ['GET', `/api/admin/links/${id}/analytics`],
    ['GET', `/api/admin/links/${id}/clicks`],
    ['DELETE', `/api/admin/links/${id}`],
  ]) {
    const result = await api(method, path, { body });
    check(`${method} ${path.replace(String(id), ':publicId')} is a 404 for a public link`, result.status === 404, `status ${result.status}`);
  }
  const taken = await api('GET', `/api/admin/slugs/${slug}/available`);
  check('a public slug is taken for private links too', taken.json?.available === false);

  check('deleting it is a 204', (await deletePublic(id)).status === 204);
  check('deleting it again is a 404', (await api('DELETE', `/api/admin/public-links/${id}`)).status === 404);
}

/** The blocked domains list, and blocking with existing links disabled. */
async function blockedDomains() {
  section('Blocked domains');
  const domain = `${RUN}.test`;
  const before = await api('GET', '/api/admin/blocked-domains');
  const hosts = (before.json?.domains ?? []).map((d) => d.createdAt);
  check(
    'the list holds the seeded domains, newest first',
    before.status === 200 && before.json.total >= 10 && hosts.every((t, i) => i === 0 || hosts[i - 1] >= t),
  );
  const promo = await api('GET', '/api/admin/blocked-domains?q=PROMO');
  check(
    'the search narrows the list, case insensitively',
    promo.json?.domains?.length > 0 && promo.json.domains.every((d) => d.host.includes('promo')) && promo.json.total === before.json.total,
  );

  const added = await api('POST', '/api/admin/blocked-domains', { body: { host: `HTTPS://Sub.${domain.toUpperCase()}/x?y=1` } });
  check(
    'a pasted URL is stored as its lowercase host with 201',
    added.status === 201 && added.json?.created === true && added.json?.domain?.host === `sub.${domain}` && added.json?.disabled === 0,
    JSON.stringify(added.json),
  );
  const twice = await api('POST', '/api/admin/blocked-domains', { body: { host: `sub.${domain}.` } });
  check('adding it again is a 200 that changes nothing', twice.status === 200 && twice.json?.created === false);
  for (const host of ['localhost', '10.0.0.1', 'not a host', '']) {
    const bad = await api('POST', '/api/admin/blocked-domains', { body: { host } });
    check(`"${host}" is refused with invalid_host`, bad.status === 400 && errorCode(bad) === 'invalid_host');
  }
  const found = await api('GET', `/api/admin/blocked-domains?q=${RUN}`);
  check('the new entry is found by search', found.json?.domains?.some((d) => d.host === `sub.${domain}`) && found.json.total === before.json.total + 1);
  check('removing it is a 204', (await api('DELETE', `/api/admin/blocked-domains/${encodeURIComponent(`SUB.${domain}.`)}`)).status === 204);
  check('removing it again is a 404', (await api('DELETE', `/api/admin/blocked-domains/sub.${domain}`)).status === 404);

  // Block with the existing links disabled.
  await resetRateWindow();
  const apex = await publicCreate({ url: `https://${domain}/a`, turnstileToken: DUMMY_TOKEN });
  const www = await publicCreate({ url: `https://www.${domain}/b`, turnstileToken: DUMMY_TOKEN });
  const lookalike = await publicCreate({ url: `https://not${domain}/c`, turnstileToken: DUMMY_TOKEN });
  check('three public links to block around', [apex, www, lookalike].every((r) => r.status === 201));

  const preview = await api('GET', `/api/admin/blocked-domains/check?host=${domain.toUpperCase()}`);
  check(
    'the check counts the two active links under the domain, not the lookalike',
    preview.json?.host === domain && preview.json?.blockedBy === null && preview.json?.activePublicLinks === 2,
    JSON.stringify(preview.json),
  );
  const block = await api('POST', '/api/admin/blocked-domains', { body: { host: domain, disableActive: true } });
  check('blocking with disableActive disables both', block.status === 201 && block.json?.disabled === 2, JSON.stringify(block.json));
  const listed = new Map((await listAll(`visibility=public&q=${domain}`)).links.map((l) => [l.slug, l]));
  const state = (result) => listed.get(result.json?.slug);
  check(
    'the blocked links are inactive and marked, the lookalike is not',
    state(apex)?.status === 'inactive' &&
      state(apex)?.domainBlocked === true &&
      state(www)?.status === 'inactive' &&
      state(lookalike)?.status === 'active' &&
      state(lookalike)?.domainBlocked === false,
  );
  check('a disabled link answers 410 at the redirector', (await visit(apex.json?.slug)).status === 410);
  const covered = await api('GET', `/api/admin/blocked-domains/check?host=a.${domain}`);
  check('a subdomain reports the entry that covers it', covered.json?.blockedBy === domain && covered.json?.activePublicLinks === 0);
  const refused = await publicCreate({ url: `https://deep.www.${domain}/x`, turnstileToken: DUMMY_TOKEN });
  check(
    'a new link under the blocked domain is refused',
    refused.status === 400 && errorCode(refused) === 'blocked_domain' && refused.json.error.message.includes(`deep.www.${domain}`),
    JSON.stringify(refused.json?.error),
  );

  check('the block can be removed', (await api('DELETE', `/api/admin/blocked-domains/${domain}`)).status === 204);
  const allowed = await publicCreate({ url: `https://${domain}/again`, turnstileToken: DUMMY_TOKEN });
  check('after removal new links are accepted again', allowed.status === 201);
  const stillOff = (await listAll(`visibility=public&q=${domain}`)).links.find((l) => l.slug === apex.json?.slug);
  check('links disabled by the block stay disabled until enabled', stillOff?.status === 'inactive');
}

/** The daily purge, fired through the local scheduled endpoint. */
async function cron() {
  section('Daily cron');
  const hour = currentHour();
  const day = utcToday();
  const staleDay = day - 9 * DAY;
  const recentDay = day - 2 * DAY;
  const [recentBefore] = await rows(`SELECT clicks FROM public_click_budget WHERE day = ${recentDay};`);
  await d1Local(
    `INSERT OR IGNORE INTO rate_limits (window_start, bucket, count) VALUES (${hour - 3 * DAY}, '${PREFIX}stale', 1), (${hour - 2 * HOUR}, '${PREFIX}fresh', 1);` +
      `INSERT OR IGNORE INTO public_click_budget (day, clicks) VALUES (${staleDay}, 5), (${recentDay}, 7);`,
  );
  try {
    const response = await fetch(`${DASHBOARD}/cdn-cgi/local/scheduled?cron=15+0+*+*+*`);
    check('the local scheduled endpoint runs the cron', response.status === 200, `status ${response.status}`);
    const limits = (await rows(`SELECT bucket FROM rate_limits WHERE bucket LIKE '${PREFIX}%';`)).map((row) => row.bucket);
    check('rate limit windows older than one day are purged, newer ones kept', limits.join() === `${PREFIX}fresh`, limits.join());
    const budget = (await rows(`SELECT day FROM public_click_budget WHERE day IN (${staleDay}, ${recentDay}) ORDER BY day;`)).map((row) => row.day);
    check('budget rows older than seven days are purged, newer ones kept', budget.join() === String(recentDay), budget.join());
  } finally {
    await d1Local(
      `DELETE FROM rate_limits WHERE bucket LIKE '${PREFIX}%';` +
        (recentBefore ? '' : `DELETE FROM public_click_budget WHERE day = ${recentDay};`),
    );
  }
}

/** robots.txt and sitemap.xml come from apps/dashboard/public. */
async function staticFiles() {
  section('Static files for search engines');
  const robots = await fetch(`${DASHBOARD}/robots.txt`).then((r) => r.text());
  check(
    'robots.txt allows / and disallows /dashboard and /api',
    ['Allow: /', 'Disallow: /dashboard', 'Disallow: /api', 'Sitemap: https://link.daffa.me/sitemap.xml'].every((line) =>
      robots.split(/\r?\n/).includes(line),
    ),
  );
  const sitemap = await fetch(`${DASHBOARD}/sitemap.xml`).then((r) => r.text());
  check('sitemap.xml lists the public page', sitemap.includes('<loc>https://link.daffa.me/</loc>'));
  const og = await fetch(`${DASHBOARD}/og.png`);
  check('og.png is served as an image', og.status === 200 && og.headers.get('content-type') === 'image/png');
}

async function cleanup() {
  for (const id of created) {
    await api('DELETE', `/api/admin/links/${id}`).catch(() => {});
  }
  for (const id of createdPublic) {
    await deletePublic(id).catch(() => {});
  }
  const remaining = await listAll(`q=${PREFIX}`).catch(() => null);
  const count = remaining?.links?.filter((l) => l.slug.startsWith(PREFIX)).length ?? 0;
  const remainingPublic = await listAll(`visibility=public&q=${PREFIX}`).catch(() => null);
  const publicCount = remainingPublic?.links?.length ?? 0;
  check('no smoke links left behind', count === 0 && publicCount === 0, `${count} private, ${publicCount} public remaining`);
}

try {
  await main();
} finally {
  await cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}
