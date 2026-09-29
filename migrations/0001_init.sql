-- Initial schema for the daffa.me URL shortener.
-- Both Workers (redirector and dashboard) bind to this same database.

CREATE TABLE links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER,                -- epoch ms, NULL means never expires
  created_at INTEGER NOT NULL,       -- epoch ms
  updated_at INTEGER NOT NULL        -- epoch ms
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE link_tags (
  link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (link_id, tag_id)
);

-- One row per redirect served. Written from the redirector via ctx.waitUntil,
-- for GET only. The user agent is stored raw and parsed in the browser, so the
-- redirect path never spends CPU on parsing.
CREATE TABLE clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,               -- epoch ms
  ip TEXT NOT NULL,                  -- CF-Connecting-IP, stored in full
  ua TEXT NOT NULL,                  -- raw user agent
  is_bot INTEGER NOT NULL,           -- single regex test on the hot path
  country TEXT,
  region TEXT,
  city TEXT,
  timezone TEXT,
  colo TEXT,                         -- Cloudflare edge location, IATA code
  asn INTEGER,
  as_org TEXT,
  referrer TEXT
);

CREATE INDEX idx_clicks_link_ts     ON clicks (link_id, ts);
CREATE INDEX idx_clicks_link_bot_ts ON clicks (link_id, is_bot, ts);
