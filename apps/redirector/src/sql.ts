/**
 * Every statement the redirector runs, in one place so scripts/explain.mjs can
 * check the query plans of exactly what ships.
 */

/**
 * The one query per click. ?1 is the slug, ?2 is 00:00 UTC of today, ?3 is
 * the guard key of the visitor or NULL, ?4 is now. The budget subquery sits
 * inside the CASE so a private link never reads the budget row, and private
 * redirects cost the same rows read as before.
 *
 * The constant row on the left makes the query return exactly one row, also
 * for an unknown slug, so a miss still learns whether its network carries a
 * global block of the slug guessing guard. Unknown slugs come back with every
 * link column NULL. A NULL key never matches, so the guard stays off.
 */
export const LOOKUP = `SELECT
  (SELECT g.blocked_until FROM guard_blocks g WHERE g.key = ?3 AND g.blocked_until > ?4) AS blocked_until,
  l.id, l.url, l.is_active, l.expires_at, l.is_public, l.click_day, l.click_today,
  CASE WHEN l.is_public = 1
    THEN (SELECT b.clicks FROM public_click_budget b WHERE b.day = ?2) END AS budget_used
FROM (SELECT 1) AS one LEFT JOIN links l ON l.slug = ?1`;

/**
 * The lookup before migration 0003, without the global block. Only used when
 * LOOKUP fails because guard_blocks does not exist yet, so a deploy that runs
 * ahead of its migration still serves every link. ?1 is the slug, ?2 is
 * 00:00 UTC of today. Returns no row for an unknown slug.
 */
export const LOOKUP_UNGUARDED = `SELECT l.id, l.url, l.is_active, l.expires_at, l.is_public, l.click_day, l.click_today,
  CASE WHEN l.is_public = 1
    THEN (SELECT b.clicks FROM public_click_budget b WHERE b.day = ?2) END AS budget_used
FROM links l WHERE l.slug = ?1`;

/**
 * ?1 is the guard key, ?2 is when the global block ends. A block only ever
 * grows, so a late write from a slower isolate never shortens it.
 */
export const UPSERT_GUARD_BLOCK = `INSERT INTO guard_blocks (key, blocked_until) VALUES (?1, ?2)
  ON CONFLICT (key) DO UPDATE SET blocked_until = max(blocked_until, excluded.blocked_until)`;

/** ?1 is the link id, ?2 is 00:00 UTC of today. A counter from another day restarts at 1. */
export const COUNT_LINK = `UPDATE links SET click_total = click_total + 1,
  click_today = CASE WHEN click_day = ?2 THEN click_today + 1 ELSE 1 END,
  click_day = ?2
WHERE id = ?1`;

/** ?1 is 00:00 UTC of today. */
export const COUNT_BUDGET = `INSERT INTO public_click_budget (day, clicks) VALUES (?1, 1)
  ON CONFLICT (day) DO UPDATE SET clicks = clicks + 1`;

export interface ExplainCase {
  name: string;
  sql: string;
  params: (string | number | null)[];
  readsClicks: boolean;
  /** Every table must be reached through an index, nothing may be scanned. */
  noScan?: boolean;
}

const SAMPLE_DAY = Date.UTC(2026, 8, 27);
const SAMPLE_NOW = SAMPLE_DAY + 7 * 3_600_000;
/** Shaped like a real key, a 43 character base64url HMAC. */
const SAMPLE_KEY = `miss:${'x'.repeat(43)}`;

export const EXPLAIN_CASES: ExplainCase[] = [
  {
    name: 'redirector: link lookup with budget and global block',
    sql: LOOKUP,
    params: ['x7kq2m', SAMPLE_DAY, SAMPLE_KEY, SAMPLE_NOW],
    readsClicks: false,
    noScan: true,
  },
  {
    name: 'redirector: link lookup without guard_blocks',
    sql: LOOKUP_UNGUARDED,
    params: ['x7kq2m', SAMPLE_DAY],
    readsClicks: false,
    noScan: true,
  },
  {
    name: 'redirector: global block upsert',
    sql: UPSERT_GUARD_BLOCK,
    params: [SAMPLE_KEY, SAMPLE_NOW + 300_000],
    readsClicks: false,
    noScan: true,
  },
  {
    name: 'redirector: public link counter',
    sql: COUNT_LINK,
    params: [11, SAMPLE_DAY],
    readsClicks: false,
    noScan: true,
  },
  {
    name: 'redirector: public daily budget',
    sql: COUNT_BUDGET,
    params: [SAMPLE_DAY],
    readsClicks: false,
    noScan: true,
  },
];
