/**
 * End to end smoke test for the dashboard API, run against `npm run dev`.
 *
 * Needs DEV_AUTH_BYPASS=true in apps/dashboard/.dev.vars and a migrated,
 * seeded local database. Exercises every endpoint, every CSRF case, and the
 * path from the redirector to the dashboard through the shared D1 state.
 * Prints PASS or FAIL per check, removes every link it creates, and exits 1
 * on any failure.
 *
 *   SMOKE_DASHBOARD  default http://localhost:5173
 *   SMOKE_REDIRECT   default http://127.0.0.1:8787
 */

const DASHBOARD = process.env.SMOKE_DASHBOARD ?? 'http://localhost:5173';
const REDIRECT = process.env.SMOKE_REDIRECT ?? 'http://127.0.0.1:8787';
const ORIGIN = new URL(DASHBOARD).origin;
const DEV_EMAIL = 'developer@localhost';
const PREFIX = 'smoke-';
const RUN = `${PREFIX}${Date.now().toString(36)}`;
const DAY = 86_400_000;

let passed = 0;
let failed = 0;
const created = new Set();

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
  const result = await api('POST', '/api/links', { body });
  if (result.status === 201 && result.json?.link?.id) created.add(result.json.link.id);
  return result;
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
    me = await api('GET', '/api/me');
  } catch (error) {
    console.error(`\nThe dashboard is not reachable at ${DASHBOARD}. Start it with \`npm run dev\`.`);
    console.error(String(error));
    process.exit(1);
  }
  if (!check('GET /api/me returns the dev identity', me.status === 200 && me.json?.email === DEV_EMAIL, `status ${me.status}, ${JSON.stringify(me.json)}`)) {
    console.error('\nSet DEV_AUTH_BYPASS=true in apps/dashboard/.dev.vars and restart `npm run dev`.');
    process.exit(1);
  }

  // Remove links left behind by a run that crashed before its cleanup.
  const leftovers = await api('GET', `/api/links?q=${PREFIX}`);
  for (const link of leftovers.json?.links ?? []) {
    if (link.slug.startsWith(PREFIX)) await api('DELETE', `/api/links/${link.id}`);
  }
  check('leftover smoke links cleared', leftovers.status === 200);

  const unknown = await api('GET', '/api/nope');
  check('unknown API path is a JSON 404', unknown.status === 404 && errorCode(unknown) === 'not_found');

  // Reads ------------------------------------------------------------------
  section('Summary, tags, list');
  const summary = await api('GET', '/api/summary');
  const s = summary.json ?? {};
  check(
    'GET /api/summary has integer counts and a 7 day window',
    summary.status === 200 &&
      [s.total, s.active, s.human7d, s.unique7d].every(Number.isInteger) &&
      s.active <= s.total &&
      s.unique7d <= s.human7d &&
      s.windowEnd - s.windowStart > 6 * DAY &&
      s.windowEnd - s.windowStart <= 7 * DAY,
    JSON.stringify(s),
  );
  check('summary names the most clicked link', s.top === null || typeof s.top?.slug === 'string');

  const tags = await api('GET', '/api/tags');
  const tagList = tags.json?.tags ?? [];
  check(
    'GET /api/tags is sorted and includes career',
    tags.status === 200 && tagList.includes('career') && tagList.join() === [...tagList].sort().join(),
  );

  const all = await api('GET', '/api/links');
  const links = all.json?.links ?? [];
  const bySlug = new Map(links.map((link) => [link.slug, link]));
  check('GET /api/links returns every link with total', all.status === 200 && all.json.total === links.length && links.length >= 10);
  check('list items carry tags, status and clicks7d', links.every((l) => Array.isArray(l.tags) && typeof l.status === 'string' && Number.isInteger(l.clicks7d)));

  const kaggle = await api('GET', '/api/links?q=KAGGLE');
  check('q search is case insensitive', kaggle.json?.links?.some((l) => l.slug === 'kaggle'));
  // LIKE wildcards must match literally. Unescaped, "%" or "_" would match every
  // link. The expected set is computed here from the full list by plain substring.
  for (const char of ['%', '_']) {
    const result = await api('GET', `/api/links?q=${encodeURIComponent(char)}`);
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

  const career = await api('GET', '/api/links?tag=career');
  check('tag filter keeps only tagged links', career.json?.links?.length > 0 && career.json.links.every((l) => l.tags.includes('career')));

  for (const status of ['active', 'inactive', 'expired']) {
    const filtered = await api('GET', `/api/links?status=${status}`);
    const items = filtered.json?.links ?? [];
    check(`status=${status} returns only ${status} links`, filtered.status === 200 && items.length > 0 && items.every((l) => l.status === status));
  }

  const byClicks = await api('GET', '/api/links?sort=clicks');
  const counts = (byClicks.json?.links ?? []).map((l) => l.clicks7d);
  check('sort=clicks orders by 7 day clicks, highest first', counts.every((n, i) => i === 0 || counts[i - 1] >= n));

  const badStatus = await api('GET', '/api/links?status=aktif');
  check('an unknown status is a 400', badStatus.status === 400 && errorCode(badStatus) === 'bad_request');
  const badSort = await api('GET', '/api/links?sort=oldest');
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
  check('POST /api/links creates a link with 201', createA.status === 201 && linkA?.slug === slugA, `status ${createA.status}, ${JSON.stringify(createA.json)}`);
  check('create sets Location to the new link', createA.headers.get('location') === `/api/links/${linkA?.id}`);
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

  const malformed = await api('POST', '/api/links', { raw: '{"url":' });
  check('malformed JSON is a 400 invalid_json', malformed.status === 400 && errorCode(malformed) === 'invalid_json');

  const huge = await api('POST', '/api/links', {
    raw: JSON.stringify({ url: 'https://example.com', slug: `${RUN}-x`, description: 'x'.repeat(17_000) }),
  });
  check('a body over 16 KB is a 413', huge.status === 413 && errorCode(huge) === 'payload_too_large', `status ${huge.status}`);

  // Detail -----------------------------------------------------------------
  section('Detail');
  const detail = await api('GET', `/api/links/${linkA?.id}`);
  check('GET /api/links/:id returns the link and totals', detail.status === 200 && detail.json?.link?.slug === slugA && detail.json?.totals?.human === 0);
  for (const raw of ['abc', '0', '-1', '1.5', '01']) {
    const bad = await api('GET', `/api/links/${raw}`);
    check(`id "${raw}" is a 400 invalid_id`, bad.status === 400 && errorCode(bad) === 'invalid_id', `status ${bad.status}`);
  }
  const missing = await api('GET', '/api/links/999999');
  check('an unknown id is a 404', missing.status === 404 && errorCode(missing) === 'not_found');

  // Edit -------------------------------------------------------------------
  section('Edit');
  const future = Date.now() + 30 * DAY;
  const edited = await api('PATCH', `/api/links/${linkA?.id}`, {
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
  const cleared = await api('PATCH', `/api/links/${linkA?.id}`, { body: { title: '' } });
  check('clearing the title falls back to the host', cleared.json?.link?.title === 'example.com', cleared.json?.link?.title);
  const stolen = await api('PATCH', `/api/links/${linkA?.id}`, { body: { slug: 'cv' } });
  check('PATCH to a taken slug is a 409', stolen.status === 409 && errorCode(stolen) === 'slug_taken');
  const empty = await api('PATCH', `/api/links/${linkA?.id}`, { body: {} });
  check('an empty PATCH is a 400', empty.status === 400 && errorCode(empty) === 'invalid_field');
  const tagsAfter = await api('GET', '/api/tags');
  check('tags replaced by an edit leave the tag list', !tagsAfter.json?.tags?.includes('smoke-test') && tagsAfter.json?.tags?.includes('edited'));

  // Toggle -----------------------------------------------------------------
  section('Toggle');
  const off = await api('POST', `/api/links/${linkA?.id}/toggle`);
  check('toggle turns an active link inactive', off.status === 200 && off.json?.link?.status === 'inactive');
  const on = await api('POST', `/api/links/${linkA?.id}/toggle`);
  check('toggle turns it active again', on.json?.link?.status === 'active' && on.json.link.expiresAt === future);
  const revived = await api('POST', `/api/links/${linkB?.id}/toggle`);
  check('toggle reactivates an expired link and clears its expiry', revived.json?.link?.status === 'active' && revived.json.link.expiresAt === null, JSON.stringify(revived.json?.link));

  // Slug availability --------------------------------------------------------
  section('Slug availability');
  const free = await api('GET', `/api/slugs/${RUN}-free/available`);
  check('a free slug is available', free.json?.available === true);
  const cv = await api('GET', '/api/slugs/cv/available');
  check('a taken slug is unavailable and names the owner', cv.json?.available === false && cv.json.code === 'slug_taken' && /CV and LinkedIn profile/.test(cv.json.message));
  const admin = await api('GET', '/api/slugs/admin/available');
  check('a reserved slug is unavailable', admin.json?.available === false && admin.json.code === 'invalid_slug' && /reserved/.test(admin.json.message));
  const upper = await api('GET', '/api/slugs/Upper/available');
  check('an invalid slug is unavailable', upper.json?.available === false && upper.json.code === 'invalid_slug');
  const own = await api('GET', `/api/slugs/${slugA}/available?exclude=${linkA?.id}`);
  check('a link\'s own slug is available while editing it', own.json?.available === true);
  const ownNoExclude = await api('GET', `/api/slugs/${slugA}/available`);
  check('the same slug is taken without exclude', ownNoExclude.json?.available === false);

  // Analytics ----------------------------------------------------------------
  section('Analytics');
  const cvLink = bySlug.get('cv');
  const jadwal = bySlug.get('jadwal');
  const lengths = { '24h': 24, '7d': 7, '30d': 30, '90d': 90 };
  for (const range of ['24h', '7d', '30d', '90d', 'all']) {
    const result = await api('GET', `/api/links/${cvLink?.id}/analytics?range=${range}`);
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
  const cv30 = (await api('GET', `/api/links/${cvLink?.id}/analytics?range=30d`)).json ?? {};
  check('cv 30d has rankings from human clicks', cv30.countries?.length > 0 && cv30.colos?.length > 0 && cv30.asns?.length > 0 && cv30.referrers?.length > 0);
  check('cv 30d returns raw user agents for the browser to parse', cv30.userAgents?.human?.length > 0 && cv30.userAgents?.bot?.length > 0);
  check('cv unique visitors never exceed human clicks', cv30.totals?.unique <= cv30.totals?.human);
  check('cv has a last human click time', Number.isInteger(cv30.allTime?.lastHumanAt));

  for (const range of ['24h', '7d', '30d', '90d', 'all']) {
    const result = await api('GET', `/api/links/${jadwal?.id}/analytics?range=${range}`);
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
  const badRange = await api('GET', `/api/links/${cvLink?.id}/analytics?range=7h`);
  check('a prototype range key is a 400', badRange.status === 400);
  const missingAnalytics = await api('GET', '/api/links/999999/analytics');
  check('analytics for an unknown link is a 404', missingAnalytics.status === 404);

  // Click log ----------------------------------------------------------------
  section('Click log');
  const first = await api('GET', `/api/links/${cvLink?.id}/clicks?range=all&page=0`);
  const log = first.json ?? {};
  const times = (log.rows ?? []).map((row) => row.ts);
  check('page 0 has ten rows, newest first', first.status === 200 && log.rows?.length === 10 && times.every((t, i) => i === 0 || times[i - 1] >= t));
  const cvAll = (await api('GET', `/api/links/${cvLink?.id}/analytics?range=all`)).json ?? {};
  check('the log total matches the analytics totals', log.total === cvAll.totals?.human + cvAll.totals?.bot, `${log.total} vs ${cvAll.totals?.human + cvAll.totals?.bot}`);
  const lastPage = Math.ceil(log.total / 10) - 1;
  const last = await api('GET', `/api/links/${cvLink?.id}/clicks?range=all&page=${lastPage}`);
  check('the last page holds the remainder', last.json?.rows?.length === log.total - lastPage * 10);
  const beyond = await api('GET', `/api/links/${cvLink?.id}/clicks?range=all&page=${lastPage + 1}`);
  check('a page past the end is empty with the same total', beyond.status === 200 && beyond.json?.rows?.length === 0 && beyond.json.total === log.total);
  const negative = await api('GET', `/api/links/${cvLink?.id}/clicks?page=-1`);
  check('a negative page is a 400', negative.status === 400 && errorCode(negative) === 'bad_request');
  const textPage = await api('GET', `/api/links/${cvLink?.id}/clicks?page=abc`);
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
    const post = await api('POST', '/api/links', { body: { url: 'https://example.com', slug: `${RUN}-csrf` }, ...overrides });
    check(`POST with ${label} is a 403`, post.status === 403 && errorCode(post) === 'csrf_rejected', `status ${post.status}`);
    const patch = await api('PATCH', `/api/links/${linkA?.id}`, { body: { title: 'hijacked' }, ...overrides });
    check(`PATCH with ${label} is a 403`, patch.status === 403 && errorCode(patch) === 'csrf_rejected', `status ${patch.status}`);
    const del = await api('DELETE', `/api/links/${linkA?.id}`, overrides);
    check(`DELETE with ${label} is a 403`, del.status === 403 && errorCode(del) === 'csrf_rejected', `status ${del.status}`);
  }
  const survivor = await api('GET', `/api/links/${linkA?.id}`);
  check('the link survived every rejected request unchanged', survivor.status === 200 && survivor.json.link.title === 'example.com');
  const csrfSlug = await api('GET', `/api/slugs/${RUN}-csrf/available`);
  check('no link was created by a rejected POST', csrfSlug.json?.available === true);
  const getWithEvil = await api('GET', '/api/links', { origin: 'https://evil.example' });
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
      total = (await api('GET', `/api/links/${linkA?.id}/clicks?range=all`)).json?.total ?? 0;
    }
    check('the click logged by the redirector shows in the dashboard', total >= 1, `total ${total} after 5 seconds`);

    await api('POST', `/api/links/${linkA?.id}/toggle`);
    const gone = await redirectStatus(slugA);
    check('a link deactivated in the dashboard is a 410 at the redirector', gone.status === 410, `status ${gone.status}`);
  }

  // Delete -------------------------------------------------------------------
  section('Delete');
  const removed = await api('DELETE', `/api/links/${linkA?.id}`);
  check('DELETE removes the link with 204', removed.status === 204);
  if (removed.status === 204) created.delete(linkA?.id);
  const after = await api('GET', `/api/links/${linkA?.id}`);
  check('the deleted link is a 404 in the dashboard', after.status === 404);
  const again = await api('DELETE', `/api/links/${linkA?.id}`);
  check('deleting twice is a 404', again.status === 404);
  if (redirect) {
    const redirectAfter = await redirectStatus(slugA);
    check('the deleted slug is a 404 at the redirector', redirectAfter.status === 404, `status ${redirectAfter.status}`);
  }
}

async function cleanup() {
  for (const id of created) {
    await api('DELETE', `/api/links/${id}`).catch(() => {});
  }
  const remaining = await api('GET', `/api/links?q=${PREFIX}`).catch(() => null);
  const count = remaining?.json?.links?.filter((l) => l.slug.startsWith(PREFIX)).length ?? 0;
  check('no smoke links left behind', count === 0, `${count} remaining`);
}

try {
  await main();
} finally {
  await cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}
