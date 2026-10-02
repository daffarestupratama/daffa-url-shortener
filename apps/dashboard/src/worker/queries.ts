/**
 * Every SQL statement the dashboard API runs, as static strings with numbered
 * parameters. Nothing here is assembled at runtime, which keeps the statements
 * reviewable and lets scripts/explain.mjs run EXPLAIN QUERY PLAN on exactly the
 * SQL that ships.
 *
 * Aliases are fixed: `l` is links, `c` is clicks. Every query that reads clicks
 * constrains c.link_id, so it can use idx_clicks_link_ts or
 * idx_clicks_link_bot_ts. Queries across links reach clicks through a join from
 * links for the same reason, never through a filter on c.ts alone.
 *
 * Private and public links share the links table. Owner routes on a single
 * link (/links/:id and below) add `is_public = 0`, so a public link can only be
 * reached through the moderation routes and stays as its visitor created it.
 *
 * This module imports nothing, so plain Node scripts can load it.
 */

const LINK_COLUMNS =
  'l.id, l.slug, l.url, l.title, l.description, l.is_active, l.expires_at, l.created_at, l.updated_at';

/** Tag names of the link as a JSON array, sorted. '[]' when there are none. */
const TAGS_JSON = `(SELECT json_group_array(name) FROM (
    SELECT t.name AS name FROM link_tags lt JOIN tags t ON t.id = lt.tag_id
    WHERE lt.link_id = l.id ORDER BY t.name)) AS tags`;

/** Mirrors deriveStatus() in shared/status.ts. `now` is a parameter placeholder. */
const statusSql = (now: string) =>
  `CASE WHEN l.expires_at IS NOT NULL AND l.expires_at < ${now} THEN 'expired' ` +
  `WHEN l.is_active = 1 THEN 'active' ELSE 'inactive' END`;

// Links ------------------------------------------------------------------

/** ?1 id. Private links only. */
export const LINK_BY_ID = `SELECT ${LINK_COLUMNS}, ${TAGS_JSON} FROM links l WHERE l.id = ?1 AND l.is_public = 0`;

/** ?1 slug */
export const LINK_BY_SLUG = `SELECT ${LINK_COLUMNS}, ${TAGS_JSON} FROM links l WHERE l.slug = ?1`;

/** ?1 slug. Used for the "already used by" message. */
export const SLUG_OWNER = 'SELECT id, title FROM links WHERE slug = ?1';

/** ?1 id. Existence and creation date, for analytics and the click log. Private links only. */
export const LINK_CREATED = 'SELECT id, created_at FROM links WHERE id = ?1 AND is_public = 0';

// Links list -------------------------------------------------------------
//
// One page of one tab. Pagination is keyset on (sort key, id): the cursor
// carries the key and id of the last row shown, and the next page starts
// strictly after it. id follows the direction of the key, so the order is
// total and no row can repeat or go missing between pages.
//
// Every page of one listing reuses the asOf moment of its first page for the
// status check, the 7 day click window, and `created_at <= asOf`. A private
// listing is then a fixed snapshot. Public click counters are live, so a click
// sort on the public tab can shift while it is read. The client dedupes by id.
//
// One static statement per tab and sort, built once below. Newest and oldest
// read idx_links_public_created (is_public, created_at) in order, so no sort
// step is needed. Filters are parameters, never string concatenation.

/** The q filter of the dashboard: slug, title, or URL contains the text. */
const searchSql = (like: string) =>
  `(${like} IS NULL OR l.slug LIKE ${like} ESCAPE '\\'
                  OR lower(l.title) LIKE ${like} ESCAPE '\\'
                  OR lower(l.url) LIKE ${like} ESCAPE '\\')`;

const tagSql = (tag: string) => `(${tag} IS NULL OR EXISTS (
        SELECT 1 FROM link_tags lt JOIN tags t ON t.id = lt.tag_id
        WHERE lt.link_id = l.id AND t.name = ${tag}))`;

const statusFilterSql = (status: string, now: string) =>
  `(${status} = 'all' OR ${statusSql(now)} = ${status})`;

/**
 * Private filters. ?1 asOf, ?2 7 day window start, ?3 LIKE pattern or NULL,
 * ?4 tag or NULL, ?5 status. The list adds ?6 cursor key or NULL, ?7 cursor
 * id, ?8 row limit.
 */
