/**
 * Every statement the redirector runs, in one place so scripts/explain.mjs can
 * check the query plans of exactly what ships.
 */

/**
 * The one query per click. ?1 is the slug, ?2 is 00:00 UTC of today. The
 * budget subquery sits inside the CASE so a private link never reads the
 * budget row, and private redirects cost the same rows read as before.
 */
export const LOOKUP = `SELECT l.id, l.url, l.is_active, l.expires_at, l.is_public, l.click_day, l.click_today,
  CASE WHEN l.is_public = 1
    THEN (SELECT b.clicks FROM public_click_budget b WHERE b.day = ?2) END AS budget_used
FROM links l WHERE l.slug = ?1`;

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

export const EXPLAIN_CASES: ExplainCase[] = [
  {
    name: 'redirector: link lookup with budget',
    sql: LOOKUP,
    params: ['x7kq2m', SAMPLE_DAY],
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
