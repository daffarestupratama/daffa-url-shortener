-- Global blocks of the slug guessing guard (apps/redirector/src/guard.ts).
-- Rate Limiting counters live per Cloudflare location, so a guesser whose
-- connections land on different locations is barely slowed by them alone.
-- When any location trips the guard, the redirector writes one row here, and
-- the slug lookup of every location reads it, so the network gets 429 for
-- valid slugs everywhere until blocked_until.
--
-- Additive only: code before this migration never reads the table. Rows are
-- written at most once per key per isolate per block period, never per miss,
-- and expired rows are purged by the daily cron of the dashboard Worker.

CREATE TABLE guard_blocks (
  key TEXT PRIMARY KEY,              -- 'miss:' plus an HMAC-SHA-256 of the network, never an address
  blocked_until INTEGER NOT NULL     -- epoch ms
) WITHOUT ROWID;

-- Serves the purge of expired rows, so the cron never scans the table.
CREATE INDEX idx_guard_blocks_until ON guard_blocks (blocked_until);