const PRIVATE_FILTER = `${searchSql('?3')}
  AND ${tagSql('?4')}
  AND ${statusFilterSql('?5', '?1')}`;

/** Public filters. ?1 asOf, ?2 LIKE pattern or NULL, ?3 status. The list adds ?4 key, ?5 id, ?6 limit. */
const PUBLIC_FILTER = `${searchSql('?2')}
  AND ${statusFilterSql('?3', '?1')}`;

/** Human clicks in the 7 day window, capped at asOf so later pages see the same numbers. */
const CLICKS_7D = `(SELECT COUNT(*) FROM clicks c
    WHERE c.link_id = l.id AND c.is_bot = 0 AND c.ts >= ?2 AND c.ts <= ?1)`;

export type ListVisibility = 'private' | 'public';
export type ListSort = 'newest' | 'oldest' | 'clicks' | 'least';

/** Descending sorts compare with <, ascending ones with >. */
const DESCENDING: Record<ListSort, boolean> = { newest: true, oldest: false, clicks: true, least: false };

/** Rows strictly after the cursor. The first page passes NULL as the key. */
function afterCursor(key: string, id: string, keyParam: string, idParam: string, sort: ListSort): string {
  const op = DESCENDING[sort] ? '<' : '>';
  return `(${keyParam} IS NULL OR ${key} ${op} ${keyParam} OR (${key} = ${keyParam} AND ${id} ${op} ${idParam}))`;
}

function orderBy(key: string, id: string, sort: ListSort): string {
  const dir = DESCENDING[sort] ? 'DESC' : 'ASC';
  return `ORDER BY ${key} ${dir}, ${id} ${dir}`;
}

function privateList(sort: ListSort): string {
  const base = `SELECT ${LINK_COLUMNS}, ${TAGS_JSON},
  ${CLICKS_7D} AS clicks7d
FROM links l
WHERE l.is_public = 0 AND l.created_at <= ?1
  AND ${PRIVATE_FILTER}`;
  if (sort === 'newest' || sort === 'oldest') {
    return `${base}
  AND ${afterCursor('l.created_at', 'l.id', '?6', '?7', sort)}
${orderBy('l.created_at', 'l.id', sort)}
LIMIT ?8`;
  }
  // clicks7d is computed per row, so the keyset applies to the derived table.
  return `SELECT * FROM (${base})
WHERE ${afterCursor('clicks7d', 'id', '?6', '?7', sort)}
${orderBy('clicks7d', 'id', sort)}
LIMIT ?8`;
}

const PUBLIC_COLUMNS =
  'l.id, l.slug, l.url, l.title, l.is_active, l.created_at, l.updated_at, l.click_total, l.click_day, l.click_today';

function publicList(sort: ListSort): string {
  const key = sort === 'newest' || sort === 'oldest' ? 'l.created_at' : 'l.click_total';
  return `SELECT ${PUBLIC_COLUMNS}
FROM links l
WHERE l.is_public = 1 AND l.created_at <= ?1
  AND ${PUBLIC_FILTER}
  AND ${afterCursor(key, 'l.id', '?4', '?5', sort)}
${orderBy(key, 'l.id', sort)}
LIMIT ?6`;
}

const LIST_SORTS: readonly ListSort[] = ['newest', 'oldest', 'clicks', 'least'];
const bySort = (build: (sort: ListSort) => string) =>
  Object.fromEntries(LIST_SORTS.map((sort) => [sort, build(sort)])) as Record<ListSort, string>;

export const LIST_SQL: Record<ListVisibility, Record<ListSort, string>> = {
  private: bySort(privateList),
  public: bySort(publicList),
};

/** ?1 asOf, ?2 LIKE or NULL, ?3 tag or NULL, ?4 status. Every private link, and those matching. */
export const COUNT_PRIVATE = `SELECT COUNT(*) AS total, COALESCE(SUM(
    ${searchSql('?2')}
    AND ${tagSql('?3')}
    AND ${statusFilterSql('?4', '?1')}), 0) AS matching
FROM links l WHERE l.is_public = 0 AND l.created_at <= ?1`;

/** ?1 asOf, ?2 LIKE or NULL, ?3 status. The tag filter never applies to public links. */
export const COUNT_PUBLIC = `SELECT COUNT(*) AS total, COALESCE(SUM(${PUBLIC_FILTER}), 0) AS matching
FROM links l WHERE l.is_public = 1 AND l.created_at <= ?1`;

