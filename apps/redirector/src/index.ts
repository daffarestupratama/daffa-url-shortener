import { Hono } from 'hono';
import { isServable, isValidSlugPath, normalizeSlugPath } from '@daffa/shared';
import { logClick } from './log';
import { pageResponse, renderGone, renderNotFound, renderUnavailable } from './pages';
import ROBOTS from './robots.txt';

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
}

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

  let row: LookupRow | null;
  try {
    row = await c.env.DB.prepare(
      'SELECT id, url, is_active, expires_at FROM links WHERE slug = ?1',
    )
      .bind(slug)
      .first<LookupRow>();
  } catch (error) {
    console.error('link lookup failed', error);
    return pageResponse(renderUnavailable(slug), 503);
  }

  if (!row) {
    return pageResponse(renderNotFound(slug), 404);
  }

  if (!isServable(row.is_active === 1, row.expires_at)) {
    return pageResponse(renderGone(slug), 410);
  }

  // HEAD is a probe, not a visit, so it is not logged.
  if (c.req.method === 'GET') {
    c.executionCtx.waitUntil(logClick(c.env.DB, c.req.raw, row.id));
  }

  // The incoming query string is ignored on purpose. The destination is the
  // stored URL exactly as saved, so /cv?ref=abc does not carry ref=abc along.
  return c.newResponse(null, 302, { Location: row.url, 'Cache-Control': NO_STORE });
});

/** Anything that is not GET or HEAD has no meaning on a short link. */
app.all('/*', (c) => c.newResponse(null, 405, { Allow: 'GET, HEAD' }));

export default app;
