import { Hono } from 'hono';
import {
  isBudgetReached,
  isLinkCapReached,
  isServable,
  isValidSlugPath,
  nextUtcDayStart,
  normalizeSlugPath,
  secondsUntil,
  utcDayStart,
} from '@daffa/shared';
import { countPublicClick } from './count';
import {
  blockedInCache,
  blockedInMemory,
  defaultCache,
  guardKey,
  isAutoPath,
  noteGlobalBlock,
  recordMiss,
  reportOnce,
  type GuardEnv,
} from './guard';
import { ICONS, iconResponse } from './icons';
import { logClick } from './log';
import {
  pageResponse,
  renderAttemptLimit,
  renderBusy,
  renderGone,
  renderInterstitial,
  renderLinkLimit,
  renderNotFound,
  renderUnavailable,
} from './pages';
import ROBOTS from './robots.txt';
import { LOOKUP, LOOKUP_UNGUARDED } from './sql';

export interface Env extends GuardEnv {
  DB: D1Database;
}

const HOME = 'https://daffarestupratama.com';

const NO_STORE = 'no-store, private';

interface LinkRow {
  id: number;
  url: string;
  is_active: number;
  expires_at: number | null;
  is_public: number;
  click_day: number;
  click_today: number;
  /** Clicks of all public links today. Always null for a private link. */
  budget_used: number | null;
}

/**
 * LOOKUP always returns one row. For an unknown slug every link column is
 * null, and blocked_until still reports a global block of the guard.
 */
type LookupRow = { [K in keyof LinkRow]: LinkRow[K] | null } & { blocked_until?: number | null };

type Lookup = { row: LookupRow | null } | { error: unknown };

/**
 * The slug lookup with the global block of the guard in the same query. If
 * guard_blocks is missing because the redirector was deployed before
 * migration 0003, the previous lookup runs instead, so every link still works.
 */
async function lookup(db: D1Database, slug: string, today: number, key: string | null, now: number): Promise<Lookup> {
  try {
    return { row: await db.prepare(LOOKUP).bind(slug, today, key, now).first<LookupRow>() };
  } catch (error) {
    if (!String(error).includes('guard_blocks')) return { error };
    reportOnce('guard_blocks is missing, run the migrations', error);
  }
  try {
    return { row: await db.prepare(LOOKUP_UNGUARDED).bind(slug, today).first<LookupRow>() };
  } catch (error) {
    return { error };
  }
}

/** Public link URLs are rendered into an href, so only http and https get there. */
const HTTP_URL = /^https?:///i;

const app = new Hono<{ Bindings: Env }>();

/** The apex is not a slug, it is the way to the main site. */
app.on(['GET', 'HEAD'], '/', (c) =>
  c.newResponse(null, 301, { Location: HOME, 'Cache-Control': NO_STORE }),
);

/** Answered from memory, before the guard and without touching D1. */
app.on(['GET', 'HEAD'], Object.keys(ICONS), (c) => {
  const icon = ICONS[new URL(c.req.url).pathname];
  return icon ? iconResponse(icon) : c.notFound();
});

app.on(['GET', 'HEAD'], '/robots.txt', (c) =>
  c.newResponse(ROBOTS, 200, { 'Content-Type': 'text/plain; charset=utf-8' }),
);