/** ?1 id. All time human and bot totals, shown in the delete confirmation. */
export const LINK_TOTALS = `SELECT
  COALESCE(SUM(c.is_bot = 0), 0) AS human,
  COALESCE(SUM(c.is_bot = 1), 0) AS bot
FROM clicks c WHERE c.link_id = ?1`;

/** Tags still attached to at least one link, for the filter and the suggestions. */
export const TAGS_IN_USE = `SELECT t.name FROM tags t
WHERE EXISTS (SELECT 1 FROM link_tags lt WHERE lt.tag_id = t.id)
ORDER BY t.name`;

// Summary ----------------------------------------------------------------

/** ?1 now. Private links only, the public tab has its own figures below. */
export const SUMMARY_COUNTS = `SELECT COUNT(*) AS total,
  COALESCE(SUM(CASE WHEN l.is_active = 1 AND (l.expires_at IS NULL OR l.expires_at >= ?1)
                    THEN 1 ELSE 0 END), 0) AS active
FROM links l WHERE l.is_public = 0`;

/** ?1 00:00 UTC of today. Every public link, and today's use of the shared daily budget. */
export const PUBLIC_SUMMARY = `SELECT
  (SELECT COUNT(*) FROM links WHERE is_public = 1) AS total,
  (SELECT clicks FROM public_click_budget WHERE day = ?1) AS today`;

/**
 * ?1 window start. Joined from links so each link uses the clicks index.
 *
 * CROSS JOIN is deliberate. In SQLite it pins the left table as the outer
 * loop. With a plain JOIN and no ANALYZE statistics the planner chose clicks
 * as the outer loop, which is a full scan of clicks (caught by npm run explain).
 */
export const SUMMARY_CLICKS = `SELECT COUNT(*) AS human, COUNT(DISTINCT c.ip || '|' || c.ua) AS uniq
FROM links l CROSS JOIN clicks c ON c.link_id = l.id AND c.is_bot = 0 AND c.ts >= ?1`;

/** ?1 window start. CROSS JOIN for the same reason as SUMMARY_CLICKS. */
export const SUMMARY_TOP = `SELECT l.id, l.slug, l.title, COUNT(*) AS clicks
FROM links l CROSS JOIN clicks c ON c.link_id = l.id AND c.is_bot = 0 AND c.ts >= ?1
GROUP BY l.id
ORDER BY clicks DESC, l.created_at DESC
LIMIT 1`;

// Writes -----------------------------------------------------------------

/** ?1 slug, ?2 url, ?3 title, ?4 description, ?5 is_active, ?6 expires_at, ?7 now */
export const INSERT_LINK = `INSERT INTO links
  (slug, url, title, description, is_active, expires_at, created_at, updated_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`;

/** ?1 id, ?2 slug, ?3 url, ?4 title, ?5 description, ?6 is_active, ?7 expires_at, ?8 now */
export const UPDATE_LINK = `UPDATE links SET
  slug = ?2, url = ?3, title = ?4, description = ?5,
  is_active = ?6, expires_at = ?7, updated_at = ?8
WHERE id = ?1 AND is_public = 0`;

/**
 * ?1 id, ?2 now. Active becomes inactive. Inactive becomes active. Expired
 * becomes active with its expiry cleared, as the design does on Reactivate.
 * SQLite evaluates every SET expression against the old row, so both CASEs
 * see the same state.
 */
export const TOGGLE_LINK = `UPDATE links SET
  is_active = CASE WHEN is_active = 1 AND (expires_at IS NULL OR expires_at >= ?2)
                   THEN 0 ELSE 1 END,
  expires_at = CASE WHEN expires_at IS NOT NULL AND expires_at < ?2
                    THEN NULL ELSE expires_at END,
  updated_at = ?2
WHERE id = ?1 AND is_public = 0`;

/** ?1 id. clicks and link_tags go with it through ON DELETE CASCADE. */
export const DELETE_LINK = 'DELETE FROM links WHERE id = ?1 AND is_public = 0';

/** ?1 JSON array of normalized tag names */
export const INSERT_TAGS = 'INSERT OR IGNORE INTO tags (name) SELECT value FROM json_each(?1)';

/** ?1 id */
export const CLEAR_LINK_TAGS = 'DELETE FROM link_tags WHERE link_id = ?1';

/** ?1 id, ?2 JSON array of tag names */
export const ATTACH_TAGS_BY_ID = `INSERT INTO link_tags (link_id, tag_id)
SELECT ?1, t.id FROM tags t JOIN json_each(?2) j ON j.value = t.name`;

