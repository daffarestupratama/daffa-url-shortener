-- Public links, created anonymously on link.daffa.me, plus the tables that
-- keep them inside the free plan quotas. Additive only: every existing link
-- becomes private through the column default, and code that selects explicit
-- columns keeps working before and after this migration.

-- Visibility flag. 0 is private (owner), 1 is public (anonymous visitor).
ALTER TABLE links ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;

-- Click counters for public links only. Public clicks never write a clicks
-- row, so no IP, location, device, or referrer is kept for them. A click_day
-- older than today means click_today counts zero, so no reset job is needed.
ALTER TABLE links ADD COLUMN click_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE links ADD COLUMN click_day INTEGER NOT NULL DEFAULT 0;   -- epoch ms, 00:00 UTC
ALTER TABLE links ADD COLUMN click_today INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_links_public_created ON links (is_public, created_at);

-- Hostnames blocked for new public links. An entry matches the hostname
-- itself and every subdomain of it. Private links are never checked.
CREATE TABLE blocked_domains (
  host TEXT PRIMARY KEY,             -- normalized lowercase hostname
  created_at INTEGER NOT NULL        -- epoch ms
) WITHOUT ROWID;

-- Fixed window counters for public link creation, one row per bucket and
-- clock hour. bucket is 'global' or 'ip:' followed by an HMAC-SHA-256 of the
-- client IP keyed with a secret, so no raw IP is ever stored. Old windows are
-- purged by the daily cron of the dashboard Worker.
CREATE TABLE rate_limits (
  window_start INTEGER NOT NULL,     -- epoch ms, start of the clock hour
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (window_start, bucket)
) WITHOUT ROWID;

-- Combined clicks of all public links per UTC day, checked against the shared
-- daily budget on every public redirect.
CREATE TABLE public_click_budget (
  day INTEGER PRIMARY KEY,           -- epoch ms, 00:00 UTC
  clicks INTEGER NOT NULL
);
