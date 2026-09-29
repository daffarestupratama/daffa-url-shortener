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

/** ?1 id */
export const LINK_BY_ID = `SELECT ${LINK_COLUMNS}, ${TAGS_JSON} FROM links l WHERE l.id = ?1`;

/** ?1 slug */
export const LINK_BY_SLUG = `SELECT ${LINK_COLUMNS}, ${TAGS_JSON} FROM links l WHERE l.slug = ?1`;

/** ?1 slug. Used for the "already used by" message. */
export const SLUG_OWNER = 'SELECT id, title FROM links WHERE slug = ?1';

/** ?1 id. Existence and creation date, for analytics and the click log. */
export const LINK_CREATED = 'SELECT id, created_at FROM links WHERE id = ?1';

/**
 * The links list in one statement: tags and 7 day human clicks come from
 * correlated subqueries, so there is no N+1 round trip. Filters are
 * parameters, never string concatenation.
 *
 * ?1 now, ?2 7 day window start, ?3 LIKE pattern or NULL, ?4 tag or NULL,
 * ?5 status ('all' | 'active' | 'inactive' | 'expired'), ?6 sort ('newest' | 'clicks')
 */
export const LIST_LINKS = `SELECT ${LINK_COLUMNS}, ${TAGS_JSON},
  (SELECT COUNT(*) FROM clicks c
    WHERE c.link_id = l.id AND c.is_bot = 0 AND c.ts >= ?2) AS clicks7d
FROM links l
WHERE (?3 IS NULL OR l.slug LIKE ?3 ESCAPE '\\'
                  OR lower(l.title) LIKE ?3 ESCAPE '\\'
                  OR lower(l.url) LIKE ?3 ESCAPE '\\')
  AND (?4 IS NULL OR EXISTS (
        SELECT 1 FROM link_tags lt JOIN tags t ON t.id = lt.tag_id
        WHERE lt.link_id = l.id AND t.name = ?4))
  AND (?5 = 'all' OR ${statusSql('?1')} = ?5)
ORDER BY CASE WHEN ?6 = 'clicks' THEN clicks7d END DESC, l.created_at DESC, l.id DESC`;

/** Every saved link, ignoring filters. Separates the empty state from no results. */
export const COUNT_LINKS = 'SELECT COUNT(*) AS total FROM links';

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

/** ?1 now */
export const SUMMARY_COUNTS = `SELECT COUNT(*) AS total,
  COALESCE(SUM(CASE WHEN l.is_active = 1 AND (l.expires_at IS NULL OR l.expires_at >= ?1)
                    THEN 1 ELSE 0 END), 0) AS active
FROM links l`;

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
WHERE id = ?1`;

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
WHERE id = ?1`;

/** ?1 id. clicks and link_tags go with it through ON DELETE CASCADE. */
export const DELETE_LINK = 'DELETE FROM links WHERE id = ?1';

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
}

const SAMPLE_NOW = 1_790_000_000_000;
const SAMPLE_START = SAMPLE_NOW - 30 * 86_400_000;
const range = [1, SAMPLE_START, SAMPLE_NOW];

export const EXPLAIN_CASES: ExplainCase[] = [
  { name: 'summary: link counts', sql: SUMMARY_COUNTS, params: [SAMPLE_NOW], readsClicks: false },
  { name: 'summary: human and unique clicks', sql: SUMMARY_CLICKS, params: [SAMPLE_START], readsClicks: true },
  { name: 'summary: most clicked link', sql: SUMMARY_TOP, params: [SAMPLE_START], readsClicks: true },
  {
    name: 'links list, all filters set',
    sql: LIST_LINKS,
    params: [SAMPLE_NOW, SAMPLE_START, '%cv%', 'career', 'active', 'clicks'],
    readsClicks: true,
  },
  {
    name: 'links list, no filters',
    sql: LIST_LINKS,
    params: [SAMPLE_NOW, SAMPLE_START, null, null, 'all', 'newest'],
    readsClicks: true,
  },
  { name: 'link detail', sql: LINK_BY_ID, params: [1], readsClicks: false },
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
];