/** ?1 slug, ?2 JSON array of tag names. For create, where the new id is not known yet. */
export const ATTACH_TAGS_BY_SLUG = `INSERT INTO link_tags (link_id, tag_id)
SELECT (SELECT id FROM links WHERE slug = ?1), t.id
FROM tags t JOIN json_each(?2) j ON j.value = t.name`;

// Public links -------------------------------------------------------------

/**
 * ?1 JSON array of the host and every parent domain, from hostSuffixes. One
 * primary key lookup per element, so a blocked entry for example.com catches
 * a.b.example.com without loading the list.
 */
export const BLOCKED_MATCH = `SELECT b.host FROM blocked_domains b
WHERE b.host IN (SELECT j.value FROM json_each(?1) j)`;

/**
 * ?1 slug, ?2 url, ?3 title, ?4 now, ?5 window start, ?6 IP bucket, ?7 per IP
 * limit, ?8 global limit. Inserts nothing when either hourly count is used up.
 * The check and the insert run in one batch, and so one transaction, so
 * parallel requests cannot pass the limit together.
 */
export const PUBLIC_INSERT = `INSERT INTO links
  (slug, url, title, description, is_active, expires_at, created_at, updated_at, is_public)
SELECT ?1, ?2, ?3, '', 1, NULL, ?4, ?4, 1
WHERE COALESCE((SELECT r.count FROM rate_limits r WHERE r.window_start = ?5 AND r.bucket = ?6), 0) < ?7
  AND COALESCE((SELECT r.count FROM rate_limits r WHERE r.window_start = ?5 AND r.bucket = 'global'), 0) < ?8`;

/**
 * ?1 window start, ?2 JSON array of buckets, ?3 slug, ?4 now. Counts the
 * creation in every bucket, but only when PUBLIC_INSERT wrote the row, so a
 * refused request never spends quota.
 */
export const RATE_BUMP = `INSERT INTO rate_limits (window_start, bucket, count)
SELECT ?1, j.value, 1 FROM json_each(?2) j
WHERE EXISTS (SELECT 1 FROM links l WHERE l.slug = ?3 AND l.created_at = ?4 AND l.is_public = 1)
ON CONFLICT (window_start, bucket) DO UPDATE SET count = count + 1`;

/** ?1 slug, ?2 now. The row PUBLIC_INSERT wrote, or nothing when a limit stopped it. */
export const PUBLIC_CREATED = `SELECT l.slug, l.url, l.created_at FROM links l
WHERE l.slug = ?1 AND l.created_at = ?2 AND l.is_public = 1`;

/** ?1 window start, ?2 IP bucket. Tells which limit refused a request. */
export const RATE_READ = `SELECT r.bucket, r.count FROM rate_limits r
WHERE r.window_start = ?1 AND r.bucket IN (?2, 'global')`;

/** ?1 id */
export const PUBLIC_LINK_BY_ID = `SELECT ${PUBLIC_COLUMNS} FROM links l WHERE l.id = ?1 AND l.is_public = 1`;

/** ?1 id, ?2 is_active, ?3 now */
export const SET_PUBLIC_ACTIVE = `UPDATE links SET is_active = ?2, updated_at = ?3
WHERE id = ?1 AND is_public = 1`;

/** ?1 id. Public links have no clicks rows or tags, and the slug is free again. */
export const DELETE_PUBLIC_LINK = 'DELETE FROM links WHERE id = ?1 AND is_public = 1';

/**
 * ?1 host without www, ?2 '%.' plus the host. Active public links whose title,
 * the host without www, could fall under the host. A superset: the Worker
 * checks each URL exactly, which settles hosts that start with www.
 */
export const PUBLIC_HOST_CANDIDATES = `SELECT l.id, l.url FROM links l
WHERE l.is_public = 1 AND l.is_active = 1 AND (l.title = ?1 OR l.title LIKE ?2)`;

/** ?1 now, ?2 JSON array of ids */
export const DISABLE_IDS = `UPDATE links SET is_active = 0, updated_at = ?1
WHERE id IN (SELECT j.value FROM json_each(?2) j) AND is_public = 1 AND is_active = 1`;

// Blocked domains ------------------------------------------------------------