app.on(['GET', 'HEAD'], '/*', async (c) => {
  const { pathname } = new URL(c.req.url);
  const slug = normalizeSlugPath(pathname);

  // Browsers and crawlers ask for these on their own. They are never slugs,
  // so they neither count as a miss nor wait for the guard.
  if (isAutoPath(pathname)) {
    return pageResponse(renderNotFound(slug), 404);
  }

  const now = Date.now();
  const cache = defaultCache();
  const key = await guardKey(c.env, c.req.raw);
  const blocked = (until: number) =>
    pageResponse(renderAttemptLimit(slug), 429, { 'Retry-After': String(secondsUntil(until, now)) });

  // A miss answers 404, or 429 when it is the one that goes over the limit.
  const miss = async () => {
    const until = key ? await recordMiss(c.env, key, now, cache, c.executionCtx) : null;
    return until ? blocked(until) : pageResponse(renderNotFound(slug), 404);
  };

  const inMemory = key ? blockedInMemory(key, now) : null;
  if (inMemory) return blocked(inMemory);

  // A path that cannot be a slug is answered straight away, so junk traffic
  // never reaches the database. It is still a miss.
  if (!isValidSlugPath(slug)) {
    const until = key ? await blockedInCache(key, now, cache) : null;
    return until ? blocked(until) : miss();
  }

  const today = utcDayStart(now);

  // The block marker and the slug lookup run side by side, and the lookup
  // reads the global block in the same query, so a hit pays no extra latency
  // for the guard. A block wins over whatever the lookup found: nothing is
  // logged or counted for a blocked request.
  const [cached, found] = await Promise.all([
    key ? blockedInCache(key, now, cache) : Promise.resolve(null),
    lookup(c.env.DB, slug, today, key, now),
  ]);
  const global = 'row' in found ? (found.row?.blocked_until ?? null) : null;
  if (key && global) noteGlobalBlock(key, global);
  const until = Math.max(cached ?? 0, global ?? 0);
  if (until) return blocked(until);

  if ('error' in found) {
    console.error('link lookup failed', found.error);
    return pageResponse(renderUnavailable(slug), 503);
  }

  const row = found.row;
  if (!row || row.id === null) {
    return miss();
  }
  // An id means the join found the link, so its NOT NULL columns are set.
  const link = row as LinkRow;

  if (!isServable(link.is_active === 1, link.expires_at, now)) {
    return pageResponse(renderGone(slug), 410);
  }

  if (link.is_public === 1) {
    return servePublic(c.env.DB, c.executionCtx, c.req.method, slug, link, now, today);
  }

  // HEAD is a probe, not a visit, so it is not logged.
  if (c.req.method === 'GET') {
    c.executionCtx.waitUntil(logClick(c.env.DB, c.req.raw, link.id));
  }

  // The incoming query string is ignored on purpose. The destination is the
  // stored URL exactly as saved, so /cv?ref=abc does not carry ref=abc along.
  return c.newResponse(null, 302, { Location: link.url, 'Cache-Control': NO_STORE });
});

/**
 * A public link never redirects straight away. Its visitor sees the notice
 * page with the destination and a Continue link, unless one of the daily
 * limits is used up. Both limits reset at 00:00 UTC, so Retry-After points
 * there. Only a served notice counts, and only for GET. Bots count as well,
 * because preview fetchers spend the same quota the limits protect.
 *
 * The limits are read before the counters are written in waitUntil, so a few
 * simultaneous visits at the edge of a limit can each pass. That small
 * overshoot is acceptable for a quota guard.
 */
function servePublic(
  db: D1Database,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  method: string,
  slug: string,
  row: LinkRow,
  now: number,
  today: number,
): Response {
  if (!HTTP_URL.test(row.url)) {
    return pageResponse(renderGone(slug), 410);
  }
  const retry = { 'Retry-After': String(secondsUntil(nextUtcDayStart(now), now)) };
  if (isLinkCapReached(row.click_day, row.click_today, now)) {
    return pageResponse(renderLinkLimit(slug), 429, retry);
  }
  if (isBudgetReached(row.budget_used)) {
    return pageResponse(renderBusy(slug), 429, retry);
  }
  if (method === 'GET') {
    ctx.waitUntil(countPublicClick(db, row.id, today));
  }
  return pageResponse(renderInterstitial(slug, row.url), 200);
}

/** Anything that is not GET or HEAD has no meaning on a short link. */
app.all('/*', (c) => c.newResponse(null, 405, { Allow: 'GET, HEAD' }));

export default app;
