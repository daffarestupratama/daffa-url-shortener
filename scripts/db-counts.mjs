import { d1Local } from './d1.mjs';

/**
 * Prints row counts and the id to slug mapping of the local database as JSON,
 * so two seed runs can be compared exactly. The seed is expected to produce the
 * same output every time: the checklist URLs (/links/1 for cv, /links/9 for
 * jadwal) depend on the ids staying put.
 */

const SQL = [
  'SELECT (SELECT COUNT(*) FROM links) AS links, (SELECT COUNT(*) FROM links WHERE is_public = 1) AS public_links, (SELECT COUNT(*) FROM tags) AS tags, (SELECT COUNT(*) FROM link_tags) AS link_tags, (SELECT COUNT(*) FROM clicks) AS clicks, (SELECT COUNT(*) FROM clicks WHERE is_bot = 1) AS bot_clicks, (SELECT COUNT(*) FROM blocked_domains) AS blocked_domains, (SELECT COUNT(*) FROM rate_limits) AS rate_limits, (SELECT COUNT(*) FROM public_click_budget) AS budget_days;',
  'SELECT id, slug FROM links ORDER BY id;',
  'SELECT l.slug, COUNT(c.id) AS clicks FROM links l LEFT JOIN clicks c ON c.link_id = l.id WHERE l.is_public = 0 GROUP BY l.id ORDER BY l.id;',
  'SELECT slug, click_total, click_today FROM links WHERE is_public = 1 ORDER BY id;',
].join('\n');

try {
  const results = await d1Local(SQL);
  const totals = results[0].results[0];
  const ids = Object.fromEntries(results[1].results.map((row) => [row.id, row.slug]));
  const perLink = Object.fromEntries(results[2].results.map((row) => [row.slug, row.clicks]));
  const publicCounters = Object.fromEntries(
    results[3].results.map((row) => [row.slug, { total: row.click_total, today: row.click_today }]),
  );
  console.log(JSON.stringify({ totals, ids, clicksPerLink: perLink, publicCounters }, null, 2));
} catch (error) {
  console.error(String(error.message ?? error));
  process.exit(1);
}