/** ?1 LIKE pattern or NULL. Newest first. The list is short, so it is read whole. */
export const BLOCKED_LIST = `SELECT b.host, b.created_at FROM blocked_domains b
WHERE ?1 IS NULL OR b.host LIKE ?1 ESCAPE '\\'
ORDER BY b.created_at DESC, b.host`;

export const BLOCKED_COUNT = 'SELECT COUNT(*) AS total FROM blocked_domains';

/** ?1 host */
export const BLOCKED_BY_HOST = 'SELECT b.host, b.created_at FROM blocked_domains b WHERE b.host = ?1';

/** ?1 host, ?2 now. Adding a host twice keeps the first date. */
export const BLOCKED_INSERT = `INSERT INTO blocked_domains (host, created_at) VALUES (?1, ?2)
ON CONFLICT (host) DO NOTHING`;

/** ?1 host */
export const BLOCKED_DELETE = 'DELETE FROM blocked_domains WHERE host = ?1';

// Daily cron ---------------------------------------------------------------

/** ?1 cutoff. Rate limit windows older than one day. */
export const PURGE_RATE_LIMITS = 'DELETE FROM rate_limits WHERE window_start < ?1';

/** ?1 cutoff. Daily budget rows older than seven days. */
export const PURGE_BUDGET = 'DELETE FROM public_click_budget WHERE day < ?1';

// Analytics --------------------------------------------------------------
// Every statement takes ?1 id, ?2 window start, ?3 window end. The end bound
// pins the snapshot, so a click logged while the batch runs cannot land in a
// bucket the response does not include.

const RANGE_FILTER = 'c.link_id = ?1 AND c.ts >= ?2 AND c.ts <= ?3';
const HUMAN_FILTER = `c.link_id = ?1 AND c.is_bot = 0 AND c.ts >= ?2 AND c.ts <= ?3`;
const BOT_FILTER = `c.link_id = ?1 AND c.is_bot = 1 AND c.ts >= ?2 AND c.ts <= ?3`;
const UNIQUE_HUMAN = `COUNT(DISTINCT CASE WHEN c.is_bot = 0 THEN c.ip || '|' || c.ua END)`;

export const ANALYTICS_TOTALS = `SELECT
  COALESCE(SUM(c.is_bot = 0), 0) AS human,
  COALESCE(SUM(c.is_bot = 1), 0) AS bot,
  ${UNIQUE_HUMAN} AS uniq
FROM clicks c WHERE ${RANGE_FILTER}`;

/** ?1 id. Decides the empty state and feeds the LAST CLICK card, whatever the range. */
export const ANALYTICS_ALL_TIME = `SELECT COUNT(*) AS human, MAX(c.ts) AS last_ts
FROM clicks c WHERE c.link_id = ?1 AND c.is_bot = 0`;

/**
 * Bucket start expressions. They must agree with hourStart, wibDayStart and
 * wibMonthStart in shared/time.ts. shared/time.test.ts checks the first two,
 * and the smoke test checks all three by comparing the series sum to the total.
 */
export const BUCKET_HOUR = '(c.ts / 3600000) * 3600000';
export const BUCKET_DAY = '((c.ts + 25200000) / 86400000) * 86400000 - 25200000';
export const BUCKET_MONTH =
  "CAST(strftime('%s', (c.ts + 25200000) / 1000, 'unixepoch', 'start of month') AS INTEGER) * 1000 - 25200000";

const seriesSql = (bucket: string) => `SELECT ${bucket} AS bucket,
  COALESCE(SUM(c.is_bot = 0), 0) AS human,
  ${UNIQUE_HUMAN} AS uniq,
  COALESCE(SUM(c.is_bot = 1), 0) AS bot
FROM clicks c WHERE ${RANGE_FILTER}
GROUP BY bucket ORDER BY bucket`;

export const SERIES_HOUR = seriesSql(BUCKET_HOUR);
export const SERIES_DAY = seriesSql(BUCKET_DAY);
export const SERIES_MONTH = seriesSql(BUCKET_MONTH);

const RANKING_LIMIT = 10;

export const TOP_COUNTRIES = `SELECT c.country AS country, COUNT(*) AS count
FROM clicks c WHERE ${HUMAN_FILTER}
GROUP BY c.country ORDER BY count DESC, country LIMIT ${RANKING_LIMIT}`;

export const TOP_CITIES = `SELECT c.city AS city, c.country AS country, COUNT(*) AS count
FROM clicks c WHERE ${HUMAN_FILTER}
GROUP BY c.city, c.country ORDER BY count DESC, city LIMIT ${RANKING_LIMIT}`;

