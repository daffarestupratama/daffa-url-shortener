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
  recordMiss,
  type GuardEnv,
} from './guard';
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
import { LOOKUP } from './sql';

export interface Env extends GuardEnv {
  DB: D1Database;
}

const HOME = 'https://daffarestupratama.com';

const NO_STORE = 'no-store, private';

interface LookupRow {
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

/** Public link URLs are rendered into an href, so only http and https get there. */
const HTTP_URL = /^https?:///i;

const app = new Hono<{ Bindings: Env }>();

/** The apex is not a slug, it is the way to the main site. */
app.on(['GET', 'HEAD'], '/', (c) =>
  c.newResponse(null, 301, { Location: HOME, 'Cache-Control': NO_STORE }),
);

/** Answered without touching D1. */
app.on(['GET', 'HEAD'], '/favicon.ico', (c) => c.newResponse(null, 204));

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

  // The block marker and the slug lookup run side by side, so a hit pays no
  // extra latency for the guard. A block wins over whatever the lookup found:
  // nothing is logged or counted for a blocked request.
  const [until, lookup] = await Promise.all([
    key ? blockedInCache(key, now, cache) : Promise.resolve(null),
    c.env.DB.prepare(LOOKUP)
      .bind(slug, today)
      .first<LookupRow>()
      .then(
        (row) => ({ row }),
        (error: unknown) => ({ error }),
      ),
  ]);
  if (until) return blocked(until);

  if ('error' in lookup) {
    console.error('link lookup failed', lookup.error);
    return pageResponse(renderUnavailable(slug), 503);
  }

  const row = lookup.row;
  if (!row) {
    return miss();
  }

  if (!isServable(row.is_active === 1, row.expires_at, now)) {
    return pageResponse(renderGone(slug), 410);
  }

  if (row.is_public === 1) {
    return servePublic(c.env.DB, c.executionCtx, c.req.method, slug, row, now, today);
  }

  // HEAD is a probe, not a visit, so it is not logged.
  if (c.req.method === 'GET') {
    c.executionCtx.waitUntil(logClick(c.env.DB, c.req.raw, row.id));
  }

  // The incoming query string is ignored on purpose. The destination is the
  // stored URL exactly as saved, so /cv?ref=abc does not carry ref=abc along.
  return c.newResponse(null, 302, { Location: row.url, 'Cache-Control': NO_STORE });
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
  row: LookupRow,
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
