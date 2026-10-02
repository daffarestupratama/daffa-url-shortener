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
import { logClick } from './log';
import {
  pageResponse,
  renderBusy,
  renderGone,
  renderInterstitial,
  renderLinkLimit,
  renderNotFound,
  renderUnavailable,
} from './pages';
import ROBOTS from './robots.txt';
import { LOOKUP } from './sql';

export interface Env {
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

  // A path that cannot be a slug is answered straight away, so junk traffic
  // never reaches the database.
  if (!isValidSlugPath(slug)) {
    return pageResponse(renderNotFound(slug), 404);
  }

  const now = Date.now();
  const today = utcDayStart(now);

  let row: LookupRow | null;
  try {
    row = await c.env.DB.prepare(LOOKUP).bind(slug, today).first<LookupRow>();
  } catch (error) {
    console.error('link lookup failed', error);
    return pageResponse(renderUnavailable(slug), 503);
  }

  if (!row) {
    return pageResponse(renderNotFound(slug), 404);
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