/** Grouped by full URL here. The Worker folds them into hostnames afterwards. */
export const TOP_REFERRERS = `SELECT c.referrer AS referrer, COUNT(*) AS count
FROM clicks c WHERE ${HUMAN_FILTER}
GROUP BY c.referrer ORDER BY count DESC LIMIT 100`;

export const TOP_COLOS = `SELECT c.colo AS colo, COUNT(*) AS count
FROM clicks c WHERE ${HUMAN_FILTER}
GROUP BY c.colo ORDER BY count DESC, colo LIMIT ${RANKING_LIMIT}`;

export const TOP_ASNS = `SELECT c.asn AS asn, c.as_org AS org, COUNT(*) AS count
FROM clicks c WHERE ${HUMAN_FILTER}
GROUP BY c.asn, c.as_org ORDER BY count DESC, asn LIMIT ${RANKING_LIMIT}`;

/** Raw user agents. The browser parses device, browser, OS and bot names. */
export const HUMAN_USER_AGENTS = `SELECT c.ua AS ua, COUNT(*) AS count
FROM clicks c WHERE ${HUMAN_FILTER}
GROUP BY c.ua ORDER BY count DESC LIMIT 200`;

export const BOT_USER_AGENTS = `SELECT c.ua AS ua, COUNT(*) AS count
FROM clicks c WHERE ${BOT_FILTER}
GROUP BY c.ua ORDER BY count DESC LIMIT 200`;

// Click log --------------------------------------------------------------

/** ?1 id, ?2 start, ?3 end, ?4 page size, ?5 offset. Newest first, rowid breaks ties. */
export const CLICK_LOG_PAGE = `SELECT c.id, c.ts, c.ip, c.ua, c.is_bot, c.country, c.region,
  c.city, c.timezone, c.colo, c.asn, c.as_org, c.referrer
FROM clicks c WHERE ${RANGE_FILTER}
ORDER BY c.ts DESC, c.id DESC
LIMIT ?4 OFFSET ?5`;

/** ?1 id, ?2 start, ?3 end */
export const CLICK_LOG_COUNT = `SELECT COUNT(*) AS total FROM clicks c WHERE ${RANGE_FILTER}`;

// EXPLAIN QUERY PLAN cases -------------------------------------------------

export interface ExplainCase {
  name: string;
  sql: string;
  params: Array<string | number | null>;
  /** Whether the query reads clicks, and so must use one of its indexes. */
  readsClicks: boolean;
  /**
   * Every stored table must be reached through an index, nothing may be
   * scanned. Scans of json_each over a bound parameter and of derived tables
   * are allowed, since neither reads stored rows.
   */
  noScan?: boolean;
}

const SAMPLE_NOW = 1_790_000_000_000;
const SAMPLE_START = SAMPLE_NOW - 30 * 86_400_000;
const SAMPLE_HOUR = Math.floor(SAMPLE_NOW / 3_600_000) * 3_600_000;
const SAMPLE_DAY = Math.floor(SAMPLE_NOW / 86_400_000) * 86_400_000;
const SAMPLE_BUCKET = 'ip:2Yb8m7T0cYk4b6pQ1vVwXc3dJ0nQ9hS5fK1mL2nO4pA';
const range = [1, SAMPLE_START, SAMPLE_NOW];

const privateListCases: ExplainCase[] = (['newest', 'oldest', 'clicks', 'least'] as const).flatMap(
  (sort) => [
    {
      name: `links list, private, ${sort}, first page`,
      sql: LIST_SQL.private[sort],
      params: [SAMPLE_NOW, SAMPLE_START, null, null, 'all', null, null, 26],
      readsClicks: true,
      noScan: true,
    },
    {
      name: `links list, private, ${sort}, every filter and a cursor`,
      sql: LIST_SQL.private[sort],
      params: [SAMPLE_NOW, SAMPLE_START, '%cv%', 'career', 'active', sort === 'newest' || sort === 'oldest' ? SAMPLE_START : 4, 7, 26],
      readsClicks: true,
      noScan: true,
    },
  ],
);

const publicListCases: ExplainCase[] = (['newest', 'oldest', 'clicks', 'least'] as const).flatMap(
  (sort) => [
    {
      name: `links list, public, ${sort}, first page`,
      sql: LIST_SQL.public[sort],
      params: [SAMPLE_NOW, null, 'all', null, null, 26],
      readsClicks: false,
      noScan: true,
    },
    {
      name: `links list, public, ${sort}, search and a cursor`,
      sql: LIST_SQL.public[sort],
      params: [SAMPLE_NOW, '%docs%', 'active', sort === 'newest' || sort === 'oldest' ? SAMPLE_START : 300, 14, 26],
      readsClicks: false,
      noScan: true,
    },
  ],
);

/**
 * The exact request shapes the dashboard client sends that the cases above do
 * not: infinite scroll through an unfiltered list (a cursor and nothing else),
 * the first load (counts without filters), a status filter alone on the Public
 * tab, the blocked domain marks of one public page, the Blocked Domains modal
 * opening without a search, and the block dialog's check on a subdomain.
 */
const clientCases: ExplainCase[] = [
  ...(['newest', 'oldest', 'clicks', 'least'] as const).flatMap((sort): ExplainCase[] => {
    const byDate = sort === 'newest' || sort === 'oldest';
    return [
      {
        name: `client: private, ${sort}, next page without filters`,
        sql: LIST_SQL.private[sort],
        params: [SAMPLE_NOW, SAMPLE_START, null, null, 'all', byDate ? SAMPLE_START : 4, 7, 26],
        readsClicks: true,
        noScan: true,
      },
      {
        name: `client: public, ${sort}, next page without filters`,
        sql: LIST_SQL.public[sort],
        params: [SAMPLE_NOW, null, 'all', byDate ? SAMPLE_START : 300, 14, 26],
        readsClicks: false,
        noScan: true,
      },
    ];
  }),
  {
    name: 'client: public, status filter only',
    sql: LIST_SQL.public.newest,
    params: [SAMPLE_NOW, null, 'inactive', null, null, 26],
    readsClicks: false,
    noScan: true,
  },
  { name: 'client: private counts, no filters', sql: COUNT_PRIVATE, params: [SAMPLE_NOW, null, null, 'all'], readsClicks: false, noScan: true },
  { name: 'client: public counts, no filters', sql: COUNT_PUBLIC, params: [SAMPLE_NOW, null, 'all'], readsClicks: false, noScan: true },
  {
    name: 'client: blocked marks for a public page',
    sql: BLOCKED_MATCH,
    params: ['["docs.google.com","google.com","com","drive.google.com","github.com","www.canva.com","canva.com","notion.so","so"]'],
    readsClicks: false,
    noScan: true,
  },
  { name: 'client: blocked domains, no search', sql: BLOCKED_LIST, params: [null], readsClicks: false },
  {
    name: 'client: block check, active public links under a subdomain',
    sql: PUBLIC_HOST_CANDIDATES,
    params: ['docs.example.com', '%.docs.example.com'],
    readsClicks: false,
    noScan: true,
  },
];

export const EXPLAIN_CASES: ExplainCase[] = [
  { name: 'summary: link counts', sql: SUMMARY_COUNTS, params: [SAMPLE_NOW], readsClicks: false, noScan: true },
  { name: 'summary: human and unique clicks', sql: SUMMARY_CLICKS, params: [SAMPLE_START], readsClicks: true },
  { name: 'summary: most clicked link', sql: SUMMARY_TOP, params: [SAMPLE_START], readsClicks: true },
  { name: 'summary: public links and budget', sql: PUBLIC_SUMMARY, params: [SAMPLE_DAY], readsClicks: false, noScan: true },
  ...privateListCases,
  ...publicListCases,
  {
    name: 'links list: private counts',
    sql: COUNT_PRIVATE,
    params: [SAMPLE_NOW, '%cv%', 'career', 'active'],
    readsClicks: false,
    noScan: true,
  },
  {
    name: 'links list: public counts',
    sql: COUNT_PUBLIC,
    params: [SAMPLE_NOW, '%docs%', 'active'],
    readsClicks: false,
    noScan: true,
  },
  { name: 'link detail', sql: LINK_BY_ID, params: [1], readsClicks: false, noScan: true },
  { name: 'link all time totals', sql: LINK_TOTALS, params: [1], readsClicks: true },
  { name: 'tags in use', sql: TAGS_IN_USE, params: [], readsClicks: false },
  { name: 'analytics: range totals', sql: ANALYTICS_TOTALS, params: range, readsClicks: true },
  { name: 'analytics: all time human', sql: ANALYTICS_ALL_TIME, params: [1], readsClicks: true },
  { name: 'analytics: series by hour', sql: SERIES_HOUR, params: range, readsClicks: true },
  { name: 'analytics: series by day', sql: SERIES_DAY, params: range, readsClicks: true },
  { name: 'analytics: series by month', sql: SERIES_MONTH, params: range, readsClicks: true },
  { name: 'analytics: countries', sql: TOP_COUNTRIES, params: range, readsClicks: true },
  { name: 'analytics: cities', sql: TOP_CITIES, params: range, readsClicks: true },
  { name: 'analytics: referrers', sql: TOP_REFERRERS, params: range, readsClicks: true },
  { name: 'analytics: colos', sql: TOP_COLOS, params: range, readsClicks: true },
  { name: 'analytics: ASNs', sql: TOP_ASNS, params: range, readsClicks: true },
  { name: 'analytics: human user agents', sql: HUMAN_USER_AGENTS, params: range, readsClicks: true },
  { name: 'analytics: bot user agents', sql: BOT_USER_AGENTS, params: range, readsClicks: true },
  { name: 'click log: page', sql: CLICK_LOG_PAGE, params: [...range, 10, 0], readsClicks: true },
  { name: 'click log: count', sql: CLICK_LOG_COUNT, params: range, readsClicks: true },

  // Public creation, which anyone can call, and the moderation behind it.
  {
    name: 'public create: blocked domain lookup',
    sql: BLOCKED_MATCH,
    params: ['["a.b.example.com","b.example.com","example.com","com"]'],
    readsClicks: false,
    noScan: true,
  },
  {
    name: 'public create: insert within the hourly limits',
    sql: PUBLIC_INSERT,
    params: ['x7kq2m', 'https://example.com/', 'example.com', SAMPLE_NOW, SAMPLE_HOUR, SAMPLE_BUCKET, 5, 30],
    readsClicks: false,
    noScan: true,
  },
  {
    name: 'public create: count the creation',
    sql: RATE_BUMP,
    params: [SAMPLE_HOUR, `["${SAMPLE_BUCKET}","global"]`, 'x7kq2m', SAMPLE_NOW],
    readsClicks: false,
    noScan: true,
  },
  { name: 'public create: read back', sql: PUBLIC_CREATED, params: ['x7kq2m', SAMPLE_NOW], readsClicks: false, noScan: true },
  { name: 'public create: hourly counts', sql: RATE_READ, params: [SAMPLE_HOUR, SAMPLE_BUCKET], readsClicks: false, noScan: true },
  { name: 'moderation: public link', sql: PUBLIC_LINK_BY_ID, params: [11], readsClicks: false, noScan: true },
  { name: 'moderation: enable or disable', sql: SET_PUBLIC_ACTIVE, params: [11, 0, SAMPLE_NOW], readsClicks: false, noScan: true },
  { name: 'moderation: delete public link', sql: DELETE_PUBLIC_LINK, params: [11], readsClicks: false, noScan: true },
  {
    name: 'moderation: active public links under a host',
    sql: PUBLIC_HOST_CANDIDATES,
    params: ['example.com', '%.example.com'],
    readsClicks: false,
    noScan: true,
  },
  { name: 'moderation: disable by ids', sql: DISABLE_IDS, params: [SAMPLE_NOW, '[11,12]'], readsClicks: false, noScan: true },
  { name: 'blocked domains: list with search', sql: BLOCKED_LIST, params: ['%promo%'], readsClicks: false },
  { name: 'blocked domains: count', sql: BLOCKED_COUNT, params: [], readsClicks: false },
  { name: 'blocked domains: by host', sql: BLOCKED_BY_HOST, params: ['example.com'], readsClicks: false, noScan: true },
  { name: 'blocked domains: add', sql: BLOCKED_INSERT, params: ['example.com', SAMPLE_NOW], readsClicks: false, noScan: true },
  { name: 'blocked domains: remove', sql: BLOCKED_DELETE, params: ['example.com'], readsClicks: false, noScan: true },
  { name: 'cron: purge rate limits', sql: PURGE_RATE_LIMITS, params: [SAMPLE_HOUR - 86_400_000], readsClicks: false, noScan: true },
  { name: 'cron: purge daily budget', sql: PURGE_BUDGET, params: [SAMPLE_DAY - 7 * 86_400_000], readsClicks: false, noScan: true },
  ...clientCases,
];
